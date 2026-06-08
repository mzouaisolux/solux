-- =====================================================================
-- 087 — Price lists v5: a price list is a saved, single-category object.
--
-- Model change: each price list now belongs to ONE product category, carries
-- its own tier margins (no more list-default + per-category override), a
-- lifecycle status, and a reference to the cost version it was based on.
--
--   draft     — saved, NOT used by the quote builder
--   published — active; quote builder uses it
--   archived  — kept for history, not used
--
-- New columns on price_lists:
--   category_id    — the product family this list prices (null = legacy/all)
--   status         — draft | published | archived  (default draft)
--   cost_batch_id  — the cost version this list was based on (null = latest)
--   created_by     — author
--
-- The m086 `price_list_margins` (per-category override) table is now unused
-- (single-category lists carry their own margins). Left in place, harmless.
--
-- Idempotent. Requires m084 + m086.
-- =====================================================================

alter table price_lists add column if not exists category_id uuid references product_categories(id) on delete set null;
alter table price_lists add column if not exists status text not null default 'draft';
alter table price_lists add column if not exists cost_batch_id uuid references cost_batches(id) on delete set null;
alter table price_lists add column if not exists created_by uuid references auth.users(id) on delete set null;

-- status check (added separately so re-runs don't fail if it exists)
alter table price_lists drop constraint if exists price_lists_status_check;
alter table price_lists add constraint price_lists_status_check
  check (status in ('draft', 'published', 'archived'));

create index if not exists idx_price_lists_cat_status on price_lists (category_id, status);

notify pgrst, 'reload schema';
