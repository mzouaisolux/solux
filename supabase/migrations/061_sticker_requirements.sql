-- =====================================================================
-- m061 — Sticker / label requirements on the task list.
-- =====================================================================
--
-- Sticker + label details are frequently forgotten during production:
-- global product stickers, component / battery / panel stickers,
-- customer branding, certification labels — each with its own
-- positioning + instructions. This captures them as a structured
-- checklist on the production task list so the factory has an explicit
-- spec instead of relying on memory.
--
-- Stored as JSONB (nested, display-oriented — feeds the production
-- handoff, not aggregate reporting):
--
--   {
--     "items": [
--       { "kind": "global_product", "label": "...", "required": true,
--         "positioning": "...", "note": "...", "custom": false }
--     ],
--     "notes": "general sticker instructions"
--   }
--
-- Artwork files (logo / packaging PDF) are uploaded via the Attachments
-- panel (type Logo / Packaging artwork) — this section is the spec.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table production_task_lists
  add column if not exists sticker_requirements jsonb;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'production_task_lists'
--      and column_name = 'sticker_requirements';
--   -- Expected: 1 row
-- ---------------------------------------------------------------------
