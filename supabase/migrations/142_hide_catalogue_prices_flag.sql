-- =====================================================================
-- m142 — TEMPORARY test-phase flag: hide catalogue prices from sales
-- =====================================================================
--
-- Real-world test phase (owner decision 2026-07-03): while testing, the
-- quotation builder must NOT surface catalogue prices to sales. Prices
-- come from an approved Service Request costing or manual entry only.
-- This is a VISIBILITY flag — zero change to pricing data, saving,
-- pricing_source (m139 lock) or the PDF. Flip the flag off to restore
-- today's behaviour instantly.
--
--   app_settings 'pricing.hide_catalogue_prices' → {"value": 0|1}
--     0 = off (default — catalogue prices visible, current behaviour)
--     1 = on  (prices hidden for roles without the capability below)
--
-- Delegation lever (same governance pattern as m122): the capability
-- `pricing.view_catalogue_prices` EXEMPTS a role from the hiding, so
-- admins/direction can check a catalogue price or compare it with an SR
-- price without disabling the flag company-wide. admin/super_admin also
-- pass via the anti-lockout floor in code, whether or not this seed ran.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

-- Flag, seeded OFF — enabling it is an explicit admin action.
insert into app_settings (key, value)
values ('pricing.hide_catalogue_prices', '{"value": 0}'::jsonb)
on conflict (key) do nothing;

insert into permissions (key, category, label, description, sort_order) values
  ('pricing.view_catalogue_prices', 'Pricing', 'View catalogue prices',
   'See catalogue tier prices in the quotation builder even while the test-phase "hide catalogue prices" flag is active.', 102)
on conflict (key) do nothing;

insert into role_permissions (role, permission_key, enabled) values
  -- floor in code, marked here for the matrix + clarity
  ('super_admin', 'pricing.view_catalogue_prices', true),
  ('admin',       'pricing.view_catalogue_prices', true)
on conflict (role, permission_key) do update set enabled = excluded.enabled;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('142_hide_catalogue_prices_flag.sql', 'test-phase flag: hide catalogue prices from sales (+ pricing.view_catalogue_prices exemption capability)')
on conflict (filename) do nothing;

commit;
