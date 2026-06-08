-- =====================================================================
-- m062 — Known risks / warnings on the task list.
-- =====================================================================
--
-- A lightweight risk-flag area so factory/ops can instantly spot a
-- risky project: non-standard panel dimensions, urgent lead time,
-- special packaging, custom sticker, a new (unvalidated) optic, a
-- mechanically-sensitive dimension, etc. The point is fast visual
-- awareness — not a workflow.
--
-- Stored as JSONB on the task list:
--   {
--     "items": [
--       { "key": "non_standard_panel", "label": "...", "active": true,
--         "note": "...", "custom": false }
--     ],
--     "notes": "free text"
--   }
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table production_task_lists
  add column if not exists risk_flags jsonb;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'production_task_lists'
--      and column_name = 'risk_flags';
--   -- Expected: 1 row
-- ---------------------------------------------------------------------
