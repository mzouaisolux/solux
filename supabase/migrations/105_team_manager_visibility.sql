-- =====================================================================
-- m105 — CRM step 6: team-manager visibility (who sees what via teams).
-- =====================================================================
--
-- PLAN_CRM_SOLUX §9 (ownership & teams): "la hiérarchie (qui voit quoi)
-- passe par teams + team_members (member_role member/manager). Un
-- directeur commercial voit les affaires de son équipe via ça."
--
-- Today the affairs/clients read policies have NO team branch, so the
-- manager morning view (/morning) would show a manager nothing but
-- their own deals. This migration re-creates both read policies
-- verbatim + adds:
--
--   • affairs:  a team MANAGER sees affairs owned/created by members of
--     the teams they manage. (planned_actions read inherits affairs —
--     m103 — so team actions become visible automatically.)
--   • clients:  same branch (sales_owner_id/created_by in managed team),
--     plus the missing `sales_owner_id = auth.uid()` branch — m066 made
--     "owner = sales_owner_id ?? created_by" the resolution rule
--     everywhere, but the m058 read policy predates it: an account
--     manager ASSIGNED to a client they didn't create couldn't read it.
--
-- No write policy changes — managers read, owners act.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) affairs read scoped (m076 verbatim + sales_owner-assigned clients
--    branch unchanged + NEW team-manager branch).
-- ---------------------------------------------------------------------
drop policy if exists "affairs read scoped" on affairs;
create policy "affairs read scoped" on affairs for select using (
  owner_id = auth.uid()
  or created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin', 'task_list_manager', 'operations')
            or coalesce(r.super_admin, false))
  )
  or exists (
    select 1 from documents d
     where d.affair_id = affairs.id
       and (d.created_by = auth.uid() or d.sales_owner_id = auth.uid())
  )
  or exists (
    select 1 from clients c
     where c.id = affairs.client_id
       and (c.created_by = auth.uid() or c.sales_owner_id = auth.uid())
  )
  -- NEW (m105): a manager sees the affairs of their team members.
  or exists (
    select 1 from team_members me
      join team_members peer on peer.team_id = me.team_id
     where me.user_id = auth.uid()
       and me.member_role = 'manager'
       and (peer.user_id = affairs.owner_id or peer.user_id = affairs.created_by)
  )
);

-- ---------------------------------------------------------------------
-- 2) clients read scoped (m058 verbatim + assigned-owner branch + NEW
--    team-manager branch).
-- ---------------------------------------------------------------------
drop policy if exists "clients read scoped" on clients;
create policy "clients read scoped" on clients for select using (
  created_by = auth.uid()
  -- m066 resolution rule honored at the DB layer: the ASSIGNED account
  -- manager reads their client even when someone else created it.
  or sales_owner_id = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
  or exists (
    select 1 from documents d
     where d.client_id = clients.id
       and d.created_by = auth.uid()
  )
  -- NEW (m105): a manager sees the clients of their team members.
  or exists (
    select 1 from team_members me
      join team_members peer on peer.team_id = me.team_id
     where me.user_id = auth.uid()
       and me.member_role = 'manager'
       and (peer.user_id = clients.sales_owner_id or peer.user_id = clients.created_by)
  )
);

notify pgrst, 'reload schema';

commit;
