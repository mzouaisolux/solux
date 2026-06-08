-- Quotation status workflow: draft / sent / won / lost.
-- Run in Supabase SQL Editor. Idempotent.

begin;

-- Normalize any legacy values (we previously allowed accepted/rejected).
update documents set status = 'won'  where status = 'accepted';
update documents set status = 'lost' where status = 'rejected';
update documents set status = 'draft' where status is null or status = '';

-- Re-create the CHECK constraint over the new set.
alter table documents drop constraint if exists documents_status_check;
alter table documents
  add constraint documents_status_check
    check (status in ('draft', 'sent', 'won', 'lost'));

-- Ensure the default is draft for new rows.
alter table documents alter column status set default 'draft';

-- Index for status filtering in the dashboard.
create index if not exists idx_docs_status_date on documents(status, date desc);

notify pgrst, 'reload schema';

commit;
