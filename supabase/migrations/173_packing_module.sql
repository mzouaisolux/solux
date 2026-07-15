-- =====================================================================
-- m173 — PACKING LIST MODULE (Phase 1, ISOLATED / STANDALONE-IN-ERP).
-- =====================================================================
--
-- Owner request (2026-07-15): build a standalone Packing List Calculation
-- module INSIDE the ERP repo, strictly isolated during Phase 1:
--   • dedicated `packing_*` tables (this migration)
--   • framework-independent engine (lib/packing-core)
--   • dedicated /packing routes + components
--   • LOCAL Supabase dev only — never production
--   • access restricted to SUPER-ADMIN until validated
--   • NO changes to Sales / Operations / PI / Quotation / SR / Transport
--
-- Design invariants (from the spec):
--   • Stable UUID ids — product NAMES are never treated as unique keys.
--   • Imported records are NEVER auto-validated (status starts 'draft').
--   • Master-data is versioned; historical calculations snapshot the exact
--     versions they used and must never change when master-data changes.
--   • CBM = L*W*H / 1e9 (mm). Volumetric weight factor is CONFIGURABLE
--     (Excel used CBM*200); stored in packing_config, not hard-coded.
--   • 40GP container is CREATED but its loading rules are flagged
--     `rules_validated=false` — the source material does not document them.
--
-- Access model (Phase 1): every packing_* table is RLS-guarded to
-- super-admins only via packing_is_admin(). Import scripts use the service
-- role (bypasses RLS). Widen access in a later migration when validated.
--
-- Idempotent. Apply to LOCAL Supabase only (127.0.0.1:54322).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0) Access helper — super-admin gate reused by every policy below.
--    Mirrors the proven inline check from m169 (bool_or(super_admin)).
-- ---------------------------------------------------------------------
create or replace function public.packing_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select bool_or(super_admin) from public.user_roles where user_id = auth.uid()),
    false
  );
$$;

-- =====================================================================
-- A) IMPORTS — the original Excel is preserved, never overwritten.
-- =====================================================================
create table if not exists public.packing_import (
  id             uuid primary key default gen_random_uuid(),
  file_name      text not null,
  file_sha256    text,
  original_file  bytea,                       -- the untouched original bytes
  byte_size      integer,
  imported_by    uuid,                         -- auth user id
  imported_at    timestamptz not null default now(),
  import_version integer not null default 1,   -- 1,2,3… successive imports
  row_count      integer not null default 0,
  report         jsonb not null default '{}'::jsonb,   -- import report summary
  notes          text
);

-- =====================================================================
-- B) PRODUCT IMAGES — extracted from the Excel, never lost.
-- =====================================================================
create table if not exists public.packing_product_image (
  id                  uuid primary key default gen_random_uuid(),
  storage_path        text not null,           -- public/packing/images/<file>
  original_media_name text,                    -- image23.png
  source              text not null default 'excel_import'
                        check (source in ('excel_import','manual_upload')),
  import_id           uuid references public.packing_import(id) on delete set null,
  source_row          integer,                 -- Excel row it was anchored to
  assigned            boolean not null default true,  -- false → needs manual assign
  width_px            integer,
  height_px           integer,
  byte_size           integer,
  created_at          timestamptz not null default now()
);

