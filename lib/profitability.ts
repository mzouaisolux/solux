/**
 * Project Profitability engine — pure and unit-tested. Computes the
 * management widget's numbers (Product % / Pole % / Overall % + health) for
 * one affair from plain data the server loader hands it. No DB access here.
 *
 * BUSINESS RULES (owner spec, 2026-07-07):
 *  - The LATEST commercially-valid quotation always wins: a WON document is
 *    the contract (won-first), else the highest version (date tiebreak).
 *  - Margins must read back EXACTLY as the Director typed them. Two traps the
 *    math must absorb:
 *      1. SR commission is FOLDED INTO line unit prices
 *         (project_products.unit_price = enginePrice + commission, and
 *         generated docs set commission_enabled:false). The agent's payout is
 *         NOT profit: strip it — engineRevenue = revenue / (1 + c/100).
 *      2. The export tax rebate counts toward profit (computeSectionPrice):
 *         marginValue = engineRevenue − usdCost·(1 − taxRebate).
 *  - NEVER guess a line's component. The classification chain is safe-only;
 *    an unresolvable line keeps its revenue in the grand total but marks the
 *    result PARTIAL (cost unknown) instead of inventing a margin.
 *  - Costs stay confidential: this module never leaves the server (the loader
 *    is capability-gated); the UI receives computed results only.
 *
 * Overall = Σ known component marginValue / grand total (client-facing,
 * RECOMPUTED from parts — documents.total_price goes stale after m149
 * shipping completions). Pass-throughs (insurance, charges; freight when no
 * real cost is known) dilute the overall — that is the point: "of each client
 * dollar, what do we keep".
 */

// Dependency-free on purpose (like lib/freight-validity / lib/manual-items):
// value imports break under the node --experimental-strip-types test runner
// (extensionless ESM). Type-only imports are erased at strip time and safe.
import type { DocumentContainer } from "./types";

/**
 * MIRROR of lib/logistics containerLineTotal/totalFreight — keep in sync.
 * Per-row freight = (qty × unit) + wooden box (LCL only).
 */
export function freightTotalOf(containers: DocumentContainer[]): number {
  return containers.reduce((sum, c) => {
    const freight = Number(c.quantity || 0) * Number(c.unit_price || 0);
    const box =
      c.container_type === "LCL" ? Number(c.wooden_box_cost || 0) : 0;
    return sum + freight + box;
  }, 0);
}

/** MIRROR of lib/custom-pole isCustomPoleConfig — keep in sync. */
const isCustomPoleLine = (line: {
  config_values?: Record<string, unknown> | null;
}): boolean => (line.config_values as any)?.line_type === "custom_pole";

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type ProfitHealth = "green" | "yellow" | "red";

export type ProfitThresholds = {
  /** Margin % at or above which the indicator is green. */
  greenMin: number;
  /** Margin % at or above which (but below greenMin) it is yellow. */
  yellowMin: number;
};

/** Owner defaults (2026-07-07): 🟢 ≥30 · 🟡 20–29 · 🔴 <20. */
export const PROFITABILITY_DEFAULT_THRESHOLDS: ProfitThresholds = {
  greenMin: 30,
  yellowMin: 20,
};

/** app_settings keys (getNumberSetting) — configurable without a migration. */
export const PROFITABILITY_GREEN_MIN_KEY = "profitability.green_min_pct";
export const PROFITABILITY_YELLOW_MIN_KEY = "profitability.yellow_min_pct";

export function healthFor(
  pct: number,
  t: ProfitThresholds = PROFITABILITY_DEFAULT_THRESHOLDS
): ProfitHealth {
  // Defensive: a misconfigured yellowMin > greenMin must not invert the scale.
  const green = Number(t.greenMin);
  const yellow = Math.min(Number(t.yellowMin), green);
  if (pct >= green) return "green";
  if (pct >= yellow) return "yellow";
  return "red";
}

