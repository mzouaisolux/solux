-- SKU identifier + product-images storage bucket.
-- Run in Supabase SQL Editor. Idempotent.

begin;

-- ---------- SKU ----------
alter table products add column if not exists sku text;

-- Case-insensitive uniqueness (partial: allows nulls).
create unique index if not exists products_sku_lower_unique_idx
  on products (lower(sku)) where sku is not null;

-- ---------- product-images bucket (public read, admin write) ----------
insert into storage.buckets (id, name, public)
  values ('product-images', 'product-images', true)
  on conflict (id) do nothing;

drop policy if exists "public read product images" on storage.objects;
create policy "public read product images" on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "admin insert product images" on storage.objects;
create policy "admin insert product images" on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  );

drop policy if exists "admin update product images" on storage.objects;
create policy "admin update product images" on storage.objects for update
  using (
    bucket_id = 'product-images'
    and exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  )
  with check (
    bucket_id = 'product-images'
    and exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  );

drop policy if exists "admin delete product images" on storage.objects;
create policy "admin delete product images" on storage.objects for delete
  using (
    bucket_id = 'product-images'
    and exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  );

notify pgrst, 'reload schema';

commit;