-- =====================================================================
-- C) PACKAGING ITEM — STABLE identity of a packaging record.
--    Name/reference are descriptive; the UUID is the key.
-- =====================================================================
create table if not exists public.packing_item (
  id                  uuid primary key default gen_random_uuid(),
  erp_product_id      text,                    -- link to ERP product WHEN available (else NULL)
  reference           text,                    -- Excel "Product No." (col A) — NOT unique
  name                text,
  family              text,                    -- inferred product family (SSLXPRO, AOS, TOTEM…)
  variant             text,                    -- e.g. "60W", "M24"
  component_name      text,                    -- e.g. "HEAD", "POLE", "ARM", "ANCHOR"
  component_type      text,                    -- panel|head|pole|arm|anchor|sleeve|hardware|accessory|wooden_case|unknown
  is_lamp_pole        boolean not null default false,
  is_oversized        boolean not null default false,
  image_id            uuid references public.packing_product_image(id) on delete set null,
  active              boolean not null default true,
  source              text not null default 'excel_import'
                        check (source in ('excel_import','manual','erp')),
  import_id           uuid references public.packing_import(id) on delete set null,
  source_row          integer,
  verification_status text not null default 'unverified'
                        check (verification_status in ('unverified','verified')),
  current_version_id  uuid,                    -- FK added after packing_item_version exists
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists packing_item_reference_idx on public.packing_item (reference);
create index if not exists packing_item_family_idx    on public.packing_item (family);
create index if not exists packing_item_erp_idx       on public.packing_item (erp_product_id);

-- =====================================================================
-- D) PACKAGING ITEM VERSION — all packaging data, versioned + approvable.
--    Calculated fields (cbm_*, volumetric_weight_kg) are distinguished
--    from entered ones; overrides are captured in calc_overrides.
-- =====================================================================
create table if not exists public.packing_item_version (
  id                       uuid primary key default gen_random_uuid(),
  item_id                  uuid not null references public.packing_item(id) on delete cascade,
  version_no               integer not null,
  status                   text not null default 'draft'
                             check (status in ('draft','needs_validation','validated','deprecated','archived')),
  packaging_type           text,   -- individual_carton|outside_carton|master_carton|pallet|wooden_case|loose_cargo|mixed
  packing_method_raw       text,   -- original "4pcs/carton"
  qty_per_individual_carton numeric check (qty_per_individual_carton is null or qty_per_individual_carton >= 0),
  qty_per_outside_carton    numeric check (qty_per_outside_carton is null or qty_per_outside_carton >= 0),
  qty_per_master_carton     numeric check (qty_per_master_carton is null or qty_per_master_carton >= 0),
  inner_l_mm  numeric check (inner_l_mm is null or inner_l_mm >= 0),
  inner_w_mm  numeric check (inner_w_mm is null or inner_w_mm >= 0),
  inner_h_mm  numeric check (inner_h_mm is null or inner_h_mm >= 0),
  outer_l_mm  numeric check (outer_l_mm is null or outer_l_mm >= 0),
  outer_w_mm  numeric check (outer_w_mm is null or outer_w_mm >= 0),
  outer_h_mm  numeric check (outer_h_mm is null or outer_h_mm >= 0),
  pallet_l_mm numeric, pallet_w_mm numeric, pallet_h_mm numeric,
  wooden_case_l_mm numeric, wooden_case_w_mm numeric, wooden_case_h_mm numeric,
  net_weight_kg           numeric check (net_weight_kg is null or net_weight_kg >= 0),
  gross_weight_unit_kg    numeric check (gross_weight_unit_kg is null or gross_weight_unit_kg >= 0),
  gross_weight_carton_kg  numeric check (gross_weight_carton_kg is null or gross_weight_carton_kg >= 0),
  gross_weight_master_kg  numeric check (gross_weight_master_kg is null or gross_weight_master_kg >= 0),
  cbm_inner               numeric,   -- CALCULATED = inner L*W*H/1e9
  cbm_outer               numeric,   -- CALCULATED = outer L*W*H/1e9
  volumetric_weight_kg    numeric,   -- CALCULATED = cbm * volumetric_factor
  volumetric_factor       numeric,   -- factor used for this row (defaults from config)
  stacking_allowed        boolean,
  max_layers              integer,
  allowed_orientations    text[],
  fragile                 boolean not null default false,
  oversized               boolean not null default false,
  lamp_pole               boolean not null default false,
  remarks                 text,
  calc_overrides          jsonb not null default '{}'::jsonb,  -- field → {calculated, override, reason, by, at}
  valid_from              timestamptz not null default now(),
  valid_to                timestamptz,
  source_change           text not null default 'excel_import'
                             check (source_change in ('excel_import','manual_edit','bulk_update','correction','approved_revision','restore')),
  created_by              uuid,
  created_at              timestamptz not null default now(),
  validated_by            uuid,
  validated_at            timestamptz,
  unique (item_id, version_no)
);
create index if not exists packing_item_version_item_idx   on public.packing_item_version (item_id);
create index if not exists packing_item_version_status_idx on public.packing_item_version (status);

