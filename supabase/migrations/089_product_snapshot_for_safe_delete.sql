-- =====================================================================
-- m089 — Product SNAPSHOT on document & task-list lines, so a product can
--        be hard-deleted from the catalog WITHOUT breaking any historical
--        quotation / proforma / order / invoice / production task list.
-- =====================================================================
--
-- WHY (verified 2026-06-04):
--   `document_lines` and `production_task_list_lines` already snapshot the
--   PRICE (unit_price / total_price) and the CONFIGURATION (selected_options
--   / config_values jsonb). But the product NAME was rendered from a LIVE
--   join to products.name via product_id, and the FK had no ON DELETE — so:
--     1. a product used in any document could NOT be deleted (FK RESTRICT), and
--     2. even with SET NULL the line would lose its name → broken history.
--
-- THIS MIGRATION makes deletion safe:
--   1. Snapshot columns (product_name / product_sku / product_category) on
--      both line tables.
--   2. Backfill existing rows from the current catalog.
--   3. A BEFORE INSERT/UPDATE trigger that captures the catalog name/sku/
--      category onto every NEW line — so EVERY write path (current & future)
--      is covered with no app changes, and the snapshot is frozen at creation.
--   4. Change the product FK to ON DELETE SET NULL on both tables, so deleting
--      a product clears the live pointer but the line keeps its snapshot and
--      its price/config — the document stays fully readable.
--
-- Deleting a product therefore only affects FUTURE usage; historical records
-- are untouched. Catalog satellites (options, prices_version, product_costs,
-- pricing-engine rows, technical mappings) already cascade-delete with the
-- product, which is correct.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- 1. Snapshot columns -------------------------------------------------
alter table document_lines
  add column if not exists product_name text,
  add column if not exists product_sku text,
  add column if not exists product_category text;

alter table production_task_list_lines
  add column if not exists product_name text,
  add column if not exists product_sku text,
  add column if not exists product_category text;

-- 2. Backfill existing rows from the live catalog (only where missing) --
update document_lines dl
   set product_name     = p.name,
       product_sku      = p.sku,
       product_category = p.category
  from products p
 where dl.product_id = p.id
   and dl.product_name is null;

update production_task_list_lines tll
   set product_name     = p.name,
       product_sku      = p.sku,
       product_category = p.category
  from products p
 where tll.product_id = p.id
   and tll.product_name is null;

-- 3. Auto-snapshot trigger -------------------------------------------
-- Captures the catalog name/sku/category onto the line at INSERT (and when
-- product_id changes), but never overwrites an existing snapshot — so the
-- value is frozen at creation time and survives a later product rename or
-- deletion. One function, attached to both line tables.
create or replace function snapshot_line_product() returns trigger
language plpgsql as $$
begin
  if NEW.product_id is not null
     and (
       NEW.product_name is null
       or NEW.product_name = ''
       or (TG_OP = 'UPDATE' and NEW.product_id is distinct from OLD.product_id)
     ) then
    select p.name, p.sku, p.category
      into NEW.product_name, NEW.product_sku, NEW.product_category
      from products p
     where p.id = NEW.product_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_snapshot_product on document_lines;
create trigger trg_snapshot_product
  before insert or update on document_lines
  for each row execute function snapshot_line_product();

drop trigger if exists trg_snapshot_product on production_task_list_lines;
create trigger trg_snapshot_product
  before insert or update on production_task_list_lines
  for each row execute function snapshot_line_product();

-- 4. Make the product FK ON DELETE SET NULL ---------------------------
-- Drop ANY existing FK from these tables to products (regardless of its
-- auto-generated name), then re-add it as ON DELETE SET NULL.
do $$
declare
  r record;
begin
  for r in
    select conrelid::regclass as tbl, conname
      from pg_constraint
     where contype = 'f'
       and confrelid = 'products'::regclass
       and conrelid in (
         'document_lines'::regclass,
         'production_task_list_lines'::regclass
       )
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end;
$$;

alter table document_lines
  add constraint document_lines_product_id_fkey
  foreign key (product_id) references products(id) on delete set null;

alter table production_task_list_lines
  add constraint production_task_list_lines_product_id_fkey
  foreign key (product_id) references products(id) on delete set null;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   -- Every used line now carries a snapshot:
--   select count(*) from document_lines where product_id is not null and product_name is null;            -- expect 0
--   select count(*) from production_task_list_lines where product_id is not null and product_name is null; -- expect 0
--
--   -- Deleting a used product no longer errors; the line survives with snapshot:
--   -- delete from products where id = '<used-product-uuid>';
--   -- select product_id, product_name from document_lines where product_name is not null limit 5;
-- ---------------------------------------------------------------------
