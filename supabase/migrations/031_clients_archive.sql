-- =====================================================================
-- Soft-archive for clients.
-- =====================================================================
--
-- Why
-- ---
-- Deleting a client currently fails whenever they have linked documents
-- (FK clients.id ← documents.client_id, ON DELETE NO ACTION). The UI
-- surfaced "1 error" with no recovery path. Hard-cascading the delete
-- would nuke commercial history (devis won, factures, POs) — unsafe for
-- a B2B operations app where the financial trail must survive.
--
-- Resolution: align with the existing soft-archive pattern (introduced
-- in migration 024 for documents / task lists / production orders).
-- Clients get an `archived_at` column. Archived clients are hidden from
-- the active list by default but keep all their linked history intact.
--
-- Hard deletes are still allowed via the action layer, BUT only when
-- the client has zero linked entities. Otherwise the action proposes
-- archiving instead.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table clients
  add column if not exists archived_at timestamptz;

-- Partial index — most list queries filter to active (archived_at IS
-- NULL). A regular index would waste storage on the bulk of rows that
-- never match the filter; a partial index keeps it tight.
create index if not exists idx_clients_active
  on clients (created_at desc)
  where archived_at is null;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke checks (run separately):
--
--   -- 1. Column exists
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'clients' and column_name = 'archived_at';
--
--   -- 2. Archive a client manually (replace UUID)
--   update clients set archived_at = now() where id = '...';
--
--   -- 3. Unarchive
--   update clients set archived_at = null where id = '...';
-- ---------------------------------------------------------------------
