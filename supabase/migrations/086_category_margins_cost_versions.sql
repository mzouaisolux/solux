-- =====================================================================
-- 086 — Category-level margins + cost versioning (pricing v4.1).
--
-- WHY
-- ---
-- Margins must be configurable PER PRODUCT CATEGORY within a price list
-- (e.g. Standard list: SSLX PRO 38/36/25, COLARSUN 42/38/30). And finance
-- cost entry must be versioned (dated batches + history), separate from the
-- margin/price logic.
--
-- New tables:
--   price_list_margins  — per-(price_list, category) margin overrides.
--                         Falls back to price_lists.target_margin* when a
--                         category has no row.
--   cost_batches        — a dated cost-entry batch (effective date, note,
--                         author). Each saved cost change links to one.
--
-- New columns:
--   cost_rmb_history.batch_id       — links a change to its batch.
--   cost_rmb_history.effective_date — when the cost takes effect.
--
-- Idempotent — safe to re-run. Requires m084 (price_lists, cost_rmb_history).
-- =====================================================================

-- ---------- 0. price_lists: optional effective date + notes ----------
alter table price_lists add column if not exists effective_date date;
alter table price_lists add column if not exists notes text;

-- ---------- 1. price_list_margins (per-category overrides) ----------
create table if not exists price_list_margins (
  id             uuid primary key default gen_random_uuid(),
  price_list_id  uuid not null references price_lists(id) on delete cascade,
  category_id    uuid not null references product_categories(id) on delete cascade,
  target_margin1 numeric not null default 0.38,
  target_margin2 numeric not null default 0.36,
  target_margin3 numeric not null default 0.25,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz default now(),
  updated_by     uuid references auth.users(id) on delete set null,
  unique (price_list_id, category_id)
);

create index if not exists idx_plm_list on price_list_margins (price_list_id);

alter table price_list_margins enable row level security;

drop policy if exists "read price_list_margins" on price_list_margins;
create policy "read price_list_margins" on price_list_margins
  for select using (auth.role() = 'authenticated');

drop policy if exists "admin write price_list_margins" on price_list_margins;
create policy "admin write price_list_margins" on price_list_margins
  for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin')))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin')));

-- ---------- 2. cost_batches (versioned cost entry) ----------
create table if not exists cost_batches (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid references product_categories(id) on delete set null, -- null = mixed / all
  effective_date date not null default current_date,
  note           text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_cost_batches_date on cost_batches (effective_date desc);

alter table cost_batches enable row level security;

drop policy if exists "admin finance read cost_batches" on cost_batches;
create policy "admin finance read cost_batches" on cost_batches
  for select using (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin', 'finance')));

drop policy if exists "admin finance insert cost_batches" on cost_batches;
create policy "admin finance insert cost_batches" on cost_batches
  for insert with check (exists(select 1 from user_roles r where r.user_id = auth.uid()
                and r.role in ('admin', 'super_admin', 'finance')));

-- ---------- 3. cost_rmb_history: link to batch + effective date ----------
alter table cost_rmb_history add column if not exists batch_id uuid references cost_batches(id) on delete set null;
alter table cost_rmb_history add column if not exists effective_date date;

create index if not exists idx_cost_rmb_history_batch on cost_rmb_history (batch_id);

notify pgrst, 'reload schema';
