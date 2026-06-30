-- =====================================================================
-- m126 — Performance indexes (scalability audit 2026-06-17).
-- =====================================================================
--
-- PURE PERFORMANCE — no schema/behavior change, no data change. Adds the
-- indexes the static scalability audit found MISSING on columns the app
-- already filters/sorts/joins on. Safe and idempotent (`if not exists`).
--
-- Why each one (file:line refs from the audit):
--   document_lines.document_id      — quote detail + revise-source + won-doc
--                                     line math (only product_id was indexed)
--   document_containers.document_id — quote detail freight rows
--   prices_version (NO index today) — documents/new prices lookup (the
--                                     fastest-growing table); both access
--                                     paths: by price_list and by product/tier
--   product_costs.product_id        — admin margin lookups
--   options.product_id              — quote builder option join
--   documents.created_by            — sales-scoping on /business & /forecast
--                                     (only sales_owner_id was indexed)
--   tenders.attached_client_id      — Client Hub "active tenders"
--   tenders.commercial_status       — pipeline grouping / inbox split
--   tenders.owner_id / created_by   — tenders RLS row-scoping (m108)
--   clients.company_name            — the Clients list ORDER BY / range
--   project_requests.created_at     — the Projects list ORDER BY
--
-- NOTE — large-table safety: at the current (pre-scale) data volume these
-- build instantly inside the transaction below. If you ever re-apply on a
-- DB that has already grown large, build them one at a time OUTSIDE a
-- transaction with `CREATE INDEX CONCURRENTLY IF NOT EXISTS ...` instead
-- (concurrent index builds cannot run inside begin/commit).
--
-- Apply MANUALLY in Supabase. Idempotent.
-- =====================================================================

begin;

create index if not exists idx_document_lines_document
  on document_lines (document_id);

create index if not exists idx_document_containers_document
  on document_containers (document_id, position);

create index if not exists idx_prices_version_list
  on prices_version (price_list_id, valid_from desc);

create index if not exists idx_prices_version_product
  on prices_version (product_id, pricing_tier, valid_from desc);

create index if not exists idx_product_costs_product
  on product_costs (product_id);

create index if not exists idx_options_product
  on options (product_id);

create index if not exists idx_documents_created_by
  on documents (created_by);

create index if not exists idx_tenders_attached_client
  on tenders (attached_client_id);

create index if not exists idx_tenders_commercial_status
  on tenders (commercial_status);

create index if not exists idx_tenders_owner
  on tenders (owner_id);

create index if not exists idx_tenders_created_by
  on tenders (created_by);

create index if not exists idx_clients_company_name
  on clients (company_name);

create index if not exists idx_project_requests_created_at
  on project_requests (created_at desc);

insert into schema_migrations (filename, note)
values ('126_perf_indexes.sql',
        'scalability audit: 13 missing indexes (document_lines/containers, prices_version, product_costs, options, documents.created_by, tenders.*, clients.company_name, project_requests.created_at)')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK (run after): every target index should appear.
--   select indexname, tablename from pg_indexes
--    where indexname like 'idx_%'
--      and tablename in ('document_lines','document_containers','prices_version',
--                        'product_costs','options','documents','tenders',
--                        'clients','project_requests')
--    order by tablename, indexname;
--   select * from schema_migrations where filename = '126_perf_indexes.sql';
--
-- ROLLBACK (if ever needed):
--   begin;
--   drop index if exists idx_document_lines_document, idx_document_containers_document,
--     idx_prices_version_list, idx_prices_version_product, idx_product_costs_product,
--     idx_options_product, idx_documents_created_by, idx_tenders_attached_client,
--     idx_tenders_commercial_status, idx_tenders_owner, idx_tenders_created_by,
--     idx_clients_company_name, idx_project_requests_created_at;
--   commit;
-- ---------------------------------------------------------------------
