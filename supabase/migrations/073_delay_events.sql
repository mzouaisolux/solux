-- =====================================================================
-- m073 — Event-sourced delays: `days_added` on production_deadline_changes.
-- =====================================================================
--
-- Shifts the semantics of `production_deadline_changes` from "history of
-- mutations" to an additive event STREAM. Each row is now an independent,
-- immutable delay event carrying:
--
--   - days_added : signed integer (negative = recovery)
--   - delay_type : who is responsible (production / payment / shipping / …)
--   - reason     : free-text detail
--
-- The current ETA is derived:
--
--   current_eta = initial_eta + Σ days_added
--   factory_delay_days  = Σ days_added where delay_type = 'production'
--   external_delay_days = Σ days_added where delay_type != 'production'
--
-- We keep `current_production_deadline` materialised on `production_orders`
-- so every existing read path (pills, action-center, dashboards, lifecycle
-- helpers) keeps working unchanged. The server action writes the event AND
-- updates the materialised column atomically.
--
-- This fixes the previous attribution problem: when reality is "5d factory
-- + 7d payment", we can now log TWO honest events instead of one rounded-up
-- overwrite tagged with whatever cause was loudest.
--
-- Idempotent. Backfilled from the existing previous_date / new_date deltas.
-- =====================================================================

alter table production_deadline_changes
  add column if not exists days_added integer;

-- Backfill: every existing row already encodes its delta as (new_date − previous_date).
-- Initial-set rows (previous_date NULL) carry 0 — they're baselines, not slips.
update production_deadline_changes
set days_added = coalesce(new_date - previous_date, 0)
where days_added is null;

-- Quick lookup for the breakdown computation.
create index if not exists idx_pdc_days_added
  on production_deadline_changes (production_order_id, delay_type, days_added);

notify pgrst, 'reload schema';
