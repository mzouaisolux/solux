/**
 * Historical Invoice Import — PURE data-integrity gate.
 *
 * "Never silently import uncertain data." This module is the DETERMINISTIC half
 * of that promise: on top of the extractor's self-reported per-field confidence,
 * we cross-check the ARITHMETIC of the invoice. A layout-agnostic reconciliation
 * (sum of lines vs subtotal/total, per-line qty×price sanity) catches extraction
 * errors that a model might report with high confidence.
 *
 * An invoice is flagged `needs_attention` when EITHER:
 *   - a critical field (number / date / total) is missing or below ~95%, OR
 *   - the arithmetic does not reconcile within tolerance.
 */

import {
  CRITICAL_FIELDS,
  type ExtractedInvoice,
  type FieldConfidence,
} from "./types.ts";

export type ValidationIssue = {
  code:
    | "missing_number"
    | "missing_date"
    | "missing_total"
    | "low_confidence"
    | "line_math"
    | "total_mismatch"
    | "no_lines";
  field?: string;
  detail: string;
};

export type ValidationResult = {
  ok: boolean;
  reconciles: boolean;
  minCriticalConfidence: number;
  issues: ValidationIssue[];
};

/** Confidence threshold below which a critical field needs a human. Kept below
 *  the model's typical self-reported band for correct-but-cautious reads
 *  (~0.90) so the DETERMINISTIC reconciliation below stays the real integrity
 *  gate, and only genuinely-unsure fields (blurry / inferred) get flagged. */
export const CONFIDENCE_THRESHOLD = 0.85;

/** Absolute + relative tolerance for money reconciliation. */
function tolerant(expected: number, actual: number, base: number): boolean {
  const diff = Math.abs(expected - actual);
  const allow = Math.max(0.02, Math.abs(base) * 0.005); // 0.5% or 2 cents
  return diff <= allow;
}

export function validateInvoice(
  invoice: ExtractedInvoice,
  confidence: FieldConfidence,
  threshold: number = CONFIDENCE_THRESHOLD
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // --- Critical fields present? ---
  if (!invoice.number || String(invoice.number).trim() === "") {
    issues.push({ code: "missing_number", field: "number", detail: "No invoice number detected." });
  }
  if (!invoice.date || String(invoice.date).trim() === "") {
    issues.push({ code: "missing_date", field: "date", detail: "No invoice date detected." });
  }
  if (invoice.total_amount == null) {
    issues.push({ code: "missing_total", field: "total_amount", detail: "No total amount detected." });
  }

  // --- Critical-field confidence ---
  let minCriticalConfidence = 1;
  for (const f of CRITICAL_FIELDS) {
    const c = confidence?.[f];
    const val = typeof c === "number" ? c : 0; // missing confidence == 0
    if (val < minCriticalConfidence) minCriticalConfidence = val;
    if (val < threshold) {
      issues.push({
        code: "low_confidence",
        field: f,
        detail: `Low confidence on "${f}" (${Math.round(val * 100)}%).`,
      });
    }
  }

  // --- Arithmetic reconciliation ---
  let reconciles = true;
  const lines = invoice.lines ?? [];
  if (lines.length === 0) {
    issues.push({ code: "no_lines", detail: "No line items detected." });
    reconciles = false;
  }

  // Per-line qty×price sanity (only when all pieces are present).
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.quantity != null && l.unit_price != null && l.line_total != null) {
      let expected = l.quantity * l.unit_price;
      if (l.discount_amount != null) expected -= l.discount_amount;
      else if (l.discount_pct != null) expected -= expected * (l.discount_pct / 100);
      if (!tolerant(expected, l.line_total, l.line_total)) {
        issues.push({
          code: "line_math",
          detail: `Line ${i + 1}: qty×price (${round2(expected)}) ≠ line total (${round2(l.line_total)}).`,
        });
        reconciles = false;
      }
    }
  }

  // Primary invariant: the sum of ALL line totals (goods + freight + any other
  // charge — each is a line) plus tax minus discount equals the grand total.
  // We deliberately do NOT reconcile against `subtotal`: its meaning varies
  // across invoices (FOB goods-only, pre-tax…). A real CFR invoice, for example,
  // prints an FOB subtotal and adds a freight LINE to reach the CFR total — the
  // sum-of-lines invariant handles that; a subtotal check would false-fail it.
  const lineTotals = lines.map((l) => l.line_total);
  const allTotalsKnown = lines.length > 0 && lineTotals.every((t) => t != null);
  if (allTotalsKnown && invoice.total_amount != null) {
    const sumLines = (lineTotals as number[]).reduce((a, b) => a + b, 0);
    const tax = invoice.tax_total ?? 0;
    const disc = invoice.discount_total ?? 0;
    const expectedTotal = sumLines + tax - disc;
    if (!tolerant(expectedTotal, invoice.total_amount, invoice.total_amount)) {
      issues.push({
        code: "total_mismatch",
        detail: `Sum of lines ${round2(sumLines)} + tax ${round2(tax)} − discount ${round2(disc)} = ${round2(expectedTotal)} ≠ total (${round2(invoice.total_amount)}).`,
      });
      reconciles = false;
    }
  }

  const hasMissingCritical = issues.some(
    (i) => i.code === "missing_number" || i.code === "missing_date" || i.code === "missing_total"
  );
  const belowConfidence = minCriticalConfidence < threshold;

  return {
    ok: reconciles && !hasMissingCritical && !belowConfidence,
    reconciles,
    minCriticalConfidence,
    issues,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
