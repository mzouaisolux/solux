-- =====================================================================
-- m167 — Integrations Phase 2: api_keys (Bearer keys for n8n / external callers).
-- =====================================================================
-- PLAN_INTEGRATIONS.md §3.2 item 4. Plaintext is shown ONCE at creation and
-- never stored — only the SHA-256 hash + a display prefix. Revocation is
-- immediate (revoked_at set; the inbound API rejects hashes with revoked_at).
--
-- RLS: admin-like only (ops table). The inbound API route authenticates callers
-- with the service-role client (no user session), so it bypasses RLS by design.
-- Additive + idempotent.
-- =====================================================================

begin;

create table if not exists api_keys (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  key_hash    text not null,           -- sha256 hex of the plaintext key
  prefix      text not null,           -- first chars, for display (e.g. sk_live_••7f2a)
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create index if not exists idx_api_keys_active on api_keys(revoked_at);

alter table api_keys enable row level security;

drop policy if exists "api_keys admin" on api_keys;
create policy "api_keys admin" on api_keys for all to authenticated
  using (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.role = 'admin' or coalesce(r.super_admin, false)))
  )
  with check (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.role = 'admin' or coalesce(r.super_admin, false)))
  );

insert into schema_migrations (filename, note)
values ('190_api_keys.sql',
        'Integrations Phase 2: api_keys (sha256 hash + prefix, plaintext shown once) + admin-only RLS.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
