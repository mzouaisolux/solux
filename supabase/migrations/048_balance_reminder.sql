-- =====================================================================
-- m048 — Balance payment reminder offset per production order.
-- =====================================================================
--
-- Sales need proactive visibility on balance payments BEFORE the
-- shipment leaves. Today the alert only fires once the balance is
-- already overdue (production_completed without balance received).
-- That's reactive — by the time it shows up, sales has lost time.
--
-- This migration adds `balance_reminder_days_before_eta` on
-- production_orders. Set to e.g. 15 → "Balance due in Nd" pill +
-- dashboard alert start firing 15 days before ETA, giving sales
-- time to push the client and unblock shipment.
--
-- The threshold is per-order so each project can override the
-- default (some clients pay slow, others wire same-day).
--
-- Constraint: 0-90 days. NULL means "no proactive reminder for this
-- order" (the legacy overdue alert still fires).
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table production_orders
  add column if not exists balance_reminder_days_before_eta integer;

alter table production_orders
  drop constraint if exists balance_reminder_days_check;

alter table production_orders
  add constraint balance_reminder_days_check check (
    balance_reminder_days_before_eta is null
    or (
      balance_reminder_days_before_eta >= 0
      and balance_reminder_days_before_eta <= 90
    )
  );

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- 1. Column exists
--   select column_name from information_schema.columns
--    where table_name = 'production_orders'
--      and column_name = 'balance_reminder_days_before_eta';
--   -- Expected: 1 row
--
--   -- 2. CHECK constraint accepts 0..90 + null
--   update production_orders set balance_reminder_days_before_eta = 15
--    where id = (select id from production_orders limit 1);
--   -- Expected: ok
--
--   -- 3. Refuses out-of-range
--   update production_orders set balance_reminder_days_before_eta = 999
--    where id = (select id from production_orders limit 1);
--   -- Expected: error violates check constraint
-- ---------------------------------------------------------------------
