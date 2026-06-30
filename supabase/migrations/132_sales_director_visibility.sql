-- =====================================================================
-- 132 — F1 fix: sales_director org-wide read visibility.
-- =====================================================================
-- Audit finding F1 (2026-06-23): a `sales_director` with no access_grant and
-- no team membership saw ZERO rows on clients / affairs / documents /
-- production_task_lists / production_orders / contacts. Root cause: the
-- visibility RLS grants "see all" only to admin / task_list_manager /
-- operations (m058) plus a half-implemented team-manager branch added in
-- m105 (clients + affairs ONLY). `sales_director` is in none of those paths,
-- yet the app already treats it as a commercial SUPERVISOR (canSupervise:
-- validation-review + owner-reassign on ANY client/affair/doc). Org-wide
-- READ visibility is the consistent counterpart.
--
-- Fix: additive PERMISSIVE read policies. PostgreSQL OR's PERMISSIVE policies,
-- so these only GRANT more — they never restrict what other roles can read.
-- Pairs with the app-layer fallback in lib/visibility.ts (getVisibilityScope).
--
-- Alternative considered (NOT taken): scope the director to their team via the
-- m105 team-manager branch. Rejected for now because (a) that branch only
-- covers clients + affairs, so it would need extending to 4 more tables anyway,
-- and (b) canSupervise already grants the director org-wide ACTIONS, so org-wide
-- visibility is the simpler, consistent model. If team-scoping is preferred,
-- replace these policies with team-manager branches on all six tables instead.
--
-- Idempotent. Self-registers in schema_migrations (m113 convention).
-- Apply manually in Supabase (DDL) after backup, per project convention.
-- =====================================================================

begin;

do $$
declare t text;
begin
  foreach t in array array[
    'clients', 'affairs', 'documents',
    'production_task_lists', 'production_orders', 'contacts'
  ] loop
    execute format('drop policy if exists %I on %I', t || ' read sales_director', t);
    execute format($f$
      create policy %I on %I for select to authenticated
        using (
          exists (
            select 1 from user_roles r
             where r.user_id = auth.uid()
               and r.role = 'sales_director'
          )
        )
    $f$, t || ' read sales_director', t);
  end loop;
end $$;

insert into schema_migrations (filename, note)
values ('132_sales_director_visibility.sql',
        'F1: additive sales_director org-wide read RLS on clients/affairs/documents/production_task_lists/production_orders/contacts (pairs with lib/visibility.ts fallback)')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- =====================================================================
-- Verification (run after apply):
--   -- As testdir@ (sales_director) the next query should return > 0:
--   --   select count(*) from clients;
--   -- The six policies should exist:
--   select tablename, policyname from pg_policies
--    where policyname like '% read sales_director';
-- =====================================================================
