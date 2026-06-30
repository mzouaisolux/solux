-- =====================================================================
-- m133 — Line-level category_id on document_lines & production_task_list_lines,
--        so a line's CATEGORY (the unit the factory-mapping resolver actually
--        needs) no longer depends on a non-null catalog product_id.
-- =====================================================================
--
-- WHY (verified 2026-06-24, against prod data):
--   The production pipeline (factory-mapping resolver in
--   lib/task-list-mapping-server.ts + lib/types.ts optionLookupKey) resolves
--   mappings from (category_id + structured config values). It NEVER uses
--   product_id directly. But neither document_lines nor
--   production_task_list_lines stores a category: the resolver re-derives it
--   through a LIVE join products.category_id, keyed on product_id.
--
--   Consequence: any line WITHOUT a product_id — every line generated from a
--   Service Request, where generateQuotationFromProject forces product_id=null
--   and flattens the specs into client_product_name — has categoryId=null, so
--   it is SILENTLY IGNORED by countMissingMappings (`if (!line.categoryId)
--   continue`) and never blocks release. A free-text product can therefore
--   reach production with NO factory instructions. Confirmed in prod:
--   document_lines and production_task_list_lines with product_id null /
--   product_name null (e.g. task list 27d9fe93).
--
-- THIS MIGRATION makes the category a first-class, line-level column, so a line
-- can be "category + config" WITHOUT a catalog product_id (the custom / tender
-- case the Service Request module exists for) while staying fully resolvable:
--   1. Add category_id (FK -> product_categories, ON DELETE SET NULL) on both
--      line tables.
--   2. Backfill existing rows from the live catalog (products.category_id)
--      wherever a product_id is present.
--   3. Extend the m089 snapshot trigger to ALSO derive category_id from the
--      product at write time — so every catalog write path keeps a category
--      with no app change — without overwriting an explicitly-set category_id
--      or the frozen name/sku/category snapshot.
--   4. Index category_id on both tables (the resolver scopes by category).
--
-- The app layer (Phase 1 follow-up, separate change) propagates category_id for
-- the FREE-TEXT case (product_id null), sourced from the Service Request's
-- product_category_id — which the trigger cannot cover (no product to derive
-- from). This migration is the foundation; it is safe and inert on its own
-- (additive nullable column + additive trigger logic).
--
-- Idempotent. Self-registers in schema_migrations (m113 convention).
-- Apply manually in Supabase (DDL) after backup, per project convention.
-- =====================================================================

begin;

-- 1. Line-level category columns -------------------------------------
alter table document_lines
  add column if not exists category_id uuid references product_categories(id) on delete set null;

alter table production_task_list_lines
  add column if not exists category_id uuid references product_categories(id) on delete set null;

-- 2. Backfill from the live catalog (only where missing) -------------
-- Touches catalog lines only (product_id is not null); free-text lines are
-- left category-less here and are filled by the app from the request category.
update document_lines dl
   set category_id = p.category_id
  from products p
 where dl.product_id = p.id
   and dl.category_id is null
   and p.category_id is not null;

update production_task_list_lines tll
   set category_id = p.category_id
  from products p
 where tll.product_id = p.id
   and tll.category_id is null
   and p.category_id is not null;

-- 3. Extend the snapshot trigger to also derive category_id ----------
-- Supersedes the m089 definition: identical frozen name/sku/category snapshot
-- semantics, PLUS category_id derivation. Guarded on product_id is not null, so
-- the free-text / Service-Request case (product_id null, category_id set by the
-- app) is never touched here. Never overwrites a category_id already set.
create or replace function snapshot_line_product() returns trigger
language plpgsql as $$
declare
  p_name  text;
  p_sku   text;
  p_cat   text;
  p_catid uuid;
begin
  if NEW.product_id is not null then
    select p.name, p.sku, p.category, p.category_id
      into p_name, p_sku, p_cat, p_catid
      from products p
     where p.id = NEW.product_id;

    -- name / sku / category text: freeze at creation (or when product changes)
    if NEW.product_name is null
       or NEW.product_name = ''
       or (TG_OP = 'UPDATE' and NEW.product_id is distinct from OLD.product_id) then
      NEW.product_name     := p_name;
      NEW.product_sku      := p_sku;
      NEW.product_category := p_cat;
    end if;

    -- category_id: derive when missing (or when the product changes)
    if NEW.category_id is null
       or (TG_OP = 'UPDATE' and NEW.product_id is distinct from OLD.product_id) then
      NEW.category_id := p_catid;
    end if;
  end if;
  return NEW;
end;
$$;

-- The triggers themselves already exist (m089); replacing the function is
-- enough. Re-assert idempotently in case m089 was not applied on this database.
drop trigger if exists trg_snapshot_product on document_lines;
create trigger trg_snapshot_product
  before insert or update on document_lines
  for each row execute function snapshot_line_product();

drop trigger if exists trg_snapshot_product on production_task_list_lines;
create trigger trg_snapshot_product
  before insert or update on production_task_list_lines
  for each row execute function snapshot_line_product();

-- 4. Indexes (the resolver scopes work by category) ------------------
create index if not exists idx_doc_lines_category  on document_lines(category_id);
create index if not exists idx_task_lines_category on production_task_list_lines(category_id);

-- 5. Self-register in the migration ledger ---------------------------
insert into schema_migrations (filename, note)
values ('133_line_category_id.sql',
        'Line-level category_id on document_lines + production_task_list_lines (FK product_categories, ON DELETE SET NULL); backfill from products.category_id; m089 snapshot trigger extended to derive category_id; indexes. Decouples category from product_id so free-text / Service-Request lines stay resolvable for factory mappings.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, after apply):
--   -- Every catalog line now carries a category:
--   select count(*) from document_lines
--     where product_id is not null and category_id is null;            -- expect 0
--   select count(*) from production_task_list_lines
--     where product_id is not null and category_id is null;            -- expect 0
--   -- Free-text lines (product_id null) stay category-less until the app
--   -- propagates the Service Request category (Phase 1 follow-up):
--   select count(*) from document_lines where product_id is null;      -- informational
-- ---------------------------------------------------------------------
