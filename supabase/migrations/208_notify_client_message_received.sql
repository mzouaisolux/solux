-- =====================================================================
-- m185 — Enable the bell for client.message_received (inbound area A).
-- =====================================================================
-- Notifications are OPT-IN (owner decision 2026-07-03): an event only rings
-- the bell / hits the feed when it has a MASTER routing row
-- (consumer='notification', role='*', enabled=true) in event_routing (m136).
-- Without this row the new client.message_received event would be logged +
-- visible on the timeline but stay silent.
--
-- This seeds ONLY the master switch. Channel is then resolved at read time
-- from the event's severity (high → bell, per notification-catalog.ts). Admins
-- can still add per-role overrides in /admin/notifications; RLS on the events
-- feed means each user sees only their own clients' messages, so the bell
-- naturally reaches the client's sales owner (+ managers).
--
-- Additive + idempotent. Safe to re-run.
-- =====================================================================

begin;

insert into event_routing (event_key, consumer, role, config, enabled)
values ('client.message_received', 'notification', '*', '{}'::jsonb, true)
on conflict (event_key, consumer, role) do nothing;

insert into schema_migrations (filename, note)
values ('208_notify_client_message_received.sql',
        'Enable notifications (bell) for client.message_received: master event_routing row (consumer=notification, role=*, enabled). High severity → bell, RLS-scoped to the client owner.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
