/**
 * "Why did the margin change?" — the profitability waterfall (pure, tested).
 *
 * Reconstructs the affair's OVERALL margin % over time from the dated
 * old→new records the app already keeps:
 *   - quotation VERSIONS (each version doc has its own lines → exact selling
 *     snapshots; a drop reads as "Revised — negotiation/discount"),
 *   - doc.updated events (grand_total series → "Quotation edited"; the split
 *     is approximated proportionally — disclosed in the UI),
 *   - completed shipping updates m149 (old→new freight/insurance + reason),
 *   - factory cost audits m091 (old→new RMB, Director's reason),
 *   - SR freight audits m098 and catalogue cost history m086.
 *
 * Mechanism: the CURRENT state is the only fully-known one; every source
 * records an old→new transition. So we walk BACKWARDS from now, recording the
 * margin at each point, then UNDO that point's change to obtain the state
 * just before it — and finally reverse the list. Overall-only in v1
 * (per-component replay multiplies edge cases for little management value).
 *
 * Known, disclosed gaps: exchange-rate/tax-rebate history is not kept
 * (settings held constant); commission-% edits surface only through totals.
 *
 * Dependency-free (node --experimental-strip-types test runner: no value
 * imports). Never argless `new Date()`.
 */

export type WaterfallCause =
  | "initial"
  | "revised" // new quotation version (negotiation / discount)
  | "edited" // intra-version edit (doc.updated total change)
  | "shipping_update" // m149 completed (freight/insurance old→new, dilution only)
  | "factory_cost" // m091 audit (product/pole RMB old→new)
  | "catalogue_cost"; // m086 cost_rmb_history

export type WaterfallStep = {
  at: string; // ISO
  overallPct: number | null;
  cause: WaterfallCause;
  /** Human line, e.g. "Transport updated — rate season (ops)". */
  detail: string;
  /** Signed pct-point change vs the previous step (null on the first). */
  deltaPct: number | null;
};

/**
 * The replayable money state. All USD aggregates for the LEADING doc's
 * lineage; the server loader converts RMB audits into aggregate transitions
 * (× qty ÷ exchange rate) before calling this pure module.
 */
export type MoneyState = {
  productEngineRevenue: number; // commission-stripped
  poleEngineRevenue: number;
  productUsdCost: number | null; // null = unknown → pct null (honest)
  poleUsdCost: number | null;
  /**
   * BUSINESS RULE (owner, 2026-07-08): transport never generates margin —
   * it is an external cost re-invoiced as-is. Freight revenue only DILUTES
   * the overall % through the grand total.
   */
  freightRevenue: number;
  insurance: number;
  charges: number;
  /** doc-level commission + Σ stripped SR commission (client-facing). */
  commission: number;
  unclassifiedRevenue: number;
  taxRebate: number;
};

/** Overall % for a state — same algebra as lib/profitability (goods only). */
export function overallPctOf(s: MoneyState): number | null {
  const clientGoods =
    s.productEngineRevenue + s.poleEngineRevenue + s.commission;
  const grandTotal =
    clientGoods +
    s.unclassifiedRevenue +
    s.freightRevenue +
    s.insurance +
    s.charges;
  if (grandTotal <= 0) return null;
  if (s.productUsdCost == null && s.poleUsdCost == null) return null;
  const goodsMargin =
    (s.productUsdCost != null
      ? s.productEngineRevenue - s.productUsdCost * (1 - s.taxRebate)
      : 0) +
    (s.poleUsdCost != null
      ? s.poleEngineRevenue - s.poleUsdCost * (1 - s.taxRebate)
      : 0);
  return (goodsMargin / grandTotal) * 100;
}

/**
 * One dated change. `undo(state)` returns the state as it was BEFORE the
 * change (the backward step). Collectors build these from old→new records:
 * undo simply re-applies the OLD values.
 */
export type WaterfallPoint = {
  at: string;
  cause: WaterfallCause;
  detail: string;
  undo: (s: MoneyState) => MoneyState;
};

const t = (iso: string): number => {
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
};

/**
 * Build the waterfall. `current` is today's fully-known state; `points` are
 * the dated transitions (any order). Returns chronological steps, first =
 * earliest reconstructed state ("initial"), last = current. Caps at `cap`
 * most-recent points (older history collapses into the initial step).
 */
