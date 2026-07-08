-- =====================================================================
-- m157 — Service Request = dossier technique (owner spec 2026-07-08).
-- =====================================================================
--
-- A Service Request must preserve HOW the price was built, not only the
-- price: the costing Excel, the REAL solar panel used (a 150W panel today
-- won't have tomorrow's dimensions — TOPCon/HJT cells keep improving),
-- and the pole drawing used for the quotation. In 5–10 years anyone must
-- be able to open the SR and find the full technical basis of the offer.
--
--   1. project_request_files gains two categories:
--        'costing'      — the costing Excel (supplier / internal / final
--                         calculation). COST-SENSITIVE: the app only
--                         shows it to project.view_cost holders.
--        'pole_drawing' — the pole drawing used for the quotation
--                         (strongly recommended, never blocking).
--      (Same drop-&-re-add pattern as m094's 'packing'.)
--
--   2. project_requests gains the REAL panel used (entered by Ops at
--      costing time — distinct from solar_panel_size, which is what
--      Sales REQUESTED):
--        solar_panel_power_w      numeric  — actual power (W)
--        solar_panel_length_mm    numeric  — frame length (mm)
--        solar_panel_width_mm     numeric  — frame width (mm)
--        solar_panel_thickness_mm numeric  — frame thickness (mm)
--        solar_panel_reference    text     — supplier model/reference
--
-- The app is DORMANT before this migration (uploaders and panel-spec
-- inputs are gated on this ledger row) — deploy code first, then apply.
--
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL editor.
-- =====================================================================

begin;

-- 1) File categories (extend the check — m094 pattern).
alter table project_request_files
  drop constraint if exists project_request_files_category_check;
alter table project_request_files
  add constraint project_request_files_category_check
  check (category in (
    'tender','spec','drawing','image','requirement','packing',
    'costing','pole_drawing','other'
  ));

-- 2) Real solar panel used for the costing.
alter table project_requests
  add column if not exists solar_panel_power_w      numeric,
  add column if not exists solar_panel_length_mm    numeric,
  add column if not exists solar_panel_width_mm     numeric,
  add column if not exists solar_panel_thickness_mm numeric,
  add column if not exists solar_panel_reference    text;

-- 3) Ledger (m113 rule) — the app gates the new UI on this exact row.
insert into schema_migrations (filename, note)
values ('157_sr_technical_dossier.sql',
        'SR technical dossier: costing/pole_drawing file categories + real solar panel columns (power W, L/W/T mm, supplier reference).')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'project_request_files_category_check';
--   select column_name from information_schema.columns
--    where table_name = 'project_requests' and column_name like 'solar_panel_%';
-- ---------------------------------------------------------------------
