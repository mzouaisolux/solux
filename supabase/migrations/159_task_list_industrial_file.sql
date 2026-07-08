-- =====================================================================
-- m159 — Task List = industrial production file (owner spec 2026-07-08).
-- =====================================================================
--
-- The Task List stops being a checklist and becomes the complete
-- industrial production file shared by Sales, Engineering, Purchasing,
-- Factory and After-Sales. This migration adds the missing production
-- parameters:
--
--   1. project_requests.solar_panel_tilt_angle (numeric, degrees) —
--      the tilt angle Sales must specify at Service Request time
--      (0/10/15/20/30/45° presets + custom). It later drives the pole
--      drawing and factory production instructions.
--
--   2. production_task_lists:
--        solar_panel_tilt_angle       numeric — the production value,
--          seeded from the SR at launch, overridable, auto-filled from
--          the Energy Study by the AI assist when detected.
--        pole_drawing_tilt_verified    boolean default false — the TLM
--          checkpoint "the pole drawing matches the required tilt
--          angle". Blocks Release-to-Production while a tilt angle is
--          set and unverified (evaluateRelease).
--        pole_drawing_tilt_verified_by uuid / _at timestamptz — audit.
--        industrial_spec               jsonb default '{}' — one blob
--          (same pattern as sticker_requirements m061 / risk_flags
--          m062) holding: pole_accessories (anchor bolts / nut caps /
--          grease, default included), packaging (neutral / SOLUX /
--          French-branch / customized-client version), user_manual
--          (SOLUX / neutral / customized + EN-FR-AR languages) and
--          spare_parts (structured table with factory naming).
--          Normalized by lib/industrial-spec.ts — the app never trusts
--          the raw shape.
--
-- The app is DORMANT before this migration (the new SR field, task-list
-- section and release checkpoint are gated on this ledger row / write
-- defensively) — deploy code first, then apply.
--
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL editor.
-- =====================================================================

begin;

-- 1) Service Request — the tilt angle Sales requests (degrees).
alter table project_requests
  add column if not exists solar_panel_tilt_angle numeric;

-- 2) Task list — production tilt + drawing checkpoint + industrial spec.
alter table production_task_lists
  add column if not exists solar_panel_tilt_angle numeric,
  add column if not exists pole_drawing_tilt_verified boolean not null default false,
  add column if not exists pole_drawing_tilt_verified_by uuid,
  add column if not exists pole_drawing_tilt_verified_at timestamptz,
  add column if not exists industrial_spec jsonb not null default '{}'::jsonb;

-- 3) Ledger (m113 rule) — the app gates the new UI on this exact row.
insert into schema_migrations (filename, note)
values ('159_task_list_industrial_file.sql',
        'Task List industrial file: SR + task-list solar_panel_tilt_angle, pole-drawing tilt checkpoint (verified/by/at), industrial_spec jsonb (pole accessories, packaging version, user manuals, spare parts).')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'production_task_lists'
--      and column_name in ('solar_panel_tilt_angle','pole_drawing_tilt_verified','industrial_spec');
--   select column_name from information_schema.columns
--    where table_name = 'project_requests' and column_name = 'solar_panel_tilt_angle';
-- ---------------------------------------------------------------------
