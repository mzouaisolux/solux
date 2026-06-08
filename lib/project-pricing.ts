/**
 * Project Request pricing math (m090) — pure, deterministic, no side effects.
 *
 * The Sales Director enters a selling price per unit; the factory cost per unit
 * comes from the Factory Cost Request. From those + quantity we derive the
 * after-the-fact margin and the total project value shown in the pricing card
 * and folded into the generated quotation.
 *
 *   marginPerUnit    = sellingPrice − cost
 *   marginPct        = marginPerUnit / sellingPrice         (fraction 0–1)
 *   marginValueTotal = marginPerUnit * quantity
 *   totalProjectValue= sellingPrice * quantity
 */

export type ProjectMarginInput = {
  costPerUnit?: number | null;
  sellingPricePerUnit?: number | null;
  quantity?: number | null;
};

export type ProjectMargins = {
  marginPerUnit: number;
  /** 0–1 fraction; multiply by 100 for a percentage. */
  marginPct: number;
  marginValueTotal: number;
  totalProjectValue: number;
};

export function computeProjectMargins(input: ProjectMarginInput): ProjectMargins {
  const cost = Number(input.costPerUnit ?? 0);
  const price = Number(input.sellingPricePerUnit ?? 0);
  const qty = Math.max(0, Number(input.quantity ?? 0));

  const marginPerUnit = price - cost;
  const marginPct = price > 0 ? marginPerUnit / price : 0;
  return {
    marginPerUnit,
    marginPct,
    marginValueTotal: marginPerUnit * qty,
    totalProjectValue: price * qty,
  };
}

/** Format a fraction as a percentage string, e.g. 0.27 → "27.0%". */
export function fmtMarginPct(frac: number, decimals = 1): string {
  return `${(frac * 100).toFixed(decimals)}%`;
}

/**
 * Auto-generate a commercial description for a Project Product from the
 * project's name + category + technical specs (m095). Pure / import-free so it
 * stays testable. Example:
 *   "AOSPRO+ — Cotonou Phase 2 · LED 60W · Panel 120W · Battery 12.8V 60Ah ·
 *    Controller MPPT 20A · Pole 8m · IoT"
 */
export function buildCommercialDescription(
  p: {
    name?: string | null;
    led_power?: string | null;
    solar_panel_size?: string | null;
    battery_spec?: string | null;
    controller?: string | null;
    pole_height?: string | null;
    arm_length?: string | null;
    iot_required?: boolean | null;
  },
  categoryName?: string | null
): string {
  const head = [categoryName?.trim(), p.name?.trim()].filter(Boolean).join(" — ");
  const specs = [
    p.led_power && `LED ${p.led_power}`,
    p.solar_panel_size && `Panel ${p.solar_panel_size}`,
    p.battery_spec && `Battery ${p.battery_spec}`,
    p.controller && `Controller ${p.controller}`,
    p.pole_height && `Pole ${p.pole_height}`,
    p.arm_length && `Arm ${p.arm_length}`,
    p.iot_required ? "IoT" : null,
  ].filter(Boolean);
  if (head && specs.length) return `${head} · ${specs.join(" · ")}`;
  if (head) return head;
  return specs.join(" · ") || (p.name?.trim() ?? "Project product");
}

// ===========================================================================
// V1 — Product / Pole section pricing. Uses the SAME back-calculation as the
// pricing engine (lib/pricing-engine.ts tierResult — the single source of the
// formula): price = usdCost·(1−taxRebate)/(1−margin). The formula is inlined
// here (not imported) only to keep this module dependency-free so it stays
// pure + unit-testable under the node test runner; it is intentionally
// identical to computePricing. Commission is then folded on top per
// lib/commission semantics (commission increases the customer-facing price).
// Product and Pole are computed independently (different margins/commissions).
// ===========================================================================

export type SectionPriceInput = {
  costRmb?: number | null;
  exchangeRate: number;
  taxRebate: number; // fraction 0–1
  marginPct?: number | null; // 0–100
  commissionPct?: number | null; // 0–100
};

export type SectionPrice = {
  usdCost: number;
  rebatePerUnit: number; // export rebate $ per unit (usdCost × taxRebate)
  enginePrice: number; // engine selling price before commission
  commissionPerUnit: number;
  finalUnitPrice: number; // enginePrice + commission (what the customer pays)
  marginValuePerUnit: number; // after-tax profit $ per unit (= enginePrice − usdCost + rebate); matches the typed margin %
  marginPct: number; // 0–1; equals the typed target margin m
};

export function computeSectionPrice(input: SectionPriceInput): SectionPrice {
  const costRmb = Number(input.costRmb ?? 0);
  const exchangeRate = Number(input.exchangeRate || 0);
  const taxRebate = Number(input.taxRebate ?? 0);
  const m = Math.min(0.99, Math.max(0, Number(input.marginPct ?? 0) / 100));
  // Identical to lib/pricing-engine.ts tierResult / computePricing.
  const usdCost = exchangeRate > 0 ? costRmb / exchangeRate : 0;
  const denom = 1 - m;
  const enginePrice = denom > 0 ? (usdCost * (1 - taxRebate)) / denom : 0;
  const commissionPct = Math.max(0, Number(input.commissionPct ?? 0));
  const commissionPerUnit = enginePrice * (commissionPct / 100);
  const rebatePerUnit = usdCost * taxRebate;
  // After-tax profit per unit — the export rebate counts toward it, so
  // marginValuePerUnit / enginePrice exactly equals the target margin m.
  const marginValuePerUnit = enginePrice - usdCost + rebatePerUnit;
  return {
    usdCost,
    rebatePerUnit,
    enginePrice,
    commissionPerUnit,
    finalUnitPrice: enginePrice + commissionPerUnit,
    marginValuePerUnit,
    marginPct: enginePrice > 0 ? marginValuePerUnit / enginePrice : 0,
  };
}

