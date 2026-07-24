/**
 * Product Knowledge Hub — server read functions.
 *
 * All reads use the default server supabase client (benefits from Next's Data
 * Cache; the hub routes opt into freshness via `export const dynamic =
 * "force-dynamic"`). These functions never mutate — every write lives in
 * ../actions.ts.
 */

import { createClient } from "@/lib/supabase/server";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { modelsFromDiff } from "./diff";
import type {
  FamilyDatasheet,
  FamilySummary,
  ImportProduct,
  ModelDatasheet,
  ResolvedSpec,
  SpecChangeRequest,
  SpecDiffEntry,
  SpecDocument,
  SpecField,
  SpecValue,
  SpecVersion,
} from "./types";

const PENDING_STATUSES = ["draft", "submitted", "waiting_approval", "approved"];

/** Resolve field + value pairs for a given scope, sorted by field.sort. */
function resolve(
  fields: SpecField[],
  values: SpecValue[],
  scope: "common" | "model"
): ResolvedSpec[] {
  const byField = new Map<string, SpecValue>();
  for (const v of values) if (v.field_id) byField.set(v.field_id, v);
  return fields
    .filter((f) => f.scope === scope)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((field) => ({ field, value: byField.get(field.id) ?? null }));
}

/**
 * Home list — one row per family: model count, current published version,
 * last-updated timestamp and whether a change request is in flight.
 */
export async function listFamilies(): Promise<FamilySummary[]> {
  const supabase = createClient();

  const { data: cats } = await supabase
    .from("product_categories")
    .select("id, name, position, range_id")
    .order("position", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  const categories = (cats ?? []) as {
    id: string;
    name: string;
    position: number | null;
    range_id: string | null;
  }[];
  if (categories.length === 0) return [];

  const catIds = categories.map((c) => c.id);

  // Catalog hierarchy (m162). Tolerant: if the tables don't exist yet the
  // queries error, data is null, and every family reads as unclassified.
  const { data: rangeRows } = await supabase
    .from("product_ranges")
    .select("id, name, position, line_id");
  const { data: lineRows } = await supabase.from("product_lines").select("id, name, position");
  const lineById = new Map(
    ((lineRows ?? []) as { id: string; name: string; position: number | null }[]).map((l) => [l.id, l])
  );
  const rangeById = new Map(
    ((rangeRows ?? []) as { id: string; name: string; position: number | null; line_id: string | null }[]).map(
      (r) => [r.id, r]
    )
  );

  // Models per category — name + sku so the home directory can list them
  // inline (each links straight to its model page). Ordered by name so chips
  // render deterministically.
  const { data: prods } = await supabase
    .from("products")
    .select("id, category_id, name, sku")
    .in("category_id", catIds)
    .order("name", { ascending: true });
  const modelsByCat = new Map<string, { id: string; name: string; sku: string | null }[]>();
  for (const p of (prods ?? []) as {
    id: string;
    category_id: string | null;
    name: string;
    sku: string | null;
  }[]) {
    if (!p.category_id) continue;
    const list = modelsByCat.get(p.category_id) ?? [];
    list.push({ id: p.id, name: p.name, sku: p.sku });
    modelsByCat.set(p.category_id, list);
  }

  // Latest version + last-updated per category (versions come newest-first).
  const { data: versions } = await supabase
    .from("spec_versions")
    .select("category_id, version, published_at")
    .in("category_id", catIds)
    .order("published_at", { ascending: false });
  const currentVersion = new Map<string, string>();
  const lastUpdated = new Map<string, string>();
  for (const v of (versions ?? []) as { category_id: string; version: string; published_at: string | null }[]) {
    if (!currentVersion.has(v.category_id)) {
      currentVersion.set(v.category_id, v.version);
      if (v.published_at) lastUpdated.set(v.category_id, v.published_at);
    }
  }

  // Pending change requests per category.
  const { data: pendingRows } = await supabase
    .from("spec_change_requests")
    .select("category_id, status")
    .in("category_id", catIds)
    .in("status", PENDING_STATUSES);
  const pending = new Set<string>();
  for (const r of (pendingRows ?? []) as { category_id: string | null }[]) {
    if (r.category_id) pending.add(r.category_id);
  }

  return categories.map((c) => {
    const range = c.range_id ? rangeById.get(c.range_id) : undefined;
    const line = range?.line_id ? lineById.get(range.line_id) : undefined;
    const models = modelsByCat.get(c.id) ?? [];
    return {
      id: c.id,
      name: c.name,
      position: c.position,
      modelCount: models.length,
      models,
      currentVersion: currentVersion.get(c.id) ?? null,
      lastUpdated: lastUpdated.get(c.id) ?? null,
      pending: pending.has(c.id),
      line: line?.name ?? null,
      range: range?.name ?? null,
      linePosition: line?.position ?? null,
      rangePosition: range?.position ?? null,
    };
  });
}

/** Full family datasheet: fields, common specs, every model + its specs, versions. */
export async function getFamily(categoryId: string): Promise<FamilyDatasheet | null> {
  const supabase = createClient();

  const { data: cat } = await supabase
    .from("product_categories")
    .select("id, name, position, is_template")
    .eq("id", categoryId)
    .maybeSingle();
  if (!cat) return null;

  const [fieldsRes, valuesRes, productsRes, versionsRes, pendingRes] = await Promise.all([
    supabase.from("spec_fields").select("*").eq("category_id", categoryId).order("sort", { ascending: true }),
    supabase.from("spec_values").select("*").eq("category_id", categoryId),
    supabase
      .from("products")
      .select("id, name, sku, image_url, active, is_legacy")
      .eq("category_id", categoryId)
      .order("name", { ascending: true }),
    supabase
      .from("spec_versions")
      .select("*")
      .eq("category_id", categoryId)
      .order("published_at", { ascending: false }),
    supabase
      .from("spec_change_requests")
      .select("id")
      .eq("category_id", categoryId)
      .in("status", PENDING_STATUSES)
      .limit(1),
  ]);

  const fields = (fieldsRes.data ?? []) as SpecField[];
  const commonValues = (valuesRes.data ?? []) as SpecValue[];
  const products = (productsRes.data ?? []) as {
    id: string;
    name: string;
    sku: string | null;
    image_url: string | null;
    active: boolean | null;
    is_legacy: boolean | null;
  }[];
  const versions = (versionsRes.data ?? []) as SpecVersion[];

  // Model values for all products in one query.
  const productIds = products.map((p) => p.id);
  let modelValues: SpecValue[] = [];
  if (productIds.length > 0) {
    const { data } = await supabase.from("spec_values").select("*").in("product_id", productIds);
    modelValues = (data ?? []) as SpecValue[];
  }
  const modelValuesByProduct = new Map<string, SpecValue[]>();
  for (const v of modelValues) {
    if (!v.product_id) continue;
    const list = modelValuesByProduct.get(v.product_id) ?? [];
    list.push(v);
    modelValuesByProduct.set(v.product_id, list);
  }

  const models: ModelDatasheet[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    image_url: p.image_url,
    active: p.active,
    is_legacy: p.is_legacy,
    modelSpecs: resolve(fields, modelValuesByProduct.get(p.id) ?? [], "model"),
  }));

  return {
    category: {
      id: cat.id,
      name: cat.name,
      position: cat.position ?? null,
      is_template: cat.is_template ?? null,
    },
    fields,
    commonSpecs: resolve(fields, commonValues, "common"),
    models,
    versions,
    currentVersion: versions[0]?.version ?? null,
    pending: (pendingRes.data ?? []).length > 0,
  };
}

