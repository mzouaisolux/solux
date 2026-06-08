-- =====================================================================
-- m091 — Project Requests V1 (additive revision of m090).
--
-- Builds the business-complete workflow on top of the applied m090:
--   * factory cost is mastered in RMB, split Product vs Pole;
--   * logistics splits into Packing List + Freight Cost (separate requests);
--   * a sales-driven "information required" selection drives which child
--     requests get created, and Ready-for-Pricing waits only on those;
--   * factory cost is HIDDEN from Sales (RLS + capability) and the Sales
--     Director can override it with a full, append-only audit trail.
--
-- Additive + idempotent — safe to re-run. Does not drop m090 tables/data
-- (the old logistics_requests table is left in place, deprecated/unused).
-- =====================================================================

begin;

-- =====================================================================
-- 1. project_requests — new columns
-- =====================================================================
alter table project_requests
  -- information required (sales asks; director confirms at approval)
  add column if not exists req_product_pricing boolean not null default true,
  add column if not exists req_packing_list     boolean not null default false,
  add column if not exists req_freight           boolean not null default false,
  -- pricing — independent Product vs Pole (Sales Director)
  add column if not exists product_margin_pct      numeric,
  add column if not exists product_commission_pct  numeric,
  add column if not exists pole_margin_pct          numeric,
  add column if not exists pole_commission_pct      numeric,
  -- final selling prices computed at pricing time and STORED here so Sales
  -- (who cannot read factory cost) can display & quote them without the cost.
  add column if not exists product_final_price      numeric,
  add column if not exists pole_final_price         numeric,
  -- quotation output selection
  add column if not exists quote_include_product boolean not null default true,
  add column if not exists quote_include_pole    boolean not null default false,
  add column if not exists quote_include_freight boolean not null default false;

-- =====================================================================
-- 2. factory_cost_requests — RMB master, Product + Pole
-- =====================================================================
alter table factory_cost_requests
  add column if not exists product_cost_rmb numeric,
  add column if not exists pole_cost_rmb    numeric;
-- (legacy cost_per_unit kept for back-compat; unused going forward — RMB is master)

-- =====================================================================
-- 3. packing_list_requests (child) — no weight, no lead time
-- =====================================================================
create table if not exists packing_list_requests (
  id                 uuid primary key default gen_random_uuid(),
  project_request_id uuid not null references project_requests(id) on delete cascade,
  status             text not null default 'pending'
    check (status in ('pending','completed','cancelled')),
  num_containers     integer,
  container_type     text,
  total_cbm          numeric,
  loading_notes      text,
  completed_by       uuid references auth.users(id) on delete set null,
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_plr_project on packing_list_requests(project_request_id);

-- =====================================================================
-- 4. freight_cost_requests (child)
-- =====================================================================
create table if not exists freight_cost_requests (
  id                       uuid primary key default gen_random_uuid(),
  project_request_id       uuid not null references project_requests(id) on delete cascade,
  status                   text not null default 'pending'
    check (status in ('pending','completed','cancelled')),
  destination_country      text,
  freight_cost_per_container numeric,
  estimated_total_freight  numeric,
  notes                    text,
  completed_by             uuid references auth.users(id) on delete set null,
  completed_at             timestamptz,
  created_at               timestamptz not null default now()
);
create index if not exists idx_fcr2_project on freight_cost_requests(project_request_id);

-- =====================================================================
-- 5. factory_cost_audit — append-only override trail
-- =====================================================================
create table if not exists factory_cost_audit (
  id                      uuid primary key default gen_random_uuid(),
  project_request_id      uuid not null references project_requests(id) on delete cascade,
  factory_cost_request_id uuid references factory_cost_requests(id) on delete set null,
  field                   text not null, -- 'product_cost_rmb' | 'pole_cost_rmb'
  old_value               numeric,
  new_value               numeric,
  reason                  text,
  changed_by              uuid references auth.users(id) on delete set null,
  changed_at              timestamptz not null default now()
);
create index if not exists idx_fca_project on factory_cost_audit(project_request_id, changed_at desc);

-- =====================================================================
-- 6. RLS
-- =====================================================================
alter table packing_list_requests enable row level security;
alter table freight_cost_requests enable row level security;
alter table factory_cost_audit    enable row level security;

-- Helper predicates (inlined): COST roles = director/ops/tlm/finance/admin/super.
-- OWNER-or-broad = the m090 child predicate (owner/creator + ops/tlm/admin/director/super).

-- 6a. Factory cost is HIDDEN from Sales. Re-create the m090 policy as
--     ROLE-ONLY (drop the owner clause). Sales (owner) loses cost access.
drop policy if exists "factory_cost_requests rw" on factory_cost_requests;
create policy "factory_cost_requests rw" on factory_cost_requests for all using (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin','task_list_manager','operations','finance','sales_director')
            or coalesce(r.super_admin, false))
  )
);

