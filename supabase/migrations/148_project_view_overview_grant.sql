-- =====================================================================
-- m148 — Service Request Overview: capability grant seed
-- =====================================================================
--
-- New READ-ONLY page /projects/overview: a central list of ALL service
-- requests (id, customer, project/affair, salesperson, status, dates)
-- so supervision roles can follow progress. Zero workflow change — it
-- only surfaces rows the caller can already read (RLS m090/m132 already
-- gives sales_director / operations / admin org-wide SELECT on
-- project_requests, so NO policy change is needed here).
--
-- The page is gated by the new capability `project.view_overview`
-- (catalogued in lib/capabilities.ts) via canAccessOrAdmin — admin and
-- super_admin always pass in code (anti-lockout floor, m122 pattern).
-- This seed grants the capability to the two supervision roles the
-- owner asked for: sales_director and operations. Until this runs, a
-- super-admin can equally toggle the same checkboxes in
-- /permissions/actions (fail-closed either way).
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

insert into permissions (key, category, label, description, sort_order) values
  ('project.view_overview', 'Projects', 'View the Service Request overview',
   'Read-only central list of every service request in the system (status, owner, dates) — supervision visibility, no workflow actions.', 76)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  -- floor in code, marked here for the matrix + clarity
  ('super_admin',       'project.view_overview', true),
  ('admin',             'project.view_overview', true),
  -- the two supervision roles this page is for
  ('sales_director',    'project.view_overview', true),
  ('operations',        'project.view_overview', true),
  -- explicit OFF for the rest (matrix shows a deliberate decision)
  ('sales',             'project.view_overview', false),
  ('task_list_manager', 'project.view_overview', false),
  ('finance',           'project.view_overview', false)
on conflict (role, permission_key) do nothing;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('148_project_view_overview_grant.sql',
        'Service Request Overview page: project.view_overview capability grant (sales_director + operations)')
on conflict (filename) do nothing;

commit;
