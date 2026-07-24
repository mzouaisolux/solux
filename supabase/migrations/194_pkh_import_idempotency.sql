-- 194_pkh_import_idempotency.sql
-- =============================================================================
-- Make baseline-import writes idempotent under CONCURRENT retries.
--
-- Background: /api/hooks/import-callback commits extracted rows via
-- commitImportPlan (features/product-knowledge-hub/lib/importCore.ts), which
-- historically did check-then-insert on spec_values and spec_versions. With no
-- unique constraint, two OVERLAPPING n8n deliveries of the same file could both
-- read "absent" and both insert → duplicate rows (security review M1).
--
-- This migration makes uniqueness a DB invariant: after de-duping any rows that
-- already violate it, it adds the missing unique indexes. commitImportPlan is
-- updated in the same change to treat a unique violation (23505) as "another
-- delivery won the race" — update instead of insert — so retries can never
-- duplicate. spec_fields already had `unique (category_id, key)`, so only the
-- value + version tables need this.
--
-- Additive + idempotent (IF NOT EXISTS). No RLS change. Safe to re-run.
-- =============================================================================

begin;

-- 1. De-dupe spec_values before adding the unique indexes. A value row is
--    EITHER category-scoped (product_id null) or model-scoped (category_id
--    null) — enforced by the table CHECK — so the two scopes are de-duped
--    separately. Keep one row per group (smallest ctid); import rewrites values
--    anyway, so which duplicate survives is immaterial.
delete from spec_values a
using spec_values b
where a.product_id is null
  and b.product_id is null
  and a.field_id = b.field_id
  and a.category_id = b.category_id
  and a.ctid > b.ctid;

delete from spec_values a
using spec_values b
where a.category_id is null
  and b.category_id is null
  and a.field_id = b.field_id
  and a.product_id = b.product_id
  and a.ctid > b.ctid;

-- 2. Partial unique indexes — one per scope.
create unique index if not exists uq_spec_values_field_category
  on spec_values (field_id, category_id) where product_id is null;

create unique index if not exists uq_spec_values_field_product
  on spec_values (field_id, product_id) where category_id is null;

-- 3. De-dupe spec_versions, then enforce one row per (category_id, version).
--    Versions are immutable history; duplicates shouldn't exist, but if they do
--    keep the earliest published row so change-request links/signed docs survive.
delete from spec_versions a
using spec_versions b
where a.category_id = b.category_id
  and a.version = b.version
  and (
    a.published_at > b.published_at
    or (a.published_at = b.published_at and a.ctid > b.ctid)
  );

create unique index if not exists uq_spec_versions_category_version
  on spec_versions (category_id, version);

commit;
