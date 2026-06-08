"use server";

/**
 * Project Requests workflow — server actions (V1, m091).
 *
 *   create (+ information-required) → submit → director approve (creates only
 *   the requested children: factory cost / packing / freight) → ops enter
 *   cost (RMB, product+pole) / packing / freight → auto Ready-for-Pricing when
 *   ALL requested children are done → director sets product+pole margins →
 *   priced → generate quotation (product/pole/freight selectable).
 *
 * Factory cost is RMB-mastered and HIDDEN from Sales (capability + RLS). The
 * Sales Director can override it, which appends to factory_cost_audit. Pricing
 * reuses the existing engine (lib/project-pricing.computeSectionPrice →
 * lib/pricing-engine.computePricing); quotations reuse saveDocument.
 */

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { loadPricingSettings } from "@/lib/pricing-settings";
import { computeSectionPrice, buildCommercialDescription, computeFreightTotal, buildShippingContainers } from "@/lib/project-pricing";
import { validityFromPeriod } from "@/lib/freight-validity";
import { computeWaitingStatus } from "@/lib/project-dashboard";
import { saveDocument, type SaveDocumentInput } from "@/app/(app)/documents/new/actions";
import type { DocumentLine, DocumentContainer, Incoterm } from "@/lib/types";

// ---------------------------- FormData helpers ----------------------------

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}
function reqStr(fd: FormData, key: string): string {
  const v = str(fd, key);
  if (!v) throw new Error(`Missing ${key}`);
  return v;
}
function numOrNull(fd: FormData, key: string): number | null {
  const v = fd.get(key);
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function intOrNull(fd: FormData, key: string): number | null {
  const n = numOrNull(fd, key);
  return n == null ? null : Math.round(n);
}
function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}
const now = () => new Date().toISOString();

function revalidate(id?: string) {
  revalidatePath("/projects");
  revalidatePath("/projects/approvals");
  revalidatePath("/projects/cost-requests");
  revalidatePath("/projects/logistics-requests");
  if (id) revalidatePath(`/projects/${id}`);
}

// ---------------------------- create / submit ----------------------------

export async function createProjectRequest(formData: FormData): Promise<void> {
  await requireCapability("project.create");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const name = reqStr(formData, "name");
  // P9 (preferred A): client is mandatory at creation so the workflow can
  // never reach pricing/quotation without one.
  const clientId = str(formData, "client_id");
  if (!clientId) throw new Error("Select a client to create a project request.");
  const quantity = intOrNull(formData, "quantity");
  const reqPacking = bool(formData, "req_packing_list");
  const reqFreight = bool(formData, "req_freight");
  // Business rule: packing/freight need a quantity.
  if ((reqPacking || reqFreight) && (quantity == null || quantity <= 0)) {
    throw new Error("Quantity is required before requesting Packing List or Freight Cost.");
  }
  // Business rule (m096): a freight estimate needs transport mode + destination.
  const transportMode = str(formData, "freight_transport_mode");
  const freightDestination = str(formData, "freight_destination");
  if (reqFreight && (!transportMode || !freightDestination)) {
    throw new Error("Transport mode and destination are required when requesting a freight estimate.");
  }

  const { data: created, error } = await supabase
    .from("project_requests")
    .insert({
      name,
      client_id: clientId,
      product_category_id: str(formData, "product_category_id"),
      country: str(formData, "country"),
      quantity,
      opportunity_value: numOrNull(formData, "opportunity_value"),
      led_power: str(formData, "led_power"),
      solar_panel_size: str(formData, "solar_panel_size"),
      battery_spec: str(formData, "battery_spec"),
      controller: str(formData, "controller"),
      iot_required: bool(formData, "iot_required"),
      additional_notes: str(formData, "additional_notes"),
      // pole (m096)
      pole_required: bool(formData, "pole_required"),
      pole_quantity: intOrNull(formData, "pole_quantity"),
      pole_height: str(formData, "pole_height"),
      arm_length: str(formData, "arm_length"),
      pole_notes: str(formData, "pole_notes"),
      // freight brief (m096)
      freight_transport_mode: transportMode,
      freight_destination: freightDestination,
      freight_notes: str(formData, "freight_notes"),
      req_product_pricing: bool(formData, "req_product_pricing"),
      req_packing_list: reqPacking,
      req_freight: reqFreight,
      owner_id: user?.id ?? null,
      created_by: user?.id ?? null,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "project_request",
    entity_id: created.id,
    event_type: "pr.created",
    message: `Project request "${name}" created`,
    payload: { name },
    bestEffort: true,
  });
  revalidate();
  redirect(`/projects/${created.id}?flash=${encodeURIComponent("Project request created")}`);
}

export async function submitProjectRequest(formData: FormData): Promise<void> {
  await requireCapability("project.create");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const { error } = await supabase
    .from("project_requests")
    .update({ status: "waiting_director_approval", updated_at: now() })
    .eq("id", id)
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  await emitEvent({
    entity_type: "project_request",
    entity_id: id,
    event_type: "pr.submitted",
    message: "Submitted for director approval",
    bestEffort: true,
  });
  revalidate(id);
}

