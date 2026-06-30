-- =====================================================================
-- m112 — Tender Pipeline (dedicated workspace for accepted tenders).
-- =====================================================================
--
-- Business logic: the import list (/prospects) is for DISCOVERY only;
-- accepted tenders move into the Tender Pipeline (/prospects/pipeline)
-- where the commercial work happens:
--
--   Accepted → Searching Partner → Partner Identified → Contacted →
--   Waiting Feedback → Interested → Project Request → Opportunity Created
--
-- Schema change: the 'quotation_requested' stage becomes
-- 'project_request' — the moment the technical request is created from
-- the tender (the journal kind "Quotation requested" now advances to
-- this stage; creating a Project Request from the tender advances it
-- automatically). 'partner_assigned' keeps its DB value but displays as
-- "Partner Identified".
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table tenders drop constraint if exists tenders_commercial_status_check;

update tenders
   set commercial_status = 'project_request'
 where commercial_status = 'quotation_requested';

alter table tenders add constraint tenders_commercial_status_check
  check (commercial_status in
    ('new','accepted','searching_partner','partner_assigned','contacted',
     'waiting_feedback','interested','project_request',
     'opportunity_created','rejected','lost'));

notify pgrst, 'reload schema';

commit;
