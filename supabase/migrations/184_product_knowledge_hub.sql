-- =====================================================================
-- m150 — Product Knowledge Hub: versioned product specification source of truth
-- =====================================================================
--
-- Additive island (2026-07-08): the Knowledge Hub is the single, VERSIONED
-- source of truth for a product's technical specifications. It hangs off the
-- EXISTING catalog structure — a FAMILY is a `product_categories` row, a MODEL
-- is a `products` row — and NEVER modifies either table or the frozen
-- commercial / pricing / production core.
--
-- Data model:
--   spec_fields          the schema: which spec keys exist for a family, and
--                        whether a value is COMMON (attaches to the category)
--                        or MODEL-specific (attaches to a product).
--   spec_values          the actual values (numeric / text), keyed to EITHER
--                        a category_id (common) OR a product_id (model) — the
--                        CHECK enforces exactly one.
--   spec_change_requests the governance workflow: draft → submitted →
--                        waiting_approval → approved → published (or rejected).
--                        Approval REFUSES without a signed document.
--   spec_versions        the immutable published history (v1.0, v1.1, …), one
--                        row per publish, carrying the applied diff.
--   spec_documents        the rendered spec-sheet PDFs per (product, version),
--                        auto or figma_override, stored in the EXISTING
--                        `documents` bucket at spec-sheets/{product}/{version}.pdf.
--
-- Capabilities (catalogued in lib/capabilities.ts — module "spec"):
--   spec.read           read the hub (everyone)
--   spec.raise          raise / submit a change request (operations)
--   spec.approve        approve + publish a change request (task_list_manager)
--   spec.manage_schema  edit the spec field schema (admin)
--
-- Reuses the EXISTING `documents` storage bucket (no new bucket created).
-- Idempotent. Safe to re-run. Apply manually in Supabase (or db:migrate).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- 1a. spec_fields — the per-family spec schema.
create table if not exists spec_fields (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references product_categories(id) on delete cascade,
  scope text check (scope in ('common','model')),
  key text not null,
  label text not null,
  value_kind text check (value_kind in ('number','text','enum','dimension')),
  unit text,
  sort int default 0,
  unique (category_id, key)
);

create index if not exists idx_spec_fields_category on spec_fields(category_id);

-- 1b. spec_values — actual values (common → category_id, model → product_id).
create table if not exists spec_values (
  id uuid primary key default gen_random_uuid(),
  field_id uuid references spec_fields(id) on delete cascade,
  category_id uuid references product_categories(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  value_number numeric,
  value_text text,
  unit text,
  updated_at timestamptz default now(),
  check ((category_id is not null) <> (product_id is not null))
);

create index if not exists idx_spec_values_field on spec_values(field_id);
create index if not exists idx_spec_values_category on spec_values(category_id);
create index if not exists idx_spec_values_product on spec_values(product_id);

-- 1c. spec_change_requests — the governance workflow spine.
create table if not exists spec_change_requests (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references product_categories(id) on delete cascade,
  status text default 'draft'
    check (status in ('draft','submitted','waiting_approval','approved','published','rejected')),
  reason text,
  diff jsonb default '[]'::jsonb,
  evidence_path text,
  evidence_name text,
  signed_doc_path text,
  signed_doc_name text,
  signed_doc_kind text check (signed_doc_kind in ('pdf','excel')),
  signer_name text,
  signed_at timestamptz,
  version_from text,
  version_to text,
  created_by uuid references auth.users(id),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_spec_change_requests_category on spec_change_requests(category_id);
create index if not exists idx_spec_change_requests_status on spec_change_requests(status);
create index if not exists idx_spec_change_requests_created_by on spec_change_requests(created_by);

-- 1d. spec_versions — the immutable published history.
create table if not exists spec_versions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references product_categories(id) on delete cascade,
  version text not null,
  change_request_id uuid references spec_change_requests(id),
  author uuid references auth.users(id),
  reason text,
  changes_json jsonb not null default '[]'::jsonb,
  signed_doc_path text,
  published_at timestamptz default now()
);

create index if not exists idx_spec_versions_category on spec_versions(category_id);

-- 1e. spec_documents — rendered spec-sheet PDFs per (product, version).
create table if not exists spec_documents (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  spec_version text not null,
  kind text check (kind in ('auto','figma_override')),
  template_version text,
  storage_path text,
  storage_name text,
  status text default 'pending' check (status in ('pending','ready','stale','failed')),
  is_current boolean default true,
  rendered_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique (product_id, spec_version, kind)
);

create index if not exists idx_spec_documents_product on spec_documents(product_id);
create index if not exists idx_spec_documents_current on spec_documents(product_id) where is_current = true;

-- ---------------------------------------------------------------------
-- 2. RLS — read = every authenticated user; writes hardcode the role idiom
--    used across the app (`exists (select 1 from user_roles ur where
--    ur.user_id = auth.uid() and (ur.role in (...) or ur.super_admin))`).
--    App-layer capability checks still gate the workflow; RLS is defence in
--    depth. Admin is included in the write roles as the anti-lockout floor.
-- ---------------------------------------------------------------------

alter table spec_fields          enable row level security;
alter table spec_values          enable row level security;
alter table spec_change_requests enable row level security;
alter table spec_versions        enable row level security;
alter table spec_documents       enable row level security;

-- 2a. spec_fields — read all; write admin / task_list_manager / super_admin.
drop policy if exists "spec_fields read" on spec_fields;
create policy "spec_fields read" on spec_fields
  for select to authenticated using (true);

drop policy if exists "spec_fields write" on spec_fields;
create policy "spec_fields write" on spec_fields
  for all to authenticated
  using (
    exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('admin','task_list_manager') or ur.super_admin)
    )
  )
  with check (
    exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('admin','task_list_manager') or ur.super_admin)
    )
  );

