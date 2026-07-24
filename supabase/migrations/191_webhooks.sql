-- =====================================================================
-- m168 — Integrations Phase 2: outbound webhooks (endpoints + delivery outbox).
-- =====================================================================
-- PLAN_INTEGRATIONS.md §3.2 item 5. `webhook_endpoints` = the n8n targets and
-- their HMAC signing secret (an app-generated signing secret, NOT a platform
-- credential — acceptable in DB; shown once at creation). `webhook_deliveries`
-- = the append-of-work outbox: a row per (event × active endpoint), delivered
-- and retried by the dispatcher (Step 4b) with exponential backoff.
--
-- RLS: admin-like only. The dispatcher runs with the service-role client
-- (cron, no session) and bypasses RLS by design.
-- Additive + idempotent.
-- =====================================================================

begin;

create table if not exists webhook_endpoints (
  id          uuid primary key default gen_random_uuid(),
  url         text not null,
  event_types text[] not null default '{}',
  secret      text not null,            -- HMAC-SHA256 signing secret (shown once)
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists webhook_deliveries (
  id             uuid primary key default gen_random_uuid(),
  endpoint_id    uuid not null references webhook_endpoints(id) on delete cascade,
  event_id       uuid,
  event_type     text not null,
  payload        jsonb not null default '{}'::jsonb,
  status         text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts       integer not null default 0,
  last_attempt_at timestamptz,
  response_code  integer,
  created_at     timestamptz not null default now()
);

create index if not exists idx_webhook_deliveries_pending
  on webhook_deliveries(status, created_at) where status = 'pending';
create index if not exists idx_webhook_deliveries_endpoint on webhook_deliveries(endpoint_id);

alter table webhook_endpoints  enable row level security;
alter table webhook_deliveries enable row level security;

drop policy if exists "webhook_endpoints admin" on webhook_endpoints;
create policy "webhook_endpoints admin" on webhook_endpoints for all to authenticated
  using (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.role = 'admin' or coalesce(r.super_admin, false)))
  )
  with check (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.role = 'admin' or coalesce(r.super_admin, false)))
  );

drop policy if exists "webhook_deliveries admin read" on webhook_deliveries;
create policy "webhook_deliveries admin read" on webhook_deliveries for select to authenticated
  using (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.role = 'admin' or coalesce(r.super_admin, false)))
  );

insert into schema_migrations (filename, note)
values ('191_webhooks.sql',
        'Integrations Phase 2: webhook_endpoints (HMAC secret) + webhook_deliveries outbox (pending/delivered/failed, backoff) + admin RLS.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
