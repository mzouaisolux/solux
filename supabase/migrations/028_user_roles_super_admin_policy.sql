-- =====================================================================
-- RLS — let super-admins manage user_roles for ANY user.
-- =====================================================================
--
-- Background
-- ----------
-- `user_roles` has restrictive policies by design: users can read their
-- own role, but writes are denied by default — otherwise any user
-- could update their own row and escalate to admin. That's correct.
--
-- But it means a super-admin trying to assign a role to another user
-- via /admin/users hits "new row violates row-level security policy"
-- — they're trying to write a row whose user_id != auth.uid().
--
-- Fix
-- ---
-- Add a single FOR ALL policy that grants super-admins write access to
-- the entire table. Non-super-admins are unaffected. The action layer
-- already gates by `admin.manage_users` capability, so this is a
-- second line of defense (RLS) that aligns with the app behavior.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- Drop-create lets us tweak the policy later without migration churn.
drop policy if exists "super_admin_manage_user_roles" on user_roles;

create policy "super_admin_manage_user_roles" on user_roles
  for all
  using (
    -- Caller can manage user_roles iff they themselves have
    -- super_admin = true in their row. The subquery hits a single
    -- indexed lookup on (user_id, super_admin) — cheap.
    exists (
      select 1 from user_roles ur_check
       where ur_check.user_id = auth.uid()
         and ur_check.super_admin = true
    )
  )
  with check (
    exists (
      select 1 from user_roles ur_check
       where ur_check.user_id = auth.uid()
         and ur_check.super_admin = true
    )
  );

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- Verification (run as your super-admin user):
--   -- Confirm the policy is attached
--   select policyname, cmd, qual::text from pg_policies
--    where tablename = 'user_roles';
--
--   -- Try the upsert that previously failed
--   insert into user_roles (user_id, role, super_admin)
--     values ('TARGET_USER_UUID', 'sales', false)
--     on conflict (user_id) do update set role = excluded.role;
-- =====================================================================
