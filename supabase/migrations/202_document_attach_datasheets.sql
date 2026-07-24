-- =====================================================================
-- m179 — documents.attach_datasheets: the per-quote "send the datasheets?"
--        choice (PRD-006 Phase 2). Decouples PROVENANCE from DELIVERY.
-- =====================================================================
--
-- WHY (PRD-006, refined): the spec-version PIN is the record of WHAT was quoted
-- and is frozen at SEND for every sent quotation, always — that is the "know"
-- half and never depends on this flag. DELIVERY is a separate choice: a rep may
-- want the pin on file without emailing the glossy datasheets with the quote.
-- This column carries that per-quotation choice, set in the Preview step.
--
-- Behaviour:
--   • attach_datasheets = true  → on send, build + deliver the merged package
--     (quote PDF + each line's pinned datasheet).
--   • attach_datasheets = false → on send, still FREEZE the pin (provenance),
--     but do NOT build/deliver the package.
--
-- Default true (owner: sending specs with the quote is the normal case; the rep
-- unchecks to suppress). Additive + idempotent; one nullable-safe boolean with a
-- default. Self-registers (m113 rule). Apply manually in Supabase (DDL).
-- =====================================================================

begin;

alter table documents
  add column if not exists attach_datasheets boolean not null default true;

insert into schema_migrations (filename, note)
values ('202_document_attach_datasheets.sql',
        'documents.attach_datasheets (boolean, default true): per-quote choice to attach the pinned datasheets to the customer send (PRD-006). Provenance pin still freezes at send regardless; this gates only package build/delivery. One additive column; changes nothing existing.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- Smoke (after apply):
--   select attach_datasheets, count(*) from documents group by 1;  -- all true initially
