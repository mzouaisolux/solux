-- Unify "product families" into "product categories".
--
-- Conceptually, products already had a free-text `category` column AND were
-- being assigned to a separate `product_families` table. This migration
-- collapses those into a single concept: product_categories — a real table
-- of named categories that owns the dynamic configuration fields.
--
-- What this migration does (in order, idempotently):
--   1. Renames `product_families` table → `product_categories`.
--   2. Renames `products.family_id` → `products.category_id`.
--   3. Renames `config_fields.family_id` → `config_fields.category_id`.
--   4. Renames the related indexes.
--   5. Refreshes RLS policies under the new domain language.
--   6. Backfills `product_categories` rows from existing distinct
--      `products.category` text values (case-insensitive dedupe).
--   7. Backfills `products.category_id` for rows that don't have one yet by
--      matching `products.category` text against the new category rows.
--   8. Normalizes `products.category` text to match the category name so the
--      two stay consistent — the application layer will keep them in sync
--      from this point forward.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.

begin;

-- ---------- 1. Rename table ----------
alter table if exists product_families rename to product_categories;

-- ---------- 2. Rename products.family_id ----------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'family_id'
  ) then
    alter table products rename column family_id to category_id;
  end if;
end $$;

-- ---------- 3. Rename config_fields.family_id ----------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'config_fields'
      and column_name = 'family_id'
  ) then
    alter table config_fields rename column family_id to category_id;
  end if;
end $$;

-- ---------- 4. Rename indexes ----------
alter index if exists idx_products_family rename to idx_products_category;
alter index if exists idx_config_fields_family rename to idx_config_fields_category;

-- ---------- 5. Refresh RLS policies under the new naming ----------
-- Renaming the table preserves attached policies, but their old labels
-- ("read families", "admin write families") no longer reflect the domain.
drop policy if exists "read families" on product_categories;
drop policy if exists "admin write families" on product_categories;
drop policy if exists "read categories" on product_categories;
drop policy if exists "admin write categories" on product_categories;

create policy "read categories" on product_categories for select
  using (auth.role() = 'authenticated');
create policy "admin write categories" on product_categories for all
  using (
    exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  )
  with check (
    exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  );

-- ---------- 6. Backfill category rows from existing free-text categories ----------
-- Creates a row for every distinct `products.category` value that doesn't
-- already match an existing category (case-insensitive). After this, every
-- text value used in the catalog has a home in product_categories.
insert into product_categories (name, position)
select distinct trim(p.category), 0
from products p
where p.category is not null
  and trim(p.category) <> ''
  and not exists (
    select 1 from product_categories c
    where lower(c.name) = lower(trim(p.category))
  );

-- ---------- 7. Backfill products.category_id ----------
-- For products that don't yet have a category_id (because they were created
-- with the free-text column only), link them to the matching category row.
update products p
set category_id = c.id
from product_categories c
where p.category_id is null
  and p.category is not null
  and lower(trim(p.category)) = lower(c.name);

-- ---------- 8. Sync products.category text with category name ----------
-- After this point, the application layer always writes both columns
-- together. This brings any historically-divergent rows into agreement.
update products p
set category = c.name
from product_categories c
where p.category_id = c.id
  and (p.category is null or p.category <> c.name);

notify pgrst, 'reload schema';

commit;
