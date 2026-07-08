"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { DocStatus } from "@/lib/types";
import { DOC_STATUSES, isTechnicalRole, isAdminLike, canSupervise } from "@/lib/types";
import { getCurrentUserRole } from "@/lib/auth";
import { emitEvent } from "@/lib/events";
import { requireCapability } from "@/lib/permissions";
import { buildTaskListLineFromQuotationLine } from "@/lib/manual-items";
import { loadCostingSettings } from "@/lib/pricing-settings";
import { computeCostingStatus } from "@/lib/costing-validity";
import {
  applySelectionsToLines,
  recomputeDocTotals,
  versionContainers,
  type ApplyLine,
  type ApplySelections,
  type ApplyVersion,
} from "@/lib/costing-apply";
import { isAllowedProbability } from "@/lib/forecast";

/**
 * Reassign a quotation's SALES OWNER (deal owner) — m066.
 *
 * Management-only (real role). The deal owner flows down to the task list
 * and production order (they read the quotation's owner), so this one
 * control attributes the whole affair. "__unassign__" clears it (falls
 * back to the creator). Defensive if m066 isn't applied.
 */
export async function assignDocumentOwner(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing quotation id");
  const raw = String(formData.get("owner_id") ?? "");
  const owner_id = raw && raw !== "__unassign__" ? raw : null;

  const { role } = await getCurrentUserRole();
  if (!canSupervise(role)) {
    throw new Error("Only management roles can reassign the sales owner.");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({ sales_owner_id: owner_id })
    .eq("id", id);
  if (error) {
    if (/sales_owner_id/.test(error.message ?? "")) {
      throw new Error(
        "sales_owner_id column missing — apply migration m066 (066_sales_owner_assignment.sql)."
      );
    }
    throw new Error(error.message);
  }

  revalidatePath(`/documents/${id}`);
  revalidatePath("/clients");
  revalidatePath("/task-lists");
  revalidatePath("/production/queue");
}

/**
 * Update the lightweight forecast on a quotation. Auto-save target —
 * the ForecastPanel fires this on every chip click / date change, so
 * it must be fast and idempotent.
 *
 * Scope: RLS enforces ownership (sales edits their own quotations;
 * admin/TLM/operations edit any). No extra capability gate — touching
 * a forecast is a normal sales operation, not a destructive one.
 *
 * Any of the three fields can be passed independently. We always bump
 * forecast_updated_at + forecast_updated_by so the staleness clock
 * resets on every edit. Empty string clears a field (null).
 */
export async function updateQuotationForecast(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing document id");

  const probRaw = formData.get("probability");
  const dateRaw = formData.get("expected_close_date");

  const update: Record<string, unknown> = {};

  // Probability — CONTROLLED values only: 10–90 by 10, 95, 100 (or
  // empty to clear). Free values (33, 45, 67…) are rejected — the
  // forecast stays simple and standardized.
  if (probRaw !== null) {
    const s = String(probRaw).trim();
    if (s === "") {
      update.forecast_probability = null;
    } else {
      const n = Number(s);
      if (!Number.isFinite(n) || !isAllowedProbability(n)) {
        throw new Error(`Invalid probability value: ${s}`);
      }
      update.forecast_probability = n;
    }
  }

  // Expected close date — YYYY-MM-DD (or empty to clear).
  if (dateRaw !== null) {
    const s = String(dateRaw).trim();
    if (s === "") {
      update.forecast_expected_close_date = null;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      throw new Error(`Invalid date: ${s}`);
    } else {
      update.forecast_expected_close_date = s;
    }
  }

  if (Object.keys(update).length === 0) {
    // Nothing to change — no-op (defensive against empty submits).
    return;
  }

  const { userId } = await getCurrentUserRole();
  update.forecast_updated_at = new Date().toISOString();
  update.forecast_updated_by = userId;
  // Consumed by the forecast audit trigger (m158) — every event this
  // write produces is tagged with its origin.
  update.forecast_change_source = "manual_edit";

  const supabase = createClient();
  let { error } = await supabase.from("documents").update(update).eq("id", id);
  if (error && /forecast_change_source/.test(error.message ?? "")) {
    // m158 not applied yet — retry without the audit-source column so
    // the forecast keeps working (dormant audit until migration).
    delete update.forecast_change_source;
    ({ error } = await supabase.from("documents").update(update).eq("id", id));
  }
  if (error) {
    const msg = error.message ?? "";
    if (/forecast_probability_check/.test(msg)) {
      throw new Error(
        "Probability value rejected by the database — apply migration m158 (158_forecast_standard_probabilities_and_audit.sql) in Supabase."
      );
    }
    if (/forecast_/.test(msg)) {
      throw new Error(
        "Forecast columns missing — apply migration m050 (050_quotation_forecast.sql) in Supabase."
      );
    }
    throw new Error(msg);
  }

  revalidatePath(`/documents/${id}`);
  revalidatePath("/forecast");
  revalidatePath("/dashboard");
}

/**
 * Clear the entire forecast on a quotation (probability + date).
 * Resets the timestamp to null too, so the deal drops out of weighted
 * projections cleanly.
 */
export async function clearQuotationForecast(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing document id");

  const supabase = createClient();
  const clear: Record<string, unknown> = {
    forecast_probability: null,
    forecast_expected_close_date: null,
    forecast_updated_at: null,
    forecast_updated_by: null,
    forecast_change_source: "manual_edit",
  };
  let { error } = await supabase.from("documents").update(clear).eq("id", id);
  if (error && /forecast_change_source/.test(error.message ?? "")) {
    // m158 not applied yet — dormant audit, clear still works.
    delete clear.forecast_change_source;
    ({ error } = await supabase.from("documents").update(clear).eq("id", id));
  }
  if (error && !/forecast_/.test(error.message ?? "")) {
    throw new Error(error.message);
  }

  revalidatePath(`/documents/${id}`);
  revalidatePath("/forecast");
  revalidatePath("/dashboard");
}

export async function savePdfPath(documentId: string, path: string) {
  if (!documentId || !path) throw new Error("Missing arguments");

  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({ pdf_url: path })
    .eq("id", documentId);
  if (error) throw new Error(error.message);

  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/clients");
  revalidatePath("/dashboard");
}

export async function generateProductionTaskList(formData: FormData) {
  const quotation_id = String(formData.get("quotation_id"));
  if (!quotation_id) throw new Error("Missing quotation id");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Already linked? Just route to it.
  const { data: existing } = await supabase
    .from("production_task_lists")
    .select("id")
    .eq("quotation_id", quotation_id)
    .maybeSingle();
  if (existing) redirect(`/task-lists/${existing.id}`);

  // Fetch the source quotation + its lines.
  //
  // We also pull `number` so the PTL can inherit the quotation
  // reference instead of getting a generic PTL-YY-NNNN counter.
  // Operational tracking gets MUCH cleaner this way — sales,
  // production and factory all see the same root identifier.
  //   Quote   SLX-SUK-26-034  →  PTL  PTL-SLX-SUK-26-034
  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, number, type, client_id, affair_id, freight_type, original_sales_request")
    .eq("id", quotation_id)
    .single();
  if (docErr || !doc) throw new Error(docErr?.message ?? "Quotation not found");

  // Solux export workflow (owner decision 2026-06-12): a Sales Order is
  // created from a PROFORMA INVOICE, never directly from a quotation.
  //   Quotation (optional) → Proforma → Sales Order → Production → Shipment
  // The quotation is the negotiation document; the proforma is the
  // confirmed commercial document the client commits (and pays deposit)
  // against. Existing historical task lists are untouched — this gate
  // only applies to NEW creations.
  if ((doc as any).type !== "proforma") {
    throw new Error(
      "Sales orders are created from PROFORMA invoices, not quotations (Solux export workflow). Revise this quotation into a proforma first (Duplicate / Revise → type Proforma), mark it won, then create the task list from the proforma."
    );
  }
  // Core-mandatory affair: a task list with no affaire is invisible to
  // affair-keyed views (Orders in Flight groups won-quote ↔ task-list on
  // affair_id). Refuse rather than mint an orphaned task list.
  if (!(doc as any).affair_id) {
    throw new Error(
      "Ce proforma n'est rattaché à aucune affaire. Rattachez-le à une affaire avant de créer la task list de production (l'affaire est obligatoire pour le suivi)."
    );
  }

  const { data: srcLines, error: linesErr } = await supabase
    .from("document_lines")
    .select(
      // unit_price comes across for MANUAL items only — a read-only reference
      // price (poles are bought per-project). The commercial source of truth
      // stays the proforma; we never edit this on the task list (m135).
      "id, product_id, category_id, quantity, config_values, selected_options, client_product_name, unit_price"
    )
    .eq("document_id", quotation_id);
  if (linesErr) throw new Error(linesErr.message);

  // ---------------------------------------------------------------------
  // PTL numbering strategy
  // ---------------------------------------------------------------------
  // Preferred: inherit the doc number → "PTL-<doc.number>". Each quote
  // can only spawn ONE task list (enforced by the early `existing`
  // check above), so this is naturally unique.
  //
  // Fallback: if for some reason the doc has no number (legacy rows,
  // partial inserts), fall back to the generic counter via the RPC.
  // We never want the action to fail just because numbering had a
  // weird edge case.
  let ptlNumber: string;
  if (doc.number) {
    ptlNumber = `PTL-${doc.number}`;
  } else {
    const { data: numberRow, error: numErr } = await supabase.rpc(
      "next_task_list_number"
    );
    if (numErr) throw new Error(numErr.message);
    ptlNumber = numberRow as unknown as string;
  }

  // m159 — seed the production tilt angle from the Service Request of the
  // same affaire (Sales states it there; it drives the pole drawing). Latest
  // SR with a value wins. Defensive: pre-migration (or no SR) → null.
  let tiltFromSR: number | null = null;
  try {
    const { data: sr } = await supabase
      .from("project_requests")
      .select("solar_panel_tilt_angle")
      .eq("affair_id", (doc as any).affair_id)
      .not("solar_panel_tilt_angle", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const v = (sr as any)?.solar_panel_tilt_angle;
    tiltFromSR = typeof v === "number" && Number.isFinite(v) ? v : v != null ? Number(v) : null;
    if (tiltFromSR != null && !Number.isFinite(tiltFromSR)) tiltFromSR = null;
  } catch {
    tiltFromSR = null;
  }

  const tlRow: Record<string, any> = {
    number: ptlNumber,
    quotation_id,
    client_id: doc.client_id,
    // F4: inherit the affair link from the source doc so the task list stays
    // grouped under its affaire (docs-by-affaire views + affair-scoped RLS).
    affair_id: (doc as any).affair_id ?? null,
    original_sales_request: (doc as any).original_sales_request ?? null, // m134
    shipping_method: doc.freight_type,
    created_by: user.id,
    // New workflow starts in draft — sales still has work to do before
    // submitting for production validation. Explicit so we don't depend
    // on whatever the column default happens to be at any given time.
    status: "draft",
  };
  let { data: inserted, error: insErr } = await supabase
    .from("production_task_lists")
    .insert({ ...tlRow, solar_panel_tilt_angle: tiltFromSR })
    .select("id")
    .single();
  if (insErr && /solar_panel_tilt_angle/i.test(insErr.message ?? "")) {
    // m159 not applied yet — create the task list without the tilt column.
    ({ data: inserted, error: insErr } = await supabase
      .from("production_task_lists")
      .insert(tlRow)
      .select("id")
      .single());
  }
  if (insErr) throw new Error(insErr.message);

  // Copy each quotation line into a task list line. The shared pure builder
  // (lib/manual-items) applies the m135 MANUAL-item rule: a line with no
  // product AND no category (poles/masts and any future custom line) becomes a
  // manual item — its free-text name is snapshotted into product_name (the
  // column the page + factory exports already read) and the quoted unit price
  // is copied as a read-only reference. Catalog + Service-Request lines (with a
  // category) are untouched. It also merges legacy selected_options into
  // config_values so factory teams see everything.
  const rows = (srcLines ?? []).map((l: any, i: number) =>
    buildTaskListLineFromQuotationLine(l, inserted!.id, i)
  );
  if (rows.length) {
    let { error: tlErr } = await supabase
      .from("production_task_list_lines")
      .insert(rows);
    // Resilience: if the m135 columns aren't migrated yet, retry WITHOUT them so
    // Launch Production keeps working for catalog quotations. product_name (the
    // manual item's name) is an m089 column that already exists, so poles still
    // get their name; only the is_manual flag + reference price wait for m135.
    if (tlErr && /is_manual|unit_price/i.test(tlErr.message)) {
      const legacyRows = rows.map(
        ({ is_manual, unit_price, ...rest }) => rest
      );
      ({ error: tlErr } = await supabase
        .from("production_task_list_lines")
        .insert(legacyRows));
    }
    if (tlErr) throw new Error(tlErr.message);
  }

  revalidatePath(`/documents/${quotation_id}`);
  revalidatePath("/task-lists");
  redirect(`/task-lists/${inserted!.id}`);
}

/**
 * "Launch Production" — the one-click WON → production handoff for sales.
 *
 * The commercial never touches proforma mechanics (owner decision). From a
 * WON quotation this creates, in the background:
 *   1) the PROFORMA = the production command (a faithful copy of the won
 *      quotation, type='proforma'), and
 *   2) the production TASK LIST from that proforma (the gated path below
 *      requires type='proforma'),
 * then routes the user straight to the task list.
 *
 * Proforma STATUS is 'draft' ON PURPOSE: revenue / win-rate analytics count
 * the WON QUOTATION (status='won'); a 'won' proforma would double-count the
 * same deal. The proforma carries the production cycle through its task list,
 * not through its document status.
 *
 * One command per affair: if a proforma already exists for the affair we
 * reuse it (and route to / create its task list) instead of minting a second.
 */
export async function launchProduction(formData: FormData) {
  // Creating the proforma is a second "create" path — gate like saveDocument.
  await requireCapability("quotation.create");
  const quotationId = String(
    formData.get("quotation_id") ?? formData.get("id") ?? ""
  );
  if (!quotationId) throw new Error("Missing quotation id");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: src, error } = await supabase
    .from("documents")
    .select("*, document_lines(*), document_containers(*)")
    .eq("id", quotationId)
    .single();
  if (error || !src) throw new Error(error?.message ?? "Quotation not found");
  if (src.type !== "quotation") {
    throw new Error("Launch Production starts from a quotation.");
  }
  if (src.status !== "won") {
    throw new Error("Mark the quotation as Won before launching production.");
  }
  // Affair is the ERP backbone (core-mandatory). Launching without one would
  // silently propagate a NULL affair into the proforma → task list → order,
  // making the whole chain invisible to affair-keyed views (Orders in Flight).
  // Refuse instead of creating an orphaned production command.
  if (!src.affair_id) {
    throw new Error(
      "Cette cotation n'est rattachée à aucune affaire. Rattachez-la à une affaire avant de lancer la production — l'affaire est obligatoire pour suivre la commande (sinon elle n'apparaît pas dans « Orders in Flight »)."
    );
  }

  // One command per affair — reuse an existing proforma if there is one.
  let proformaId: string | null = null;
  if (src.affair_id) {
    const { data: existingPro } = await supabase
      .from("documents")
      .select("id")
      .eq("affair_id", src.affair_id)
      .eq("type", "proforma")
      // NB: order by `date` — the live `documents` table has no `created_at`.
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingPro) proformaId = existingPro.id as string;
  }

  if (!proformaId) {
    // Per-client numbering (SLX-CODE-YY-NNN), generic fallback.
    let numberRow: string | null = null;
    if (src.client_id) {
      const { data, error: nErr } = await supabase.rpc(
        "next_client_document_number",
        { client_id_in: src.client_id }
      );
      if (nErr) throw new Error(nErr.message);
      numberRow = data as any;
    } else {
      const { data } = await supabase.rpc("next_document_number", {
        doc_type: "proforma",
      });
      numberRow = data as any;
    }

    const { data: pro, error: insErr } = await supabase
      .from("documents")
      .insert({
        number: numberRow,
        client_id: src.client_id,
        affair_id: src.affair_id,
        original_sales_request: src.original_sales_request ?? null, // m134
        type: "proforma",
        status: "draft",
        incoterm: src.incoterm,
        freight_type: src.freight_type,
        freight_cost: src.freight_cost,
        // m146 — carry logistics extras (undefined omitted pre-migration).
        insurance_cost: src.insurance_cost,
        additional_charges: src.additional_charges,
        manual_pricing: src.manual_pricing,
        total_price: src.total_price,
        created_by: user.id,
        payment_mode: src.payment_mode,
        payment_terms: src.payment_terms,
        port_of_loading: src.port_of_loading,
        port_of_destination: src.port_of_destination,
        production_mode: src.production_mode,
        production_days: src.production_days,
        production_date: src.production_date,
        currency: src.currency,
        include_sales_conditions: src.include_sales_conditions,
        sales_conditions_id: src.sales_conditions_id,
        bank_account_id: src.bank_account_id,
        purchase_order_number: src.purchase_order_number,
        commission_enabled: src.commission_enabled,
        commission_percentage: src.commission_percentage,
        commission_amount: src.commission_amount,
        commission_description: src.commission_description,
        show_commission_in_pdf: src.show_commission_in_pdf,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);
    proformaId = pro!.id as string;

    const lines = (src.document_lines ?? []).map((l: any) => ({
      document_id: proformaId,
      product_id: l.product_id,
      category_id: l.category_id ?? null, // m133 — keep the family across the copy
      quantity: l.quantity,
      selected_options: l.selected_options,
      unit_price: l.unit_price,
      total_price: l.total_price,
      pricing_mode: l.pricing_mode,
      pricing_tier: l.pricing_tier,
      original_unit_price: l.original_unit_price,
      discount_type: l.discount_type,
      discount_value: l.discount_value,
      client_product_name: l.client_product_name,
      config_values: l.config_values ?? {},
    }));
    if (lines.length) {
      const { error: lErr } = await supabase
        .from("document_lines")
        .insert(lines);
      if (lErr) throw new Error(lErr.message);
    }

    const containers = (src.document_containers ?? []).map(
      (c: any, i: number) => ({
        document_id: proformaId,
        container_type: c.container_type,
        quantity: c.quantity,
        unit_price: c.unit_price,
        wooden_box_cost: c.wooden_box_cost ?? 0,
        position: c.position ?? i,
      })
    );
    if (containers.length) {
      const { error: cErr } = await supabase
        .from("document_containers")
        .insert(containers);
      if (cErr) throw new Error(cErr.message);
    }

    await emitEvent({
      entity_type: "document",
      entity_id: proformaId,
      event_type: "doc.created",
      message: `Proforma ${numberRow ?? ""} created — production command from won quotation ${
        src.number ?? quotationId.slice(0, 8) + "…"
      }`,
      payload: {
        type: "proforma",
        from_quotation: quotationId,
        from_quotation_number: src.number ?? null,
        number: numberRow,
      },
      bestEffort: true,
    });
  }

  if (!proformaId) {
    throw new Error("Could not create the production command (proforma).");
  }

  revalidatePath(`/documents/${quotationId}`);
  revalidatePath(`/documents/${proformaId}`);
  revalidatePath("/clients");

  // Create the task list from the proforma (gate satisfied) and route to it.
  // generateProductionTaskList redirect()s — the desired landing for the user
  // kicking off production.
  const tlFd = new FormData();
  tlFd.set("quotation_id", proformaId);
  await generateProductionTaskList(tlFd);
}

/**
 * Update quotation status — generic action used by the status switcher.
 *
 * Side effects on cancellation/loss are now handled by the DB trigger
 * `propagate_document_cancellation` (migration 023): if the new status
 * is 'cancelled' or 'lost', linked task lists and production orders
 * are automatically cancelled too. This action just emits the
 * corresponding event row for auditability — the cascade events are
 * inserted by the trigger itself.
 */
export async function updateDocumentStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const raw = String(formData.get("status"));
  if (!id) throw new Error("Missing document id");
  if (!DOC_STATUSES.includes(raw as DocStatus)) {
    throw new Error(`Invalid status: ${raw}`);
  }

  // Capability gate for the destructive transitions only. draft/sent/
  // negotiating/won/lost are normal sales operations (RLS handles
  // "is it your doc"). 'cancelled' is the explicit operational kill
  // that cascades via the DB trigger to task lists + production
  // orders — so we require the matching capability per Q2.
  if (raw === "cancelled") {
    await requireCapability("quotation.cancel");
  }

  const supabase = createClient();
  // Capture previous status for the audit event.
  const { data: prev } = await supabase
    .from("documents")
    .select("status, number, type")
    .eq("id", id)
    .maybeSingle();
  const previousStatus = (prev?.status as DocStatus) ?? null;

  // Data-integrity guard: a PROFORMA is the production command (created by
  // Launch Production), never a revenue-bearing "won" deal. Revenue/win-rate
  // analytics count status='won'; a won proforma would double-count the affair
  // (won quotation + won proforma). The proforma carries production through its
  // task list, not its document status.
  if (raw === "won" && (prev as any)?.type === "proforma") {
    throw new Error(
      "A proforma is the production command, not a won deal — it can't be marked Won. The originating quotation carries the win."
    );
  }

  // ---- Lifecycle guards (LIFECYCLE_AUDIT H1 + H2) -----------------------
  // Document status is otherwise a freeform setter. These two guards block
  // the transitions that silently DE-SYNC a quotation from production it
  // already spawned. The supported path back into the lifecycle is
  // "Edit → new version (revise)", which leaves the historical records
  // intact. Both checks only run on the rare offending transitions, so
  // normal status changes pay no extra query cost.
  const target = raw as DocStatus;

  // H1 — a WON quote must not revert to an editable pre-won status.
  // Reverting to draft re-enables edit-in-place (documents/new/actions.ts),
  // letting commercial figures be rewritten after a task list / PO copied
  // them. If production exists → blocked for everyone (revise/cancel
  // instead); with no production, only an admin may undo a mis-marked win.
  const EDITABLE_PREWON: DocStatus[] = ["draft", "sent", "negotiating"];
  if (previousStatus === "won" && EDITABLE_PREWON.includes(target)) {
    const [tlRes, poRes] = await Promise.all([
      supabase
        .from("production_task_lists")
        .select("id", { count: "exact", head: true })
        .eq("quotation_id", id),
      supabase
        .from("production_orders")
        .select("id", { count: "exact", head: true })
        .eq("quotation_id", id),
    ]);
    const hasDownstream = (tlRes.count ?? 0) > 0 || (poRes.count ?? 0) > 0;
    if (hasDownstream) {
      throw new Error(
        "This won quotation has a task list / production order — create a new version (revise) to change figures, or cancel the order. It can't be moved back to draft."
      );
    }
    const { role } = await getCurrentUserRole();
    if (!isAdminLike(role)) {
      throw new Error(
        "A won quotation can't be moved back to draft/sent — create a new version (revise) instead. (An admin can reopen one that has no production.)"
      );
    }
  }

  // H2 — reopening a cancelled/lost quote must not resurrect it at the
  // document layer while its cascade-cancelled task list / PO stay dead
  // (the m023 trigger only cascades INTO cancelled/lost, never back out).
  // Block only when cancelled children exist (i.e. it had production);
  // a lost lead with no production reopens freely.
  const ACTIVE_TARGETS: DocStatus[] = ["draft", "sent", "negotiating", "won"];
  if (
    (previousStatus === "cancelled" || previousStatus === "lost") &&
    ACTIVE_TARGETS.includes(target)
  ) {
    const [tlCancelled, poCancelled] = await Promise.all([
      supabase
        .from("production_task_lists")
        .select("id", { count: "exact", head: true })
        .eq("quotation_id", id)
        .eq("status", "cancelled"),
      supabase
        .from("production_orders")
        .select("id", { count: "exact", head: true })
        .eq("quotation_id", id)
        .eq("status", "cancelled"),
    ]);
    const hasCancelledChildren =
      (tlCancelled.count ?? 0) > 0 || (poCancelled.count ?? 0) > 0;
    if (hasCancelledChildren) {
      throw new Error(
        "This quotation was cancelled and its task list / production order were cancelled with it. Re-open by creating a new version (revise) — the cancelled production can't be auto-restored."
      );
    }
  }

  // ---- m140/m153 SEND-GATE (two-policy expiry enforcement) ---------------
  // Owner rule: Policy 1 (default) = a quotation on an EXPIRED costing can
  // still be sent — red banner + history event. Policy 2 (setting ON) = the
  // send to the client is BLOCKED until a new costing is approved; the draft
  // stays editable/saveable/printable. Gate covers sent AND negotiating
  // (draft→negotiating is one click away from send). Won is never blocked.
  // Every read soft-fails ⇒ unmigrated envs skip the gate entirely.
  if (target === "sent" || target === "negotiating") {
    try {
      const settings = await loadCostingSettings(supabase);
      const { data: lockedLines } = await supabase
        .from("document_lines")
        .select("source_project_request_id, approved_at")
        .eq("document_id", id)
        .eq("pricing_source", "approved_service_request")
        .not("source_project_request_id", "is", null);
      const srIds = Array.from(
        new Set(
          ((lockedLines ?? []) as any[])
            .map((l) => l.source_project_request_id)
            .filter(Boolean)
        )
      ) as string[];
      if (srIds.length) {
        const { data: snaps } = await supabase
          .from("project_products")
          .select("project_request_id, priced_at")
          .in("project_request_id", srIds);
        const oldest = ((snaps ?? []) as any[])
          .map((s) => s.priced_at as string | null)
          .filter(Boolean)
          .sort()[0] as string | undefined;
        const status = computeCostingStatus(
          oldest ?? null,
          new Date().toISOString().slice(0, 10),
          settings
        );
        if (status.status === "expired") {
          if (settings.requireRevisionWhenExpired) {
            let pendingExists = false;
            try {
              const { count } = await supabase
                .from("project_costing_versions")
                .select("id", { count: "exact", head: true })
                .in("project_request_id", srIds)
                .eq("status", "pending");
              pendingExists = (count ?? 0) > 0;
            } catch {
              /* pre-m140 */
            }
            throw new Error(
              pendingExists
                ? "This quotation cannot be sent yet: a costing revision is already requested — waiting for the Director's approval."
                : "This quotation cannot be sent because the linked costing has expired. Please request and approve a new costing revision before sending it to the customer."
            );
          }
          // Policy 1 — allowed, but the risk acceptance goes into history.
          await emitEvent({
            entity_type: "document",
            entity_id: id,
            event_type: "doc.sent_with_expired_costing",
            message: `Marked ${target} while the linked costing was expired (${status.label}).`,
            payload: { age_days: status.ageDays },
            bestEffort: true,
          });
        }
      }
    } catch (e) {
      // Re-throw ONLY our explicit policy block; any data/column error means
      // an unmigrated env → the gate stays dormant.
      if (e instanceof Error && /cannot be sent/.test(e.message)) throw e;
    }
  }

  const { error } = await supabase
    .from("documents")
    .update({ status: raw })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Audit log — pick the right event_type + severity. won / lost /
  // cancelled get distinct types so the dashboard "Recent critical
  // events" feed can filter them precisely.
  const eventType =
    raw === "won"
      ? "doc.won"
      : raw === "lost"
        ? "doc.lost"
        : raw === "cancelled"
          ? "doc.cancelled"
          : "doc.status_changed";
  await emitEvent({
    entity_type: "document",
    entity_id: id,
    event_type: eventType,
    message:
      raw === "cancelled"
        ? `Quotation ${prev?.number ?? id.slice(0, 8) + "…"} cancelled — linked task lists and production orders auto-cancelled`
        : `Status: ${previousStatus ?? "—"} → ${raw}`,
    payload: { from: previousStatus, to: raw, number: prev?.number ?? null },
    bestEffort: true,
  });

  // Revalidate every place this status can show up.
  revalidatePath(`/documents/${id}`);
  revalidatePath("/clients");
  revalidatePath("/dashboard");
  revalidatePath("/operations");
  revalidatePath("/order-follow-up");
  revalidatePath("/business");
}

