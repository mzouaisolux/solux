// =====================================================================
// Pricing-integrity audit (feature #2, m168)
// =====================================================================
// After the Sales Director approves a pricing, document lines carry
// pricing_source='approved_service_request' (m139 lock). When Sales later
// modifies the product price, the transport price or a discount, nothing is
// blocked — but the change must be recorded (document_pricing_audit) and the
// Director notified (doc.approved_price_changed). This module is the PURE
// diff: old state vs new state → audit rows. Framework-free = unit-testable.
// =====================================================================

import { shouldEmitOnce } from "./notification-catalog.ts";

export const APPROVED_SOURCE = "approved_service_request";

export interface AuditableLine {
  unit_price: number | null;
  discount_type?: string | null;
  discount_value?: number | null;
  pricing_source?: string | null;
  source_project_request_id?: string | null;
  source_component?: string | null; // 'product' | 'pole' on SR lines
  client_product_name?: string | null;
  approved_by?: string | null;
}

export interface PricingAuditRow {
  field: string;
  line_label: string | null;
  old_value: number | null;
  new_value: number | null;
  pricing_source: string | null;
  approved_by: string | null;
}

const isApproved = (l: AuditableLine) => (l.pricing_source ?? null) === APPROVED_SOURCE;
// SR lines are unique per (request, component) within one document — match on
// that identity ONLY: the display name is mutable (attaching the catalogue
// model resets client_product_name) and must not break the pairing. Lines
// without an SR id fall back to the name.
const key = (l: AuditableLine) =>
  l.source_project_request_id
    ? `sr:${l.source_project_request_id}|${l.source_component ?? ""}`
    : `name:${(l.client_product_name ?? "").trim()}`;
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Diff the APPROVED pricing between the previous document state and the state
 * being saved. Returns [] when nothing protected changed. Also flags a
 * transport (freight) change when the document carries approved lines — the
 * freight on an SR-generated document is Operations' priced value.
 */
export function diffApprovedPricing(opts: {
  oldLines: AuditableLine[];
  newLines: AuditableLine[];
  oldFreight?: number | null;
  newFreight?: number | null;
}): PricingAuditRow[] {
  const out: PricingAuditRow[] = [];
  const oldApproved = (opts.oldLines ?? []).filter(isApproved);
  if (oldApproved.length === 0) return out; // nothing was approved → not our scope

  const newByKey = new Map<string, AuditableLine>();
  for (const l of opts.newLines ?? []) if (isApproved(l)) newByKey.set(key(l), l);

  for (const o of oldApproved) {
    const n = newByKey.get(key(o));
    const label = o.client_product_name ?? null;
    if (!n) {
      out.push({
        field: "line_removed",
        line_label: label,
        old_value: num(o.unit_price),
        new_value: null,
        pricing_source: o.pricing_source ?? null,
        approved_by: o.approved_by ?? null,
      });
      continue;
    }
    const oldUnit = num(o.unit_price);
    const newUnit = num(n.unit_price);
    if (oldUnit !== newUnit) {
      out.push({
        field: o.source_component === "pole" ? "pole_unit_price" : "product_unit_price",
        line_label: label,
        old_value: oldUnit,
        new_value: newUnit,
        pricing_source: o.pricing_source ?? null,
        approved_by: o.approved_by ?? null,
      });
    }
    const oldDisc = num(o.discount_value) ?? 0;
    const newDisc = num(n.discount_value) ?? 0;
    if (oldDisc !== newDisc) {
      out.push({
        field: "discount",
        line_label: label,
        old_value: oldDisc,
        new_value: newDisc,
        pricing_source: o.pricing_source ?? null,
        approved_by: o.approved_by ?? null,
      });
    }
  }

  // Transport price — audited on documents that carry approved lines.
  const oldF = num(opts.oldFreight);
  const newF = num(opts.newFreight);
  if (oldF !== null && newF !== null && oldF !== newF) {
    out.push({
      field: "freight_cost",
      line_label: null,
      old_value: oldF,
      new_value: newF,
      pricing_source: APPROVED_SOURCE,
      approved_by: oldApproved[0]?.approved_by ?? null,
    });
  }
  return out;
}

/** One-line human summary for the notification/event message. */
export function summarizePricingChanges(rows: PricingAuditRow[]): string {
  return rows
    .map((r) => {
      const what =
        r.field === "freight_cost"
          ? "Shipping"
          : r.field === "discount"
          ? `Discount${r.line_label ? ` (${r.line_label})` : ""}`
          : r.line_label ?? r.field;
      const fmt = (v: number | null) => (v == null ? "—" : String(v));
      return `${what}: ${fmt(r.old_value)} → ${fmt(r.new_value)}`;
    })
    .join(" · ");
}

// =====================================================================
// Notification anti-spam — coalesce successive post-approval changes
// =====================================================================
// A Sales user reworking a just-approved quote may save it many times in a
// row. Each save that touches an approved line emits doc.approved_price_changed
// → without grouping, the Sales Director's bell floods with one item per save.
// We fold successive changes to the SAME document into ONE running bell item:
// the first change emits the event, later changes within a window append to its
// thread (the bell already renders one item with an unread-comment count +
// latest-change preview, and re-surfaces it after read). This keeps the Director
// aware of EVERY change (nothing is dropped, unlike a pure debounce) with a
// single, quiet, always-current notification per document.

/**
 * Coalescing window (minutes) for post-approval price-change notifications.
 * 7 days comfortably spans an active re-pricing period; a change after that
 * starts a fresh notification (a genuinely new "occasion").
 */
export const PRICING_NOTIF_COALESCE_MINUTES = 7 * 24 * 60;

/**
 * Decide whether a post-approval price change should EMIT a fresh event or
 * APPEND to the most recent one (fold into the running digest). Pure — mirrors
 * shouldEmitOnce so the window semantics stay identical:
 *   - no recent event            → "emit"   (first change on this document)
 *   - recent within the window   → "append" (fold into the running digest)
 *   - recent older than window   → "emit"   (a new occasion)
 *   - unparseable timestamp      → "emit"   (never silently drop a real change)
 */
export function coalescePricingNotification(
  recentEventAtIso: string | null | undefined,
  nowIso: string,
  windowMinutes: number
): "emit" | "append" {
  if (!recentEventAtIso) return "emit";
  return shouldEmitOnce(recentEventAtIso, nowIso, windowMinutes) ? "emit" : "append";
}
