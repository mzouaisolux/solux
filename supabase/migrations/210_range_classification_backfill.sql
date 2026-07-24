-- 210_range_classification_backfill.sql
-- =============================================================================
-- m187 — Close the range-classification gap for post-bollard families.
-- (Renumbered from 180 → 187: main already owns 180_webhook_delivery_dedupe.)
--
-- Context: migration 162 linked the original 17 families to a Range → Line.
-- Migration 175 later gave EVERY family a stable range_code, but six families
-- added after 162 were never wired into the Range hierarchy, so their
-- product_categories.range_id stayed null (they rendered under "Unclassified"):
--
--     Koni, Konos +, Tholos, Tiras, Vasa, SLK
--
-- This migration:
--   1. Adds two new ranges under the Urban Lighting Line: "Solar Post-Tops"
--      and "Solar Flood Lights".
--   2. Renames the "Konos Plus" family to "Konos +" (display fix).
--   3. Links the six families to their range by range_code (stable key set in
--      m175 — robust against the display-name rename in step 2).
--
-- Additive + idempotent. Families are matched by range_code, not name.
-- No schema change; no RLS change.
-- =============================================================================

begin;

-- 1. New ranges under the Urban Lighting Line ------------------------------
insert into product_ranges (name, line_id, position)
select r.rname, pl.id, r.pos
from (values
  ('Solar Post-Tops',   'Urban Lighting Line', 7),
  ('Solar Flood Lights','Urban Lighting Line', 8)
) as r(rname, lname, pos)
join product_lines pl on pl.name = r.lname
on conflict (name) do nothing;

-- 2. Display rename: "Konos Plus" -> "Konos +" (guarded; range_code unchanged)
update product_categories
set name = 'Konos +'
where range_code = 'KONOSPLUS' and name <> 'Konos +';

-- 3. Link the six previously-unclassified families to their range ----------
--    Matched by range_code (stable), only where range_id is still null.
update product_categories pc
set range_id = pr.id
from (values
  ('KONI',      'Solar Bollards'),
  ('KONOSPLUS', 'Solar Post-Tops'),
  ('THOLOS',    'Solar Post-Tops'),
  ('TIRAS',     'Solar Post-Tops'),
  ('VASA',      'Solar Post-Tops'),
  ('SLK',       'Solar Flood Lights')
) as m(code, range_name)
join product_ranges pr on pr.name = m.range_name
where pc.range_code = m.code
  and pc.range_id is null;

-- Report how many families still lack a range_id (informational) -----------
do $$
declare v_missing integer;
begin
  select count(*) into v_missing
  from product_categories
  where range_id is null and range_code is not null;
  raise notice 'm187: % classified famil(ies) still without a range_id.', v_missing;
end $$;

insert into schema_migrations (filename, note)
values ('210_range_classification_backfill.sql',
        'Range-classification backfill: adds Solar Post-Tops + Solar Flood Lights ranges, renames the Konos + family, links six post-bollard families (Koni/Konos+/Tholos/Tiras/Vasa/SLK) to their range by range_code. Renumbered from 180.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select pc.name, pc.range_code, pr.name as range, pl.name as line
--   from product_categories pc
--   left join product_ranges pr on pr.id = pc.range_id
--   left join product_lines  pl on pl.id = pr.line_id
--   order by pc.name;
