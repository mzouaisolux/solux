-- =====================================================================
-- m110 — Tender qualification & conversion workflow.
-- =====================================================================
--
-- The tender module becomes a real commercial WORKFLOW, not a list:
--
--   New → (Accept | Reject) → Searching Partner → Partner Assigned →
--   Contacted → Waiting Feedback → Interested → Quotation Requested →
--   Opportunity Created   (terminal alternatives: Rejected / Lost)
--
--   • Reject requires a REASON (fixed list) + a mandatory comment, and
--     stays visible to the Sales Director / lead manager for review.
--   • Accept stamps accepted_at and makes the salesperson responsible.
--   • tender_followups = the follow-up history (contact attempts,
--     communications, feedback, commercial progress) — date + comment,
--     next actions stay in planned_actions (m107).
--   • converted_at powers the performance metrics (time-to-opportunity).
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Pipeline statuses — replace the m107 vocabulary; backfill mapping.
-- ---------------------------------------------------------------------
alter table tenders drop constraint if exists tenders_commercial_status_check;

update tenders set commercial_status = case commercial_status
  when 'to_qualify'         then 'new'
  when 'interesting'        then 'accepted'
  when 'partner_identified' then 'partner_assigned'
  when 'preparing_bid'      then 'interested'
  when 'submitted'          then 'quotation_requested'
  when 'won'                then 'opportunity_created'
  else commercial_status
end
where commercial_status in
  ('to_qualify','interesting','partner_identified','preparing_bid','submitted','won');

alter table tenders add constraint tenders_commercial_status_check
  check (commercial_status in
    ('new','accepted','searching_partner','partner_assigned','contacted',
     'waiting_feedback','interested','quotation_requested',
     'opportunity_created','rejected','lost'));

-- ---------------------------------------------------------------------
-- 2) Qualification bookkeeping.
-- ---------------------------------------------------------------------
alter table tenders
  add column if not exists accepted_at     timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists rejected_comment text,
  add column if not exists rejected_by     uuid references auth.users(id) on delete set null,
  add column if not exists rejected_at     timestamptz,
  add column if not exists converted_at    timestamptz;

alter table tenders drop constraint if exists tenders_rejected_reason_check;
alter table tenders add constraint tenders_rejected_reason_check
  check (rejected_reason is null or rejected_reason in
    ('budget_too_small','outside_target_market','already_awarded',
     'specification_not_suitable','no_local_partner','political_country_risk',
     'duplicate_tender','not_strategic','other'));

-- ---------------------------------------------------------------------
-- 3) tender_followups — the follow-up history thread.
-- ---------------------------------------------------------------------
create table if not exists tender_followups (
  id          uuid primary key default gen_random_uuid(),
  tender_id   uuid not null references tenders(id) on delete cascade,
  kind        text not null default 'communication'
                check (kind in ('contact_attempt','communication','feedback','progress')),
  comment     text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_tender_followups_tender
  on tender_followups(tender_id, created_at desc);

alter table tender_followups enable row level security;

-- Visibility follows the tender (m108 scoping for sales; directors all).
drop policy if exists "tender_followups read" on tender_followups;
create policy "tender_followups read" on tender_followups for select using (
  exists (select 1 from tenders t where t.id = tender_followups.tender_id)
);

drop policy if exists "tender_followups write" on tender_followups;
create policy "tender_followups write" on tender_followups for all using (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations', 'sales_director')
            or coalesce(r.super_admin, false))
  )
) with check (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations', 'sales_director')
            or coalesce(r.super_admin, false))
  )
);

notify pgrst, 'reload schema';

commit;
