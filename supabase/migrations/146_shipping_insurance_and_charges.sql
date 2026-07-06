-- =====================================================================
-- m146 — Shipping: Insurance + repeatable Additional Charges
-- ---------------------------------------------------------------------
-- International logistics quotes carry more than freight: Insurance and
-- country-specific fees (ECTN, BESC, FERI, inspection…). Owner req
-- 2026-07-03. These are entered on BOTH surfaces:
--   • the commercial quote (documents), by Sales, and
--   • the Operations freight costing (freight_cost_requests), then pushed
--     onto the generated quotation's document.
--
-- Data model (additive, nullable/defaulted — safe on existing rows):
--   • insurance_cost      numeric  — a single insurance amount.
--   • additional_charges  jsonb    — ordered list of {label, amount},
--                                    e.g. [{"label":"ECTN","amount":280}, …].
--
-- These add to documents.total_price (and so to the m141 invoice ceiling)
-- but are PASS-THROUGH: excluded from the commission base (owner decision).
-- The app degrades gracefully if this isn't applied yet (save retries
-- without the columns), so applying it is what turns the feature ON.
--
-- Apply in the Supabase SQL editor. Idempotent.
-- =====================================================================

begin;

-- ---------- 1. Commercial document (Sales enters on the quote) ----------
alter table documents
  add column if not exists insurance_cost numeric not null default 0;
alter table documents
  add column if not exists additional_charges jsonb not null default '[]'::jsonb;

-- ---------- 2. Operations freight costing (pushed to the document) ------
alter table freight_cost_requests
  add column if not exists insurance_cost numeric;
alter table freight_cost_requests
  add column if not exists additional_charges jsonb not null default '[]'::jsonb;

insert into schema_migrations (filename, note)
values ('146_shipping_insurance_and_charges.sql',
        'documents + freight_cost_requests: insurance_cost numeric + additional_charges jsonb (ECTN/BESC/FERI/inspection). Non-commissionable; flows to total_price + invoice ceiling.')
on conflict (filename) do nothing;

commit;

notify pgrst, 'reload schema';