-- 2b. spec_values — read all; write admin / task_list_manager / super_admin.
drop policy if exists "spec_values read" on spec_values;
create policy "spec_values read" on spec_values
  for select to authenticated using (true);

drop policy if exists "spec_values write" on spec_values;
create policy "spec_values write" on spec_values
  for all to authenticated
  using (
    exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('admin','task_list_manager') or ur.super_admin)
    )
  )
  with check (
    exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('admin','task_list_manager') or ur.super_admin)
    )
  );

-- 2c. spec_change_requests — read all; INSERT by the operations owner
--     (raise/submit); UPDATE by operations owner OR the approving roles.
drop policy if exists "spec_change_requests read" on spec_change_requests;
create policy "spec_change_requests read" on spec_change_requests
  for select to authenticated using (true);

drop policy if exists "spec_change_requests insert" on spec_change_requests;
create policy "spec_change_requests insert" on spec_change_requests
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('operations','admin','task_list_manager') or ur.super_admin)
    )
  );

drop policy if exists "spec_change_requests update" on spec_change_requests;
create policy "spec_change_requests update" on spec_change_requests
  for update to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('task_list_manager','admin') or ur.super_admin)
    )
  );

-- 2d. spec_versions — read all; write task_list_manager / admin / super_admin.
drop policy if exists "spec_versions read" on spec_versions;
create policy "spec_versions read" on spec_versions
  for select to authenticated using (true);

drop policy if exists "spec_versions write" on spec_versions;
create policy "spec_versions write" on spec_versions
  for all to authenticated
  using (
    exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('task_list_manager','admin') or ur.super_admin)
    )
  )
  with check (
    exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('task_list_manager','admin') or ur.super_admin)
    )
  );

-- 2e. spec_documents — read all; write admin / task_list_manager /
--     operations / super_admin (the render pipeline runs as operations).
drop policy if exists "spec_documents read" on spec_documents;
create policy "spec_documents read" on spec_documents
  for select to authenticated using (true);

drop policy if exists "spec_documents write" on spec_documents;
create policy "spec_documents write" on spec_documents
  for all to authenticated
  using (
    exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('admin','task_list_manager','operations') or ur.super_admin)
    )
  )
  with check (
    exists (
      select 1 from user_roles ur
      where ur.user_id = auth.uid()
        and (ur.role in ('admin','task_list_manager','operations') or ur.super_admin)
    )
  );