// ---------------------------- director decisions ----------------------------

export async function approveProjectRequest(formData: FormData): Promise<void> {
  await requireCapability("project.approve");
  const id = reqStr(formData, "id");
  const supabase = createClient();

  // Director confirms which information is needed.
  const needCost = bool(formData, "req_product_pricing");
  const needPack = bool(formData, "req_packing_list");
  const needFreight = bool(formData, "req_freight");

  await supabase
    .from("project_requests")
    .update({ req_product_pricing: needCost, req_packing_list: needPack, req_freight: needFreight, updated_at: now() })
    .eq("id", id);

  // Create only the requested children (idempotent — only if absent).
  if (needCost) {
    const { data } = await supabase.from("factory_cost_requests").select("id").eq("project_request_id", id).limit(1);
    if (!data?.length) await supabase.from("factory_cost_requests").insert({ project_request_id: id, status: "pending" });
  }
  if (needPack) {
    const { data } = await supabase.from("packing_list_requests").select("id").eq("project_request_id", id).limit(1);
    if (!data?.length) await supabase.from("packing_list_requests").insert({ project_request_id: id, status: "pending" });
  }
  if (needFreight) {
    const { data } = await supabase.from("freight_cost_requests").select("id").eq("project_request_id", id).limit(1);
    if (!data?.length) {
      // Pre-seed transport mode + destination from the sales freight brief (m096).
      const { data: brief } = await supabase
        .from("project_requests")
        .select("freight_transport_mode, freight_destination")
        .eq("id", id)
        .maybeSingle();
      await supabase.from("freight_cost_requests").insert({
        project_request_id: id,
        status: "pending",
        transport_mode: (brief as any)?.freight_transport_mode ?? null,
        port_of_destination: (brief as any)?.freight_destination ?? null,
      });
    }
  }

  const anyRequested = needCost || needPack || needFreight;
  await supabase
    .from("project_requests")
    .update({ status: anyRequested ? "waiting_factory_cost" : "ready_for_pricing", updated_at: now() })
    .eq("id", id);

  await emitEvent({
    entity_type: "project_request",
    entity_id: id,
    event_type: "pr.approved",
    message: anyRequested ? "Sent to Operations — costing & logistics requested" : "Approved — no requests needed",
    bestEffort: true,
  });
  revalidate(id);
}

