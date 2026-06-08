-- =====================================================================
-- DIAGNOSTIC — workflow state inspection
-- =====================================================================
--
-- Paste each block one at a time into the Supabase SQL Editor. Don't
-- run as a single script — we want to see each result separately.
--
-- Goal: pinpoint exactly why a freshly validated task list is not
-- appearing in /order-follow-up.
-- =====================================================================


-- ----------------------------------------------------------------------
-- BLOCK 1 — Are the required tables / columns even there?
-- ----------------------------------------------------------------------
-- Expected result: 4 rows, all "yes".
select 'production_orders table'                            as check_name,
       (select exists(select 1 from information_schema.tables
                      where table_name = 'production_orders'))::text as result
union all
select 'events table',
       (select exists(select 1 from information_schema.tables
                      where table_name = 'events'))::text
union all
select 'production_validation_date column on production_orders',
       (select exists(select 1 from information_schema.columns
                      where table_name = 'production_orders'
                        and column_name = 'production_validation_date'))::text
union all
select 'archived_at column on production_orders',
       (select exists(select 1 from information_schema.columns
                      where table_name = 'production_orders'
                        and column_name = 'archived_at'))::text;


-- ----------------------------------------------------------------------
-- BLOCK 2 — Does the RPC exist + does it return a value?
-- ----------------------------------------------------------------------
-- Expected: 1 row with proname = 'next_production_order_number'
select proname from pg_proc where proname = 'next_production_order_number';

-- Try calling it. Expected: returns 'PO-YY-NNNN' format.
-- If you get permission denied, RLS is blocking even read access.
select next_production_order_number() as test_call;


-- ----------------------------------------------------------------------
-- BLOCK 3 — What's the latest state of YOUR most recent task list?
-- ----------------------------------------------------------------------
-- This shows the last 5 task lists with their PO (if any) + doc info.
-- Look for the one you just validated.
--
-- KEY COLUMNS TO READ:
--   tl.status        = task list status (should be 'production_ready')
--   po.id            = NULL if PO was never created
--   po.status        = PO status (should be 'awaiting_deposit')
--   po.archived_at   = should be NULL (= active)
--
-- If po.id is NULL → auto-create didn't fire / silently failed.
-- If po.id exists but archived_at is set → row exists but filtered.
select
  tl.id                          as task_list_id,
  tl.number                      as task_list_number,
  tl.status                      as task_list_status,
  tl.validated_at,
  tl.created_at                  as tl_created_at,
  d.number                       as doc_number,
  d.status                       as doc_status,
  po.id                          as production_order_id,
  po.number                      as production_order_number,
  po.status                      as production_order_status,
  po.archived_at                 as po_archived_at,
  po.production_validation_date  as po_validation_date,
  po.created_at                  as po_created_at
from production_task_lists tl
left join production_orders po on po.task_list_id = tl.id
left join documents d           on d.id = tl.quotation_id
order by tl.created_at desc
limit 5;


-- ----------------------------------------------------------------------
-- BLOCK 4 — Orphan check: any task list validated/production_ready
--           without a linked PO?
-- ----------------------------------------------------------------------
-- If this returns > 0, the auto-create hook is broken.
select
  tl.id, tl.number, tl.status, tl.validated_at, tl.created_at
from production_task_lists tl
where tl.status in ('validated', 'production_ready')
  and not exists (
    select 1 from production_orders po where po.task_list_id = tl.id
  )
order by tl.created_at desc;


-- ----------------------------------------------------------------------
-- BLOCK 5 — Recent events for the task list you just validated.
-- ----------------------------------------------------------------------
-- If migration 022 ran, you should see events like:
--   tl.validated     (when you clicked Validate)
--   tl.production_ready  (when you clicked Mark Production Ready)
--   po.created       (when ensureProductionOrderForTaskList ran)
--
-- If po.created is MISSING but tl.production_ready is there:
--   → the auto-create logic was reached but failed silently.
-- If even tl.validated is missing:
--   → the emitEvent calls are failing (events table likely missing).
select
  event_type,
  severity,
  message,
  payload,
  created_at
from events
order by created_at desc
limit 20;


-- ----------------------------------------------------------------------
-- BLOCK 6 — Manually attempt the auto-create logic on the orphan.
-- ----------------------------------------------------------------------
-- If Block 4 returned any orphan, take ONE task_list_id from it,
-- substitute it into the query below, and try to insert manually.
-- This tells us if the INSERT itself is failing (e.g. RLS, FK, etc.)
-- or if something around the helper is the issue.
--
-- REPLACE 'YOUR-TASK-LIST-ID-HERE' with a real UUID from block 4.
/*
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
  next_production_order_number(),
  tl.id,
  tl.quotation_id,
  tl.client_id,
  'awaiting_deposit',
  coalesce(tl.validated_at::date, now()::date),
  tl.created_by
from production_task_lists tl
where tl.id = 'YOUR-TASK-LIST-ID-HERE'
  and not exists (
    select 1 from production_orders po where po.task_list_id = tl.id
  )
returning id, number, status;
*/


-- ----------------------------------------------------------------------
-- BLOCK 7 — Count production orders + archived state breakdown.
-- ----------------------------------------------------------------------
-- Gives a big-picture view of what's in the table.
select
  count(*)                                        as total_pos,
  count(*) filter (where archived_at is null)    as active_pos,
  count(*) filter (where archived_at is not null) as archived_pos,
  count(*) filter (where status = 'cancelled')   as cancelled_pos,
  count(*) filter (where status = 'awaiting_deposit') as awaiting_deposit
from production_orders;


-- ----------------------------------------------------------------------
-- BLOCK 8 — Verify the RLS policies on production_orders match what
--           we expect. Tells us if there's been policy drift.
-- ----------------------------------------------------------------------
select policyname, cmd, qual::text as using_clause
  from pg_policies
 where tablename = 'production_orders'
 order by policyname;
