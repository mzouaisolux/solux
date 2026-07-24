-- m162 — Product Knowledge Hub: category hierarchy (Line → Range) above family
-- =====================================================================
-- Additive island (2026-07-13). Adds the two catalog grouping levels that
-- sit ABOVE a family (product_categories = "Product"): Line → Range → Product.
--
--   product_lines        catalog top level (e.g. Street & Area Lighting Line)
--   product_ranges        mid level, belongs to one line (e.g. Solar Bollards)
--   product_categories    + nullable range_id → product_ranges  (the ONLY change
--                         to an existing table; every current consumer of
--                         product_categories is unaffected when range_id is null)
--
-- Does NOT change versioning (spec_versions stay per family/category) or the
-- qualifier. Navigation/grouping only. Reuses the m161 RLS idiom (read = any
-- authenticated user; write = admin / task_list_manager / super_admin).
-- Fully guarded + idempotent; safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists product_lines (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position integer not null default 0,
  created_at timestamptz default now()
);

create table if not exists product_ranges (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  line_id uuid references product_lines(id) on delete restrict,
  position integer not null default 0,
  created_at timestamptz default now()
);
create index if not exists idx_product_ranges_line on product_ranges(line_id);

-- The one change to an existing shared table: a nullable FK. Existing
-- product/pricing/task-list queries are unaffected (range_id null = today's behaviour).
alter table product_categories add column if not exists range_id uuid references product_ranges(id);
create index if not exists idx_product_categories_range on product_categories(range_id);

-- ---------------------------------------------------------------------
-- 2. RLS — read = every authenticated user; write = schema managers
--    (mirrors m161's hardcoded role idiom; app-layer capability still gates).
-- ---------------------------------------------------------------------
alter table product_lines  enable row level security;
alter table product_ranges enable row level security;

drop policy if exists "product_lines read" on product_lines;
create policy "product_lines read" on product_lines
  for select to authenticated using (true);

drop policy if exists "product_lines write" on product_lines;
create policy "product_lines write" on product_lines
  for all to authenticated
  using (
    exists (select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('admin','task_list_manager') or ur.super_admin))
  )
  with check (
    exists (select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('admin','task_list_manager') or ur.super_admin))
  );

drop policy if exists "product_ranges read" on product_ranges;
create policy "product_ranges read" on product_ranges
  for select to authenticated using (true);

drop policy if exists "product_ranges write" on product_ranges;
create policy "product_ranges write" on product_ranges
  for all to authenticated
  using (
    exists (select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('admin','task_list_manager') or ur.super_admin))
  )
  with check (
    exists (select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('admin','task_list_manager') or ur.super_admin))
  );

-- ---------------------------------------------------------------------
-- 3. Backfill from the Solux catalog classification (current catalog).
--    Idempotent: on conflict do nothing / update-by-name. Families whose
--    name does not match a Product below keep range_id = null (unclassified),
--    which renders under an "Unclassified" bucket — no harm.
-- ---------------------------------------------------------------------
insert into product_lines (name, position) values
  ('Street & Area Lighting Line', 0),
  ('Urban Lighting Line', 1)
on conflict (name) do nothing;

insert into product_ranges (name, line_id, position)
select r.rname, pl.id, r.pos
from (values
  ('Integrated Solar Street Lights', 'Street & Area Lighting Line', 0),
  ('Solar Columns',                  'Street & Area Lighting Line', 1),
  ('Solar Rehabilitation Kit',       'Street & Area Lighting Line', 2),
  ('Split Solar Street Lights',      'Street & Area Lighting Line', 3),
  ('Vertical Solar Street Lights',   'Street & Area Lighting Line', 4),
  ('Solar Bollards',                 'Urban Lighting Line',         5),
  ('Vandal-Resistant Bollards',      'Urban Lighting Line',         6)
) as r(rname, lname, pos)
join product_lines pl on pl.name = r.lname
on conflict (name) do nothing;

-- Link families (product_categories) to their range by Product name.
update product_categories pc
set range_id = (select id from product_ranges where name = m.range_name)
from (values
  ('AOS Performance',  'Integrated Solar Street Lights'),
  ('AOS Pro⁺',         'Integrated Solar Street Lights'),
  ('Totem',            'Solar Columns'),
  ('Totem⁺',           'Solar Columns'),
  ('ReLight Series',   'Solar Rehabilitation Kit'),
  ('SSLX Performance', 'Split Solar Street Lights'),
  ('SSLX Pro',         'Split Solar Street Lights'),
  ('Colarsun',         'Vertical Solar Street Lights'),
  ('Ada',              'Solar Bollards'),
  ('Kansa',            'Solar Bollards'),
  ('Koron',            'Solar Bollards'),
  ('Koto',             'Solar Bollards'),
  ('Mara',             'Solar Bollards'),
  ('Mira',             'Solar Bollards'),
  ('Ror',              'Solar Bollards'),
  ('Slinda',           'Solar Bollards'),
  ('Vandal',           'Vandal-Resistant Bollards')
) as m(product, range_name)
where pc.name = m.product;
