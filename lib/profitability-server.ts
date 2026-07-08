/**
 * Server-side batch loader for the Project Profitability widget (management).
 *
 * ONE call per page: `loadAffairProfitability(supabase, affairIds)` returns a
 * Map<affairId, ProfitabilityResult> computed from a handful of batched
 * `.in()` selects — never per-affair queries (the dashboard already fires ~68
 * queries per load; this loader adds ~7 TOTAL regardless of affair count).
 *
 * SECURITY (m142 pattern): the capability gate lives INSIDE the loader — a
 * caller without `project.view_profitability` (effective role, View-As
 * faithful) gets an EMPTY map, so no page can accidentally serialize a margin
 * to a sales browser. The drawer's server actions re-check with the REAL role
 * (see app/(app)/affairs/profitability-actions.ts).
 *
 * Resilience: every select that touches newer columns uses the house
 * try-rich/fallback idiom (m140's `source_component` is NOT applied today —
 * the fallback is the live path; m146 columns are applied but keep the guard).
 * Per-source soft-fail: a missing source degrades that component to
 * "cost unknown" (partial), never a 500.
 */

import type { createClient } from "@/lib/supabase/server";
import { hasUiCapability } from "@/lib/permissions";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { loadCostingSettings, loadPricingSettings } from "@/lib/pricing-settings";
import { computeCostingStatus } from "@/lib/costing-validity";
import { getNumberSetting } from "@/lib/app-settings";
import {
  classifyLine,
  computeAffairProfitability,
  deriveMoneyState,
  PROFITABILITY_DEFAULT_THRESHOLDS,
  PROFITABILITY_GREEN_MIN_KEY,
  PROFITABILITY_YELLOW_MIN_KEY,
  pickLeadingDoc,
  soleSr,
  type AffairProfitability,
  type ComputeInput,
  type ProfitabilityResult,
  type ProfitabilityTrace,
  type ProfitLine,
  type ProfitThresholds,
  type SrPricingInfo,
  type TraceSource,
} from "@/lib/profitability";
import {
  buildWaterfall,
  factoryCostPoint,
  shippingUpdatePoint,
  versionPoint,
  type WaterfallPoint,
  type WaterfallStep,
} from "@/lib/profitability-history";
import type { DocumentContainer } from "@/lib/types";

type Supa = ReturnType<typeof createClient>;

const chunk = <T,>(arr: T[], size = 200): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** .in() across chunks (URL-length safety), errors soft-fail to []. */
async function inSelect(
  supabase: Supa,
  table: string,
  cols: string,
  col: string,
  ids: string[]
): Promise<any[]> {
  const rows: any[] = [];
  for (const part of chunk(ids)) {
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .in(col, part);
    if (!error && data) rows.push(...(data as any[]));
  }
  return rows;
}

export async function loadProfitabilityThresholds(
  supabase: Supa
): Promise<ProfitThresholds> {
  const [greenMin, yellowMin] = await Promise.all([
    getNumberSetting(
      supabase,
      PROFITABILITY_GREEN_MIN_KEY,
      PROFITABILITY_DEFAULT_THRESHOLDS.greenMin
    ),
    getNumberSetting(
      supabase,
      PROFITABILITY_YELLOW_MIN_KEY,
      PROFITABILITY_DEFAULT_THRESHOLDS.yellowMin
    ),
  ]);
  return { greenMin, yellowMin };
}

const DOC_COLS_BASE =
  "id, number, type, status, version, date, archived_at, currency, affair_id, root_document_id, freight_cost, commission_amount";
const DOC_COLS_M146 = `${DOC_COLS_BASE}, insurance_cost, additional_charges`;

const LINE_COLS_BASE =
  "id, document_id, product_id, product_name, category_id, client_product_name, config_values, pricing_source, source_project_request_id, quantity, total_price, original_unit_price";
const LINE_COLS_M140 = `${LINE_COLS_BASE}, source_component`;

