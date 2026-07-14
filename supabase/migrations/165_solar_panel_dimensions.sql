-- =====================================================================
-- m165 — Solar Panel Dimensions on the costing (feature #6)
-- =====================================================================
-- Operations records the PHYSICAL dimensions of the panel actually used in
-- the cost calculation (e.g. "1722 × 1134 mm"), so any user sees the retained
-- panel format at a glance without opening the costing Excel. Sits next to the
-- other m157 "actual panel used" columns on project_requests, written by
-- enterFactoryCost. Idempotent — safe to run in the Supabase SQL Editor.
-- =====================================================================

alter table public.project_requests
  add column if not exists solar_panel_dimensions text;

comment on column public.project_requests.solar_panel_dimensions is
  'Physical dimensions of the solar panel used in the cost calc, e.g. "1722 × 1134 mm" (feature m165). Complements the mandatory costing Excel.';

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('165_solar_panel_dimensions.sql',
        'Solar panel physical dimensions on the costing (project_requests.solar_panel_dimensions text), mandatory in enterFactoryCost — visible panel format without opening the Excel.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';
