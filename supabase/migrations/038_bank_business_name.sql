-- =====================================================================
-- Split bank account display name: internal label vs legal entity.
-- =====================================================================
--
-- Before
-- ------
-- `bank_accounts.account_name` was used for two distinct purposes:
--   1. Internal dropdown label so sales can pick the right account
--      ("Solux China USD", "EU subsidiary EUR", etc.)
--   2. The "Business Account Name" line on the proforma / invoice PDF,
--      i.e. the legal entity the customer will wire money to
--      ("CHANGZHOU SOLUX TECHNOLOGY CO., LTD")
--
-- These are different concepts. The internal label needs to be human-
-- friendly and short; the PDF line must be the EXACT legal name on
-- the wire transfer documentation.
--
-- This migration adds `business_account_name`. The PDF reads
--   business_account_name ?? account_name
-- so existing accounts keep working until the user edits them to fill
-- the new column.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table bank_accounts
  add column if not exists business_account_name text;

-- PostgREST schema refresh so the new column is queryable through the
-- JS client without restarting Supabase.
notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'bank_accounts' and column_name = 'business_account_name';
--   -- Expected: 1 row.
-- ---------------------------------------------------------------------