export async function rejectProjectRequest(formData: FormData): Promise<void> {
  await requireCapability("project.approve");
  const id = reqStr(formData, "id");
  const note = str(formData, "note");
  const supabase = createClient();
  const { error } = await supabase
    .from("project_requests")
    .update({ status: "cancelled", updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await emitEvent({
    entity_type: "project_request",
    entity_id: id,
    event_type: "pr.rejected",
    message: `Rejected${note ? ` — ${note}` : ""}`,
    payload: { note },
    bestEffort: true,
  });
  revalidate(id);
}

export async function requestMoreInfo(formData: FormData): Promise<void> {
  await requireCapability("project.approve");
  const id = reqStr(formData, "id");
  const note = str(formData, "note");
  const supabase = createClient();
  const { error } = await supabase
    .from("project_requests")
    .update({ status: "draft", updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await emitEvent({
    entity_type: "project_request",
    entity_id: id,
    event_type: "pr.info_requested",
    message: `More information requested${note ? ` — ${note}` : ""}`,
    payload: { note },
    bestEffort: true,
  });
  revalidate(id);
}

// ---------------------------- operations: cost / packing / freight ----------------------------

/**
 * Recompute the parent's waiting/ready phase from requested-vs-completed
 * children — call after EVERY cost/packing/freight submission so the status is
 * never stale (P6). Advances waiting_factory_cost → waiting_logistics →
 * ready_for_pricing as inputs arrive; emits pr.ready_for_pricing on entry.
 */
async function recomputeWaitingStatus(
  supabase: ReturnType<typeof createClient>,
  projectId: string
): Promise<void> {
  const { data: pr } = await supabase
    .from("project_requests")
    .select("status, req_product_pricing, req_packing_list, req_freight")
    .eq("id", projectId)
    .maybeSingle();
  if (!pr) return;

  const done = (rows: any[] | null | undefined) =>
    (rows ?? []).length > 0 && (rows ?? []).every((r: any) => r.status === "completed");

  const [cost, pack, freight] = await Promise.all([
    supabase.from("factory_cost_requests").select("status").eq("project_request_id", projectId),
    supabase.from("packing_list_requests").select("status").eq("project_request_id", projectId),
    supabase.from("freight_cost_requests").select("status").eq("project_request_id", projectId),
  ]);

  const next = computeWaitingStatus({
    reqCost: !!(pr as any).req_product_pricing,
    reqPack: !!(pr as any).req_packing_list,
    reqFreight: !!(pr as any).req_freight,
    costDone: done(cost.data as any[]),
    packDone: done(pack.data as any[]),
    freightDone: done(freight.data as any[]),
    current: (pr as any).status,
  });

  if (next && next !== (pr as any).status) {
    await supabase.from("project_requests").update({ status: next, updated_at: now() }).eq("id", projectId);
    if (next === "ready_for_pricing") {
      await emitEvent({
        entity_type: "project_request",
        entity_id: projectId,
        event_type: "pr.ready_for_pricing",
        message: "All requested inputs received — ready for pricing",
        bestEffort: true,
      });
    }
  }
}

export async function enterFactoryCost(formData: FormData): Promise<void> {
  await requireCapability("project.enter_cost");
  const projectId = reqStr(formData, "project_id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const patch = {
    product_cost_rmb: numOrNull(formData, "product_cost_rmb"),
    pole_cost_rmb: numOrNull(formData, "pole_cost_rmb"),
    cost_notes: str(formData, "cost_notes"),
    status: "completed" as const,
    completed_by: user?.id ?? null,
    completed_at: now(),
  };
  const { data: existing } = await supabase
    .from("factory_cost_requests")
    .select("id")
    .eq("project_request_id", projectId)
    .limit(1)
    .maybeSingle();
  const { error } = existing?.id
    ? await supabase.from("factory_cost_requests").update(patch).eq("id", existing.id)
    : await supabase.from("factory_cost_requests").insert({ project_request_id: projectId, ...patch });
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "project_request",
    entity_id: projectId,
    event_type: "pr.cost_entered",
    message: `Factory cost entered (product ${patch.product_cost_rmb ?? "—"} RMB, pole ${patch.pole_cost_rmb ?? "—"} RMB)`,
    payload: { product_cost_rmb: patch.product_cost_rmb, pole_cost_rmb: patch.pole_cost_rmb },
    bestEffort: true,
  });
  await recomputeWaitingStatus(supabase, projectId);
  revalidate(projectId);
}

/** Sales Director override of factory cost — append-only audit, reason required. */
export async function overrideFactoryCost(formData: FormData): Promise<void> {
  await requireCapability("project.override_cost");
  const projectId = reqStr(formData, "project_id");
  const reason = str(formData, "reason");
  if (!reason) throw new Error("A reason is required to override factory cost.");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cost } = await supabase
    .from("factory_cost_requests")
    .select("id, product_cost_rmb, pole_cost_rmb")
    .eq("project_request_id", projectId)
    .limit(1)
    .maybeSingle();
  if (!cost?.id) throw new Error("No factory cost request to override.");

  const newProduct = numOrNull(formData, "product_cost_rmb");
  const newPole = numOrNull(formData, "pole_cost_rmb");

  const audits: any[] = [];
  if (newProduct != null && newProduct !== Number(cost.product_cost_rmb ?? NaN)) {
    audits.push({
      project_request_id: projectId,
      factory_cost_request_id: cost.id,
      field: "product_cost_rmb",
      old_value: cost.product_cost_rmb,
      new_value: newProduct,
      reason,
      changed_by: user?.id ?? null,
    });
  }
  if (newPole != null && newPole !== Number(cost.pole_cost_rmb ?? NaN)) {
    audits.push({
      project_request_id: projectId,
      factory_cost_request_id: cost.id,
      field: "pole_cost_rmb",
      old_value: cost.pole_cost_rmb,
      new_value: newPole,
      reason,
      changed_by: user?.id ?? null,
    });
  }
  if (audits.length === 0) throw new Error("No cost values changed.");

  // Audit FIRST (append-only), then update — never delete or mutate history.
  await supabase.from("factory_cost_audit").insert(audits);
  const update: Record<string, any> = { status: "completed", completed_by: user?.id ?? null, completed_at: now() };
  if (newProduct != null) update.product_cost_rmb = newProduct;
  if (newPole != null) update.pole_cost_rmb = newPole;
  const { error } = await supabase.from("factory_cost_requests").update(update).eq("id", cost.id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "project_request",
    entity_id: projectId,
    event_type: "pr.cost_overridden",
    message: `Factory cost overridden by director — ${reason}`,
    payload: { changes: audits.map((a) => ({ field: a.field, old: a.old_value, new: a.new_value })) },
    bestEffort: true,
  });
  await recomputeWaitingStatus(supabase, projectId);
  revalidate(projectId);
}

