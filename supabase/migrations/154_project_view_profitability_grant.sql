-- =====================================================================
-- m154 — Project Profitability widget: capability grant seed
--        (renumbered from a draft "152" — that number was already taken by
--        152_client_delete_counts_affairs.sql; never applied under 152)
-- =====================================================================
--
-- New management widget (Product % / Pole % / Overall % + breakdown drawer +
-- margin history) rendered on client hub / affair / SR / document / overview
-- surfaces. It exposes MARGINS AND COSTS, so visibility is deliberately
-- narrow: the owner's list is super_admin, sales_director and
-- task_list_manager ONLY. operations and finance can already read the cost
-- tables under RLS (m091), but the widget stays off for them — the capability
-- is the narrow gate on top of RLS (m142 pattern: the server decides; a
-- browser without the capability never receives a single cost).
--
-- Catalogued in lib/capabilities.ts as `project.view_profitability`; every
-- read path re-checks it server-side (loader + drawer server actions). admin
-- and super_admin always pass in code (anti-lockout floor, m122 pattern) —
-- flagged to the owner in the plan.
--
-- RLS: one ADDITIVE read grant. Live probe (2026-07-07, real testdir@/testlm@
-- JWTs) showed `product_costs` / `cost_rmb_history` are silently RLS-filtered
-- to 0 rows for sales_director and task_list_manager (m084 policies are
-- admin/finance-only) — so catalogue-only quotations would show "cost missing"
-- to the exact roles this widget serves. These roles ALREADY read the more
-- sensitive per-deal factory RMB cost (m091), so reading the catalogue cost
-- master introduces no new exposure class. Sales remain fully excluded.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

-- Additive read policies (SELECT only — write stays admin/finance, m084).
drop policy if exists "managers read costs" on product_costs;
create policy "managers read costs" on product_costs
  for select using (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and (r.role in ('sales_director','task_list_manager')
              or coalesce(r.super_admin, false))
    )
  );

drop policy if exists "managers read history" on cost_rmb_history;
create policy "managers read history" on cost_rmb_history
  for select using (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and (r.role in ('sales_director','task_list_manager')
              or coalesce(r.super_admin, false))
    )
  );

insert into permissions (key, category, label, description, sort_order) values
  ('project.view_profitability', 'Projects', 'View project profitability (margins)',
   'Management widget: Product / Pole / Overall margin %, financial breakdown drawer and margin history on every project. Exposes margins and costs — managers only.', 77)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  -- floor in code, marked here for the matrix + clarity
  ('super_admin',       'project.view_profitability', true),
  ('admin',             'project.view_profitability', true),
  -- the management roles the owner listed
  ('sales_director',    'project.view_profitability', true),
  ('task_list_manager', 'project.view_profitability', true),
  -- explicit OFF (deliberate decisions, visible in the matrix)
  ('sales',             'project.view_profitability', false),
  ('operations',        'project.view_profitability', false),
  ('finance',           'project.view_profitability', false)
on conflict (role, permission_key) do nothing;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('154_project_view_profitability_grant.sql',
        'Project Profitability widget: project.view_profitability capability grant (sales_director + task_list_manager; sales/operations/finance explicitly off) + additive SELECT policies on product_costs / cost_rmb_history for the same manager roles (they already read factory RMB costs, m091).')
on conflict (filename) do nothing;

commit;
