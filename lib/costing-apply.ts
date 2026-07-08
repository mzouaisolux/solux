/**
 * Selective "apply newer costing" math (m140) — pure and unit-tested. When the
 * Director approves a newer costing version, Sales may EXPLICITLY choose what
 * to update on a draft quotation (product pricing / pole pricing / freight /
 * transport assumptions). This module owns the line-level and totals math; the
 * server action only orchestrates DB reads/writes around it.
 *
 * Safety rule: NEVER guess which approved price a line takes. Resolution order
 * is source_component (stamped at generation, m140) → category_id heuristic
 * (product lines carry the SR family; poles don't, m133) → exact price match
 * against the PREVIOUS approved prices → refuse ('ambiguous'). A refusal
 * aborts the whole apply with a clear message — a wrong silent price would be
 * the exact class of bug Phase 1 exists to prevent.
 */

// Value imports carry the .ts extension so the node --experimental-strip-types
// test runner accepts them (type-only imports are erased and safe either way).
// applyDiscount below stays a MIRROR — keep in sync with its source.
import type { DiscountType, DocumentContainer } from "./types";
import {
  documentGrandTotal,
  type DocumentTotalParts,
} from "./document-total.ts";
import { totalFreight } from "./logistics.ts";

/** MIRROR of lib/pricing applyDiscount — keep in sync. */
function applyDiscount(
  original: number,
  type: DiscountType | null,
  value: number
): number {
  if (!type || !value || value <= 0) return original;
  if (type === "percentage") return Math.max(0, original * (1 - value / 100));
  return Math.max(0, original - value);
}

export type LineComponent = "product" | "pole";

/** The slice of a document line the apply math needs (all persisted cols). */
export type ApplyLine = {
  id: string;
  pricing_source?: string | null;
  source_project_request_id?: string | null;
  source_component?: string | null;
  category_id?: string | null;
  quantity: number;
  original_unit_price: number;
  discount_type: DiscountType | null;
  discount_value: number;
};

/** The slice of a costing version the apply math needs. */
export type ApplyVersion = {
  id: string;
  product_unit_price: number | null;
  pole_unit_price: number | null;
  previous_product_unit_price: number | null;
  previous_pole_unit_price: number | null;
  approved_by: string | null;
  approved_at: string | null;
  containers?: unknown;
  incoterm?: string | null;
  port_of_destination?: string | null;
};

