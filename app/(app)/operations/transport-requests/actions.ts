"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import {
  isTransportTablesMissing,
  transportKindLabel,
  TRANSPORT_MIGRATION_HINT,
} from "@/lib/transport-request";

function fail(err: { code?: string | null; message?: string | null }): never {
  if (isTransportTablesMissing(err)) throw new Error(TRANSPORT_MIGRATION_HINT);
  throw new Error(err.message ?? "Transport request update failed");
}

async function loadRequest(supabase: any, id: string) {
  const { data, error } = await supabase
    .from("transport_requests")
    .select("id, kind, status, affair_id")
    .eq("id", id)
    .maybeSingle();
  if (error) fail(error);
  if (!data) throw new Error("Transport request not found.");
  return data as { id: string; kind: string; status: string; affair_id: string };
}

/** waiting → in_progress ("I'm on it"). */
export async function startTransportRequest(id: string): Promise<void> {
  await requireCapability("shipping.process_update");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const req = await loadRequest(supabase, id);
  if (req.status !== "waiting") throw new Error("Request is not waiting.");

  const { error } = await supabase
    .from("transport_requests")
    .update({
      status: "in_progress",
      started_by: user.id,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) fail(error);
  revalidatePath("/operations/transport-requests");
}

export type CompleteTransportInput = {
  id: string;
  freightCost: number | null;
  insuranceCost: number | null;
  additionalCharges: Array<{ label: string; amount: number }>;
  transitTimeDays: number | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  cbm: number | null;
  cartonsCount: number | null;
  palletsCount: number | null;
  containers: Array<{ container_type: string; quantity: number }>;
  validUntil: string | null;
  opsComments: string | null;
};

/**
 * Enter the results and complete the request. A completed price /
 * price_update row becomes a VERSION of the affair's transport price
 * history — never overwritten, a new request = a new row.
 */
export async function completeTransportRequest(
  input: CompleteTransportInput
): Promise<void> {
  await requireCapability("shipping.process_update");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const req = await loadRequest(supabase, input.id);
  if (req.status === "completed" || req.status === "cancelled") {
    throw new Error("Request is already closed.");
  }
  const isPrice = req.kind === "price" || req.kind === "price_update";
  if (isPrice && (input.freightCost == null || input.freightCost <= 0)) {
    throw new Error("Freight cost is required to complete a price request.");
  }
  if (!isPrice && input.cbm == null && input.grossWeightKg == null) {
    throw new Error(
      "Enter at least the CBM or the gross weight to complete a packing list."
    );
  }

  const { error } = await supabase
    .from("transport_requests")
    .update({
      status: "completed",
      freight_cost: input.freightCost,
      insurance_cost: input.insuranceCost,
      additional_charges: input.additionalCharges ?? [],
      transit_time_days: input.transitTimeDays,
      gross_weight_kg: input.grossWeightKg,
      net_weight_kg: input.netWeightKg,
      cbm: input.cbm,
      cartons_count: input.cartonsCount,
      pallets_count: input.palletsCount,
      containers: input.containers ?? [],
      valid_until: input.validUntil,
      ops_comments: input.opsComments,
      completed_by: user.id,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) fail(error);

  await emitEvent({
    entity_type: "affair",
    entity_id: req.affair_id,
    event_type: "transport.completed",
    message: `${transportKindLabel(req.kind)} completed${
      isPrice && input.freightCost != null
        ? ` — ${Number(input.freightCost).toLocaleString()} USD`
        : input.cbm != null
        ? ` — ${input.cbm} CBM`
        : ""
    }`,
    payload: {
      transport_request_id: req.id,
      kind: req.kind,
      freight_cost: input.freightCost,
      cbm: input.cbm,
    },
    bestEffort: true,
  });

  revalidatePath("/operations/transport-requests");
  revalidatePath(`/affairs/${req.affair_id}`);
}

/**
 * REOPEN a completed request (owner 2026-07-11) — the controlled correction
 * path QA round 1 proved missing (a wrongly-completed request was frozen
 * forever). Rules:
 *   - Operations / admin only (same capability as processing the queue —
 *     requireCapability passes admins through the anti-lockout floor);
 *   - a reason is mandatory (audit);
 *   - the FULL previous answer is snapshotted into the immutable event log
 *     (events RLS: INSERT-only) BEFORE anything changes — values are never
 *     lost, history stays intact;
 *   - the row keeps its entered values and returns to `in_progress`, so the
 *     completion form reopens pre-filled for correction. Completing again
 *     emits a fresh transport.completed — the audit trail reads
 *     completed → reopened (with snapshot) → completed.
 */
export async function reopenTransportRequest(
  id: string,
  reason: string
): Promise<void> {
  await requireCapability("shipping.process_update");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const cleanReason = (reason ?? "").trim();
  if (!cleanReason) throw new Error("A reason is required to reopen a request.");

  // Full row — the audit snapshot must preserve EVERY previous value.
  const { data: full, error: loadErr } = await supabase
    .from("transport_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) fail(loadErr);
  if (!full) throw new Error("Transport request not found.");
  if ((full as any).status !== "completed") {
    throw new Error("Only a completed request can be reopened.");
  }

  // 1. Immutable audit FIRST (NOT bestEffort): if the snapshot can't be
  //    written, the reopen must not happen — no silent value loss, ever.
  await emitEvent({
    entity_type: "affair",
    entity_id: (full as any).affair_id,
    event_type: "transport.reopened",
    message: `${transportKindLabel((full as any).kind)} reopened — ${cleanReason}`,
    payload: {
      transport_request_id: id,
      kind: (full as any).kind,
      reason: cleanReason,
      previous: {
        status: (full as any).status,
        freight_cost: (full as any).freight_cost,
        insurance_cost: (full as any).insurance_cost,
        additional_charges: (full as any).additional_charges,
        transit_time_days: (full as any).transit_time_days,
        gross_weight_kg: (full as any).gross_weight_kg,
        net_weight_kg: (full as any).net_weight_kg,
        cbm: (full as any).cbm,
        cartons_count: (full as any).cartons_count,
        pallets_count: (full as any).pallets_count,
        containers: (full as any).containers,
        valid_until: (full as any).valid_until,
        ops_comments: (full as any).ops_comments,
        completed_by: (full as any).completed_by,
        completed_at: (full as any).completed_at,
      },
    },
    bestEffort: false,
  });

  // 2. Back to in_progress — values KEPT so the form reopens pre-filled.
  const { error } = await supabase
    .from("transport_requests")
    .update({
      status: "in_progress",
      completed_by: null,
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "completed"); // concurrency: no-op if someone else moved it
  if (error) fail(error);

  revalidatePath("/operations/transport-requests");
  revalidatePath(`/affairs/${(full as any).affair_id}`);
}

export async function cancelTransportRequest(id: string): Promise<void> {
  await requireCapability("shipping.process_update");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const req = await loadRequest(supabase, id);
  if (req.status === "completed" || req.status === "cancelled") {
    throw new Error("Request is already closed.");
  }

  const { error } = await supabase
    .from("transport_requests")
    .update({
      status: "cancelled",
      cancelled_by: user.id,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) fail(error);

  await emitEvent({
    entity_type: "affair",
    entity_id: req.affair_id,
    event_type: "transport.cancelled",
    message: `${transportKindLabel(req.kind)} cancelled`,
    payload: { transport_request_id: req.id, kind: req.kind },
    bestEffort: true,
  });

  revalidatePath("/operations/transport-requests");
  revalidatePath(`/affairs/${req.affair_id}`);
}
