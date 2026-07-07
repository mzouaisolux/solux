// =====================================================================
// Shipping status — batch server loader (m149 Lot 2).
//
// Given a set of document ids, returns the compact "Shipping Status" each
// surface renders (detail card, quotation list, client documents…). ONE
// pair of queries for the whole set — never per-row — so a list of N
// documents stays two round-trips, not 2N.
//
// Soft-fail: if the shipping_update_requests table isn't there yet
// (pre-m149), the freight-freshness signal STILL works (it's derived from
// the document's own freight/quote date); only the request button + update
// history need the table (`available=false` hides them).
// =====================================================================

import type { createClient } from "@/lib/supabase/server";
import { totalFreight } from "@/lib/logistics";
import { quoteAgeDays } from "@/lib/shipping-update";

export type ShippingStatusLite = {
  documentId: string;
  /** shipping_update_requests table present → request button + history on. */
  available: boolean;
  currentFreight: number;
  currentInsurance: number | null;
  destination: string | null;
  incoterm: string | null;
  portOfLoading: string | null;
  /** The document's own quote date (baseline when never refreshed). */
  quoteDate: string | null;
  /** Latest completed refresh, else the quote date. Drives the age badge. */
  lastUpdateDate: string | null;
  /** The completed refresh before the last one (for "Previous update"). */
  previousUpdateDate: string | null;
  /** Whole days since lastUpdateDate (null when no date at all). */
  ageDays: number | null;
  /** A waiting/in-progress request already exists for this document. */
  hasOpenRequest: boolean;
  /** Number of completed refreshes so far. */
  updateCount: number;
};

/**
 * Load shipping status for every id in `docIds`. `now` is injected so
 * callers can pass a stable clock; defaults to the server's current time.
 */
export async function loadShippingStatuses(
  supabase: ReturnType<typeof createClient>,
  docIds: string[],
  now: Date = new Date()
): Promise<Map<string, ShippingStatusLite>> {
  const out = new Map<string, ShippingStatusLite>();
  const ids = Array.from(new Set(docIds.filter(Boolean)));
  if (ids.length === 0) return out;

  // Document baseline (freight / destination / incoterm / date).
  const { data: docs } = await supabase
    .from("documents")
    .select("id, date, freight_cost, insurance_cost, incoterm, port_of_destination, port_of_loading")
    .in("id", ids);

  // Container rows — effective freight when the doc prices per container.
  const { data: containerRows } = await supabase
    .from("document_containers")
    .select("document_id, container_type, quantity, unit_price, wooden_box_cost")
    .in("document_id", ids);
  const containersByDoc = new Map<string, any[]>();
  for (const c of containerRows ?? []) {
    const list = containersByDoc.get(c.document_id) ?? [];
    list.push(c);
    containersByDoc.set(c.document_id, list);
  }

  // Completed refreshes + any open request. One query; soft-fail pre-m149.
  const bySur = new Map<string, { completed: string[]; open: boolean }>();
  let available = false;
  const surRes = await supabase
    .from("shipping_update_requests")
    .select("document_id, status, completed_at")
    .in("document_id", ids)
    .order("completed_at", { ascending: false });
  if (!surRes.error) {
    available = true;
    for (const r of surRes.data ?? []) {
      const e = bySur.get(r.document_id) ?? { completed: [], open: false };
      if (r.status === "completed" && r.completed_at) e.completed.push(r.completed_at);
      if (r.status === "waiting" || r.status === "in_progress") e.open = true;
      bySur.set(r.document_id, e);
    }
  }

  for (const d of docs ?? []) {
    const containers = containersByDoc.get(d.id) ?? [];
    const currentFreight = containers.length
      ? totalFreight(containers)
      : Number(d.freight_cost) || 0;
    const sur = bySur.get(d.id) ?? { completed: [], open: false };
    // completed[] is newest-first (query order).
    const lastUpdateDate = sur.completed[0] ?? d.date ?? null;
    const previousUpdateDate = sur.completed[1] ?? (sur.completed[0] ? d.date : null);
    out.set(d.id, {
      documentId: d.id,
      available,
      currentFreight,
      currentInsurance: d.insurance_cost ?? null,
      destination: d.port_of_destination ?? null,
      incoterm: d.incoterm ?? null,
      portOfLoading: d.port_of_loading ?? null,
      quoteDate: d.date ?? null,
      lastUpdateDate,
      previousUpdateDate,
      ageDays: quoteAgeDays(lastUpdateDate, now),
      hasOpenRequest: sur.open,
      updateCount: sur.completed.length,
    });
  }
  return out;
}
