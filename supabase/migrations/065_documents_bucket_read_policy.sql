-- =====================================================================
-- m065 — Storage read access for the private `documents` bucket.
-- =====================================================================
--
-- Problem: a Task List Manager opening a file a sales had uploaded got a
-- "file unavailable" / blank page. Project attachments + quotation PDFs
-- all live in the private `documents` Storage bucket and are served via
-- signed URLs. The attachments TABLE (m060) already lets technical roles
-- read the rows, but the FILE itself is governed by separate RLS on
-- `storage.objects` — and if that policy was owner-scoped (only the
-- uploader could read), a TLM's `createSignedUrl` failed.
--
-- This guarantees every AUTHENTICATED user can READ objects in the
-- `documents` bucket (so any sales / TLM / operations / admin can open a
-- file, regardless of who uploaded it). It is ADDITIVE — it does not
-- remove existing write/insert policies, so uploads keep working.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- Make sure the bucket exists + is private.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- READ: any authenticated user can read objects in this bucket.
drop policy if exists "documents bucket read (authenticated)" on storage.objects;
create policy "documents bucket read (authenticated)"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'documents');

-- WRITE / UPDATE / DELETE: keep authenticated access (idempotent — these
-- mirror the original setup so re-running can't accidentally lock uploads
-- out if the bucket was created without explicit policies).
drop policy if exists "documents bucket insert (authenticated)" on storage.objects;
create policy "documents bucket insert (authenticated)"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documents');

drop policy if exists "documents bucket update (authenticated)" on storage.objects;
create policy "documents bucket update (authenticated)"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'documents')
  with check (bucket_id = 'documents');

drop policy if exists "documents bucket delete (authenticated)" on storage.objects;
create policy "documents bucket delete (authenticated)"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'documents');

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select policyname, cmd from pg_policies
--    where schemaname='storage' and tablename='objects'
--      and policyname like 'documents bucket%';
--   -- Expected: read / insert / update / delete (authenticated)
-- ---------------------------------------------------------------------
