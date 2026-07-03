-- =====================================================================
-- m143 — Invoice history timestamps (additive to the m141 island).
-- (Renumbered from m142 — that number was already taken by
--  142_hide_catalogue_prices_flag.sql.)
-- =====================================================================
--
-- WHY (owner UX feedback 2026-07-03): each legal invoice must show its
-- lifecycle history ("Created … / Sent … / Paid …"). Created and Paid
-- already exist (invoices.created_at/created_by + the invoice_payments
-- ledger + cancelled_at) — only the SENT moment was a status flip with
-- no timestamp. This adds it.
--
-- Idempotent. Self-registers in schema_migrations (m113 convention).
-- Apply manually in the Supabase SQL editor, per project convention.
-- =====================================================================

begin;

alter table invoices add column if not exists sent_at timestamptz;

insert into schema_migrations (filename, note)
values ('143_invoice_sent_at.sql',
        'invoices.sent_at — timestamp for the Sent step of the invoice history (Created/Sent/Paid/Cancelled). Backfills nothing: existing sent invoices simply show no sent date.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- Smoke (run separately, after apply):
--   select column_name from information_schema.columns
--     where table_name = 'invoices' and column_name = 'sent_at';  -- 1 row
