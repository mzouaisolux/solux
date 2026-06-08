-- Payment terms on documents.
-- Run in Supabase SQL editor. Idempotent.

begin;

alter table documents
  add column if not exists payment_mode text
    check (payment_mode in ('deposit_balance','lc','hybrid'));

alter table documents
  add column if not exists payment_terms jsonb;

commit;
