-- =====================================================================
-- m119 — Finance read access + the Finance view capability (Phase 1 end)
-- =====================================================================
--
-- Owner decision (2026-06-13): the FINANCE role gets READ-ONLY access
-- to production orders so the Finance view (outstanding balances per
-- client, overdue payments, LC expiries) actually shows data. This was
-- the last open item of audit Phase 1 (cash).
--
--   1. Additive SELECT policies for role 'finance' on the three tables
--      the money view reads: production_orders (receipts, due dates,
--      LC), documents (totals + payment terms of the linked quotation),
--      clients (company names). Permissive policies OR together — no
--      existing access changes. NO write policies: finance stays
--      read-only everywhere (the order page hides every form for
--      non-technical roles already).
--
--   2. Capability `finance.view` — gates the menu entry + /finance page
--      (capability → menu → page chain). Seeded: finance, direction
--      (sales_director), admin, super_admin.
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Read-only RLS for finance
-- ---------------------------------------------------------------------
drop policy if exists "production_orders read finance" on production_orders;
create policy "production_orders read finance" on production_orders for select using (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid() and r.role = 'finance'
  )
);

drop policy if exists "documents read finance" on documents;
create policy "documents read finance" on documents for select using (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid() and r.role = 'finance'
  )
);

drop policy if exists "clients read finance" on clients;
create policy "clients read finance" on clients for select using (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid() and r.role = 'finance'
  )
);

-- ---------------------------------------------------------------------
-- 2. finance.view capability
-- ---------------------------------------------------------------------
insert into permissions (key, category, label, description, sort_order) values
  ('finance.view', 'Finance', 'Finance view (balances & LC)',
   'Access the read-only Finance view: outstanding deposits/balances per client, overdue payments, LC expiries.', 90)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  ('super_admin', 'finance.view', true),
  ('admin', 'finance.view', true),
  ('finance', 'finance.view', true),
  ('sales_director', 'finance.view', true),
  ('sales', 'finance.view', false),
  ('task_list_manager', 'finance.view', false),
  ('operations', 'finance.view', false)
on conflict (role, permission_key) do nothing;

insert into schema_migrations (filename, note)
values ('119_finance_read_access.sql', 'finance read-only RLS + finance.view capability — audit Phase 1 complete')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK (run separately, as a finance user):
--   select count(*) from production_orders;   -- > 0 (was 0 before)
--   -- and any UPDATE must still fail (no write policy added).
--
-- ROLLBACK:
--   begin;
--   drop policy if exists "production_orders read finance" on production_orders;
--   drop policy if exists "documents read finance" on documents;
--   drop policy if exists "clients read finance" on clients;
--   delete from role_permissions where permission_key = 'finance.view';
--   delete from permissions where key = 'finance.view';
--   delete from schema_migrations where filename = '119_finance_read_access.sql';
--   notify pgrst, 'reload schema';
--   commit;
-- ---------------------------------------------------------------------
