-- =====================================================================
-- m115 — Export shipping-documents package (CI as a SHIPPING document)
-- =====================================================================
--
-- Business decision (owner, 2026-06-12): the Commercial Invoice is NOT
-- a finance/accounting object. It is a SHIPPING DOCUMENT — generated
-- when the shipment is prepared, used for customs clearance, import
-- procedures, bank/LC documentation and freight forwarding. It lives in
-- the order's Shipping Documents package alongside the Packing List,
-- B/L / AWB, Certificate of Origin, inspection certificates and LC
-- documents. No accounting records, no payment workflows.
--
-- Three pieces, all riding the existing m099 order-documents hub:
--
--   1. order_documents.kind — canonical document kind (keys from the
--      BL_DOCUMENT_CATALOG in lib/bl.ts: commercial_invoice,
--      packing_list, bill_of_lading, certificate_of_origin, …, plus
--      lc_documents). NULL = free upload (uncategorized), exactly the
--      pre-m115 behavior. The kind is what lets the Shipping Documents
--      checklist tick ✓ when a required document is present.
--
--   2. production_orders.commercial_invoice_number — the CI reference
--      (CI-XXXX). Assigned ONCE per order on first generation; PDF
--      regenerations create new VERSIONS of the same logical document
--      (m099 group versioning), never a new number.
--
--   3. next_ci_number() — its own numbering sequence, separate from
--      quotation/proforma numbering (per the owner's spec: "CI-XXXX").
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

-- 1. Document kind on the hub
alter table order_documents
  add column if not exists kind text;

comment on column order_documents.kind is
  'Canonical shipping-document kind (commercial_invoice, packing_list, bill_of_lading, certificate_of_origin, inspection_report, lc_documents, …). NULL = free upload.';

create index if not exists idx_order_documents_kind
  on order_documents (production_order_id, kind)
  where kind is not null;

-- 2. CI reference on the order
alter table production_orders
  add column if not exists commercial_invoice_number text;

comment on column production_orders.commercial_invoice_number is
  'Commercial Invoice reference (CI-XXXX), assigned once on first generation. Regenerations version the same document in order_documents.';

-- 3. CI numbering sequence (own sequence — never shared with
--    quotation/proforma numbering)
create sequence if not exists commercial_invoice_seq;

drop function if exists next_ci_number();
create or replace function next_ci_number()
returns text
language sql
volatile
security definer
set search_path = public
as $$
  select 'CI-' || lpad(nextval('commercial_invoice_seq')::text, 4, '0')
$$;

revoke all on function next_ci_number() from public;
grant execute on function next_ci_number() to authenticated;

insert into schema_migrations (filename, note)
values ('115_shipping_documents_package.sql', 'CI as shipping document + doc kinds + CI numbering')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK (run separately):
--   select next_ci_number();          -- → CI-0001 (consumes one number)
--   select column_name from information_schema.columns
--    where table_name = 'order_documents' and column_name = 'kind';
--   select * from schema_migrations where filename like '115%';
--
-- ROLLBACK:
--   begin;
--   drop function if exists next_ci_number();
--   drop sequence if exists commercial_invoice_seq;
--   alter table order_documents drop column if exists kind;
--   alter table production_orders drop column if exists commercial_invoice_number;
--   delete from schema_migrations where filename = '115_shipping_documents_package.sql';
--   notify pgrst, 'reload schema';
--   commit;
-- ---------------------------------------------------------------------
