-- =====================================================================
-- m074 — Editable delay events with audit metadata.
-- =====================================================================
--
-- Operationally, a strict immutable event log produces noisy "compensating"
-- rows when reality changes (supplier recovers, vessel reopens, payment
-- arrives). We let delay events be edited / deleted in place and capture
-- the audit trail via the existing `events` table (po.delay_event_edited /
-- po.delay_event_deleted), so the Timeline still tells the full story.
--
-- This migration just adds the "last edited" metadata to
-- `production_deadline_changes`. The authoritative ETA on
-- `production_orders.current_production_deadline` is recomputed by the
-- server actions whenever an event is added / edited / deleted:
--
--     current_production_deadline = initial_production_deadline + Σ days_added
--
-- Idempotent.
-- =====================================================================

alter table production_deadline_changes
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references auth.users(id);

notify pgrst, 'reload schema';
