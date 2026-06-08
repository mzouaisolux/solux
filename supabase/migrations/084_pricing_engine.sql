-- =====================================================================
-- 084 — Pricing engine v4: global settings, price lists + assignments,
--       RMB cost entry, audit trail, and a price-list dimension on
--       prices_version for per-seller live pricing.
--
-- MODEL: target-margin back-calculation. Each price list carries three
-- after-tax target margins; price = usdCost*(1-taxRebate)/(1-margin).
--
-- New tables:
--   pricing_settings        — one global row (exchange rate, tax rebate,
--                             thin-margin dashboard threshold).
--   price_lists             — named lists, each with 3 target margins.
--   price_list_assignments  — list ↔ team/group/seller.
--   cost_rmb_history        — audit log of every cost_rmb change.
--
-- New columns:
--   product_costs.cost_rmb       — finance-entered cost in RMB (source of truth).
--   prices_version.price_list_id — NULL = default/company prices (back-compat
--                                  with existing rows + the old CSV upload);
--                                  non-null = that list's published prices.
--
-- New role:
--   'finance' — can write cost_rmb only.
--   (Catalog-owner duties stay with admin — no new role.)
--
-- Idempotent — safe to re-run.
-- =====================================================================

-- ---------- 1. finance role: add to user_roles CHECK ----------
alter table user_roles drop constraint if exists user_roles_role_check;
alter table user_roles
  add constraint user_roles_role_check
  check (role in (
    'admin', 'super_admin', 'sales', 'task_list_manager', 'operations', 'finance'
  ));

-- ---------- 2. pricing_settings (single global row) ----------
create table if not exists pricing_settings (
  id                   uuid primary key default gen_random_uuid(),
  exchange_rate        numeric not null default 6.85,
  tax_rebate           numeric not null default 0.10,
  thin_margin_threshold numeric not null default 0.20,
  updated_at           timestamptz default now(),
  updated_by           uuid references auth.users(id) on delete set null
);

-- Pre-v4 deployments may have created pricing_settings with the old markup
-- columns; make sure the v4 columns exist and the legacy ones are gone.
alter table pricing_settings add column if not exists exchange_rate numeric not null default 6.85;
alter table pricing_settings add column if not exists tax_rebate numeric not null default 0.10;
alter table pricing_settings add column if not exists thin_margin_threshold numeric not null default 0.20;
alter table pricing_settings drop column if exists mark_up;
alter table pricing_settings drop column if exists tier2_discount;
alter table pricing_settings drop column if exists tier3_discount;

insert into pricing_settings (exchange_rate, tax_rebate, thin_margin_threshold)
select 6.85, 0.10, 0.20
where not exists (select 1 from pricing_settings);

alter table pricing_settings enable row level security;

drop policy if exists "read pricing_settings" on pricing_settings;
create policy "read pricing_settings" on pricing_settings
  for select using (auth.role() = 'authenticated');

drop policy if exists "admin write pricing_settings" on pricing_settings;
create policy "admin write pricing_settings" on pricing_settings
  for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin')))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin')));

-- ---------- 3. price_lists (named, 3 after-tax target margins) ----------
create table if not exists price_lists (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  target_margin1 numeric not null default 0.38,  -- tier 1, under 50 pcs
  target_margin2 numeric not null default 0.36,  -- tier 2, 50–150 pcs
  target_margin3 numeric not null default 0.25,  -- tier 3, over 150 pcs
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz default now(),
  updated_by     uuid references auth.users(id) on delete set null
);

-- At most one default list.
create unique index if not exists uq_price_lists_one_default
  on price_lists (is_default) where is_default;

-- Seed a default list if none exists.
insert into price_lists (name, target_margin1, target_margin2, target_margin3, is_default)
select 'Standard', 0.38, 0.36, 0.25, true
where not exists (select 1 from price_lists);

alter table price_lists enable row level security;

drop policy if exists "read price_lists" on price_lists;
create policy "read price_lists" on price_lists
  for select using (auth.role() = 'authenticated');

drop policy if exists "admin write price_lists" on price_lists;
create policy "admin write price_lists" on price_lists
  for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin')))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin')));

-- ---------- 4. price_list_assignments (list ↔ team/group/seller) ----------
create table if not exists price_list_assignments (
  id            uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references price_lists(id) on delete cascade,
  assignee_type text not null check (assignee_type in ('team', 'group', 'seller')),
  assignee_id   uuid,        -- e.g. the seller's auth user id (nullable for free-text team/group)
  assignee_name text,        -- human label
  created_at    timestamptz not null default now()
);

create index if not exists idx_pla_lookup
  on price_list_assignments (assignee_type, assignee_id);

alter table price_list_assignments enable row level security;

-- Authenticated users can read assignments (the quote builder resolves the
-- seller's list at quote time, running as that seller). Admins write.
drop policy if exists "read price_list_assignments" on price_list_assignments;
create policy "read price_list_assignments" on price_list_assignments
  for select using (auth.role() = 'authenticated');

drop policy if exists "admin write price_list_assignments" on price_list_assignments;
create policy "admin write price_list_assignments" on price_list_assignments
  for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin')))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin')));

-- ---------- 5. product_costs: add cost_rmb ----------
alter table product_costs add column if not exists cost_rmb numeric not null default 0;

drop policy if exists "admin rw costs" on product_costs;
create policy "admin rw costs" on product_costs
  for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin')))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin')));

drop policy if exists "finance rw costs" on product_costs;
create policy "finance rw costs" on product_costs
  for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'finance'))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'finance'));

-- ---------- 6. cost_rmb_history (audit trail) ----------
create table if not exists cost_rmb_history (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  old_cost_rmb  numeric,
  new_cost_rmb  numeric not null,
  changed_by    uuid references auth.users(id) on delete set null,
  changed_at    timestamptz not null default now()
);

create index if not exists idx_cost_rmb_history_product
  on cost_rmb_history(product_id, changed_at desc);

alter table cost_rmb_history enable row level security;

drop policy if exists "admin finance read history" on cost_rmb_history;
create policy "admin finance read history" on cost_rmb_history
  for select using (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin', 'finance')));

drop policy if exists "admin finance insert history" on cost_rmb_history;
create policy "admin finance insert history" on cost_rmb_history
  for insert with check (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin', 'finance')));

-- ---------- 7. prices_version: price-list dimension ----------
-- NULL price_list_id = default/company prices (existing rows + old CSV upload).
alter table prices_version
  add column if not exists price_list_id uuid references price_lists(id) on delete cascade;

create index if not exists idx_prices_list_tier_lookup
  on prices_version(product_id, price_list_id, pricing_tier, valid_from desc);

-- Expose new tables/columns to PostgREST immediately.
notify pgrst, 'reload schema';
