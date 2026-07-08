-- =====================================================================
-- m151 — Project Documents SSoT Lot 4: attachment version history
-- =====================================================================
--
-- "Replace" on a manual upload used to DELETE the old row + file. Now it
-- creates a NEW version of the same logical document (mirror of the
-- order_documents m099 pattern): group_id chains the versions, the
-- highest version is Current, older versions stay downloadable behind
-- "Latest only". A fresh version restarts at doc_status 'draft' (same
-- re-approval rule as PO documents).
--
-- The app reads/writes these columns DEFENSIVELY: pre-migration, Replace
-- falls back to the legacy delete-old behaviour, so deploying code first
-- is safe.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

alter table attachments
  add column if not exists group_id uuid,
  add column if not exists version int not null default 1;

-- Existing rows: each is its own single-version group.
update attachments set group_id = id where group_id is null;

create index if not exists idx_attachments_group
  on attachments(group_id, version desc);

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('151_attachment_versions.sql',
        'Project Documents SSoT Lot 4: attachments group_id + version (Replace = new version, history kept)')
on conflict (filename) do nothing;

commit;
