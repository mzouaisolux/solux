-- =====================================================================
-- m108 — Tender workflow optimisation (lead-gen pipeline).
-- =====================================================================
--
-- 1) OWNERSHIP — the tender pool is managed by the lead manager /
--    Sales Director, not by every salesperson:
--      • sales see ONLY tenders assigned to them (owner) or that they
--        created themselves;
--      • sales_director / admin / super_admin (+ TLM / operations, the
--        usual broad back-office set) keep full visibility;
--      • participants + tender next-actions INHERIT the tender's
--        visibility instead of being pool-wide.
--
-- 2) PARTNER SELECTION — a tender-sourced opportunity often exists
--    BEFORE the local partner (distributor / EPC / installer) is known.
--    The affair lifecycle gains a 'partner_selection' stage so an
--    opportunity can be created with NO client attached and live in
--    that stage until the partner is chosen.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) affairs.status — add 'partner_selection' (name-agnostic re-create,
--    same technique as m077).
-- ---------------------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'affairs'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table affairs drop constraint %I', c.conname);
  end loop;
end $$;

alter table affairs
  add constraint affairs_status_check check (status in (
    'lead','partner_selection','opportunity','quotation','negotiation','won',
    'in_production','shipped','completed','lost','abandoned'
  ));

-- ---------------------------------------------------------------------
-- 2) tenders read — assigned-only for sales, full for management.
-- ---------------------------------------------------------------------
drop policy if exists "tenders read" on tenders;
create policy "tenders read" on tenders for select using (
  owner_id = auth.uid()
  or created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations', 'sales_director')
            or coalesce(r.super_admin, false))
  )
);

-- Participants + tender next-actions follow the tender they belong to
-- (the subqueries run through the tenders policy for the current user).
drop policy if exists "tender_participants read" on tender_participants;
create policy "tender_participants read" on tender_participants for select using (
  exists (select 1 from tenders t where t.id = tender_participants.tender_id)
);

drop policy if exists "planned_actions read scoped" on planned_actions;
create policy "planned_actions read scoped" on planned_actions for select using (
  (affair_id is not null and exists (select 1 from affairs a where a.id = planned_actions.affair_id))
  or (tender_id is not null and exists (select 1 from tenders t where t.id = planned_actions.tender_id))
);

notify pgrst, 'reload schema';

commit;
