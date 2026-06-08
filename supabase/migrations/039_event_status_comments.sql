-- =====================================================================
-- Operations Feed Phase 2 — event status workflow + comments thread.
-- =====================================================================
--
-- This migration turns the polymorphic `events` log (introduced in m022)
-- into a true operational ticketing system:
--
--   events.status      open / acknowledged / waiting / resolved
--   events.due_date    optional follow-up target
--   events.acknowledged_at / acknowledged_by / resolved_at
--
--   event_comments     append-only thread per event so context can
--                      accumulate (replaces ad-hoc Slack/WhatsApp
--                      discussion). Cascade-deletes with the event.
--
-- Why on `events` (not a new `operation_events` table)
-- ----------------------------------------------------
-- The polymorphic events table already aggregates every operational
-- signal in the app (doc lifecycle, task list workflow, production
-- order changes, deposits, deletions). Splitting into a parallel
-- "operation_events" table would mean dual writes, dual reads, and a
-- coherence problem to police forever. By extending the existing
-- table, the Operations Feed in the dashboard reads the same rows the
-- audit timelines do — single source of truth, zero duplication.
--
-- Backwards compatibility
-- -----------------------
-- All existing events are pre-populated with status='open'. The
-- legacy timeline panels never read these new columns, so adding
-- them is non-breaking. The new dashboard feed filters/sorts on
-- them; everything else carries on as before.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------- 1. Extend events with status workflow ----------
alter table events
  add column if not exists status text not null default 'open'
    check (status in ('open', 'acknowledged', 'waiting', 'resolved')),
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid references auth.users(id),
  add column if not exists resolved_at timestamptz,
  add column if not exists due_date timestamptz;

-- Partial index — the dashboard query 99% of the time asks for
-- "what's NOT resolved" sorted by severity + created_at. A partial
-- index on the open set keeps that hot path tight even as the events
-- table grows over time.
create index if not exists idx_events_active
  on events (severity, created_at desc)
  where status <> 'resolved';

-- ---------- 2. Event comments thread ----------
create table if not exists event_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid references auth.users(id),
  comment text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_event_comments_event
  on event_comments (event_id, created_at desc);

-- ---------- 3. RLS — same as events: authenticated read/write ----------
-- Comments are operational context shared across the team, not PII.
-- Anyone signed in can read and add comments. Update / delete are
-- locked — comments are append-only audit, just like events.
alter table event_comments enable row level security;

drop policy if exists "event_comments read" on event_comments;
create policy "event_comments read" on event_comments for select
  using (auth.role() = 'authenticated');

drop policy if exists "event_comments write" on event_comments;
create policy "event_comments write" on event_comments for insert
  with check (auth.role() = 'authenticated');

-- No update / delete policies — comments are immutable like the
-- events they hang off of.

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- New columns exist
--   select column_name from information_schema.columns
--   where table_name = 'events'
--     and column_name in ('status', 'acknowledged_at', 'acknowledged_by',
--                         'resolved_at', 'due_date');
--   -- Expected: 5 rows
--
--   -- Comments table exists
--   select count(*) from event_comments;
--   -- Expected: 0 (empty fresh table)
--
--   -- All existing events default to 'open'
--   select status, count(*) from events group by status;
--   -- Expected: one row, status='open'
-- ---------------------------------------------------------------------