export async function enterPacking(formData: FormData): Promise<void> {
  await requireCapability("project.enter_logistics");
  const projectId = reqStr(formData, "project_id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Multiple container rows arrive as a JSON array [{type, quantity}] from the
  // client PackingEntryForm. Parse defensively; drop empty/invalid rows.
  let containers: Array<{ type: string; quantity: number }> = [];
  try {
    const raw = JSON.parse(str(formData, "containers_json") ?? "[]");
    if (Array.isArray(raw)) {
      containers = raw
        .map((r: any) => ({ type: String(r?.type ?? "").trim(), quantity: Math.max(0, Math.round(Number(r?.quantity ?? 0))) }))
        .filter((r) => r.type && r.quantity > 0);
    }
  } catch {
    containers = [];
  }
  const patch = {
    containers,
    total_cbm: numOrNull(formData, "total_cbm"),
    loading_notes: str(formData, "loading_notes"),
    status: "completed" as const,
    completed_by: user?.id ?? null,
    completed_at: now(),
  };
  const { data: existing } = await supabase
    .from("packing_list_requests")
    .select("id")
    .eq("project_request_id", projectId)
    .limit(1)
    .maybeSingle();
  const { error } = existing?.id
    ? await supabase.from("packing_list_requests").update(patch).eq("id", existing.id)
    : await supabase.from("packing_list_requests").insert({ project_request_id: projectId, ...patch });
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "project_request",
    entity_id: projectId,
    event_type: "pr.packing_entered",
    message: "Packing list entered",
    bestEffort: true,
  });
  await recomputeWaitingStatus(supabase, projectId);
  revalidate(projectId);
}

