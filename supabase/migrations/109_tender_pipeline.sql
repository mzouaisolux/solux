-- =====================================================================
-- m109 — Tender pipeline finalisation.
-- =====================================================================
--
-- 1) Opportunity pipeline gains the dedicated tender stage:
--      tender_review → partner_selection → quotation → negotiation → won
--    A tender-sourced opportunity now STARTS in 'tender_review'.
--
-- 2) project_requests.source_tender_id — a project request created from
--    a tender keeps the link, so context (buyer, closing date, imported
--    documents) stays readable AT THE SOURCE forever, and the future
--    workflow (tender → PR → quotation → order) needs no redesign.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) affairs.status — add 'tender_review' (name-agnostic re-create).
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'affairs'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table affairs drop constraint %I', c.conname);
  end loop;
end $$;

alter table affairs
  add constraint affairs_status_check check (status in (
    'lead','tender_review','partner_selection','opportunity','quotation',
    'negotiation','won','in_production','shipped','completed','lost','abandoned'
  ));

-- ---------------------------------------------------------------------
-- 2) project_requests → source tender link.
-- ---------------------------------------------------------------------
alter table project_requests
  add column if not exists source_tender_id uuid references tenders(id) on delete set null;

create index if not exists idx_project_requests_source_tender
  on project_requests(source_tender_id);

notify pgrst, 'reload schema';

commit;
