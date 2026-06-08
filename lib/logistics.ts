import {
  containerTypeLabel,
  type DocumentContainer,
  type ProductionMode,
  type ProductionTime,
} from "./types";

/** Per-row line total: (qty × unit) + wooden box (LCL only, 0 otherwise). */
export function containerLineTotal(c: DocumentContainer): number {
  const freight = Number(c.quantity || 0) * Number(c.unit_price || 0);
  const box =
    c.container_type === "LCL" ? Number(c.wooden_box_cost || 0) : 0;
  return freight + box;
}

export function totalFreight(containers: DocumentContainer[]): number {
  return containers.reduce((sum, c) => sum + containerLineTotal(c), 0);
}

/**
 * Aggregate container lines into a display breakdown for the document view
 * and PDF. Wooden box packaging is rendered as a separate sub-line for
 * LCL rows so the customer sees it explicitly.
 *
 * Example:
 *   [
 *     { line: "LCL / Groupage", total: 850 },
 *     { line: "Wooden box packaging", total: 120, indented: true },
 *     { line: "2 × 40ft HC", total: 6400 },
 *   ]
 */
export function containerBreakdown(
  containers: DocumentContainer[]
): Array<{ line: string; total: number; indented?: boolean }> {
  const out: Array<{ line: string; total: number; indented?: boolean }> = [];
  for (const c of containers.filter((c) => c.quantity > 0)) {
    const freight = Number(c.quantity) * Number(c.unit_price);
    const label =
      c.container_type === "LCL"
        ? c.quantity === 1
          ? containerTypeLabel("LCL")
          : `${c.quantity} × ${containerTypeLabel("LCL")}`
        : `${c.quantity} × ${c.container_type}`;
    out.push({ line: label, total: freight });
    if (c.container_type === "LCL" && Number(c.wooden_box_cost || 0) > 0) {
      out.push({
        line: "Wooden box packaging",
        total: Number(c.wooden_box_cost || 0),
        indented: true,
      });
    }
  }
  return out;
}

export function formatProductionTime(
  pt: ProductionTime | null | undefined
): string | null {
  if (!pt || !pt.mode) return null;
  if (pt.mode === "working_days" && pt.days) {
    return `Production time: ${pt.days} working day${pt.days === 1 ? "" : "s"}`;
  }
  if (pt.mode === "calendar_days" && pt.days) {
    return `Production time: ${pt.days} calendar day${
      pt.days === 1 ? "" : "s"
    }`;
  }
  if (pt.mode === "fixed_date" && pt.date) {
    return `Estimated completion: ${pt.date}`;
  }
  return null;
}

/**
 * PDF-facing production timing for the SALES TERMS section.
 *
 * Returns BOTH a `label` and a `value` so the PDF can render them in
 * the same `label : value` row pattern as the rest of the section.
 * The label CHANGES based on the mode to match how export buyers
 * actually phrase this in international trade documents:
 *
 *   working_days / calendar_days → "Estimated Production Lead Time"
 *     value: "35 days after deposit reception"
 *
 *   fixed_date                   → "Estimated Production Completion"
 *     value: "29 May 2026" (UK day-month-year, no leading zero)
 *
 * Why two labels (instead of one with a clever value)
 * ---------------------------------------------------
 * "Estimated Production Lead Time: 29 May 2026" reads wrong — a lead
 * time is a duration, not a date. Same the other way round. The
 * label has to follow the data semantics.
 *
 * The in-app UI keeps using the shorter `formatProductionTime`; this
 * helper is intentionally PDF-only.
 */
export function formatProductionTimeForPDF(
  pt: ProductionTime | null | undefined
): { label: string; value: string } | null {
  if (!pt || !pt.mode) return null;
  if (pt.mode === "working_days" && pt.days) {
    return {
      label: "Estimated Production Lead Time",
      value: `${pt.days} working day${pt.days === 1 ? "" : "s"} after deposit reception`,
    };
  }
  if (pt.mode === "calendar_days" && pt.days) {
    return {
      label: "Estimated Production Lead Time",
      value: `${pt.days} day${pt.days === 1 ? "" : "s"} after deposit reception`,
    };
  }
  if (pt.mode === "fixed_date" && pt.date) {
    return {
      label: "Estimated Production Completion",
      value: formatHumanDate(pt.date),
    };
  }
  return null;
}

/** Format an ISO-like date as "29 May 2026" — premium export style. */
function formatHumanDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/**
 * Render warranty as a human string. Accepts the raw integer count of
 * years (3 / 5 / 10 / custom). Returns null when nothing is set.
 */
export function formatWarrantyYears(
  years: number | null | undefined
): string | null {
  if (years == null || years <= 0) return null;
  return `${years} year${years === 1 ? "" : "s"} on all components`;
}

/**
 * Render an "Offer validity" line. The wording is intentionally aligned
 * with what export buyers expect: "30 days from date of issuance".
 *
 * `kind` lets us produce slightly different copy for products vs
 * transport — the latter is more volatile so we mention freight market.
 */
export function formatOfferValidity(
  days: number | null | undefined,
  kind: "products" | "transport"
): string | null {
  if (days == null || days <= 0) return null;
  if (kind === "products") {
    return `${days} day${days === 1 ? "" : "s"} from date of issuance`;
  }
  // Transport line includes a small clarifier so the customer sees
  // why this window is shorter than the product validity.
  return `${days} day${days === 1 ? "" : "s"} — subject to freight market`;
}

export function validateProductionTime(
  pt: ProductionTime | null | undefined
): string | null {
  if (!pt || !pt.mode) return null; // optional
  if (pt.mode === "working_days" || pt.mode === "calendar_days") {
    if (!pt.days || pt.days < 0) return "Enter a positive number of days";
  } else if (pt.mode === "fixed_date") {
    if (!pt.date) return "Select a date";
  }
  return null;
}

// Normalize to DB columns.
export function toProductionColumns(pt: ProductionTime | null) {
  if (!pt || !pt.mode) {
    return {
      production_mode: null as ProductionMode | null,
      production_days: null as number | null,
      production_date: null as string | null,
    };
  }
  return {
    production_mode: pt.mode,
    production_days:
      pt.mode === "fixed_date" ? null : pt.days ?? null,
    production_date: pt.mode === "fixed_date" ? pt.date ?? null : null,
  };
}

export function fromProductionColumns(row: {
  production_mode?: ProductionMode | null;
  production_days?: number | null;
  production_date?: string | null;
}): ProductionTime | null {
  if (!row.production_mode) return null;
  return {
    mode: row.production_mode,
    days: row.production_days ?? null,
    date: row.production_date ?? null,
  };
}
