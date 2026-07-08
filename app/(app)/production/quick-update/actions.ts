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
import { getCurrentUserRole } from "@/lib/auth";
import { emitEvent } from "@/lib/events";
import { normalizeShippingDetails } from "@/lib/shipping";
import { todayISO } from "@/lib/working-days";
import { PRODUCTION_ORDER_STATUSES } from "@/lib/types";
import { EDITABLE_FIELDS } from "@/lib/quick-update-columns";

const FIELD_LABEL: Record<string, string> = {
  etd: "ETD",
  eta: "ETA",
  shipping_notes: "Notes",
  manual_total_price: "Order total",
  manual_deposit_percent: "Deposit %",
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

  if (meta.kind === "scalar" || meta.kind === "scalar-num") {
    // `field` is a whitelisted column name — safe to interpolate into the
    // select. scalar-num (manual money facts, m155) parses to a number.
    const { data: prev } = await supabase
      .from("production_orders")
      .select(field)
      .eq("id", id)
      .maybeSingle();
    before = (prev as Record<string, unknown> | null)?.[field] ?? null;
    after = meta.kind === "scalar-num" ? normNum(raw) : normStr(raw);
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

/**
 * Create a MANUAL production order (m155) — the Excel-transition entry point.
 *
 * Manual orders are real `production_orders` rows with NO quotation and NO
 * task list: they live in the same Quick Update table, carry the same
 * statuses/payments/shipping, and the pages fall back to the `manual_*`
 * columns where a workflow order would read its linked quotation. The core
 * workflow is untouched — `launchProduction` remains the ONLY path that
 * creates workflow orders, and this action can never link a quotation.
 *
 * FormData: { number*, client_id?, client_name?, sales_label?, total?,
 *             currency?, deposit_percent?, status?, production_due?, notes? }
 */
export async function createManualOrder(
  formData: FormData
): Promise<{ id: string }> {
  await requireCapability("production_order.create_manual");

  const number = normStr(formData.get("number"));
  if (!number) throw new Error("PO number is required");

  const status = normStr(formData.get("status")) ?? "awaiting_deposit";
  if (!(PRODUCTION_ORDER_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const clientId = normStr(formData.get("client_id"));
  const clientName = normStr(formData.get("client_name"));
  const salesLabel = normStr(formData.get("sales_label"));
  const total = normNum(formData.get("total"));
  const depositPct = normNum(formData.get("deposit_percent"));
  if (depositPct != null && (depositPct < 0 || depositPct > 100)) {
    throw new Error("Deposit % must be between 0 and 100");
  }
  const currency = normStr(formData.get("currency")) ?? "USD";
  const incoterm = normStr(formData.get("incoterm"));
  const productionDue = normStr(formData.get("production_due"));
  const notes = normStr(formData.get("notes"));

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();
  const today = todayISO();

  const { data: created, error } = await supabase
    .from("production_orders")
    .insert({
      number,
      quotation_id: null,
      task_list_id: null,
      client_id: clientId,
      source: "manual",
      manual_client_name: clientId ? null : clientName,
      manual_sales_label: salesLabel,
      manual_total_price: total,
      manual_currency: currency,
      manual_deposit_percent: depositPct,
      status,
      initial_production_deadline: productionDue,
      current_production_deadline: productionDue,
      // manual orders carry their incoterm in the shipping blob (workflow
      // orders read the quotation's — see lib/shipping.ts)
      shipping_details: incoterm ? { incoterm } : null,
      shipping_notes: notes,
      // entry date — keeps manual rows sorted naturally with workflow ones
      // (the list orders by production_validation_date desc).
      production_validation_date: today,
      created_by: userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error(
        `PO number "${number}" already exists — order numbers are unique across the whole order book.`
      );
    }
    // Pre-m155 database: columns/nullability missing → clear activation hint.
    if (
      error.code === "42703" ||
      error.code === "23502" ||
      /column .* does not exist|null value in column/i.test(error.message ?? "")
    ) {
      throw new Error(
        "Manual orders need migration 155_manual_production_orders.sql — apply it in the Supabase SQL editor first."
      );
    }
    throw new Error(error.message);
  }

  await emitEvent({
    entity_type: "production_order",
    entity_id: created.id,
    event_type: "po.created",
    message: `Manual order ${number} registered (Excel transition)`,
    payload: { via: "quick_update_manual", number, client_id: clientId ?? null },
    bestEffort: true,
  });

  revalidatePath("/production/quick-update");
  revalidatePath("/operations");
  revalidatePath("/dashboard");
  return { id: created.id };
}
