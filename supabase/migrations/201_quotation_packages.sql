-- =====================================================================
-- m178 — Quotation package: the immutable "what we sent" record
--        (PRD-006). One row per SEND of a quotation, holding the merged
--        PDF (quotation + each line's PINNED datasheet) plus the exact
--        provenance of that send.
-- =====================================================================
--
-- WHY (PRD-006 · verified pain): the quote-to-win cycle is long (weeks to
-- months) and specs are versioned (3-4 releases/year). Today Solux cannot
-- reconstruct what it actually sent a customer: which datasheet, at which
-- spec revision, went with which quote. document_lines.spec_version_id (m177)
-- pins the spec per line for production, but nothing captures the delivered
-- PACKET. This table is that record: generated at SEND from the pins frozen
-- at that same moment, so the datasheet, the quote, and the pin can never
-- disagree, and the exact packet is retrievable forever.
--
-- WHAT
--   • quotation_packages — one immutable row per generation. Re-send/revise
--     writes a NEW row (revision + 1); rows are never overwritten. The merged
--     PDF lives in the existing `documents` storage bucket; `lines` records
--     the per-line provenance (pin + included/missing) so a partial packet
--     (custom poles / free-text lines with no published spec) is auditable,
--     not silent.
--
-- Additive + idempotent. Creates one new table; changes nothing existing.
-- Self-registers in schema_migrations (m113 rule). Apply manually in Supabase
-- (DDL) after backup, per project convention.
-- =====================================================================

begin;

create table if not exists quotation_packages (
  id                uuid primary key default gen_random_uuid(),
  -- The quotation this packet was built from. CASCADE: a deleted quotation
  -- takes its (historical) packages with it.
  document_id       uuid not null references documents(id) on delete cascade,
  -- Per-document revision. Each generation increments; unique below.
  revision          int  not null default 1,
  -- Snapshot of documents.version at generation time (which quote version
  -- the packet represents), so the record stands even if the doc is revised.
  quotation_version int,
  -- The merged PDF (quote + pinned datasheets) in the `documents` bucket.
  storage_path      text,
  storage_name      text,
  -- Per-line provenance: [{ line_id, product_id, spec_version_id, spec_label,
  -- included: bool, reason }]. `included=false` + reason ("no_product",
  -- "no_pin", "no_datasheet") is how a partial packet stays auditable.
  lines             jsonb not null default '[]'::jsonb,
  included_count    int  not null default 0,
  missing_count     int  not null default 0,
  -- Provenance of the generation itself.
  generated_at      timestamptz not null default now(),
  generated_by      uuid references auth.users(id) on delete set null
);

-- One row per (document, revision); a generation always takes the next number.
create unique index if not exists uq_quotation_packages_doc_revision
  on quotation_packages(document_id, revision);

-- The common read: latest package(s) for a quotation, newest first.
create index if not exists idx_quotation_packages_doc
  on quotation_packages(document_id, generated_at desc);

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('201_quotation_packages.sql',
        'Quotation package record (PRD-006): immutable one-row-per-send capture of the merged quote + pinned datasheets. Columns: document_id (FK documents ON DELETE CASCADE), revision (unique per doc), quotation_version, storage_path/name (documents bucket), lines jsonb (per-line pin + included/missing provenance), included_count/missing_count, generated_at/by. New table only; changes nothing existing.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, after apply):
--   select count(*) from quotation_packages;                    -- 0 on a fresh apply
--   -- newest package per quotation:
--   select document_id, max(revision) from quotation_packages group by document_id;
-- ---------------------------------------------------------------------