export type ProjectTotalInput = {
  productUnit: number;
  poleUnit: number;
  quantity: number;
  freightTotal?: number;
  includeProduct?: boolean;
  includePole?: boolean;
  includeFreight?: boolean;
};

// Freight breakdown (m097): per-container-type rows derived from the packing
// list; total = sum(quantity × freight_per_unit). Pure + import-free.
export type FreightLine = { type?: string; quantity?: number | null; freight_per_unit?: number | null };

export function computeFreightTotal(lines: FreightLine[] | null | undefined): number {
  return (lines ?? []).reduce(
    (sum, l) => sum + Math.max(0, Number(l.quantity ?? 0)) * Math.max(0, Number(l.freight_per_unit ?? 0)),
    0
  );
}

// ===========================================================================
// Freight → quotation Shipping section (no migration). Project freight is a
// per-container-type breakdown using PROJECT_CONTAINER_TYPES
// (20GP/40GP/40HQ/LCL). The quotation document's Shipping section uses a
// different container vocabulary (ContainerType: 20ft/40ft/40ft HC/LCL). When
// generating a project quotation we move freight OUT of the product lines and
// INTO Shipping — so these helpers translate one to the other. Pure /
// import-free so they stay unit-testable. The document container types are
// returned as plain string literals (assignable to lib/types ContainerType).
// ===========================================================================

export type DocumentContainerKind = "LCL" | "20ft" | "40ft" | "40ft HC";

/** Map a PROJECT_CONTAINER_TYPES value to the quotation document ContainerType. */
export function projectContainerToDocumentType(type?: string | null): DocumentContainerKind {
  const t = String(type ?? "").trim().toUpperCase();
  if (t === "20GP" || t === "20FT") return "20ft";
  if (t === "40GP" || t === "40FT") return "40ft";
  if (t === "40HQ" || t === "40HC" || t === "40FT HC") return "40ft HC";
  if (t === "LCL") return "LCL";
  return "40ft HC"; // sensible default — project types are constrained, so unreached in practice
}

export type ShippingContainer = {
  container_type: DocumentContainerKind;
  quantity: number;
  unit_price: number; // freight cost per container (pass-through)
  wooden_box_cost: number;
};

/**
 * Build the quotation Shipping rows from a project freight breakdown
 * (FreightContainer[] = {type, quantity, freight_per_unit}). Each row becomes
 * a document container: type mapped, quantity preserved, unit_price = the
 * freight cost per container. Rows with no quantity are dropped. The document's
 * freight total then equals sum(quantity × unit_price) — identical to the old
 * single freight line, but shown as Logistics instead of a Product line.
 */
export function buildShippingContainersFromFreight(
  lines: FreightLine[] | null | undefined
): ShippingContainer[] {
  return (lines ?? [])
    .map((l) => ({
      container_type: projectContainerToDocumentType(l.type),
      quantity: Math.max(0, Math.round(Number(l.quantity ?? 0))),
      unit_price: Math.max(0, Number(l.freight_per_unit ?? 0)),
      wooden_box_cost: 0,
    }))
    .filter((c) => c.quantity > 0);
}

export type PackingLine = { type?: string | null; quantity?: number | null };

/**
 * Build the quotation Shipping rows the way the spec intends: container TYPES +
 * QUANTITIES come from the Packing List (the single source of truth), and the
 * freight COST per container comes from the Freight breakdown (matched by
 * container type). When the packing list is empty we fall back to the freight
 * breakdown's own rows so freight still appears. Pure / import-free.
 */
export function buildShippingContainers(
  packing: PackingLine[] | null | undefined,
  freight: FreightLine[] | null | undefined
): ShippingContainer[] {
  // freight cost per (normalized) container type
  const costByType = new Map<string, number>();
  for (const f of freight ?? []) {
    const key = String(f.type ?? "").trim().toUpperCase();
    const rate = Math.max(0, Number(f.freight_per_unit ?? 0));
    if (key && !costByType.has(key)) costByType.set(key, rate);
  }
  const source: PackingLine[] =
    packing && packing.length ? packing : (freight ?? []).map((f) => ({ type: f.type, quantity: f.quantity }));
  return source
    .map((c) => {
      const key = String(c.type ?? "").trim().toUpperCase();
      return {
        container_type: projectContainerToDocumentType(c.type),
        quantity: Math.max(0, Math.round(Number(c.quantity ?? 0))),
        unit_price: costByType.get(key) ?? 0,
        wooden_box_cost: 0,
      };
    })
    .filter((c) => c.quantity > 0);
}

export function computeProjectTotal(args: ProjectTotalInput): {
  product: number;
  pole: number;
  freight: number;
  total: number;
} {
  const qty = Math.max(0, Number(args.quantity || 0));
  const product = (args.includeProduct ?? true) ? Number(args.productUnit || 0) * qty : 0;
  const pole = (args.includePole ?? false) ? Number(args.poleUnit || 0) * qty : 0;
  const freight = (args.includeFreight ?? false) ? Number(args.freightTotal || 0) : 0;
  return { product, pole, freight, total: product + pole + freight };
}
