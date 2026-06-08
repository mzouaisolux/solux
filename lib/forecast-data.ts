/**
 * Forecast data loader (server-only).
 *
 * Shared by the /forecast command center AND the dashboard forecast
 * strip so both read the same normalized `ForecastDeal[]`. Keeping the
 * query in one place means the scoping rules (sales sees own, admin /
 * TLM / operations see all) can't drift between surfaces.
 *
 * Soft-fails to an empty array if m050 (forecast columns) isn't
 * applied yet — both callers then render a clean empty state instead
 * of crashing the route.
 */

import { createClient } from "@/lib/supabase/server";
import { resolveUserLabelStrings } from "@/lib/user-display";
import type {
  ForecastDeal,
  ForecastProbability,
  ForecastCategory,
} from "@/lib/forecast";

/**
 * Load ALL active quotations (status sent / negotiating, not archived)
 * — whether or not they already carry a forecast.
 *
 * This is the workspace loader: the /forecast page lists every active
 * deal so sales can set the forecast inline. Rows without a probability
 * simply contribute 0 to weighted projections.
 *
 * @param scopedUserId  when set, restrict to quotations created by
 *                      this user (sales personal view). Pass null for
 *                      the global management view.
 */
export async function loadActiveQuotationsForForecast(
  scopedUserId: string | null
): Promise<ForecastDeal[]> {
  const supabase = createClient();

  let query = supabase
    .from("documents")
    .select(
      "id, number, total_price, currency, created_by, client_id, status, " +
        "forecast_probability, forecast_category, forecast_expected_close_date, " +
        "forecast_updated_at, version, root_document_id, clients(company_name, country)"
    )
    .in("status", ["sent", "negotiating"])
    .is("archived_at", null);

  if (scopedUserId) query = query.eq("created_by", scopedUserId);

  let { data: docs, error } = await query;
  if (error) {
    // m050/m059 not applied (forecast_* / version columns missing) →
    // retry without them so the workspace still lists active quotations
    // (every row just shows an empty, editable forecast). The inline
    // save will then surface the "apply migration" hint if they edit.
    if (/forecast_|version|root_document_id/.test(error.message ?? "")) {
      let retry = supabase
        .from("documents")
        .select(
          "id, number, total_price, currency, created_by, client_id, status, " +
            "clients(company_name, country)"
        )
        .in("status", ["sent", "negotiating"])
        .is("archived_at", null);
      if (scopedUserId) retry = retry.eq("created_by", scopedUserId);
      const r = await retry;
      if (r.error) {
        console.warn("[loadActiveQuotationsForForecast]", r.error.message);
        return [];
      }
      docs = r.data;
    } else {
      console.warn("[loadActiveQuotationsForForecast]", error.message);
      return [];
    }
  }
  const rows = docs ?? [];
  if (rows.length === 0) return [];

  // ---- Resolve the dominant product family per quotation -------------
  // The "family" of a deal = the product category carrying the most
  // value on the quotation. We pull lines + products in two batched
  // queries, then pick the max-value line's category per document.
  const docIds = rows.map((d: any) => d.id);
  const familyByDoc = new Map<string, string | null>();
  try {
    const { data: lines } = await supabase
      .from("document_lines")
      .select("document_id, product_id, total_price")
      .in("document_id", docIds);

    const productIds = Array.from(
      new Set((lines ?? []).map((l: any) => l.product_id).filter(Boolean))
    );
    const categoryByProduct = new Map<string, string | null>();
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from("products")
        .select("id, category")
        .in("id", productIds);
      for (const p of (products ?? []) as Array<{
        id: string;
        category: string | null;
      }>) {
        categoryByProduct.set(p.id, p.category);
      }
    }

    // Per doc: accumulate value per family, keep the top one.
    const valueByDocFamily = new Map<string, Map<string, number>>();
    for (const l of (lines ?? []) as Array<{
      document_id: string;
      product_id: string | null;
      total_price: number | null;
    }>) {
      const fam = l.product_id
        ? categoryByProduct.get(l.product_id) ?? null
        : null;
      const famKey = fam ?? "—";
      const inner =
        valueByDocFamily.get(l.document_id) ?? new Map<string, number>();
      inner.set(famKey, (inner.get(famKey) ?? 0) + Number(l.total_price || 0));
      valueByDocFamily.set(l.document_id, inner);
    }
    for (const [docId, inner] of valueByDocFamily) {
      let topFam: string | null = null;
      let topVal = -1;
      for (const [fam, val] of inner) {
        if (val > topVal) {
          topVal = val;
          topFam = fam === "—" ? null : fam;
        }
      }
      familyByDoc.set(docId, topFam);
    }
  } catch {
    // Family resolution is best-effort — a failure here just leaves
    // every deal's family null (grouped under "Uncategorized").
  }

  const deals = rows.map((d: any): ForecastDeal => ({
    id: d.id,
    number: d.number ?? null,
    clientName: d.clients?.company_name ?? null,
    status: (d.status ?? "") as string,
    total: Number(d.total_price || 0),
    currency: (d.currency ?? "USD") as string,
    probability: (d.forecast_probability ?? null) as ForecastProbability | null,
    category: (d.forecast_category ?? null) as ForecastCategory | null,
    expectedCloseDate: d.forecast_expected_close_date ?? null,
    updatedAt: d.forecast_updated_at ?? null,
    ownerId: d.created_by ?? null,
    country: d.clients?.country ?? null,
    productFamily: familyByDoc.get(d.id) ?? null,
    version: Number(d.version ?? 1),
    rootId: (d.root_document_id ?? null) as string | null,
  }));

  // Keep only the LATEST version per affair so V1 + V2 of the same deal
  // don't double-count in the pipeline. The affair key is the root id
  // (root_document_id ?? id). Non-versioned quotations each form their
  // own affair and are always kept.
  const byAffair = new Map<string, ForecastDeal>();
  for (const d of deals) {
    const key = d.rootId ?? d.id;
    const existing = byAffair.get(key);
    if (!existing || d.version > existing.version) byAffair.set(key, d);
  }
  return Array.from(byAffair.values());
}

/**
 * Load only the FORECASTED active quotations (probability set). Built
 * on top of `loadActiveQuotationsForForecast` so the KPI surfaces (the
 * dashboard ForecastStrip, and the page's headline math) stay focused
 * on deals that actually carry a commercial read.
 */
export async function loadForecastDeals(
  scopedUserId: string | null
): Promise<ForecastDeal[]> {
  const all = await loadActiveQuotationsForForecast(scopedUserId);
  return all.filter((d) => d.probability != null);
}

/**
 * Resolve human labels for a set of owner ids — prefers the admin-set
 * display name (m052), falling back to "role · uuid8". Thin wrapper
 * over the shared `resolveUserLabelStrings` so forecast-by-rep reads
 * the same names as conversations + the business KPIs.
 */
export async function resolveOwnerLabels(
  ownerIds: string[]
): Promise<Map<string, string>> {
  return resolveUserLabelStrings(ownerIds);
}
