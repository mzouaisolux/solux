-- =====================================================================
-- Diagnostics page RPCs — health counters with sample offenders.
-- =====================================================================
--
-- The /admin/diagnostics page needs cross-table sanity checks that
-- intentionally bypass RLS (we want company-wide truth, not the
-- caller's filtered view). SECURITY DEFINER + a one-shot JSONB return
-- keeps the page to a single round-trip.
--
-- Each section of the result has the same shape:
--   { "count": <bigint>, "samples": [<up to 10 offenders>] }
--
-- Sections covered (per étape 5 cadrage):
--   1. task_lists_won_without_po
--      Task lists in production status (validated / production_ready)
--      with no row in production_orders. Signals failure of the
--      ensureProductionOrderForTaskList auto-creation.
--   2. docs_won_without_task_list
--      Documents marked won that never spawned a non-cancelled task
--      list. Sometimes legitimate (services-only deals), but
--      surfaced so super-admin can sanity-check.
--   3. pos_past_deadline_active
--      Production orders whose current_production_deadline is in the
--      past AND status is not terminal. Delivery slippage signal.
--   4. docs_cancelled_with_active_tl
--      Drift between the cancellation trigger and the task list
--      state. Should be ZERO if migration 023 is healthy.
--   5. clients_archived_with_active_po
--      A client was archived while still having open production.
--      Either restore the client or close the PO.
--   6. users_without_role
--      auth.users without a row in user_roles. They get the default
--      'sales' role implicitly — surface them so admin can assign
--      properly.
--
-- The function is callable by any authenticated user; the route gating
-- (requireCapability("admin.diagnostics")) is the actual access barrier.
-- Even if a non-super-admin called this RPC directly via REST they'd
-- only get aggregate counts + sample numbers — no PII. Designed to be
-- safe to widen later if needed.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

drop function if exists admin_diagnostics_health();

create or replace function admin_diagnostics_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  -- ----- 1. Task lists in production status without PO -----
  with offenders as (
    select tl.id, tl.number
    from production_task_lists tl
    where tl.status in ('validated', 'production_ready')
      and tl.archived_at is null
      and not exists (
        select 1 from production_orders po
        where po.task_list_id = tl.id
      )
    order by tl.created_at desc
    limit 10
  ),
  total as (
    select count(*) as c
    from production_task_lists tl
    where tl.status in ('validated', 'production_ready')
      and tl.archived_at is null
      and not exists (
        select 1 from production_orders po
        where po.task_list_id = tl.id
      )
  )
  select jsonb_build_object(
    'count', (select c from total),
    'samples', coalesce(
      (select jsonb_agg(jsonb_build_object('id', id, 'number', number)) from offenders),
      '[]'::jsonb
    )
  ) into result;
  result := jsonb_build_object('task_lists_won_without_po', result);

  -- ----- 2. Docs won without (non-cancelled) task list -----
  with offenders as (
    select d.id, d.number
    from documents d
    where d.status = 'won'
      and d.archived_at is null
      and not exists (
        select 1 from production_task_lists tl
        where tl.quotation_id = d.id
          and tl.status <> 'cancelled'
      )
    order by d.date desc
    limit 10
  ),
  total as (
    select count(*) as c
    from documents d
    where d.status = 'won'
      and d.archived_at is null
      and not exists (
        select 1 from production_task_lists tl
        where tl.quotation_id = d.id
          and tl.status <> 'cancelled'
      )
  )
  select result || jsonb_build_object(
    'docs_won_without_task_list',
    jsonb_build_object(
      'count', (select c from total),
      'samples', coalesce(
        (select jsonb_agg(jsonb_build_object('id', id, 'number', number)) from offenders),
        '[]'::jsonb
      )
    )
  ) into result;

  -- ----- 3. POs past deadline + non-terminal -----
  with offenders as (
    select po.id, po.number, po.current_production_deadline as deadline
    from production_orders po
    where po.current_production_deadline is not null
      and po.current_production_deadline < current_date
      and po.status not in ('delivered', 'cancelled')
      and po.archived_at is null
    order by po.current_production_deadline asc
    limit 10
  ),
  total as (
    select count(*) as c
    from production_orders po
    where po.current_production_deadline is not null
      and po.current_production_deadline < current_date
      and po.status not in ('delivered', 'cancelled')
      and po.archived_at is null
  )
  select result || jsonb_build_object(
    'pos_past_deadline_active',
    jsonb_build_object(
      'count', (select c from total),
      'samples', coalesce(
        (select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'deadline', deadline)) from offenders),
        '[]'::jsonb
      )
    )
  ) into result;

  -- ----- 4. Docs cancelled but TL still active (drift) -----
  with offenders as (
    select tl.id, tl.number, d.number as doc_number
    from production_task_lists tl
    join documents d on d.id = tl.quotation_id
    where d.status = 'cancelled'
      and tl.status <> 'cancelled'
      and tl.archived_at is null
    order by tl.created_at desc
    limit 10
  ),
  total as (
    select count(*) as c
    from production_task_lists tl
    join documents d on d.id = tl.quotation_id
    where d.status = 'cancelled'
      and tl.status <> 'cancelled'
      and tl.archived_at is null
  )
  select result || jsonb_build_object(
    'docs_cancelled_with_active_tl',
    jsonb_build_object(
      'count', (select c from total),
      'samples', coalesce(
        (select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'doc_number', doc_number)) from offenders),
        '[]'::jsonb
      )
    )
  ) into result;

  -- ----- 5. Clients archived with active POs -----
  with offenders as (
    select po.id, po.number, c.company_name
    from production_orders po
    join clients c on c.id = po.client_id
    where c.archived_at is not null
      and po.status not in ('delivered', 'cancelled')
      and po.archived_at is null
    order by po.created_at desc
    limit 10
  ),
  total as (
    select count(*) as c
    from production_orders po
    join clients cl on cl.id = po.client_id
    where cl.archived_at is not null
      and po.status not in ('delivered', 'cancelled')
      and po.archived_at is null
  )
  select result || jsonb_build_object(
    'clients_archived_with_active_po',
    jsonb_build_object(
      'count', (select c from total),
      'samples', coalesce(
        (select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'company_name', company_name)) from offenders),
        '[]'::jsonb
      )
    )
  ) into result;

  -- ----- 6. Users without role -----
  with offenders as (
    select u.id, u.email
    from auth.users u
    where not exists (
      select 1 from public.user_roles ur where ur.user_id = u.id
    )
    order by u.created_at desc
    limit 10
  ),
  total as (
    select count(*) as c
    from auth.users u
    where not exists (
      select 1 from public.user_roles ur where ur.user_id = u.id
    )
  )
  select result || jsonb_build_object(
    'users_without_role',
    jsonb_build_object(
      'count', (select c from total),
      'samples', coalesce(
        (select jsonb_agg(jsonb_build_object('id', id, 'email', email)) from offenders),
        '[]'::jsonb
      )
    )
  ) into result;

  return result;
end;
$$;

grant execute on function admin_diagnostics_health() to authenticated;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select admin_diagnostics_health();
--   -- Expected: jsonb with 6 keys, each containing { count, samples[] }
-- ---------------------------------------------------------------------