-- ---------------------------------------------------------------------
-- 3. Capabilities (catalogued in lib/capabilities.ts — module "spec")
-- ---------------------------------------------------------------------
insert into permissions (key, category, label, description, sort_order) values
  ('spec.read', 'Product Knowledge Hub', 'Read the Knowledge Hub',
   'View product families, model datasheets, spec versions and download spec sheets.', 200),
  ('spec.raise', 'Product Knowledge Hub', 'Raise a spec change request',
   'Create / submit a change request against a product family (attach evidence + signed document).', 201),
  ('spec.approve', 'Product Knowledge Hub', 'Approve & publish spec changes',
   'Approve a signed change request: apply the diff, bump the version and (re)render affected spec sheets.', 202),
  ('spec.manage_schema', 'Product Knowledge Hub', 'Manage the spec schema',
   'Edit the spec field schema (which spec keys exist per family and their units).', 203),
  ('spec.import', 'Product Knowledge Hub', 'Import baseline spec data',
   'Bulk-import baseline spec fields/values from CSV and attach designed spec-sheet PDFs (admin / super_admin only).', 204)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  -- spec.read — everyone.
  ('super_admin',       'spec.read', true),
  ('admin',             'spec.read', true),
  ('task_list_manager', 'spec.read', true),
  ('operations',        'spec.read', true),
  ('sales',             'spec.read', true),
  ('sales_director',    'spec.read', true),
  ('finance',           'spec.read', true),

  -- spec.raise — operations (admins pass via the code floor).
  ('super_admin',       'spec.raise', false),
  ('admin',             'spec.raise', false),
  ('operations',        'spec.raise', true),
  ('task_list_manager', 'spec.raise', false),
  ('sales',             'spec.raise', false),
  ('sales_director',    'spec.raise', false),
  ('finance',           'spec.raise', false),

  -- spec.approve — task_list_manager (admins pass via the code floor).
  ('super_admin',       'spec.approve', false),
  ('admin',             'spec.approve', false),
  ('task_list_manager', 'spec.approve', true),
  ('operations',        'spec.approve', false),
  ('sales',             'spec.approve', false),
  ('sales_director',    'spec.approve', false),
  ('finance',           'spec.approve', false),

  -- spec.manage_schema — admin.
  ('super_admin',       'spec.manage_schema', true),
  ('admin',             'spec.manage_schema', true),
  ('task_list_manager', 'spec.manage_schema', false),
  ('operations',        'spec.manage_schema', false),
  ('sales',             'spec.manage_schema', false),
  ('sales_director',    'spec.manage_schema', false),
  ('finance',           'spec.manage_schema', false),

  -- spec.import — admin / super_admin only (baseline CSV import + PDF attach).
  ('super_admin',       'spec.import', true),
  ('admin',             'spec.import', true),
  ('task_list_manager', 'spec.import', false),
  ('operations',        'spec.import', false),
  ('sales',             'spec.import', false),
  ('sales_director',    'spec.import', false),
  ('finance',           'spec.import', false)
on conflict (role, permission_key) do nothing;

-- ---------------------------------------------------------------------
-- 4. Demo seed — ONE real category (the first that owns products) gets a
--    handful of common + model spec fields, values, and an initial v1.0
--    version so the pages render out of the box. Fully guarded / idempotent.
-- ---------------------------------------------------------------------
do $$
declare
  v_cat uuid;
