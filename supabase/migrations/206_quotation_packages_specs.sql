-- =====================================================================
-- m183 — quotation_packages: split the send into TWO attachments
--        (Change 2 — quote PDF + datasheets PDF as separate files).
-- =====================================================================
--
-- WHY: PRD-006 stored ONE merged PDF (quote + datasheets) in storage_path.
-- Change 2 sends the customer TWO attachments instead: the quotation on its
-- own, and one combined datasheets PDF (the selected specs, de-duplicated).
--
-- Mapping going forward:
--   • storage_path / storage_name  → the QUOTE-only PDF (was the merged file).
--   • specs_storage_path / _name   → the combined datasheets PDF; NULL when no
--     datasheet is selected/available (then only the quote is sent).
--
-- Old rows keep their merged file in storage_path with specs_* NULL — harmless;
-- only new sends use the two-file shape. Additive + idempotent. Self-registers.
-- Apply manually in Supabase (DDL).
-- =====================================================================

begin;

alter table quotation_packages
  add column if not exists specs_storage_path text,
  add column if not exists specs_storage_name text;

insert into schema_migrations (filename, note)
values ('206_quotation_packages_specs.sql',
        'quotation_packages.specs_storage_path/_name (nullable): the combined datasheets PDF for the two-attachment send (Change 2). storage_path/_name now hold the quote-only PDF for new sends; old merged rows keep specs_* NULL. Two additive columns; changes nothing existing.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
