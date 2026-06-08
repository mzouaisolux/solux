-- =====================================================================
-- /admin/users data source — list ALL auth.users + their assigned roles.
-- =====================================================================
--
-- Why an RPC and not a plain SELECT?
--   `auth.users` lives in the `auth` schema, which PostgREST doesn't
--   expose to anon/authenticated by default (and shouldn't — emails are
--   PII). To safely surface "list of all users + their role" to a
--   super-admin admin UI, we expose this via a security-definer RPC
--   that:
--     1. Verifies the caller is a super-admin (auth.uid() lookup in
--        user_roles).
--     2. Joins auth.users LEFT JOIN user_roles so users without a role
--        assignment yet still appear (they show as role = NULL — the
--        admin can then assign one via /admin/users).
--
-- The function runs with the owner's privileges (typically postgres)
-- so it CAN read auth.users. The internal super-admin check ensures
-- only super-admins can call it — even if PostgREST exposed it more
-- broadly.
--
-- Idempotent. Run in Supabase SQL Editor.
-- =====================================================================

begin;

-- DROP first because CREATE OR REPLACE can't change the return type
-- of an existing function. An earlier draft of this migration shipped
-- with different column names (user_id / super_admin) that caused SQL
-- ambiguity; the fixed version uses out_* aliases. Without this DROP,
-- re-running the migration fails with error 42P13.
drop function if exists list_users_with_roles();

create or replace function list_users_with_roles()
returns table (
  out_user_id    uuid,
  out_email      text,
  out_role       text,
  out_super_admin boolean,
  out_user_created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Belt-and-suspenders: even though the /admin/users page already
  -- gates by capability, refuse non-super-admins at SQL level so this
  -- RPC can't be misused via direct REST call.
  --
  -- Note on the `out_*` column prefix: PostgreSQL puts the RETURNS
  -- TABLE columns in scope inside the function body. Without a prefix
  -- they collide with the actual user_roles.user_id / .super_admin
  -- columns and trigger "column reference is ambiguous". The prefix
  -- keeps the function compiling cleanly while still presenting the
  -- intuitive names to PostgREST consumers (Supabase exposes columns
  -- by their alias in the return spec).
  if not exists (
    select 1 from public.user_roles ur_check
     where ur_check.user_id = auth.uid()
       and ur_check.super_admin = true
  ) then
    raise exception 'list_users_with_roles: super-admin only';
  end if;

  return query
  select
    u.id                              as out_user_id,
    u.email::text                     as out_email,
    ur.role::text                     as out_role,
    coalesce(ur.super_admin, false)   as out_super_admin,
    u.created_at                      as out_user_created_at
  from auth.users u
  left join public.user_roles ur on ur.user_id = u.id
  order by u.created_at desc;
end;
$$;

-- Tighten grants — only authenticated users can attempt to call it.
-- The function itself rejects non-super-admins, so this is just
-- defense in depth.
revoke all on function list_users_with_roles() from public, anon;
grant execute on function list_users_with_roles() to authenticated;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- Verification (run separately as your super-admin user):
--   select * from list_users_with_roles();
-- =====================================================================