async function selectDocs(supabase: Supa, affairIds: string[]): Promise<any[]> {
  const rich = await inSelect(supabase, "documents", DOC_COLS_M146, "affair_id", affairIds);
  if (rich.length || !affairIds.length) return rich;
  // rich came back empty — could be a legit empty set OR a 42703; retry base.
  return inSelect(supabase, "documents", DOC_COLS_BASE, "affair_id", affairIds);
}

async function selectLines(supabase: Supa, docIds: string[]): Promise<any[]> {
  // m140 not applied today → the rich try 42703s and the base path serves.
  for (const cols of [LINE_COLS_M140, LINE_COLS_BASE]) {
    const rows: any[] = [];
    let failed = false;
    for (const part of chunk(docIds)) {
      const { data, error } = await supabase
        .from("document_lines")
        .select(cols)
        .in("document_id", part);
      if (error) {
        failed = true;
        break;
      }
      rows.push(...((data ?? []) as any[]));
    }
    if (!failed) return rows;
  }
  return [];
}

/**
 * Batch-compute profitability for a set of affairs. Returns an EMPTY map when
 * the caller lacks the capability — callers can spread the result safely.
 */
export async function loadAffairProfitability(
  supabase: Supa,
  affairIds: string[]
): Promise<Map<string, ProfitabilityResult>> {
  const out = new Map<string, ProfitabilityResult>();
  const ids = Array.from(new Set(affairIds.filter(Boolean)));
  if (!ids.length) return out;
  if (!(await hasUiCapability("project.view_profitability"))) return out;

  const [settings, thresholds, docs] = await Promise.all([
    loadPricingSettings(supabase),
    loadProfitabilityThresholds(supabase),
    selectDocs(supabase, ids),
  ]);

  // Pick each affair's leading doc first — everything else loads ONLY for those.
  const docsByAffair = new Map<string, any[]>();
  for (const d of docs) {
    if (!d.affair_id) continue;
    const list = docsByAffair.get(d.affair_id) ?? [];
    list.push(d);
    docsByAffair.set(d.affair_id, list);
  }
  const leadingByAffair = new Map<string, any>();
  for (const [affairId, members] of docsByAffair) {
    const leading = pickLeadingDoc(members);
    if (leading) leadingByAffair.set(affairId, leading);
  }
  const leadingIds = Array.from(leadingByAffair.values()).map((d) => d.id);
  if (!leadingIds.length) {
    for (const id of ids) out.set(id, { ok: false, reason: "no_document" });
    return out;
  }

  // Batched satellites for the leading docs only.
  const [lines, containers, srRows, shippingRows] = await Promise.all([
    selectLines(supabase, leadingIds),
    inSelect(
      supabase,
      "document_containers",
      "document_id, container_type, quantity, unit_price, wooden_box_cost",
      "document_id",
      leadingIds
    ),
    inSelect(
      supabase,
      "project_requests",
      "id, name, affair_id, product_commission_pct, pole_commission_pct",
      "affair_id",
      ids
    ),
    inSelect(
      supabase,
      "shipping_update_requests",
      "document_id, status, completed_at, new_freight_cost, reason",
      "document_id",
      leadingIds
    ),
  ]);

  const linesByDoc = new Map<string, ProfitLine[]>();
  const productIds = new Set<string>();
  const lineSrIds = new Set<string>();
  for (const l of lines) {
    const list = linesByDoc.get(l.document_id) ?? [];
    list.push(l as ProfitLine);
    linesByDoc.set(l.document_id, list);
    if (l.product_id) productIds.add(l.product_id);
    if (l.source_project_request_id) lineSrIds.add(l.source_project_request_id);
  }
  const containersByDoc = new Map<string, DocumentContainer[]>();
  for (const c of containers) {
    const list = containersByDoc.get(c.document_id) ?? [];
    list.push(c as DocumentContainer);
    containersByDoc.set(c.document_id, list);
  }

  // SR satellite data (costs / snapshot prices / freight) — one batch each.
  const srIds = Array.from(
    new Set([...lineSrIds, ...srRows.map((r: any) => r.id)])
  );
  const [factoryRows, snapshotRows, freightRows, catalogueRows] =
    await Promise.all([
      inSelect(
        supabase,
        "factory_cost_requests",
        "project_request_id, product_cost_rmb, pole_cost_rmb",
        "project_request_id",
        srIds
      ),
      inSelect(
        supabase,
        "project_products",
        "project_request_id, product_unit_price, pole_unit_price, priced_at",
        "project_request_id",
        srIds
      ),
      inSelect(
        supabase,
        "freight_cost_requests",
        "project_request_id, estimated_total_freight",
        "project_request_id",
        srIds
      ),
      inSelect(
        supabase,
        "product_costs",
        "product_id, cost_rmb",
        "product_id",
        Array.from(productIds)
      ),
    ]);
  const costingSettings = await loadCostingSettings(supabase);

  const factoryBySr = new Map(factoryRows.map((r: any) => [r.project_request_id, r]));
  const snapshotBySr = new Map(snapshotRows.map((r: any) => [r.project_request_id, r]));
  const freightBySr = new Map(freightRows.map((r: any) => [r.project_request_id, r]));
  const commissionBySr = new Map(srRows.map((r: any) => [r.id, r]));
  const srAffair = new Map<string, string>();
  for (const r of srRows) if (r.affair_id) srAffair.set(r.id, r.affair_id);

  const srInfo = (srId: string): SrPricingInfo => {
    const f: any = factoryBySr.get(srId) ?? {};
    const s: any = snapshotBySr.get(srId) ?? {};
    const fr: any = freightBySr.get(srId) ?? {};
    const c: any = commissionBySr.get(srId) ?? {};
    return {
      productCostRmb: f.product_cost_rmb != null ? Number(f.product_cost_rmb) : null,
      poleCostRmb: f.pole_cost_rmb != null ? Number(f.pole_cost_rmb) : null,
      productCommissionPct:
        c.product_commission_pct != null ? Number(c.product_commission_pct) : null,
      poleCommissionPct:
        c.pole_commission_pct != null ? Number(c.pole_commission_pct) : null,
      productUnitPrice:
        s.product_unit_price != null ? Number(s.product_unit_price) : null,
      poleUnitPrice: s.pole_unit_price != null ? Number(s.pole_unit_price) : null,
      estimatedTotalFreight:
        fr.estimated_total_freight != null
          ? Number(fr.estimated_total_freight)
          : null,
    };
  };

  const catalogueCostRmb = new Map<string, number>(
    catalogueRows.map((r: any) => [r.product_id, Number(r.cost_rmb) || 0])
  );

  // Latest completed shipping update per leading doc — AUDIT TRACE only
  // (freight never enters the margin math; owner rule 2026-07-08).
  const latestShippingInfo = new Map<
    string,
    { at: string; reason: string | null }
  >();
  const latestShippingAt = new Map<string, number>();
  for (const r of shippingRows) {
    if (r.status !== "completed" || !r.completed_at) continue;
    const at = Date.parse(r.completed_at) || 0;
    if (at >= (latestShippingAt.get(r.document_id) ?? -1)) {
      latestShippingAt.set(r.document_id, at);
      latestShippingInfo.set(r.document_id, {
        at: r.completed_at,
        reason: r.reason ?? null,
      });
    }
  }

  const srNameById = new Map<string, string>(
    srRows.map((r: any) => [r.id, r.name ?? "Service Request"])
  );

  // Assemble per affair.
  for (const affairId of ids) {
    const members = docsByAffair.get(affairId);
    if (!members?.length) {
      out.set(affairId, { ok: false, reason: "no_document" });
      continue;
    }
    const leading = leadingByAffair.get(affairId);
    const affairSrIds = new Set<string>(
      srRows.filter((r: any) => r.affair_id === affairId).map((r: any) => r.id)
    );
    const leadingLines = linesByDoc.get(leading?.id ?? "") ?? [];
    for (const l of leadingLines) {
      if (l.source_project_request_id) affairSrIds.add(l.source_project_request_id);
    }
    const srById = new Map<string, SrPricingInfo>();
    for (const srId of affairSrIds) srById.set(srId, srInfo(srId));

    const input: ComputeInput = {
      docs: members,
      lines: leadingLines,
      containers: containersByDoc.get(leading?.id ?? "") ?? [],
      srById,
      catalogueCostRmb,
      settings,
      thresholds,
    };
    const result = computeAffairProfitability(input);
    if (!result.ok || !leading) {
      out.set(affairId, result);
      continue;
    }

    // ---- AUDIT TRACE (owner 2026-07-08): every figure names its source ----
    const fallback = soleSr(srById);
    const srOfLine = (l: ProfitLine): string | null =>
      l.source_project_request_id ?? fallback?.id ?? null;
    const srLabel = (srId: string) =>
      srNameById.get(srId) ?? "Service Request";

    const productSources: TraceSource[] = [];
    const poleSources: TraceSource[] = [];
    const seenSrProduct = new Set<string>();
    const seenSrPole = new Set<string>();
    const seenCatalogue = new Set<string>();
    for (const l of leadingLines) {
      const srId = srOfLine(l);
      const sr = srId ? srById.get(srId) ?? null : null;
      const kind = classifyLine(l, sr);
      if (kind === "product") {
        if (l.pricing_source === "approved_service_request" && srId && sr) {
          if (!seenSrProduct.has(srId)) {
            seenSrProduct.add(srId);
            productSources.push({
              label: `SR « ${srLabel(srId)} » — ${
                sr.productCostRmb != null
                  ? `${sr.productCostRmb} RMB/u`
                  : "cost missing"
              }`,
              href: `/projects/${srId}`,
              detail: "factory_cost_requests.product_cost_rmb",
            });
          }
        } else if (l.product_id) {
          if (!seenCatalogue.has(l.product_id)) {
            seenCatalogue.add(l.product_id);
            const rmb = catalogueCostRmb.get(l.product_id);
            productSources.push({
              label: `${(l as any).product_name ?? "Catalogue product"} — ${
                rmb != null && rmb > 0 ? `${rmb} RMB/u` : "cost missing"
              }`,
              href: "/cost-entry",
              detail: "product_costs.cost_rmb (versioned history in Cost Entry)",
            });
          }
        }
      } else if (kind === "pole" && srId && sr && !seenSrPole.has(srId)) {
        seenSrPole.add(srId);
        poleSources.push({
          label: `SR « ${srLabel(srId)} » — ${
            sr.poleCostRmb != null ? `${sr.poleCostRmb} RMB/u` : "cost missing"
          }`,
          href: `/projects/${srId}`,
          detail: "factory_cost_requests.pole_cost_rmb",
        });
      }
    }

    const goodsFormula = `RMB ÷ ${settings.exchangeRate} × (1 − ${Math.round(
      settings.taxRebate * 100
    )}% export rebate) · SR commission stripped from revenue`;

    const ship = latestShippingInfo.get(leading.id);
    const srWithFreight = Array.from(affairSrIds).find(
      (id) => srById.get(id)?.estimatedTotalFreight != null
    );
    const freightTrace: TraceSource = ship
      ? {
          label: `Shipping update completed ${ship.at.slice(0, 10)}`,
          href: "/operations/shipping-updates",
          detail: `${
            ship.reason ? `${ship.reason} · ` : ""
          }Re-invoiced at cost — never counted in margin (company rule)`,
        }
      : srWithFreight
      ? {
          label: `SR « ${srLabel(srWithFreight)} » freight estimate`,
          href: `/projects/${srWithFreight}`,
          detail:
            "freight_cost_requests.estimated_total_freight · Re-invoiced at cost — never counted in margin",
        }
      : {
          label: "Quotation shipping section",
          href: `/documents/${leading.id}`,
          detail:
            "document_containers (qty × rate) · Re-invoiced at cost — never counted in margin",
        };

    // m153 auto-suggestion: RED margins + aging costing ⇒ suggest a revision.
    let revisionHint: AffairProfitability["revisionHint"] = null;
    if (result.overallHealth === "red") {
      let oldestAt: string | null = null;
      let oldestSr: string | null = null;
      for (const srId of affairSrIds) {
        const row: any = snapshotBySr.get(srId);
        const at = row?.priced_at as string | undefined;
        if (at && (!oldestAt || at < oldestAt)) {
          oldestAt = at;
          oldestSr = srId;
        }
      }
      const status = computeCostingStatus(
        oldestAt,
        new Date().toISOString().slice(0, 10),
        costingSettings
      );
      if (status.status === "aging" || status.status === "expired") {
        revisionHint = { ageDays: status.ageDays ?? 0, srId: oldestSr };
      }
    }

    const trace: ProfitabilityTrace = {
      sellingPrice: {
        label: `${leading.number ?? "Quotation"}${
          (leading.version ?? 1) > 1 ? ` V${leading.version}` : ""
        } (${leading.status})`,
        href: `/documents/${leading.id}`,
        detail:
          "Latest commercially-valid quotation — revenue recomputed live from its lines + shipping",
      },
      product: productSources.length
        ? { sources: productSources, formula: goodsFormula }
        : null,
      pole: poleSources.length
        ? { sources: poleSources, formula: goodsFormula }
        : null,
      freight: freightTrace,
      insurance:
        Number(leading.insurance_cost || 0) > 0
          ? {
              label: "documents.insurance_cost",
              href: `/documents/${leading.id}`,
              detail:
                "Formula: product value × 1.10 × insurance rate ‰ (quotation builder / shipping update)",
            }
          : null,
      charges: (leading.additional_charges ?? []).length
        ? {
            items: (leading.additional_charges ?? []).map((c: any) => ({
              label: String(c?.label ?? "Charge"),
              amount: Number(c?.amount) || 0,
            })),
            href: `/documents/${leading.id}`,
          }
        : null,
      basis: {
        exchangeRate: settings.exchangeRate,
        taxRebate: settings.taxRebate,
      },
    };

    out.set(affairId, { ...result, trace, revisionHint });
  }
  return out;
}

