-- =====================================================================
-- m064 — Factory Mapping access capability.
-- =====================================================================
--
-- The Factory Mapping tool (per-option factory instructions) used to be
-- reachable only under /admin/* — so a Task List Manager who clicked
-- "Configure mapping" from a task list was bounced to /dashboard by the
-- admin layout gate, even though the page itself already allowed
-- technical roles. The tool now lives at its own route (/factory-mapping)
-- gated by THIS capability, so access is matrix-controlled instead of
-- hard-coded to "admin only".
--
-- Default grants:
--   super_admin / admin / task_list_manager / operations = true
--   sales = false
-- (The TLM owns factory mapping; ops mirrors TLM per m046; sales never
--  touches production mapping.)
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

insert into permissions (key, category, label, description, sort_order) values
  (
    'factory_mapping.access',
    'Task list',
    'Access Factory Mapping',
    'Open and edit the Factory Mapping tool (per-option factory instructions used to resolve production task lists).',
    35
  )
on conflict (key) do nothing;

insert into role_permissions (role, permission_key, enabled) values
  ('super_admin',       'factory_mapping.access', true),
  ('admin',             'factory_mapping.access', true),
  ('task_list_manager', 'factory_mapping.access', true),
  ('operations',        'factory_mapping.access', true),
  ('sales',             'factory_mapping.access', false)
on conflict (role, permission_key) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select role, enabled from role_permissions
--    where permission_key = 'factory_mapping.access' order by role;
--   -- Expected: super_admin/admin/task_list_manager/operations = t, sales = f
-- ---------------------------------------------------------------------
