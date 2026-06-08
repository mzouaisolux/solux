-- =====================================================================
-- Standalone dev reset — manual SQL fallback.
-- =====================================================================
--
-- Use this if you want to wipe business data WITHOUT going through the
-- UI (no auth context required — runs as the SQL editor user, which is
-- the Supabase postgres role).
--
-- The in-app equivalent is /admin/diagnostics/reset, which calls
-- admin_reset_execute() from migration 035 and is gated to super-admins.
--
-- What gets DELETED
--   - clients
--   - documents (cascades to lines, containers, task_lists, PTL lines,
--     production_orders, deadline_changes)
--   - events
--
-- What stays UNTOUCHED
--   - auth.users / user_roles
--   - permissions / role_permissions
--   - products / options / prices_version / product_costs
--   - product_families / config_fields / config_field_options
--   - factory_mappings / component_mappings
--   - sales_conditions / bank_accounts
--   - capabilities matrix (whole permissions system)
--
-- Numbering counters auto-reset (next_document_number / next_task_list_number
-- both use max(...), so they restart at 1 once tables are empty).
--
-- Wrapped in a transaction — any FK or constraint error rolls back
-- every delete. Print counts before + after for visibility.
-- =====================================================================

begin;

-- ---------- BEFORE: snapshot ----------
\echo
\echo '=== Rows before reset ==='
select 'clients'                     as table_name, count(*) from clients
union all select 'documents',                count(*) from documents
union all select 'document_lines',           count(*) from document_lines
union all select 'document_containers',      count(*) from document_containers
union all select 'production_task_lists',    count(*) from production_task_lists
union all select 'production_task_list_lines', count(*) from production_task_list_lines
union all select 'production_orders',        count(*) from production_orders
union all select 'production_deadline_changes', count(*) from production_deadline_changes
union all select 'events',                   count(*) from events;

-- ---------- DELETE in FK-safe order ----------
-- `WHERE true` satisfies Supabase's "DELETE requires a WHERE clause"
-- safeguard. Same effective behavior — every row matches.

-- Events: polymorphic table, no FK. Wipe first so no audit row
-- survives the reset (we re-emit one fresh below).
delete from events where true;

-- Documents: CASCADE deletes lines, containers, task_lists, PTL lines,
-- production_orders, deadline_changes — six tables in one statement.
delete from documents where true;

-- Clients: now safe to delete (every doc/PTL/PO is gone).
delete from clients where true;

-- Single audit row marking the reset, so the timeline isn't empty.
insert into events (entity_type, entity_id, event_type, severity, message, payload, actor_id)
values (
  'system',
  gen_random_uuid(),
  'system.dev_reset',
  'critical',
  'Development data reset — manual SQL wipe.',
  '{}'::jsonb,
  null
);

-- ---------- AFTER: confirm ----------
\echo
\echo '=== Rows after reset ==='
select 'clients'                     as table_name, count(*) from clients
union all select 'documents',                count(*) from documents
union all select 'document_lines',           count(*) from document_lines
union all select 'document_containers',      count(*) from document_containers
union all select 'production_task_lists',    count(*) from production_task_lists
union all select 'production_task_list_lines', count(*) from production_task_list_lines
union all select 'production_orders',        count(*) from production_orders
union all select 'production_deadline_changes', count(*) from production_deadline_changes
union all select 'events',                   count(*) from events;

\echo
\echo '=== Preserved tables (should be UNCHANGED) ==='
select 'user_roles'        as table_name, count(*) from user_roles
union all select 'permissions',          count(*) from permissions
union all select 'role_permissions',     count(*) from role_permissions
union all select 'products',             count(*) from products
union all select 'options',              count(*) from options
union all select 'prices_version',       count(*) from prices_version
union all select 'product_categories',   count(*) from product_categories
union all select 'config_fields',        count(*) from config_fields
union all select 'config_field_options', count(*) from config_field_options
union all select 'factory_mappings',     count(*) from factory_mappings
union all select 'component_mappings',   count(*) from component_mappings
union all select 'sales_conditions',     count(*) from sales_conditions
union all select 'bank_accounts',        count(*) from bank_accounts;

commit;
