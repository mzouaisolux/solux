-- =====================================================================
-- m169 — Integrations Phase 3: business channel connections + activate send.
-- =====================================================================
-- `integration_connections` = the workspace's business messaging accounts
-- (Zalo OA / WhatsApp Business / Telegram). Secrets (access tokens) are stored
-- ENCRYPTED at rest (AES-256-GCM via lib/integration-crypto.ts) — the table
-- only ever holds ciphertext + iv + tag, never plaintext, and the app never
-- reads them back to the client. Non-secret config (phone number id, OA id,
-- bot username) lives in `config` jsonb.
--
-- Also flips integration.send_business ON for the client-facing roles so the
-- "Send via company channel" action (Phase 3) is usable. Finance stays off.
--
-- RLS: admin-like only (mirrors api_keys / webhook_endpoints). The send path
-- runs in a user session and additionally requires integration.send_business.
-- Additive + idempotent.
-- =====================================================================

begin;

create table if not exists integration_connections (
  id                uuid primary key default gen_random_uuid(),
  channel           text not null check (channel in ('zalo_oa','whatsapp_business','telegram')),
  label             text not null default '',
  config            jsonb not null default '{}'::jsonb,   -- non-secret (phone_number_id, oa_id, …)
  secret_ciphertext text,                                  -- AES-256-GCM ciphertext (base64)
  secret_iv         text,                                  -- GCM iv (base64)
  secret_tag        text,                                  -- GCM auth tag (base64)
  is_active         boolean not null default false,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One connection row per channel (a workspace has one Zalo OA, one WA number…).
create unique index if not exists idx_integration_connections_channel
  on integration_connections(channel);

alter table integration_connections enable row level security;

drop policy if exists "integration_connections admin" on integration_connections;
create policy "integration_connections admin" on integration_connections for all to authenticated
  using (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.role = 'admin' or coalesce(r.super_admin, false)))
  )
  with check (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.role = 'admin' or coalesce(r.super_admin, false)))
  );

-- Activate the (Phase 1-seeded, dormant) send capability for client-facing roles.
insert into role_permissions (role, permission_key, enabled) values
  ('super_admin',    'integration.send_business', true),
  ('admin',          'integration.send_business', true),
  ('sales',          'integration.send_business', true),
  ('sales_director', 'integration.send_business', true),
  ('operations',     'integration.send_business', true)
on conflict (role, permission_key) do update set enabled = excluded.enabled;

insert into schema_migrations (filename, note)
values ('192_integration_connections.sql',
        'Integrations Phase 3: integration_connections (encrypted secret at rest, admin RLS) + activate integration.send_business for client-facing roles.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