/**
 * "Why did the margin change?" — assemble the affair's waterfall from the
 * dated old→new records the app already keeps (doc versions, m149 shipping
 * updates, m091 factory-cost audits) and replay the overall margin backwards
 * from today (lib/profitability-history). Runs ONLY from the drawer's lazy
 * server action — never on list pages. Freight moves the % through grand-total
 * dilution only (company rule: transport never generates margin).
 *
 * Honest v1 scope: catalogue cost-history points (m086) are not collected yet
 * (multi-product attribution); the UI discloses reconstruction limits.
 */
/** One audited cost revision (grouped insert batch) — drawer history entry. */
export type CostRevisionEntry = {
  revision: number; // chronological, 1 = oldest
  at: string | null;
  by: string | null; // resolved display name
  reason: string | null;
  srId: string | null;
  changes: { field: string; old: number | null; new: number | null }[];
};

/** Costing-version summary (m140) for the drawer audit panel. */
export type CostingVersionEntry = {
  versionNo: number;
  status: string;
  requestedBy: string | null;
  requestedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  reason: string | null;
  productUnitPrice: number | null;
  poleUnitPrice: number | null;
};

export type WaterfallPayload = {
  steps: WaterfallStep[];
  costHistory: CostRevisionEntry[];
  versions: CostingVersionEntry[];
};

