-- =====================================================================
-- m138 — Sales & Analytics register (the "online Excel", a standalone island).
-- =====================================================================
--
-- WHY (owner request 2026-07-01):
--   Move the since-2019 sales-tracking spreadsheet (one tab/year, kept on
--   iCloud) into the ERP for reliable entry, full traceability (who changed
--   what, when), real-time visibility and exploitable statistics.
--
-- DESIGN — a DELIBERATELY AUTONOMOUS module, with ZERO link to the CRM:
--   * The owner's rule: this is a self-contained register that finance & ops
--     fill in by hand over time. It must NOT reference clients/documents, and
--     must never pre-fill or derive anything from the CRM (that would inject
--     errors). received_amount is entered MANUALLY and is authoritative — the
--     register never recomputes balances.
--   * So we add its OWN client master (sales_clients, editable), its OWN saler
--     reference, its OWN orders ledger, its OWN alias/dedup + audit tables. The
--     frozen commercial pipeline (quotation → won → production → finance) is not
--     touched by a single line, and neither is the `clients`/`documents` schema.
--   * The only FK to the wider app is auth.users(id) — the existing auth system,
--     reused for traceability (spec §5), which is NOT CRM business data.
--
-- KPI SOURCING (spec §3, enforced in lib/sales/kpi.ts, not here):
--   Historical saler/CA figures come from monthly_sales_history (the frozen,
--   hand-verified truth); ERP-native periods aggregate sales_orders. Never mix.
--
-- Idempotent. Self-registers in schema_migrations (m113 convention).
-- Apply manually in Supabase (DDL) after backup, per project convention.
-- =====================================================================

begin;

-- 1. salers — the sales reps, normalized UPPERCASE. Optional link to a login. --
create table if not exists salers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                                  -- HAMZA, MEHDI, …
  user_id uuid references auth.users(id) on delete set null,  -- optional
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2. sales_clients — the module's OWN, EDITABLE client master. -----------------
--    `code` reuses the sheet's canonical id (C0001) as the stable business key;
--    `name` may legitimately be blank in the source (e.g. C0019) and is editable.
--    merged_into_id supports the human merge decision (soft-merge, keeps history).
create table if not exists sales_clients (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  main_country text,
  first_year integer,
  last_year integer,
  is_active boolean not null default true,
  merged_into_id uuid references sales_clients(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists idx_sales_clients_active on sales_clients(is_active) where merged_into_id is null;

-- 3. sales_client_aliases — every spelling ever seen → its canonical client. ---
--    normalized_key is UNIQUE across the module (spec §2): identical key ⇒ same
--    client (exact auto-attach); the fuzzy queue handles the rest.
create table if not exists sales_client_aliases (
  id uuid primary key default gen_random_uuid(),
  sales_client_id uuid not null references sales_clients(id) on delete cascade,
  raw_text text not null,
  normalized_key text not null,
  source text not null default 'import' check (source in ('import','manual','auto_match')),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_sales_client_aliases_key on sales_client_aliases(normalized_key);
create index if not exists idx_sales_client_aliases_client on sales_client_aliases(sales_client_id);

-- 4. sales_orders — the transactional ledger (history + ongoing manual entry). -
--    Multi-currency PER ROW. *_raw kept verbatim for audit. balance/received are
--    stored AS ENTERED, never recomputed (manual is authoritative). import_key
--    is a deterministic hash of the source row → idempotent re-import.
create table if not exists sales_orders (
  id uuid primary key default gen_random_uuid(),
  sales_client_id uuid references sales_clients(id) on delete restrict,
  saler_id uuid references salers(id) on delete set null,
  year integer,
  month integer check (month is null or (month between 1 and 12)),
  order_date date,
  country text,
  pi_no text,
  payment_terms text,
  pi_amount numeric,
  sales_amount numeric,
  transportation numeric,
  received_amount numeric,
  bank_charge numeric,
  balance numeric,
  amount_status text not null default 'provisional'
    check (amount_status in ('provisional','invoiced')),
  currency text not null default 'USD',
  shipment_date date,
  eta_note text,
  pickup text,
  client_raw text,
  country_raw text,
  saler_raw text,
  source text not null default 'excel_import' check (source in ('excel_import','manual')),
  import_key text unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists idx_sales_orders_pi_no  on sales_orders(pi_no);
create index if not exists idx_sales_orders_client on sales_orders(sales_client_id);
create index if not exists idx_sales_orders_saler_year on sales_orders(saler_id, year);
create index if not exists idx_sales_orders_year   on sales_orders(year);

-- 5. monthly_sales_history — the FROZEN, hand-verified saler truth (spec §3). --
--    Loaded verbatim from monthly_sales.csv. month=0 ⇒ an annual reconstituted
--    bucket (2020). Source of every HISTORICAL KPI.
create table if not exists monthly_sales_history (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  month integer not null check (month between 0 and 12),
  label text,
  saler_id uuid references salers(id) on delete set null,
  sales numeric not null,
  is_reconstructed boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_monthly_sales_history on monthly_sales_history(year, month, saler_id);
create index if not exists idx_monthly_sales_history_year on monthly_sales_history(year);

-- 6. sales_audit_log — append-only "who changed what, when" (spec §5). ---------
--    (`timestamp` is a reserved word → the column is created_at, per convention.)
create table if not exists sales_audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('sales_order','sales_client','sales_client_alias','monthly_sales_history','saler')),
  entity_id uuid not null,
  action text not null check (action in ('create','update','delete','merge')),
  field text,
  old_value text,
  new_value text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_sales_audit_entity on sales_audit_log(entity_type, entity_id, created_at desc);
create index if not exists idx_sales_audit_recent on sales_audit_log(created_at desc);

-- 7. sales_merge_suggestions — the human dedup queue (spec §4.3). --------------
--    Seeded from merge_suggestions.csv (the 6 residual historical pairs) and,
--    later, from fuzzy hits at entry time. A human resolves each: 'merged'
--    (soft-merge via sales_clients.merged_into_id) or 'kept_separate'. In-module
--    only — it never compares against the CRM.
create table if not exists sales_merge_suggestions (
  id uuid primary key default gen_random_uuid(),
  client_a_id uuid not null references sales_clients(id) on delete cascade,
  client_b_id uuid not null references sales_clients(id) on delete cascade,
  score numeric,
  source text not null default 'import' check (source in ('import','auto_match','manual')),
  status text not null default 'pending' check (status in ('pending','merged','kept_separate')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_a_id, client_b_id)
);
create index if not exists idx_sales_merge_status on sales_merge_suggestions(status) where status = 'pending';

-- =====================================================================
-- RLS — the module is filled by finance & operations; directors get full read.
--   MEMBER = operations | finance | sales_director | admin | super_admin
--   ADMIN  = admin | super_admin
-- App capabilities (lib/permissions.ts) are the primary gate; RLS is the ceiling
-- (the bulk import runs as the postgres role via DATABASE_URL, bypassing RLS).
-- Predicates are inlined per policy (no helper functions), matching m046/m137.
-- =====================================================================
alter table salers                 enable row level security;
alter table sales_clients          enable row level security;
alter table sales_client_aliases   enable row level security;
alter table sales_orders           enable row level security;
alter table monthly_sales_history  enable row level security;
alter table sales_audit_log        enable row level security;
alter table sales_merge_suggestions enable row level security;

-- sales_clients --------------------------------------------------------------
drop policy if exists "sales_clients read"   on sales_clients;
create policy "sales_clients read" on sales_clients for select using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);
drop policy if exists "sales_clients write"  on sales_clients;
create policy "sales_clients write" on sales_clients for all using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
) with check (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);
drop policy if exists "sales_clients delete" on sales_clients;
create policy "sales_clients delete" on sales_clients for delete using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
);

-- sales_client_aliases -------------------------------------------------------
drop policy if exists "sales_client_aliases read"  on sales_client_aliases;
create policy "sales_client_aliases read" on sales_client_aliases for select using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);
drop policy if exists "sales_client_aliases write" on sales_client_aliases;
create policy "sales_client_aliases write" on sales_client_aliases for all using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
) with check (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);

