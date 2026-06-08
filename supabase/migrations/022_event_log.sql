-- =====================================================================
-- Event log — collaborative operational visibility.
-- =====================================================================
--
-- Every critical workflow action emits an event row here. The app reads
-- these rows to render:
--   - Timeline panels on entity detail pages (PO, task list, client)
--   - Dashboard "Recent activity" / "Recent critical events" feeds
--   - Cancellation / modification banners
--
-- Schema rationale
-- ----------------------------------------------------------------------
-- entity_type + entity_id  — what the event is about. Polymorphic so we
--                            don't need one table per entity. Examples:
--                            'production_order', 'task_list', 'document',
--                            'client'.
--
-- event_type               — machine-readable category. Examples:
--                            'po.status_changed', 'po.deadline_changed',
--                            'po.deposit_received', 'tl.validated',
--                            'tl.cancelled', 'doc.status_changed'.
--
-- severity                 — drives badge color + dashboard filtering:
--                            'low'      | comment, minor edit
--                            'medium'   | shipment update, status nudge
--                            'high'     | delay, missing deposit, deadline shift
--                            'critical' | cancellation, deletion
--
-- payload (jsonb)          — structured details. By convention:
--                            { from, to, field, reason, ... }
--                            Free-form so we can extend per event_type
--                            without migration churn.
--
-- message                  — human-readable summary, computed by the
--                            emitter so the UI doesn't have to re-derive.
--                            "Production deadline changed: May 20 → May 28"
--
-- actor_id                 — auth.users.id of whoever triggered the action.
--                            Nullable for system events (e.g. cron sweeps).
--
-- Idempotent. Run in Supabase SQL Editor.
-- =====================================================================

begin;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  -- Polymorphic target. The combo (entity_type, entity_id) is what the
  -- timeline panels query against.
  entity_type text not null,
  entity_id   uuid not null,
  -- Machine-readable type. We don't constrain via enum so adding new
  -- event types is cheap; instead, lib/events.ts maintains the catalog.
  event_type  text not null,
  severity    text not null default 'low'
    check (severity in ('low', 'medium', 'high', 'critical')),
  -- Structured + human-readable payload.
  payload     jsonb not null default '{}'::jsonb,
  message     text not null,
  -- Audit.
  actor_id    uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- Indexes
-- ----------------------------------------------------------------------
-- The two access patterns:
--   1. "Show me everything for this entity, newest first" → timeline panels
--   2. "Show me recent HIGH/CRITICAL events across the whole company"
--      → dashboard feed
-- ----------------------------------------------------------------------
create index if not exists idx_events_entity
  on events (entity_type, entity_id, created_at desc);

create index if not exists idx_events_severity_recent
  on events (severity, created_at desc)
  where severity in ('high', 'critical');

create index if not exists idx_events_recent
  on events (created_at desc);

-- =====================================================================
-- RLS
-- =====================================================================
-- Strategy:
--   READ  — everyone authenticated can read events. The events are
--           visibility-by-design (we WANT the team to see operational
--           changes). Per-entity privacy is enforced upstream by the
--           UI: timeline panels live on pages that already gate the
--           entity (RLS on production_orders, documents, etc.). An
--           event row leaking is not a meaningful breach — the row
--           references an entity_id but contains no PII beyond what
--           is already on the parent entity's visible surface.
--   WRITE — INSERT only via server actions. No update/delete by
--           clients. We allow authenticated INSERT so server actions
--           running with the user's JWT can write; the trade-off is a
--           rogue client could spam fake events, mitigated by:
--             a) authenticated-only (no anon writes)
--             b) actor_id is set by the server action, not the client
--             c) we never trust the message field for sensitive data
-- =====================================================================
alter table events enable row level security;

drop policy if exists "events read" on events;
create policy "events read" on events for select
  using (auth.role() = 'authenticated');

drop policy if exists "events write" on events;
create policy "events write" on events for insert
  with check (auth.role() = 'authenticated');

-- No update/delete policies — events are immutable by design.
-- An audit log you can edit is not an audit log.

notify pgrst, 'reload schema';

commit;

-- Quick smoke test (run separately):
--   insert into events (entity_type, entity_id, event_type, severity, message)
--     values ('test', gen_random_uuid(), 'test.smoke', 'low', 'smoke test');
--   select count(*) from events where entity_type = 'test';
--   delete from events where entity_type = 'test';