-- 6b. Audit trail: same cost-role visibility; INSERT allowed for the same
--     set. No UPDATE/DELETE policy → append-only.
drop policy if exists "factory_cost_audit read" on factory_cost_audit;
create policy "factory_cost_audit read" on factory_cost_audit for select using (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin','task_list_manager','operations','finance','sales_director')
            or coalesce(r.super_admin, false))
  )
);
drop policy if exists "factory_cost_audit insert" on factory_cost_audit;
create policy "factory_cost_audit insert" on factory_cost_audit for insert with check (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin','task_list_manager','operations','finance','sales_director')
            or coalesce(r.super_admin, false))
  )
);

-- 6c. Packing + Freight: owner-inclusive (Sales may see them for the quote),
--     mirroring the m090 child pattern.
drop policy if exists "packing_list_requests rw" on packing_list_requests;
create policy "packing_list_requests rw" on packing_list_requests for all using (
  exists (
    select 1 from project_requests pr
     where pr.id = packing_list_requests.project_request_id
       and (pr.owner_id = auth.uid() or pr.created_by = auth.uid()
            or exists (
              select 1 from user_roles r
               where r.user_id = auth.uid()
                 and (r.role in ('admin','task_list_manager','operations','sales_director')
                      or coalesce(r.super_admin, false))
            ))
  )
);

drop policy if exists "freight_cost_requests rw" on freight_cost_requests;
create policy "freight_cost_requests rw" on freight_cost_requests for all using (
  exists (
    select 1 from project_requests pr
     where pr.id = freight_cost_requests.project_request_id
       and (pr.owner_id = auth.uid() or pr.created_by = auth.uid()
            or exists (
              select 1 from user_roles r
               where r.user_id = auth.uid()
                 and (r.role in ('admin','task_list_manager','operations','sales_director')
                      or coalesce(r.super_admin, false))
            ))
  )
);

-- =====================================================================
-- 7. Capabilities — view/override cost + widen cost/logistics editors
-- =====================================================================
insert into permissions (key, category, label, description, sort_order) values
  ('project.view_cost',     'Projects', 'View factory cost',     'See factory cost (RMB/USD) on project requests. Sales is excluded.', 76),
  ('project.override_cost', 'Projects', 'Override factory cost',  'Sales Director override of factory cost, with audit trail.',        77)
on conflict (key) do update set
  category = excluded.category, label = excluded.label,
  description = excluded.description, sort_order = excluded.sort_order;

-- view_cost: everyone operational EXCEPT sales.
insert into role_permissions (role, permission_key, enabled) values
  ('super_admin','project.view_cost',true), ('admin','project.view_cost',true),
  ('sales_director','project.view_cost',true), ('operations','project.view_cost',true),
  ('task_list_manager','project.view_cost',true), ('finance','project.view_cost',true),
  ('sales','project.view_cost',false),
  -- override_cost: director + admins only.
  ('super_admin','project.override_cost',true), ('admin','project.override_cost',true),
  ('sales_director','project.override_cost',true), ('operations','project.override_cost',false),
  ('task_list_manager','project.override_cost',false), ('finance','project.override_cost',false),
  ('sales','project.override_cost',false),
  -- widen enter_cost: + task_list_manager + finance (V1).
  ('task_list_manager','project.enter_cost',true), ('finance','project.enter_cost',true),
  -- widen enter_logistics: + task_list_manager (packing + freight).
  ('task_list_manager','project.enter_logistics',true)
on conflict (role, permission_key) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select to_regclass('public.packing_list_requests'),
--          to_regclass('public.freight_cost_requests'),
--          to_regclass('public.factory_cost_audit');
--   select role, enabled from role_permissions where permission_key='project.view_cost' order by role;
--   --   -> sales = false; others true.
-- ---------------------------------------------------------------------