// ---------------------------------------------------------------------------
// Leading document — "latest quotation always wins", won-first
// ---------------------------------------------------------------------------

export type LeadDocCandidate = {
  id: string;
  type?: string | null; // 'quotation' | 'proforma'
  status: string; // draft | sent | negotiating | won | lost | cancelled
  version?: number | null;
  date?: string | null; // documents has NO created_at — `date` is creation time
  archived_at?: string | null;
  currency?: string | null;
};

const docTime = (d: LeadDocCandidate): number => {
  const t = d.date ? Date.parse(d.date) : 0;
  return Number.isNaN(t) ? 0 : t;
};

const latestOf = <T extends LeadDocCandidate>(docs: T[]): T | null =>
  docs.reduce<T | null>((acc, d) => {
    if (!acc) return d;
    const av = acc.version ?? 1;
    const dv = d.version ?? 1;
    if (dv > av) return d;
    if (dv === av && docTime(d) >= docTime(acc)) return d;
    return acc;
  }, null);

/**
 * Pick the affair's money-truth document. A WON document is the contract, so
 * it beats any later draft/lost revision (same won-wins semantics as the
 * affair grouping in lib/affairs-prototype, but applied to the MONEY pick —
 * `groupIntoAffairs.latest` alone may land on a later lost/draft revision).
 * Cancelled/lost docs only lead when nothing else exists.
 */
export function pickLeadingDoc<T extends LeadDocCandidate>(
  docs: T[]
): T | null {
  const live = docs.filter((d) => !d.archived_at);
  if (!live.length) return null;
  const won = live.filter((d) => d.status === "won");
  if (won.length) return latestOf(won);
  const commercial = live.filter(
    (d) => d.status !== "lost" && d.status !== "cancelled"
  );
  return latestOf(commercial.length ? commercial : live);
}

// ---------------------------------------------------------------------------
// Line classification — safe chain, never guess
// ---------------------------------------------------------------------------

export type LineComponentKind = "product" | "pole" | "unclassified";

export type ProfitLine = {
  id?: string;
  product_id?: string | null;
  category_id?: string | null;
  client_product_name?: string | null;
  config_values?: Record<string, unknown> | null;
  pricing_source?: string | null;
  source_project_request_id?: string | null;
  /** m140 — absent from the DB today; honoured first when it ships. */
  source_component?: string | null;
  quantity: number;
  total_price: number;
  original_unit_price?: number | null;
};

/** The slice of an SR the classifier + cost lookup need (per SR id). */
export type SrPricingInfo = {
  productCostRmb: number | null;
  poleCostRmb: number | null;
  productCommissionPct: number | null;
  poleCommissionPct: number | null;
  /** Approved snapshot unit prices (m095) — m139 locks lines to these. */
  productUnitPrice: number | null;
  poleUnitPrice: number | null;
  estimatedTotalFreight: number | null;
};

const PRICE_MATCH_EPS = 0.005;
const near = (a: number, b: number | null | undefined) =>
  b != null && Math.abs(a - Number(b)) <= PRICE_MATCH_EPS;

/**
 * Which bucket does a line's revenue belong to?
 *  1. m140 source_component when present (authoritative once shipped).
 *  2. Custom-pole discriminator (config_values.line_type) → pole.
 *  3. SR lines: a category means PRODUCT (poles are deliberately
 *     category-less, m133). Category-null is NOT safely a pole (an
 *     uncategorized SR also yields a null-category product line) → match the
 *     locked unit price against the SR's approved snapshot, then the
 *     deterministic "Pole …" name mkLine writes; otherwise UNCLASSIFIED.
 *  4. Catalogue lines (product_id) → product.
 *  5. Anything else → unclassified (honest: revenue counted, cost unknown).
 */
