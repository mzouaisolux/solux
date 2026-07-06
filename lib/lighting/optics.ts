/**
 * Approved Optics — production synthesis (pure).
 *
 * The business need (owner 2026-07-05) is NOT a raw value like "T35 + T38" but
 * a production breakdown: HOW MANY distinct optics, and HOW MANY luminaires on
 * each — e.g. "T35 → 3 luminaires · T38 → 3 luminaires".
 *
 * The m144 column `approved_optics` stays a TEXT column (zero migration): this
 * module is the single serialization point between the structured breakdown
 * the UI edits and the canonical string production reads:
 *
 *     [{optic:"T35", quantity:3}, {optic:"T38", quantity:3}]  ⇄  "T35 ×3 + T38 ×3"
 *
 * Quantities are optional (a manual project may not know them yet): an entry
 * without quantity serializes as just the optic name. Legacy values ("Type
 * III", "T35 + T38") parse losslessly into entries with null quantities.
 */

import type { DialuxConfiguration } from "./types.ts";

export type OpticEntry = {
  optic: string;
  /** Luminaire count for this optic — null when unknown. */
  quantity: number | null;
};

/** Serialize the breakdown into the canonical `approved_optics` string. */
export function formatApprovedOptics(entries: OpticEntry[]): string {
  return entries
    .map((e) => ({ ...e, optic: e.optic.trim() }))
    .filter((e) => e.optic !== "")
    .map((e) =>
      e.quantity != null && Number.isFinite(e.quantity)
        ? `${e.optic} ×${e.quantity}`
        : e.optic
    )
    .join(" + ");
}

/**
 * Parse an `approved_optics` string back into the breakdown. Tolerant:
 * separators + , / ; quantity as "×3", "x3" or "(3)". Unrecognized text stays
 * as an optic name with no quantity — never throws, never loses the name.
 */
export function parseApprovedOptics(text: string | null | undefined): OpticEntry[] {
  const s = String(text ?? "").trim();
  if (!s) return [];
  return s
    .split(/[+,/]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m =
        part.match(/^(.*?)\s*[×x]\s*(\d+)$/i) ??
        part.match(/^(.*?)\s*\((\d+)\)$/);
      if (m && m[1].trim()) {
        return { optic: m[1].trim(), quantity: Number(m[2]) };
      }
      return { optic: part, quantity: null };
    });
}

/**
 * Aggregate the Dialux configurations into the production breakdown: one entry
 * per distinct optic, quantities summed across the configurations that use it.
 * A config with an unknown quantity poisons only its own optic's total (null =
 * "count unknown"), never the others. Order = first appearance in the report.
 */
export function aggregateDialuxOptics(
  configs: DialuxConfiguration[]
): OpticEntry[] {
  const order: string[] = [];
  const byOptic = new Map<string, { quantity: number | null; unknown: boolean }>();
  for (const c of configs) {
    const optic =
      c.optic_code ?? c.optic_beam_distribution ?? c.optic_lens_type;
    if (!optic) continue;
    const key = optic.trim();
    if (!byOptic.has(key)) {
      byOptic.set(key, { quantity: 0, unknown: false });
      order.push(key);
    }
    const agg = byOptic.get(key)!;
    if (c.quantity == null || !Number.isFinite(c.quantity)) {
      agg.unknown = true;
    } else {
      agg.quantity = (agg.quantity ?? 0) + c.quantity;
    }
  }
  return order.map((optic) => {
    const agg = byOptic.get(optic)!;
    return {
      optic,
      quantity: agg.unknown ? null : agg.quantity,
    };
  });
}

/** Case-insensitive equality of two breakdowns (order-sensitive — the report's
 *  order is meaningful to production). */
export function sameOpticsBreakdown(a: OpticEntry[], b: OpticEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (e, i) =>
      e.optic.trim().toLowerCase() === b[i].optic.trim().toLowerCase() &&
      (e.quantity ?? null) === (b[i].quantity ?? null)
  );
}
