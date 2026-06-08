-- =====================================================================
-- m058 — SECURITY: client ownership + data isolation (sales).
-- =====================================================================
--
-- AUDIT FINDING (critical)
-- ------------------------
-- The `clients` table had NO owner column and NO row-level security.
-- Every authenticated user — including a plain Sales rep — could read
-- EVERY client in the company. Combined with the "clients are global"
-- query in /clients, a Sales user saw other reps' clients, projects
-- and (transitively) pipelines. Commercial-privacy breach.
--
-- FIX
-- ---
-- 1. Add `clients.created_by` (the owning user).
-- 2. Backfill it from each client's earliest document's creator, so
--    existing clients get an owner instead of becoming orphans.
-- 3. Enable RLS + install scoped policies:
--      SELECT : owner OR technical role (admin/TLM/operations/super)
--               OR the user owns at least one document for this client
--               (so a rep who quoted a client still sees it).
--      INSERT : created_by must equal auth.uid().
--      UPDATE : owner OR technical.
--      DELETE : owner OR admin/super (the delete_client_safe RPC is
--               SECURITY DEFINER and bypasses this anyway).
--
-- Mirrors the documents hardening from m046. Technical roles keep the
-- full directory; Sales is isolated to their own book by default.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Owner column
-- ---------------------------------------------------------------------
alter table clients
  add column if not exists created_by uuid references auth.users(id);

-- ---------------------------------------------------------------------
-- 2. Backfill — assign each ownerless client to the creator of its
--    earliest document. Clients with no documents stay NULL (visible
--    only to technical roles until someone quotes them).
-- ---------------------------------------------------------------------
update clients c
   set created_by = sub.created_by
  from (
    select distinct on (d.client_id)
           d.client_id,
           d.created_by
      from documents d
     where d.client_id is not null
       and d.created_by is not null
     order by d.client_id, d.date asc
  ) sub
 where c.id = sub.client_id
   and c.created_by is null;

-- ---------------------------------------------------------------------
-- 3. RLS — enable + install the scoped policy set.
--    Done in a DO block so it works whether or not RLS was already on,
--    and wipes any pre-existing (permissive) policies first.
-- ---------------------------------------------------------------------
do $$
declare p record;
begin
  if not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'clients' and c.relrowsecurity
  ) then
    execute 'alter table clients enable row level security';
  end if;

  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'clients'
  loop
    execute format('drop policy if exists %I on clients', p.policyname);
  end loop;
end $$;

create policy "clients read scoped" on clients for select using (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
  or exists (
    select 1 from documents d
     where d.client_id = clients.id
       and d.created_by = auth.uid()
  )
);

create policy "clients insert scoped" on clients for insert
  with check (created_by = auth.uid());

create policy "clients update scoped" on clients for update using (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
);

create policy "clients delete scoped" on clients for delete using (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role = 'admin' or coalesce(r.super_admin, false))
  )
);

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- Column + backfill
--   select count(*) filter (where created_by is not null) as owned,
--          count(*) filter (where created_by is null)     as orphan
--     from clients;
--
--   -- As a Sales user: should only return THEIR own + quoted clients
--   select count(*) from clients;
--
--   -- As admin/super: full directory
--   select count(*) from clients;
-- ---------------------------------------------------------------------