-- Now wire packing_item.current_version_id → packing_item_version.id
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'packing_item_current_version_fk'
  ) then
    alter table public.packing_item
      add constraint packing_item_current_version_fk
      foreign key (current_version_id)
      references public.packing_item_version(id) on delete set null;
  end if;
end $$;

-- =====================================================================
-- E) FIELD-LEVEL CHANGE HISTORY — "shows exactly what changed".
-- =====================================================================
create table if not exists public.packing_field_change (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid references public.packing_item(id) on delete cascade,
  version_id  uuid references public.packing_item_version(id) on delete set null,
  field       text not null,
  old_value   text,
  new_value   text,
  pct_diff    numeric,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  reason      text,
  source      text not null default 'manual_edit'
                check (source in ('manual_edit','excel_import','bulk_update','correction','approved_revision','restore'))
);
create index if not exists packing_field_change_item_idx on public.packing_field_change (item_id, changed_at desc);

-- =====================================================================
-- F) PACKAGING BOM — sellable product → physical packages.
--    Imported adjacency is a PROPOSAL: needs_validation defaults true.
-- =====================================================================
create table if not exists public.packing_bom (
  id              uuid primary key default gen_random_uuid(),
  product_item_id uuid not null references public.packing_item(id) on delete cascade,
  version_no      integer not null default 1,
  valid_from      timestamptz not null default now(),
  status          text not null default 'needs_validation'
                    check (status in ('draft','needs_validation','validated','deprecated','archived')),
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (product_item_id, version_no)
);
create table if not exists public.packing_bom_line (
  id                    uuid primary key default gen_random_uuid(),
  bom_id                uuid not null references public.packing_bom(id) on delete cascade,
  component_item_id     uuid references public.packing_item(id) on delete set null,
  component_label       text,                  -- free-text when no item link yet
  qty_per_product       numeric not null default 1,
  mandatory             boolean not null default true,
  depends_on_option     text,                  -- e.g. 'pole'
  dual_requires_two_heads boolean not null default false,
  needs_validation      boolean not null default true,
  notes                 text
);
create index if not exists packing_bom_line_bom_idx on public.packing_bom_line (bom_id);

-- =====================================================================
-- G) IMPORT ISSUES — never silently discard ambiguous data.
-- =====================================================================
create table if not exists public.packing_import_issue (
  id                      uuid primary key default gen_random_uuid(),
  import_id               uuid references public.packing_import(id) on delete cascade,
  source_row              integer,
  item_id                 uuid references public.packing_item(id) on delete set null,
  column_ref              text,                -- 'C','K'…
  issue_type              text not null,       -- see spec §6/§15
  severity                text not null default 'warning'
                            check (severity in ('info','warning','error')),
  original_value          text,
  detected_message        text not null,
  proposed_interpretation text,
  status                  text not null default 'open'
                            check (status in ('open','accepted','rejected','resolved')),
  corrected_value         text,
  corrected_by            uuid,
  corrected_at            timestamptz,
  created_at              timestamptz not null default now()
);
create index if not exists packing_import_issue_import_idx on public.packing_import_issue (import_id);
create index if not exists packing_import_issue_status_idx on public.packing_import_issue (status);

-- =====================================================================
-- H) CONTAINER TYPES — configurable + versioned. Seeded below.
-- =====================================================================
create table if not exists public.packing_container_type (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,      -- LCL|20GP|40GP|40HQ
  name              text not null,
  internal_l_mm     numeric, internal_w_mm numeric, internal_h_mm numeric,
  door_w_mm         numeric, door_h_mm numeric,
  theoretical_cbm   numeric,
  operational_cbm   numeric,                   -- usable after real-world losses
  max_payload_kg    numeric,
  safety_margin_pct numeric not null default 10,   -- % of operational volume kept free
  applicable_cbm_min numeric,
  applicable_cbm_max numeric,
  rules_validated   boolean not null default true,  -- 40GP seeded false
  active            boolean not null default true,
  notes             text,
  version_no        integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- =====================================================================
-- I) PACKING RULES — configurable loading methodology (Word doc).
--    Reusable rule rows; the engine reads them, the UI never hard-codes.
-- =====================================================================
create table if not exists public.packing_rule (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  applies_family        text,
  applies_item_id       uuid references public.packing_item(id) on delete set null,
  container_code        text,                  -- LCL|20GP|40GP|40HQ or NULL=any
  layer                 integer,               -- 1,2,3…
  orientation           text,                  -- longest_vertical|sideways|flat
  max_layers            integer,
  accessory_reservation boolean not null default false,
  dimensions_used       text,
  priority              integer not null default 100,
  valid_from            timestamptz not null default now(),
  active                boolean not null default true,
  validation_status     text not null default 'needs_validation'
                          check (validation_status in ('draft','needs_validation','validated','deprecated')),
  notes                 text,
  created_at            timestamptz not null default now()
);

