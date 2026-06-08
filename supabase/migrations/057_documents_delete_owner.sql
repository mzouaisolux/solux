-- =====================================================================
-- m057 — Let quotation OWNERS delete their own quotations (any status).
-- =====================================================================
--
-- m055 granted sales/admin the quotation.delete CAPABILITY, but the RLS
-- DELETE policy on `documents` (m046) still allowed admin/super-admin
-- ONLY — so a sales rep's delete was silently blocked by the database,
-- regardless of the quotation's status.
--
-- This widens the policy: a user can delete a document they OWN
-- (created_by = auth.uid()) OR if they're admin/super-admin. It is
-- deliberately status-agnostic — drafts, sent, negotiating, won, lost,
-- cancelled are all deletable by their owner (workspace cleanup). The
-- FK cascade to a linked production order still applies; the UI confirm
-- warns about it.
--
-- The app-level capability (quotation.delete) + the UI confirm remain
-- the higher-level gate; this just stops RLS from blocking owners.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

drop policy if exists "documents delete scoped" on documents;
create policy "documents delete scoped" on documents for delete using (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role = 'admin' or coalesce(r.super_admin, false))
  )
);

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, as the sales user who owns a draft):
--   delete from documents where id = '<your-own-draft-uuid>';
--   -- Expected: succeeds (was previously blocked by RLS)
-- ---------------------------------------------------------------------