/**
 * Cancel a quotation — sets status to 'cancelled'. The DB trigger
 * (migration 023) cascades to task lists + production orders.
 *
 * Allowed for: any authenticated user with edit rights on the doc
 * (RLS handles the actual scope). The cascade is enforced by Postgres
 * regardless of the caller's role.
 */
export async function cancelQuotation(formData: FormData) {
  await requireCapability("quotation.cancel");
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!id) throw new Error("Missing document id");

  const supabase = createClient();
  const { data: prev } = await supabase
    .from("documents")
    .select("status, number")
    .eq("id", id)
    .maybeSingle();
  if (!prev) throw new Error("Quotation not found");

  const { error } = await supabase
    .from("documents")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "document",
    entity_id: id,
    event_type: "doc.cancelled",
    severity: "critical",
    message: `Quotation ${prev.number ?? id.slice(0, 8) + "…"} cancelled${
      reason ? ` — ${reason}` : ""
    }`,
    payload: { from: prev.status, to: "cancelled", reason, number: prev.number },
    bestEffort: true,
  });

  revalidatePath(`/documents/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/operations");
  revalidatePath("/order-follow-up");
  revalidatePath("/business");
  revalidatePath("/clients");
}

/**
 * Archive a quotation — sets archived_at (soft delete). The row stays
 * in the database and remains visible to anyone who opts into seeing
 * archived rows, but disappears from default lists.
 *
 * Admin-only. The DB triggers don't fire on archive (archive is
 * orthogonal to status), so the linked task lists and POs stay where
 * they are. If you want to archive them too, archive them one by one
 * — we intentionally don't cascade archives to avoid surprising sweeps.
 */
export async function archiveQuotation(formData: FormData) {
  await requireCapability("quotation.archive");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing document id");

  const { userId } = await getCurrentUserRole();
  const supabase = createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("documents")
    .update({ archived_at: now, archived_by: userId })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "document",
    entity_id: id,
    event_type: "doc.status_changed",
    severity: "medium",
    message: "Quotation archived",
    payload: { archived_at: now },
    bestEffort: true,
  });

  revalidatePath(`/documents/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  revalidatePath("/business");
}