export async function loadAffairWaterfall(
  supabase: Supa,
  affairId: string
): Promise<WaterfallPayload | null> {
  if (!(await hasUiCapability("project.view_profitability"))) return null;
  const map = await loadAffairProfitability(supabase, [affairId]);
  const current = map.get(affairId);
  if (!current || !current.ok) return null;
  const settings = await loadPricingSettings(supabase);
  const X = Number(settings.exchangeRate) || 0;

  // Member docs of the LEADING doc's version FAMILY only (an affair can hold
  // several families — e.g. a quotation + the proforma Launch Production
  // created; cross-family "Revised" points would be fiction). Family key =
  // the m059 version-chain root.
  const docs = await selectDocs(supabase, [affairId]);
  const leadingRow: any = docs.find((d: any) => d.id === current.leadingDoc.id);
  const familyRoot: string =
    leadingRow?.root_document_id ?? current.leadingDoc.id;
  const members = docs
    .filter(
      (d: any) =>
        !d.archived_at &&
        d.status !== "lost" &&
        d.status !== "cancelled" &&
        (d.root_document_id ?? d.id) === familyRoot
    )
    .sort(
      (a: any, b: any) =>
        (a.version ?? 1) - (b.version ?? 1) ||
        (Date.parse(a.date ?? "") || 0) - (Date.parse(b.date ?? "") || 0)
    );
  const leadingIdx = members.findIndex(
    (d: any) => d.id === current.leadingDoc.id
  );
  const chain = leadingIdx >= 0 ? members.slice(0, leadingIdx + 1) : members;

  // Per-version selling snapshots (each version has its OWN lines/containers).
  const chainIds = chain.map((d: any) => d.id);
  const [chainLines, chainContainers] = await Promise.all([
    selectLines(supabase, chainIds),
    inSelect(
      supabase,
      "document_containers",
      "document_id, container_type, quantity, unit_price, wooden_box_cost",
      "document_id",
      chainIds
    ),
  ]);
  const linesByDoc = new Map<string, ProfitLine[]>();
  for (const l of chainLines) {
    const list = linesByDoc.get(l.document_id) ?? [];
    list.push(l as ProfitLine);
    linesByDoc.set(l.document_id, list);
  }
  const containersByDoc = new Map<string, DocumentContainer[]>();
  for (const c of chainContainers) {
    const list = containersByDoc.get(c.document_id) ?? [];
    list.push(c as DocumentContainer);
    containersByDoc.set(c.document_id, list);
  }

  // SR info for the classifier / commission strip (same shape as the widget).
  const srIds = Array.from(
    new Set(
      chainLines
        .map((l: any) => l.source_project_request_id)
        .filter(Boolean) as string[]
    )
  );
  const [srRows, factoryRows, snapshotRows, freightRows] = await Promise.all([
    inSelect(
      supabase,
      "project_requests",
      "id, product_commission_pct, pole_commission_pct",
      "id",
      srIds
    ),
    inSelect(
      supabase,
      "factory_cost_requests",
      "project_request_id, product_cost_rmb, pole_cost_rmb",
      "project_request_id",
      srIds
    ),
    inSelect(
      supabase,
      "project_products",
      "project_request_id, product_unit_price, pole_unit_price",
      "project_request_id",
      srIds
    ),
    inSelect(
      supabase,
      "freight_cost_requests",
      "project_request_id, estimated_total_freight",
      "project_request_id",
      srIds
    ),
  ]);
  const srById = new Map<string, SrPricingInfo>();
  for (const id of srIds) {
    const f: any = factoryRows.find((r: any) => r.project_request_id === id) ?? {};
    const s: any = snapshotRows.find((r: any) => r.project_request_id === id) ?? {};
    const fr: any = freightRows.find((r: any) => r.project_request_id === id) ?? {};
    const c: any = srRows.find((r: any) => r.id === id) ?? {};
    srById.set(id, {
      productCostRmb: f.product_cost_rmb != null ? Number(f.product_cost_rmb) : null,
      poleCostRmb: f.pole_cost_rmb != null ? Number(f.pole_cost_rmb) : null,
      productCommissionPct:
        c.product_commission_pct != null ? Number(c.product_commission_pct) : null,
      poleCommissionPct:
        c.pole_commission_pct != null ? Number(c.pole_commission_pct) : null,
      productUnitPrice:
        s.product_unit_price != null ? Number(s.product_unit_price) : null,
      poleUnitPrice: s.pole_unit_price != null ? Number(s.pole_unit_price) : null,
      estimatedTotalFreight:
        fr.estimated_total_freight != null
          ? Number(fr.estimated_total_freight)
          : null,
    });
  }

  const stateOfDoc = (d: any): AffairProfitability | null => {
    const r = computeAffairProfitability({
      docs: [d],
      lines: linesByDoc.get(d.id) ?? [],
      containers: containersByDoc.get(d.id) ?? [],
      srById,
      catalogueCostRmb: new Map(),
      settings,
    });
    return r.ok ? r : null;
  };

  const points: WaterfallPoint[] = [];
  // Version transitions: the NEWER version's date carries the point; undo
  // restores the OLDER version's exact selling snapshot.
  for (let i = 1; i < chain.length; i++) {
    const prev = stateOfDoc(chain[i - 1]);
    if (!prev) continue;
    const prevState = deriveMoneyState(prev, settings.taxRebate);
    points.push(
      versionPoint({
        at: chain[i].date ?? "",
        version: chain[i].version ?? i + 1,
        previousSelling: {
          productEngineRevenue: prevState.productEngineRevenue,
          poleEngineRevenue: prevState.poleEngineRevenue,
          freightRevenue: prevState.freightRevenue,
          insurance: prevState.insurance,
          charges: prevState.charges,
          commission: prevState.commission,
          unclassifiedRevenue: prevState.unclassifiedRevenue,
        },
      })
    );
  }

  // Completed shipping updates on the leading doc (old→new + ops reason).
  const shippingRows = await inSelect(
    supabase,
    "shipping_update_requests",
    "document_id, status, completed_at, previous_freight_cost, new_freight_cost, previous_insurance_cost, new_insurance_cost, reason",
    "document_id",
    [current.leadingDoc.id]
  );
  for (const r of shippingRows) {
    if (r.status === "completed" && r.completed_at) {
      points.push(shippingUpdatePoint(r));
    }
  }

  // Factory-cost audits (Director overrides): RMB old→new, converted to the
  // USD aggregate with the LEADING doc's component quantities.
  const leadingLines = linesByDoc.get(current.leadingDoc.id) ?? [];
  const qtyOf = (kind: "product" | "pole") =>
    leadingLines.reduce((s, l) => {
      const sr = l.source_project_request_id
        ? srById.get(l.source_project_request_id) ?? null
        : null;
      return classifyLine(l, sr) === kind
        ? s + Math.max(0, Number(l.quantity) || 0)
        : s;
    }, 0);
  const productQty = qtyOf("product");
  const poleQty = qtyOf("pole");
  let allAudits: any[] = [];
  if (srIds.length) {
    const audits = await inSelect(
      supabase,
      "factory_cost_audit",
      "project_request_id, field, old_value, new_value, reason, changed_by, changed_at",
      "project_request_id",
      srIds
    );
    for (const a of audits) {
      if (!a.changed_at || a.old_value == null || X <= 0) continue;
      const qty = a.field === "pole_cost_rmb" ? poleQty : productQty;
      if (qty <= 0) continue;
      points.push(
        factoryCostPoint({
          changed_at: a.changed_at,
          field: a.field,
          oldUsdAggregate: (Number(a.old_value) / X) * qty,
          reason: a.reason,
        })
      );
    }
    // NOTE: SR freight audits (m098) deliberately NOT collected — freight is
    // a pure pass-through by company rule; its cost history can't move the %.
    allAudits = audits;
  }

  // ---- AUDIT CENTER (owner 2026-07-08): full cost-revision history --------
  // Group audit rows per insert batch (one batch = identical changed_at/by/
  // reason — verified transaction-stable) → numbered revisions, oldest = #1.
  const actorIds = Array.from(
    new Set(allAudits.map((a: any) => a.changed_by).filter(Boolean))
  ) as string[];
  const labels = actorIds.length
    ? await resolveUserLabelStrings(actorIds)
    : new Map<string, string>();
  const sortedAudits = [...allAudits].sort(
    (a: any, b: any) =>
      (Date.parse(a.changed_at ?? "") || 0) - (Date.parse(b.changed_at ?? "") || 0)
  );
  const costHistory: CostRevisionEntry[] = [];
  for (const a of sortedAudits) {
    const key = `${a.changed_at}|${a.changed_by}|${a.reason ?? ""}`;
    const last = costHistory[costHistory.length - 1];
    const lastKey = last ? `${last.at}|${(last as any)._byId}|${last.reason ?? ""}` : null;
    if (last && lastKey === key) {
      last.changes.push({ field: a.field, old: a.old_value, new: a.new_value });
    } else {
      costHistory.push({
        revision: costHistory.length + 1,
        at: a.changed_at ?? null,
        by: a.changed_by ? labels.get(a.changed_by) ?? null : null,
        reason: a.reason ?? null,
        srId: a.project_request_id ?? null,
        changes: [{ field: a.field, old: a.old_value, new: a.new_value }],
        ...({ _byId: a.changed_by } as any),
      });
    }
  }
  for (const e of costHistory) delete (e as any)._byId;

  // Costing versions (m140) — fallback-guarded (empty pre-apply).
  let versions: CostingVersionEntry[] = [];
  try {
    const vRows = await inSelect(
      supabase,
      "project_costing_versions",
      "project_request_id, version_no, status, requested_by, requested_at, approved_by, approved_at, reason, product_unit_price, pole_unit_price",
      "project_request_id",
      srIds
    );
    const vActorIds = Array.from(
      new Set(
        vRows.flatMap((v: any) => [v.requested_by, v.approved_by]).filter(Boolean)
      )
    ) as string[];
    const vLabels = vActorIds.length
      ? await resolveUserLabelStrings(vActorIds)
      : new Map<string, string>();
    versions = vRows
      .sort((a: any, b: any) => (a.version_no ?? 0) - (b.version_no ?? 0))
      .map((v: any) => ({
        versionNo: v.version_no,
        status: v.status,
        requestedBy: v.requested_by ? vLabels.get(v.requested_by) ?? null : null,
        requestedAt: v.requested_at ?? null,
        approvedBy: v.approved_by ? vLabels.get(v.approved_by) ?? null : null,
        approvedAt: v.approved_at ?? null,
        reason: v.reason ?? null,
        productUnitPrice:
          v.product_unit_price != null ? Number(v.product_unit_price) : null,
        poleUnitPrice: v.pole_unit_price != null ? Number(v.pole_unit_price) : null,
      }));
  } catch {
    /* pre-m140 — dormant */
  }

  return {
    steps: buildWaterfall(deriveMoneyState(current, settings.taxRebate), points),
    costHistory,
    versions,
  };
}

/** Widget on a document page: resolve the doc's affair, then delegate. */
export async function loadDocumentProfitability(
  supabase: Supa,
  documentId: string
): Promise<ProfitabilityResult | null> {
  const { data: doc } = await supabase
    .from("documents")
    .select("id, affair_id")
    .eq("id", documentId)
    .maybeSingle();
  const affairId = (doc as any)?.affair_id as string | null;
  if (!affairId) return null; // legacy unlinked docs: no affair, no widget (v1)
  const map = await loadAffairProfitability(supabase, [affairId]);
  return map.get(affairId) ?? null;
}

/** Widget on an SR page: resolve the SR's affair, then delegate. */
export async function loadRequestProfitability(
  supabase: Supa,
  projectRequestId: string
): Promise<ProfitabilityResult | null> {
  const { data: pr } = await supabase
    .from("project_requests")
    .select("id, affair_id")
    .eq("id", projectRequestId)
    .maybeSingle();
  const affairId = (pr as any)?.affair_id as string | null;
  if (!affairId) return null;
  const map = await loadAffairProfitability(supabase, [affairId]);
  return map.get(affairId) ?? null;
}
