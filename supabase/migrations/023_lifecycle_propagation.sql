-- =====================================================================
-- Lifecycle propagation triggers — cancellation cascades.
-- =====================================================================
--
-- Why DB triggers (vs app-level cascade)?
--   The app layer has spent multiple weeks failing to keep statuses in
--   sync (cancelled quotation with task list still validated and PO
--   still in_production). Triggers make the propagation impossible to
--   bypass: every code path that writes documents.status = 'cancelled'
--   (server actions, manual SQL, future bulk imports) inherits the
--   cascade for free. No more silent inconsistencies.
--
-- What this does
-- ----------------------------------------------------------------------
-- 1. When `documents.status` transitions to `'cancelled'` or `'lost'`:
--      - Set `production_task_lists.status = 'cancelled'` for every
--        task list linked to that document (unless already cancelled)
--      - Set `production_orders.status = 'cancelled'` for every PO
--        linked to that document (unless already cancelled or delivered)
--      - Emit `events` rows for each cascade with severity 'critical'
--
-- 2. When `production_task_lists.status` transitions to `'cancelled'`:
--      - Set `production_orders.status = 'cancelled'` for the linked
--        PO (unless already cancelled or delivered)
--      - Emit event row
--
-- Idempotent. Triggers are dropped + recreated. Safe to re-run.
-- =====================================================================

begin;

-- ----------------------------------------------------------------------
-- 1. Document cancellation → task list + production order
-- ----------------------------------------------------------------------
create or replace function propagate_document_cancellation()
returns trigger
language plpgsql
as $$
declare
  affected_tl record;
  affected_po record;
begin
  -- Fire only on a real transition INTO cancelled / lost. UPDATEs that
  -- set status to the same terminal value should not re-cascade.
  if NEW.status not in ('cancelled', 'lost') then
    return NEW;
  end if;
  if OLD.status = NEW.status then
    return NEW;
  end if;

  -- Cascade to every linked task list still alive.
  for affected_tl in
    select id, status, number
      from production_task_lists
     where quotation_id = NEW.id
       and status not in ('cancelled')
  loop
    update production_task_lists
       set status = 'cancelled'
     where id = affected_tl.id;

    -- Audit trail — best-effort, but the events table is critical
    -- enough that we let failures abort the trigger if RLS / column
    -- drift breaks it. If you see triggers failing, fix the events
    -- table first.
    insert into events (entity_type, entity_id, event_type, severity,
                        message, payload, actor_id)
    values (
      'task_list',
      affected_tl.id,
      'tl.cancelled',
      'critical',
      'Cancelled automatically: parent quotation moved to ' || NEW.status,
      jsonb_build_object(
        'cascade_from', 'document',
        'source_id', NEW.id,
        'source_event', 'doc.' || NEW.status,
        'previous_status', affected_tl.status,
        'task_list_number', affected_tl.number
      ),
      auth.uid()
    );
  end loop;

  -- Cascade to every linked production order that isn't already
  -- cancelled or delivered. We exclude delivered because once goods
  -- have shipped the order is operationally closed — cancelling it
  -- doesn't make sense and would corrupt revenue reporting.
  for affected_po in
    select id, status, number
      from production_orders
     where quotation_id = NEW.id
       and status not in ('cancelled', 'delivered')
  loop
    update production_orders
       set status = 'cancelled'
     where id = affected_po.id;

    insert into events (entity_type, entity_id, event_type, severity,
                        message, payload, actor_id)
    values (
      'production_order',
      affected_po.id,
      'po.cancelled',
      'critical',
      'Cancelled automatically: parent quotation moved to ' || NEW.status,
      jsonb_build_object(
        'cascade_from', 'document',
        'source_id', NEW.id,
        'source_event', 'doc.' || NEW.status,
        'previous_status', affected_po.status,
        'production_order_number', affected_po.number
      ),
      auth.uid()
    );
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_propagate_doc_cancellation on documents;
create trigger trg_propagate_doc_cancellation
  after update of status on documents
  for each row
  execute function propagate_document_cancellation();

-- ----------------------------------------------------------------------
-- 2. Task list cancellation → production order
-- ----------------------------------------------------------------------
create or replace function propagate_task_list_cancellation()
returns trigger
language plpgsql
as $$
declare
  affected_po record;
begin
  if NEW.status != 'cancelled' then
    return NEW;
  end if;
  if OLD.status = NEW.status then
    return NEW;
  end if;

  for affected_po in
    select id, status, number
      from production_orders
     where task_list_id = NEW.id
       and status not in ('cancelled', 'delivered')
  loop
    update production_orders
       set status = 'cancelled'
     where id = affected_po.id;

    insert into events (entity_type, entity_id, event_type, severity,
                        message, payload, actor_id)
    values (
      'production_order',
      affected_po.id,
      'po.cancelled',
      'critical',
      'Cancelled automatically: parent task list was cancelled',
      jsonb_build_object(
        'cascade_from', 'task_list',
        'source_id', NEW.id,
        'previous_status', affected_po.status,
        'production_order_number', affected_po.number
      ),
      auth.uid()
    );
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_propagate_task_list_cancellation on production_task_lists;
create trigger trg_propagate_task_list_cancellation
  after update of status on production_task_lists
  for each row
  execute function propagate_task_list_cancellation();

