-- =====================================================================
-- Sales Terms — warranty + offer validity columns on documents.
-- =====================================================================
--
-- Three new fields that round out the commercial export header on the
-- proforma / quotation PDF (the "SALES TERMS" section the designer
-- asked for):
--
--   warranty_years                 integer, nullable
--                                  Common values 3, 5, 10. Free integer
--                                  so future "custom" warranty doesn't
--                                  need a schema change.
--
--   offer_validity_products_days   integer, default 30
--                                  How long the unit pricing on this
--                                  quote remains binding.
--
--   offer_validity_transport_days  integer, default 7
--                                  Freight quote is more volatile —
--                                  separate short window.
--
-- Defaults
-- --------
-- 30 / 7 are DB-level defaults so existing documents that never
-- touched these columns (and any future row inserted by an older code
-- path) get sensible values. The form UI also reads them on render.
--
-- Production time and payment terms live in the same "SALES TERMS"
-- PDF section but they're already stored on `documents` (production_mode/
-- production_days/production_date + payment_mode/payment_terms). No
-- column change for those.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table documents
  add column if not exists warranty_years int,
  add column if not exists offer_validity_products_days  int default 30,
  add column if not exists offer_validity_transport_days int default 7;

-- Refresh PostgREST so the new columns are queryable through the JS
-- client immediately (without a Supabase restart).
notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   select column_name, data_type, column_default
--   from information_schema.columns
--   where table_name = 'documents'
--     and column_name in (
--       'warranty_years',
--       'offer_validity_products_days',
--       'offer_validity_transport_days'
--     );
--   -- Expected: 3 rows, two with default '30' and '7'.
-- ---------------------------------------------------------------------