/**
 * One model datasheet — the product, its family common specs (resolved) and
 * its model-scoped specs, plus the family version history.
 */
export async function getModel(productId: string): Promise<
  | {
      product: {
        id: string;
        name: string;
        sku: string | null;
        image_url: string | null;
        active: boolean | null;
        is_legacy: boolean | null;
        category_id: string | null;
      };
      categoryName: string | null;
      commonSpecs: ResolvedSpec[];
      modelSpecs: ResolvedSpec[];
      versions: SpecVersion[];
      currentVersion: string | null;
    }
  | null
> {
  const supabase = createClient();

  const { data: product } = await supabase
    .from("products")
    .select("id, name, sku, image_url, active, is_legacy, category_id")
    .eq("id", productId)
    .maybeSingle();
  if (!product || !product.category_id) return null;

  const categoryId = product.category_id as string;

  const [catRes, fieldsRes, commonValsRes, modelValsRes, versionsRes] = await Promise.all([
    supabase.from("product_categories").select("name").eq("id", categoryId).maybeSingle(),
    supabase.from("spec_fields").select("*").eq("category_id", categoryId).order("sort", { ascending: true }),
    supabase.from("spec_values").select("*").eq("category_id", categoryId),
    supabase.from("spec_values").select("*").eq("product_id", productId),
    supabase
      .from("spec_versions")
      .select("*")
      .eq("category_id", categoryId)
      .order("published_at", { ascending: false }),
  ]);

  const fields = (fieldsRes.data ?? []) as SpecField[];
  const versions = (versionsRes.data ?? []) as SpecVersion[];

  return {
    product: product as any,
    categoryName: (catRes.data as { name: string } | null)?.name ?? null,
    commonSpecs: resolve(fields, (commonValsRes.data ?? []) as SpecValue[], "common"),
    modelSpecs: resolve(fields, (modelValsRes.data ?? []) as SpecValue[], "model"),
    versions,
    currentVersion: versions[0]?.version ?? null,
  };
}