-- sales_orders ---------------------------------------------------------------
drop policy if exists "sales_orders read"   on sales_orders;
create policy "sales_orders read" on sales_orders for select using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);
drop policy if exists "sales_orders write"  on sales_orders;
create policy "sales_orders write" on sales_orders for all using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
) with check (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);
drop policy if exists "sales_orders delete" on sales_orders;
create policy "sales_orders delete" on sales_orders for delete using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
);

-- salers + monthly_sales_history — read for members, managed by admin. --------
drop policy if exists "salers read"  on salers;
create policy "salers read" on salers for select using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);
drop policy if exists "salers admin" on salers;
create policy "salers admin" on salers for all using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
) with check (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
);

drop policy if exists "monthly_sales_history read"  on monthly_sales_history;
create policy "monthly_sales_history read" on monthly_sales_history for select using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);
drop policy if exists "monthly_sales_history admin" on monthly_sales_history;
create policy "monthly_sales_history admin" on monthly_sales_history for all using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
) with check (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role = 'admin' or coalesce(r.super_admin,false)))
);

-- sales_audit_log — append-only: members read + insert, nobody updates/deletes.
drop policy if exists "sales_audit_log read"   on sales_audit_log;
create policy "sales_audit_log read" on sales_audit_log for select using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);
drop policy if exists "sales_audit_log insert" on sales_audit_log;
create policy "sales_audit_log insert" on sales_audit_log for insert with check (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);

-- sales_merge_suggestions — members read + resolve; admin deletes. -----------
drop policy if exists "sales_merge_suggestions read"  on sales_merge_suggestions;
create policy "sales_merge_suggestions read" on sales_merge_suggestions for select using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);
drop policy if exists "sales_merge_suggestions write" on sales_merge_suggestions;
create policy "sales_merge_suggestions write" on sales_merge_suggestions for all using (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
) with check (
  exists (select 1 from user_roles r where r.user_id = auth.uid()
      and (r.role in ('operations','finance','sales_director','admin') or coalesce(r.super_admin,false)))
);

-- 8. Self-register in the migration ledger -----------------------------------
insert into schema_migrations (filename, note)
values ('138_sales_analytics.sql',
        'Sales & Analytics register (standalone "online Excel", zero CRM link): salers, sales_clients (editable master, code=C0001), sales_client_aliases (unique normalized_key), sales_orders (multi-currency per row, *_raw kept, import_key idempotent), monthly_sales_history (frozen §3 KPI truth), sales_audit_log (append-only), sales_merge_suggestions (human dedup queue). RLS: operations/finance/sales_director/admin read+write, admin delete. No FK to clients/documents; only auth.users for traceability.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, after apply):
--   select count(*) from sales_clients;          -- 0 before import
--   select count(*) from sales_orders;           -- 0 before import
--   select count(*) from monthly_sales_history;  -- 0 before import
-- Then run the idempotent loader:
--   DATABASE_URL='postgres://…' npm run import:sales
-- ---------------------------------------------------------------------
