-- =====================================================================
-- m047 — list_sales_for_filter() RPC for the operational sales filter.
-- =====================================================================
--
-- Background
-- ----------
-- Once Operations / TLM / admin manage many sales reps, the dashboard
-- + operational feed become a giant mixed stream. The new "Sales
-- filter bar" lets technical roles narrow every operational surface
-- to a single sales user ("view as data of Mehdi") — pure UX overlay,
-- no permission change (technical roles still have RLS access to
-- everything; the filter is a client-side affordance).
--
-- To render the bar with readable labels, we need a list of sales
-- users along with their email. PostgREST doesn't expose auth.users
-- directly (and shouldn't), so we wrap the lookup in a SECURITY
-- DEFINER RPC gated to technical roles only.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

drop function if exists list_sales_for_filter();

create or replace function list_sales_for_filter()
returns table (
  out_user_id uuid,
  out_email   text,
  out_role    text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller_role text;
  caller_is_super boolean;
begin
  -- Gate: only technical roles (admin / TLM / operations) + super-admin
  -- can list sales users for filtering. Sales themselves never see this
  -- bar (the UI hides it for non-technical roles too).
  select role, coalesce(super_admin, false)
    into caller_role, caller_is_super
    from user_roles
   where user_id = auth.uid()
   limit 1;

  if not (
    coalesce(caller_is_super, false)
    or caller_role in ('admin', 'task_list_manager', 'operations')
  ) then
    raise exception 'list_sales_for_filter: technical roles only'
      using errcode = '42501';
  end if;

  return query
    select
      ur.user_id,
      u.email::text,
      ur.role
      from user_roles ur
      join auth.users u on u.id = ur.user_id
     where ur.role = 'sales'
     order by u.email asc nulls last;
end;
$$;

revoke all on function list_sales_for_filter() from public, anon;
grant execute on function list_sales_for_filter() to authenticated;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- 1. As a technical role (admin / TLM / ops / super):
--   select * from list_sales_for_filter();
--   -- Expected: rows for every sales user, with email + role='sales'
--
--   -- 2. As a sales user:
--   select * from list_sales_for_filter();
--   -- Expected: ERROR — technical roles only
-- ---------------------------------------------------------------------
