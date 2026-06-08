-- =====================================================================
-- m059 — Quotation versioning (V1 / V2 / V3 within one affair).
-- =====================================================================
--
-- When a client negotiates after receiving a quotation (quantity,
-- discount, shipping, config, payment terms change), we create a NEW
-- VERSION instead of a disconnected duplicate. All versions of the
-- same commercial affair are grouped, and the history is preserved.
--
--   root_document_id : the affair anchor = the id of V1. Every later
--                      version points to the same root. V1 itself has
--                      root_document_id = NULL (it IS the root).
--   version          : 1, 2, 3, … within the affair.
--
-- Numbering convention (handled by the app):
--   V1  SLX-BEN-26-014          (root, original number kept)
--   V2  SLX-BEN-26-014-V2
--   V3  SLX-BEN-26-014-V3
--
-- The original is never mutated — a revision is a fresh draft document
-- copied from the source, with the parties / lines / pricing editable.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table documents
  add column if not exists root_document_id uuid references documents(id) on delete set null;

alter table documents
  add column if not exists version integer not null default 1;

-- Fast "give me every version of this affair" lookups.
create index if not exists documents_root_idx
  on documents (root_document_id)
  where root_document_id is not null;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'documents'
--      and column_name in ('root_document_id', 'version');
--   -- Expected: 2 rows
-- ---------------------------------------------------------------------
