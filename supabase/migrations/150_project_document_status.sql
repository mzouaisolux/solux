-- =====================================================================
-- m150 — Project Documents SSoT Lot 2: document status + approval
-- =====================================================================
--
-- Owner spec (2026-07-07): each document in the project repository keeps
-- a lifecycle status — Draft / Approved / Final. The status lives on the
-- ROW of the two file tables (uploads + PO documents); quotations keep
-- their own commercial status (draft/sent/won…) and are NOT affected.
-- For versioned PO documents the status is per version: a NEW version
-- starts back at 'draft' (a fresh file needs a fresh approval).
--
-- Delegation: setting a status is gated by the NEW capability
-- `document.set_status` (catalogued in lib/capabilities.ts) — granted to
-- the supervision/technical roles below; admins pass via the code floor.
--
-- The app reads these columns DEFENSIVELY (soft-fail pre-migration), so
-- deploying code before applying this file is safe.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Status columns
-- ---------------------------------------------------------------------
alter table attachments
  add column if not exists doc_status text not null default 'draft'
    check (doc_status in ('draft','approved','final')),
  add column if not exists status_set_by uuid references auth.users(id) on delete set null,
  add column if not exists status_set_at timestamptz;

alter table order_documents
  add column if not exists doc_status text not null default 'draft'
    check (doc_status in ('draft','approved','final')),
  add column if not exists status_set_by uuid references auth.users(id) on delete set null,
  add column if not exists status_set_at timestamptz;

-- ---------------------------------------------------------------------
-- 2. Capability (catalogued in lib/capabilities.ts — module "document")
-- ---------------------------------------------------------------------
insert into permissions (key, category, label, description, sort_order) values
  ('document.set_status', 'Documents', 'Set document status (Draft / Approved / Final)',
   'Change the lifecycle status of a project document in the repository (uploads and production-order files).', 120)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  ('super_admin',       'document.set_status', true),
  ('admin',             'document.set_status', true),
  ('sales',             'document.set_status', false),
  ('sales_director',    'document.set_status', true),
  ('task_list_manager', 'document.set_status', true),
  ('operations',        'document.set_status', true),
  ('finance',           'document.set_status', false)
on conflict (role, permission_key) do nothing;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('150_project_document_status.sql',
        'Project Documents SSoT Lot 2: doc_status (draft/approved/final) on attachments + order_documents + document.set_status capability')
on conflict (filename) do nothing;

commit;
