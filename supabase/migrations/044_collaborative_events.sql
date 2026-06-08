-- =====================================================================
-- m044 — Collaborative operational events (statuses, waiting reason,
--        ownership tracking).
-- =====================================================================
--
-- Extends the m039 event status workflow from a 4-state machine to a
-- richer collaborative model so an operational event behaves like a
-- mini-ticket the team can rally around — not just a one-way notice.
--
-- Status taxonomy (extended)
-- --------------------------
--   open          — newly emitted, not triaged
--   acknowledged  — someone has seen it (m039)
--   working       — someone is actively on it (NEW)
--   waiting       — blocked on a third party; pair with `waiting_for`
--   escalated     — needs management review (NEW)
--   resolved      — done
--
-- `waiting_for` (nullable, only meaningful when status='waiting')
-- ---------------------------------------------------------------
--   client / operations / sales / supplier / bank / management / other
--
-- Ownership
-- ---------
--   owner_id           — who's primarily handling this event
--   owner_assigned_at  — when ownership was assigned (audit)
--
-- Backward compatibility
-- ----------------------
-- The four legacy statuses (open/acknowledged/waiting/resolved) keep
-- working unchanged — existing rows are NOT migrated. The CHECK
-- constraint is widened; the type union grows. Comments + ack columns
-- continue to work as before.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------- 1. Widen events.status CHECK to accept new values ----------
alter table events
  drop constraint if exists events_status_check;
alter table events
  add constraint events_status_check check (
    status in (
      'open',
      'acknowledged',
      'working',
      'waiting',
      'escalated',
      'resolved'
    )
  );

-- ---------- 2. waiting_for sub-state ----------
-- Constrained to a known vocabulary so dashboards can render consistent
-- pills ("Waiting client", "Waiting supplier", etc.). Nullable —
-- meaningful only when status='waiting' but we don't enforce coupling
-- via a CHECK because callers may want to clear it independently.
alter table events
  add column if not exists waiting_for text;

alter table events
  drop constraint if exists events_waiting_for_check;
alter table events
  add constraint events_waiting_for_check check (
    waiting_for is null
    or waiting_for in (
      'client',
      'sales',
      'operations',
      'supplier',
      'bank',
      'management',
      'other'
    )
  );

-- ---------- 3. Ownership tracking ----------
-- The user who's "carrying" this event. Doesn't replace acknowledged_by
-- (which records WHO first looked at it) — owner_id is more durable
-- and survives re-acknowledgement cycles.
alter table events
  add column if not exists owner_id uuid references auth.users(id),
  add column if not exists owner_assigned_at timestamptz;

-- ---------- 4. Index for "events I own" queries ----------
-- Lets us cheaply ask "what's on my plate" in dashboards / personal
-- views without scanning the full events table.
create index if not exists idx_events_owner_open
  on events (owner_id, created_at desc)
  where status <> 'resolved' and owner_id is not null;

-- ---------- 5. RLS unchanged ----------
-- m039 already enabled RLS on events with authenticated read/write.
-- Adding columns doesn't change the policy surface — any authenticated
-- user can update status / waiting_for / owner_id like they could
-- update status before. Locking specific transitions to specific roles
-- (e.g. "only managers can escalate") would go through a SECURITY
-- DEFINER RPC; deferred until we need it.

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- 1. CHECK accepts the new statuses
--   select pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.events'::regclass
--      and conname  = 'events_status_check';
--   -- Expected: CHECK (status = ANY (ARRAY[
--   --   'open','acknowledged','working','waiting','escalated','resolved']))
--
--   -- 2. waiting_for accepts a known value
--   update events set waiting_for = 'supplier' where id = (select id from events limit 1);
--   -- Expected: ok
--   update events set waiting_for = 'bogus' where id = (select id from events limit 1);
--   -- Expected: violates check constraint
--
--   -- 3. owner_id can be set + index exists
--   select indexname from pg_indexes where indexname = 'idx_events_owner_open';
--   -- Expected: idx_events_owner_open
-- ---------------------------------------------------------------------
