-- =====================================================================
-- m054 — Client Shipping / BL profile.
-- =====================================================================
--
-- A reusable Bill-of-Lading profile stored per client: the shipping
-- parties (shipper / consignee / notify) and the export-document
-- checklist (ECTN, Certificate of Origin, Form E, …) with optional
-- per-document costs. Saved once on the client, it becomes the default
-- template for that client's shipments.
--
-- Stored as a single JSONB blob because the shape is nested + display-
-- oriented (it feeds BL paperwork, not aggregate reporting). Structure:
--
--   {
--     "shipper":   { company_name, address, contact_person, phone, email },
--     "consignee": { same_as_client, company_name, address,
--                    contact_person, phone, email, tax_id },
--     "notify":    { same_as_consignee, company_name, address,
--                    contact_person, phone, email },
--     "documents": [ { key, label, included, cost, currency, custom } ],
--     "notes":     "free text"
--   }
--
-- NULL = no BL profile configured yet for this client.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table clients
  add column if not exists bl_profile jsonb;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'clients' and column_name = 'bl_profile';
--   -- Expected: 1 row, data_type = jsonb
-- ---------------------------------------------------------------------
