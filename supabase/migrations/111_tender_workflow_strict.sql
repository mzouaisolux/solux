-- =====================================================================
-- m111 — Strict tender qualification workflow.
-- =====================================================================
--
-- 1) CORRECTIVE BACKFILL — m110 mapped the old test status 'interesting'
--    to 'accepted', which short-circuited qualification for existing
--    rows: they showed as Accepted although nobody ever clicked Accept.
--    A REAL accept always stamps accepted_at, so any 'accepted' row
--    without accepted_at goes back to 'new' and must be qualified.
--
-- 2) COMMERCIAL JOURNAL — the follow-up kinds become the full business
--    vocabulary; journal entries AUTO-ADVANCE the pipeline (app layer):
--      contact_attempt / email_sent / meeting → Contacted
--      waiting_feedback                       → Waiting Feedback
--      interested / technical_discussion      → Interested
--      quotation_requested                    → Quotation Requested
--      not_interested                         → back to Searching Partner
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- 1) Un-accept rows that were never explicitly accepted.
update tenders
   set commercial_status = 'new'
 where commercial_status = 'accepted'
   and accepted_at is null;

-- 2) Journal kinds — full commercial vocabulary (legacy kinds kept so
--    existing rows stay valid).
alter table tender_followups drop constraint if exists tender_followups_kind_check;
alter table tender_followups add constraint tender_followups_kind_check
  check (kind in (
    'contact_attempt', 'email_sent', 'meeting', 'interested',
    'not_interested', 'waiting_feedback', 'technical_discussion',
    'quotation_requested',
    -- legacy (m110) values
    'communication', 'feedback', 'progress'
  ));

notify pgrst, 'reload schema';

commit;
