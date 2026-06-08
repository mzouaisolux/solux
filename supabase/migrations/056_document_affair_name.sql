-- =====================================================================
-- m056 — Affair / project name on quotations.
-- =====================================================================
--
-- We work by PROJECTS / AFFAIRS, not by quotation codes. "SLX-BEN-26-014"
-- is hard to remember; "Benin Highway Solar Upgrade" is not. This adds
-- a free-text internal affair name to each document so it shows next to
-- the code in every listing.
--
--   affair_name : internal project label, e.g. "Benin Highway Phase 2".
--                 NULL = unnamed.
--
-- It also becomes the human label for the versioning workflow (V1/V2/V3
-- grouped under the same affair) coming next.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table documents
  add column if not exists affair_name text;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'documents' and column_name = 'affair_name';
--   -- Expected: 1 row
-- ---------------------------------------------------------------------
