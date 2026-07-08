-- =====================================================================
-- m155 — Manual production orders (Excel-transition entry, Quick Update)
-- =====================================================================
--
-- WHY (owner request 2026-07-08):
--   The team is migrating off an Excel order book over several months.
--   During the transition, Operations must be able to register their
--   in-flight orders BY HAND, directly in the Quick Update table, without
--   the quotation → won → task-list workflow — "not necessarily linked
--   anywhere, but lets us start using the app immediately".
--
-- DESIGN — manual orders ARE production_orders (NOT an island):
--   The whole point is that they live in the SAME Quick Update table with
--   the SAME inline editing, statuses, payments, shipping and documents.
--   So instead of a parallel table (m137-style island), we relax the two
--   workflow-only NOT NULLs and add a few `manual_*` fallback columns the
--   pages read when there is no linked quotation.
--
--   The core workflow is NOT weakened: `launchProduction` still requires a
--   WON quotation with a mandatory Affaire; `source` marks the provenance
--   ('workflow' rows keep behaving exactly as before) and the new
--   capability gates who may create manual rows.
--
-- Idempotent. Self-registers in schema_migrations (m113 convention).
-- Apply manually in Supabase SQL editor (DDL) after backup, per project
-- convention. The UI ships DORMANT: the "+ Add order" button only appears
-- once the capability seed below exists (hasCapability is fail-closed).
-- =====================================================================

begin;

-- 1. Relax workflow-only constraints. ---------------------------------------
--    UNIQUE(task_list_id) keeps holding for real task lists (Postgres unique
--    indexes ignore NULLs), so workflow orders cannot duplicate.
alter table production_orders alter column task_list_id drop not null;
alter table production_orders alter column quotation_id drop not null;

-- 2. Provenance + manual fallback fields. -----------------------------------
--    For workflow rows every manual_* stays NULL and the pages keep reading
--    the linked quotation. For manual rows the pages fall back to these.
--    manual_deposit_percent feeds the SAME computeExpectedDeposit() helper
--    (payment mode 'deposit_balance'), so payment states/dots are identical.
alter table production_orders
  add column if not exists source text not null default 'workflow'
    check (source in ('workflow','manual')),
  add column if not exists manual_client_name text,
  add column if not exists manual_sales_label text,
  add column if not exists manual_total_price numeric,
  add column if not exists manual_currency text,
  add column if not exists manual_deposit_percent numeric
    check (manual_deposit_percent is null
           or (manual_deposit_percent >= 0 and manual_deposit_percent <= 100));

create index if not exists idx_production_orders_source
  on production_orders (source);

-- 3. RLS — manual rows have no linked document, so the existing
--    document-based "po select" (m046) can never expose them. Additive
--    permissive policy: creator + technical bucket (finance already reads
--    ALL production_orders via m119). Writes need no change — "po write"
--    (m046) already covers admin/tlm/operations/super for insert+update.
drop policy if exists "po select manual" on production_orders;
create policy "po select manual" on production_orders for select using (
  quotation_id is null and (
    created_by = auth.uid()
    or exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and (
           r.role in ('admin', 'task_list_manager', 'operations')
           or coalesce(r.super_admin, false)
         )
    )
  )
);

-- Delay history of a manual order (same transitive rule as "pdc select").
drop policy if exists "pdc select manual" on production_deadline_changes;
create policy "pdc select manual" on production_deadline_changes for select using (
  exists (
    select 1 from production_orders po
     where po.id = production_order_id
       and po.quotation_id is null
       and (
         po.created_by = auth.uid()
         or exists (
           select 1 from user_roles r
            where r.user_id = auth.uid()
              and (
                r.role in ('admin', 'task_list_manager', 'operations')
                or coalesce(r.super_admin, false)
              )
         )
       )
  )
);

-- 4. Capability seed — who may CREATE manual orders. -------------------------
--    Operations own the transition entry; TLM + admins can help. Sales and
--    finance are explicitly off (visible decision in the matrix).
insert into permissions (key, category, label, description, sort_order) values
  ('production_order.create_manual', 'Production Orders', 'Create a manual order',
   'Register a production order by hand (Excel-transition entry in Quick Update) without a quotation/task list. Workflow orders keep coming exclusively from Launch Production.', 45)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  ('super_admin',       'production_order.create_manual', true),
  ('admin',             'production_order.create_manual', true),
  ('operations',        'production_order.create_manual', true),
  ('task_list_manager', 'production_order.create_manual', true),
  ('sales',             'production_order.create_manual', false),
  ('sales_director',    'production_order.create_manual', false),
  ('finance',           'production_order.create_manual', false)
on conflict (role, permission_key) do nothing;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('155_manual_production_orders.sql',
        'Manual production orders (Excel transition): quotation_id/task_list_id nullable, source + manual_* fallback columns, additive RLS for doc-less rows, production_order.create_manual capability seed (ops/tlm/admin).')
on conflict (filename) do nothing;

commit;
