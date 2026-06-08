-- =====================================================================
-- m053 — Forecast capability + operations-role matrix backfill.
-- =====================================================================
--
-- Two permission-matrix corrections, both honoring the "matrix must
-- stay synchronized with capabilities" rule.
--
-- 1. NEW CAPABILITY: forecast.view_global
--    Controls who sees the COMPANY-WIDE forecast (weighted pipeline,
--    commit, by-rep / country / family) vs. only their own deals.
--    Replaces the hardcoded role checks on the /forecast page and the
--    dashboard ManagementForecastPanel with a matrix-managed gate.
--    Default: super_admin + admin = true, everyone else = false
--    (management sees global; sales sees their own). Super-admin can
--    flip it for TLM / operations in /admin/permissions.
--
-- 2. BACKFILL: the 'operations' role (added in m042) was never seeded
--    into role_permissions, so operations users got ZERO capabilities
--    from the matrix — a real, pre-existing inconsistency. m046 treats
--    operations identically to task_list_manager operationally, so we
--    mirror TLM's matrix into operations for every existing capability.
--    `on conflict do nothing` means we never clobber a value an admin
--    already set by hand.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. forecast.view_global capability
-- ---------------------------------------------------------------------
insert into permissions (key, category, label, description, sort_order) values
  (
    'forecast.view_global',
    'Forecast',
    'View company-wide forecast',
    'See the global weighted pipeline, commit, and by-rep / country / family breakdowns. Without it, the user sees only their own forecast.',
    40
  )
on conflict (key) do nothing;

insert into role_permissions (role, permission_key, enabled) values
  ('super_admin',       'forecast.view_global', true),
  ('admin',             'forecast.view_global', true),
  ('task_list_manager', 'forecast.view_global', false),
  ('operations',        'forecast.view_global', false),
  ('sales',             'forecast.view_global', false)
on conflict (role, permission_key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Backfill the 'operations' role to mirror 'task_list_manager'
--    across every capability currently in the matrix.
-- ---------------------------------------------------------------------
insert into role_permissions (role, permission_key, enabled)
  select 'operations', rp.permission_key, rp.enabled
    from role_permissions rp
   where rp.role = 'task_list_manager'
on conflict (role, permission_key) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- forecast.view_global enabled for management only
--   select role, enabled from role_permissions
--    where permission_key = 'forecast.view_global' order by role;
--   -- Expected: admin=t, super_admin=t, others=f
--
--   -- operations now has the same enabled set as task_list_manager
--   select
--     (select count(*) from role_permissions
--       where role='operations' and enabled) as ops_enabled,
--     (select count(*) from role_permissions
--       where role='task_list_manager' and enabled) as tlm_enabled;
--   -- Expected: equal counts
-- ---------------------------------------------------------------------
