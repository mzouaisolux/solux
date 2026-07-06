-- =====================================================================
-- m147 — Fix duplicate document numbers (500 on save)
-- ---------------------------------------------------------------------
-- Symptom: saving a NEW quotation/proforma intermittently 500s with
--   duplicate key value violates unique constraint "documents_number_key"
-- for some clients (deterministic per client), independent of line content
-- (custom-pole-only quotes hit it too — that was a coincidence of testing).
--
-- Root cause: next_client_document_number() (m006) mints the next sequence
-- but runs as SECURITY INVOKER and counts existing documents under the
-- CALLER's RLS scope. A sales rep only sees documents where
-- created_by = auth.uid() (m046 "documents read scoped"), so the counter
-- UNDERCOUNTS whenever the client's number space already holds rows the rep
-- cannot see:
--   • documents created by ANOTHER rep for the same client, or
--   • documents of ANOTHER client that shares the same 3-letter client_code
--     (dup codes persist until m145 dedup is applied).
-- It then returns an already-taken sequence, and documents.number carries a
-- GLOBAL single-column UNIQUE constraint (documents_number_key), so the
-- insert is rejected → 500.
--
-- Fix (two independent parts):
--   • This migration — make the RPC authoritative:
--       - SECURITY DEFINER (+ pinned search_path) so it counts EVERY document
--         in the number space, not just the caller's RLS-visible rows.
--       - Scope the counter by the PREFIX (number space) instead of by
--         client_id, so two clients sharing a code draw from one monotonic
--         sequence and can never collide.
--   • App-side (already shipped in app/(app)/documents/new/actions.ts) — treat
--     the RPC value as a starting guess and probe upward on the unique
--     violation. That keeps saving correct even before this migration is
--     applied; this migration removes the cause so the probe is never needed.
--
-- Safe to run repeatedly (create or replace). No data change.
-- =====================================================================

begin;

create or replace function next_client_document_number(client_id_in uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
  start_seq int;
  yr text := to_char(now(), 'YY');
  prior_count int;
  prefix text;
  highest int;
  next_seq int;
begin
  select client_code, coalesce(starting_sequence_number, 0)
    into code, start_seq
    from clients
   where id = client_id_in;

  if code is null then
    raise exception 'Client has no client_code — please set a 3-letter code on the client first.';
  end if;

  prefix := 'SLX-' || code || '-' || yr || '-';

  -- Highest existing sequence across the WHOLE number space (every client that
  -- shares this prefix), NOT just this client_id. documents.number is globally
  -- unique, so the counter has to be too. Revision suffixes ("-V{n}") don't end
  -- in a bare sequence and are ignored by the regexp, exactly as before.
  select coalesce(max((regexp_match(number, '-([0-9]+)$'))[1]::int), 0)
    into highest
    from documents
   where number like prefix || '%';

  -- Defensive count (legacy/non-standard numbers that the regexp misses).
  select count(*) into prior_count
    from documents
   where number like prefix || '%';

  -- greatest(...) + 1 is always strictly above every existing sequence in the
  -- space, so the returned number can never already exist.
  next_seq := greatest(highest, start_seq + prior_count) + 1;

  return prefix || lpad(next_seq::text, 3, '0');
end; $$;

notify pgrst, 'reload schema';

commit;