export async function enterFreight(formData: FormData): Promise<void> {
  await requireCapability("project.enter_logistics");
  const projectId = reqStr(formData, "project_id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Freight breakdown comes from the Packing List (m097). Container types +
  // quantities are not re-entered here — only the per-unit rate. Total is the
  // sum of quantity × freight_per_unit, computed server-side.
  let containers: Array<{ type: string; quantity: number; freight_per_unit: number }> = [];
  try {
    const raw = JSON.parse(str(formData, "containers_json") ?? "[]");
    if (Array.isArray(raw)) {
      containers = raw
        .map((r: any) => ({
          type: String(r?.type ?? "").trim(),
          quantity: Math.max(0, Math.round(Number(r?.quantity ?? 0))),
          freight_per_unit: Math.max(0, Number(r?.freight_per_unit ?? 0)),
        }))
        .filter((r) => r.type && r.quantity > 0);
    }
  } catch {
    containers = [];
  }
  const newTotal = computeFreightTotal(containers);

  // Validity (m098): explicit date wins, else a period (days) from today.
  const todayISO = now().slice(0, 10);
  let validUntil: string | null = (str(formData, "valid_until") || "").trim() || null;
  const validityDays = Number(str(formData, "validity_days") ?? "");
  if (!validUntil && Number.isFinite(validityDays) && validityDays > 0) {
    validUntil = validityFromPeriod(todayISO, validityDays);
  }

  // Read the existing freight row (update detection + audit). Resilient ordering
  // like loadFreight — prefer the row that already carries a breakdown.
  const { data: freightRows } = await supabase
    .from("freight_cost_requests")
    .select("id, status, containers, estimated_total_freight, valid_until, update_count")
    .eq("project_request_id", projectId)
    .order("created_at", { ascending: true });
  const existingRow: any =
    (freightRows ?? []).find((x: any) => Array.isArray(x?.containers) && x.containers.length) ??
    (freightRows ?? [])[0] ??
    null;
  // A REFRESH = the freight was already completed before (re-entry after the
  // quotation). First-time entry (pending → completed) is the normal workflow.
  const isRefresh = existingRow?.status === "completed";

  const patch = {
    transport_mode: str(formData, "transport_mode"),
    incoterm: str(formData, "incoterm"),
    port_of_destination: str(formData, "port_of_destination"),
    destination_country: str(formData, "destination_country"),
    containers,
    estimated_total_freight: newTotal,
    notes: str(formData, "notes"),
    valid_until: validUntil,
    update_requested_at: null, // entering freight clears any pending refresh request
    update_requested_by: null,
    update_count: isRefresh ? Number(existingRow.update_count ?? 0) + 1 : Number(existingRow?.update_count ?? 0),
    status: "completed" as const,
    completed_by: user?.id ?? null,
    completed_at: now(),
  };
  const { error } = existingRow?.id
    ? await supabase.from("freight_cost_requests").update(patch).eq("id", existingRow.id)
    : await supabase.from("freight_cost_requests").insert({ project_request_id: projectId, ...patch });
  if (error) throw new Error(error.message);

  if (isRefresh) {
    // Append-only audit (old vs new breakdown + validity).
    await supabase.from("freight_cost_audit").insert({
      project_request_id: projectId,
      freight_cost_request_id: existingRow.id,
      old_containers: existingRow.containers ?? [],
      new_containers: containers,
      old_total: existingRow.estimated_total_freight ?? null,
      new_total: newTotal,
      old_valid_until: existingRow.valid_until ?? null,
      new_valid_until: validUntil,
      note: str(formData, "notes") || null,
      changed_by: user?.id ?? null,
    });
    // Auto-refresh ONLY the linked quotation's freight — product lines and
    // pricing are untouched; no project request, no director. (m098)
    await refreshQuotationFreight(supabase, projectId, containers);
    await emitEvent({
      entity_type: "project_request",
      entity_id: projectId,
      event_type: "pr.freight_updated",
      message: `Freight updated${validUntil ? ` — valid until ${validUntil}` : ""}`,
      bestEffort: true,
    });
  } else {
    await emitEvent({
      entity_type: "project_request",
      entity_id: projectId,
      event_type: "pr.freight_entered",
      message: "Freight cost entered",
      bestEffort: true,
    });
  }
  await recomputeWaitingStatus(supabase, projectId);
  revalidate(projectId);
}

/**
 * After Operations updates freight (m098), refresh ONLY the linked quotation's
 * Shipping (containers + freight_cost). Product lines stay intact — no
 * re-pricing, no director. Draft quotations only. Best-effort (never blocks the
 * freight update). Resilient to a missing wooden_box_cost column (m007).
 */
async function refreshQuotationFreight(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  freightContainers: Array<{ type: string; quantity: number; freight_per_unit: number }>
): Promise<void> {
  try {
    const { data: pr } = await supabase
      .from("project_requests")
      .select("generated_document_id, quote_include_freight")
      .eq("id", projectId)
      .maybeSingle();
    const docId = (pr as any)?.generated_document_id as string | undefined;
    if (!docId || (pr as any)?.quote_include_freight === false) return;
    const { data: doc } = await supabase.from("documents").select("id, status").eq("id", docId).maybeSingle();
    if (!doc || (doc as any).status !== "draft") return; // never touch a sent/won quote

    const { data: pkRows } = await supabase
      .from("packing_list_requests")
      .select("containers")
      .eq("project_request_id", projectId)
      .order("created_at", { ascending: true });
    const packing: any =
      (pkRows ?? []).find((x: any) => Array.isArray(x?.containers) && x.containers.length) ?? (pkRows ?? [])[0] ?? null;
    const shipping = buildShippingContainers(packing?.containers, freightContainers as any) as DocumentContainer[];

    await supabase.from("document_containers").delete().eq("document_id", docId);
    if (shipping.length) {
      const baseRows = shipping.map((c, i) => ({
        document_id: docId,
        container_type: c.container_type,
        quantity: c.quantity,
        unit_price: c.unit_price,
        position: i,
      }));
      const richRows = baseRows.map((r) => ({ ...r, wooden_box_cost: 0 }));
      const ins = await supabase.from("document_containers").insert(richRows);
      if (ins.error && /wooden_box_cost/.test(ins.error.message ?? "")) {
        await supabase.from("document_containers").insert(baseRows);
      }
    }
    const freightTotal = shipping.reduce((s, c) => s + c.quantity * c.unit_price, 0);
    await supabase.from("documents").update({ freight_cost: freightTotal }).eq("id", docId);
    revalidatePath(`/documents/${docId}`);
  } catch {
    // best-effort
  }
}

/**
 * Sales requests a freight refresh on a generated quotation (m098). Flags the
 * freight request for Operations and notifies them. Does NOT change project
 * status / re-open the director / pricing flow — only logistics will change.
 */
export async function requestFreightUpdate(formData: FormData): Promise<void> {
  await requireCapability("project.generate_quotation");
  const projectId = reqStr(formData, "project_id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: freightRows } = await supabase
    .from("freight_cost_requests")
    .select("id, status, containers")
    .eq("project_request_id", projectId)
    .order("created_at", { ascending: true });
  const row: any =
    (freightRows ?? []).find((x: any) => Array.isArray(x?.containers) && x.containers.length) ?? (freightRows ?? [])[0] ?? null;
  if (!row?.id) throw new Error("No freight cost request to refresh for this project.");
  const { error } = await supabase
    .from("freight_cost_requests")
    .update({ update_requested_at: now(), update_requested_by: user?.id ?? null })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
  await emitEvent({
    entity_type: "project_request",
    entity_id: projectId,
    event_type: "pr.freight_update_requested",
    message: "Freight update requested",
    bestEffort: true,
  });
  revalidate(projectId);
}

// ---------------------------- director pricing ----------------------------

export async function setProjectPricing(formData: FormData): Promise<void> {
  await requireCapability("project.set_pricing");
  const id = reqStr(formData, "id");
  const productMargin = numOrNull(formData, "product_margin_pct");
  if (productMargin == null) throw new Error("Enter a product margin %");
  const productCommission = numOrNull(formData, "product_commission_pct");
  const poleMargin = numOrNull(formData, "pole_margin_pct");
  const poleCommission = numOrNull(formData, "pole_commission_pct");
  const supabase = createClient();

  // Load the project (for the client guard + the Project Product snapshot),
  // the cost (Director can read), freight total, and pricing settings.
  const [{ data: proj }, { data: cost }, { data: freight }, settings] = await Promise.all([
    supabase
      .from("project_requests")
      .select(
        "name, client_id, product_category_id, quantity, led_power, solar_panel_size, battery_spec, controller, iot_required, pole_required, pole_quantity, pole_height, arm_length, product_categories:product_category_id(name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("factory_cost_requests").select("product_cost_rmb, pole_cost_rmb").eq("project_request_id", id).limit(1).maybeSingle(),
    supabase.from("freight_cost_requests").select("estimated_total_freight").eq("project_request_id", id).limit(1).maybeSingle(),
    loadPricingSettings(supabase),
  ]);
  // P9 backstop: never price without a client (so quotation can't dead-end).
  if (!(proj as any)?.client_id) throw new Error("Select a client before pricing this project.");
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const productFinal = round2(
    computeSectionPrice({ costRmb: (cost as any)?.product_cost_rmb ?? 0, exchangeRate: settings.exchangeRate, taxRebate: settings.taxRebate, marginPct: productMargin, commissionPct: productCommission }).finalUnitPrice
  );
  // No pole price when the project has no poles (m096).
  const poleRequired = (proj as any)?.pole_required !== false;
  const poleFinal = poleRequired
    ? round2(
        computeSectionPrice({ costRmb: (cost as any)?.pole_cost_rmb ?? 0, exchangeRate: settings.exchangeRate, taxRebate: settings.taxRebate, marginPct: poleMargin, commissionPct: poleCommission }).finalUnitPrice
      )
    : 0;

  const { error } = await supabase
    .from("project_requests")
    .update({
      product_margin_pct: productMargin,
      product_commission_pct: productCommission,
      pole_margin_pct: poleMargin,
      pole_commission_pct: poleCommission,
      product_final_price: productFinal,
      pole_final_price: poleFinal,
      margin_notes: str(formData, "margin_notes"),
      status: "priced",
      updated_at: now(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Generate the Project Product (m095) — the sellable snapshot the quotation
  // is built from. NOT a catalog product; 1:1 with the project (upsert on
  // re-pricing). Inherits category, technical config, and the approved prices.
  const pj = proj as any;
  await supabase.from("project_products").upsert(
    {
      project_request_id: id,
      product_category_id: pj?.product_category_id ?? null,
      commercial_description: buildCommercialDescription(pj ?? {}, pj?.product_categories?.name ?? null),
      led_power: pj?.led_power ?? null,
      solar_panel_size: pj?.solar_panel_size ?? null,
      battery_spec: pj?.battery_spec ?? null,
      controller: pj?.controller ?? null,
      pole_height: pj?.pole_height ?? null,
      arm_length: pj?.arm_length ?? null,
      iot_required: !!pj?.iot_required,
      currency: "USD",
      quantity: pj?.quantity ?? null,
      pole_quantity: poleRequired ? pj?.pole_quantity ?? null : null,
      product_unit_price: productFinal,
      pole_unit_price: poleFinal,
      freight_total: (freight as any)?.estimated_total_freight ?? null,
      updated_at: now(),
    },
    { onConflict: "project_request_id" }
  );

  await emitEvent({
    entity_type: "project_request",
    entity_id: id,
    event_type: "pr.priced",
    message: `Priced — product ${productMargin}% margin`,
    bestEffort: true,
  });
  revalidate(id);
}

// ---------------------------- generate quotation (multi-line) ----------------------------

export async function generateQuotationFromProject(formData: FormData): Promise<void> {
  await requireCapability("project.generate_quotation");
  const id = reqStr(formData, "id");
  const includeProduct = bool(formData, "include_product");
  const includePole = bool(formData, "include_pole");
  const includeFreight = bool(formData, "include_freight");
  if (!includeProduct && !includePole && !includeFreight) {
    throw new Error("Select at least one section (Product, Pole or Freight) to include.");
  }

  const supabase = createClient();
  const { data: project } = await supabase
    .from("project_requests")
    .select("*, clients:client_id(company_name)")
    .eq("id", id)
    .maybeSingle();
  if (!project) throw new Error("Project not found");
  const p = project as any;
  if (!p.client_id) throw new Error("Select a client on the project before generating a quotation");
  // Allow REGENERATION: a project that is already "quotation_generated" can be
  // re-quoted (e.g. after a freight/pricing fix). When the existing generated
  // doc is still a draft we overwrite it in place (same number); otherwise a
  // fresh document is created.
  if (p.status !== "priced" && p.status !== "quotation_generated") {
    throw new Error("Project must be priced before generating a quotation");
  }

  // Source the quotation from the approved PROJECT PRODUCT (m095) — the
  // sellable snapshot generated at pricing approval. No catalog product
  // selection. Falls back to the project's stored finals for rows priced
  // before m095. Freight feeds the document's Shipping section (containers +
  // incoterm + destination port), NOT a product line — Products and Logistics
  // stay separated.
  // Freight columns vary by applied migrations (containers=m097,
  // transport_mode=m096, incoterm/port=m094). Degrade gracefully so generation
  // never hard-fails on a missing column — fall back to progressively smaller
  // column sets and keep whatever the DB has.
  // IMPORTANT: `containers` (m097) must NOT be bundled with `transport_mode`
  // (m096) — if only one of those migrations is applied, a combined SELECT
  // fails and we'd lose the freight breakdown. So `containers` is attempted in
  // its own tiers, independent of transport_mode / incoterm / port.
  const FREIGHT_COL_SETS = [
    "destination_country, estimated_total_freight, containers, incoterm, port_of_destination, transport_mode",
    "destination_country, estimated_total_freight, containers, incoterm, port_of_destination",
    "destination_country, estimated_total_freight, containers",
    "destination_country, estimated_total_freight, incoterm, port_of_destination",
    "destination_country, estimated_total_freight",
  ];
  async function loadFreight(): Promise<any> {
    for (const cols of FREIGHT_COL_SETS) {
      const r = await supabase
        .from("freight_cost_requests")
        .select(cols)
        .eq("project_request_id", id)
        .order("created_at", { ascending: true });
      if (!r.error) {
        const rows = (r.data ?? []) as any[];
        // There can be >1 child request (re-approvals); prefer the one that
        // actually carries a container breakdown, else the first.
        return rows.find((x) => Array.isArray(x?.containers) && x.containers.length) ?? rows[0] ?? null;
      }
    }
    return null;
  }
  // Packing list drives container TYPES + QUANTITIES (single source of truth).
  // containers col is m094 — fall back to legacy if absent.
  async function loadPacking(): Promise<any> {
    for (const cols of ["containers, num_containers, container_type", "containers", "num_containers, container_type"]) {
      const r = await supabase
        .from("packing_list_requests")
        .select(cols)
        .eq("project_request_id", id)
        .order("created_at", { ascending: true });
      if (!r.error) {
        const rows = (r.data ?? []) as any[];
        return rows.find((x) => Array.isArray(x?.containers) && x.containers.length) ?? rows[0] ?? null;
      }
    }
    return null;
  }
  const [{ data: pp }, freight, packing] = await Promise.all([
    supabase.from("project_products").select("*").eq("project_request_id", id).maybeSingle(),
    loadFreight(),
    loadPacking(),
  ]);
  const pr = pp as any;

  const qty = Math.max(1, Number(pr?.quantity ?? p.quantity ?? 1));
  const productUnit = Number(pr?.product_unit_price ?? p.product_final_price ?? 0);
  const poleUnit = Number(pr?.pole_unit_price ?? p.pole_final_price ?? 0);
  const freightTotal = Number(pr?.freight_total ?? (freight as any)?.estimated_total_freight ?? 0);

  const fallbackSpecs = [
    p.led_power && `LED ${p.led_power}`,
    p.solar_panel_size && `Panel ${p.solar_panel_size}`,
    p.battery_spec && `Battery ${p.battery_spec}`,
    p.controller && `Controller ${p.controller}`,
    p.iot_required ? "IoT" : null,
  ].filter(Boolean);
  const productName =
    pr?.commercial_description ?? (fallbackSpecs.length ? `${p.name} — ${fallbackSpecs.join(", ")}` : p.name);
  const poleHeight = pr?.pole_height ?? p.pole_height;
  const poleName = poleHeight ? `Pole — ${poleHeight}` : "Pole";

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const mkLine = (name: string, unit: number, q: number): DocumentLine => ({
    product_id: null as unknown as string, // free-text line (product_id nullable, m089)
    quantity: q,
    selected_options: {},
    unit_price: round2(unit),
    total_price: round2(unit * q),
    pricing_mode: "manual",
    pricing_tier: "medium",
    original_unit_price: round2(unit),
    discount_type: null,
    discount_value: 0,
    client_product_name: name,
  });

  const poleQty = Math.max(1, Number(pr?.pole_quantity ?? p.pole_quantity ?? qty));
  const poleAllowed = p.pole_required !== false;

  // PRODUCTS — Project Product + Pole only (Logistics handled below).
  const lines: DocumentLine[] = [];
  if (includeProduct && productUnit > 0) lines.push(mkLine(productName, productUnit, qty));
  if (includePole && poleAllowed && poleUnit > 0) lines.push(mkLine(poleName, poleUnit, poleQty));

  // LOGISTICS — freight goes into the document Shipping section as containers
  // (type-mapped from the freight breakdown, unit_price = freight per
  // container) plus incoterm + destination port — never a product line.
  const fr = freight as any;
  const pk = packing as any;
  let shippingContainers: DocumentContainer[] = [];
  let incoterm: Incoterm | null = null;
  let portOfDestination: string | null = null;
  if (includeFreight) {
    // Container types + quantities from the Packing List; cost per container
    // from the Freight breakdown (matched by type).
    shippingContainers = buildShippingContainers(pk?.containers, fr?.containers) as DocumentContainer[];
    const builtTotal = shippingContainers.reduce((s, c) => s + c.quantity * c.unit_price, 0);
    // A freight total is known but the breakdown carries no per-container cost:
    // spread it across the containers (by quantity) so the freight value isn't
    // lost; if there are no containers at all, show it as one container.
    if (builtTotal === 0 && freightTotal > 0) {
      const totalQty = shippingContainers.reduce((s, c) => s + c.quantity, 0);
      if (shippingContainers.length > 0 && totalQty > 0) {
        const perUnit = round2(freightTotal / totalQty);
        shippingContainers = shippingContainers.map((c) => ({ ...c, unit_price: perUnit }));
      } else {
        shippingContainers = [
          { container_type: "40ft HC", quantity: 1, unit_price: round2(freightTotal), wooden_box_cost: 0 },
        ];
      }
    }
    const VALID_INCOTERMS = ["EXW", "FOB", "CFR", "CIF", "DDP", "DDU"];
    incoterm = VALID_INCOTERMS.includes(String(fr?.incoterm)) ? (fr.incoterm as Incoterm) : null;
    portOfDestination = fr?.port_of_destination ?? null;
  }

  if (lines.length === 0 && shippingContainers.length === 0) {
    throw new Error("Nothing to quote — the selected sections have no price yet.");
  }

  // Regenerate in place when a prior generated document still exists and is a
  // draft — overwrites its lines + shipping wholesale, keeping the same number.
  // If it was already sent/won (not a draft), leave it and create a fresh doc.
  let editOf: string | null = null;
  if (p.generated_document_id) {
    const { data: existing } = await supabase
      .from("documents")
      .select("id, status")
      .eq("id", p.generated_document_id)
      .maybeSingle();
    if (existing && (existing as any).status === "draft") {
      editOf = p.generated_document_id;
    }
  }

  const input: SaveDocumentInput = {
    type: "quotation",
    client_id: p.client_id,
    incoterm,
    currency: "USD",
    port_of_loading: null,
    port_of_destination: portOfDestination,
    containers: shippingContainers,
    manual_pricing: true,
    payment_mode: "deposit_balance",
    payment_terms: { deposit_percent: 30, balance_condition: "before_shipment" },
    production_time: null,
    affair_name: p.name,
    include_sales_conditions: false,
    sales_conditions_id: null,
    bank_account_id: null,
    purchase_order_number: null,
    commission_enabled: false, // commission already folded into unit prices
    commission_percentage: 0,
    commission_amount: 0,
    commission_description: null,
    show_commission_in_pdf: false,
    edit_of: editOf, // overwrite the existing draft in place when regenerating
    lines,
  };

  const doc = await saveDocument(input);
  await supabase
    .from("project_requests")
    .update({
      status: "quotation_generated",
      generated_document_id: doc.id,
      quote_include_product: includeProduct,
      quote_include_pole: includePole,
      quote_include_freight: includeFreight,
      updated_at: now(),
    })
    .eq("id", id);
  await emitEvent({
    entity_type: "project_request",
    entity_id: id,
    event_type: "pr.quotation_generated",
    message: `Quotation generated (${lines.length} line${lines.length === 1 ? "" : "s"})`,
    payload: { document_id: doc.id },
    bestEffort: true,
  });
  revalidate(id);
  // Bust the document view's cache so the freshly written freight containers
  // show immediately (not a stale render from a previous visit).
  revalidatePath(`/documents/${doc.id}`);
  revalidatePath(`/documents/new`);
  redirect(`/documents/${doc.id}?flash=${encodeURIComponent("Quotation generated from project")}`);
}

// ---------------------------- outcome / archive / files ----------------------------

export async function setProjectOutcome(formData: FormData): Promise<void> {
  const id = reqStr(formData, "id");
  const outcome = reqStr(formData, "outcome");
  if (!["won", "lost", "cancelled"].includes(outcome)) throw new Error("Invalid outcome");
  await requireCapability(outcome === "cancelled" ? "project.create" : "project.set_pricing");
  const supabase = createClient();
  const { error } = await supabase
    .from("project_requests")
    .update({ status: outcome, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  await emitEvent({
    entity_type: "project_request",
    entity_id: id,
    event_type: outcome === "won" ? "pr.won" : outcome === "lost" ? "pr.lost" : "pr.cancelled",
    message: `Project ${outcome}`,
    bestEffort: true,
  });
  revalidate(id);
}

/** Assign / change the client on a project (e.g. a legacy clientless row). */
export async function setProjectClient(formData: FormData): Promise<void> {
  await requireCapability("project.create");
  const id = reqStr(formData, "id");
  const clientId = reqStr(formData, "client_id");
  const supabase = createClient();
  const { error } = await supabase
    .from("project_requests")
    .update({ client_id: clientId, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate(id);
}

export async function archiveProjectRequest(formData: FormData): Promise<void> {
  await requireCapability("project.create");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const { error } = await supabase
    .from("project_requests")
    .update({ archived_at: now(), updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate(id);
}

export async function recordProjectFile(formData: FormData): Promise<void> {
  await requireCapability("project.create");
  const projectId = reqStr(formData, "project_id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("project_request_files").insert({
    project_request_id: projectId,
    storage_path: reqStr(formData, "storage_path"),
    file_name: reqStr(formData, "file_name"),
    file_size: intOrNull(formData, "file_size"),
    mime_type: str(formData, "mime_type"),
    category: str(formData, "category") ?? "other",
    uploaded_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);
  revalidate(projectId);
}

export async function deleteProjectFile(formData: FormData): Promise<void> {
  await requireCapability("project.create");
  const id = reqStr(formData, "id");
  const projectId = reqStr(formData, "project_id");
  const supabase = createClient();
  const { error } = await supabase.from("project_request_files").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidate(projectId);
}
