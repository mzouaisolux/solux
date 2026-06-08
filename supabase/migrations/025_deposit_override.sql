-- =====================================================================
-- Deposit override — controlled exception for trusted clients.
-- =====================================================================
--
-- Normally a production order can't move out of `awaiting_deposit`
-- until the deposit is fully received. For long-term trusted clients,
-- ops sometimes needs to launch production *before* the deposit clears.
--
-- This migration adds three columns to track the override:
--
--   deposit_override_at      timestamptz — when the override was
--                            activated. Triggers the production
--                            countdown ("Production Start Date").
--
--   deposit_override_by      uuid — who authorized the override.
--                            Foreign key to auth.users for traceability.
--
--   deposit_override_reason  text — optional rationale ("VIP client X
--                            has 5y of clean payment history, deposit
--                            confirmed verbally by CFO").
--
-- The override DOES NOT modify deposit_received_amount or
-- deposit_received_at. The deposit might still come in later — the
-- override only unblocks the status transition.
--
-- App-layer rules (enforced in startWithoutDeposit() server action):
--   - Only admin / super_admin can activate (sales has no bypass route)
--   - Activation flips status from awaiting_deposit → deposit_received
--   - Activation emits a HIGH-severity `po.status_changed` event so
--     the timeline + dashboard surface the exception
--   - Idempotent at the app level: re-activating throws an explicit
--     error rather than silently re-stamping
--
-- Idempotent SQL. Safe to re-run.
-- =====================================================================

begin;

alter table production_orders
  add column if not exists deposit_override_at  timestamptz,
  add column if not exists deposit_override_by  uuid references auth.users(id),
  add column if not exists deposit_override_reason text;

-- Tiny partial index — most orders never use the override, so we only
-- index the rows that do. Used by the dashboard to surface "orders
-- running without deposit cover" if we ever add such a KPI.
create index if not exists idx_production_orders_deposit_override
  on production_orders (deposit_override_at)
  where deposit_override_at is not null;

notify pgrst, 'reload schema';

commit;

-- Verification:
--   select column_name from information_schema.columns
--    where table_name = 'production_orders'
--      and column_name like 'deposit_override%';
--   -- Expected: 3 rows