export function classifyLine(
  line: ProfitLine,
  sr: SrPricingInfo | null | undefined
): LineComponentKind {
  if (line.source_component === "product" || line.source_component === "pole") {
    return line.source_component;
  }
  if (isCustomPoleLine(line)) return "pole";
  if (line.pricing_source === "approved_service_request") {
    if (line.category_id != null) return "product";
    const unit = Number(line.original_unit_price ?? NaN);
    if (Number.isFinite(unit) && sr) {
      const matchesPole = near(unit, sr.poleUnitPrice);
      const matchesProduct = near(unit, sr.productUnitPrice);
      if (matchesPole && !matchesProduct) return "pole";
      if (matchesProduct && !matchesPole) return "product";
    }
    if (/^pole\b/i.test((line.client_product_name ?? "").trim())) return "pole";
    return "unclassified";
  }
  if (line.product_id != null) return "product";
  return "unclassified";
}

// ---------------------------------------------------------------------------
// Money math — consistent with lib/project-pricing computeSectionPrice
// ---------------------------------------------------------------------------

/** revenue with the SR agent commission stripped back out. */
export function stripCommission(
  revenue: number,
  commissionPct: number | null | undefined
): number {
  const c = Math.max(0, Number(commissionPct ?? 0));
  return c > 0 ? revenue / (1 + c / 100) : revenue;
}

/**
 * Goods margin (product/pole/catalogue): the export rebate counts toward
 * profit, exactly like the Director's pricing engine —
 *   marginValue = engineRevenue − usdCost·(1 − taxRebate)
 * so an undiscounted generated line reads back the typed margin.
 */
