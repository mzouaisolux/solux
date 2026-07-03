"use server";

/**
 * Quick Update — granular single-cell save.
 *
 * This action ONLY writes neutral, side-effect-free shipment fields (the
 * `EDITABLE_FIELDS` whitelist in lib/quick-update-columns). Everything with a
 * workflow side effect keeps going through its existing bundle action, so the
 * auto-advance / baseline-lock / BL-gate logic is never bypassed or duplicated:
 *
 *   - status                 → updateProductionOrderStatus
 *   - deposit / balance / due → updateProductionOrderPayments   (Payment popover)
 *   - shipment_booked         → updateProductionOrderShipment    (BL gate)
 *   - deadlines / delays      → updateProductionOrderDeadline …  (Timeline popover)
 *
 * The client imports those directly from ../orders/actions; this file adds only
 * the fast-path cell writer used for inline ETA/carrier/booking/notes/etc.
 */

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { normalizeShippingDetails } from "@/lib/shipping";
import { EDITABLE_FIELDS } from "@/lib/quick-update-columns";

const FIELD_LABEL: Record<string, string> = {
  etd: "ETD",
  eta: "ETA",
  shipping_notes: "Notes",
  bl_number: "BL#",
  forwarder: "Carrier",
  vessel: "Vessel",
  voyage: "Voyage",
  hs_code: "HS code",
  booking_number: "Booking#",
  container_number: "Container#",
  tracking_url: "Tracking",
  gross_weight: "Gross wt",
  net_weight: "Net wt",
  cbm: "CBM",
  packages: "Packages",
};

function normStr(v: FormDataEntryValue | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function normNum(v: FormDataEntryValue | null): number | null {
  const s = normStr(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fmt(v: unknown): string {
  return v == null || v === "" ? "—" : String(v);
}

/**
 * Update a single whitelisted cell.
 * FormData: { id, field, value }.
 * Scalars write their column directly; blob keys read-modify-write the
 * `shipping_details` jsonb so sibling keys are never wiped.
 */
export async function updateOrderCell(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const field = String(formData.get("field") ?? "");
  if (!id) throw new Error("Missing production order id");

  const meta = EDITABLE_FIELDS[field];
  if (!meta) throw new Error(`Field is not editable here: ${field}`);
  await requireCapability(meta.capability);

  const raw = formData.get("value");
  const supabase = createClient();

  const now = new Date().toISOString();
  let before: unknown = null;
  let after: unknown = null;

  if (meta.kind === "scalar") {
    // `field` is a whitelisted column name (etd | eta | shipping_notes) — safe
    // to interpolate into the select.
    const { data: prev } = await supabase
      .from("production_orders")
      .select(field)
      .eq("id", id)
      .maybeSingle();
    before = (prev as Record<string, unknown> | null)?.[field] ?? null;
    after = normStr(raw);
    const { error } = await supabase
      .from("production_orders")
      .update({ [field]: after, updated_at: now })
      .eq("id", id);
    if (error) throw new Error(error.message);
  } else {
    // blob-str / blob-num — merge into shipping_details (never overwrite siblings).
    const { data: prev } = await supabase
      .from("production_orders")
      .select("shipping_details")
      .eq("id", id)
      .maybeSingle();
    const details = normalizeShippingDetails(prev?.shipping_details ?? null);
    before = (details as Record<string, unknown>)[field] ?? null;
    after = meta.kind === "blob-num" ? normNum(raw) : normStr(raw);
    const merged = { ...details, [field]: after };
    const { error } = await supabase
      .from("production_orders")
      .update({ shipping_details: merged, updated_at: now })
      .eq("id", id);
    // Defensive (mirrors the core shipment action): a pre-m070 DB without the
    // column shouldn't hard-fail the whole save.
    if (
      error &&
      !/shipping_details|column .* does not exist/i.test(error.message ?? "")
    ) {
      throw new Error(error.message);
    }
  }

  // Light audit trail — reuse the shipment_updated type so the existing feed /
  // notification consumers pick it up consistently. bestEffort: never block the
  // save on the audit write.
  if ((before ?? null) !== (after ?? null)) {
    await emitEvent({
      entity_type: "production_order",
      entity_id: id,
      event_type: "po.shipment_updated",
      message: `Shipment updated: ${FIELD_LABEL[field] ?? field} ${fmt(before)} → ${fmt(after)}`,
      payload: { field, from: before ?? null, to: after ?? null, via: "quick_update" },
      bestEffort: true,
    });
  }

  // NOTE: deliberately do NOT revalidate /production/quick-update itself — the
  // client holds optimistic state, and re-running this page's wide fetch on
  // every cell commit would defeat the "instant" feel. We still refresh the
  // surfaces that only re-render on navigation.
  revalidatePath("/operations");
  revalidatePath(`/production/orders/${id}`);
  revalidatePath("/dashboard");
}
