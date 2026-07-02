/**
 * Historical Invoice Import — shared, PURE types.
 *
 * No server-only deps here (no next/headers, no supabase). This module is
 * imported by the pure matchers/validator, by the unit tests, AND by client
 * components — keep it dependency-free and erasable under
 * `--experimental-strip-types`.
 *
 * The engine is designed generic from day one: `ImportDocType` already covers
 * the doc types the owner wants to add later (quotations, proformas, credit
 * notes, purchase orders, delivery notes) so the extractor/validator/store can
 * be reused with no redesign.
 */

export type ImportDocType =
  | "invoice"
  | "quotation"
  | "proforma"
  | "credit_note"
  | "purchase_order"
  | "delivery_note";

/** One line item as read off a source document. All numbers nullable — a
 *  field the extractor couldn't read confidently stays null (never guessed). */
export type ExtractedLine = {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  /** Absolute discount amount on the line, if the invoice prints one. */
  discount_amount: number | null;
  /** Discount as a percentage (0..100), if the invoice prints one instead. */
  discount_pct: number | null;
  tax_rate: number | null;
  tax_amount: number | null;
  /** The line total AS PRINTED (authoritative for reconciliation). */
  line_total: number | null;
};

export type ExtractedInvoice = {
  number: string | null;
  /** ISO yyyy-mm-dd when parseable, else the raw string, else null. */
  date: string | null;
  currency: string | null;
  detected_customer_name: string | null;
  subtotal: number | null;
  discount_total: number | null;
  tax_total: number | null;
  total_amount: number | null;
  notes: string | null;
  lines: ExtractedLine[];
};

/** Per-field self-reported confidence, 0..1, keyed by field name
 *  (e.g. "number", "date", "total_amount"). */
export type FieldConfidence = Record<string, number>;

export type ExtractionResult = {
  invoice: ExtractedInvoice;
  confidence: FieldConfidence;
  model?: string;
  /** Raw provider payload, kept for audit in extraction_meta. */
  raw?: unknown;
};

/** The fields we refuse to import silently when uncertain. */
export const CRITICAL_FIELDS = [
  "number",
  "date",
  "total_amount",
] as const;
export type CriticalField = (typeof CRITICAL_FIELDS)[number];
