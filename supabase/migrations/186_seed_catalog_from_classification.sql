-- m163 — Seed the product catalog (families + SKUs) from the Solux
-- classification, so the Knowledge Hub, m162 hierarchy, and baseline spec
-- imports have real categories/products to attach to.
-- =====================================================================
-- Adds 17 families (product_categories = Product) each linked to its m162
-- range, and 57 current SKUs (products). Guarded + idempotent:
--   - categories: on conflict (name) do nothing, range_id resolved from m162
--   - products:   inserted only when the SKU isn't already present
--                 (respects the partial unique index on lower(sku))
-- Pre-existing demo categories (e.g. "Street lighting") are left untouched and
-- simply render as Unclassified. Seeded products get base_price 0 / active true
-- by column default; catalog pricing flows through project_products (m095), not
-- these rows, so a 0 base_price here is inert.
-- Requires m162 (product_ranges) to have run first.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Families (product_categories = Product), linked to their range.
-- ---------------------------------------------------------------------
insert into product_categories (name, position, range_id)
select c.cname, c.pos, pr.id
from (values
  ('AOS Performance',  0, 'Integrated Solar Street Lights'),
  ('AOS Pro⁺',         1, 'Integrated Solar Street Lights'),
  ('Totem',            2, 'Solar Columns'),
  ('Totem⁺',           3, 'Solar Columns'),
  ('ReLight Series',   4, 'Solar Rehabilitation Kit'),
  ('SSLX Performance', 5, 'Split Solar Street Lights'),
  ('SSLX Pro',         6, 'Split Solar Street Lights'),
  ('Colarsun',         7, 'Vertical Solar Street Lights'),
  ('Ada',              8, 'Solar Bollards'),
  ('Kansa',            9, 'Solar Bollards'),
  ('Koron',           10, 'Solar Bollards'),
  ('Koto',            11, 'Solar Bollards'),
  ('Mara',            12, 'Solar Bollards'),
  ('Mira',            13, 'Solar Bollards'),
  ('Ror',             14, 'Solar Bollards'),
  ('Slinda',          15, 'Solar Bollards'),
  ('Vandal',          16, 'Vandal-Resistant Bollards')
) as c(cname, pos, rname)
left join product_ranges pr on pr.name = c.rname
on conflict (name) do nothing;

-- Ensure range_id is set even for families that already existed without it.
update product_categories pc
set range_id = pr.id
from product_ranges pr
where pr.name = (
  case pc.name
    when 'AOS Performance'  then 'Integrated Solar Street Lights'
    when 'AOS Pro⁺'         then 'Integrated Solar Street Lights'
    when 'Totem'            then 'Solar Columns'
    when 'Totem⁺'           then 'Solar Columns'
    when 'ReLight Series'   then 'Solar Rehabilitation Kit'
    when 'SSLX Performance' then 'Split Solar Street Lights'
    when 'SSLX Pro'         then 'Split Solar Street Lights'
    when 'Colarsun'         then 'Vertical Solar Street Lights'
    when 'Ada'              then 'Solar Bollards'
    when 'Kansa'            then 'Solar Bollards'
    when 'Koron'            then 'Solar Bollards'
    when 'Koto'             then 'Solar Bollards'
    when 'Mara'             then 'Solar Bollards'
    when 'Mira'             then 'Solar Bollards'
    when 'Ror'              then 'Solar Bollards'
    when 'Slinda'           then 'Solar Bollards'
    when 'Vandal'           then 'Vandal-Resistant Bollards'
  end
)
and pc.range_id is distinct from pr.id;

