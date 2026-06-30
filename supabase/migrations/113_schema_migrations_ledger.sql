-- =====================================================================
-- m113 — Schema migrations ledger + applied-migration probes (audit P0)
-- =====================================================================
--
-- Problem (business audit 2026-06-11, priority P0): migrations are
-- applied by hand in the Supabase SQL editor and NOTHING records which
-- ones actually ran in which environment. We cannot answer "is the m078
-- won-quotation delete lockdown active in prod?" without writing SQL by
-- hand. That uncertainty is the single biggest data-loss risk in the
-- app (C-1: deleting a WON quotation cascades into its task list and
-- production order if m078 is not live).
--
-- Two pieces, both READ-ONLY for the app:
--
--   1. `schema_migrations` — the LEDGER. One row per applied migration
--      file. From m113 onward EVERY migration must end with:
--
--        insert into schema_migrations (filename)
--        values ('NNN_my_migration.sql')
--        on conflict (filename) do nothing;
--
--      The app never writes this table (no insert/update/delete
--      policies). The SQL editor runs as the table owner and bypasses
--      RLS — which is exactly the only write path we want.
--
--   2. `admin_migration_probes()` — best-effort DETECTION for the
--      pre-ledger past. For each critical migration we check ONE
--      distinctive artifact (table / column / policy body / constraint
--      body) in the Postgres catalogs. A probe can't prove a migration
--      ran in full, but a red probe is a guaranteed "NOT applied".
--      Surfaced on /admin/diagnostics (admin.diagnostics capability).
--
-- Idempotent. Safe to re-run. Apply manually in Supabase.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The ledger
-- ---------------------------------------------------------------------
create table if not exists schema_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now(),
  note       text
);

alter table schema_migrations enable row level security;

-- Read-only for signed-in users (the diagnostics page is additionally
-- capability-gated). No write policies on purpose — see header.
drop policy if exists "schema_migrations read" on schema_migrations;
create policy "schema_migrations read" on schema_migrations
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 2. The probes
-- ---------------------------------------------------------------------
-- One row per critical migration. `ok = true` means the distinctive
-- artifact exists in this database. Checks read pg_catalog only —
-- security definer so the caller doesn't need catalog privileges.
-- ---------------------------------------------------------------------
drop function if exists admin_migration_probes();

