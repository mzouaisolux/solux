-- =====================================================================
-- m102 — CRM step 3: affairs.source (where the deal came from).
-- =====================================================================
--
-- PLAN_CRM_SOLUX.md §6: an affair enters through one of three doors —
--   • tender           — sourced by the tenders app / lead manager
--   • field            — a lead caught by a salesperson's relationship
--   • existing_client  — a returning client arriving with their own deal
-- (+ other, as an escape hatch.)
--
-- Tagging the door at creation is what lets us answer, in 6 months,
-- "where does the revenue actually come from?" (tender vs field vs
-- existing) and decide where to put the commercial energy.
--
-- Nullable — existing affairs stay untagged; the UI offers the select at
-- creation and allows setting it later from the affair page. The link to
-- tender intel (source tender id) will come with the prospects sandbox
-- (step 5), when the tenders table exists to point at.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table affairs
  add column if not exists source text;

alter table affairs drop constraint if exists affairs_source_check;
alter table affairs add constraint affairs_source_check
  check (source is null or source in ('tender', 'field', 'existing_client', 'other'));

create index if not exists idx_affairs_source on affairs(source);

notify pgrst, 'reload schema';

commit;
