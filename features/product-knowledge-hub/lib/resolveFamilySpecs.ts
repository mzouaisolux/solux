/**
 * resolveFamilySpecs — resolve + format one family's spec feed.
 *
 * Extracted verbatim from GET /api/specs (endpoint A) steps 3–5 so both the
 * per-range endpoint and the all-ranges endpoint (/api/specs/all, used by the
 * plugin's range auto-detect) share ONE implementation and can't drift.
 *
 * Given a resolved family (category) it emits the Hub's own spec keys + formatted
 * values for every model, plus `changed` (keys that moved since `since`). It does
 * NOT authenticate or resolve the range — the caller does that.
 */

import type { createServiceClient } from "@/lib/supabase/service";
import { formatSpecValue } from "@/features/product-knowledge-hub/lib/formatSpec";
import type {
  SpecField,
  SpecValue,
  SpecVersion,
  SpecDiffEntry,
  ResolvedSpec,
} from "@/features/product-knowledge-hub/lib/types";

type ServiceClient = NonNullable<ReturnType<typeof createServiceClient>>;

export interface FamilyModel {
  name: string;
  sku: string | null;
  specs: Record<string, string>;
  changed: string[];
}

export interface ResolvedFamily {
  version: string | null;
  updatedAt: string | null;
  fields: Record<string, { label: string; unit: string | null; scope: string }>;
  common: Record<string, string>;
  models: Record<string, FamilyModel>;
}

export async function resolveFamilySpecs(
  svc: ServiceClient,
  category: { id: string; name: string },
  since: string | null,
): Promise<ResolvedFamily> {
  // Load fields, values, products, versions for the family.
  const [fieldsRes, commonValsRes, productsRes, versionsRes] = await Promise.all([
    svc.from("spec_fields").select("*").eq("category_id", category.id).order("sort", { ascending: true }),
    svc.from("spec_values").select("*").eq("category_id", category.id).is("product_id", null),
    svc.from("products").select("id, name, sku").eq("category_id", category.id).order("name", { ascending: true }),
    svc.from("spec_versions").select("*").eq("category_id", category.id).order("published_at", { ascending: false }),
  ]);

  const fields = (fieldsRes.data ?? []) as SpecField[];
  const commonVals = (commonValsRes.data ?? []) as SpecValue[];
  const products = (productsRes.data ?? []) as { id: string; name: string; sku: string | null }[];
  const versions = (versionsRes.data ?? []) as SpecVersion[];
  const currentVersion = versions[0]?.version ?? null;

  const productIds = products.map((p) => p.id);
  let modelVals: SpecValue[] = [];
  if (productIds.length > 0) {
    const { data } = await svc.from("spec_values").select("*").in("product_id", productIds);
    modelVals = (data ?? []) as SpecValue[];
  }

  const commonValByField = new Map<string, SpecValue>();
  for (const v of commonVals) if (v.field_id) commonValByField.set(v.field_id, v);
  const modelValByProductField = new Map<string, SpecValue>(); // `${product}:${field}` → value
  for (const v of modelVals) if (v.product_id && v.field_id) modelValByProductField.set(`${v.product_id}:${v.field_id}`, v);

  // `changed` since a version → union of changed field keys per model.
  // Common changes apply to every model; model changes to that product.
  const commonChanged = new Set<string>();
  const modelChanged = new Map<string, Set<string>>(); // product_id → field keys
  if (since) {
    const sinceRow = versions.find((v) => v.version === since);
    const sinceAt = sinceRow?.published_at ? new Date(sinceRow.published_at).getTime() : null;
    for (const ver of versions) {
      const at = ver.published_at ? new Date(ver.published_at).getTime() : null;
      if (sinceAt != null && at != null && at <= sinceAt) continue; // only versions AFTER `since`
      if (sinceAt == null) continue; // unknown `since` → flag nothing
      for (const entry of (ver.changes_json ?? []) as SpecDiffEntry[]) {
        if (!entry.key) continue;
        if (entry.product_id) {
          const set = modelChanged.get(entry.product_id) ?? new Set<string>();
          set.add(entry.key);
          modelChanged.set(entry.product_id, set);
        } else {
          commonChanged.add(entry.key);
        }
      }
    }
  }

  // Resolve + format. `specs` merges common + model values, keyed by Hub key.
  const fmt = (field: SpecField, value: SpecValue | null): string =>
    formatSpecValue({ field, value } as ResolvedSpec);

  const common: Record<string, string> = {};
  for (const f of fields) {
    if (f.scope !== "common") continue;
    const out = fmt(f, commonValByField.get(f.id) ?? null);
    if (out && out !== "—") common[f.key] = out;
  }

  const models: Record<string, FamilyModel> = {};
  for (const p of products) {
    const code = (p.sku ?? "").trim() || p.id; // key by SKU/code; fall back to id
    const specs: Record<string, string> = { ...common };
    for (const f of fields) {
      if (f.scope !== "model") continue;
      const out = fmt(f, modelValByProductField.get(`${p.id}:${f.id}`) ?? null);
      if (out && out !== "—") specs[f.key] = out;
    }
    const changed = new Set<string>(commonChanged);
    for (const k of modelChanged.get(p.id) ?? []) changed.add(k);
    models[code] = { name: p.name, sku: p.sku, specs, changed: [...changed] };
  }

  // Field metadata once (label/unit/scope) for the dev's mapping convenience.
  const fields_meta: Record<string, { label: string; unit: string | null; scope: string }> = {};
  for (const f of fields) fields_meta[f.key] = { label: f.label, unit: f.unit ?? null, scope: f.scope ?? "common" };

  return {
    version: currentVersion,
    updatedAt: versions[0]?.published_at ?? null,
    fields: fields_meta,
    common,
    models,
  };
}