export type ApplySelections = {
  product?: boolean;
  pole?: boolean;
  freight?: boolean;
  transport?: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Price-match tolerance when falling back to previous-approved comparison. */
const PRICE_MATCH_EPS = 0.005;

/**
 * Which approved price does this line take? See module doc for the order.
 * `version` provides the PREVIOUS approved prices for the last-resort match
 * (the line still carries the old price at apply time).
 */
export function resolveLineComponent(
  line: Pick<
    ApplyLine,
    "source_component" | "category_id" | "original_unit_price"
  >,
  version: Pick<
    ApplyVersion,
    "previous_product_unit_price" | "previous_pole_unit_price"
  >
): LineComponent | "ambiguous" {
  if (line.source_component === "product" || line.source_component === "pole") {
    return line.source_component;
  }
  // m133: the SR family is stamped on the PRODUCT line only; poles are
  // deliberately category-less (borrowing the family would inject the wrong
  // config fields).
  if (line.category_id != null) return "product";
  const prev = Number(line.original_unit_price);
  const prevProduct = version.previous_product_unit_price;
  const prevPole = version.previous_pole_unit_price;
  const matchesProduct =
    prevProduct != null && Math.abs(prev - Number(prevProduct)) <= PRICE_MATCH_EPS;
  const matchesPole =
    prevPole != null && Math.abs(prev - Number(prevPole)) <= PRICE_MATCH_EPS;
  if (matchesProduct && !matchesPole) return "product";
  if (matchesPole && !matchesProduct) return "pole";
  return "ambiguous";
}

export type LineUpdate = {
  id: string;
  original_unit_price: number;
  unit_price: number;
  total_price: number;
  approved_by: string | null;
  approved_at: string | null;
};

export type ApplyLinesResult =
  | { ok: true; updates: LineUpdate[] }
  | { ok: false; error: string };

/**
 * Compute the line updates for the SELECTED components. Only locked
 * SR-sourced lines are candidates; each keeps its own quantity and discount
 * (the discount is a commercial decision — re-applied on the new approved
 * unit price, same as ProductConfigurator's locked commit). Lines whose
 * component is not selected are left untouched. Refuses on ambiguity or on a
 * selected component whose new price is missing.
 */
export function applySelectionsToLines(
  lines: ApplyLine[],
  version: ApplyVersion,
  selections: ApplySelections
): ApplyLinesResult {
  const updates: LineUpdate[] = [];
  for (const line of lines) {
    if (line.pricing_source !== "approved_service_request") continue;
    if (!line.source_project_request_id) continue;
    const component = resolveLineComponent(line, version);
    if (component === "ambiguous") {
      return {
        ok: false,
        error:
          "One line can't be safely matched to the new costing (product vs pole is ambiguous). Update it manually in the builder instead.",
      };
    }
    if (!selections[component]) continue;
    const newUnit =
      component === "product"
        ? version.product_unit_price
        : version.pole_unit_price;
    if (newUnit == null) {
      return {
        ok: false,
        error: `The new costing has no ${component} price — nothing to apply for that item.`,
      };
    }
    const original = round2(Number(newUnit));
    const unit = round2(
      applyDiscount(original, line.discount_type, line.discount_value)
    );
    updates.push({
      id: line.id,
      original_unit_price: original,
      unit_price: unit,
      total_price: round2(unit * Math.max(0, Number(line.quantity) || 0)),
      approved_by: version.approved_by ?? null,
      approved_at: version.approved_at ?? null,
    });
  }
  return { ok: true, updates };
}

/**
 * Parse a version's `containers` jsonb snapshot into document-container rows.
 * The snapshot is stored ALREADY MAPPED to the document vocabulary
 * ({container_type, quantity, unit_price, wooden_box_cost}) at approval time.
 * Invalid/absent snapshots yield [] — the caller treats that as "freight not
 * applicable" and hides the checkbox.
 */
export function versionContainers(version: ApplyVersion): DocumentContainer[] {
  const raw = version.containers;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c: any) => ({
      container_type: c?.container_type,
      quantity: Math.max(0, Math.round(Number(c?.quantity ?? 0))),
      unit_price: Math.max(0, Number(c?.unit_price ?? 0)),
      wooden_box_cost: Math.max(0, Number(c?.wooden_box_cost ?? 0)),
    }))
    .filter((c) => c.container_type && c.quantity > 0) as DocumentContainer[];
}

/**
 * Recompute the document's derived money columns after line/freight changes.
 * Delegates to documentGrandTotal (lib/document-total.ts) — the canonical,
 * tested mirror of saveDocument's builder math — so an apply lands on the
 * exact figure a Sales re-save would store:
 *   items_total = Σ line.total_price (ALL lines, updated values included)
 *   freight     = Σ container lines (qty × unit + LCL wooden box)…
 *                 …or the legacy freight_cost scalar when no container rows
 *   commission  = commissionAmount(items + freight)  — depends on the subtotal,
 *                 so it MUST be rewritten alongside total_price
 *   total_price = items + freight + commission + m146 extras (insurance +
 *                 additional charges — added AFTER commission, never its base)
 * No rounding: the builder persists unrounded figures, and a 1¢ drift is the
 * total ≠ breakdown mismatch fixed 2026-07-08 in completeShippingUpdate.
 */
export function recomputeDocTotals(input: {
  lineTotals: number[];
  containers: DocumentContainer[];
  legacyFreightCost?: number | null;
  commission_enabled?: boolean | null;
  commission_percentage?: number | null;
  insurance_cost?: DocumentTotalParts["insuranceCost"];
  additional_charges?: DocumentTotalParts["additionalCharges"];
}): {
  items_total: number;
  freight_total: number;
  commission_amount: number;
  shipping_extras: number;
  total_price: number;
} {
  const items_total = input.lineTotals.reduce((s, t) => s + Number(t || 0), 0);
  const freight_total = input.containers.length
    ? totalFreight(input.containers)
    : Number(input.legacyFreightCost || 0);
  const totals = documentGrandTotal({
    itemsTotal: items_total,
    freightTotal: freight_total,
    commission: {
      enabled: !!input.commission_enabled,
      percentage: Number(input.commission_percentage || 0),
    },
    insuranceCost: input.insurance_cost,
    additionalCharges: input.additional_charges,
  });
  return {
    items_total,
    freight_total,
    commission_amount: totals.commission_amount,
    shipping_extras: totals.shipping_extras,
    total_price: totals.grand_total,
  };
}
