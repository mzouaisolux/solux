-- =====================================================================
-- m153 — Manufacturing Cost Revision: request capability grant seed
-- =====================================================================
--
-- New workflow (owner spec 2026-07-08): ANYONE close to a deal can flag that
-- the manufacturing costing may be outdated (supplier prices, batteries,
-- steel, FX) by clicking "Request Cost Revision" with a MANDATORY reason.
-- The request creates a pending costing version (m140) and shows a banner on
-- the Service Request; only cost-authorized users (project.enter_cost /
-- project.override_cost — unchanged) actually UPDATE costs, and every update
-- is audited (factory_cost_audit, m091).
--
-- This capability gates the REQUEST button only. Per the owner's list it is
-- granted to sales, sales_director, task_list_manager and operations;
-- finance is explicitly off (they keep their cost read/write rights — they
-- just don't carry the request button).
--
-- Deploy note: `hasCapability` is fail-closed with NO admin floor, so the
-- code ships with a TRANSITION gate (`project.request_cost_revision` OR the
-- legacy `project.generate_quotation`) — the existing quotation-card button
-- keeps working even before this seed is applied. Apply this migration with
-- (or before) the deploy, then the transition OR can be dropped later.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

insert into permissions (key, category, label, description, sort_order) values
  ('project.request_cost_revision', 'Projects', 'Request a cost revision',
   'Flag a Service Request whose manufacturing costing may be outdated (mandatory reason). Creates a pending revision + banner; updating the costs themselves stays with enter_cost / override_cost.', 78)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  -- floor in code for admins, marked here for the matrix + clarity
  ('super_admin',       'project.request_cost_revision', true),
  ('admin',             'project.request_cost_revision', true),
  -- the owner's requester list
  ('sales',             'project.request_cost_revision', true),
  ('sales_director',    'project.request_cost_revision', true),
  ('task_list_manager', 'project.request_cost_revision', true),
  ('operations',        'project.request_cost_revision', true),
  -- explicit OFF (deliberate decision, visible in the matrix)
  ('finance',           'project.request_cost_revision', false)
on conflict (role, permission_key) do nothing;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('153_request_cost_revision_grant.sql',
        'Manufacturing Cost Revision workflow: project.request_cost_revision capability grant (sales + sales_director + task_list_manager + operations; finance explicitly off). Request-only — cost updates stay with enter_cost/override_cost.')
on conflict (filename) do nothing;

commit;
