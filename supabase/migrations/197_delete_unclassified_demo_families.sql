-- 197_delete_unclassified_demo_families.sql
-- =============================================================================
-- Purge the three Unclassified demo/legacy families and everything inside them:
--
--     'Garden lighting'          (6 fields, 1 product, published v1.0)
--     'Street lighting'          (0 fields, 1 product, no version)
--     'Garden lighting (Copy)'   (0 fields, 0 products, accidental duplicate)
--
-- These are pre-existing demo categories (see m163 header) that are NOT linked
-- to a product_range, so they render as "Unclassified". They are not part of the
-- real Solux catalog and are being removed.
--
-- WHY THIS IS SAFE (FK graph verified against migrations 080/086/089/161/173):
--   * Deleting a PRODUCT cascade-deletes its catalog satellites — spec_values,
--     spec_documents (datasheets + revisions, m173), advanced pricing (m001),
--     pricing-engine rows (m084), technical mappings (m071), options/costs.
--   * Historical lines are PROTECTED, not deleted: document_lines and
--     production_task_list_lines have ON DELETE SET NULL on product_id AND a
--     frozen name/sku/category snapshot (m089), so every past quotation /
--     proforma / order / invoice / production task list stays fully readable.
--   * Deleting a CATEGORY cascade-deletes its Hub records — spec_fields,
--     category-level spec_values, spec_change_requests, spec_versions (m161),
--     category margins/cost versions (m086). References from projects,
--     price_lists, project_products and document_lines are ON DELETE SET NULL.
--
-- ORDER MATTERS: products are deleted FIRST. products.category_id is
-- ON DELETE SET NULL (m080), so deleting the category first would merely orphan
-- its products (category_id -> null) instead of removing them.
--
-- product_categories.name is UNIQUE (m163), so matching by exact name targets
-- exactly these three rows and nothing else. Idempotent: re-running deletes 0
-- rows once the categories are gone.
--
-- IRREVERSIBLE. Take a database backup / snapshot before applying (see footer).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Preflight: report exactly what is about to be removed (visible in psql/CI log).
-- ---------------------------------------------------------------------------
do $$
declare
  v_cats int;
  v_prods int;
begin
  select count(*) into v_cats
    from product_categories
   where name in ('Garden lighting', 'Street lighting', 'Garden lighting (Copy)');

  select count(*) into v_prods
    from products
   where category_id in (
     select id from product_categories
      where name in ('Garden lighting', 'Street lighting', 'Garden lighting (Copy)')
   );

  raise notice 'm174: deleting % demo categor(ies) and % product(s) (spec fields/values/versions/change-requests/datasheets cascade; historical documents preserved via m089 snapshots).', v_cats, v_prods;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Delete the products inside these families (satellites cascade;
--    historical doc/task lines keep their snapshot, product pointer -> null).
-- ---------------------------------------------------------------------------
delete from products
 where category_id in (
   select id from product_categories
    where name in ('Garden lighting', 'Street lighting', 'Garden lighting (Copy)')
 );

-- ---------------------------------------------------------------------------
-- 2. Delete the families themselves (spec_fields / spec_values / spec_versions
--    / spec_change_requests / category margins cascade).
-- ---------------------------------------------------------------------------
delete from product_categories
 where name in ('Garden lighting', 'Street lighting', 'Garden lighting (Copy)');

commit;

-- =============================================================================
-- POST-CHECK (run manually after apply; all should return 0):
--   select count(*) from product_categories
--     where name in ('Garden lighting','Street lighting','Garden lighting (Copy)');
--   -- no products left pointing at a now-missing category name:
--   select count(*) from products p
--     left join product_categories c on c.id = p.category_id
--    where p.category_id is not null and c.id is null;
--
-- BACKUP FIRST (Supabase): create a branch/snapshot, or
--   pg_dump "$DATABASE_URL" -Fc -f pre_m174_backup.dump
-- Rollback (if not yet committed in your session): ROLLBACK;
-- After commit, restore from the backup above.
-- =============================================================================
