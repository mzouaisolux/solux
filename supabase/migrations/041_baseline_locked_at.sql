-- =====================================================================
-- Production baseline locking — Solux operational workflow refactor.
-- =====================================================================
--
-- Context
-- -------
-- The app already carries the two columns the new spec requires:
--
--   production_validation_date     (m021) — day-zero, set when TLM
--                                            validates the task list
--   production_working_days        (m021) — committed working days
--
-- Together they define the INITIAL PROJECTED COMPLETION (the baseline
-- the factory committed to). That triple is the "Production Baseline"
-- in the new UI: validation date + working days + computed completion.
--
-- What was missing was an explicit LOCK signal so the UI can render
-- the baseline panel read-only and so any admin override is auditable.
-- This migration adds `baseline_locked_at` for that purpose:
--
--   NULL          → baseline still editable (rare — only orders that
--                   pre-date this lock pattern)
--   timestamptz   → baseline locked, no further edits allowed without
--                   an admin unlock (capability `production_order.unlock_baseline`,
--                   added in Deliverable D)
--
-- Backfill: every existing production order gets baseline_locked_at =
-- production_validation_date so legacy rows behave as "always locked"
-- per the rule "once validated, baseline is locked".
--
-- Other columns we need for the new lifecycle ALREADY EXIST:
--   - actual_completion_date              (m018)
--   - initial_production_deadline         (m018)
--   - current_production_deadline         (m018)
--   - deposit_received_amount/_at         (m019)
--   - deposit_override_at/_by/_reason     (m025)
--
-- The "production start date" doesn't get its own column — it's
-- DERIVED from `coalesce(deposit_received_at, deposit_override_at::date)`
-- and exposed via the new `getProductionStartDate()` helper.
-- Computing it on read is safer than another column to keep in sync.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table production_orders
  add column if not exists baseline_locked_at timestamptz;

-- Backfill: any row that has a validated baseline already (i.e. a
-- production_validation_date is set) gets baseline_locked_at populated
-- so the UI treats them as locked-once-validated.
update production_orders
   set baseline_locked_at = production_validation_date::timestamptz
 where baseline_locked_at is null
   and production_validation_date is not null;

-- Partial index for the dashboard "Locked baselines per quarter" /
-- audit queries we might add later. Cheap insurance.
create index if not exists idx_po_baseline_locked
  on production_orders (baseline_locked_at)
  where baseline_locked_at is not null;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   select count(*) as locked
--   from production_orders
--   where baseline_locked_at is not null;
--   -- Expected: equal to count(*) of rows with production_validation_date
--
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'production_orders'
--     and column_name = 'baseline_locked_at';
--   -- Expected: 1 row, timestamp with time zone
-- ---------------------------------------------------------------------
