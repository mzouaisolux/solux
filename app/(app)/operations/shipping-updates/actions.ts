"use server";

/**
 * Shipping Rate Refresh (m149) — server actions for the doc-centric
 * freight update loop:
 *
 *   Sales  → createShippingUpdateRequest (modal on the document page)
 *   Ops    → startShippingUpdate / completeShippingUpdate / cancel
 *
 * Completion pushes the new costs onto the DOCUMENT the same way the m098
 * enterFreight sync does: per-container unit prices are updated so the
 * container breakdown, the page totals and the PDF all stay coherent;
 * insurance / additional charges use the m146 columns (with the same
 * retry-without-extras fallback). Like enterFreight, `total_price`
 * refreshes when Sales re-saves the document — shipping columns are the
 * single source the builder recomputes from.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import {
  containerLineTotal,
  normalizeAdditionalCharges,
  totalFreight,
} from "@/lib/logistics";
import {
  normalizeSnapshot,
  type ShippingSnapshot,
} from "@/lib/shipping-update";
import type { DocumentContainer } from "@/lib/types";

function reqStr(fd: FormData, key: string): string {
  const v = String(fd.get(key) ?? "").trim();
  if (!v) throw new Error(`Missing ${key}`);
  return v;
}
function optStr(fd: FormData, key: string): string | null {
  const v = String(fd.get(key) ?? "").trim();
  return v || null;
}
function numOrNull(fd: FormData, key: string): number | null {
  const raw = String(fd.get(key) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function revalidateBoth(documentId: string): void {
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/operations/shipping-updates");
}

/** Effective current freight of a document: containers when present, else flat. */
async function effectiveFreight(
  supabase: ReturnType<typeof createClient>,
  documentId: string,
  flat: number | null
): Promise<{ freight: number; containers: DocumentContainer[] }> {
  const { data } = await supabase
    .from("document_containers")
    .select("id, container_type, quantity, unit_price, wooden_box_cost")
    .eq("document_id", documentId);
  const containers = (data ?? []) as any[];
  return {
    freight: containers.length ? totalFreight(containers) : Number(flat) || 0,
    containers,
  };
}

// ---------------------------------------------------------------------------
// Sales: create the request (from the prefilled, editable modal)
// ---------------------------------------------------------------------------
export async function createShippingUpdateRequest(
  formData: FormData
): Promise<void> {
  await requireCapability("shipping.request_update");
  const documentId = reqStr(formData, "document_id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, number, date, freight_cost, insurance_cost, client_id, affair_id")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr || !doc) throw new Error("Document not found.");

  // One open request per document — a second ask would just split the thread.
  const { data: open } = await supabase
    .from("shipping_update_requests")
    .select("id")
    .eq("document_id", documentId)
    .in("status", ["waiting", "in_progress"])
    .limit(1);
  if (open && open.length) {
    throw new Error(
      "A shipping update is already in progress for this document — Operations has it in their queue."
    );
  }

  const snapshot: ShippingSnapshot = normalizeSnapshot(
    Object.fromEntries(
      Array.from(formData.entries())
        .filter(([k]) => k.startsWith("snap_"))
        .map(([k, v]) => [k.slice(5), String(v)])
    )
  );
  const reason = optStr(formData, "reason");
  const priorityRaw = optStr(formData, "priority");
  const priority = ["low", "normal", "high"].includes(priorityRaw ?? "")
    ? priorityRaw
    : "normal";

  const { freight } = await effectiveFreight(supabase, documentId, doc.freight_cost);

  const { error } = await supabase.from("shipping_update_requests").insert({
    document_id: documentId,
    affair_id: doc.affair_id ?? null,
    client_id: doc.client_id ?? null,
    status: "waiting",
    priority,
    reason,
    snapshot,
    previous_freight_cost: freight,
    previous_insurance_cost: doc.insurance_cost ?? null,
    previous_quote_date: doc.date ?? null,
    requested_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "document",
    entity_id: documentId,
    event_type: "doc.shipping_update_requested",
    message: `Shipping update requested for ${doc.number}${reason ? ` — ${reason}` : ""}`,
    payload: { snapshot, reason, previous_freight_cost: freight },
    bestEffort: true,
  });
  revalidateBoth(documentId);
}

