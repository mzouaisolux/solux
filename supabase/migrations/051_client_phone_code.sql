-- =====================================================================
-- m051 — Structured phone country code on clients.
-- =====================================================================
--
-- Phone numbers were free-text, so the international dialing prefix
-- ("+229", "+33") lived inline and inconsistently inside the number.
-- This splits the prefix into its own column so the UI can offer a
-- standardized country-code dropdown and the number field stays clean.
--
--   phone_country_code : the dialing prefix, e.g. "+229". NULL = none.
--   phone_number       : the local number, unchanged column.
--
-- Also (defensively) ensures the m036 export-document columns exist,
-- since both client-creation forms now write them and a freshly cloned
-- env might be missing m036. All idempotent.
-- =====================================================================

begin;

alter table clients
  add column if not exists phone_country_code text;

-- m036 columns — no-op when already present. Belt-and-suspenders so the
-- unified create form never fails on a partial migration history.
alter table clients
  add column if not exists address text;
alter table clients
  add column if not exists vat_number text;
alter table clients
  add column if not exists default_attention_to text;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   select column_name from information_schema.columns
--    where table_name = 'clients'
--      and column_name in ('phone_country_code','address','vat_number',
--                          'default_attention_to');
--   -- Expected: 4 rows
-- ---------------------------------------------------------------------
