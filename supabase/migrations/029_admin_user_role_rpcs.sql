-- =====================================================================
-- Admin user-role RPCs (SECURITY DEFINER) — alternative to RLS policy.
-- =====================================================================
--
-- Background
-- ----------
-- Migration 028 tried to add an RLS policy letting super-admins write
-- any row in user_roles. That worked but the interaction with the
-- existing read-own-row policy made things subtle, and the user lost
-- access at one point. We're abandoning the RLS-policy approach.
--
-- This migration replaces it with two SECURITY DEFINER functions that:
--   1. Verify the caller is a super-admin at SQL level (single-source
--      check, can't be bypassed from the app).
--   2. Bypass RLS for the actual write (because security definer
--      runs as the function owner, typically postgres).
--
-- The app's /admin/users actions call these RPCs instead of doing
-- direct upserts. The result is the same write behavior, but with
-- centralized authorization and no need for write policies on
-- user_roles itself.
--
-- We also DROP the policy from migration 028 to clean up — even if
-- the user already dropped it manually, this is idempotent.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---- 1. Clean up any leftover policy from migration 028 ----
drop policy if exists "super_admin_manage_user_roles" on user_roles;

-- ---- 2. RPC: set a user's role ----
drop function if exists admin_set_user_role(uuid, text);

create or replace function admin_set_user_role(
  target_user_id uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_super boolean;
begin
  -- Verify caller is a super-admin. Use a separate variable so the
  -- error message is clean and we don't leak the auth.uid() value.
  select super_admin into caller_is_super
    from user_roles
   where user_id = auth.uid()
   limit 1;

  if coalesce(caller_is_super, false) is not true then
    raise exception 'admin_set_user_role: super-admin only';
  end if;

  -- Sanity check the role value. Must match the CHECK constraint on
  -- user_roles.role, which allows ONLY the 3 storable roles. The
  -- "super_admin" concept is a separate boolean flag, never a value
  -- of the role column. Use admin_toggle_super_admin for the flag.
  if new_role not in ('admin', 'sales', 'task_list_manager') then
    raise exception 'admin_set_user_role: invalid role % (allowed: admin, sales, task_list_manager)', new_role;
  end if;

  -- Self-protection — refuse to let a super-admin demote themselves
  -- to a non-admin via this RPC. (The app action also refuses self-
  -- edits, but defense in depth.)
  if target_user_id = auth.uid() then
    raise exception 'admin_set_user_role: cannot change your own role via this RPC';
  end if;

  -- Upsert. SECURITY DEFINER bypasses RLS on user_roles.
  insert into user_roles (user_id, role)
  values (target_user_id, new_role)
  on conflict (user_id) do update
    set role = excluded.role;
end;
$$;

revoke all on function admin_set_user_role(uuid, text) from public, anon;
grant execute on function admin_set_user_role(uuid, text) to authenticated;

-- ---- 3. RPC: toggle super_admin flag on a user ----
drop function if exists admin_toggle_super_admin(uuid, boolean);

create or replace function admin_toggle_super_admin(
  target_user_id uuid,
  enable boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_super boolean;
  current_super boolean;
  current_role text;
  super_count integer;
begin
  -- Verify caller is a super-admin
  select super_admin into caller_is_super
    from user_roles
   where user_id = auth.uid()
   limit 1;

  if coalesce(caller_is_super, false) is not true then
    raise exception 'admin_toggle_super_admin: super-admin only';
  end if;

  -- Self-protection
  if target_user_id = auth.uid() then
    raise exception 'admin_toggle_super_admin: cannot change your own super-admin flag';
  end if;

  -- Last-super-admin guard — refuse to disable the last one.
  if enable is false then
    select count(*) into super_count
      from user_roles
     where super_admin = true;
    if super_count <= 1 then
      raise exception 'admin_toggle_super_admin: cannot remove the last super-admin';
    end if;
  end if;

  -- Load current state for the target.
  select role, super_admin
    into current_role, current_super
    from user_roles
   where user_id = target_user_id
   limit 1;

  if current_role is null then
    -- No row yet. Only insert when enabling — disabling is a no-op.
    if enable is true then
      insert into user_roles (user_id, role, super_admin)
      values (target_user_id, 'admin', true);
    end if;
  else
    -- Existing row — just flip the flag, preserve role.
    update user_roles
       set super_admin = enable
     where user_id = target_user_id;
  end if;
end;
$$;

revoke all on function admin_toggle_super_admin(uuid, boolean) from public, anon;
grant execute on function admin_toggle_super_admin(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- Verification
-- =====================================================================
--   -- The two RPCs should exist:
--   select proname from pg_proc
--    where proname in ('admin_set_user_role', 'admin_toggle_super_admin');
--
--   -- Calling them as a non-super-admin should raise the explicit error:
--   --   select admin_set_user_role('00000000-...', 'sales');
--   -- → ERROR: admin_set_user_role: super-admin only
--
--   -- The leftover policy from migration 028 should be gone:
--   select policyname from pg_policies
--    where tablename = 'user_roles';
-- =====================================================================