-- =====================================================================
-- J) POLE PACKING PROFILES — poles handled separately from cartons.
-- =====================================================================
create table if not exists public.packing_pole_profile (
  id                    uuid primary key default gen_random_uuid(),
  reference             text,
  item_id               uuid references public.packing_item(id) on delete set null,
  length_mm             numeric,
  top_diameter_mm       numeric,
  bottom_diameter_mm    numeric,
  flange_mm             numeric,
  base_plate_l_mm       numeric, base_plate_w_mm numeric,
  weight_kg             numeric,
  qty_per_level         integer,
  max_levels            integer,
  staggered             boolean not null default true,
  case_l_mm numeric, case_w_mm numeric, case_h_mm numeric,
  case_tare_kg          numeric,
  arms_included         boolean not null default false,
  anchors_included      boolean not null default false,
  compatible_containers text[],
  validated_capacity    jsonb,                 -- {'40HQ':120}
  validation_source     text,
  has_discrepancy       boolean not null default false,  -- e.g. 16×9≠150
  discrepancy_note      text,
  created_at            timestamptz not null default now()
);

-- =====================================================================
-- K) CONFIG — key/value, editable. Volumetric factor lives HERE.
-- =====================================================================
create table if not exists public.packing_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);

-- =====================================================================
-- L) CALCULATIONS — immutable snapshots; ops validation preserved.
-- =====================================================================
create table if not exists public.packing_calculation (
  id                       uuid primary key default gen_random_uuid(),
  reference                text,               -- PLC-0001
  source_type              text not null default 'manual',
  source_id                text,
  customer                 text,
  project                  text,
  destination              text,
  incoterm                 text,
  status                   text not null default 'auto_calculated'
                             check (status in ('auto_calculated','operations_review','validated','archived')),
  auto_result              jsonb,              -- full engine output snapshot
  adjusted_result          jsonb,              -- after manual Operations adjustments
  container_choice         jsonb,              -- final chosen containers
  total_packages           integer,
  total_cbm                numeric,
  total_net_weight         numeric,
  total_gross_weight       numeric,
  recommended              jsonb,
  warnings                 jsonb,
  packaging_versions_used  jsonb not null default '[]'::jsonb,  -- [{item_id, version_id, version_no}]
  validation_by            uuid,
  validation_at            timestamptz,
  validation_notes         text,
  created_by               uuid,
  created_at               timestamptz not null default now()
);
create index if not exists packing_calculation_created_idx on public.packing_calculation (created_at desc);

create table if not exists public.packing_calculation_line (
  id              uuid primary key default gen_random_uuid(),
  calculation_id  uuid not null references public.packing_calculation(id) on delete cascade,
  product_item_id uuid references public.packing_item(id) on delete set null,
  erp_product_id  text,
  reference       text,
  quantity        numeric not null default 0,
  options         jsonb,
  custom          boolean not null default false,
  line_order      integer not null default 0
);
create index if not exists packing_calculation_line_calc_idx on public.packing_calculation_line (calculation_id);

create table if not exists public.packing_package (
  id                uuid primary key default gen_random_uuid(),
  calculation_id    uuid not null references public.packing_calculation(id) on delete cascade,
  line_id           uuid references public.packing_calculation_line(id) on delete set null,
  component_item_id uuid references public.packing_item(id) on delete set null,
  item_version_id   uuid references public.packing_item_version(id) on delete set null,  -- exact version used
  description       text,
  packaging_method  text,
  package_kind      text,   -- individual_carton|outside_carton|master_carton|pole_case|pallet|loose
  count             integer not null default 0,
  l_mm numeric, w_mm numeric, h_mm numeric,
  cbm_each          numeric,
  cbm_total         numeric,
  net_weight_kg     numeric,
  gross_weight_kg   numeric,
  incomplete        boolean not null default false,
  container_index   integer,
  manual            boolean not null default false,
  notes             text
);
create index if not exists packing_package_calc_idx on public.packing_package (calculation_id);

