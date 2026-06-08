-- =====================================================================
-- ONE-SHOT SETUP : production_orders + operational tracking
-- =====================================================================
--
-- Combines migrations 018, 019, 020, 021 into one idempotent bundle.
-- Run this single file in the Supabase SQL Editor.
--
-- What it does, in order:
--   1. Creates the production_orders table + numbering RPC + RLS (018)
--   2. Adds payment-tracking columns (019)
--   3. Backfills production_orders rows for legacy validated task lists (020)
--   4. Adds operational tracking columns + working-day function (021)
--
-- Safe to re-run: every statement uses `if not exists` / `create or replace`
-- / `on conflict do nothing` so re-running is a no-op.
-- =====================================================================

begin;

-- =====================================================================
-- MIGRATION 018 — production_orders + deadline change history
-- =====================================================================

create or replace function next_production_order_number() returns text
language plpgsql as $$
declare
  yr text := to_char(now(), 'YY');
  n int;
begin
  select coalesce(max((regexp_match(number, '-([0-9]+)$'))[1]::int), 0) + 1
  into n
  from production_orders
  where number like 'PO-' || yr || '-%';
  return 'PO-' || yr || '-' || lpad(n::text, 4, '0');
end; $$;

create table if not exists production_orders (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  task_list_id uuid not null unique
    references production_task_lists(id) on delete cascade,
  quotation_id uuid not null references documents(id) on delete cascade,
  client_id uuid references clients(id),
  status text not null default 'awaiting_deposit'
    check (status in (
      'awaiting_deposit',
      'deposit_received',
      'production_scheduled',
      'in_production',
      'production_delayed',
      'production_completed',
      'shipment_booked',
      'shipped',
      'delivered',
      'cancelled'
    )),
  initial_production_deadline date,
  current_production_deadline date,
  actual_completion_date date,
  shipment_booked boolean not null default false,
  etd date,
  eta date,
  shipping_notes text,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz default now()
);

create index if not exists idx_production_orders_status
  on production_orders (status, current_production_deadline);
create index if not exists idx_production_orders_quotation
  on production_orders (quotation_id);
create index if not exists idx_production_orders_client
  on production_orders (client_id);

create table if not exists production_deadline_changes (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null
    references production_orders(id) on delete cascade,
  previous_date date,
  new_date date not null,
  changed_by uuid references auth.users(id),
  reason text,
  created_at timestamptz default now()
);

create index if not exists idx_pdc_order
  on production_deadline_changes (production_order_id, created_at desc);

-- RLS
alter table production_orders enable row level security;
alter table production_deadline_changes enable row level security;

drop policy if exists "po select" on production_orders;
create policy "po select" on production_orders for select using (
  exists(
    select 1 from documents d
    where d.id = quotation_id and (
      d.created_by = auth.uid()
      or exists(
        select 1 from user_roles r
        where r.user_id = auth.uid()
          and r.role in ('admin', 'task_list_manager')
      )
    )
  )
);

drop policy if exists "po write" on production_orders;
create policy "po write" on production_orders for all using (
  exists(
    select 1 from user_roles r
    where r.user_id = auth.uid()
      and r.role in ('admin', 'task_list_manager')
  )
) with check (
  exists(
    select 1 from user_roles r
    where r.user_id = auth.uid()
      and r.role in ('admin', 'task_list_manager')
  )
);

drop policy if exists "pdc select" on production_deadline_changes;
create policy "pdc select" on production_deadline_changes for select using (
  exists(
    select 1 from production_orders po
    join documents d on d.id = po.quotation_id
    where po.id = production_order_id and (
      d.created_by = auth.uid()
      or exists(
        select 1 from user_roles r
        where r.user_id = auth.uid()
          and r.role in ('admin', 'task_list_manager')
      )
    )
  )
);

drop policy if exists "pdc write" on production_deadline_changes;
create policy "pdc write" on production_deadline_changes for all using (
  exists(
    select 1 from user_roles r
    where r.user_id = auth.uid()
      and r.role in ('admin', 'task_list_manager')
  )
) with check (
  exists(
    select 1 from user_roles r
    where r.user_id = auth.uid()
      and r.role in ('admin', 'task_list_manager')
  )
);

-- =====================================================================
-- MIGRATION 019 — payment tracking columns
-- =====================================================================

alter table production_orders
  add column if not exists deposit_received_amount numeric not null default 0,
  add column if not exists deposit_received_at date,
  add column if not exists balance_received_amount numeric not null default 0,
  add column if not exists balance_received_at date,
  add column if not exists payment_notes text;

-- =====================================================================
-- MIGRATION 021 — operational tracking columns + working-day helper
-- (Done before 020 so the backfill can populate production_validation_date)
-- =====================================================================

create or replace function add_working_days(start_date date, n_days int)
returns date
language plpgsql
immutable
as $$
declare
  result date := start_date;
  step int := case when n_days >= 0 then 1 else -1 end;
  remaining int := abs(coalesce(n_days, 0));
begin
  if start_date is null or n_days is null then return null; end if;
  while remaining > 0 loop
    result := result + step;
    if extract(dow from result) not in (0, 6) then
      remaining := remaining - 1;
    end if;
  end loop;
  return result;
end;
$$;

alter table production_orders
  add column if not exists production_validation_date date,
  add column if not exists production_working_days integer
    check (production_working_days is null or production_working_days >= 0);

-- =====================================================================
-- MIGRATION 020 — backfill production_orders for legacy validated task lists
-- =====================================================================

with new_pos as (
  select
    t.id              as task_list_id,
    t.quotation_id    as quotation_id,
    t.client_id       as client_id,
    t.created_by      as created_by,
    coalesce(t.validated_at::date, now()::date) as validation_date,
    row_number() over (order by t.date, t.id) as seq
  from production_task_lists t
  where t.status in ('validated', 'production_ready')
    and not exists (
      select 1 from production_orders po
      where po.task_list_id = t.id
    )
),
counter as (
  select coalesce(
           max((regexp_match(number, '-([0-9]+)$'))[1]::int),
           0
         ) as max_n
  from production_orders
  where number like 'PO-' || to_char(now(), 'YY') || '-%'
)
insert into production_orders (
  number,
  task_list_id,
  quotation_id,
  client_id,
  status,
  production_validation_date,
  created_by
)
select
  'PO-' || to_char(now(), 'YY') || '-' ||
    lpad((counter.max_n + new_pos.seq)::text, 4, '0'),
  new_pos.task_list_id,
  new_pos.quotation_id,
  new_pos.client_id,
  'awaiting_deposit',
  new_pos.validation_date,
  new_pos.created_by
from new_pos, counter
on conflict (task_list_id) do nothing;

-- =====================================================================
-- VERIFICATION — counts so you can see what happened
-- =====================================================================

-- Refresh PostgREST schema cache so the new tables/columns are usable
-- by the app immediately.
notify pgrst, 'reload schema';

commit;

-- Run these queries separately AFTER the bundle to verify success:
--
--   select count(*) as pos from production_orders;
--   select count(*) as tls_validated from production_task_lists
--     where status in ('validated', 'production_ready');
--   select column_name from information_schema.columns
--     where table_name = 'production_orders'
--       and column_name in ('production_validation_date', 'production_working_days');
--   -- Should return 2 rows
--
-- Expected: pos = tls_validated  (every validated task list has a PO)
