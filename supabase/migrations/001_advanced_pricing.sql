-- Advanced pricing features: tiers, discounts, costs/margins, client history perf
-- Run in Supabase SQL editor. Idempotent — safe to re-run.

begin;

-- ---------- 1. PRICING TIERS ----------

alter table prices_version
  add column if not exists pricing_tier text
    check (pricing_tier in ('high','medium','low'))
    default 'medium' not null;

-- Faster tier lookups: "latest price for (product, tier) as of today"
create index if not exists idx_prices_tier_lookup
  on prices_version(product_id, pricing_tier, valid_from desc);

-- ---------- 2. COST PRICES (admin-only, separate table for real RLS) ----------

create table if not exists product_costs (
  product_id uuid primary key references products(id) on delete cascade,
  cost_price numeric not null default 0,
  updated_at timestamptz default now()
);

alter table product_costs enable row level security;

drop policy if exists "admin rw costs" on product_costs;
create policy "admin rw costs" on product_costs for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'));

-- ---------- 3. DISCOUNTS + TIER ON DOCUMENT LINES ----------

alter table document_lines
  add column if not exists pricing_tier text
    check (pricing_tier in ('high','medium','low'));

alter table document_lines
  add column if not exists discount_type text
    check (discount_type in ('percentage','fixed'));

alter table document_lines
  add column if not exists discount_value numeric not null default 0;

-- The price before discount is applied (so we can show original vs final in the future).
alter table document_lines
  add column if not exists original_unit_price numeric;

-- ---------- 4. CLIENT HISTORY PERFORMANCE ----------

create index if not exists idx_docs_client_date
  on documents(client_id, date desc);

create index if not exists idx_lines_product
  on document_lines(product_id);

commit;
