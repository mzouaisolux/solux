-- =====================================================================
-- m181 — Complete cost configuration on Service Requests
--        (owner spec 2026-07-22).
-- =====================================================================
--
-- Costing kept bouncing between Sales and Operations because the SR only
-- captured 5 fixed product fields (LED / panel / battery / controller /
-- IoT) and no pole finish at all. Two additions close the gap:
--
--   1. project_requests.config_values (jsonb) — the SAME per-category
--      sales options the quotation exposes (config_fields engine), keyed
--      by field_name exactly like quotation/task-list lines. Captured at
--      SR time, scoped to the selected product family, and carried onto
--      the generated quotation's product line so factory mappings
--      resolve downstream with no re-typing.
--
--   2. project_requests.pole_spec (jsonb) — the cost-impacting pole
--      options that existed NOWHERE: surface treatment class (C3/C4/C5/
--      C5-M), galvanization/finish (hot-dip, powder coat, paint) and
--      colour (standard or custom RAL). Shape owned by lib/pole-spec.ts;
--      summarised into the pole line name (m135 convention) so the spec
--      survives quotation → proforma → task list → factory export.
--
-- The app is DORMANT before this migration (writes retry without the
-- columns, reads default to empty) — deploy code first, then apply.
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL editor.
-- =====================================================================

begin;

alter table project_requests
  add column if not exists config_values jsonb,
  add column if not exists pole_spec jsonb;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('181_sr_cost_configuration.sql',
        'SR cost configuration: project_requests.config_values (per-category sales options, same vocabulary as quotation lines) + project_requests.pole_spec (surface treatment C3/C4/C5/C5-M, galvanization/finish, colour — lib/pole-spec.ts). Operations receives the complete product + pole configuration from the first submission.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name from information_schema.columns
--    where table_name='project_requests'
--      and column_name in ('config_values','pole_spec');
-- ---------------------------------------------------------------------
