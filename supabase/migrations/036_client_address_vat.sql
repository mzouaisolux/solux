-- =====================================================================
-- Client address / VAT / attention fields for the new PDF layout.
-- =====================================================================
--
-- The redesigned proforma / quotation PDF (matches the brand reference
-- the designer delivered) renders an "international export" header
-- with these blocks:
--
--   Attention to    : Purchasing Department   ← per-doc, with client default
--   Company         : Harled Lighting Ltd     ← clients.company_name (existing)
--   Contact Person  : Michael Turner          ← clients.contact_name   (existing)
--   Email           : michael.turner@…        ← clients.email          (existing)
--   Country         : United Kingdom          ← clients.country        (existing)
--   VAT Number      : GB287451982             ← NEW: clients.vat_number
--
-- Plus a full multi-line shipping/billing address ("3rd Floor D1, …")
-- carried as a free-form text block. We don't break it into
-- line1/line2/city/postcode because international addresses are
-- inconsistent enough that a single block of text is more honest than
-- a forced template.
--
-- "Attention to" lives on BOTH `clients` (as a default) and
-- `documents` (as a per-document override). UI fall-back logic:
-- doc.attention_to ?? client.default_attention_to ?? "Purchasing Department".
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table clients
  add column if not exists address text,
  add column if not exists vat_number text,
  add column if not exists default_attention_to text;

alter table documents
  add column if not exists attention_to text;

-- Schema cache refresh so PostgREST surfaces the new columns
-- immediately to the app without restarting Supabase.
notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'clients' and column_name in
--          ('address', 'vat_number', 'default_attention_to');
--   -- expected: 3 rows
--
--   select column_name from information_schema.columns
--    where table_name = 'documents' and column_name = 'attention_to';
--   -- expected: 1 row
-- ---------------------------------------------------------------------