-- ---------------------------------------------------------------------
-- 2. SKUs (products), linked to their family by name. SKU-guarded.
-- ---------------------------------------------------------------------
insert into products (name, sku, category_id)
select v.pname, v.sku, pc.id
from (values
  ('AOS PERFORMANCE 100', 'APF-100', 'AOS Performance'),
  ('AOS PERFORMANCE 120', 'APF-120', 'AOS Performance'),
  ('AOS PERFORMANCE 40',  'APF-40',  'AOS Performance'),
  ('AOS PERFORMANCE 50',  'APF-50',  'AOS Performance'),
  ('AOS PERFORMANCE 60',  'APF-60',  'AOS Performance'),
  ('AOS PERFORMANCE 80',  'APF-80',  'AOS Performance'),
  ('AOSPRO+ 80',          'AP+80',   'AOS Pro⁺'),
  ('TOTEM 20',            'TT-20',   'Totem'),
  ('TOTEM 40',            'TT-40',   'Totem'),
  ('TOTEM 60',            'TT-60',   'Totem'),
  ('TOTEM⁺ 20',           'TT+-20',  'Totem⁺'),
  ('TOTEM⁺ 40',           'TT+-40',  'Totem⁺'),
  ('TOTEM⁺ DUAL 20',      'TT+-DUAL 20', 'Totem⁺'),
  ('TOTEM⁺ DUAL 30',      'TT+-DUAL 30', 'Totem⁺'),
  ('TOTEM⁺ 60',           'TT+-60',  'Totem⁺'),
  ('ReLight Dual',        'RL-DUAL', 'ReLight Series'),
  ('ReLight Single',      'RL-60',   'ReLight Series'),
  ('SSLX PERFORMANCE 100','SX-100',  'SSLX Performance'),
  ('SSLX PERFORMANCE 120','SX-120',  'SSLX Performance'),
  ('SSLX PERFORMANCE 40', 'SX-40',   'SSLX Performance'),
  ('SSLX PERFORMANCE 60', 'SX-60',   'SSLX Performance'),
  ('SSLX PERFORMANCE 80', 'SX-80',   'SSLX Performance'),
  ('SSLX PERF DUAL-50',   'SX-D50',  'SSLX Performance'),
  ('SSLXPRO 100',         'SP-100',  'SSLX Pro'),
  ('SSLXPRO 120',         'SP-120',  'SSLX Pro'),
  ('SSLXPRO 30',          'SP-30',   'SSLX Pro'),
  ('SSLXPRO 40',          'SP-40',   'SSLX Pro'),
  ('SSLXPRO 60',          'SP-60',   'SSLX Pro'),
  ('SSLXPRO 80',          'SP-80',   'SSLX Pro'),
  ('SSLXPRO DUAL-50',     'SP-D50',  'SSLX Pro'),
  ('COLARSUN 20',         'CS-20',   'Colarsun'),
  ('COLARSUN 30',         'CS-30',   'Colarsun'),
  ('COLARSUN 40',         'CS-40',   'Colarsun'),
  ('COLARSUN 60',         'CS-60',   'Colarsun'),
  ('COLARSUN 90',         'CS-90',   'Colarsun'),
  ('COLARSUN DUAL 20',    'CS-D20',  'Colarsun'),
  ('COLARSUN DUAL 30',    'CS-D30',  'Colarsun'),
  ('COLARSUN DUAL 45',    'CS-D45',  'Colarsun'),
  ('ADA B45',             'SL-021 45', 'Ada'),
  ('ADA B80',             'SL-021 80', 'Ada'),
  ('ADA E45',             'SL-021 NB', 'Ada'),
  ('ADA M45',             'BW-021',  'Ada'),
  ('KANSA',               'SL-005',  'Kansa'),
  ('KORON 45',            'SL-013 45', 'Koron'),
  ('KORON 80',            'SL-013 80', 'Koron'),
  ('KORON M45',           'BW-013',  'Koron'),
  ('KOTO',                'SL-014',  'Koto'),
  ('MARA',                'SL-019',  'Mara'),
  ('MIRA',                'SL-006',  'Mira'),
  ('ROR 110',             'SL-002 110', 'Ror'),
  ('ROR 80',              'SL-002 80', 'Ror'),
  ('SLINDA 100',          'SL-015 100', 'Slinda'),
  ('SLINDA 80',           'SL-015 80', 'Slinda'),
  ('VDL B-45',            'VDL B-45', 'Vandal'),
  ('VDL B-80',            'VDL B-80', 'Vandal'),
  ('VDL E-100',           'VDL E-100', 'Vandal'),
  ('VDL E-65',            'VDL E-65', 'Vandal')
) as v(pname, sku, fam)
join product_categories pc on pc.name = v.fam
where not exists (
  select 1 from products p where lower(p.sku) = lower(v.sku)
);
