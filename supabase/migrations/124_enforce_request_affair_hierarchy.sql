-- =====================================================================
-- m124 — Enforce the Client → Affaire → Project Request hierarchy.
-- =====================================================================
--
-- Owner decision (2026-06-17, CRM UX refactor): a project_request must
-- NEVER exist without an affaire. m100 added project_requests.affair_id
-- as NULLABLE with NO backfill ("the rule applies to NEW requests only,
-- and is not enforced yet"). This migration closes that gap and makes the
-- rule real:
--
--   clients → affairs → project_requests → documents/orders
--                        ^ exactly ONE affaire per request (NOT NULL)
--                        ^ one affaire may own MANY requests
--
-- Three steps, ONE transaction:
--   1. BACKFILL — for every orphan request (affair_id IS NULL), create
--      ONE affaire and link it (mirrors the app's "Workflow B"):
--        - name   = 'New Opportunity - <client name>'   (renameable later)
--        - owner  = the request's owner (fallback: its creator)
--        - status = 'lead'   (same default as createAffair / m077)
--        - source = 'tender' when the request came from a tender,
--                   else left NULL (untagged). This migration deliberately
--                   does NOT touch affairs_source_check: the source-
--                   vocabulary overhaul (Direct Request / Prospecting / …)
--                   is a SEPARATE migration paired with the UI change, so
--                   that DB constraint and app code flip together.
--   2. FK — affair_id was ON DELETE SET NULL (m100), which is incompatible
--      with NOT NULL. Recreate it ON DELETE RESTRICT so an affaire that
--      still owns requests cannot be deleted out from under them (matches
--      the app's no-destructive-delete posture — affairs are archived /
--      marked lost, not hard-deleted; see app/(app)/affairs/actions.ts).
--      >>> For the opposite policy (deleting an affaire deletes its
--          requests), change 'on delete restrict' to 'on delete cascade'
--          on the marked line below. <<<
--   3. NOT NULL — enforce it. SET NOT NULL fails if any orphan remains,
--      so it can only succeed after step 1 — a built-in safety interlock.
--      (Brief ACCESS EXCLUSIVE lock; trivial at this row count.)
--
-- Idempotent & safe to re-run: step 1 only touches affair_id IS NULL rows;
-- steps 2/3 are no-ops once applied. Apply MANUALLY in Supabase AFTER A
-- BACKUP / SNAPSHOT. Run the PRE-FLIGHT block (bottom) FIRST to see how
-- many affaires will be created.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Backfill: one affaire per orphan request, then link them.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  new_affair uuid;
begin
  for r in
    select pr.id,
           pr.client_id,
           pr.owner_id,
           pr.created_by,
           pr.source_tender_id,
           coalesce(c.company_name, 'Unknown client') as client_name
      from project_requests pr
      left join clients c on c.id = pr.client_id
     where pr.affair_id is null
  loop
    insert into affairs (client_id, name, status, owner_id, source, created_by)
    values (
      r.client_id,
      'New Opportunity - ' || r.client_name,
      'lead',
      coalesce(r.owner_id, r.created_by),
      case when r.source_tender_id is not null then 'tender' else null end,
      r.created_by
    )
    returning id into new_affair;

    update project_requests set affair_id = new_affair where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) Replace the ON DELETE SET NULL FK (m100) with ON DELETE RESTRICT.
--    Name-agnostic drop (the m100 constraint is auto-named).
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class t     on t.oid = con.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'project_requests'
       and con.contype = 'f'
       and pg_get_constraintdef(con.oid) ilike '%affairs(id)%'
  loop
    execute format('alter table project_requests drop constraint %I', c.conname);
  end loop;
end $$;

alter table project_requests
  add constraint project_requests_affair_id_fkey
  foreign key (affair_id) references affairs(id)
  on delete restrict;          -- <<< change to: on delete cascade  (see header)

-- ---------------------------------------------------------------------
-- 3) Enforce the rule. Fails loudly if any orphan slipped through step 1.
-- ---------------------------------------------------------------------
alter table project_requests
  alter column affair_id set not null;

-- keep the lookup index from m100 (no-op if already present)
create index if not exists idx_project_requests_affair
  on project_requests(affair_id);

-- ---------------------------------------------------------------------
-- Record this migration in the ledger (m113 convention).
-- ---------------------------------------------------------------------
insert into schema_migrations (filename, note)
values ('124_enforce_request_affair_hierarchy.sql',
        'project_requests.affair_id backfilled + NOT NULL + FK ON DELETE RESTRICT')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- PRE-FLIGHT  (run SEPARATELY, BEFORE the transaction above):
--
--   -- how many affaires will be created?
--   select count(*) as orphan_requests
--     from project_requests where affair_id is null;
--
--   -- breakdown
--   select
--     count(*) filter (where client_id is not null)        as with_client,
--     count(*) filter (where client_id is null)            as without_client,
--     count(*) filter (where source_tender_id is not null) as tender_sourced
--     from project_requests where affair_id is null;
--
-- POST-CHECK  (run AFTER):
--   select count(*) as still_orphan
--     from project_requests where affair_id is null;            -- expect 0
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'project_requests'::regclass and contype = 'f';
--   select * from schema_migrations where filename like '124!_%' escape '!';
--
-- ROLLBACK  (undoes the SCHEMA only; the backfilled affaires are real
-- rows — restore them from your pre-migration backup if you must undo):
--   begin;
--   alter table project_requests alter column affair_id drop not null;
--   alter table project_requests drop constraint project_requests_affair_id_fkey;
--   alter table project_requests
--     add constraint project_requests_affair_id_fkey
--     foreign key (affair_id) references affairs(id) on delete set null;
--   commit;
-- ---------------------------------------------------------------------
