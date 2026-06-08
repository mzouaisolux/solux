-- =====================================================================
-- 080 — Product ↔ Category integrity (verification + safety).
--
-- The product-category link already exists in the schema:
--   • migration 009 created products.family_id REFERENCES product_families(id)
--     ON DELETE SET NULL;
--   • migration 011 renamed product_families → product_categories and
--     products.family_id → products.category_id (the FK + index were
--     preserved through the rename).
--
-- This migration is therefore IDEMPOTENT and SAFE to run on any instance:
-- it only (re)asserts the FK, the index, the read policy, and re-links any
-- legacy/imported rows that have a category *text* but no category_id.
--
-- NOTE: "category required" is enforced at the application layer (the create
-- and edit forms + the createProduct/updateProduct actions throw
-- "Please select a category"). We deliberately do NOT add a DB NOT NULL on
-- products.category_id, because legacy rows may still be null and a hard
-- constraint would block their next edit instead of guiding it.
-- =====================================================================

-- ---------- 1. Ensure the FK products.category_id -> product_categories(id) ----------
do $$
begin
  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel  on rel.oid  = con.conrelid
    join pg_class frel on frel.oid = con.confrelid
    where con.contype = 'f'
      and rel.relname  = 'products'
      and frel.relname = 'product_categories'
  ) then
    alter table products
      add constraint products_category_id_fkey
      foreign key (category_id) references product_categories(id)
      on delete set null;
  end if;
end $$;

-- ---------- 2. Ensure the lookup index ----------
create index if not exists idx_products_category on products(category_id);

-- ---------- 3. Ensure authenticated users can read categories (dropdown) ----------
alter table product_categories enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'product_categories'
      and policyname = 'read categories'
  ) then
    create policy "read categories" on product_categories
      for select using (auth.role() = 'authenticated');
  end if;
end $$;

-- ---------- 4. Re-link legacy/imported rows (category text but no id) ----------
update products p
set category_id = c.id
from product_categories c
where p.category_id is null
  and p.category is not null
  and lower(trim(p.category)) = lower(c.name);

-- ---------- 5. Keep the denormalized text in sync with the canonical name ----------
update products p
set category = c.name
from product_categories c
where p.category_id = c.id
  and (p.category is null or p.category <> c.name);
