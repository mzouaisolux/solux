-- =====================================================================
-- 081 — Category templates flag.
--
-- Adds `is_template boolean default false` to product_categories so that
-- templates can live in the same table and be reused without a separate
-- model. Templates are never visible as product categories — they are
-- simply filtered out in the product form. Existing rows are unaffected
-- (they remain is_template = false).
--
-- Template snapshot semantics: "Create from template" deep-copies the
-- category + fields + options into a new independent row with
-- is_template = false. Modifying the template later has no retroactive
-- effect on categories already created from it.
-- =====================================================================

alter table product_categories
  add column if not exists is_template boolean not null default false;

create index if not exists idx_product_categories_is_template
  on product_categories (is_template);

comment on column product_categories.is_template is
  'When true this row is a reusable template; it is hidden from product assignment dropdowns.';