create or replace function admin_migration_probes()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_agg(
           jsonb_build_object(
             'file',  v.file,
             'label', v.label,
             'kind',  v.kind,
             'ok',    v.ok
           )
           order by v.file
         )
  from (
    values
      -- ----- lifecycle & data-safety -----
      ('077_affair_status_lifecycle.sql', 'Affair lifecycle statuses', 'constraint',
        exists (select 1 from pg_constraint c
                  join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                 where n.nspname = 'public' and t.relname = 'affairs'
                   and c.conname = 'affairs_status_check'
                   and pg_get_constraintdef(c.oid) ilike '%negotiation%')),

      ('078_quotation_delete_lockdown.sql', 'WON-quotation delete lockdown (C-1 guard)', 'policy',
        exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'documents'
                   and policyname = 'documents delete scoped'
                   and coalesce(qual, '') ilike '%negotiating%')),

      ('086_category_margins_cost_versions.sql', 'Cost batches / versioned RMB costs', 'table',
        to_regclass('public.cost_batches') is not null),

      ('087_price_lists_v5_category_status.sql', 'Price lists v5 (category + status)', 'column',
        exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'price_lists'
                   and column_name = 'status')),

      ('088_factory_mapping_rls_capability.sql', 'Factory-mapping writes gated by matrix', 'policy',
        exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'factory_mappings'
                   and policyname = 'write factory mappings'
                   and coalesce(qual, '') ilike '%role_permissions%')),

      ('089_product_snapshot_for_safe_delete.sql', 'Product snapshots on document lines', 'column',
        exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'document_lines'
                   and column_name = 'product_name')),

      -- ----- project requests -----
      ('090_project_requests.sql', 'Project requests module', 'table',
        to_regclass('public.project_requests') is not null),

      ('091_project_requests_v1.sql', 'Project pricing / margin columns', 'column',
        exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'project_requests'
                   and column_name = 'product_margin_pct')),

      ('092_project_events_visibility.sql', 'Project events visibility (director/finance)', 'policy',
        exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'events'
                   and policyname = 'events read scoped'
                   and coalesce(qual, '') ilike '%project_request%')),

      ('100_link_project_requests_to_affairs.sql', 'Project → affair link', 'column',
        exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'project_requests'
                   and column_name = 'affair_id')),

      -- ----- CRM layer -----
      ('101_contacts.sql', 'Contacts (multiple per client)', 'table',
        to_regclass('public.contacts') is not null),

      ('102_affair_source.sql', 'Affair source (tender/field/existing)', 'column',
        exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'affairs'
                   and column_name = 'source')),

      ('103_planned_actions.sql', 'Planned actions (next-action engine)', 'table',
        to_regclass('public.planned_actions') is not null),

      ('104_prospects_tenders.sql', 'Prospects & tenders sandbox', 'table',
        to_regclass('public.tenders') is not null),

      ('105_team_manager_visibility.sql', 'Team-manager visibility on affairs/clients', 'policy',
        exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'affairs'
                   and policyname = 'affairs read scoped'
                   and coalesce(qual, '') ilike '%team_members%')),

      ('107_tender_management.sql', 'Tender import fields (buyer, score, …)', 'column',
        exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'tenders'
                   and column_name = 'buyer')),

      ('108_tender_workflow.sql', 'Tender workflow affair statuses', 'constraint',
        exists (select 1 from pg_constraint c
                  join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                 where n.nspname = 'public' and t.relname = 'affairs'
                   and c.conname = 'affairs_status_check'
                   and pg_get_constraintdef(c.oid) ilike '%partner_selection%')),

      ('109_tender_pipeline.sql', 'Tender → project request link', 'column',
        exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'project_requests'
                   and column_name = 'source_tender_id')),

      ('110_tender_qualification.sql', 'Tender qualification + follow-up journal', 'table',
        to_regclass('public.tender_followups') is not null),

      ('111_tender_workflow_strict.sql', 'Follow-up journal kinds (auto-advance)', 'constraint',
        exists (select 1 from pg_constraint c
                  join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                 where n.nspname = 'public' and t.relname = 'tender_followups'
                   and c.conname = 'tender_followups_kind_check'
                   and pg_get_constraintdef(c.oid) ilike '%contact_attempt%')),

      ('112_tender_pipeline.sql', 'Tender pipeline stages v2 (project_request)', 'constraint',
        exists (select 1 from pg_constraint c
                  join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                 where n.nspname = 'public' and t.relname = 'tenders'
                   and c.conname = 'tenders_commercial_status_check'
                   and pg_get_constraintdef(c.oid) ilike '%project_request%')),

      ('113_schema_migrations_ledger.sql', 'Migrations ledger (this migration)', 'table',
        to_regclass('public.schema_migrations') is not null)
  ) as v(file, label, kind, ok)
$$;

-- Default function grants include PUBLIC — tighten to signed-in users.
revoke all on function admin_migration_probes() from public;
grant execute on function admin_migration_probes() to authenticated;

-- ---------------------------------------------------------------------
-- 3. Record THIS migration in the ledger it just created
-- ---------------------------------------------------------------------
insert into schema_migrations (filename, note)
values ('113_schema_migrations_ledger.sql', 'ledger + probes installed')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK (run separately):
--   select admin_migration_probes();
--     → every entry with ok=false is a migration whose artifact is
--       MISSING in this database. m078 (delete lockdown) first.
--   select * from schema_migrations order by filename;
--
-- ROLLBACK:
--   begin;
--   drop function if exists admin_migration_probes();
--   drop table if exists schema_migrations;
--   notify pgrst, 'reload schema';
--   commit;
-- ---------------------------------------------------------------------
