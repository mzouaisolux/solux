-- =====================================================================
-- m066 — Assignable sales owner (account manager / deal owner).
-- =====================================================================
--
-- Until now "who owns this?" was inferred from `created_by` — which is
-- whoever first created the record. That breaks team management: a TLM /
-- admin needs to ATTRIBUTE a client (account) or a quotation (deal) to a
-- salesperson regardless of who keyed it in, and reassign when a deal
-- changes hands.
--
-- This adds an explicit, nullable `sales_owner_id` to clients + documents.
-- Resolution everywhere is `sales_owner_id ?? created_by`, so existing
-- data keeps showing its creator until a manager assigns an owner.
--
-- Also adds `list_assignable_owners()` — a SECURITY DEFINER directory of
-- users (id, display name, role) for the owner pickers, callable by
-- MANAGEMENT roles (admin / super / TLM / operations). Normal `user_roles`
-- RLS only lets a user read their own row, so we need this to populate the
-- dropdown for a TLM.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table clients
  add column if not exists sales_owner_id uuid references auth.users(id) on delete set null;
alter table documents
  add column if not exists sales_owner_id uuid references auth.users(id) on delete set null;

create index if not exists clients_sales_owner_idx on clients(sales_owner_id);
create index if not exists documents_sales_owner_idx on documents(sales_owner_id);

-- Management directory for the owner pickers.
create or replace function list_assignable_owners()
returns table (user_id uuid, display_name text, role text, email text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  ) then
    raise exception 'list_assignable_owners: management roles only';
  end if;

  return query
    select
      ur.user_id,
      up.display_name,
      ur.role::text                       as role,
      (au.email)::text                     as email
    from user_roles ur
    left join user_profiles up on up.user_id = ur.user_id
    left join auth.users au on au.id = ur.user_id
    order by coalesce(up.display_name, au.email, ur.user_id::text);
end $$;

revoke all on function list_assignable_owners() from public, anon;
grant execute on function list_assignable_owners() to authenticated;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select count(*) from information_schema.columns
--    where table_name='clients' and column_name='sales_owner_id';   -- 1
--   select count(*) from information_schema.columns
--    where table_name='documents' and column_name='sales_owner_id'; -- 1
--   select * from list_assignable_owners();  -- rows for a management user
-- ---------------------------------------------------------------------