-- =====================================================================
-- M) VALIDATED TEMPLATES — learned recurring configurations, versioned.
-- =====================================================================
create table if not exists public.packing_template (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  version_no   integer not null default 1,
  description  text,
  payload      jsonb not null default '{}'::jsonb,
  validated_by uuid,
  validated_at timestamptz,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- =====================================================================
-- N) RLS — Phase 1: SUPER-ADMIN ONLY on every packing_* table.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'packing_import','packing_product_image','packing_item','packing_item_version',
    'packing_field_change','packing_bom','packing_bom_line','packing_import_issue',
    'packing_container_type','packing_rule','packing_pole_profile','packing_config',
    'packing_calculation','packing_calculation_line','packing_package','packing_template'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t||'_superadmin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.packing_is_admin()) with check (public.packing_is_admin());',
      t||'_superadmin_all', t
    );
  end loop;
end $$;

-- =====================================================================
-- O) SEED — config, container types, pole profiles, rules.
--    Idempotent (on conflict do nothing / guarded inserts).
-- =====================================================================

-- Config: volumetric factor + incomplete-carton policy + default margin.
insert into public.packing_config (key, value, description) values
  ('volumetric_factor', '200'::jsonb,
   'Volumetric weight = CBM × factor. Excel used 200 (=1000/5). Configurable per air/sea/forwarder.'),
  ('incomplete_carton_policy', '"remaining_individual_cartons"'::jsonb,
   'How leftover units below a full outside carton are packed: remaining_individual_cartons | round_up_outside_carton.'),
  ('default_safety_margin_pct', '10'::jsonb,
   'Default % of operational container volume kept free for a volume-based recommendation.'),
  ('pole_forces_40hq_length_mm', '5500'::jsonb,
   'Lamp poles longer than this force a 40HQ recommendation regardless of quantity (Word §II).')
on conflict (key) do nothing;

-- Container types (Word §I/§II/§III). Values EDITABLE + versioned.
insert into public.packing_container_type
  (code, name, internal_l_mm, internal_w_mm, internal_h_mm, theoretical_cbm, operational_cbm,
   max_payload_kg, safety_margin_pct, applicable_cbm_min, applicable_cbm_max, rules_validated, notes)
values
  ('LCL', 'LCL — palletized loose cargo', null, null, null, null, null,
   null, 0, 0, 15, true,
   'Below ~15 CBM LCL is preferred; above it a full container is usually cheaper (Word §I). Palletized per §III, stack height ≤2100mm.'),
  ('20GP', '20ft General Purpose', 5800, 2300, 2300, 30.68, 28,
   28000, 10, 15, 28, true,
   'Word §I: internal usable 5800×2300×2300; optimal utilization ≤28 CBM. Layer1 vertical, layer2 sideways, layer3 accessories.'),
  ('40GP', '40ft General Purpose', 12030, 2350, 2390, 67.6, null,
   26500, 10, null, null, false,
   'RULES NOT DOCUMENTED in source material. Type created per owner request; operational loading method + usable CBM must be configured by Operations before use.'),
  ('40HQ', '40ft High Cube', 11800, 2300, 2600, 70.56, 68,
   28500, 10, 28, 68, true,
   'Word §II: internal usable 11800×2300×2600; applicable 28–68 CBM. Lamp poles >5.5m require 40HQ regardless of quantity.')
on conflict (code) do nothing;

-- Pole packing profiles (Word §IV.1). The 300mm-flange example is flagged:
-- 16 pcs/level × 9 levels = 144, but the text says max 150 → discrepancy.
insert into public.packing_pole_profile
  (reference, length_mm, flange_mm, qty_per_level, max_levels, staggered,
   compatible_containers, validated_capacity, validation_source, has_discrepancy, discrepancy_note)
