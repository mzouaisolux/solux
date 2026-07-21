-- =====================================================================
-- m176 — Solar-panel tilt angle: AI extraction provenance + conflict.
-- =====================================================================
--
-- m159 added production_task_lists.solar_panel_tilt_angle and an optional
-- Energy-Study AI assist; m160 added the explicit "AI Find" button. Two
-- things were missing, and together they made the AI look inert:
--
--   1. NO PROVENANCE. The confidence, source document and page were
--      computed, shown once in a toast, then dropped. After a refresh an
--      AI-read tilt was indistinguishable from a hand-typed one, so
--      nobody could answer "where does this 15° come from?".
--
--   2. THE AUTO-FILL NEVER FIRED. A task list is seeded with the tilt
--      Sales stated on the Service Request (mandatory there), so the
--      column is essentially never NULL — and the m159 auto-fill only
--      wrote `where solar_panel_tilt_angle is null`. The Energy Study's
--      value was extracted and silently discarded on every run.
--
-- The fix is NOT to let the study overwrite production: the tilt drives
-- the pole drawing. When the study disagrees with the stored value we
-- keep production, record the study's reading, and raise a PENDING
-- conflict for a human (owner decision 2026-07-21). The pole-drawing
-- checkpoint stays blocked while a conflict is pending.
--
--   tilt_ai_provenance jsonb — one blob (same pattern as industrial_spec
--     m159 / sticker_requirements m061), null when never extracted:
--       value, unit ('degrees'), basis (source-priority rank),
--       source_document, source_page, source_text (the sentence),
--       confidence (0..1), model, extracted_at,
--       ambiguous, candidates[] (every value the study stated),
--       resolution ('applied'|'pending'|'accepted_ai'|'kept_manual'),
--       resolved_by / resolved_at, manually_modified_after.
--     Normalized by lib/tilt-provenance.ts — the app never trusts the
--     raw stored shape.
--
-- The app is DORMANT before this migration (every read/write is guarded
-- and falls back to the m159 behaviour) — deploy code first, then apply.
--
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL editor.
-- =====================================================================

begin;

-- 1) Task list — the AI provenance blob for the tilt angle.
alter table production_task_lists
  add column if not exists tilt_ai_provenance jsonb;

-- 2) Ledger (m113 rule) — the app gates the new UI on this exact row.
insert into schema_migrations (filename, note)
values ('176_tilt_ai_provenance.sql',
        'Tilt AI provenance: production_task_lists.tilt_ai_provenance jsonb (value/unit/basis/source doc+page+sentence/confidence/model/extracted_at/ambiguous/candidates/resolution/manually_modified_after). Fixes the m159 auto-fill that never fired because the column is seeded from the SR.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name, data_type from information_schema.columns
--    where table_name = 'production_task_lists'
--      and column_name = 'tilt_ai_provenance';
--
--   -- task lists carrying an unresolved AI/production tilt disagreement
--   select id, number, solar_panel_tilt_angle,
--          tilt_ai_provenance->>'value'      as ai_value,
--          tilt_ai_provenance->>'confidence' as confidence,
--          tilt_ai_provenance->>'source_document' as source
--     from production_task_lists
--    where tilt_ai_provenance->>'resolution' = 'pending';
-- ---------------------------------------------------------------------
