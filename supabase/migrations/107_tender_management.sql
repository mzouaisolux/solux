-- =====================================================================
-- m107 — Tender management module (sandbox → import-driven module).
-- =====================================================================
--
-- The Tenders section of the CRM sandbox (m104) evolves into a real
-- tender-management module fed by automatic JSON imports from the
-- tender-intelligence tool. Principles:
--
--   • The JSON import is the source of truth for EXTERNAL data
--     (general info, qualification, budget, contact, specs, documents).
--   • CRM-internal fields are NEVER touched by an import:
--     owner_id, notes, commercial_status, attachments, planned actions.
--   • Dedup key = title + buyer + closing date, normalised and stored
--     in `import_key` (unique partial index) so re-imports UPDATE.
--   • `specs` and `documents` are jsonb — the UI renders whatever keys
--     arrive, so future tender formats stay compatible with no schema
--     change.
--   • Future workflow (import → assign → partner → convert → pipeline)
--     is already covered: commercial_status carries the stages, and the
--     m104 columns (attached_client_id / attached_prospect_id /
--     converted_affair_id + the open→affair conversion) are the
--     conversion path. No redesign needed later.
--
-- Also: planned_actions (m103) learn to attach to a TENDER as well as
-- an affair — "next actions, same logic as the rest of the CRM".
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) tenders — external data columns (refreshed by every import).
--    `title` / `country` / `type` / `value` (= amount) / `deadline`
--    (= closing date) / `reference` / `notes` already exist (m104).
-- ---------------------------------------------------------------------
alter table tenders
  add column if not exists city             text,
  add column if not exists buyer            text,
  add column if not exists platform         text,
  add column if not exists source_url       text,
  add column if not exists publication_date date,
  -- qualification
  add column if not exists score            integer,
  add column if not exists relevance        text,
  add column if not exists solar_confirmed  boolean,
  -- budget (value = amount, m104)
  add column if not exists currency         text,
  add column if not exists budget_usd       numeric,
  -- contact
  add column if not exists contact_name     text,
  add column if not exists contact_email    text,
  add column if not exists contact_phone    text,
  add column if not exists contact_phone2   text,
  -- dynamic payloads
  add column if not exists specs            jsonb not null default '{}'::jsonb,
  add column if not exists documents        jsonb not null default '[]'::jsonb,
  -- commercial pipeline (CRM-internal; the import never writes it)
  add column if not exists commercial_status text not null default 'new',
  -- import bookkeeping
  add column if not exists import_key       text,
  add column if not exists imported_at      timestamptz,
  add column if not exists last_import_at   timestamptz;

alter table tenders drop constraint if exists tenders_commercial_status_check;
alter table tenders add constraint tenders_commercial_status_check
  check (commercial_status in
    ('new', 'to_qualify', 'interesting', 'partner_identified',
     'preparing_bid', 'submitted', 'lost', 'won'));

-- Dedup: one row per (title + buyer + closing date), normalised app-side.
create unique index if not exists uq_tenders_import_key
  on tenders(import_key) where import_key is not null;

create index if not exists idx_tenders_score on tenders(score);
create index if not exists idx_tenders_deadline on tenders(deadline);

-- ---------------------------------------------------------------------
-- 2) planned_actions — may now hang off a TENDER instead of an affair.
--    At least one anchor is required.
-- ---------------------------------------------------------------------
alter table planned_actions alter column affair_id drop not null;
alter table planned_actions
  add column if not exists tender_id uuid references tenders(id) on delete cascade;

alter table planned_actions drop constraint if exists planned_actions_target_check;
alter table planned_actions add constraint planned_actions_target_check
  check (affair_id is not null or tender_id is not null);

create index if not exists idx_planned_actions_tender on planned_actions(tender_id);

-- RLS: recreate the m103 policies with a tender branch. Tenders are the
-- shared sandbox pool (read = authenticated), so tender actions follow:
-- read for all signed-in users; writes by creator, tender owner/creator,
-- or management.
drop policy if exists "planned_actions read scoped" on planned_actions;
create policy "planned_actions read scoped" on planned_actions for select using (
  (affair_id is not null and exists (select 1 from affairs a where a.id = planned_actions.affair_id))
  or (tender_id is not null and auth.role() = 'authenticated')
);

drop policy if exists "planned_actions write scoped" on planned_actions;
create policy "planned_actions write scoped" on planned_actions for all using (
  created_by = auth.uid()
  or exists (
    select 1 from affairs a
     where a.id = planned_actions.affair_id
       and (a.owner_id = auth.uid() or a.created_by = auth.uid())
  )
  or exists (
    select 1 from tenders t
     where t.id = planned_actions.tender_id
       and (t.owner_id = auth.uid() or t.created_by = auth.uid())
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
    select 1 from affairs a
     where a.id = planned_actions.affair_id
       and (a.owner_id = auth.uid() or a.created_by = auth.uid())
  )
  or exists (
    select 1 from tenders t
     where t.id = planned_actions.tender_id
       and (t.owner_id = auth.uid() or t.created_by = auth.uid())
  )
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations', 'sales_director')
            or coalesce(r.super_admin, false))
  )
);

notify pgrst, 'reload schema';

commit;
