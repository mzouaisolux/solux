-- =====================================================================
-- m134 — "Original Sales Request" reminder: carry the free-text client need
--        from the Service Request through the quotation to the task list,
--        as a READ-ONLY reminder (never auto-converted into config).
-- =====================================================================
--
-- WHY (workflow vision 2026-06-24): the Service Request captures the client's
-- need in free text (category + "Projet autoroute / ~60W / batterie renforcée /
-- bras 2m / demande spécifique"). The sales team then picks the exact model and
-- builds the COMMERCIAL configuration on the quotation (a human step — no text
-- parsing). The original free-text need must stay VISIBLE, read-only, at every
-- stage (quotation builder + task list) so the client's intent is never lost
-- and the operator/factory can sanity-check the config against it.
--
-- Scope: the reminder is the whole-request need (one per document / task list),
-- not per line — so it lives on the parent rows, not on *_lines.
--   1. documents.original_sales_request (quotation + proforma carry it)
--   2. production_task_lists.original_sales_request (inherited at creation)
--
-- Propagation is app-side (generateQuotationFromProject → launchProduction copy
-- → createSalesOrderFromQuotation), mirroring the m133 category_id chain.
--
-- Idempotent. Self-registers in schema_migrations (m113 convention).
-- Apply manually in Supabase (DDL) after backup, per project convention.
-- =====================================================================

begin;

alter table documents
  add column if not exists original_sales_request text;

alter table production_task_lists
  add column if not exists original_sales_request text;

insert into schema_migrations (filename, note)
values ('134_original_sales_request.sql',
        'Read-only "Original Sales Request" reminder: original_sales_request text on documents + production_task_lists; free-text client need carried SR→quotation→proforma→task list (propagated app-side, never auto-converted into config).')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Verification (after apply):
--   select column_name from information_schema.columns
--    where table_name in ('documents','production_task_lists')
--      and column_name = 'original_sales_request';   -- expect 2 rows
-- ---------------------------------------------------------------------
