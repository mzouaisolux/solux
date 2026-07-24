-- 211_rename_konos_product.sql
-- =============================================================================
-- m188 — Model (product) rename to complete the "Konos +" correction.
-- (Renumbered from 181 → 188: main already owns 181_contact_recipient_audit_view.)
--
-- Migration 187 renamed the FAMILY (product_categories) "Konos Plus" -> "Konos +".
-- Its single MODEL (products) row was still named "Konos Plus". This finishes
-- the rename on the product side.
--
-- Scope note: a full diff of the corrected catalog vs. the repo's declared
-- catalog (docs/all_families_models.csv) found this rename to be the ONLY
-- model-name/SKU change — no SKU changed for any model — so no other product
-- rows need updating.
--
-- Matched by SKU (stable, unique, unchanged) rather than by name, so the update
-- is robust and idempotent (re-running touches nothing once applied).
-- No schema change; no RLS change.
-- =============================================================================

begin;

update products
set name = 'Konos +'
where sku = 'PL-008+' and name <> 'Konos +';

-- Report result (informational) -------------------------------------------
do $$
declare v_name text;
begin
  select name into v_name from products where sku = 'PL-008+';
  if v_name is null then
    raise notice 'm188: no product with sku PL-008+ found (nothing to rename).';
  else
    raise notice 'm188: product sku PL-008+ name is now %.', v_name;
  end if;
end $$;

insert into schema_migrations (filename, note)
values ('211_rename_konos_product.sql',
        'Product rename: products.name "Konos Plus" -> "Konos +" for sku PL-008+ (completes the family rename in m187). Matched by SKU; idempotent. Renumbered from 181.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- Verify:
--   select name, sku from products where sku = 'PL-008+';
