-- =====================================================================
-- m100 — CRM step 1: link project_requests → affairs (affair_id).
-- =====================================================================
--
-- PLAN_CRM_SOLUX.md §4: today a project_request hangs directly off the
-- client, side-by-side with affairs instead of nested under them. If a
-- client has 3 affairs we cannot tell which technical request belongs to
-- which deal. The fix is a nullable FK so the hierarchy becomes:
--
--   clients → affairs → project_requests → documents/orders/…
--
-- Additive and non-breaking:
--   • NULLABLE — existing project_requests keep affair_id = null, no
--     backfill. The "no request without an affair" rule will apply to NEW
--     requests only, and is not enforced yet (the field stays optional).
--   • ON DELETE SET NULL — deleting an affair must NEVER delete or block
--     a project_request (same rule as documents/orders in m076).
--   • No RLS change: project_requests policies are untouched (a new
--     column inherits them), and affairs RLS (m076) already governs who
--     can read/create affairs.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table project_requests
  add column if not exists affair_id uuid
    references affairs(id) on delete set null;

create index if not exists idx_project_requests_affair
  on project_requests(affair_id);

notify pgrst, 'reload schema';

commit;
