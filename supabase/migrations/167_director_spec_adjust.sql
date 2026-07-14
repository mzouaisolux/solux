-- =====================================================================
-- m167 — Director adjusts technical spec before approval (feature #5)
-- =====================================================================
-- When a Product Cost Request reaches the Sales Director, they can adjust the
-- requested technical parameters (solar panel power, battery, LED power)
-- WITHOUT bouncing the request back to Sales. The Sales-entered values are
-- NEVER overwritten: requested values stay in the original columns
-- (solar_panel_size / battery_spec / led_power); the Director's decision lives
-- in approved_* columns. Operations + downstream (pricing snapshot, quotation)
-- work with approved_* ?? requested. Every adjustment is audited via the
-- pr.spec_adjusted event (payload = requested → approved, by, reason).
-- Idempotent — safe to run in the Supabase SQL Editor.
-- =====================================================================

alter table public.project_requests
  add column if not exists approved_solar_panel_size text,
  add column if not exists approved_battery_spec text,
  add column if not exists approved_led_power text,
  add column if not exists spec_adjusted_by uuid references auth.users(id) on delete set null,
  add column if not exists spec_adjusted_at timestamptz,
  add column if not exists spec_adjust_reason text;

comment on column public.project_requests.approved_solar_panel_size is
  'Director-approved panel power (feature m167). NULL = requested value stands. Requested value (solar_panel_size) is never overwritten.';
comment on column public.project_requests.approved_battery_spec is
  'Director-approved battery spec (m167). NULL = requested value stands.';
comment on column public.project_requests.approved_led_power is
  'Director-approved LED power (m167). NULL = requested value stands.';

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('167_director_spec_adjust.sql',
        'Director spec adjustment before approval: approved_solar_panel_size / approved_battery_spec / approved_led_power + spec_adjusted_by/at/reason on project_requests. Requested (Sales) values are never overwritten; downstream works with approved ?? requested; audited via pr.spec_adjusted event.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';
