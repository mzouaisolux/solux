-- Operational tracking — phase 2.
--
-- Extends production_orders so the operational workflow can be tracked end
-- to end (validation → deposit → production → completion → delivery) with
-- proper alerting + delay computation.
--
-- New columns
-- ----------------------------------------------------------------------------
--   production_validation_date   When the task list was validated and
--                                submitted to production. Stamped by the
--                                app when ensureProductionOrderForTaskList
--                                runs. Acts as the operational "day zero".
--
--   production_working_days      How many working days the production team
--                                committed to. Set by TLM once the order
--                                is scheduled. Combined with
--                                production_validation_date this derives
--                                the initial_production_deadline.
--
-- New helper
-- ----------------------------------------------------------------------------
--   add_working_days(start, n)   Adds N business days to a start date,
--                                skipping Saturdays and Sundays. Pure
--                                deterministic SQL — no holiday calendar
--                                (intentionally; holidays are a country/
--                                factory concern that can be added later).
--
-- Backfill
-- ----------------------------------------------------------------------------
--   Existing rows get production_validation_date populated from the linked
--   task list's validated_at (preferred) or the production_order's
--   created_at (fallback). production_working_days is left null for
--   existing rows — the TLM fills it in when they next touch the order.
--
-- Run in Supabase SQL Editor. Idempotent.

begin;

-- ===========================================================================
-- 1. add_working_days(start_date, n_days) → date
--    Skips weekends. n_days = 0 returns start_date. n_days negative subtracts.
-- ===========================================================================
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
    -- extract(dow) → 0 = Sunday, 6 = Saturday
    if extract(dow from result) not in (0, 6) then
      remaining := remaining - 1;
    end if;
  end loop;
  return result;
end;
$$;

-- ===========================================================================
-- 2. New columns on production_orders
-- ===========================================================================
alter table production_orders
  add column if not exists production_validation_date date,
  add column if not exists production_working_days integer
    check (production_working_days is null or production_working_days >= 0);

-- ===========================================================================
-- 3. Backfill production_validation_date for existing rows.
--
--    Priority order:
--      1. The linked task_list.validated_at — this is the most accurate
--         "operational day zero" (the moment TLM said "go").
--      2. The production_order's own created_at — used when validated_at
--         is missing (e.g. legacy task lists that pre-date migration 015,
--         or rows from migration 020's backfill).
-- ===========================================================================
update production_orders po
set production_validation_date = coalesce(
  (
    select tl.validated_at::date
    from production_task_lists tl
    where tl.id = po.task_list_id
  ),
  po.created_at::date
)
where po.production_validation_date is null;

-- ===========================================================================
-- 4. Index to support upcoming-completion queries on the operations page.
--    The /operations dashboard filters orders whose computed completion
--    falls inside an alert window — we lean on (status, current_deadline)
--    which already exists from migration 018, so no new index needed here.
-- ===========================================================================

notify pgrst, 'reload schema';

commit;
