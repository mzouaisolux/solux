-- =====================================================================
-- m114 — Balance due date + LC expiry tracking (audit Phase 1 — cash)
-- =====================================================================
--
-- Problem (business audit 2026-06-11, P0→P1): payment tracking stops at
-- "amounts received". There is NO due date for the balance, so "late
-- payment" doesn't exist as a state — the only nudge is the generic
-- "production completes in ≤10 days" alert. For LC orders it's worse:
-- an expired Letter of Credit means produced goods that can no longer
-- be paid under the LC, and nothing tracks the expiry.
--
-- Two nullable columns on production_orders, both MANUAL inputs:
--
--   • balance_due_date — explicit OVERRIDE of the balance due date.
--     When NULL the app derives an EFFECTIVE due date at read time
--     (computeEffectiveBalanceDueDate in lib/types.ts):
--       - deposit_balance + before_shipment → current_production_deadline
--       - lc / hybrid with lc_days + ETA    → ETA + lc_days
--       - otherwise                         → ETA when present
--     Deriving at read time (Règle Produit #0: one source of truth)
--     means the due date FOLLOWS deadline/ETA changes automatically;
--     setting the column freezes it.
--
--   • lc_expiry_date — validity end of the Letter of Credit covering
--     this order. Drives "LC expires in Xd" / "LC expired" alerts while
--     the balance is outstanding (lib/operations-alerts.ts).
--
-- No new tables, no new statuses, no Finance module — these are
-- operational fields on the existing order, per the product decision
-- that execution-blocking financial events live with operations.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

alter table production_orders
  add column if not exists balance_due_date date,
  add column if not exists lc_expiry_date  date;

comment on column production_orders.balance_due_date is
  'Manual override of the balance due date. NULL = derived at read time from payment terms + production deadline / ETA (computeEffectiveBalanceDueDate).';
comment on column production_orders.lc_expiry_date is
  'Letter of Credit validity end. Alerts fire when expiry approaches/passes while the balance is outstanding.';

insert into schema_migrations (filename, note)
values ('114_balance_due_date_lc_expiry.sql', 'audit Phase 1 — cash tracking')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'production_orders'
--      and column_name in ('balance_due_date', 'lc_expiry_date');
--   select * from schema_migrations where filename like '114%';
--
-- ROLLBACK:
--   begin;
--   alter table production_orders
--     drop column if exists balance_due_date,
--     drop column if exists lc_expiry_date;
--   delete from schema_migrations where filename = '114_balance_due_date_lc_expiry.sql';
--   notify pgrst, 'reload schema';
--   commit;
-- ---------------------------------------------------------------------
