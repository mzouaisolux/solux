-- =====================================================================
-- m068 — Advisory quotation validation ("Request validation").
-- =====================================================================
--
-- A LIGHT, ADVISORY review loop — deliberately not a hard approval gate.
-- A salesperson clicks "Request validation" on a quotation (e.g. an
-- unusual discount or payment terms) to flag it for a manager's eyes. A
-- manager (admin / super / TLM / operations) reviews and either Approves
-- or Requests changes, leaving a note. The salesperson is notified.
--
-- ADVISORY means: this NEVER blocks sending or marking a quote Won. It is
-- a review flag + audit trail, nothing more. So there is no new RLS — the
-- existing `documents` policies already govern who may read/update a row:
--   - the requester updates their own quote (sets it pending);
--   - a manager updates any quote (records the decision).
--
-- State lives in columns on `documents` (same pattern as the forecast and
-- affair_name fields). Re-requesting after "changes requested" just
-- overwrites the current state; the full history is in the events log
-- (doc.validation_requested / _approved / _rejected).
--
-- Idempotent: safe to run more than once.
-- =====================================================================

alter table documents
  add column if not exists validation_status text
    check (validation_status in ('pending', 'approved', 'rejected')),
  add column if not exists validation_requested_by uuid references auth.users(id),
  add column if not exists validation_requested_at timestamptz,
  add column if not exists validation_note text,
  add column if not exists validation_reviewed_by uuid references auth.users(id),
  add column if not exists validation_reviewed_at timestamptz,
  add column if not exists validation_review_note text;

-- The manager's "pending review" lookups filter on this; partial index
-- keeps it tiny (most quotes never enter the loop).
create index if not exists documents_validation_status_idx
  on documents (validation_status)
  where validation_status is not null;

notify pgrst, 'reload schema';
