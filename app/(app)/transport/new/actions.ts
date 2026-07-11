"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import {
  isTransportTablesMissing,
  transportKindLabel,
  TRANSPORT_MIGRATION_HINT,
  type TransportRequestKind,
} from "@/lib/transport-request";

export type TransportRequestInput = {
  kind: TransportRequestKind;
  affairId: string;
  clientId: string | null;
  destinationCountry: string | null;
  destinationPort: string | null;
  portOfLoading: string | null;
  deliveryAddress: string | null;
  incoterm: string | null;
  transportMode: string | null;
  notes: string | null;
  reason: string | null;
  sourceDocumentId: string | null;
  previousRequestId: string | null;
  lines: Array<{
    product_id: string | null;
    category_id: string | null;
    product_name: string | null;
    client_product_name: string | null;
    quantity: number;
    config_values: Record<string, string>;
    position: number;
  }>;
};

/**
 * Create a Transport Request (m161). Mirrors the m149 action shape:
 * capability gate → one-open-request guard → insert parent + lines →
 * event → revalidate. The affair is MANDATORY (core rule) — the wizard
 * never auto-creates one.
 */
export async function createTransportRequest(
  input: TransportRequestInput
): Promise<{ id: string }> {
  await requireCapability("shipping.request_update");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  if (!input.affairId) throw new Error("A project (affair) is required.");
  const linesRequired = input.kind === "packing_list" || input.kind === "price";
  if (linesRequired && input.lines.length === 0) {
    throw new Error(
      "Add at least one product line — Operations can't quote an empty shipment."
    );
  }

  // One open request per (affair, kind) — mirrors m149's per-document guard
  // so the Operations queue never splits the same question across threads.
  const { data: open, error: openErr } = await supabase
    .from("transport_requests")
    .select("id")
    .eq("affair_id", input.affairId)
    .eq("kind", input.kind)
    .in("status", ["waiting", "in_progress"])
    .limit(1);
  if (openErr) {
    if (isTransportTablesMissing(openErr)) throw new Error(TRANSPORT_MIGRATION_HINT);
    throw new Error(openErr.message);
  }
  if ((open ?? []).length > 0) {
    throw new Error(
      `An open ${transportKindLabel(input.kind)} already exists for this project — Operations is on it. Cancel it first to submit a new one.`
    );
  }

  const { data: inserted, error: insErr } = await supabase
    .from("transport_requests")
    .insert({
      kind: input.kind,
      affair_id: input.affairId,
      client_id: input.clientId,
      destination_country: input.destinationCountry,
      destination_port: input.destinationPort,
      port_of_loading: input.portOfLoading,
      delivery_address: input.deliveryAddress,
      incoterm: input.incoterm,
      transport_mode: input.transportMode,
      notes: input.notes,
      reason: input.reason,
      source_document_id: input.sourceDocumentId,
      previous_request_id: input.previousRequestId,
      requested_by: user.id,
    })
    .select("id")
    .single();
  if (insErr) {
    if (isTransportTablesMissing(insErr)) throw new Error(TRANSPORT_MIGRATION_HINT);
    throw new Error(insErr.message);
  }

  if (input.lines.length > 0) {
    const { error: linesErr } = await supabase
      .from("transport_request_lines")
      .insert(
        input.lines.map((l) => ({
          transport_request_id: inserted!.id,
          product_id: l.product_id,
          category_id: l.category_id,
          product_name: l.product_name,
          client_product_name: l.client_product_name,
          quantity: l.quantity,
          config_values: l.config_values ?? {},
          position: l.position,
        }))
      );
    if (linesErr) throw new Error(linesErr.message);
  }

  await emitEvent({
    entity_type: "affair",
    entity_id: input.affairId,
    event_type: "transport.requested",
    message: `${transportKindLabel(input.kind)} submitted — ${
      input.lines.length
    } line${input.lines.length === 1 ? "" : "s"}${
      input.destinationPort || input.destinationCountry
        ? ` → ${input.destinationPort || input.destinationCountry}`
        : ""
    }`,
    payload: {
      transport_request_id: inserted!.id,
      kind: input.kind,
      lines_count: input.lines.length,
      incoterm: input.incoterm,
      destination: input.destinationPort || input.destinationCountry,
    },
    bestEffort: true,
  });

  revalidatePath(`/affairs/${input.affairId}`);
  revalidatePath("/operations/transport-requests");
  return { id: inserted!.id };
}
