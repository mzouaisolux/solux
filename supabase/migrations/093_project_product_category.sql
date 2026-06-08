-- =====================================================================
-- m093 — Project Requests: product category (family) selection.
--
-- Sales needs to tag a Project Request with the product family it targets
-- (AOSPRO+, SSLXPRO, …) at creation. Additive: a nullable FK to
-- product_categories (the same catalog the pricing module uses). Existing
-- rows stay null; nothing breaks. ON DELETE SET NULL so deleting a category
-- never orphans a project.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

alter table project_requests
  add column if not exists product_category_id uuid
    references product_categories(id) on delete set null;

create index if not exists idx_project_requests_category
  on project_requests(product_category_id);

notify pgrst, 'reload schema';

commit;
