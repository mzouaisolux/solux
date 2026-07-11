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