/** Version history for a family, newest first. */
export async function getVersions(categoryId: string): Promise<SpecVersion[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("spec_versions")
    .select("*")
    .eq("category_id", categoryId)
    .order("published_at", { ascending: false });
  return (data ?? []) as SpecVersion[];
}

/**
 * The spec_document row for a (product, version). Prefers a figma_override if
 * one exists (it supersedes the auto sheet), else the auto sheet.
 */
export async function getSpecDocument(
  productId: string,
  version: string
): Promise<SpecDocument | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("spec_documents")
    .select("*")
    .eq("product_id", productId)
    .eq("spec_version", version);
  const rows = (data ?? []) as SpecDocument[];
  if (rows.length === 0) return null;
  return rows.find((r) => r.kind === "figma_override") ?? rows.find((r) => r.kind === "auto") ?? rows[0];
}

/**
 * Every product with its family name + the family's current published version
 * (falls back to "v1.0"). Feeds the optional PDF-attach dropdown on the baseline
 * import screen. Read-only; sorted by family then model name.
 */
export async function listProductsForImport(): Promise<ImportProduct[]> {
  const supabase = createClient();

  const { data: cats } = await supabase.from("product_categories").select("id, name");
  const categories = (cats ?? []) as { id: string; name: string }[];
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const { data: prods } = await supabase
    .from("products")
    .select("id, name, sku, category_id")
    .order("name", { ascending: true });
  const products = (prods ?? []) as {
    id: string;
    name: string;
    sku: string | null;
    category_id: string | null;
  }[];

  // Latest version per category (newest-first → first seen wins).
  const { data: versions } = await supabase
    .from("spec_versions")
    .select("category_id, version, published_at")
    .order("published_at", { ascending: false });
  const currentVersion = new Map<string, string>();
  for (const v of (versions ?? []) as { category_id: string; version: string }[]) {
    if (!currentVersion.has(v.category_id)) currentVersion.set(v.category_id, v.version);
  }

  return products
    .filter((p) => p.category_id && catName.has(p.category_id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      categoryId: p.category_id as string,
      familyName: catName.get(p.category_id as string) ?? "—",
      currentVersion: currentVersion.get(p.category_id as string) ?? "v1.0",
    }))
    .sort((a, b) => a.familyName.localeCompare(b.familyName) || a.name.localeCompare(b.name));
}

/**
 * Every rendered spec_documents row for a product — all versions, kinds and
 * languages. Feeds the Knowledge Hub version/language chain (Section 17.4d).
 * Defensive: pre-m171 the `language` column is absent, so we retry without it
 * and default the language to "en" (the archive's baseline).
 */
export async function getProductSpecDocuments(
  productId: string
): Promise<SpecDocument[]> {
  const supabase = createClient();
  let { data, error } = await supabase
    .from("spec_documents")
    .select("*")
    .eq("product_id", productId);
  if (error && /language/i.test(error.message ?? "")) {
    ({ data } = await supabase
      .from("spec_documents")
      .select("id, product_id, spec_version, kind, template_version, storage_path, storage_name, status, is_current, rendered_at, created_by, created_at")
      .eq("product_id", productId));
    return ((data ?? []) as any[]).map((r) => ({ ...r, language: "en" })) as SpecDocument[];
  }
  return (data ?? []) as SpecDocument[];
}

/**
 * Which SENT documents pin each spec version of a family — the "Pinned by"
 * column (Section 17.4d). Returns a map keyed by spec_versions.id. Fully
 * defensive: pre-m171 the pin column doesn't exist, so we swallow the error
 * and return an empty map (the column simply renders "—").
 */