/** Reverse of archiveQuotation. */
export async function unarchiveQuotation(formData: FormData) {
  await requireCapability("quotation.archive");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing document id");

  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({ archived_at: null, archived_by: null })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "document",
    entity_id: id,
    event_type: "doc.status_changed",
    severity: "low",
    message: "Quotation unarchived",
    payload: {},
    bestEffort: true,
  });

  revalidatePath(`/documents/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/clients");
  revalidatePath("/business");
}

/**
 * Hard delete a quotation. Super-admin only.
 *
 * This is the nuclear option — the row is gone from the database. The
 * FK CASCADE from `production_orders → documents` (migration 018:47)
 * will physically delete linked POs too. Use exclusively for:
 *   - RGPD takedowns
 *   - Test data cleanup
 *   - Deduplication
 *
 * For everything else, prefer cancelQuotation (sales-visible) or
 * archiveQuotation (admin-only).
 */
export async function deleteQuotation(formData: FormData) {
  await requireCapability("quotation.delete");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing document id");
  // Where to go after deleting. Default = STAY on the current page (the
  // Clients view, where users clean up several quotations in a row without
  // losing their place). A caller on the doc detail page passes an explicit
  // destination since that page no longer exists after deletion.
  const redirectTo = String(formData.get("redirect_to") ?? "").trim();

  const supabase = createClient();
  // Capture context for the audit event — once the row is gone, we
  // can't reconstruct it.
  const { data: ctx } = await supabase
    .from("documents")
    .select("number, status, client_id, total_price")
    .eq("id", id)
    .maybeSingle();

  // Decision F — never silently cascade-delete production records. A quotation
  // with any task list or production order must be cancelled/archived, not
  // deleted (production_task_lists / production_orders FK to documents are
  // ON DELETE CASCADE, so a delete would wipe those rows).
  const [tlRes, poRes] = await Promise.all([
    supabase
      .from("production_task_lists")
      .select("id", { count: "exact", head: true })
      .eq("quotation_id", id),
    supabase
      .from("production_orders")
      .select("id", { count: "exact", head: true })
      .eq("quotation_id", id),
  ]);
  if ((tlRes.count ?? 0) > 0 || (poRes.count ?? 0) > 0) {
    throw new Error(
      "This quotation has a task list or production order — cancel or archive it instead of deleting."
    );
  }
  // Won quotations are a commercial commitment: only admins may delete one
  // (and only because it has no production, per the check above).
  if (ctx?.status === "won") {
    const { role } = await getCurrentUserRole();
    if (!isAdminLike(role)) {
      throw new Error(
        "Won quotations can't be deleted — cancel or archive it instead (an admin can remove one that has no production)."
      );
    }
  }

  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "document",
    entity_id: id,
    event_type: "doc.deleted",
    severity: "critical",
    message: `Quotation ${ctx?.number ?? id.slice(0, 8) + "…"} permanently deleted`,
    payload: {
      number: ctx?.number ?? null,
      previous_status: ctx?.status ?? null,
      client_id: ctx?.client_id ?? null,
      total_price: ctx?.total_price ?? null,
    },
    bestEffort: true,
  });

  revalidatePath("/dashboard");
  revalidatePath("/clients");
  revalidatePath("/business");
  // Only navigate when the caller explicitly asks; otherwise the page just
  // refreshes in place (deleted row gone, client card / filters / scroll kept).
  if (redirectTo && redirectTo !== "stay") redirect(redirectTo);
}

/* ===========================================================================
   Advisory validation loop (m068)
   ---------------------------------------------------------------------------
   Light, manual "Request validation" → manager Approve / Request changes.
   ADVISORY: none of this blocks sending or winning a quote — it's a review
   flag + audit trail. RLS already governs who may update which document.
   =========================================================================== */

/**
 * Sales flags a quotation for a manager's review. Sets it pending and
 * clears any prior decision (so re-requesting after changes is clean).
 * Emits a high-severity event so it surfaces in the operations feed.
 */
export async function requestValidation(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing quotation id");
  const note = String(formData.get("note") ?? "").trim() || null;

  const { userId } = await getCurrentUserRole();
  const supabase = createClient();
  const { data: prev } = await supabase
    .from("documents")
    .select("number")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("documents")
    .update({
      validation_status: "pending",
      validation_requested_by: userId,
      validation_requested_at: new Date().toISOString(),
      validation_note: note,
      validation_reviewed_by: null,
      validation_reviewed_at: null,
      validation_review_note: null,
    })
    .eq("id", id);
  if (error) {
    if (/validation_/.test(error.message ?? "")) {
      throw new Error(
        "Validation columns missing — apply migration m068 (068_quotation_validation.sql)."
      );
    }
    throw new Error(error.message);
  }

  await emitEvent({
    entity_type: "document",
    entity_id: id,
    event_type: "doc.validation_requested",
    message: `Validation requested on ${prev?.number ?? id.slice(0, 8) + "…"}${
      note ? ` — ${note}` : ""
    }`,
    payload: { number: prev?.number ?? null, note },
    bestEffort: true,
  });

  revalidatePath(`/documents/${id}`);
  revalidatePath("/operations");
  revalidatePath("/dashboard");
}

/**
 * A manager (technical role) records a decision on a pending request:
 * 'approved' ("looks good") or 'rejected' ("changes requested"), with an
 * optional note that the salesperson sees. Gated on the REAL role.
 */
export async function reviewValidation(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id) throw new Error("Missing quotation id");
  if (decision !== "approved" && decision !== "rejected") {
    throw new Error("Invalid decision.");
  }
  const note = String(formData.get("review_note") ?? "").trim() || null;

  const { userId, role } = await getCurrentUserRole();
  if (!canSupervise(role)) {
    throw new Error("Only Admin / Super Admin / Sales Director can review a quotation validation request.");
  }

  const supabase = createClient();
  const { data: prev } = await supabase
    .from("documents")
    .select("number")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("documents")
    .update({
      validation_status: decision,
      validation_reviewed_by: userId,
      validation_reviewed_at: new Date().toISOString(),
      validation_review_note: note,
    })
    .eq("id", id);
  if (error) {
    if (/validation_/.test(error.message ?? "")) {
      throw new Error(
        "Validation columns missing — apply migration m068 (068_quotation_validation.sql)."
      );
    }
    throw new Error(error.message);
  }

  await emitEvent({
    entity_type: "document",
    entity_id: id,
    event_type:
      decision === "approved"
        ? "doc.validation_approved"
        : "doc.validation_rejected",
    message:
      decision === "approved"
        ? `Validation approved on ${prev?.number ?? id.slice(0, 8) + "…"}${
            note ? ` — ${note}` : ""
          }`
        : `Changes requested on ${prev?.number ?? id.slice(0, 8) + "…"}${
            note ? ` — ${note}` : ""
          }`,
    payload: { number: prev?.number ?? null, decision, note },
    bestEffort: true,
  });

  revalidatePath(`/documents/${id}`);
  revalidatePath("/operations");
  revalidatePath("/dashboard");
}

/**
 * Withdraw a validation request — clears the whole loop back to none.
 * For the requester who no longer needs the review (or wants to reset).
 */
export async function cancelValidationRequest(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing quotation id");

  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({
      validation_status: null,
      validation_requested_by: null,
      validation_requested_at: null,
      validation_note: null,
      validation_reviewed_by: null,
      validation_reviewed_at: null,
      validation_review_note: null,
    })
    .eq("id", id);
  if (error && !/validation_/.test(error.message ?? "")) {
    throw new Error(error.message);
  }

  revalidatePath(`/documents/${id}`);
  revalidatePath("/operations");
  revalidatePath("/dashboard");
}

// ===================== m140/m153 — newer-costing Keep / Apply =====================

/**
 * Apply the latest APPROVED costing version to a DRAFT quotation — explicit,
 * selective (owner decision: checklist Product / Pole / Freight / Transport),
 * never automatic. A sent document is the record of what the client received
 * (H1 principle): non-drafts must go through "revise" instead.
 *
 * The line/totals math lives in lib/costing-apply (pure, tested; refuses
 * ambiguity rather than guessing a price).
 */
export async function applyLatestCosting(formData: FormData): Promise<void> {
  await requireCapability("project.generate_quotation");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing document id");
  const selections: ApplySelections = {
    product: formData.get("sel_product") === "on",
    pole: formData.get("sel_pole") === "on",
    freight: formData.get("sel_freight") === "on",
    transport: formData.get("sel_transport") === "on",
  };
  if (!selections.product && !selections.pole && !selections.freight && !selections.transport) {
    throw new Error("Select at least one item to update.");
  }
  const supabase = createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select(
      "id, status, freight_cost, commission_enabled, commission_percentage, insurance_cost, additional_charges"
    )
    .eq("id", id)
    .maybeSingle();
  if (!doc) throw new Error("Document not found or not visible.");
  if ((doc as any).status !== "draft") {
    throw new Error(
      "Only a draft can take the new costing directly — create a new version (revise) to apply it to a sent quotation."
    );
  }

  // Lines (m140→m139 fallback).
  const LINE_BASE =
    "id, quantity, total_price, original_unit_price, discount_type, discount_value, pricing_source, source_project_request_id, category_id, client_product_name, config_values";
  let linesRes: { data: any[] | null; error: any } = await supabase
    .from("document_lines")
    .select(`${LINE_BASE}, source_component`)
    .eq("document_id", id);
  if (linesRes.error) {
    linesRes = await supabase.from("document_lines").select(LINE_BASE).eq("document_id", id);
  }
  const lines = (linesRes.data ?? []) as any[];
  const srIds = Array.from(
    new Set(lines.map((l) => l.source_project_request_id).filter(Boolean))
  ) as string[];
  if (!srIds.length) throw new Error("This document has no Service-Request lines to update.");

  // Latest approved version across the involved SRs (newest approval wins).
  const { data: versions, error: vErr } = await supabase
    .from("project_costing_versions")
    .select(
      "id, project_request_id, version_no, status, product_unit_price, pole_unit_price, previous_product_unit_price, previous_pole_unit_price, approved_by, approved_at, freight_total, containers, incoterm, port_of_destination"
    )
    .in("project_request_id", srIds)
    .eq("status", "approved");
  if (vErr) throw new Error("Costing versions are not available yet (m140 not applied).");
  const version = ((versions ?? []) as any[]).sort((a, b) =>
    String(b.approved_at ?? "").localeCompare(String(a.approved_at ?? ""))
  )[0] as ApplyVersion & { project_request_id?: string } | undefined;
  if (!version) throw new Error("No approved costing version found for this document's Service Request.");

  const result = applySelectionsToLines(lines as ApplyLine[], version, selections);
  if (!result.ok) throw new Error(result.error);

  for (const u of result.updates) {
    const { error } = await supabase
      .from("document_lines")
      .update({
        original_unit_price: u.original_unit_price,
        unit_price: u.unit_price,
        total_price: u.total_price,
        approved_by: u.approved_by,
        approved_at: u.approved_at,
      })
      .eq("id", u.id);
    if (error) throw new Error(error.message);
  }

  // Freight — replace the shipping rows with the version's snapshot.
  let containers = [] as any[];
  if (selections.freight) {
    const snapshot = versionContainers(version);
    if (!snapshot.length) throw new Error("The new costing has no freight breakdown to apply.");
    await supabase.from("document_containers").delete().eq("document_id", id);
    const rows = snapshot.map((c, i) => ({
      document_id: id,
      container_type: c.container_type,
      quantity: c.quantity,
      unit_price: c.unit_price,
      wooden_box_cost: c.wooden_box_cost ?? 0,
      position: i,
    }));
    const ins = await supabase.from("document_containers").insert(rows);
    if (ins.error && /wooden_box_cost/.test(ins.error.message ?? "")) {
      await supabase
        .from("document_containers")
        .insert(rows.map(({ wooden_box_cost, ...rest }) => rest));
    } else if (ins.error) {
      throw new Error(ins.error.message);
    }
    containers = snapshot;
  } else {
    const { data: existing } = await supabase
      .from("document_containers")
      .select("container_type, quantity, unit_price, wooden_box_cost")
      .eq("document_id", id);
    containers = (existing ?? []) as any[];
  }

  // Transport assumptions.
  if (selections.transport) {
    const patch: Record<string, unknown> = {};
    if ((version as any).incoterm) patch.incoterm = (version as any).incoterm;
    if ((version as any).port_of_destination)
      patch.port_of_destination = (version as any).port_of_destination;
    if (Object.keys(patch).length) {
      await supabase.from("documents").update(patch).eq("id", id);
    }
  }

  // Recompute the derived money columns (exact saveDocument formula,
  // m146 insurance + additional charges included).
  const { data: freshLines } = await supabase
    .from("document_lines")
    .select("total_price")
    .eq("document_id", id);
  const totals = recomputeDocTotals({
    lineTotals: ((freshLines ?? []) as any[]).map((l) => Number(l.total_price) || 0),
    containers: containers as any,
    legacyFreightCost: (doc as any).freight_cost,
    commission_enabled: (doc as any).commission_enabled,
    commission_percentage: (doc as any).commission_percentage,
    insurance_cost: (doc as any).insurance_cost,
    additional_charges: (doc as any).additional_charges,
  });
  const docPatch: Record<string, unknown> = {
    total_price: totals.total_price,
    commission_amount: totals.commission_amount,
    freight_cost: totals.freight_total,
  };
  {
    const attempt = await supabase
      .from("documents")
      .update({ ...docPatch, costing_version_ack: (version as any).id })
      .eq("id", id);
    if (attempt.error && /costing_version_ack/.test(attempt.error.message ?? "")) {
      const fb = await supabase.from("documents").update(docPatch).eq("id", id);
      if (fb.error) throw new Error(fb.error.message);
    } else if (attempt.error) {
      throw new Error(attempt.error.message);
    }
  }

  await emitEvent({
    entity_type: "document",
    entity_id: id,
    event_type: "doc.costing_applied",
    message: `Latest approved costing applied (${[
      selections.product && "product",
      selections.pole && "pole",
      selections.freight && "freight",
      selections.transport && "transport",
    ]
      .filter(Boolean)
      .join(", ")}).`,
    payload: { version_id: (version as any).id, selections },
    bestEffort: true,
  });
  revalidatePath(`/documents/${id}`);
  revalidatePath("/documents/new");
}

/** Explicitly keep the current costing — silences the prompt for this version. */
export async function keepCurrentCosting(formData: FormData): Promise<void> {
  await requireCapability("project.generate_quotation");
  const id = String(formData.get("id") ?? "");
  const versionId = String(formData.get("version_id") ?? "");
  if (!id || !versionId) throw new Error("Missing document/version id");
  const supabase = createClient();
  const attempt = await supabase
    .from("documents")
    .update({ costing_version_ack: versionId })
    .eq("id", id);
  if (attempt.error && !/costing_version_ack/.test(attempt.error.message ?? "")) {
    throw new Error(attempt.error.message);
  }
  await emitEvent({
    entity_type: "document",
    entity_id: id,
    event_type: "doc.costing_kept",
    message: "Existing costing kept — the newer approved costing was reviewed and declined.",
    payload: { version_id: versionId },
    bestEffort: true,
  });
  revalidatePath(`/documents/${id}`);
}
