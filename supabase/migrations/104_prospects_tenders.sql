-- =====================================================================
-- m104 — CRM step 5: the prospects sandbox (prospects + raw tenders).
-- =====================================================================
--
-- PLAN_CRM_SOLUX.md §7: a light CRM-only zone — NEVER in invoicing —
-- where the lead manager and imports dump raw material. Two families,
-- never mixed:
--
--   A. PROSPECT (a company to approach). Sources: manual / import /
--      generated from a tender result. "Switch to client" = a
--      TRANSFORMATION into the shared clients table (no duplicate): the
--      prospect row keeps status='converted' + converted_client_id as a
--      breadcrumb.
--
--   B. TENDER (a raw call for tenders), with TWO opposite behaviours:
--      • type 'open'   — to DEFEND: attach it to a company (client or
--        prospect = the bidding partner) → it becomes an AFFAIR under
--        that client (source='tender', source_tender_id).
--      • type 'result' — already awarded: competitor intel. Companies
--        inside it live in tender_participants (winner, bid, reasons);
--        each row is promotable to a prospect in one click. Tender after
--        tender this builds the competitor map for free.
--
-- Also here (deferred from m102): affairs.source_tender_id — the link
-- from a deal back to the tender intel it came from (§9.2).
--
-- RLS: the sandbox is a SHARED POOL for the sales org (the lead manager
-- deposits, salespeople pick) — so reads are open to all signed-in
-- users; writes are creator/owner/management.
--
-- Access: new capability 'prospect.access' gates the /prospects page and
-- its nav link (capability→menu→page→action pattern). Default grants:
-- sales, sales_director, admin, super_admin.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) prospects — companies to approach.
-- ---------------------------------------------------------------------
create table if not exists prospects (
  id           uuid primary key default gen_random_uuid(),
  company_name text not null,
  country      text,
  contact_name text,
  email        text,
  phone        text,
  notes        text,
  source       text not null default 'manual'
                 check (source in ('manual', 'import', 'tender')),
  status       text not null default 'new'
                 check (status in ('new', 'contacted', 'qualified', 'converted', 'discarded')),
  -- transformation breadcrumb — set when switched to a client
  converted_client_id uuid references clients(id) on delete set null,
  owner_id     uuid references auth.users(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_prospects_status on prospects(status);

-- ---------------------------------------------------------------------
-- 2) tenders — raw calls for tenders (open = to defend / result = intel).
-- ---------------------------------------------------------------------
create table if not exists tenders (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  reference   text,            -- official tender reference, if any
  country     text,
  type        text not null check (type in ('open', 'result')),
  value       numeric,         -- estimated / awarded value (USD)
  deadline    date,            -- submission deadline (open type)
  notes       text,
  status      text not null default 'new'
                check (status in ('new', 'in_progress', 'converted', 'closed')),
  -- open type: the company carrying the bid (client OR prospect, not both)
  attached_client_id   uuid references clients(id) on delete set null,
  attached_prospect_id uuid references prospects(id) on delete set null,
  -- set when an open tender becomes an affair
  converted_affair_id  uuid references affairs(id) on delete set null,
  owner_id    uuid references auth.users(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_tenders_type on tenders(type, status);

-- ---------------------------------------------------------------------
-- 3) tender_participants — the competitor intel of a 'result' tender.
--    Each row = one company that bid (winner or not) + why. Promotable
--    to a prospect in one click (promoted_prospect_id breadcrumb).
-- ---------------------------------------------------------------------
create table if not exists tender_participants (
  id           uuid primary key default gen_random_uuid(),
  tender_id    uuid not null references tenders(id) on delete cascade,
  company_name text not null,
  country      text,
  is_winner    boolean not null default false,
  bid_value    numeric,
  notes        text,           -- why they won / why excluded — the intel
  promoted_prospect_id uuid references prospects(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_tender_participants_tender
  on tender_participants(tender_id);

-- ---------------------------------------------------------------------
-- 4) circular + outbound links (added after both tables exist):
--    prospect generated from a result tender, and the affair → tender
--    intel link deferred from m102.
-- ---------------------------------------------------------------------
alter table prospects
  add column if not exists source_tender_id uuid references tenders(id) on delete set null;

alter table affairs
  add column if not exists source_tender_id uuid references tenders(id) on delete set null;

create index if not exists idx_affairs_source_tender on affairs(source_tender_id);

-- ---------------------------------------------------------------------
-- 5) RLS — shared sandbox: open reads for signed-in users; writes by
--    creator/owner or management. Mirrors the spirit of the pool.
-- ---------------------------------------------------------------------
alter table prospects enable row level security;
alter table tenders enable row level security;
alter table tender_participants enable row level security;

drop policy if exists "prospects read" on prospects;
create policy "prospects read" on prospects for select
  using (auth.role() = 'authenticated');

drop policy if exists "prospects insert" on prospects;
create policy "prospects insert" on prospects for insert
  with check (created_by = auth.uid());

drop policy if exists "prospects update" on prospects;
create policy "prospects update" on prospects for update using (
  created_by = auth.uid()
  or owner_id = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations', 'sales_director')
            or coalesce(r.super_admin, false))
  )
);

drop policy if exists "prospects delete" on prospects;
create policy "prospects delete" on prospects for delete using (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role = 'admin' or coalesce(r.super_admin, false))
  )
);

drop policy if exists "tenders read" on tenders;
create policy "tenders read" on tenders for select
  using (auth.role() = 'authenticated');

drop policy if exists "tenders insert" on tenders;
create policy "tenders insert" on tenders for insert
  with check (created_by = auth.uid());

drop policy if exists "tenders update" on tenders;
create policy "tenders update" on tenders for update using (
  created_by = auth.uid()
  or owner_id = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations', 'sales_director')
            or coalesce(r.super_admin, false))
  )
);

drop policy if exists "tenders delete" on tenders;
create policy "tenders delete" on tenders for delete using (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role = 'admin' or coalesce(r.super_admin, false))
  )
);

drop policy if exists "tender_participants read" on tender_participants;
create policy "tender_participants read" on tender_participants for select
  using (auth.role() = 'authenticated');

drop policy if exists "tender_participants write" on tender_participants;
create policy "tender_participants write" on tender_participants for all using (
  created_by = auth.uid()
  or exists (
    select 1 from tenders t
     where t.id = tender_participants.tender_id
       and (t.created_by = auth.uid() or t.owner_id = auth.uid())
  )
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations', 'sales_director')
            or coalesce(r.super_admin, false))
  )
) with check (
  created_by = auth.uid()
  or exists (
    select 1 from tenders t
     where t.id = tender_participants.tender_id
       and (t.created_by = auth.uid() or t.owner_id = auth.uid())
  )
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations', 'sales_director')
            or coalesce(r.super_admin, false))
  )
);

-- ---------------------------------------------------------------------
-- 6) Capability: prospect.access (page + nav gate, m090 pattern).
-- ---------------------------------------------------------------------
insert into permissions (key, category, label, description, sort_order) values
  ('prospect.access', 'CRM', 'Prospects & tenders sandbox',
   'Access the CRM sandbox: prospect companies and raw tenders.', 80)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  ('super_admin', 'prospect.access', true),
  ('admin', 'prospect.access', true),
  ('sales', 'prospect.access', true),
  ('sales_director', 'prospect.access', true),
  ('task_list_manager', 'prospect.access', false),
  ('operations', 'prospect.access', false),
  ('finance', 'prospect.access', false)
on conflict (role, permission_key) do nothing;

notify pgrst, 'reload schema';

commit;