export async function getPinsByVersion(
  categoryId: string
): Promise<Map<string, { id: string; number: string | null }[]>> {
  const supabase = createClient();
  const out = new Map<string, { id: string; number: string | null }[]>();
  try {
    // Versions belonging to this family — the pins we care about.
    const { data: vers } = await supabase
      .from("spec_versions")
      .select("id")
      .eq("category_id", categoryId);
    const versionIds = new Set(((vers ?? []) as { id: string }[]).map((v) => v.id));
    if (versionIds.size === 0) return out;

    const { data: lines, error } = await supabase
      .from("document_lines")
      .select("spec_version_id, documents(id, number, status)")
      .not("spec_version_id", "is", null);
    if (error) return out; // pre-migration: column absent → no pins

    const seen = new Set<string>(); // dedupe (version, document) pairs
    for (const l of (lines ?? []) as any[]) {
      const vid = l.spec_version_id as string | null;
      const doc = l.documents as { id: string; number: string | null; status: string | null } | null;
      if (!vid || !doc || !versionIds.has(vid)) continue;
      if (doc.status === "draft") continue; // only pins that actually froze
      const key = `${vid}:${doc.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = out.get(vid) ?? [];
      list.push({ id: doc.id, number: doc.number });
      out.set(vid, list);
    }
  } catch {
    return out;
  }
  return out;
}

/** Summary counts for the home tiles (families / models / recently published,
 *  plus the role-specific attention counts). */
export async function getHubStats(userId?: string | null): Promise<{
  families: number;
  models: number;
  recentlyPublished: number;
  awaitingApproval: number;
  myOpen: number;
}> {
  const supabase = createClient();
  const since = new Date(Date.now() - 30 * 864e5).toISOString(); // last 30 days

  const [famRes, modRes, recentRes, awaitingRes, mineRes] = await Promise.all([
    supabase.from("product_categories").select("id", { count: "exact", head: true }),
    supabase.from("products").select("id", { count: "exact", head: true }),
    supabase.from("spec_versions").select("id", { count: "exact", head: true }).gte("published_at", since),
    supabase
      .from("spec_change_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["submitted", "waiting_approval"]),
    userId
      ? supabase
          .from("spec_change_requests")
          .select("id", { count: "exact", head: true })
          .eq("created_by", userId)
          .in("status", ["draft", "rejected"])
      : Promise.resolve({ count: 0 } as { count: number }),
  ]);

  return {
    families: famRes.count ?? 0,
    models: modRes.count ?? 0,
    recentlyPublished: recentRes.count ?? 0,
    awaitingApproval: awaitingRes.count ?? 0,
    myOpen: (mineRes as { count: number | null }).count ?? 0,
  };
}

/* ===========================================================================
   Schema editor (spec.manage_schema) — read layer
   =========================================================================== */

/** A spec field plus how many values reference it (drives delete-safety UI). */
export type SchemaFieldRow = SpecField & { valueCount: number };

/** One family with its full schema, for the schema editor. */
export type SchemaFamily = {
  id: string;
  name: string;
  fields: SchemaFieldRow[];
};

/**
 * Every family with its spec_fields and a per-field value count. The count
 * lets the editor show which fields are safe to delete (0 values) vs locked.
 */
export async function listSchemaFamilies(): Promise<SchemaFamily[]> {
  const supabase = createClient();

  const { data: cats } = await supabase
    .from("product_categories")
    .select("id, name, position")
    .order("position", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  const categories = (cats ?? []) as { id: string; name: string }[];
  if (categories.length === 0) return [];

  const catIds = categories.map((c) => c.id);
  const { data: fieldRows } = await supabase
    .from("spec_fields")
    .select("*")
    .in("category_id", catIds)
    .order("sort", { ascending: true });
  const fields = (fieldRows ?? []) as SpecField[];

  // Count values per field by paging over spec_values. We deliberately do NOT
  // filter by an `.in(field_id, [...])` list: once the catalog grew to ~700
  // fields that list overflowed the request URL and silently returned nothing,
  // making every field read as value-free (and wrongly deletable). Paging the
  // whole table and tallying client-side is correct and URL-safe.
  const valueCount = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: valRows, error } = await supabase
      .from("spec_values")
      .select("field_id")
      .not("field_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error || !valRows || valRows.length === 0) break;
    for (const v of valRows as { field_id: string | null }[]) {
      if (v.field_id) valueCount.set(v.field_id, (valueCount.get(v.field_id) ?? 0) + 1);
    }
    if (valRows.length < PAGE) break;
  }

  const byCategory = new Map<string, SchemaFieldRow[]>();
  for (const f of fields) {
    const row: SchemaFieldRow = { ...f, valueCount: valueCount.get(f.id) ?? 0 };
    const list = byCategory.get(f.category_id) ?? [];
    list.push(row);
    byCategory.set(f.category_id, list);
  }

  return categories.map((c) => ({ id: c.id, name: c.name, fields: byCategory.get(c.id) ?? [] }));
}

/* ===========================================================================
   Change-requests list (spec.read) — read layer
   =========================================================================== */

/** A change request enriched with the family name and author label. */
export type ChangeRequestRow = SpecChangeRequest & {
  familyName: string | null;
  authorLabel: string | null;
  modelCount: number;
  /**
   * Glossy-datasheet refresh state for a PUBLISHED CR (null otherwise). After
   * a publish, each affected model's designed sheet must be redone in Figma and
   * re-uploaded. "cooking" = at least one affected model still lacks a ready
   * figma_override at the published version (Manuel's to-do); "ready" = all
   * affected models have theirs. datasheetDone/Total drive the "· 2/3" progress.
   */
  datasheetState: "cooking" | "ready" | null;
  datasheetDone: number;
  datasheetTotal: number;
};

/**
 * All change requests, newest first, with family name and author label
 * resolved. Powers the standalone requests-list page (Section 14).
 */
export async function listAllChangeRequests(): Promise<ChangeRequestRow[]> {
  const supabase = createClient();

  const { data: crRows } = await supabase
    .from("spec_change_requests")
    .select("*")
    .order("created_at", { ascending: false });
  const crs = (crRows ?? []) as SpecChangeRequest[];
  if (crs.length === 0) return [];

  const catIds = Array.from(
    new Set(crs.map((c) => c.category_id).filter((x): x is string => !!x))
  );
  const nameByCat = new Map<string, string>();
  if (catIds.length > 0) {
    const { data: cats } = await supabase
      .from("product_categories")
      .select("id, name")
      .in("id", catIds);
    for (const c of (cats ?? []) as { id: string; name: string }[]) nameByCat.set(c.id, c.name);
  }

  const authorLabels = await resolveUserLabelStrings(crs.map((c) => c.created_by));

  // Datasheet-refresh state for PUBLISHED CRs: has every affected model already
  // had its glossy (figma_override, status 'ready') redone at the published
  // version? Computed in bulk — one products query, one spec_documents query.
  const dsState = new Map<string, { done: number; total: number }>();
  const published = crs.filter(
    (c) => c.status === "published" && !!c.category_id && !!c.version_to
  );
  if (published.length > 0) {
    const pubCatIds = Array.from(new Set(published.map((c) => c.category_id as string)));
    const { data: prodRows } = await supabase
      .from("products")
      .select("id, category_id")
      .in("category_id", pubCatIds);
    const prodsByCat = new Map<string, string[]>();
    for (const p of (prodRows ?? []) as { id: string; category_id: string }[]) {
      const arr = prodsByCat.get(p.category_id) ?? [];
      arr.push(p.id);
      prodsByCat.set(p.category_id, arr);
    }
    const affectedByCr = new Map<string, string[]>();
    const allAffected = new Set<string>();
    for (const c of published) {
      const diff = (c.diff ?? []) as SpecDiffEntry[];
      const aff = modelsFromDiff(prodsByCat.get(c.category_id as string) ?? [], diff);
      affectedByCr.set(c.id, aff);
      for (const id of aff) allAffected.add(id);
    }
    // Which (product, version) pairs already have a ready glossy override.
    const readyPairs = new Set<string>();
    if (allAffected.size > 0) {
      const { data: docs } = await supabase
        .from("spec_documents")
        .select("product_id, spec_version")
        .in("product_id", [...allAffected])
        .eq("kind", "figma_override")
        .eq("status", "ready");
      for (const d of (docs ?? []) as { product_id: string; spec_version: string }[]) {
        readyPairs.add(`${d.product_id}@${d.spec_version}`);
      }
    }
    for (const c of published) {
      const aff = affectedByCr.get(c.id) ?? [];
      const done = aff.filter((pid) => readyPairs.has(`${pid}@${c.version_to}`)).length;
      dsState.set(c.id, { done, total: aff.length });
    }
  }

  return crs.map((cr) => {
    const diff = (cr.diff ?? []) as SpecDiffEntry[];
    const models = new Set(diff.map((d) => d.product_id).filter((x): x is string => !!x));
    const ds = dsState.get(cr.id);
    return {
      ...cr,
      familyName: cr.category_id ? nameByCat.get(cr.category_id) ?? null : null,
      authorLabel: cr.created_by ? authorLabels.get(cr.created_by) ?? null : null,
      modelCount: models.size,
      datasheetState: ds && ds.total > 0 ? (ds.done >= ds.total ? "ready" : "cooking") : null,
      datasheetDone: ds?.done ?? 0,
      datasheetTotal: ds?.total ?? 0,
    };
  });
}
