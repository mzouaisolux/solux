-- =====================================================================
-- m101 — CRM step 2: contacts (multiple contact persons per client).
-- =====================================================================
--
-- PLAN_CRM_SOLUX.md §9.3: today a client carries ONE embedded contact
-- (clients.contact_name / email / phone_number). Real accounts have
-- several people (buyer, technical, finance, logistics). This adds a
-- proper `contacts` table.
--
-- Additive and non-breaking:
--   • The embedded clients fields are NOT touched or migrated away —
--     they stay the canonical "company contact" printed on documents.
--   • Backfill: ONE primary contact per client, copied from the
--     embedded fields, only where the client has no contacts yet.
--   • ON DELETE CASCADE — contacts belong to their client (client
--     deletion already goes through delete_client_safe).
--
-- RLS:
--   • read — a contact is as visible as its parent client: the EXISTS
--     subquery runs through the clients policies (m058/m066) for the
--     querying user, so visibility stays in sync automatically.
--   • write — client creator / sales owner, or management roles
--     (mirrors "clients update scoped").
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,
  name        text not null,
  title       text,           -- job title / role, e.g. "Procurement manager"
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_contacts_client on contacts(client_id);

alter table contacts enable row level security;

drop policy if exists "contacts read scoped" on contacts;
create policy "contacts read scoped" on contacts for select using (
  exists (select 1 from clients c where c.id = contacts.client_id)
);

drop policy if exists "contacts write scoped" on contacts;
create policy "contacts write scoped" on contacts for all using (
  exists (
    select 1 from clients c
     where c.id = contacts.client_id
       and (c.created_by = auth.uid() or c.sales_owner_id = auth.uid())
  )
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations')
            or coalesce(r.super_admin, false))
  )
) with check (
  exists (
    select 1 from clients c
     where c.id = contacts.client_id
       and (c.created_by = auth.uid() or c.sales_owner_id = auth.uid())
  )
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations')
            or coalesce(r.super_admin, false))
  )
);

-- Backfill: seed one primary contact from the embedded fields, only for
-- clients that have no contacts yet (keeps re-runs idempotent).
insert into contacts (client_id, name, email, phone, is_primary, created_by)
select c.id, trim(c.contact_name), c.email, c.phone_number, true, c.created_by
  from clients c
 where coalesce(trim(c.contact_name), '') <> ''
   and not exists (select 1 from contacts k where k.client_id = c.id);

notify pgrst, 'reload schema';

commit;
