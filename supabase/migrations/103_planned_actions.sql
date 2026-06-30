-- =====================================================================
-- m103 — CRM step 4: planned_actions (the affair to-do engine).
-- =====================================================================
--
-- PLAN_CRM_SOLUX.md §8/§9.5: the CRM's heart is "what do I do next on
-- this deal, and by when". NOT a parallel activity module — the app
-- already has `events` (timeline/history) and the action-ack mechanics.
-- This is ONE thin table: a planned action (call / meeting / visit /
-- follow-up / send quote) with a due date, hanging off an affair. When
-- an action is completed it is logged into `events` (entity 'affair'),
-- so history lives in the existing timeline — zero duplication.
--
-- Golden rule (app layer): a live affair should ALWAYS have a next
-- action with a date. No open action = the affair page shows red.
--
-- Also here: the `events read scoped` policy (m092) enumerates entity
-- types, so the new entity_type='affair' events would be invisible to
-- sales. Re-created verbatim + an `affair` branch (owner/creator of the
-- affair, or owner/creator of its client). Broad roles unchanged.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) planned_actions — one thin table, no parallel timeline.
-- ---------------------------------------------------------------------
create table if not exists planned_actions (
  id          uuid primary key default gen_random_uuid(),
  affair_id   uuid not null references affairs(id) on delete cascade,
  action_type text not null
                check (action_type in ('call', 'meeting', 'visit', 'follow_up', 'send_quote', 'other')),
  title       text,            -- optional free label ("call back about pricing")
  due_date    date not null,   -- golden rule: an action always has a date
  done_at     timestamptz,     -- null = still to do
  done_by     uuid references auth.users(id) on delete set null,
  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_planned_actions_affair on planned_actions(affair_id);
-- The "my morning" / overdue views scan open actions by due date.
create index if not exists idx_planned_actions_open_due
  on planned_actions(due_date) where done_at is null;

alter table planned_actions enable row level security;

-- Read: an action is as visible as its affair (subquery inherits the
-- affairs read policy from m076 for the querying user).
drop policy if exists "planned_actions read scoped" on planned_actions;
create policy "planned_actions read scoped" on planned_actions for select using (
  exists (select 1 from affairs a where a.id = planned_actions.affair_id)
);

-- Writes: action creator, affair owner/creator, or management
-- (mirrors "affairs update scoped").
drop policy if exists "planned_actions write scoped" on planned_actions;
create policy "planned_actions write scoped" on planned_actions for all using (
  created_by = auth.uid()
  or exists (
    select 1 from affairs a
     where a.id = planned_actions.affair_id
       and (a.owner_id = auth.uid() or a.created_by = auth.uid())
  )
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations')
            or coalesce(r.super_admin, false))
  )
) with check (
  created_by = auth.uid()
  or exists (
    select 1 from affairs a
     where a.id = planned_actions.affair_id
       and (a.owner_id = auth.uid() or a.created_by = auth.uid())
  )
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations')
            or coalesce(r.super_admin, false))
  )
);

-- ---------------------------------------------------------------------
-- 2) events read scoped — m092 policy reproduced verbatim + an `affair`
--    branch so affair events (action planned/done) reach sales.
-- ---------------------------------------------------------------------
drop policy if exists "events read" on events;
drop policy if exists "events read scoped" on events;
create policy "events read scoped" on events for select using (
  -- Technical / admin / super-admin → full visibility (unchanged).
  exists (
    select 1 from user_roles ur
     where ur.user_id = auth.uid()
       and (
         ur.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(ur.super_admin, false)
       )
  )
  -- Sales scope: must own the underlying entity (unchanged branches).
  or (entity_type = 'document' and exists (
    select 1 from documents d
     where d.id = entity_id and d.created_by = auth.uid()
  ))
  or (entity_type = 'task_list' and exists (
    select 1 from production_task_lists tl
     join documents d on d.id = tl.quotation_id
     where tl.id = entity_id and d.created_by = auth.uid()
  ))
  or (entity_type = 'production_order' and exists (
    select 1 from production_orders po
     join documents d on d.id = po.quotation_id
     where po.id = entity_id and d.created_by = auth.uid()
  ))
  or (entity_type = 'client' and exists (
    select 1 from documents d
     where d.client_id = entity_id and d.created_by = auth.uid()
  ))
  -- project_request branch (m092, unchanged).
  or (entity_type = 'project_request' and (
        exists (
          select 1 from project_requests pr
           where pr.id = entity_id
             and (pr.owner_id = auth.uid() or pr.created_by = auth.uid())
        )
     or exists (
          select 1 from user_roles ur
           where ur.user_id = auth.uid()
             and ur.role in ('sales_director', 'finance')
        )
  ))
  -- NEW (m103): affair events — visible to the affair owner/creator and
  -- to the owner/creator of the affair's client. Mirrors the affairs
  -- read scope; does not widen any other event type's visibility.
  or (entity_type = 'affair' and exists (
    select 1 from affairs a
     where a.id = entity_id
       and (
         a.owner_id = auth.uid()
         or a.created_by = auth.uid()
         or exists (
           select 1 from clients c
            where c.id = a.client_id
              and (c.created_by = auth.uid() or c.sales_owner_id = auth.uid())
         )
       )
  ))
);

notify pgrst, 'reload schema';

commit;
