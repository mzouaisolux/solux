-- =====================================================================
-- New capability: `admin.diagnostics` for the super-admin debug page.
-- =====================================================================
--
-- /admin/diagnostics exposes health counters, lifecycle drift checks,
-- and the "why is this entity in this state?" inspector. It can read
-- across role-scoped tables (via SECURITY DEFINER RPCs in migration 034)
-- so it must be gated tightly.
--
-- Per agreed scope (étape 5 cadrage): SUPER-ADMIN ONLY.
--   - super_admin → true
--   - admin       → false
--   - TLM         → false
--   - sales       → false
--
-- The matrix is later editable from /admin/permissions like every other
-- capability, but the seed defaults to the safest config. The category
-- "Admin" groups it with manage_permissions / manage_users.
--
-- Important
-- ---------
-- The catalog table is `permissions` (from migration 026), NOT
-- `capabilities` — and its PK column is `key` referenced as
-- `permission_key` in the matrix. Don't get tripped up by the fact
-- that throughout the app we call them "capabilities" — that's the
-- naming in TypeScript; in SQL the table is `permissions` because the
-- original migration 026 picked that name.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- Catalog row — ON CONFLICT DO UPDATE so re-running keeps the label
-- and description fresh if we tweak them here.
insert into permissions (key, category, label, description, sort_order)
values (
  'admin.diagnostics',
  'Admin',
  'Access diagnostics page',
  'View the super-admin diagnostics page (health counters, lifecycle drift, entity inspector).',
  92
)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

-- Matrix seed — super-admin only.
insert into role_permissions (role, permission_key, enabled) values
  ('super_admin',       'admin.diagnostics', true),
  ('admin',             'admin.diagnostics', false),
  ('task_list_manager', 'admin.diagnostics', false),
  ('sales',             'admin.diagnostics', false)
on conflict (role, permission_key) do nothing;
-- `do nothing` (not update) so an admin who later toggles this in the
-- /admin/permissions UI keeps their preference across re-runs of this
-- migration.

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select role, enabled from role_permissions where permission_key = 'admin.diagnostics';
--   -- Expected: 4 rows, super_admin=true, the other 3 = false.
-- ---------------------------------------------------------------------
