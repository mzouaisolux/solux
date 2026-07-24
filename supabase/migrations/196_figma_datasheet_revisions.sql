-- 196_figma_datasheet_revisions.sql
-- =============================================================================
-- Option B: keep a REVISION history of glossy datasheets within a spec version,
-- so re-uploads (v1.2 r1, r2, …) don't lose the previous PDF and can be rolled
-- back. Powers POST /api/datasheets (the Figma plugin upload) + a CR report.
--
-- Minimal blast radius: spec_documents keeps its existing
-- unique(product_id, spec_version, kind), so all current writers
-- (approveRequest auto-stage, renderSpecSheet, recordUploadedSpecSheet) keep
-- working UNCHANGED. The CURRENT datasheet stays the single spec_documents row;
-- superseded revisions are copied into spec_document_archives before overwrite.
-- Additive + idempotent.
-- =============================================================================

-- Current row gains a revision counter + the factory source version (metadata).
alter table spec_documents add column if not exists revision int not null default 1;
alter table spec_documents add column if not exists source_version text;

-- History of superseded datasheet revisions.
create table if not exists spec_document_archives (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  spec_version text not null,
  kind text check (kind in ('auto','figma_override')),
  revision int not null default 1,
  storage_path text,
  storage_name text,
  template_version text,
  source_version text,
  created_by uuid references auth.users(id),
  archived_at timestamptz default now()
);

create index if not exists idx_spec_doc_archives_lookup
  on spec_document_archives (product_id, spec_version, kind, revision);

alter table spec_document_archives enable row level security;

-- Read: same audience as spec_documents (any authenticated user). Writes happen
-- ONLY through the service-role API (endpoint B), which bypasses RLS — so no
-- write policy is granted to sessions.
drop policy if exists "spec_document_archives read" on spec_document_archives;
create policy "spec_document_archives read" on spec_document_archives
  for select to authenticated using (true);
