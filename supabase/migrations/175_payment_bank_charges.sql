-- =====================================================================
-- m175 — BANK CHARGES TOLERANCE on incoming customer wire transfers.
-- =====================================================================
--
-- Owner request (2026-07-16): international wires often arrive short because
-- intermediary banks deduct their fees in transit. To avoid blocking the
-- workflow for tiny gaps, a shortfall of ≤ USD 45 (BANK_CHARGES_TOLERANCE,
-- lib/types.ts) is treated as FULLY PAID and the missing amount is booked as
-- BANK CHARGES absorbed by Solux — NOT as an outstanding customer receivable.
--
--   Expected 3,000 · Received 2,985 → deposit PAID · outstanding 0 · bank
--     charges 15 · production continues.
--   Expected 3,000 · Received 2,930 → shortfall 70 (> 45) → partially paid ·
--     outstanding 70 · production stays gated (existing rule).
--
-- These two columns PERSIST the absorbed amount per tranche so it is recorded
-- separately as a Bank Charges expense (accounting), decoupled from any later
-- change to the quotation total. The status / outstanding are still DERIVED at
-- read time (reconcilePaymentTranche); these columns are the recorded expense.
--
-- Pure additive columns, default 0 (no behaviour change for existing orders).
-- The payments server action writes them defensively, so recording receipts
-- keeps working even before this migration is applied.
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor (prod), or via the
-- local Docker DB for development.
-- =====================================================================

begin;

alter table public.production_orders
  add column if not exists deposit_bank_charges numeric not null default 0,
  add column if not exists balance_bank_charges numeric not null default 0;

comment on column public.production_orders.deposit_bank_charges is
  'm175 — bank charges absorbed by Solux on the DEPOSIT wire (expected − received, capped at BANK_CHARGES_TOLERANCE). Recorded as an expense, never a customer receivable.';
comment on column public.production_orders.balance_bank_charges is
  'm175 — bank charges absorbed by Solux on the BALANCE wire (expected − received, capped at BANK_CHARGES_TOLERANCE). Recorded as an expense, never a customer receivable.';

-- Ledger (m113 rule: every migration self-inserts). Without this the file
-- keeps showing as pending in `npm run db:migrate` after it has been applied.
insert into schema_migrations (filename, note)
values ('175_payment_bank_charges.sql',
        'Bank charges tolerance: production_orders.deposit_bank_charges + balance_bank_charges (numeric, default 0). A wire shortfall <= BANK_CHARGES_TOLERANCE is booked as an absorbed bank charge, never as a customer receivable. Purely additive; the payments action already writes these columns defensively.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
