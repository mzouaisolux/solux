-- =====================================================================
-- m164 — Integrations Phase 1: client_interactions (the append-only
--        conversation log for a client).
-- =====================================================================
-- PLAN_INTEGRATIONS.md §3.2. A row per logged touch (chat / call / email /
-- note), manual or auto. The core of the sales↔customer timeline.
--
-- RLS (mirrors 101_contacts.sql — visibility flows through the parent
-- `clients` row so it stays in sync with client visibility automatically):
--   • read  — anyone who can see the client, EXCEPT finance. Finance holds a
--             client read grant for invoicing (m119) but conversation logs
--             stay within sales / management scope (open question #5 →
--             exclude finance).
--   • insert — client owner (created_by / sales_owner_id) or management roles.
--   • NO update / NO delete policies → append-only by construction; the
--     correction path is appending a follow-up `note` row.
--
-- Additive + idempotent. Safe to re-run.
-- =====================================================================

begin;

create table if not exists client_interactions (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  contact_id  uuid references contacts(id) on delete set null,
  channel     text not null check (channel in
                ('zalo','zalo_oa','whatsapp','whatsapp_business','telegram','email','call','meeting','note')),
  direction   text not null check (direction in ('outbound','inbound')),
  source      text not null default 'manual' check (source in ('manual','auto')),
  summary     text,
  payload     jsonb not null default '{}'::jsonb,
  happened_at timestamptz not null default now(),
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists idx_client_interactions_client on client_interactions(client_id, happened_at desc);
create index if not exists idx_client_interactions_created_by on client_interactions(created_by);

alter table client_interactions enable row level security;

-- read — as visible as the parent client, finance excluded.
drop policy if exists "client_interactions read" on client_interactions;
create policy "client_interactions read" on client_interactions for select using (
  exists (select 1 from clients c where c.id = client_interactions.client_id)
  and not exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and r.role = 'finance'
       and not coalesce(r.super_admin, false)
  )
);

-- insert — client owner or management roles. NO update / delete policies.
drop policy if exists "client_interactions insert" on client_interactions;
create policy "client_interactions insert" on client_interactions for insert with check (
  exists (
    select 1 from clients c
     where c.id = client_interactions.client_id
       and (c.created_by = auth.uid() or c.sales_owner_id = auth.uid())
  )
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin','task_list_manager','operations','sales_director')
            or coalesce(r.super_admin, false))
  )
);

insert into schema_migrations (filename, note)
values ('187_client_interactions.sql',
        'Integrations Phase 1: client_interactions (append-only conversation log) + RLS — visible as the parent client with finance excluded; insert by client owner/management; no update/delete policies (append-only).')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
