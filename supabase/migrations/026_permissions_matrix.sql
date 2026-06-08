-- =====================================================================
-- Capabilities matrix — Étape 3 sub-step A (DB only).
-- =====================================================================
--
-- Replaces hardcoded role checks (requireAdmin, requireTaskListManager)
-- with a configurable role × capability matrix. Super-admin can toggle
-- capabilities through a UI later (sub-step 3.C) without touching
-- code. Backend keeps full control: every server action will still
-- call requireCapability() so the gate is enforced server-side.
--
-- Architectural decisions confirmed by user:
--   D.1  App-level only — RLS policies unchanged.
--   D.2  In-memory cache 30s — accepts up to 30s lag after matrix edit.
--   D.3  Current granularity — 19 capabilities. Keep simple.
--   D.4  Step-by-step — this migration is the DB layer only.
--
-- After this migration the app behaves IDENTICALLY to before — nothing
-- reads these tables yet. Sub-step 3.B refactors the server actions
-- to read them; sub-step 3.C adds the admin UI.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. permissions — capability catalog
-- ---------------------------------------------------------------------
create table if not exists permissions (
  key         text primary key,
  category    text not null,
  label       text not null,
  description text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. role_permissions — the matrix itself.
--    (role, permission_key) is the natural PK. enabled is the toggle.
-- ---------------------------------------------------------------------
create table if not exists role_permissions (
  role            text not null,
  permission_key  text not null references permissions(key) on delete cascade,
  enabled         boolean not null default false,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  primary key (role, permission_key)
);

create index if not exists idx_role_permissions_role_enabled
  on role_permissions (role) where enabled = true;

-- ---------------------------------------------------------------------
-- 3. RLS
--    Read: any authenticated user — hasCapability() needs to read the
--          matrix from inside any server action. No PII here, just
--          a (role, capability, bool) tuple, so wide read is fine.
--    Write: super-admin only — only people with user_roles.super_admin
--          = true can toggle the matrix. Enforced both by RLS and by
--          the UI's requireCapability("admin.manage_permissions") check.
-- ---------------------------------------------------------------------
alter table permissions enable row level security;
alter table role_permissions enable row level security;

drop policy if exists "permissions_read" on permissions;
create policy "permissions_read" on permissions for select
  using (auth.role() = 'authenticated');

drop policy if exists "permissions_write" on permissions;
create policy "permissions_write" on permissions for all
  using (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and r.super_admin = true
    )
  )
  with check (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and r.super_admin = true
    )
  );

drop policy if exists "role_permissions_read" on role_permissions;
create policy "role_permissions_read" on role_permissions for select
  using (auth.role() = 'authenticated');

drop policy if exists "role_permissions_write" on role_permissions;
create policy "role_permissions_write" on role_permissions for all
  using (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and r.super_admin = true
    )
  )
  with check (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and r.super_admin = true
    )
  );

-- ---------------------------------------------------------------------
-- 4. Seed — capability catalog (19 entries).
-- ---------------------------------------------------------------------
insert into permissions (key, category, label, description, sort_order) values
  ('quotation.create',                       'Quotation',        'Create quotation',                'Create new sales quotations.', 10),
  ('quotation.cancel',                       'Quotation',        'Cancel quotation',                'Mark a quotation as cancelled. Cascades to task list and production order via DB trigger.', 11),
  ('quotation.archive',                      'Quotation',        'Archive quotation',               'Hide a quotation from default views without deleting. Reversible.', 12),
  ('quotation.delete',                       'Quotation',        'Delete quotation (permanent)',    'Physically delete a quotation. Reserved for RGPD / cleanup.', 13),
  ('task_list.validate',                     'Task list',        'Validate task list',              'Move a task list from under_validation to validated.', 20),
  ('task_list.reject',                       'Task list',        'Reject task list',                'Cancel a task list (operationally dead).', 21),
  ('task_list.archive',                      'Task list',        'Archive task list',               'Hide a task list from default views. Reversible.', 22),
  ('task_list.delete',                       'Task list',        'Delete task list (permanent)',    'Physically delete a task list. Reserved.', 23),
  ('task_list.sync_orphans',                 'Task list',        'Sync orphan task lists',          'Create missing production orders for validated task lists without one.', 24),
  ('production_order.edit_status',           'Production order', 'Edit status',                     'Change a production order''s operational status.', 30),
  ('production_order.edit_deadline',         'Production order', 'Edit deadline',                   'Change a production order''s current deadline. Initial deadline stays immutable.', 31),
  ('production_order.edit_payments',         'Production order', 'Record payments',                 'Record deposit / balance receipts on a production order.', 32),
  ('production_order.edit_shipment',         'Production order', 'Edit shipment',                   'Update shipment booking, ETD, ETA, shipping notes.', 33),
  ('production_order.set_timeline',          'Production order', 'Set production timeline',         'Set production working days and compute the initial deadline.', 34),
  ('production_order.start_without_deposit', 'Production order', 'Start without deposit (override)','Launch production before the deposit is received. Trusted-client exception.', 35),
  ('production_order.archive',               'Production order', 'Archive production order',        'Hide a production order from default views. Reversible.', 36),
  ('production_order.delete',                'Production order', 'Delete production order (permanent)','Physically delete a production order. Reserved.', 37),
  ('admin.manage_permissions',               'Admin',            'Manage permissions matrix',       'Edit the role × capability matrix.', 90),
  ('admin.manage_users',                     'Admin',            'Manage users',                    'Assign or change user roles.', 91)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 5. Seed — role × capability matrix (4 roles × 19 capabilities = 76 rows).
