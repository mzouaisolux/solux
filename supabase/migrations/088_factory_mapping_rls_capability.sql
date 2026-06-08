-- =====================================================================
-- m088 — Factory Mapping WRITE policy becomes capability/matrix-driven.
-- =====================================================================
--
-- BEFORE (m014): the write policy hard-coded the allowed roles:
--   role in ('admin', 'task_list_manager')
-- Two problems this caused:
--   1. `operations` is granted `factory_mapping.access = true` in the
--      matrix (m064) and passes every app-level gate, but its WRITES were
--      silently blocked at the DB layer — capability said yes, RLS said no.
--   2. Unchecking `factory_mapping.access` for a role in /permissions had
--      NO effect on the DB layer — the toggle was cosmetic for direct API
--      access. RLS ignored the matrix entirely.
--
-- AFTER: the write policy consults the SAME `role_permissions` matrix the
-- app reads. A user may write factory mappings iff their role (or the
-- virtual super_admin) has `factory_mapping.access` enabled. Now the
-- /permissions toggle is honored at every layer:
--   menu (nav registry) → page (hasUiCapability) → action (requireCapability)
--   → DB (this policy).
--
-- The READ policy is unchanged: any authenticated user may SELECT mappings
-- (the task-list resolver needs to read them for everyone). Only writes are
-- gated. Multiple permissive policies are OR'd, so the broad read policy
-- still applies for SELECT.
--
-- super_admin mapping: `user_roles.super_admin = true` users keep
-- `user_roles.role = 'admin'` (the CHECK constraint forbids storing
-- 'super_admin'), but the matrix has a distinct 'super_admin' row. The
-- CASE below maps such users to that row so their grant is read correctly.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

drop policy if exists "write factory mappings" on factory_mappings;
create policy "write factory mappings" on factory_mappings for all
  using (
    exists (
      select 1
      from user_roles ur
      join role_permissions rp
        on rp.permission_key = 'factory_mapping.access'
       and rp.enabled = true
       and rp.role = (case when ur.super_admin then 'super_admin' else ur.role end)
      where ur.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from user_roles ur
      join role_permissions rp
        on rp.permission_key = 'factory_mapping.access'
       and rp.enabled = true
       and rp.role = (case when ur.super_admin then 'super_admin' else ur.role end)
      where ur.user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, as each role's user):
--   -- super_admin / admin / task_list_manager / operations: write OK
--   -- sales: write blocked (factory_mapping.access = false)
--   insert into factory_mappings (field_id, option_id, factory_instruction)
--     values ('<field-uuid>', '<option-uuid>', 'test');
--
--   -- Toggle test: uncheck factory_mapping.access for task_list_manager in
--   -- /permissions, then a TLM INSERT should start failing immediately.
-- ---------------------------------------------------------------------
