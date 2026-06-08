"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { DocStatus } from "@/lib/types";
import { DOC_STATUSES, isTechnicalRole, isAdminLike } from "@/lib/types";
import { getCurrentUserRole } from "@/lib/auth";
import { emitEvent } from "@/lib/events";
import { requireCapability } from "@/lib/permissions";
import {
  PROBABILITY_STAGES,
  FORECAST_CATEGORIES,
  type ForecastProbability,
  type ForecastCategory,
} from "@/lib/forecast";

const VALID_PROBABILITIES = PROBABILITY_STAGES.map((s) => s.value);
const VALID_CATEGORIES = FORECAST_CATEGORIES.map((c) => c.value);

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
  if (!isTechnicalRole(role)) {
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
  const catRaw = formData.get("category");
  const dateRaw = formData.get("expected_close_date");

  const update: Record<string, unknown> = {};

  // Probability — must be one of the fixed stages (or empty to clear).
  if (probRaw !== null) {
    const s = String(probRaw).trim();
    if (s === "") {
      update.forecast_probability = null;
    } else {
      const n = Number(s) as ForecastProbability;
      if (!VALID_PROBABILITIES.includes(n)) {
        throw new Error(`Invalid probability stage: ${s}`);
      }
      update.forecast_probability = n;
    }
  }

  // Category — fixed bucket (or empty to clear).
  if (catRaw !== null) {
    const s = String(catRaw).trim();
    if (s === "") {
      update.forecast_category = null;
    } else if (!VALID_CATEGORIES.includes(s as ForecastCategory)) {
      throw new Error(`Invalid forecast category: ${s}`);
    } else {
      update.forecast_category = s;
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

  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update(update)
    .eq("id", id);
  if (error) {
    // Soft-guide if m050 isn't applied yet.
    if (/forecast_/.test(error.message ?? "")) {
      throw new Error(
        "Forecast columns missing — apply migration m050 (050_quotation_forecast.sql) in Supabase."
      );
    }
    throw new Error(error.message);
  }

  revalidatePath(`/documents/${id}`);
  revalidatePath("/forecast");
  revalidatePath("/dashboard");
}

/**
 * Clear the entire forecast on a quotation (probability + category +
 * date). Resets the timestamp to null too, so the deal drops out of
 * weighted projections cleanly.
 */
export async function clearQuotationForecast(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing document id");

  const supabase = createClient();
  const { error } = await supabase
    .from("documents")
    .update({
      forecast_probability: null,
      forecast_category: null,
      forecast_expected_close_date: null,
      forecast_updated_at: null,
      forecast_updated_by: null,
    })
    .eq("id", id);
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
    .select("id, number, client_id, freight_type")
    .eq("id", quotation_id)
    .single();
  if (docErr || !doc) throw new Error(docErr?.message ?? "Quotation not found");

  const { data: srcLines, error: linesErr } = await supabase
    .from("document_lines")
    .select(
      "id, product_id, quantity, config_values, selected_options, client_product_name"
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

  const { data: inserted, error: insErr } = await supabase
    .from("production_task_lists")
    .insert({
      number: ptlNumber,
      quotation_id,
      client_id: doc.client_id,
      shipping_method: doc.freight_type,
      created_by: user.id,
      // New workflow starts in draft — sales still has work to do before
      // submitting for production validation. Explicit so we don't depend
      // on whatever the column default happens to be at any given time.
      status: "draft",
    })
    .select("id")
    .single();
  if (insErr) throw new Error(insErr.message);

  // Copy each quotation line into a task list line. Merge legacy
  // selected_options into config_values so factory teams see everything.
  const rows = (srcLines ?? []).map((l: any, i: number) => ({
    task_list_id: inserted!.id,
    product_id: l.product_id,
    quantity: l.quantity,
    config_values: {
      ...(l.selected_options ?? {}),
      ...(l.config_values ?? {}),
    },
    internal_notes: null,
    position: i,
  }));
  if (rows.length) {
    const { error: tlErr } = await supabase
      .from("production_task_list_lines")
      .insert(rows);
    if (tlErr) throw new Error(tlErr.message);
  }

  revalidatePath(`/documents/${quotation_id}`);
  revalidatePath("/task-lists");
  redirect(`/task-lists/${inserted!.id}`);
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
    .select("status, number")
    .eq("id", id)
    .maybeSingle();
  const previousStatus = (prev?.status as DocStatus) ?? null;

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
  if (!isAdminLike(role)) {
    throw new Error("Only Admin / Super Admin can review a quotation validation request.");
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
