-- 195_figma_range_code.sql
-- =============================================================================
-- Map each product family (product_categories) to a plugin "range" code, so the
-- Figma datasheet integration (GET /api/specs?range=…) can look a family up by a
-- stable code instead of a fragile display-name match.
--
-- Generic across every family: any category gets a range_code; SSLX Pro is just
-- the first one set. Additive + idempotent. No RLS change (reads go through the
-- service-role API which bypasses RLS; range_code is non-sensitive metadata).
-- =============================================================================

alter table product_categories
  add column if not exists range_code text;

-- One family per code (nullable: families without a datasheet integration stay null).
create unique index if not exists uq_product_categories_range_code
  on product_categories (range_code) where range_code is not null;

-- Set the first range once you know the category. Example (edit to your data):
--   update product_categories set range_code = 'SSLXPRO'
--   where name ilike 'SSLX%Pro%' or name ilike 'SSLXPRO%';
-- Verify:
--   select id, name, range_code from product_categories where range_code is not null;