values
  ('8m pole / 300mm flange', 8000, 300, 16, 9, true,
   array['40HQ'], '{"40HQ_per_case":150}'::jsonb, 'Word §IV.1', true,
   'Written total 150 pcs/case contradicts layer math 16×9=144. Needs Operations validation before use.'),
  ('8m pole / 320mm flange', 8000, 320, 15, 8, true,
   array['40HQ'], '{"40HQ_per_case":120}'::jsonb, 'Word §IV.1', false,
   '15×8=120 — consistent.'),
  ('8m pole / 400mm flange', 8000, 400, 14, 8, true,
   array['40HQ'], '{"40HQ_per_case":110}'::jsonb, 'Word §IV.1', true,
   'Text says max 110 with 7–8 levels; 14×8=112. Minor rounding — confirm.'),
  ('3.5m pole / 280mm flange', 3500, 280, 18, 9, true,
   array['20GP'], '{"20GP_per_case":162}'::jsonb, 'Word §IV.1', false,
   '18×9=162 — consistent.')
on conflict do nothing;

-- Loading rules (Word §I/§II/§III/§IV) as configurable rows (needs_validation).
insert into public.packing_rule
  (name, container_code, layer, orientation, max_layers, accessory_reservation, dimensions_used, priority, validation_status, notes)
values
  ('20GP L1 — stand vertical by fixed width', '20GP', 1, 'longest_vertical', null, false,
   'longest side vertical; width fills container width (2300)', 10, 'needs_validation',
   'Word §I example: 1620×910×260 → 1620 height, 260 width → 9 cols × 6 rows = 54 pcs.'),
  ('20GP L2 — sideways', '20GP', 2, 'sideways', null, false,
   'product width as layer height; product height fallback', 20, 'needs_validation',
   'Word §I: 1620+260 layer height; 910 width (2 cols) × 1620 length (3 rows) = 6 pcs.'),
  ('20GP L3 — accessory reserve', '20GP', 3, 'flat', null, true,
   'reserve for lamp heads / accessories', 30, 'needs_validation',
   'Word §I: head 780×330×200 → total height 1620+260+330=2210 ≤ 2300 OK.'),
  ('40HQ L1 — stand vertical + supplementary', '40HQ', 1, 'longest_vertical', null, false,
   'longest vertical; fill remaining length', 10, 'needs_validation',
   'Word §II: 9 cols × 12 rows = 108; remaining 880mm → 6 pcs; total 114.'),
  ('40HQ L2 — sideways, head space at rear', '40HQ', 2, 'sideways', null, true,
   'product width as layer height; reserve head space at rear', 20, 'needs_validation',
   'Word §II: 9 cols × 5 rows = 45 pcs.'),
  ('LCL — palletize, stack ≤2100mm', 'LCL', null, 'longest_vertical', null, false,
   'pallets 1700×1140 / 1700×1350 / 1350×1350 / 1000×1200 / 800×1200 / 700×1350; total height ≤2100', 40, 'needs_validation',
   'Word §III. Same stacking logic as full container.'),
  ('Wooden case — lamp poles', null, null, 'flat', null, false,
   'width=f(2300,pcs/row,gap20-50,board100); length=pole+200+100; height=f(2600,levels,+150,+180)', 50, 'needs_validation',
   'Word §IV.2 reverse-calc formulas.'),
  ('Wooden case — Totem series', null, null, 'flat', null, false,
   'fixed 420×320; 420 height, 320 width; staggered; length as poles', 60, 'needs_validation',
   'Word §IV.3.')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Ledger self-insert (project convention since m113).
-- ---------------------------------------------------------------------
insert into schema_migrations (filename, note)
values ('173_packing_module.sql',
        'Packing List module Phase 1 (ISOLATED): packing_* master data (item/version/field_change/bom/import/issue/image), config (volumetric_factor=200), container types (LCL/20GP/40GP[rules_validated=false]/40HQ), pole profiles (150-vs-144 discrepancy flagged), loading rules, calculations+snapshot, templates. RLS super-admin only via packing_is_admin(). LOCAL dev only.')
on conflict (filename) do nothing;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Smoke (run as super-admin session):
--   select code, operational_cbm, rules_validated from packing_container_type order by code;
--   select key, value from packing_config;
--   select reference, has_discrepancy, discrepancy_note from packing_pole_profile;
-- ---------------------------------------------------------------------
