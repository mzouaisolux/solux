-- =====================================================================
-- m172 — Sales Director can READ 'document' events (fix "emitted but muted")
-- =====================================================================
--
-- Problem
-- -------
-- doc.approved_price_changed (m168) is ROUTED to the Sales Director's bell
-- (event_routing: role='sales_director', channel='bell'). But the
-- `events read scoped` policy (m103) grants read on 'document' events only to
-- the broad roles (admin / task_list_manager / operations / super_admin) or to
-- the document's OWNER (created_by = self). A Sales Director is neither (the
-- quotation is created by Sales), so under RLS they could not READ the event
-- they were notified about — the bell was emitted yet permanently empty
-- ("emitted but muted"). Proven live on a real sales_director session.
--
-- Fix
-- ---
-- Add ONE read branch: a Sales Director may read 'document' events. This is the
-- minimal grant that closes the only routing↔RLS gap (see the notification
-- routing seed): every other routed recipient already reads its entity
-- (operations = broad; sales = owner-scoped; sales_director already reads
-- 'project_request' via m092/m103). Read-only, no other event type widened.
-- Mirrors the intent of the existing project_request branch that already grants
-- sales_director + finance oversight visibility.
--
-- The Sales Director is the head of sales and oversees ALL quotations /
-- proformas / invoices, so org-wide read of document events is appropriate.
-- (finance is NOT added: nothing routes 'document' events to finance today; add
-- it in a future migration if/when routing does.)
--
-- This migration reproduces the m103 policy body verbatim and appends the new
-- branch (create policy replaces wholesale). Idempotent. Safe to re-run.
-- =====================================================================

begin;

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
  -- NEW (m172): the Sales Director oversees ALL quotations/invoices, so they
  -- must be able to READ 'document' events they are routed (e.g.
  -- doc.approved_price_changed, m168). Without this the bell was emitted yet
  -- unreadable. Read-only; aligns RLS with the notification routing.
  or (entity_type = 'document' and exists (
    select 1 from user_roles ur
     where ur.user_id = auth.uid() and ur.role = 'sales_director'
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
  -- affair events (m103, unchanged).
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

-- ---------------------------------------------------------------------
-- Smoke (run separately, as a real sales_director session):
--   -- The Sales Director can now read a document event they did not create:
--   select count(*) from events where entity_type = 'document';
--   -- Expected: > 0 (previously 0 for a non-owner sales_director)
-- ---------------------------------------------------------------------
