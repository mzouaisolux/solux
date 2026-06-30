-- =====================================================================
-- m122 — Capabilities for admin master data + pricing (Phase 3 gov.)
-- =====================================================================
--
-- Brings 5 previously hardcoded-`requireAdmin` modules under the
-- permission matrix so a super-admin can DELEGATE them without code
-- (e.g. finance manages pricing/costs, ops manages products):
--   admin.manage_products / categories / banks / sales_conditions
--   pricing.manage          (price lists: create/publish/assign/…)
--   pricing.manage_costs    (RMB cost entry + cost CSV)
--
-- Behavior is reproduced EXACTLY: the code gate is
-- requireCapabilityOrAdmin() — admin & super_admin always pass (the old
-- requireAdmin floor), so nothing changes for them whether or not this
-- migration is applied. This seed additionally:
--   • marks the matrix true for super_admin + admin (clarity + nav),
--   • grants finance pricing.manage_costs (== old requireAdminOrFinance).
-- Other roles stay disabled (absent row = disabled); flip them in
-- /permissions when you want to delegate.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

insert into permissions (key, category, label, description, sort_order) values
  ('admin.manage_products',         'Admin',   'Manage products',          'Create, edit, delete products and product configuration.', 92),
  ('admin.manage_categories',       'Admin',   'Manage categories',        'Create, edit, delete product categories and families.', 93),
  ('admin.manage_banks',            'Admin',   'Manage bank accounts',     'Create, edit, delete company bank accounts.', 94),
  ('admin.manage_sales_conditions', 'Admin',   'Manage sales conditions',  'Create, edit, delete sales/payment conditions.', 95),
  ('pricing.manage',                'Pricing', 'Manage price lists',       'Create, publish, assign and archive price lists.', 100),
  ('pricing.manage_costs',          'Pricing', 'Manage costs',             'Enter RMB costs (versioned) and export the cost CSV.', 101)
on conflict (key) do nothing;

insert into role_permissions (role, permission_key, enabled) values
  -- super_admin (floor in code, marked here for the matrix + nav)
  ('super_admin', 'admin.manage_products',         true),
  ('super_admin', 'admin.manage_categories',       true),
  ('super_admin', 'admin.manage_banks',            true),
  ('super_admin', 'admin.manage_sales_conditions', true),
  ('super_admin', 'pricing.manage',                true),
  ('super_admin', 'pricing.manage_costs',          true),
  -- admin (floor in code, marked here too)
  ('admin', 'admin.manage_products',         true),
  ('admin', 'admin.manage_categories',       true),
  ('admin', 'admin.manage_banks',            true),
  ('admin', 'admin.manage_sales_conditions', true),
  ('admin', 'pricing.manage',                true),
  ('admin', 'pricing.manage_costs',          true),
  -- finance: cost entry (== old requireAdminOrFinance)
  ('finance', 'pricing.manage_costs', true)
on conflict (role, permission_key) do update set enabled = excluded.enabled;

insert into schema_migrations (filename, note)
values ('122_admin_pricing_capabilities.sql', 'capabilities for admin master data + pricing (governance: requireAdmin → matrix)')
on conflict (filename) do nothing;

commit;
