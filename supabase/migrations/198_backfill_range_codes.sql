-- 198_backfill_range_codes.sql
-- =============================================================================
-- Give every real product family a stable range_code so the Figma datasheet
-- integration (GET /api/specs?range=…) can look each one up by code instead of
-- a fragile display-name match. Extends m172 (which added the column + the
-- unique index and set the first code, SSLXPRO).
--
-- Convention (matches the 5 families already onboarded — SSLXPRO, COLARSUN,
-- AOSPERF, AOSPROPLUS, SSLXPERF): UPPERCASE, spaces/®/⁺ removed, "Performance"
-- -> PERF, "Plus"/"⁺" -> PLUS, trailing descriptors like "Series" dropped.
--
-- SAFETY / IDEMPOTENCY:
--   * Matches product_categories by EXACT name (name is UNIQUE, m163).
--   * Guarded by "range_code is null" — the 5 already-onboarded families are
--     never overwritten, and re-running this migration changes 0 rows.
--   * All 23 codes are distinct, so the unique index (m172) is satisfied.
--   * The three Unclassified demo families were removed in m174 and are not here.
-- =============================================================================

begin;

update product_categories pc
set range_code = v.code
from (values
  -- Integrated Solar Street Lights
  ('AOS Performance',  'AOSPERF'),      -- already set (m172-era); guard keeps it
  ('AOS Pro⁺',         'AOSPROPLUS'),   -- already set; guard keeps it
  -- Solar Columns
  ('Totem',            'TOTEM'),
  ('Totem⁺',           'TOTEMPLUS'),
  -- Solar Rehabilitation Kit
  ('ReLight Series',   'RELIGHT'),
  -- Split Solar Street Lights
  ('SSLX Performance', 'SSLXPERF'),     -- already set; guard keeps it
  ('SSLX Pro',         'SSLXPRO'),      -- already set (m172); guard keeps it
  -- Vertical Solar Street Lights
  ('Colarsun',         'COLARSUN'),     -- already set; guard keeps it
  -- Solar Bollards
  ('Ada',              'ADA'),
  ('Kansa',            'KANSA'),
  ('Koron',            'KORON'),
  ('Koto',             'KOTO'),
  ('Mara',             'MARA'),
  ('Mira',             'MIRA'),
  ('Ror',              'ROR'),
  ('Slinda',           'SLINDA'),
  ('Koni',             'KONI'),
  ('Konos Plus',       'KONOSPLUS'),
  ('Tholos',           'THOLOS'),
  ('Tiras',            'TIRAS'),
  ('Vasa',             'VASA'),
  ('SLK',              'SLK'),
  -- Vandal-Resistant Bollards
  ('Vandal',           'VANDAL')
) as v(name, code)
where pc.name = v.name
  and pc.range_code is null;

-- Report how many families now still lack a code (expect 0).
do $$
declare v_missing int;
begin
  select count(*) into v_missing from product_categories where range_code is null;
  raise notice 'm175: % famil(ies) still without a range_code after backfill.', v_missing;
end $$;

commit;

-- =============================================================================
-- POST-CHECK (run manually after apply):
--   -- Every family should now have a code (expect 0 rows):
--   select id, name from product_categories where range_code is null;
--   -- Full map:
--   select name, range_code from product_categories order by name;
-- =============================================================================
