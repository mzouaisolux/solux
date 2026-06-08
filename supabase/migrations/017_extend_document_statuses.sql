-- Extend quotation status workflow with two additional values used by the
-- new operational Clients workspace:
--
--   negotiating — active commercial discussion (post-sent, pre-won)
--   cancelled   — terminal, abandoned (distinct from "lost" which means
--                 the customer chose another supplier)
--
-- The existing four (draft / sent / won / lost) remain valid, so no data
-- migration is needed.
--
-- Run in Supabase SQL Editor. Idempotent.

begin;

alter table documents
  drop constraint if exists documents_status_check;

alter table documents
  add constraint documents_status_check
  check (status in ('draft', 'sent', 'negotiating', 'won', 'lost', 'cancelled'));

notify pgrst, 'reload schema';

commit;
