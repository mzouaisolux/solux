-- 199_backfill_warranty_battery.sql
-- =============================================================================
-- Fill the only remaining spec gap in the Knowledge Hub: the model-scope
-- `warranty_battery` value is missing on 15 models across 3 families
--   AOS Pro⁺  (7): AP+100, AP+120, AP+20, AP+30, AP+40, AP+50, AP+60
--   Colarsun  (5): CS-20, CS-40, CS-90, CS-D20, CS-D30
--   Totem⁺    (3): TT+-20, TT+-DUAL 20, TT+-DUAL 30
-- Every other family is already 100% complete.
--
-- Battery warranty is 10 years for these families, same as everywhere else.
-- Rather than hardcode a value/unit and risk a format mismatch, we COPY the
-- family's own existing `warranty_battery` value (the 10-year entry already on
-- the sibling models) — guaranteeing identical value_number/value_text/unit.
--
-- IDEMPOTENT: re-running fills nothing (no blanks, no missing rows remain).
-- Restricted to the 3 families by range_code (clean ASCII — avoids the ⁺ char in
-- the display names, which is fragile to match); other families are untouched.
-- =============================================================================

begin;

-- Reusable template: one already-filled warranty_battery value per family.
-- (Every target family has ≥1 model with the value, so a template always exists.)

-- 1. Update any existing-but-blank rows (value_number and value_text both null).
update spec_values sv
set value_number = tmpl.value_number,
    value_text   = tmpl.value_text,
    unit         = tmpl.unit,
    updated_at   = now()
from spec_fields sf
join product_categories c on c.id = sf.category_id
join lateral (
  select x.value_number, x.value_text, x.unit
  from spec_values x
  where x.field_id = sf.id
    and x.product_id is not null
    and (x.value_number is not null or nullif(btrim(x.value_text), '') is not null)
  limit 1
) tmpl on true
where sv.field_id = sf.id
  and sv.product_id is not null
  and sf.key = 'warranty_battery'
  and sf.scope = 'model'
  and c.range_code in ('AOSPROPLUS', 'COLARSUN', 'TOTEMPLUS')
  and sv.value_number is null
  and nullif(btrim(sv.value_text), '') is null;

-- 2. Insert rows for model/field pairs that have no spec_value row at all.
insert into spec_values (field_id, product_id, value_number, value_text, unit)
select sf.id, p.id, tmpl.value_number, tmpl.value_text, tmpl.unit
from spec_fields sf
join product_categories c on c.id = sf.category_id
join products p on p.category_id = c.id
join lateral (
  select x.value_number, x.value_text, x.unit
  from spec_values x
  where x.field_id = sf.id
    and x.product_id is not null
    and (x.value_number is not null or nullif(btrim(x.value_text), '') is not null)
  limit 1
) tmpl on true
where sf.key = 'warranty_battery'
  and sf.scope = 'model'
  and c.range_code in ('AOSPROPLUS', 'COLARSUN', 'TOTEMPLUS')
  and not exists (
    select 1 from spec_values sv
    where sv.field_id = sf.id and sv.product_id = p.id
  );

-- Report remaining blanks for this field (expect 0).
do $$
declare v_missing int;
begin
  select count(*) into v_missing
  from spec_fields sf
  join products p on p.category_id = sf.category_id
  left join spec_values sv on sv.field_id = sf.id and sv.product_id = p.id
    and (sv.value_number is not null or nullif(btrim(sv.value_text), '') is not null)
  where sf.key = 'warranty_battery' and sf.scope = 'model'
    and sv.id is null;
  raise notice 'm176: % model(s) still missing warranty_battery after backfill.', v_missing;
end $$;

commit;

-- =============================================================================
-- POST-CHECK (run manually after apply):
--   -- No warranty_battery blanks left (expect 0 rows):
--   select c.name, p.sku
--   from spec_fields sf
--   join product_categories c on c.id = sf.category_id
--   join products p on p.category_id = c.id
--   left join spec_values sv on sv.field_id = sf.id and sv.product_id = p.id
--     and (sv.value_number is not null or nullif(btrim(sv.value_text),'') is not null)
--   where sf.key='warranty_battery' and sf.scope='model' and sv.id is null;
--
--   -- Confirm the filled value reads as 10 years for the 3 families:
--   select c.name, p.sku, sv.value_number, sv.value_text, sv.unit
--   from spec_fields sf
--   join product_categories c on c.id = sf.category_id
--   join products p on p.category_id = c.id
--   join spec_values sv on sv.field_id = sf.id and sv.product_id = p.id
--   where sf.key='warranty_battery' and sf.scope='model'
--     and c.range_code in ('AOSPROPLUS','COLARSUN','TOTEMPLUS')
--   order by c.name, p.sku;
-- =============================================================================
