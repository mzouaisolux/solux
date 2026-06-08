-- =====================================================================
-- m055 — Let Sales (and Admin) delete their own quotations.
-- =====================================================================
--
-- Sales reps accumulate test quotes, wrong drafts, duplicates and
-- abandoned versions — they need to clean their own workspace. The
-- quotation.delete capability was super-admin only; we extend it to
-- sales + admin.
--
-- Safety: RLS on `documents` (m046) still scopes DELETE to rows the
-- user OWNS (created_by = auth.uid()) for non-technical roles, so a
-- sales rep can only delete THEIR OWN quotations — never a colleague's.
-- The cascade to a linked production order only matters for won deals;
-- the UI confirm warns about it.
--
-- Granular per-action permissions (can_delete_quotation, can_duplicate,
-- can_download_pdf, can_edit_sent_quotes, …) can be layered on later —
-- they'd become new capability keys in this same matrix. For now this
-- one toggle unblocks the workspace-cleanup need.
--
-- Idempotent. Uses `on conflict ... do update` so it FLIPS the existing
-- (already-seeded) rows from false → true, not just inserts.
-- =====================================================================

begin;

insert into role_permissions (role, permission_key, enabled) values
  ('sales', 'quotation.delete', true),
  ('admin', 'quotation.delete', true)
on conflict (role, permission_key)
  do update set enabled = excluded.enabled, updated_at = now();

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   select role, enabled from role_permissions
--    where permission_key = 'quotation.delete' order by role;
--   -- Expected: admin=true, sales=true, super_admin=true
-- ---------------------------------------------------------------------
