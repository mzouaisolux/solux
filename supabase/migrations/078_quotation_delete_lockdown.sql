-- =====================================================================
-- m078 — Lock down quotation deletion (Decision F). Tightens m057.
-- =====================================================================
--
-- m057 let owners delete their quotations at ANY status. Decision F: a
-- WON quotation is a commercial commitment and must not be freely deleted;
-- a quotation with a task list / production order must be cancelled or
-- archived (deleting would silently cascade and wipe production records,
-- since production_task_lists / production_orders FK to documents are
-- ON DELETE CASCADE).
--
-- This migration tightens the DB delete policy (defense-in-depth):
--   • OWNERS may delete only NON-committed quotations
--     (status in draft / sent / negotiating).
--   • admin / super-admin may delete any status.
-- The app action (deleteQuotation) additionally BLOCKS deleting anything
-- that has a task list / production order, for everyone — RLS can't cheaply
-- check downstream existence, so the action is the guard there.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase after a backup.
-- =====================================================================

begin;

drop policy if exists "documents delete scoped" on documents;
create policy "documents delete scoped" on documents for delete using (
  (
    created_by = auth.uid()
    and status in ('draft', 'sent', 'negotiating')
  )
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role = 'admin' or coalesce(r.super_admin, false))
  )
);

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK (run separately):
--   -- as a SALES user who owns a WON quote → should now FAIL:
--   delete from documents where id = '<own-won-uuid>';   -- expect 0 rows / blocked
--   -- as a sales user who owns a DRAFT → should still succeed.
--
-- ROLLBACK (restore m057 status-agnostic owner delete):
--   begin;
--   drop policy if exists "documents delete scoped" on documents;
--   create policy "documents delete scoped" on documents for delete using (
--     created_by = auth.uid()
--     or exists (select 1 from user_roles r where r.user_id = auth.uid()
--                and (r.role = 'admin' or coalesce(r.super_admin, false))));
--   notify pgrst, 'reload schema';
--   commit;
-- ---------------------------------------------------------------------
