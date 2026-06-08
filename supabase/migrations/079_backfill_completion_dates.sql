-- =====================================================================
-- m079 — Backfill actual_completion_date for completed-set orders (H6).
-- =====================================================================
-- The app is now STATUS-LED for completion (owner ruling 2026-06-02): reaching
-- production_completed / shipment_booked / shipped / delivered auto-stamps
-- actual_completion_date going forward (updateProductionOrderStatus). Existing
-- rows already sitting in one of those statuses with a NULL actual_completion_date
-- already read correctly in the UI (getLifecyclePhase keys on status), but their
-- KPI/reporting date is missing.
--
-- This OPTIONAL backfill fills that date from the best available signal:
--   1. the most recent `po.production_completed` event's timestamp, else
--   2. the order's current_production_deadline, else
--   3. CURRENT_DATE.
-- It NEVER overwrites an existing date. Idempotent (re-running is a no-op once
-- filled). Apply MANUALLY after a backup — review the PRE-CHECK counts first.
-- =====================================================================

-- ---- PRE-CHECK (run separately, BEFORE the transaction) -------------
--   -- rows that WILL be backfilled (status complete, date null):
--   select status, count(*) from production_orders
--    where status in ('production_completed','shipment_booked','shipped','delivered')
--      and actual_completion_date is null
--    group by status order by status;
--
--   -- inverse mismatch (date set but status NOT complete) — informational only,
--   -- not changed here; the deadline editor can no longer create these:
--   select status, count(*) from production_orders
--    where actual_completion_date is not null
--      and status not in ('production_completed','shipment_booked','shipped','delivered','cancelled')
--    group by status order by status;
-- ---------------------------------------------------------------------

begin;

update production_orders po
   set actual_completion_date = coalesce(
     (
       select (e.created_at)::date
         from events e
        where e.entity_type = 'production_order'
          and e.entity_id = po.id
          and e.event_type = 'po.production_completed'
        order by e.created_at desc
        limit 1
     ),
     po.current_production_deadline,
     current_date
   )
 where po.status in (
         'production_completed', 'shipment_booked', 'shipped', 'delivered'
       )
   and po.actual_completion_date is null;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK (run separately): expect ZERO rows.
--   select count(*) from production_orders
--    where status in ('production_completed','shipment_booked','shipped','delivered')
--      and actual_completion_date is null;
--
-- ROLLBACK: this is a data fill, not a schema change — there is no automatic
-- undo. Restore from backup if a fill was wrong. The forward auto-stamp in the
-- app keeps NEW rows consistent regardless of whether this backfill is applied.
-- ---------------------------------------------------------------------