export function buildWaterfall(
  current: MoneyState,
  points: WaterfallPoint[],
  cap = 30
): WaterfallStep[] {
  const sorted = [...points].sort((a, b) => t(b.at) - t(a.at)); // newest first
  const kept = sorted.slice(0, Math.max(0, cap));

  // Backward pass: margin AT each point, then undo to go further back.
  let state = current;
  const backward: Array<Omit<WaterfallStep, "deltaPct">> = [];
  for (const p of kept) {
    backward.push({
      at: p.at,
      overallPct: overallPctOf(state),
      cause: p.cause,
      detail: p.detail,
    });
    state = p.undo(state);
  }
  const initial: Omit<WaterfallStep, "deltaPct"> = {
    at: kept.length ? kept[kept.length - 1].at : "",
    overallPct: overallPctOf(state),
    cause: "initial",
    detail: "Initial pricing",
  };

  const chrono = [initial, ...backward.reverse()];
  return chrono.map((s, i) => {
    const prev = i > 0 ? chrono[i - 1].overallPct : null;
    const deltaPct =
      i > 0 && prev != null && s.overallPct != null
        ? s.overallPct - prev
        : null;
    return { ...s, deltaPct };
  });
}

// ---------------------------------------------------------------------------
// Point constructors — tiny, pure; the server loader feeds them from rows.
// ---------------------------------------------------------------------------

/**
 * m149 completed shipping update: doc freight/insurance old→new + reason.
 * Freight moves the % ONLY through grand-total dilution (never margin —
 * owner rule 2026-07-08).
 */
export function shippingUpdatePoint(row: {
  completed_at: string;
  previous_freight_cost: number | null;
  new_freight_cost: number | null;
  previous_insurance_cost: number | null;
  new_insurance_cost: number | null;
  reason?: string | null;
}): WaterfallPoint {
  return {
    at: row.completed_at,
    cause: "shipping_update",
    detail: `Transport updated${row.reason ? ` — ${row.reason}` : ""}`,
    undo: (s) => ({
      ...s,
      // Freight revenue tracks the doc rewrite (m149 rewrites containers).
      freightRevenue:
        row.previous_freight_cost != null
          ? Number(row.previous_freight_cost)
          : s.freightRevenue,
      insurance:
        row.previous_insurance_cost != null
          ? Number(row.previous_insurance_cost)
          : s.insurance,
    }),
  };
}

/** m091 factory cost audit: product/pole RMB old→new (loader pre-converts to USD aggregates). */
export function factoryCostPoint(row: {
  changed_at: string;
  field: string; // 'product_cost_rmb' | 'pole_cost_rmb'
  oldUsdAggregate: number | null;
  reason?: string | null;
}): WaterfallPoint {
  const which = row.field === "pole_cost_rmb" ? "Pole" : "Product";
  return {
    at: row.changed_at,
    cause: "factory_cost",
    detail: `${which} factory cost changed${row.reason ? ` — ${row.reason}` : ""}`,
    undo: (s) =>
      row.field === "pole_cost_rmb"
        ? { ...s, poleUsdCost: row.oldUsdAggregate }
        : { ...s, productUsdCost: row.oldUsdAggregate },
  };
}

/** m086 catalogue cost change for one product (loader pre-converts). */
export function catalogueCostPoint(row: {
  at: string;
  productName?: string | null;
  oldProductUsdAggregate: number | null;
}): WaterfallPoint {
  return {
    at: row.at,
    cause: "catalogue_cost",
    detail: `Catalogue cost updated${row.productName ? ` — ${row.productName}` : ""}`,
    undo: (s) => ({ ...s, productUsdCost: row.oldProductUsdAggregate }),
  };
}

/**
 * A new quotation VERSION: the loader computes the exact selling snapshot of
 * the PREVIOUS version (its own lines/containers) — undo restores it whole.
 */
export function versionPoint(row: {
  at: string;
  version: number;
  previousSelling: Pick<
    MoneyState,
    | "productEngineRevenue"
    | "poleEngineRevenue"
    | "freightRevenue"
    | "insurance"
    | "charges"
    | "commission"
    | "unclassifiedRevenue"
  >;
}): WaterfallPoint {
  return {
    at: row.at,
    cause: "revised",
    detail: `Revised to V${row.version} — negotiation / discount`,
    undo: (s) => ({ ...s, ...row.previousSelling }),
  };
}

/**
 * Intra-version edit (doc.updated): only the grand total is known. The goods
 * split is scaled PROPORTIONALLY (approximation, disclosed in the UI).
 */
export function editPoint(row: {
  at: string;
  oldGrandTotal: number;
  newGrandTotal: number;
}): WaterfallPoint {
  return {
    at: row.at,
    cause: "edited",
    detail: "Quotation edited",
    undo: (s) => {
      const passthrough = s.freightRevenue + s.insurance + s.charges;
      const goodsNow =
        s.productEngineRevenue +
        s.poleEngineRevenue +
        s.commission +
        s.unclassifiedRevenue;
      const goodsOld = Math.max(0, Number(row.oldGrandTotal) - passthrough);
      const k = goodsNow > 0 ? goodsOld / goodsNow : 1;
      return {
        ...s,
        productEngineRevenue: s.productEngineRevenue * k,
        poleEngineRevenue: s.poleEngineRevenue * k,
        commission: s.commission * k,
        unclassifiedRevenue: s.unclassifiedRevenue * k,
      };
    },
  };
}