begin
  -- A category that actually has products (so model values have targets).
  select c.id into v_cat
  from product_categories c
  where exists (select 1 from products p where p.category_id = c.id)
  order by c.position nulls last, c.name
  limit 1;

  if v_cat is null then
    return; -- fresh / empty DB — nothing to seed, migration still succeeds.
  end if;

  -- 4a. Spec field schema (common + model scope).
  insert into spec_fields (category_id, scope, key, label, value_kind, unit, sort) values
    (v_cat, 'common', 'ip_rating',      'IP Rating',             'text',   null,    10),
    (v_cat, 'common', 'operating_temp', 'Operating temperature', 'text',   '°C',    20),
    (v_cat, 'common', 'warranty',       'Warranty',              'number', 'years', 30),
    (v_cat, 'model',  'luminous_flux',  'Luminous flux',         'number', 'lm',    40),
    (v_cat, 'model',  'power',          'Power',                 'number', 'W',     50),
    (v_cat, 'model',  'weight',         'Weight',                'number', 'kg',    60)
  on conflict (category_id, key) do nothing;

  -- 4b. Common values (attach to the category).
  insert into spec_values (field_id, category_id, value_text)
  select f.id, v_cat, 'IP66'
  from spec_fields f
  where f.category_id = v_cat and f.key = 'ip_rating'
    and not exists (select 1 from spec_values sv where sv.field_id = f.id and sv.category_id = v_cat);

  insert into spec_values (field_id, category_id, value_text)
  select f.id, v_cat, '-30 to +50'
  from spec_fields f
  where f.category_id = v_cat and f.key = 'operating_temp'
    and not exists (select 1 from spec_values sv where sv.field_id = f.id and sv.category_id = v_cat);

  insert into spec_values (field_id, category_id, value_number, unit)
  select f.id, v_cat, 5, 'years'
  from spec_fields f
  where f.category_id = v_cat and f.key = 'warranty'
    and not exists (select 1 from spec_values sv where sv.field_id = f.id and sv.category_id = v_cat);

  -- 4c. Model values (one per product in the category).
  insert into spec_values (field_id, product_id, value_number, unit)
  select f.id, p.id, 6000, 'lm'
  from products p
  join spec_fields f on f.category_id = v_cat and f.key = 'luminous_flux'
  where p.category_id = v_cat
    and not exists (select 1 from spec_values sv where sv.field_id = f.id and sv.product_id = p.id);

  insert into spec_values (field_id, product_id, value_number, unit)
  select f.id, p.id, 50, 'W'
  from products p
  join spec_fields f on f.category_id = v_cat and f.key = 'power'
  where p.category_id = v_cat
    and not exists (select 1 from spec_values sv where sv.field_id = f.id and sv.product_id = p.id);

  insert into spec_values (field_id, product_id, value_number, unit)
  select f.id, p.id, 3.5, 'kg'
  from products p
  join spec_fields f on f.category_id = v_cat and f.key = 'weight'
  where p.category_id = v_cat
    and not exists (select 1 from spec_values sv where sv.field_id = f.id and sv.product_id = p.id);

  -- 4d. Initial published version.
  insert into spec_versions (category_id, version, reason, changes_json)
  select v_cat, 'v1.0', 'Initial published specification', '[]'::jsonb
  where not exists (select 1 from spec_versions sv where sv.category_id = v_cat);
end $$;

-- ---------------------------------------------------------------------
-- 5. Ledger (m113 rule: every migration self-inserts).
-- ---------------------------------------------------------------------
insert into schema_migrations (filename, note)
values ('184_product_knowledge_hub.sql',
        'Product Knowledge Hub (additive island): spec_fields, spec_values, spec_change_requests, spec_versions, spec_documents + RLS + spec.read/raise/approve/manage_schema/import capabilities + demo seed for one category. Reuses the documents storage bucket.')
on conflict (filename) do nothing;

-- ---------------------------------------------------------------------
-- 6. spec.import (baseline import screen, admin only) — standalone
--    idempotent re-seed. The AUTHORITATIVE seed lives in the blocks
--    above (section 3); this snippet exists ONLY so re-running the
--    capability grant in isolation on a LIVE DB is always safe. Both
--    the permission row and the role grants upsert / no-op on conflict.
-- ---------------------------------------------------------------------
insert into permissions (key, category, label, description, sort_order) values
  ('spec.import', 'Product Knowledge Hub', 'Import baseline spec data',
   'Bulk-import baseline spec fields/values from CSV and attach designed spec-sheet PDFs (admin / super_admin only).', 204)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  ('super_admin',       'spec.import', true),
  ('admin',             'spec.import', true),
  ('task_list_manager', 'spec.import', false),
  ('operations',        'spec.import', false),
  ('sales',             'spec.import', false),
  ('sales_director',    'spec.import', false),
  ('finance',           'spec.import', false)
on conflict (role, permission_key) do nothing;

commit;
