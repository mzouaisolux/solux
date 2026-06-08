-- Production orders + deadline change history.
--
-- A production_order is the operational tracking object that exists after
-- a task list has been validated by the production team. Quotations + task
-- lists handle "what to make"; production_orders handle "where it stands
-- on the floor right now" — deposit, scheduling, deadlines, delays,
-- shipment, delivery.
--
-- One production_order per validated task list (UNIQUE on task_list_id).
-- Auto-created in app code when a task list flips to "validated" — see
-- app/(app)/task-lists/[id]/actions.ts validateTaskList.
--
-- Critical invariant: initial_production_deadline is set ONCE (the first
-- time a deadline is recorded) and never overwritten thereafter. The app
-- layer enforces this so we don't need a DB trigger.
--
-- Run in Supabase SQL Editor. Idempotent.

begin;

-- ===========================================================================
-- 1. NUMBERING — PO-YY-NNNN per calendar year
-- ===========================================================================
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

-- ===========================================================================
-- 2. production_orders
-- ===========================================================================
create table if not exists production_orders (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  -- 1:1 with a validated task list. UNIQUE prevents accidental duplicates.
  task_list_id uuid not null unique
    references production_task_lists(id) on delete cascade,
  -- Denormalized links for fast filtering + cheap joins on the list pages.
  quotation_id uuid not null references documents(id) on delete cascade,
  client_id uuid references clients(id),
  -- 10-state operational workflow.
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
  -- Deadline tracking. initial_production_deadline is immutable after the
  -- first write — the app layer enforces this so we keep a clean audit
  -- trail of "we said X originally, here's where we ended up".
  initial_production_deadline date,
  current_production_deadline date,
  actual_completion_date date,
  -- Shipment fields
  shipment_booked boolean not null default false,
  etd date,
  eta date,
  shipping_notes text,
  -- Audit
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

-- ===========================================================================
-- 3. production_deadline_changes — audit log of deadline modifications
-- ===========================================================================
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

-- ===========================================================================
-- 4. RLS — sales sees orders linked to their docs (read-only),
--          TLM + admin write everything
-- ===========================================================================
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

notify pgrst, 'reload schema';

commit;
