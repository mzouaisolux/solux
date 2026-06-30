-- =====================================================================
-- m116 — Prospects & Tenders V2: tender attributions → prospect intel
-- =====================================================================
--
-- Business decision (owner, 2026-06-13): SOLUX is a manufacturer — we
-- rarely bid directly. Tender WINNERS and PARTICIPANTS (integrators,
-- EPCs, distributors) are our most strategic prospection base. Tender
-- attribution imports must therefore feed Prospect Companies
-- AUTOMATICALLY — deduplicated, scored, assignable — on the existing
-- Prospects & Tenders page. No new module.
--
-- What this migration does:
--
--   1. PROSPECT COMPANY fields — address/web/linkedin/leader + a
--      normalized `name_key` for deduplication ("AFRIK LONNYA" exists
--      ONCE across 2024/2025/2026). The key is app-computed
--      (lib/prospect-intel.normalizeCompanyKey) and backfilled here
--      with the SQL equivalent. NON-unique index on purpose: legacy
--      duplicates may exist — dedup is enforced by the import/create
--      paths + the merge tool, not by a constraint that would brick
--      the migration on day one.
--
--   2. STATUS MODEL v2 — new/assigned/contacted/lead/opportunity/
--      customer/rejected/blacklisted. Official rule: a LEAD only
--      exists after a RECIPROCAL interaction (a reply). An email sent
--      is NOT a lead; an assignment is NOT a lead. Backfill maps the
--      old values (qualified→lead, converted→customer,
--      discarded→rejected; new+owner→assigned).
--
--   3. TENDER STATS (denormalized counters) — participations, wins,
--      last participation/win dates. Source of truth stays
--      tender_participants (history kept for life); the counters are a
--      materialized cache REWRITTEN by the importer/merge tool
--      (same pattern as current_production_deadline). They make the
--      Tender Activity Score computable in lists at tens-of-thousands
--      scale without aggregate joins.
--
--   4. PROSPECT ACTIVITIES — the commercial log (email/call/whatsapp/
--      linkedin/meeting/note) with `is_reply` marking the reciprocal
--      interaction that turns a prospect into a LEAD.
--
--   5. merged_into_id — duplicate merge breadcrumb. Merged rows stay
--      (audit) but disappear from every list.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Prospect Company fields
-- ---------------------------------------------------------------------
alter table prospects
  add column if not exists name_key        text,
  add column if not exists address         text,
  add column if not exists website         text,
  add column if not exists linkedin_url    text,
  add column if not exists leader_name     text,
  add column if not exists leader_role     text,
  add column if not exists last_activity_at timestamptz,
  add column if not exists merged_into_id  uuid references prospects(id) on delete set null,
  add column if not exists tender_participations integer not null default 0,
  add column if not exists tender_wins            integer not null default 0,
  add column if not exists last_tender_participation_at date,
  add column if not exists last_tender_win_at           date;

-- Backfill name_key (SQL approximation of normalizeCompanyKey: lower,
-- unaccent-less trim + whitespace collapse — the app recomputes the
-- exact key on every write).
update prospects
   set name_key = regexp_replace(lower(trim(company_name)), '\s+', ' ', 'g')
 where name_key is null;

create index if not exists idx_prospects_name_key on prospects (name_key);
create index if not exists idx_prospects_owner    on prospects (owner_id);
create index if not exists idx_prospects_status   on prospects (status);
create index if not exists idx_prospects_merged   on prospects (merged_into_id) where merged_into_id is not null;

-- ---------------------------------------------------------------------
-- 2. Status model v2 + source list extension
-- ---------------------------------------------------------------------
alter table prospects drop constraint if exists prospects_status_check;

update prospects set status = 'lead'     where status = 'qualified';
update prospects set status = 'customer' where status = 'converted';
update prospects set status = 'rejected' where status = 'discarded';
update prospects set status = 'assigned' where status = 'new' and owner_id is not null;

alter table prospects add constraint prospects_status_check
  check (status in (
    'new', 'assigned', 'contacted', 'lead',
    'opportunity', 'customer', 'rejected', 'blacklisted'
  ));

alter table prospects drop constraint if exists prospects_source_check;
alter table prospects add constraint prospects_source_check
  check (source in (
    'manual', 'import', 'tender', 'tender_attribution', 'linkedin', 'salon'
  ));

-- ---------------------------------------------------------------------
-- 3. Tender history at scale
-- ---------------------------------------------------------------------
create index if not exists idx_tender_participants_prospect
  on tender_participants (promoted_prospect_id)
  where promoted_prospect_id is not null;

create index if not exists idx_tenders_type_only on tenders (type);

-- ---------------------------------------------------------------------
-- 4. Commercial activities log
-- ---------------------------------------------------------------------
create table if not exists prospect_activities (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references prospects(id) on delete cascade,
  kind         text not null check (kind in ('email', 'call', 'whatsapp', 'linkedin', 'meeting', 'note')),
  body         text,
  -- TRUE = the prospect ANSWERED (reciprocal interaction) — the only
  -- thing that may auto-advance a prospect to LEAD.
  is_reply     boolean not null default false,
  happened_at  timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_prospect_activities_prospect
  on prospect_activities (prospect_id, happened_at desc);

alter table prospect_activities enable row level security;

-- Shared sandbox pool — same visibility philosophy as prospects (m104):
-- every signed-in CRM user reads; writers are authenticated users (the
-- page itself is gated by prospect.access at every layer above).
drop policy if exists "prospect_activities read" on prospect_activities;
create policy "prospect_activities read" on prospect_activities
  for select to authenticated using (true);
drop policy if exists "prospect_activities write" on prospect_activities;
create policy "prospect_activities write" on prospect_activities
  for all to authenticated using (true) with check (true);

insert into schema_migrations (filename, note)
values ('116_prospect_intelligence.sql', 'Prospects & Tenders V2 — attributions → prospect companies')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK (run separately):
--   select status, count(*) from prospects group by status;
--   select count(*) from prospects where name_key is null;     -- → 0
--   select to_regclass('public.prospect_activities');          -- not null
--
-- ROLLBACK (destructive for new data):
--   begin;
--   drop table if exists prospect_activities;
--   alter table prospects
--     drop column if exists name_key, drop column if exists address,
--     drop column if exists website, drop column if exists linkedin_url,
--     drop column if exists leader_name, drop column if exists leader_role,
--     drop column if exists last_activity_at, drop column if exists merged_into_id,
--     drop column if exists tender_participations, drop column if exists tender_wins,
--     drop column if exists last_tender_participation_at, drop column if exists last_tender_win_at;
--   -- old status values cannot be restored automatically.
--   delete from schema_migrations where filename = '116_prospect_intelligence.sql';
--   notify pgrst, 'reload schema';
--   commit;
-- ---------------------------------------------------------------------
