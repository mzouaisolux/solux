-- =====================================================================
-- m180 — Per-line Lighting Setups + programming-applicability rules
--        (owner spec + confirmed decisions, 2026-07-22).
-- =====================================================================
--
-- One quotation carries several product families with DIFFERENT factory
-- programming; the order-level lighting setup was too simplistic.
--
--   1. production_task_list_lines.lighting (jsonb) — each eligible line
--      owns its own setup: mode (automatic/manual), FINAL values (what
--      the factory programs), the study's RECOMMENDED values preserved
--      beside them with source/confidence/extraction method, controller
--      (one per line, open config for future types), factory
--      instructions, review state, author stamps, and a full history of
--      every mode switch / edit / study import. Shape owned by
--      lib/lighting/line-setup.ts.
--
--      Stored ON THE LINE deliberately: lines are inside the m179
--      revision snapshot, locked by the m179 freeze trigger, and covered
--      by the revision diff — so "every revision owns its own Lighting
--      Setup data, previous revisions remain immutable" (confirmed
--      decision #1) needs no extra machinery here.
--
--   2. lighting_programming_rules — the configurable business rules
--      deciding per line whether programming is Required / Optional /
--      Not applicable. Matchers (ANDed when populated): product family
--      (category), product, SKU pattern, controller text, config
--      predicates. One resolver (lib/lighting/programming-rules.ts) is
--      shared by the UI, the Pre-Validation board, the release gate,
--      exports and AI population. DEFAULT when no rule matches:
--      OPTIONAL (decision documented in the resolver).
--
--   3. Capability `lighting_rules.manage` — super_admin + admin + Task
--      List Manager may edit rules (same trust level as terminology and
--      factory mapping).
--
-- The app is DORMANT before this migration — deploy code first, apply.
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL editor.
-- =====================================================================

begin;

-- 1) Per-line setup blob.
alter table production_task_list_lines
  add column if not exists lighting jsonb;

-- 2) Programming-applicability rules.
create table if not exists public.lighting_programming_rules (
  id           uuid primary key default gen_random_uuid(),
  outcome      text not null
                 check (outcome in ('required','optional','not_applicable')),
  priority     integer not null default 0,
  category_id  uuid references product_categories(id) on delete cascade,
  product_id   uuid references products(id) on delete cascade,
  sku_pattern  text,
  controller   text,
  config_match jsonb,
  active       boolean not null default true,
  notes        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

alter table public.lighting_programming_rules enable row level security;

-- Read: everyone authenticated — the rules drive what every task-list page
-- shows. Write: rule editors (capability re-checked server-side; RLS backstop
-- mirrors the terminology/m154 role pattern).
drop policy if exists "lighting rules read" on public.lighting_programming_rules;
create policy "lighting rules read" on public.lighting_programming_rules
  for select to authenticated using (true);
drop policy if exists "lighting rules write" on public.lighting_programming_rules;
create policy "lighting rules write" on public.lighting_programming_rules
  for all to authenticated
  using (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and (coalesce(r.super_admin, false)
              or r.role in ('admin', 'task_list_manager'))
    )
  )
  with check (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and (coalesce(r.super_admin, false)
              or r.role in ('admin', 'task_list_manager'))
    )
  );

-- 3) Capability (catalogued in lib/capabilities.ts as `lighting_rules.manage`).
insert into permissions (key, category, label, description, sort_order) values
  ('lighting_rules.manage', 'Admin', 'Manage lighting programming rules',
   'Edit the rules deciding which product lines require factory programming (Lighting Setup). One shared resolver drives the task-list UI, validation gates, exports and AI population.', 96)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  ('super_admin',       'lighting_rules.manage', true),
  ('admin',             'lighting_rules.manage', true),
  ('task_list_manager', 'lighting_rules.manage', true),
  ('sales',             'lighting_rules.manage', false),
  ('sales_director',    'lighting_rules.manage', false),
  ('operations',        'lighting_rules.manage', false),
  ('finance',           'lighting_rules.manage', false)
on conflict (role, permission_key) do nothing;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('180_line_lighting_and_rules.sql',
        'Per-line Lighting Setups (production_task_list_lines.lighting jsonb — final vs recommended values, mode, controller, review, history; inherits m179 snapshot/freeze/diff) + lighting_programming_rules (required/optional/not_applicable per family/product/SKU/controller/config, default optional) + lighting_rules.manage capability (super_admin/admin/TLM).')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select column_name from information_schema.columns
--    where table_name='production_task_list_lines' and column_name='lighting';
--   select outcome, priority, sku_pattern, category_id from lighting_programming_rules
--    order by priority desc;
-- ---------------------------------------------------------------------
