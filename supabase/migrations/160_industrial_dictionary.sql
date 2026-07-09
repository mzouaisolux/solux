-- =====================================================================
-- m160 — Product Dictionary (owner spec 2026-07-08, final improvements).
-- =====================================================================
--
-- The factory doesn't work with translations — it works with OFFICIAL
-- internal references and ERP codes ("Battery" ↦ "LFP25-65AH-V6" ↦
-- "25.6V 65Ah 磷酸铁锂电池"). Rather than minting a rival table, the
-- EXISTING component_mappings (m012 — the commercial→factory-reference
-- dictionary the TLM already maintains in /admin/components) is promoted
-- to the centralized Product Dictionary every module reads:
--
--   commercial_name_fr      — commercial name (FR); existing
--                             commercial_name stays the EN name.
--   factory_name_cn         — official Chinese factory terminology.
--   erp_code                — ERP code (internal_reference remains the
--                             factory reference, e.g. LFP25-65AH-V6).
--   compatible_category_ids — product FAMILIES this item fits (uuid[]
--                             of product_categories). Empty = generic
--                             (offered for every family).
--   compatible_product_ids  — optional per-product narrowing (uuid[] of
--                             products).
--   metadata                — jsonb reserve (drawings/manuals/packaging
--                             pointers, production notes… future rounds
--                             without further DDL).
--
-- First consumer: the task list's product-aware FREE SPARE PARTS — the
-- selector only offers items compatible with the ordered families and
-- auto-fills factory naming from the dictionary (overridable).
--
-- The app is DORMANT before this migration (new columns are fetched and
-- written defensively) — deploy code first, then apply.
--
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL editor.
-- =====================================================================

begin;

alter table component_mappings
  add column if not exists commercial_name_fr      text,
  add column if not exists factory_name_cn         text,
  add column if not exists erp_code                text,
  add column if not exists compatible_category_ids uuid[] not null default '{}',
  add column if not exists compatible_product_ids  uuid[] not null default '{}',
  add column if not exists metadata                jsonb  not null default '{}'::jsonb;

-- Ledger (m113 rule) — the app gates the new UI on this exact row.
insert into schema_migrations (filename, note)
values ('160_industrial_dictionary.sql',
        'Product Dictionary: component_mappings gains FR/CN names, ERP code, product/category compatibility arrays and a metadata reserve. Consumed by the task-list product-aware spare parts.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name from information_schema.columns
--    where table_name = 'component_mappings'
--      and column_name in ('commercial_name_fr','factory_name_cn','erp_code',
--                          'compatible_category_ids','compatible_product_ids','metadata');
-- ---------------------------------------------------------------------