--
--    Reproduces EXACTLY the current hardcoded behavior so sub-step 3.B
--    can swap in requireCapability() without changing any user-visible
--    permission. Super-admins get everything; admins lose just delete
--    and admin.manage_*; TLM loses cancel/archive/delete/override/admin;
--    sales gets only create + cancel quotation.
-- ---------------------------------------------------------------------
insert into role_permissions (role, permission_key, enabled) values
  -- ============ super_admin (19 / 19) ============
  ('super_admin', 'quotation.create',                       true),
  ('super_admin', 'quotation.cancel',                       true),
  ('super_admin', 'quotation.archive',                      true),
  ('super_admin', 'quotation.delete',                       true),
  ('super_admin', 'task_list.validate',                     true),
  ('super_admin', 'task_list.reject',                       true),
  ('super_admin', 'task_list.archive',                      true),
  ('super_admin', 'task_list.delete',                       true),
  ('super_admin', 'task_list.sync_orphans',                 true),
  ('super_admin', 'production_order.edit_status',           true),
  ('super_admin', 'production_order.edit_deadline',         true),
  ('super_admin', 'production_order.edit_payments',         true),
  ('super_admin', 'production_order.edit_shipment',         true),
  ('super_admin', 'production_order.set_timeline',          true),
  ('super_admin', 'production_order.start_without_deposit', true),
  ('super_admin', 'production_order.archive',               true),
  ('super_admin', 'production_order.delete',                true),
  ('super_admin', 'admin.manage_permissions',               true),
  ('super_admin', 'admin.manage_users',                     true),

  -- ============ admin (14 / 19) — no permanent deletes, no admin.manage_* ============
  ('admin', 'quotation.create',                       true),
  ('admin', 'quotation.cancel',                       true),
  ('admin', 'quotation.archive',                      true),
  ('admin', 'quotation.delete',                       false),
  ('admin', 'task_list.validate',                     true),
  ('admin', 'task_list.reject',                       true),
  ('admin', 'task_list.archive',                      true),
  ('admin', 'task_list.delete',                       false),
  ('admin', 'task_list.sync_orphans',                 true),
  ('admin', 'production_order.edit_status',           true),
  ('admin', 'production_order.edit_deadline',         true),
  ('admin', 'production_order.edit_payments',         true),
  ('admin', 'production_order.edit_shipment',         true),
  ('admin', 'production_order.set_timeline',          true),
  ('admin', 'production_order.start_without_deposit', true),
  ('admin', 'production_order.archive',               true),
  ('admin', 'production_order.delete',                false),
  ('admin', 'admin.manage_permissions',               false),
  ('admin', 'admin.manage_users',                     false),

  -- ============ task_list_manager (10 / 19) — production work, no archive/override/admin ============
  ('task_list_manager', 'quotation.create',                       true),
  ('task_list_manager', 'quotation.cancel',                       true),
  ('task_list_manager', 'quotation.archive',                      false),
  ('task_list_manager', 'quotation.delete',                       false),
  ('task_list_manager', 'task_list.validate',                     true),
  ('task_list_manager', 'task_list.reject',                       true),
  ('task_list_manager', 'task_list.archive',                      false),
  ('task_list_manager', 'task_list.delete',                       false),
  ('task_list_manager', 'task_list.sync_orphans',                 true),
  ('task_list_manager', 'production_order.edit_status',           true),
  ('task_list_manager', 'production_order.edit_deadline',         true),
  ('task_list_manager', 'production_order.edit_payments',         true),
  ('task_list_manager', 'production_order.edit_shipment',         true),
  ('task_list_manager', 'production_order.set_timeline',          true),
  ('task_list_manager', 'production_order.start_without_deposit', false),
  ('task_list_manager', 'production_order.archive',               false),
  ('task_list_manager', 'production_order.delete',                false),
  ('task_list_manager', 'admin.manage_permissions',               false),
  ('task_list_manager', 'admin.manage_users',                     false),

  -- ============ sales (2 / 19) — create + cancel own quotations only ============
  ('sales', 'quotation.create',                       true),
  ('sales', 'quotation.cancel',                       true),
  ('sales', 'quotation.archive',                      false),
  ('sales', 'quotation.delete',                       false),
  ('sales', 'task_list.validate',                     false),
  ('sales', 'task_list.reject',                       false),
  ('sales', 'task_list.archive',                      false),
  ('sales', 'task_list.delete',                       false),
  ('sales', 'task_list.sync_orphans',                 false),
  ('sales', 'production_order.edit_status',           false),
  ('sales', 'production_order.edit_deadline',         false),
  ('sales', 'production_order.edit_payments',         false),
  ('sales', 'production_order.edit_shipment',         false),
  ('sales', 'production_order.set_timeline',          false),
  ('sales', 'production_order.start_without_deposit', false),
  ('sales', 'production_order.archive',               false),
  ('sales', 'production_order.delete',                false),
  ('sales', 'admin.manage_permissions',               false),
  ('sales', 'admin.manage_users',                     false)
on conflict (role, permission_key) do nothing;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- Verification queries (run separately AFTER the migration):
-- =====================================================================
--
--   -- 19 capabilities catalogued
--   select count(*) from permissions;
--
--   -- 76 rows in the matrix (4 roles × 19 capabilities)
--   select count(*) from role_permissions;
--
--   -- Enabled count per role (compares to the hardcoded matrix)
--   select role, count(*) filter (where enabled = true) as enabled_count
--     from role_permissions
--    group by role
--    order by enabled_count desc;
--   -- Expected:
--   --   super_admin       19
--   --   admin             14
--   --   task_list_manager 10
--   --   sales              2
--
--   -- Browse the catalog
--   select category, key, label, sort_order
--     from permissions
--    order by sort_order;