-- ----------------------------------------------------------------------
-- 3. Backfill — find existing INCONSISTENT rows and cascade them.
--
--    Why: before this migration, an app bug could have left
--    `documents.status = 'cancelled'` with a task list still
--    `validated` and a PO still `in_production`. The triggers fire on
--    new UPDATEs only, so we need to manually sweep the existing rows
--    once.
--
--    This is the same logic as the trigger functions but applied to
--    the historical state. It also produces events so the audit log
--    captures the backfill.
-- ----------------------------------------------------------------------

-- 3a. Task lists whose parent document is cancelled/lost
with retro_tl as (
  select tl.id, tl.status as prev_status, tl.number,
         d.id as doc_id, d.status as doc_status
    from production_task_lists tl
    join documents d on d.id = tl.quotation_id
   where d.status in ('cancelled', 'lost')
     and tl.status != 'cancelled'
), upd as (
  update production_task_lists tl
     set status = 'cancelled'
    from retro_tl r
   where tl.id = r.id
  returning tl.id
)
insert into events (entity_type, entity_id, event_type, severity, message, payload)
select 'task_list', r.id, 'tl.cancelled', 'critical',
       'Cancelled retroactively (backfill from migration 023): parent quotation was ' || r.doc_status,
       jsonb_build_object(
         'cascade_from', 'document',
         'source_id', r.doc_id,
         'backfill', true,
         'previous_status', r.prev_status,
         'task_list_number', r.number
       )
  from retro_tl r;

-- 3b. POs whose parent document is cancelled/lost
with retro_po as (
  select po.id, po.status as prev_status, po.number,
         d.id as doc_id, d.status as doc_status
    from production_orders po
    join documents d on d.id = po.quotation_id
   where d.status in ('cancelled', 'lost')
     and po.status not in ('cancelled', 'delivered')
), upd as (
  update production_orders po
     set status = 'cancelled'
    from retro_po r
   where po.id = r.id
  returning po.id
)
insert into events (entity_type, entity_id, event_type, severity, message, payload)
select 'production_order', r.id, 'po.cancelled', 'critical',
       'Cancelled retroactively (backfill from migration 023): parent quotation was ' || r.doc_status,
       jsonb_build_object(
         'cascade_from', 'document',
         'source_id', r.doc_id,
         'backfill', true,
         'previous_status', r.prev_status,
         'production_order_number', r.number
       )
  from retro_po r;

-- 3c. POs whose parent task list is cancelled (but doc isn't)
with retro_po2 as (
  select po.id, po.status as prev_status, po.number,
         tl.id as tl_id
    from production_orders po
    join production_task_lists tl on tl.id = po.task_list_id
   where tl.status = 'cancelled'
     and po.status not in ('cancelled', 'delivered')
), upd as (
  update production_orders po
     set status = 'cancelled'
    from retro_po2 r
   where po.id = r.id
  returning po.id
)
insert into events (entity_type, entity_id, event_type, severity, message, payload)
select 'production_order', r.id, 'po.cancelled', 'critical',
       'Cancelled retroactively (backfill from migration 023): parent task list was cancelled',
       jsonb_build_object(
         'cascade_from', 'task_list',
         'source_id', r.tl_id,
         'backfill', true,
         'previous_status', r.prev_status,
         'production_order_number', r.number
       )
  from retro_po2 r;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- Verification queries (run separately after the migration):
-- =====================================================================
--
-- -- Should be 0: orphan cancellations (doc cancelled but TL still alive)
-- select count(*)
--   from documents d
--   join production_task_lists tl on tl.quotation_id = d.id
--  where d.status in ('cancelled', 'lost')
--    and tl.status != 'cancelled';
--
-- -- Should be 0: orphan cancellations (doc cancelled but PO still alive)
-- select count(*)
--   from documents d
--   join production_orders po on po.quotation_id = d.id
--  where d.status in ('cancelled', 'lost')
--    and po.status not in ('cancelled', 'delivered');
--
-- -- Should be 0: orphan cancellations (TL cancelled but PO still alive)
-- select count(*)
--   from production_task_lists tl
--   join production_orders po on po.task_list_id = tl.id
--  where tl.status = 'cancelled'
--    and po.status not in ('cancelled', 'delivered');
--
-- -- See the backfill events that were created
-- select event_type, severity, message, payload->>'backfill' as is_backfill, created_at
--   from events
--  where (payload->>'backfill')::boolean = true
--  order by created_at desc;
