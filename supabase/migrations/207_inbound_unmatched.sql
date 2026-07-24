-- =====================================================================
-- m184 — Integrations: inbound_unmatched (staging for inbound messages
--        whose sender could not be matched to a client/contact).
-- =====================================================================
-- PLAN_INTEGRATIONS.md §3.3 / UC-5 and INTEGRATION_NEXT_FLOWS.md area B.
--
-- Why a separate table: client_interactions.client_id is NOT NULL, so an
-- inbound message from an unknown number cannot live there. It lands here
-- until a reviewer reconciles it to a client (which appends the equivalent
-- client_interactions row) or ignores it (spam / wrong number).
--
-- Who writes it: the future inbound receiver route (area A) runs with the
-- service-role client (no session) and inserts here when phone matching
-- fails. The service role bypasses RLS by design.
--
-- Who reads/updates it: admins via the review panel — RLS is admin-like,
-- matching the webhook/api-key tables (m168/m167). status is a small
-- lifecycle: pending -> resolved | ignored. Not append-only (unlike
-- client_interactions): the resolve/ignore action stamps the same row.
--
-- Additive + idempotent. Safe to re-run.
-- =====================================================================

begin;

create table if not exists inbound_unmatched (
  id                     uuid primary key default gen_random_uuid(),
  channel                text not null check (channel in
                           ('zalo','zalo_oa','whatsapp','whatsapp_business','telegram','email','call','meeting','note')),
  from_identifier        text not null,          -- E.164 phone / Zalo user_id / chat_id / email
  display_name           text,                   -- platform-provided profile name, if any
  summary                text,                   -- first ~80 chars of the message
  payload                jsonb not null default '{}'::jsonb,
  status                 text not null default 'pending'
                           check (status in ('pending','resolved','ignored')),
  received_at            timestamptz not null default now(),
  resolved_client_id     uuid references clients(id) on delete set null,
  resolved_contact_id    uuid references contacts(id) on delete set null,
  resolved_interaction_id uuid references client_interactions(id) on delete set null,
  resolved_by            uuid references auth.users(id) on delete set null,
  resolved_at            timestamptz,
  created_at             timestamptz not null default now()
);

-- Badge count / review list reads only the open queue.
create index if not exists idx_inbound_unmatched_pending
  on inbound_unmatched(received_at desc) where status = 'pending';

alter table inbound_unmatched enable row level security;

-- Admin-like only, mirroring webhook_endpoints (m168). The inbound receiver
-- writes with the service-role client (bypasses RLS); the review panel acts
-- as a signed-in admin, which these policies allow.
drop policy if exists "inbound_unmatched admin" on inbound_unmatched;
create policy "inbound_unmatched admin" on inbound_unmatched for all to authenticated
  using (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.role = 'admin' or coalesce(r.super_admin, false)))
  )
  with check (
    exists (select 1 from user_roles r
      where r.user_id = auth.uid() and (r.role = 'admin' or coalesce(r.super_admin, false)))
  );

insert into schema_migrations (filename, note)
values ('207_inbound_unmatched.sql',
        'Integrations: inbound_unmatched staging table (pending/resolved/ignored) + admin RLS — holds inbound messages whose sender phone matched no client/contact, until a reviewer reconciles (appends a client_interactions row) or ignores.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
