-- =====================================================================
-- m144 — Product Lighting Setup (approved lighting config, additive island).
-- =====================================================================
--
-- WHY (owner spec 2026-07-03):
--   When a won quotation is launched into production, Sales must hand the
--   APPROVED lighting configuration to Operations and Manufacturing so the
--   factory can build AND program the luminaires without asking back:
--   lighting power, the dimming program (a schedule of output% × hours),
--   operating hours, the approved optic, plus the technical studies
--   (Energy Study PDF — required; Dialux PDF/ZIP — optional).
--
--   This is designed to be the FUTURE SOURCE OF TRUTH for every lighting
--   programming parameter (controller programming, factory sheets, QR
--   codes, commissioning, QC checklists, Digital Product Passport,
--   installation docs) — so the dimming program is stored as STRUCTURED
--   JSON (an ordered list of {output, duration_hours}), never as free text,
--   and supports any number of periods.
--
-- DESIGN — an ISOLATED additive subsystem (same reasoning as m137/m141):
--   1. The commercial pipeline is frozen (freeze/core-metier). A dedicated
--      table guarantees structurally that no document / task-list / order
--      column changes — the lighting data rides alongside, never inside.
--   2. The setup is captured at LAUNCH PRODUCTION, before the proforma's
--      task list is validated and long before its production_order exists.
--      So it is anchored on the PROFORMA (the "production command" document),
--      one setup per command. The production_order page re-reads it via its
--      quotation_id (= this document_id) — no FK to production_orders, no
--      change to ensureProductionOrderForTaskList.
--   3. The two studies are stored in the existing `documents` Storage bucket
--      (m099 pattern); only their paths/names live on the row here, so the
--      island owns its files without depending on order_documents (which
--      requires a production_order_id that does not exist yet at launch).
--
-- MODEL:
--   product_lighting_setups = one approved lighting configuration per
--     production command (proforma). lighting_program is the ordered dimming
--     schedule; ai_extracted keeps the optional Auto-fill provenance so a
--     human can always see what the model suggested vs. what was overridden.
--
-- Business validation (all-fields-present gate + program shape) is enforced
-- in code (lib/lighting/validate.ts, the single computation source) — the DB
-- keeps the raw data auditable rather than encoding business rules in triggers.
--
-- Idempotent. Self-registers in schema_migrations (m113 convention).
-- Apply manually in the Supabase SQL editor after backup, per convention.
-- =====================================================================

begin;

-- 1. product_lighting_setups — one approved config per production command. ---
create table if not exists product_lighting_setups (
  id uuid primary key default gen_random_uuid(),
  -- Anchor = the PROFORMA (production command). One setup per command.
  document_id uuid not null unique references documents(id) on delete cascade,
  affair_id uuid references affairs(id) on delete set null,     -- denormalized (RLS/convenience)
  client_id uuid references clients(id) on delete set null,     -- denormalized (RLS/convenience)

  -- Lighting configuration ---------------------------------------------------
  lighting_power numeric,                       -- watts (e.g. 40, 60, 80)
  operating_hours numeric,                      -- hours per night (e.g. 12)
  lighting_program jsonb not null default '[]'::jsonb,  -- [{ "output": 100, "duration_hours": 5 }, ...]
  approved_optics text,                         -- "Type III", "Asymmetric", "Custom: ...", ...

  -- Technical studies (paths in the `documents` Storage bucket) --------------
  energy_study_path text,                       -- REQUIRED at launch (enforced in code)
  energy_study_name text,
  dialux_path text,                             -- optional
  dialux_name text,

  -- Optional Auto-fill provenance: { fields, confidence, model, extracted_at }
  ai_extracted jsonb,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_product_lighting_setups_affair on product_lighting_setups(affair_id);
create index if not exists idx_product_lighting_setups_client on product_lighting_setups(client_id);

-- 2. RLS — mirror the m141/m137 policy set: creator + technical/management
--    roles read & write; admin deletes. sales_director included (m132 see-all).
--    Operations/TLM MUST read it on the production_order page.
alter table product_lighting_setups enable row level security;

drop policy if exists "product_lighting_setups read scoped" on product_lighting_setups;
create policy "product_lighting_setups read scoped" on product_lighting_setups for select using (
  created_by = auth.uid()
  or exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('admin','task_list_manager','operations','sales_director') or coalesce(r.super_admin,false)))
);
drop policy if exists "product_lighting_setups insert scoped" on product_lighting_setups;
create policy "product_lighting_setups insert scoped" on product_lighting_setups for insert
  with check (created_by = auth.uid());
drop policy if exists "product_lighting_setups update scoped" on product_lighting_setups;
create policy "product_lighting_setups update scoped" on product_lighting_setups for update using (
  created_by = auth.uid()
  or exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('admin','task_list_manager','operations','sales_director') or coalesce(r.super_admin,false)))
);
drop policy if exists "product_lighting_setups delete scoped" on product_lighting_setups;
create policy "product_lighting_setups delete scoped" on product_lighting_setups for delete using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
);

-- 3. Self-register in the migration ledger ---------------------------------
insert into schema_migrations (filename, note)
values ('144_product_lighting_setup.sql',
        'Product Lighting Setup island: product_lighting_setups (one approved lighting config per production command / proforma; lighting_power, operating_hours, structured lighting_program JSONB dimming schedule, approved_optics, Energy Study + Dialux Storage paths, optional AI Auto-fill provenance). Anchored on documents(id) via document_id; production_order reads it via quotation_id. RLS mirrors m141 (creator + technical + sales_director; admin deletes). Zero changes to the frozen documents/task-list/order pipeline.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, after apply):
--   select count(*) from product_lighting_setups;   -- 0, table exists
--   \d product_lighting_setups                       -- columns present
-- ---------------------------------------------------------------------
