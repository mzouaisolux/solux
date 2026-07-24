/**
 * Product Knowledge Hub — row + composite types.
 *
 * These mirror the tables created in supabase/migrations/160_product_knowledge_hub.sql.
 * ENTITY MAPPING: a FAMILY = a `product_categories` row, a MODEL = a `products`
 * row. Common spec values attach to a category; model spec values attach to a
 * product.
 */

export type SpecScope = "common" | "model";
export type SpecValueKind = "number" | "text" | "enum" | "dimension";

export type SpecChangeRequestStatus =
  | "draft"
  | "submitted"
  | "waiting_approval"
  | "approved"
  | "published"
  | "rejected";

export type SpecDocumentKind = "auto" | "figma_override";
export type SpecDocumentStatus = "pending" | "ready" | "stale" | "failed";
export type SignedDocKind = "pdf" | "excel";

/* ---------------------------------------------------------------------------
   Rows
   --------------------------------------------------------------------------- */

export type SpecField = {
  id: string;
  category_id: string;
  scope: SpecScope | null;
  key: string;
  label: string;
  value_kind: SpecValueKind | null;
  unit: string | null;
  sort: number | null;
};

export type SpecValue = {
  id: string;
  field_id: string | null;
  category_id: string | null;
  product_id: string | null;
  value_number: number | null;
  value_text: string | null;
  unit: string | null;
  updated_at: string | null;
};

export type SpecChangeRequest = {
  id: string;
  category_id: string | null;
  status: SpecChangeRequestStatus;
  reason: string | null;
  diff: SpecDiffEntry[];
  evidence_path: string | null;
  evidence_name: string | null;
  signed_doc_path: string | null;
  signed_doc_name: string | null;
  signed_doc_kind: SignedDocKind | null;
  signer_name: string | null;
  signed_at: string | null;
  version_from: string | null;
  version_to: string | null;
  created_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string | null;
};

export type SpecVersion = {
  id: string;
  category_id: string | null;
  version: string;
  change_request_id: string | null;
  author: string | null;
  reason: string | null;
  changes_json: SpecDiffEntry[];
  signed_doc_path: string | null;
  published_at: string | null;
};

export type SpecDocument = {
  id: string;
  product_id: string;
  spec_version: string;
  kind: SpecDocumentKind | null;
  template_version: string | null;
  storage_path: string | null;
  storage_name: string | null;
  status: SpecDocumentStatus;
  is_current: boolean;
  rendered_at: string | null;
  created_by: string | null;
  created_at: string | null;
};

/* ---------------------------------------------------------------------------
   Diff — one entry per changed spec value. `scope` decides the blast radius:
   a common-field change touches every product in the family; a model-field
   change touches only its product.
   --------------------------------------------------------------------------- */

export type SpecDiffEntry = {
  field_id: string;
  key: string;
  label: string;
  scope: SpecScope;
  /** null for a common change; the target product for a model change. */
  product_id: string | null;
  value_kind: SpecValueKind | null;
  unit: string | null;
  from: { value_number: number | null; value_text: string | null } | null;
  to: { value_number: number | null; value_text: string | null };
};

/* ---------------------------------------------------------------------------
   Composite read shapes
   --------------------------------------------------------------------------- */

/** A resolved spec row (field + its value) for rendering a datasheet line. */
export type ResolvedSpec = {
  field: SpecField;
  value: SpecValue | null;
};

/** One model (product) inside a family, with its model-scoped values. */
export type ModelDatasheet = {
  id: string;
  name: string;
  sku: string | null;
  image_url: string | null;
  active: boolean | null;
  is_legacy: boolean | null;
  /** Model-scoped resolved specs (field.scope === 'model'). */
  modelSpecs: ResolvedSpec[];
};

/** Everything a family page needs in one object. */
export type FamilyDatasheet = {
  category: {
    id: string;
    name: string;
    position: number | null;
    is_template: boolean | null;
  };
  fields: SpecField[];
  /** Common-scoped resolved specs (attach to the category). */
  commonSpecs: ResolvedSpec[];
  models: ModelDatasheet[];
  versions: SpecVersion[];
  currentVersion: string | null;
  pending: boolean;
};

/** A lightweight model reference for the home directory (chip → model page). */
export type FamilyModelRef = {
  id: string;
  name: string;
  sku: string | null;
};

/** Home-page summary row — one per family. */
export type FamilySummary = {
  id: string;
  name: string;
  position: number | null;
  modelCount: number;
  /** Models in this family (sorted by name) — powers the inline expand. */
  models: FamilyModelRef[];
  currentVersion: string | null;
  lastUpdated: string | null;
  pending: boolean;
  /** Catalog hierarchy above the family (m162); null when unclassified. */
  line: string | null;
  range: string | null;
  linePosition: number | null;
  rangePosition: number | null;
};

/* ---------------------------------------------------------------------------
   Baseline import (spec.import) — CSV row + dry-run/commit result shapes.

   A CSV row is the raw, string-only payload parsed client-side and sent to the
   `dryRunImport` / `importBaseline` server actions. `model` blank ⇒ common;
   `scope` ∈ common|model; `value_kind` ∈ number|text|enum|dimension.
   --------------------------------------------------------------------------- */

/** One raw CSV line (all strings — typing/coercion happens on the server). */
export type ImportRow = {
  family: string;
  model: string;
  field_key: string;
  label: string;
  value_kind: string;
  unit: string;
  value: string;
  scope: string;
  sort: string;
};

/** Dry-run preview — what WOULD happen, with nothing written. */
export type ImportDryRun = {
  familiesMatched: string[];
  familiesUnmatched: string[];
  productsMatched: number;
  productsUnmatched: { family: string; model: string }[];
  fieldCount: number;
  valueCount: number;
  warnings: string[];
};

/** Commit summary — what WAS written. */
export type ImportCommitResult = {
  families: number;
  fields: number;
  values: number;
  skipped: string[];
};

/** A product option for the (optional) PDF-attach section of the importer. */
export type ImportProduct = {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string;
  familyName: string;
  currentVersion: string;
};
