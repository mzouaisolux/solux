-- =====================================================================
-- m177 — Spec-version PIN (Section 17): the frozen pointer.
-- (Rescued from the all_families_CORRECTED_v16 branch, originally drafted as
--  m171; renumbered to 177 to sit after the datasheet-integration migrations
--  172–176 already on main. The branch's `spec_documents.language` change is
--  DEFERRED — it widens the spec_documents unique key, which is coupled to the
--  onConflict upserts in renderSpecSheet.ts / the datasheets route; it ships
--  with the rebuilt read/render layer, not with this pin-only foundation.)
-- =====================================================================
--
-- WHY (Section 17 · Product Knowledge Hub): a product's technical spec is
-- VERSIONED per family (m161: spec_versions.category_id + version). The
-- Catalog and the Knowledge Hub always follow the CURRENT version (a live
-- pointer). But a quotation must prove what the client was actually sold, and
-- the factory must build exactly that — so the quotation, and the production
-- task list derived from it, need a FROZEN pointer: the spec version pinned at
-- the moment the quotation was sent. With 3–4 releases a year a quote sent in
-- March and produced in July spans two versions; the pin (an ID, not a label)
-- guarantees production builds against what the client saw.
--
-- This migration adds ONLY the two truly-new columns Section 17.1 calls for:
--
--   1. document_lines.spec_version_id            — THE PIN. uuid FK →
--      spec_versions(id). Defaults to the family's current version and is
--      frozen when the document is sent (see updateDocumentStatus, rebuilt
--      separately). Nothing in the repo pinned a spec version to a quotation
--      before this.
--
--   2. production_task_list_lines.spec_version_id — the PIN SNAPSHOT, copied
--      from the quotation line at conversion ("Launch Production"), the same
--      snapshot pattern the table already uses for product_name / unit_price
--      (m089/m135). Needed because m135 states line order vs. document_lines is
--      NOT a reliable join — the task list cannot read the pin through the line.
--
-- Both pins are FK → spec_versions(id) ON DELETE SET NULL: deleting a version
-- must never cascade-delete a historical quotation or task-list line; the line
-- simply loses its pin (and the UI falls back to "unpinned").
--
-- Additive + idempotent. Safe to re-run. Adds only two nullable columns; never
-- modifies products, documents, pricing, spec_documents, or the production
-- workflow tables' existing columns/constraints. Self-registers in
-- schema_migrations (m113 convention). Apply manually in Supabase (DDL) BEFORE
-- deploying the code that snapshots the pin onto the task-list insert.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. document_lines.spec_version_id — the pin (frozen at send).
-- ---------------------------------------------------------------------
alter table document_lines
  add column if not exists spec_version_id uuid references spec_versions(id) on delete set null;

create index if not exists idx_document_lines_spec_version
  on document_lines(spec_version_id) where spec_version_id is not null;

-- ---------------------------------------------------------------------
-- 2. production_task_list_lines.spec_version_id — the pin snapshot,
--    copied from the quotation line at conversion.
-- ---------------------------------------------------------------------
alter table production_task_list_lines
  add column if not exists spec_version_id uuid references spec_versions(id) on delete set null;

create index if not exists idx_ptll_spec_version
  on production_task_list_lines(spec_version_id) where spec_version_id is not null;

-- ---------------------------------------------------------------------
-- 3. Ledger (m113 rule: every migration self-inserts).
-- ---------------------------------------------------------------------
insert into schema_migrations (filename, note)
values ('200_spec_version_pin.sql',
        'Spec-version PIN (Section 17): document_lines.spec_version_id + production_task_list_lines.spec_version_id (FK spec_versions, ON DELETE SET NULL) — the frozen pointer defaulted to current and frozen at send, snapshotted onto the task list at conversion. Two nullable columns only; spec_documents.language + widened unique key deferred to the read/render rebuild. Changes no existing columns.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Verification (after apply):
--   select column_name from information_schema.columns
--    where table_name = 'document_lines' and column_name = 'spec_version_id';            -- 1 row
--   select column_name from information_schema.columns
--    where table_name = 'production_task_list_lines' and column_name = 'spec_version_id'; -- 1 row
-- ---------------------------------------------------------------------
