-- =====================================================================
-- Soft archive — hide-without-deleting model.
-- =====================================================================
--
-- Three different "operational closure" concepts, each with its own
-- semantics:
--
--   1. status = 'cancelled' / 'lost'
--      The deal/order failed or was aborted. The row stays visible so
--      sales/admin can see the history. Cancelled rows propagate (see
--      migration 023). Reversible by manually flipping status back.
--
--   2. archived_at IS NOT NULL  (this migration)
--      The work is OPERATIONALLY DONE — successful or failed — and we
--      want to stop seeing it in default lists. Reversible by setting
--      archived_at = NULL. Admin can archive; super-admin can mass-
--      archive.
--
--   3. Physical DELETE (super-admin only)
--      RGPD takedowns, deduplication, test data cleanup. Irreversible.
--      Reserved for super-admin via requireSuperAdmin().
--
-- This migration only adds the `archived_at` / `archived_by` columns.
-- Query filtering ("don't show archived by default") lives in the app
-- layer — to be wired in Étape 2.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ----------------------------------------------------------------------
-- 1. documents
-- ----------------------------------------------------------------------
alter table documents
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id);

create index if not exists idx_documents_active
  on documents (status, date desc)
  where archived_at is null;

-- ----------------------------------------------------------------------
-- 2. production_task_lists
-- ----------------------------------------------------------------------
alter table production_task_lists
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id);

create index if not exists idx_task_lists_active
  on production_task_lists (status, date desc)
  where archived_at is null;

-- ----------------------------------------------------------------------
-- 3. production_orders
-- ----------------------------------------------------------------------
alter table production_orders
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id);

create index if not exists idx_production_orders_active
  on production_orders (status, updated_at desc)
  where archived_at is null;

-- ----------------------------------------------------------------------
-- Note: no RLS policy changes here.
--
-- The existing select/update policies on each table already gate
-- visibility correctly. archived_at is just a column — it doesn't
-- create new privacy concerns. App-layer filtering will hide archived
-- rows from default views; super-admin can opt into seeing archived
-- rows via a query parameter (next step).
-- ----------------------------------------------------------------------

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- Verification (run separately):
-- =====================================================================
--   select column_name from information_schema.columns
--    where table_name in ('documents', 'production_task_lists', 'production_orders')
--      and column_name in ('archived_at', 'archived_by')
--    order by table_name, column_name;
--   -- Should return 6 rows (2 per table)
--
--   select count(*) as archivable_indexes
--     from pg_indexes
--    where indexname in (
--      'idx_documents_active',
--      'idx_task_lists_active',
--      'idx_production_orders_active'
--    );
--   -- Should return 3
