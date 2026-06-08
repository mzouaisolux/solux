-- =====================================================================
-- m092 — Project Requests: notification visibility fix.
--
-- AUDIT FINDING
-- ------------
-- The `events read scoped` policy (m046) predates Project Requests and the
-- `sales_director` role. It only scopes document/task_list/production_order/
-- client events, and its "broad" roles are admin/task_list_manager/operations/
-- super_admin. Consequence: the Sales Director and Sales see NO
-- `project_request` events, so the workflow handoff notifications (Factory
-- Cost completed, Ready for Pricing, Priced, Quotation generated) never reach
-- them and the bell stays silent. Separately, `finance` can read
-- factory_cost_requests (m091) but NOT the parent project_requests (m090) —
-- so the Cost Requests view shows nothing for finance.
--
-- FIX (additive, surgical):
--   1. Re-create `events read scoped` reproducing the existing branches
--      verbatim + a new `project_request` branch (owner=sales sees own;
--      sales_director + finance see all project events). No other event
--      type's visibility changes.
--   2. Re-create `project_requests read` adding `finance` to the role list.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------- 1. events read scoped (+ project_request branch) ----------
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
  -- NEW: project_request events. Owner (sales) sees their own; the Sales
  -- Director and Finance see all project events (their workflow role). This
  -- does NOT widen their access to any other event type.
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
);

-- ---------- 2. project_requests read (+ finance) ----------
drop policy if exists "project_requests read" on project_requests;
create policy "project_requests read" on project_requests for select using (
  owner_id = auth.uid()
  or created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin','task_list_manager','operations','sales_director','finance')
            or coalesce(r.super_admin, false))
  )
);

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, as the relevant users):
--   -- Director / Sales now see project events:
--   select count(*) from events where entity_type = 'project_request';
--   -- Finance can see project rows:
--   select count(*) from project_requests;
-- ---------------------------------------------------------------------
