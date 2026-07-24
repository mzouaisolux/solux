-- =====================================================================
-- m186 — Enable the bell for datasheet.refresh_needed (glossy handoff).
-- =====================================================================
-- Notifications are OPT-IN (owner decision 2026-07-03): an event only rings
-- the bell / hits the feed when it has a MASTER routing row
-- (consumer='notification', role='*', enabled=true) in event_routing (m136).
-- Without this row, datasheet.refresh_needed (emitted on spec publish) is
-- logged + visible on the timeline but stays silent.
--
-- This seeds ONLY the master switch. The channel is resolved at read time from
-- the event's severity. datasheet.refresh_needed is MEDIUM, and medium events
-- default to the silent "feed" UNLESS they're in ACTIONABLE_MEDIUM_EVENTS
-- (events-shared.ts) — where this event was added so it resolves to the BELL,
-- because a published spec needs the datasheet owner (admin/Manuel) to act:
-- open the exact .fig, re-export the glossy, and re-upload it.
--
-- Reaches the admin because admins see the full events feed (RLS floor); the
-- Change Requests page also shows a "Datasheet cooking / ready" pill per
-- published CR as the in-page queue.
--
-- Additive + idempotent. Safe to re-run.
-- =====================================================================

begin;

insert into event_routing (event_key, consumer, role, config, enabled)
values ('datasheet.refresh_needed', 'notification', '*', '{}'::jsonb, true)
on conflict (event_key, consumer, role) do update set enabled = true;

insert into schema_migrations (filename, note)
values ('209_notify_datasheet_refresh_needed.sql',
        'Enable notifications (bell) for datasheet.refresh_needed: master event_routing row (consumer=notification, role=*, enabled). Medium severity + ACTIONABLE_MEDIUM_EVENTS -> bell, so the datasheet owner is nudged on publish.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
