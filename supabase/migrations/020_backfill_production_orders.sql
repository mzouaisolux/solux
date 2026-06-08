-- Backfill production orders for task lists that pre-date migration 018
-- OR that bypassed the validate step (under_validation → production_ready
-- via "Mark production ready" never triggered the auto-create hook).
--
-- Creates a new production_order in status 'awaiting_deposit' for every
-- task list at validated/production_ready that doesn't already have one.
-- Numbers are assigned sequentially, picking up where the existing
-- PO-YY-NNNN counter left off.
--
-- Run in Supabase SQL Editor. Idempotent — safe to re-run; the NOT EXISTS
-- guard ensures already-linked task lists are skipped.

begin;

with new_pos as (
  select
    t.id as task_list_id,
    t.quotation_id,
    t.client_id,
    t.created_by,
    -- Stable order so re-running gives the same numbers if nothing
    -- else has been inserted in between.
    row_number() over (order by t.date, t.id) as seq
  from production_task_lists t
  where t.status in ('validated', 'production_ready')
    and not exists (
      select 1 from production_orders po
      where po.task_list_id = t.id
    )
),
counter as (
  -- Highest existing PO sequence for THIS calendar year, used as the
  -- baseline for the new numbers. Matches what next_production_order_number
  -- would produce if called per-row.
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
  created_by
)
select
  'PO-' || to_char(now(), 'YY') || '-' ||
    lpad((counter.max_n + new_pos.seq)::text, 4, '0'),
  new_pos.task_list_id,
  new_pos.quotation_id,
  new_pos.client_id,
  'awaiting_deposit',
  new_pos.created_by
from new_pos, counter;

notify pgrst, 'reload schema';

commit;

-- Verify after running:
--   select po.number, po.status, t.number as task_list_number, t.status as task_list_status
--   from production_orders po
--   join production_task_lists t on t.id = po.task_list_id
--   order by po.created_at desc;
