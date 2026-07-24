-- =====================================================================
-- m182 — document_lines.include_datasheet: per-LINE "send this datasheet?"
--        choice (Change 1 — pick which specs go to the customer).
-- =====================================================================
--
-- WHY: documents.attach_datasheets (m179) is the per-QUOTE on/off switch for
-- the whole package. This adds per-LINE granularity underneath it: with attach
-- ON, the rep can still un-tick individual products so only the chosen spec
-- sheets go out. The spec-version PIN (provenance) is unaffected — it still
-- freezes on every line at send, regardless of this flag. This gates DELIVERY
-- of that line's datasheet only.
--
-- Behaviour:
--   • include_datasheet = true  → the line's pinned datasheet is eligible for
--     the customer send (subject to attach_datasheets being on + a datasheet
--     existing).
--   • include_datasheet = false → the line is excluded from the send (not a
--     "missing" gap — a deliberate choice).
--
-- Default true (owner: including every product's sheet is the normal case; the
-- rep un-ticks to drop one). Additive + idempotent; one nullable-safe boolean
-- with a default. Self-registers (m113 rule). Apply manually in Supabase (DDL).
-- =====================================================================

begin;

alter table document_lines
  add column if not exists include_datasheet boolean not null default true;

insert into schema_migrations (filename, note)
values ('205_document_line_include_datasheet.sql',
        'document_lines.include_datasheet (boolean, default true): per-line choice to include that product''s datasheet in the customer send (Change 1). Provenance pin still freezes at send regardless; this gates delivery of the line''s datasheet only. One additive column; changes nothing existing.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- Smoke (after apply):
--   select include_datasheet, count(*) from document_lines group by 1;  -- all true initially
