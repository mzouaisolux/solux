-- =====================================================================
-- m136 — Unified Event Registry (Step 1)
--        event_routing + event_catalog_overrides
-- =====================================================================
--
-- Generalizes m123 (notification_rules) into ONE routing model that any
-- downstream CONSUMER (notification, dashboard, kpi, audit, future
-- automations) subscribes to. The event is still EMITTED from code; this
-- layer only describes ROUTING + PRESENTATION, never business logic —
-- projections (dashboards, KPIs, At Risk, …) stay in code. The consumer
-- descriptor lives in lib/event-registry.ts (CONSUMERS).
--
-- Two override-only tables (the code catalog is the BASELINE):
--   event_catalog_overrides — identity/presentation per event_key
--       (label, description, icon, category, severity, requires_action,
--        enabled). Absent row / absent field ⇒ code baseline.
--   event_routing           — per (event_key, consumer, role) routing.
--       config jsonb carries consumer-specific keys:
--         notification → {"channel":"bell"|"feed"|"off"}
--         dashboard    → {"section":"todays_work"|"at_risk"|…}
--         audit        → {"visibility":"visible"|"internal"}
--         kpi          → {"kpis":["delays",…]}
--       role = a real role, OR '*' for global (non per-role) consumers.
--       Absent row ⇒ the consumer's CODE default (notification ⇒
--       defaultChannel/eventRaisesBell).
--
-- Ships ALMOST empty: only EXISTING notification_rules rows are folded in
-- as consumer='notification'. With nothing else, behavior is identical to
-- today (locked by tests/event-registry.test.ts + notification-catalog.test.ts).
--
-- Read: any authenticated user (read paths need it).
-- Write: admin / super_admin (like the permission matrix / m123).
-- Idempotent. Safe to re-run. Apply manually in Supabase, WITH the deploy
-- that switches the bell read-path to event_routing.
-- =====================================================================

begin;

-- ---- identity / presentation overrides ------------------------------
create table if not exists event_catalog_overrides (
  event_key       text primary key,
  label           text,
  description     text,
  icon            text,
  category        text,
  severity        text check (severity in ('low', 'medium', 'high', 'critical')),
  requires_action boolean,
  enabled         boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null
);

-- ---- routing matrix (consumer × role) -------------------------------
create table if not exists event_routing (
  event_key   text not null,
  consumer    text not null,          -- 'notification'|'dashboard'|'kpi'|'audit'|'automation'
  role        text not null,          -- a real role, or '*' for global consumers
  config      jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  primary key (event_key, consumer, role)
);

create index if not exists event_routing_consumer_role_idx
  on event_routing (consumer, role);

alter table event_catalog_overrides enable row level security;
alter table event_routing enable row level security;

-- read: any authenticated user
drop policy if exists "event_catalog_overrides read" on event_catalog_overrides;
create policy "event_catalog_overrides read" on event_catalog_overrides for select
  using (auth.role() = 'authenticated');

drop policy if exists "event_routing read" on event_routing;
create policy "event_routing read" on event_routing for select
  using (auth.role() = 'authenticated');

-- write: admin / super_admin only
drop policy if exists "event_catalog_overrides write" on event_catalog_overrides;
create policy "event_catalog_overrides write" on event_catalog_overrides for all
  using (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.super_admin = true or r.role = 'admin'))
  )
  with check (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.super_admin = true or r.role = 'admin'))
  );

drop policy if exists "event_routing write" on event_routing;
create policy "event_routing write" on event_routing for all
  using (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.super_admin = true or r.role = 'admin'))
  )
  with check (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.super_admin = true or r.role = 'admin'))
  );

-- ---- fold existing notification_rules → event_routing ---------------
-- Preserves any per-role channel overrides set under m123. No-op if empty.
-- notification_rules is left in place (read-path stops using it) as a
-- one-release safety net.
insert into event_routing (event_key, consumer, role, config)
select event_key, 'notification', role, jsonb_build_object('channel', channel)
from notification_rules
on conflict (event_key, consumer, role) do nothing;

insert into schema_migrations (filename, note)
values (
  '136_event_registry.sql',
  'Step 1 — unified event registry (event_routing + event_catalog_overrides); folds notification_rules into consumer=notification; empty otherwise = no behavior change'
)
on conflict (filename) do nothing;

commit;
