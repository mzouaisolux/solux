-- =====================================================================
-- m135 — Manual production items (poles / masts / any non-catalog line).
-- =====================================================================
--
-- WHY (business rule 2026-06-29): "Launch Production" matches every quotation
-- line to a catalog Product. That works for Solux products, but POLES are never
-- catalog items — every project has different specs (height, thickness, arm,
-- wind load, galvanization…) and prices change constantly, so they are bought
-- project-by-project and never maintained as standard products. Today a pole
-- line (product_id null AND category_id null, name in client_product_name)
-- arrives at the task list "empty": its name is never copied into the line
-- snapshot, so it renders as "—".
--
-- The Production Task now supports TWO kinds of line:
--   1. Standard catalog product  — product_id set (existing behavior).
--   2. MANUAL item               — no product, no category: a free-form line
--      whose name + specs + reference price are copied straight from the
--      quotation and stay editable on the task list, with no Product reference.
--
-- Classification rule (owner decision): ANY line with no product AND no
-- category is a manual item — covers poles and any future non-catalog item.
-- Service-Request family lines (product_id null but category_id set) are NOT
-- manual: they keep the category-driven configurator + factory mapping.
--
-- Columns added to production_task_list_lines:
--   • is_manual    boolean — first-class "two types" flag (the source of truth
--                  is the write path: set at conversion + backfilled below).
--   • unit_price   numeric — READ-ONLY reference price copied from the quotation
--                  (procurement context for the per-project pole purchase). The
--                  commercial source of truth stays the proforma/quotation; this
--                  is a reference only and is never edited on the task list.
--   • manual_specs text    — free-text specifications for the manual item
--                  (height / thickness / arm / wind load / galvanization…).
--
-- The display name reuses the existing product_name snapshot column (m089):
-- a manual item is exactly "product_id null + product_name filled".
--
-- Idempotent. Self-registers in schema_migrations (m113 convention).
-- Apply manually in Supabase (DDL) after backup, per project convention.
-- =====================================================================

begin;

alter table production_task_list_lines
  add column if not exists is_manual   boolean not null default false,
  add column if not exists unit_price  numeric,
  add column if not exists manual_specs text;

-- Backfill: existing lines with no product AND no category are manual items.
-- (Names / prices of pre-existing manual lines are NOT backfilled — line order
-- vs. document_lines is not a reliable join — but the flag lets the UI render
-- them as editable manual items so the team can fill them in; every NEW Launch
-- Production copies everything correctly.)
update production_task_list_lines
   set is_manual = true
 where product_id is null
   and category_id is null
   and is_manual = false;

insert into schema_migrations (filename, note)
values ('135_manual_task_list_lines.sql',
        'Manual production items (poles/masts/non-catalog): is_manual flag + unit_price (read-only reference) + manual_specs on production_task_list_lines; a manual line = product_id null + category_id null, name in product_name snapshot. Set at conversion (generateProductionTaskList) + backfilled here.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Verification (after apply):
--   select column_name from information_schema.columns
--    where table_name = 'production_task_list_lines'
--      and column_name in ('is_manual','unit_price','manual_specs'); -- 3 rows
--   select count(*) from production_task_list_lines where is_manual;  -- poles
-- ---------------------------------------------------------------------