export function componentMargin(
  engineRevenue: number,
  usdCost: number,
  taxRebate: number
): { marginValue: number; marginPct: number } {
  const effectiveCost = usdCost * (1 - Math.max(0, Number(taxRebate) || 0));
  const marginValue = engineRevenue - effectiveCost;
  return {
    marginValue,
    marginPct: engineRevenue > 0 ? (marginValue / engineRevenue) * 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export type ComponentKey =
  | "product"
  | "pole"
  | "freight"
  | "insurance"
  | "additional_charges"
  | "commission"
  | "manufacturing_adders";

export type ProfitComponent = {
  key: ComponentKey;
  /** Client-facing revenue attributed to this component (USD). */
  revenue: number;
  /** Cost in USD. null = unknown/not tracked. */
  cost: number | null;
  /** Profit in USD. null when cost is unknown or the row is pure pass-through. */
  marginValue: number | null;
  /** Margin % of the component's own (engine) revenue. null when unknowable. */
  marginPct: number | null;
  health: ProfitHealth | null;
  /** False = data source absent (e.g. manufacturing adders — not tracked yet). */
  available: boolean;
  /** True when some of this component's lines have no usable cost. */
  costMissing?: boolean;
};

/**
 * Audit trace (owner, 2026-07-08): every figure in the drawer must say WHERE
 * it comes from — table/record, formula, and a clickable link to the source.
 * Built by the server loader (it knows the row ids); rides inside the
 * capability-gated result, so it never reaches a non-manager browser.
 */
export type TraceSource = {
  label: string;
  href?: string | null;
  detail?: string | null;
};

export type ProfitabilityTrace = {
  /** The winning quotation used for every revenue figure. */
  sellingPrice: TraceSource;
  product?: { sources: TraceSource[]; formula: string } | null;
  pole?: { sources: TraceSource[]; formula: string } | null;
  freight?: TraceSource | null;
  insurance?: TraceSource | null;
  charges?: {
    items: { label: string; amount: number }[];
    href?: string | null;
  } | null;
  /** Live calculation basis (pricing settings at compute time). */
  basis: { exchangeRate: number; taxRebate: number };
};

export type AffairProfitability = {
  ok: true;
  leadingDoc: {
    id: string;
    number?: string | null;
    version: number;
    status: string;
    type?: string | null;
  };
  currency: "USD";
  grandTotal: number;
  totalCost: number | null;
  grossProfit: number | null;
  overallPct: number | null;
  overallHealth: ProfitHealth | null;
  /** True when some cost is unknown — overall shown with an asterisk. */
  partial: boolean;
  components: ProfitComponent[];
  /** Populated by the server loader — see ProfitabilityTrace. */
  trace?: ProfitabilityTrace | null;
  /**
   * m153 auto-suggestion (loader-computed): set when overall health is RED
   * and the approved costing is older than the company aging threshold —
   * "margins look low and the costing is old; request a cost revision".
   */
  revisionHint?: { ageDays: number; srId: string | null } | null;
};

export type ProfitabilityUnavailable = {
  ok: false;
  reason: "no_document" | "non_usd" | "no_lines";
};

export type ProfitabilityResult = AffairProfitability | ProfitabilityUnavailable;

export type ComputeInput = {
  docs: Array<
    LeadDocCandidate & {
      number?: string | null;
      commission_amount?: number | null;
      insurance_cost?: number | null;
      additional_charges?: Array<{ amount?: unknown }> | null;
      freight_cost?: number | null;
    }
  >;
  /** Lines of the LEADING doc (the loader fetches after picking). */
  lines: ProfitLine[];
  /** Containers of the leading doc. */
  containers: DocumentContainer[];
  /** Per-SR pricing/cost info, keyed by project_request id. */
  srById: Map<string, SrPricingInfo>;
  /** Current catalogue cost RMB per product id (≤0 rows must be omitted). */
  catalogueCostRmb: Map<string, number>;
  /** Live engine settings (loadPricingSettings). */
  settings: { exchangeRate: number; taxRebate: number };
  thresholds?: ProfitThresholds;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fallback SR for legacy lines with no source_project_request_id: safe only
 * when the affair has EXACTLY ONE costed SR (several = variants; summing or
 * picking one would double-count / guess).
 */
export function soleSr(
  srById: Map<string, SrPricingInfo>
): { id: string; sr: SrPricingInfo } | null {
  const costed = Array.from(srById.entries()).filter(
    ([, s]) => s.productCostRmb != null || s.poleCostRmb != null
  );
  return costed.length === 1 ? { id: costed[0][0], sr: costed[0][1] } : null;
}

export function computeAffairProfitability(
  input: ComputeInput
): ProfitabilityResult {
  const leading = pickLeadingDoc(input.docs);
  if (!leading) return { ok: false, reason: "no_document" };
  if ((leading.currency ?? "USD") !== "USD")
    return { ok: false, reason: "non_usd" };
  if (!input.lines.length && !input.containers.length)
    return { ok: false, reason: "no_lines" };

  const X = Number(input.settings.exchangeRate) || 0;
  const rebate = Number(input.settings.taxRebate) || 0;
  const toUsd = (rmb: number) => (X > 0 ? rmb / X : 0);
  const thresholds = input.thresholds ?? PROFITABILITY_DEFAULT_THRESHOLDS;
  const fallbackSr = soleSr(input.srById);

  // ---- bucket the lines --------------------------------------------------
  type Bucket = {
    revenue: number; // client-facing
    engineRevenue: number; // commission-stripped
    usdCost: number;
    costMissing: boolean;
    commissionCollected: number;
  };
  const bucket = (): Bucket => ({
    revenue: 0,
    engineRevenue: 0,
    usdCost: 0,
    costMissing: false,
    commissionCollected: 0,
  });
  const product = bucket();
  const pole = bucket();
  let unclassifiedRevenue = 0;

  for (const line of input.lines) {
    const srId = line.source_project_request_id ?? null;
    const sr = srId ? input.srById.get(srId) ?? null : fallbackSr?.sr ?? null;
    const kind = classifyLine(line, sr);
    const revenue = Number(line.total_price) || 0;
    if (kind === "unclassified") {
      unclassifiedRevenue += revenue;
      continue;
    }
    const b = kind === "product" ? product : pole;
    b.revenue += revenue;

    const isSrLine =
      line.pricing_source === "approved_service_request" ||
      (line.pricing_source == null && srId != null);
    if (isSrLine && sr) {
      const cPct =
        kind === "product" ? sr.productCommissionPct : sr.poleCommissionPct;
      const engine = stripCommission(revenue, cPct);
      b.engineRevenue += engine;
      b.commissionCollected += revenue - engine;
      const costRmb = kind === "product" ? sr.productCostRmb : sr.poleCostRmb;
      if (costRmb != null && costRmb > 0) {
        b.usdCost += toUsd(costRmb) * Math.max(0, Number(line.quantity) || 0);
      } else {
        b.costMissing = true;
      }
    } else if (kind === "product" && line.product_id) {
      b.engineRevenue += revenue; // doc-level commission on builder docs
      const rmb = input.catalogueCostRmb.get(line.product_id);
      if (rmb != null && rmb > 0) {
        b.usdCost += toUsd(rmb) * Math.max(0, Number(line.quantity) || 0);
      } else {
        b.costMissing = true; // includes the cost_rmb=0 default trap (m084)
      }
    } else {
      // manual free-text / custom pole with no SR: revenue known, cost not.
      b.engineRevenue += revenue;
      b.costMissing = true;
    }
  }

  // ---- pass-throughs & freight -------------------------------------------
  // BUSINESS RULE (owner, 2026-07-08): transport NEVER generates margin.
  // Freight is an external cost re-invoiced to the client; even when the
  // billed amount differs from the real carrier cost, that difference must
  // NOT flow into any profitability KPI. So freight is a pure pass-through
  // in ALL the margin math (cost ≡ billed amount); its revenue still sits in
  // the grand total, diluting the overall % — which is exactly the point.
  const freightRevenue = input.containers.length
    ? freightTotalOf(input.containers)
    : Number(leading.freight_cost || 0);

  const insurance = Number(leading.insurance_cost || 0);
  const charges = (leading.additional_charges ?? []).reduce(
    (s, c) => s + (Number((c as any)?.amount) || 0),
    0
  );
  const docCommission = Number(leading.commission_amount || 0);
  const commissionTotal =
    docCommission + product.commissionCollected + pole.commissionCollected;

  // ---- grand total (RECOMPUTED — total_price can be stale, m149) ----------
  const linesRevenue =
    product.revenue + pole.revenue + unclassifiedRevenue;
  const grandTotal = r2(
    linesRevenue + freightRevenue + docCommission + insurance + charges
  );

  // ---- components ----------------------------------------------------------
  const mk = (
    key: ComponentKey,
    b: Bucket
  ): ProfitComponent => {
    if (b.revenue <= 0) {
      return {
        key,
        revenue: 0,
        cost: null,
        marginValue: null,
        marginPct: null,
        health: null,
        available: false,
      };
    }
    if (b.costMissing) {
      return {
        key,
        revenue: r2(b.revenue),
        cost: null,
        marginValue: null,
        marginPct: null,
        health: null,
        available: true,
        costMissing: true,
      };
    }
    const { marginValue, marginPct } = componentMargin(
      b.engineRevenue,
      b.usdCost,
      rebate
    );
    return {
      key,
      revenue: r2(b.revenue),
      cost: r2(b.usdCost),
      marginValue: r2(marginValue),
      marginPct,
      health: healthFor(marginPct, thresholds),
      available: true,
    };
  };

  const productC = mk("product", product);
  const poleC = mk("pole", pole);

  const passthrough = (key: ComponentKey, amount: number): ProfitComponent => ({
    key,
    revenue: r2(amount),
    cost: r2(amount),
    marginValue: null,
    marginPct: null,
    health: null,
    available: amount > 0,
  });

  // Transport = pure pass-through by BUSINESS RULE (never margin — see above).
  const freightC = passthrough("freight", freightRevenue);

  const components: ProfitComponent[] = [
    productC,
    poleC,
    freightC,
    passthrough("insurance", insurance),
    passthrough("additional_charges", charges),
    // Commission: collected from the client AND paid out — net zero profit.
    {
      key: "commission",
      revenue: r2(commissionTotal),
      cost: r2(commissionTotal),
      marginValue: null,
      marginPct: null,
      health: null,
      available: commissionTotal > 0,
    },
    // Owner decision 2026-07-07: engine slot ready, entry UI later.
    {
      key: "manufacturing_adders",
      revenue: 0,
      cost: null,
      marginValue: null,
      marginPct: null,
      health: null,
      available: false,
    },
  ];

  // ---- overall --------------------------------------------------------------
  // Freight/insurance/charges/commission are pass-throughs: they dilute the
  // overall % via the grand total but NEVER contribute margin (owner rule).
  const partial =
    !!productC.costMissing || !!poleC.costMissing || unclassifiedRevenue > 0;
  const knownMargin =
    (productC.marginValue ?? 0) + (poleC.marginValue ?? 0);
  const haveAnyMargin =
    productC.marginValue != null || poleC.marginValue != null;
  const overallPct =
    haveAnyMargin && grandTotal > 0 ? (knownMargin / grandTotal) * 100 : null;

  const knownCost =
    (productC.cost ?? 0) +
    (poleC.cost ?? 0) +
    freightRevenue +
    insurance +
    charges +
    commissionTotal;

  return {
    ok: true,
    leadingDoc: {
      id: leading.id,
      number: leading.number ?? null,
      version: leading.version ?? 1,
      status: leading.status,
      type: leading.type ?? null,
    },
    currency: "USD",
    grandTotal,
    totalCost: partial ? null : r2(knownCost),
    grossProfit: haveAnyMargin ? r2(knownMargin) : null,
    overallPct,
    overallHealth: overallPct != null ? healthFor(overallPct, thresholds) : null,
    partial,
    components,
  };
}

// ---------------------------------------------------------------------------
// Waterfall bridge — turn an engine result into the replayable MoneyState of
// lib/profitability-history. Engine revenues are reconstructed EXACTLY by
// inverting the margin algebra when the cost is known
// (engineRevenue = marginValue + usdCost·(1−r)); when the cost is unknown the
// client revenue stands in (commission-free assumption — the honest best).
// ---------------------------------------------------------------------------

export type MoneyStateLike = {
  productEngineRevenue: number;
  poleEngineRevenue: number;
  productUsdCost: number | null;
  poleUsdCost: number | null;
  /** Pass-through by business rule — dilutes the %, never contributes margin. */
  freightRevenue: number;
  insurance: number;
  charges: number;
  commission: number;
  unclassifiedRevenue: number;
  taxRebate: number;
};

export function deriveMoneyState(
  p: AffairProfitability,
  taxRebate: number
): MoneyStateLike {
  const by = (k: ComponentKey) => p.components.find((c) => c.key === k)!;
  const goods = (c: ProfitComponent) =>
    c.marginValue != null && c.cost != null
      ? c.marginValue + c.cost * (1 - taxRebate)
      : c.revenue;
  const product = by("product");
  const pole = by("pole");
  const freight = by("freight");
  const insurance = by("insurance");
  const charges = by("additional_charges");
  const commission = by("commission");
  const knownRevenue =
    product.revenue +
    pole.revenue +
    freight.revenue +
    insurance.revenue +
    charges.revenue +
    commission.revenue;
  return {
    productEngineRevenue: goods(product),
    poleEngineRevenue: goods(pole),
    productUsdCost: product.cost,
    poleUsdCost: pole.cost,
    freightRevenue: freight.revenue,
    insurance: insurance.revenue,
    charges: charges.revenue,
    commission: commission.revenue,
    unclassifiedRevenue: Math.max(0, r2(p.grandTotal - knownRevenue)),
    taxRebate,
  };
}