// ---------------------------------------------------------------------------
// Operations: claim a request (waiting → in_progress)
// ---------------------------------------------------------------------------
export async function startShippingUpdate(formData: FormData): Promise<void> {
  await requireCapability("shipping.process_update");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: row, error } = await supabase
    .from("shipping_update_requests")
    .update({ status: "in_progress", started_by: user?.id ?? null, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "waiting")
    .select("document_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("Request is no longer waiting.");
  revalidateBoth(row.document_id);
}

// ---------------------------------------------------------------------------
// Operations: complete — the moment the document actually gets fresher costs
// ---------------------------------------------------------------------------
export async function completeShippingUpdate(formData: FormData): Promise<void> {
  await requireCapability("shipping.process_update");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: req, error: reqErr } = await supabase
    .from("shipping_update_requests")
    .select("id, document_id, status, previous_freight_cost, previous_insurance_cost")
    .eq("id", id)
    .maybeSingle();
  if (reqErr || !req) throw new Error("Request not found.");
  if (req.status !== "waiting" && req.status !== "in_progress") {
    throw new Error(`Request is already ${req.status}.`);
  }

  const { data: doc } = await supabase
    .from("documents")
    .select("id, number, freight_cost")
    .eq("id", req.document_id)
    .maybeSingle();
  if (!doc) throw new Error("Document not found.");

  const { containers } = await effectiveFreight(supabase, req.document_id, doc.freight_cost);

  // New freight: per-container unit prices when the doc has containers
  // (field name cu_<rowId>), else one flat total. Keeping the container
  // rows authoritative is what keeps page totals + PDF breakdown coherent.
  let newFreight: number;
  if (containers.length) {
    const updated = containers.map((c: any) => {
      const v = numOrNull(formData, `cu_${c.id}`);
      return { ...c, unit_price: v == null ? Number(c.unit_price) || 0 : v };
    });
    newFreight = updated.reduce((s, c: any) => s + containerLineTotal(c), 0);
    for (const c of updated as any[]) {
      const { error } = await supabase
        .from("document_containers")
        .update({ unit_price: c.unit_price })
        .eq("id", c.id);
      if (error) throw new Error(error.message);
    }
  } else {
    const flat = numOrNull(formData, "new_freight_cost");
    if (flat == null) throw new Error("Enter the new freight cost.");
    newFreight = flat;
  }

  const newInsurance = numOrNull(formData, "new_insurance_cost");
  let charges: { label: string; amount: number }[] | null = null;
  const chargesRaw = optStr(formData, "additional_charges_json");
  if (chargesRaw) {
    try {
      charges = normalizeAdditionalCharges(JSON.parse(chargesRaw));
    } catch {
      throw new Error("Invalid additional charges.");
    }
  }
  const opsNotes = optStr(formData, "ops_notes");

  // Push onto the document — m146 retry pattern (freight_cost always exists).
  const docPatch: Record<string, unknown> = { freight_cost: newFreight };
  if (newInsurance != null) docPatch.insurance_cost = newInsurance;
  if (charges != null) docPatch.additional_charges = charges;
  const up = await supabase.from("documents").update(docPatch).eq("id", req.document_id);
  if (up.error && /(insurance_cost|additional_charges)/.test(up.error.message ?? "")) {
    const retry = await supabase
      .from("documents")
      .update({ freight_cost: newFreight })
      .eq("id", req.document_id);
    if (retry.error) throw new Error(retry.error.message);
  } else if (up.error) {
    throw new Error(up.error.message);
  }

  const { error: doneErr } = await supabase
    .from("shipping_update_requests")
    .update({
      status: "completed",
      new_freight_cost: newFreight,
      new_insurance_cost: newInsurance,
      new_additional_charges: charges ?? [],
      ops_notes: opsNotes,
      completed_by: user?.id ?? null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (doneErr) throw new Error(doneErr.message);

  const oldF = Number(req.previous_freight_cost) || 0;
  const delta = newFreight - oldF;
  await emitEvent({
    entity_type: "document",
    entity_id: req.document_id,
    event_type: "doc.shipping_update_completed",
    message: `Shipping quotation updated for ${doc.number}: ${oldF.toFixed(2)} → ${newFreight.toFixed(2)} (${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(2)})`,
    payload: {
      previous_freight_cost: oldF,
      new_freight_cost: newFreight,
      new_insurance_cost: newInsurance,
    },
    bestEffort: true,
  });
  revalidateBoth(req.document_id);
}

// ---------------------------------------------------------------------------
// Cancel — the requester withdraws it, or Operations declines it
// ---------------------------------------------------------------------------
export async function cancelShippingUpdate(formData: FormData): Promise<void> {
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: req } = await supabase
    .from("shipping_update_requests")
    .select("id, document_id, status, requested_by")
    .eq("id", id)
    .maybeSingle();
  if (!req) throw new Error("Request not found.");
  if (req.status === "completed" || req.status === "cancelled") {
    throw new Error(`Request is already ${req.status}.`);
  }
  // Own request → withdrawing is fine; anyone else needs the ops capability.
  if (req.requested_by !== user?.id) {
    await requireCapability("shipping.process_update");
  }

  const { error } = await supabase
    .from("shipping_update_requests")
    .update({
      status: "cancelled",
      cancelled_by: user?.id ?? null,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "document",
    entity_id: req.document_id,
    event_type: "doc.shipping_update_cancelled",
    message: "Shipping update request cancelled",
    bestEffort: true,
  });
  revalidateBoth(req.document_id);
}
