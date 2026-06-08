-- =====================================================================
-- Fix: widen `user_roles.role` CHECK constraint to include
-- 'task_list_manager'.
-- =====================================================================
--
-- The bug
-- -------
-- Assigning a user to "Task List Manager" failed with:
--
--   new row for relation "user_roles" violates check constraint
--   "user_roles_role_check"
--
-- Root cause: the original schema (`supabase/schema.sql`) defined:
--
--   role text check (role in ('admin','sales')) not null
--
-- Migration 012 introduced the `task_list_manager` role concept and
-- referenced it in many RLS policies, but it never widened the CHECK
-- constraint on user_roles.role. So:
--
--   • UI dropdown sends 'task_list_manager'         ✓
--   • Server action validates ASSIGNABLE_ROLES       ✓
--   • RPC admin_set_user_role validates the value    ✓
--   • DB INSERT INTO user_roles                      ✗  (CHECK rejects)
--
-- The role name is identical end-to-end — no naming inconsistency.
-- The DB constraint was simply out of date.
--
-- This migration recreates the constraint to accept all three storable
-- roles. `super_admin` remains a separate boolean column (added in
-- migration 016), not a role value — that pattern is intentional and
-- unchanged.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- Drop whatever the current constraint is (it may or may not be named
-- exactly `user_roles_role_check` depending on how it was created).
alter table user_roles
  drop constraint if exists user_roles_role_check;

-- Re-add with the full set of storable roles.
alter table user_roles
  add constraint user_roles_role_check
  check (role in ('admin', 'sales', 'task_list_manager'));

-- Tell PostgREST to reload its schema cache so the change is visible
-- immediately to the API without restarting Supabase.
notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Verification (run separately in the SQL editor if you want to check):
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.user_roles'::regclass
--     and contype  = 'c';
--
-- Expected output:
--   user_roles_role_check | CHECK (role = ANY (ARRAY[
--     'admin'::text, 'sales'::text, 'task_list_manager'::text]))
-- ---------------------------------------------------------------------
