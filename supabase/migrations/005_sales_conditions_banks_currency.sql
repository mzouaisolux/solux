-- Sales conditions + bank accounts + currency.
-- Run in Supabase SQL Editor. Idempotent.

begin;

-- ---------- 1. CURRENCY ----------
alter table documents
  add column if not exists currency text
    check (currency in ('USD','EUR','CNY'))
    default 'USD';

-- ---------- 2. SALES CONDITIONS ----------
create table if not exists sales_conditions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  is_default boolean not null default false,
  created_at timestamptz default now()
);

-- At most one default template.
create unique index if not exists sales_conditions_single_default_idx
  on sales_conditions((is_default)) where is_default = true;

alter table sales_conditions enable row level security;

drop policy if exists "sales_conditions read" on sales_conditions;
create policy "sales_conditions read" on sales_conditions for select
  using (auth.role() = 'authenticated');

drop policy if exists "sales_conditions admin write" on sales_conditions;
create policy "sales_conditions admin write" on sales_conditions for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'));

-- Document → sales conditions reference.
alter table documents
  add column if not exists include_sales_conditions boolean not null default false;
alter table documents
  add column if not exists sales_conditions_id uuid
    references sales_conditions(id) on delete set null;

-- ---------- 3. BANK ACCOUNTS ----------
create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  account_name text not null,
  currency text not null check (currency in ('USD','EUR','CNY')),
  bank_name text,
  bank_address text,
  account_number text,
  swift text,
  is_default boolean not null default false,
  created_at timestamptz default now()
);

-- One default account per currency.
create unique index if not exists bank_accounts_default_per_currency_idx
  on bank_accounts(currency) where is_default = true;

alter table bank_accounts enable row level security;

drop policy if exists "bank_accounts read" on bank_accounts;
create policy "bank_accounts read" on bank_accounts for select
  using (auth.role() = 'authenticated');

drop policy if exists "bank_accounts admin write" on bank_accounts;
create policy "bank_accounts admin write" on bank_accounts for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'));

-- Document → bank account reference.
alter table documents
  add column if not exists bank_account_id uuid
    references bank_accounts(id) on delete set null;

notify pgrst, 'reload schema';

commit;
