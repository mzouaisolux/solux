"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getCurrentUserRole,
  requireTaskListManagerOrAdmin,
} from "@/lib/auth";
import {
  TASK_LIST_LOCKED_FOR_SALES,
  TASK_LIST_STATUSES,
  isTechnicalRole,
  type ProductionTaskListStatus,
} from "@/lib/types";
import { emitEvent, type EventType } from "@/lib/events";
import { requireCapability } from "@/lib/permissions";
import { normalizeStickerRequirements } from "@/lib/stickers";
import { normalizeRiskFlags } from "@/lib/risks";
import { isRevisionCategory, revisionCategoryLabel } from "@/lib/revision-shared";
import { evaluateRelease } from "@/lib/task-list-mapping-status";
import {
  countMissingTaskListMappings,
  taskListHasOpenRevision,
} from "@/lib/task-list-mapping-server";
import {
  parseFactoryExtras,
  normalizeFactoryExtras,
} from "@/lib/factory-extras";
// NOTE: `requireTaskListManagerOrAdmin()` is kept ONLY for the two
// content-editing actions (line-level technical/factory overrides)
// that aren't yet covered by the 19 capabilities catalog. Every
// status / lifecycle / archive / delete action now uses
// requireCapability(). When we extend the catalog in a future
// session, these last two will migrate too.

/**
 * Translate a workflow transition into the right event_type. Centralized
 * so we don't sprinkle string literals throughout the actions and keep
 * the catalog (lib/events.ts) honest.
 */
function eventTypeForTransition(
  to: ProductionTaskListStatus
): EventType | null {
  switch (to) {
    case "under_validation":
      return "tl.submitted_for_validation";
    case "validated":
      return "tl.validated";
    case "production_ready":
      return "tl.production_ready";
    case "needs_revision":
      return "tl.needs_revision";
    case "cancelled":
      return "tl.cancelled";
    case "draft":
      // Going back to draft (reopen flow lands at "validated" — see
      // reopenForRevision — so this case is rare/unused).
      return null;
    default:
      return null;
  }
}

/**
 * Save the known-risks / warning flags (m062). Same edit gate as the
 * header (sales while draft/needs_revision; technical any pre-terminal).
 */
export async function updateRiskFlags(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing task list id");

  const { role } = await getCurrentUserRole();
  const supabase = createClient();

  const { data: current } = await supabase
    .from("production_task_lists")
    .select("status, number")
    .eq("id", id)
    .maybeSingle();
  if (!current) throw new Error("Task list not found");

  if (
    !isTechnicalRole(role) &&
    TASK_LIST_LOCKED_FOR_SALES.includes(
      current.status as ProductionTaskListStatus
    )
  ) {
    throw new Error(
      "This task list is in production validation and can no longer be edited by sales."
    );
  }

  const raw = String(formData.get("risk_flags") ?? "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    throw new Error("Invalid risk payload (must be JSON).");
  }
  const value = normalizeRiskFlags(parsed);

  const { error } = await supabase
    .from("production_task_lists")
    .update({ risk_flags: value })
    .eq("id", id);
  if (error) {
    if (/risk_flags/.test(error.message ?? "")) {
      throw new Error(
        "risk_flags column missing — apply migration m062 (062_risk_flags.sql) in Supabase."
      );
    }
    throw new Error(error.message);
  }

  revalidatePath(`/task-lists/${id}`);
}

/**
 * Save the sticker / label requirements (m061). Same edit gate as the
 * header: sales can edit while draft / needs_revision; technical roles
 * any pre-terminal stage. Stored as a normalized JSON blob.
 */
export async function updateStickerRequirements(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing task list id");

  const { role } = await getCurrentUserRole();
  const supabase = createClient();

  const { data: current } = await supabase
    .from("production_task_lists")
    .select("status, number")
    .eq("id", id)
    .maybeSingle();
  if (!current) throw new Error("Task list not found");

  const currentStatus = current.status as ProductionTaskListStatus;
  if (
    !isTechnicalRole(role) &&
    TASK_LIST_LOCKED_FOR_SALES.includes(currentStatus)
  ) {
    throw new Error(
      "This task list is in production validation and can no longer be edited by sales."
    );
  }

  const raw = String(formData.get("sticker_requirements") ?? "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    throw new Error("Invalid sticker payload (must be JSON).");
  }
  const value = normalizeStickerRequirements(parsed);

  const { error } = await supabase
    .from("production_task_lists")
    .update({ sticker_requirements: value })
    .eq("id", id);
  if (error) {
    if (/sticker_requirements/.test(error.message ?? "")) {
      throw new Error(
        "sticker_requirements column missing — apply migration m061 (061_sticker_requirements.sql) in Supabase."
      );
    }
    throw new Error(error.message);
  }

  await emitEvent({
    entity_type: "task_list",
    entity_id: id,
    event_type: "tl.header_changed",
    message: `Sticker requirements updated on ${current.number ?? "task list"}`,
    payload: { section: "sticker_requirements", number: current.number },
    bestEffort: true,
  });

  revalidatePath(`/task-lists/${id}`);
}

/**
 * Header edits (shipping, sales production notes, technical notes).
 *
 * - Sales can only edit the header while the task list is in `draft` or
 *   `needs_revision` (the production team bounced it back for fixes).
 * - Task list manager + admin can edit at any pre-terminal stage.
 * - The `status` form field is ignored — transitions go through the named
 *   action functions below so we can stamp timestamps + enforce role
 *   boundaries.
 */
export async function updateTaskListHeader(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing task list id");

  const { role } = await getCurrentUserRole();
  const supabase = createClient();

  // Read pre-state for two things: the lock check (uses status) AND the
  // diff we'll log in the event payload (so the timeline can show what
  // actually changed instead of a generic "header updated").
  const { data: current } = await supabase
    .from("production_task_lists")
    .select("status, number, shipping_method, production_notes, technical_notes")
    .eq("id", id)
    .maybeSingle();
  if (!current) throw new Error("Task list not found");

  const currentStatus = current.status as ProductionTaskListStatus;
  if (
    !isTechnicalRole(role) &&
    TASK_LIST_LOCKED_FOR_SALES.includes(currentStatus)
  ) {
    throw new Error(
      "This task list has been submitted for production validation and can no longer be edited by sales."
    );
  }

  const production_notes =
    (formData.get("production_notes") &&
      String(formData.get("production_notes")).trim()) || null;
  const shipping_method =
    (formData.get("shipping_method") &&
      String(formData.get("shipping_method")).trim()) || null;

  const patch: Record<string, any> = { production_notes, shipping_method };
  if (isTechnicalRole(role)) {
    patch.technical_notes =
      (formData.get("technical_notes") &&
        String(formData.get("technical_notes")).trim()) || null;
  }

  const { error } = await supabase
    .from("production_task_lists")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Compute which fields actually changed. If nothing changed we still
  // emit (the action was triggered, so the user clicked Save), but the
  // message is more useful when we can name the fields.
  const changed: string[] = [];
  if ((current.shipping_method ?? null) !== shipping_method)
    changed.push("shipping_method");
  if ((current.production_notes ?? null) !== production_notes)
    changed.push("production_notes");
  if (
    isTechnicalRole(role) &&
    (current.technical_notes ?? null) !== patch.technical_notes
  ) {
    changed.push("technical_notes");
  }
  if (changed.length > 0) {
    await emitEvent({
      entity_type: "task_list",
      entity_id: id,
      event_type: "tl.header_changed",
      message: `Header updated on ${current.number ?? "task list"} — ${changed.join(
        ", "
      )}`,
      payload: { changed_fields: changed, number: current.number },
      bestEffort: true,
    });
  }

  revalidatePath(`/task-lists/${id}`);
  revalidatePath("/task-lists");
  revalidatePath("/production/queue");
}

/**
 * Sales line edits — quantity, sales config_values, internal_notes.
 * Allowed when status is `draft` or `needs_revision` for sales; TLM/admin
 * can edit at any pre-terminal stage.
 */
export async function updateTaskListLine(formData: FormData) {
  const id = String(formData.get("id"));
  const task_list_id = String(formData.get("task_list_id"));
  if (!id) throw new Error("Missing line id");

  const { role } = await getCurrentUserRole();
  const supabase = createClient();
  const { data: parent } = await supabase
    .from("production_task_lists")
    .select("status")
    .eq("id", task_list_id)
    .maybeSingle();
  const parentStatus =
    (parent?.status as ProductionTaskListStatus) ?? "draft";
  if (
    !isTechnicalRole(role) &&
    TASK_LIST_LOCKED_FOR_SALES.includes(parentStatus)
  ) {
    throw new Error("Sales config is locked while under production validation.");
  }

  const internal_notes =
    (formData.get("internal_notes") &&
      String(formData.get("internal_notes")).trim()) || null;
  const quantity = parseInt(String(formData.get("quantity") ?? "1")) || 1;

  let config_values: Record<string, string> = {};
  const cfg = formData.get("config_values");
  if (cfg) {
    try {
      const parsed = JSON.parse(String(cfg));
      if (parsed && typeof parsed === "object") config_values = parsed;
    } catch {
      // ignore — keep empty
    }
  }

  // m135 — manual item (pole/mast/non-catalog): the name + free-text specs are
  // editable here (catalog lines have neither). unit_price is intentionally NOT
  // accepted from the client: it's a read-only reference, so we never let the
  // task list diverge from the commercial source of truth.
  const update: Record<string, unknown> = {
    quantity,
    config_values,
    internal_notes,
  };
  if (String(formData.get("is_manual") ?? "") === "1") {
    update.product_name =
      (formData.get("product_name") &&
        String(formData.get("product_name")).trim()) ||
      "Manual item";
    update.manual_specs =
      (formData.get("manual_specs") &&
        String(formData.get("manual_specs")).trim()) ||
      null;
  }

  let { error } = await supabase
    .from("production_task_list_lines")
    .update(update)
    .eq("id", id);
  // Resilience: manual_specs is an m135 column — if it isn't migrated yet, retry
  // without it so saving a line still works (product_name is m089, already
  // present). The free-text specs persist once m135 is applied.
  if (error && /manual_specs/i.test(error.message)) {
    const { manual_specs, ...rest } = update;
    ({ error } = await supabase
      .from("production_task_list_lines")
      .update(rest)
      .eq("id", id));
  }
  if (error) throw new Error(error.message);

  revalidatePath(`/task-lists/${task_list_id}`);
}

/**
 * Per-line factory-instruction overrides. Stored on
 * production_task_list_lines.factory_overrides as a JSONB map keyed by sales
 * field_name → custom instruction text. An empty/missing key falls back to
 * the global factory_mappings entry at render time.
 *
 * Only callable by task_list_manager + admin.
 */
export async function updateTaskListLineFactoryOverrides(formData: FormData) {
  await requireTaskListManagerOrAdmin();

  const id = String(formData.get("id"));
  const task_list_id = String(formData.get("task_list_id"));
  if (!id) throw new Error("Missing line id");

  let factory_overrides: Record<string, string> = {};
  const raw = formData.get("factory_overrides");
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw));
      if (parsed && typeof parsed === "object") {
        // Drop empty strings — empty override = "use the global mapping".
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string" && v.trim() !== "") {
            factory_overrides[k] = v;
          }
        }
      }
    } catch {
      // ignore — keep empty
    }
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("production_task_list_lines")
    .update({ factory_overrides })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/task-lists/${task_list_id}`);
}

/**
 * Technical line edits — technical_values JSONB.
 * Only callable by task_list_manager + admin.
 */
export async function updateTaskListLineTechnical(formData: FormData) {
  await requireTaskListManagerOrAdmin();

  const id = String(formData.get("id"));
  const task_list_id = String(formData.get("task_list_id"));
  if (!id) throw new Error("Missing line id");

  let technical_values: Record<string, string> = {};
  const cfg = formData.get("technical_values");
  if (cfg) {
    try {
      const parsed = JSON.parse(String(cfg));
      if (parsed && typeof parsed === "object") technical_values = parsed;
    } catch {
      // ignore — keep empty
    }
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("production_task_list_lines")
    .update({ technical_values })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/task-lists/${task_list_id}`);
}

/**
 * Idempotently creates a production_order for a task list.
 *
 * **History**: this used to silently swallow every error from the
 * underlying inserts — RPC missing, RLS denial, column not present, etc.
 * That meant a validated task list could land at `validated`/`production_ready`
 * with NO matching `production_orders` row, and nothing in the UI surfaced
 * the mismatch. The fix below makes every failure mode either:
 *   - throw a descriptive error so the caller sees it, OR
 *   - degrade gracefully (e.g. column missing → retry without that column)
 *
 * Behavior:
 *   - Safe to call repeatedly: a UNIQUE constraint on `task_list_id` plus
 *     a select-before-insert make this a no-op when the order is already
 *     linked.
 *   - Tolerates migration 021 not yet being applied: if the INSERT fails
 *     because `production_validation_date` / `production_working_days`
 *     don't exist, we retry without those fields. Existing functionality
 *     still works; the operational tracking columns light up after the
 *     migration runs.
 *
 * Returns the resulting production_order id (whether it was just created
 * or already existed).
 */
async function ensureProductionOrderForTaskList(
  taskListId: string
): Promise<string | null> {
  const supabase = createClient();

  // 1. Already linked? Return the existing id.
  const { data: existing, error: existingErr } = await supabase
    .from("production_orders")
    .select("id")
    .eq("task_list_id", taskListId)
    .maybeSingle();
  if (existingErr) {
    console.error(
      "[ensureProductionOrderForTaskList] select existing failed:",
      existingErr.message
    );
    throw new Error(
      `Could not check for existing production order: ${existingErr.message}`
    );
  }
  if (existing) return existing.id;

  // 2. Load the task list. It must be at validated/production_ready —
  //    callers should have moved it there, but we re-check as a defense.
  const { data: tl, error: tlErr } = await supabase
    .from("production_task_lists")
    .select("quotation_id, client_id, affair_id, status")
    .eq("id", taskListId)
    .maybeSingle();
  if (tlErr) {
    console.error("[ensureProductionOrderForTaskList] load task list failed:", tlErr.message);
    throw new Error(`Could not load task list ${taskListId}: ${tlErr.message}`);
  }
  if (!tl) {
    console.warn(
      "[ensureProductionOrderForTaskList] task list not found:",
      taskListId
    );
    return null;
  }
  if (tl.status !== "validated" && tl.status !== "production_ready") {
    // Not at a state where production tracking applies. Not an error —
    // the caller may be moving through earlier statuses.
    return null;
  }

  // 3. Build the PO number from the QUOTATION number so naming stays
  //    CONTINUOUS across the whole lifecycle: quote → task list → PO →
  //    shipping. e.g. quote `SLX-SEL-26-015` ⇒ PO `PO-SLX-SEL-26-015`
  //    (versioned quotes keep their suffix: `PO-SLX-SEL-26-015-V2`).
  //    The affair/project name + client are surfaced on the PO pages from
  //    the linked quotation — no need to bake them into the number.
  //    Falls back to the legacy per-year counter only if the quote has no
  //    number (shouldn't happen, but keeps the NOT NULL column satisfied).
  let poNumber: string | null = null;
  {
    const { data: q } = await supabase
      .from("documents")
      .select("number")
      .eq("id", tl.quotation_id)
      .maybeSingle();
    const qn = (q?.number as string | null)?.trim();
    if (qn) poNumber = `PO-${qn}`;
  }
  if (!poNumber) {
    const { data: numberRow, error: rpcErr } = await supabase.rpc(
      "next_production_order_number"
    );
    if (rpcErr) {
      console.error(
        "[ensureProductionOrderForTaskList] RPC failed:",
        rpcErr.message
      );
      throw new Error(
        `next_production_order_number() RPC failed — likely missing or RLS-blocked: ${rpcErr.message}`
      );
    }
    if (!numberRow) {
      throw new Error(
        "next_production_order_number() returned null — check migration 018 is applied"
      );
    }
    poNumber = numberRow as string;
  }

  const { userId } = await getCurrentUserRole();
  const today = new Date().toISOString().slice(0, 10);

  // 4. INSERT — preferred path with the operational tracking columns
  //    from migration 021. If that fails because the column doesn't
  //    exist yet, fall back to the legacy shape so things keep working
  //    even before the migration is applied.
  const fullPayload = {
    number: poNumber,
    task_list_id: taskListId,
    quotation_id: tl.quotation_id,
    client_id: tl.client_id,
    // F4 (sibling): carry the affair link from the task list onto the order so
    // the whole production chain (quote → task list → order) stays grouped under
    // its affaire. legacyPayload spreads this, so it inherits affair_id too.
    affair_id: (tl as any).affair_id ?? null,
    status: "awaiting_deposit",
    production_validation_date: today,
    created_by: userId,
  };
  let inserted: { id: string } | null = null;
  const { data: ins, error: insErr } = await supabase
    .from("production_orders")
    .insert(fullPayload)
    .select("id")
    .single();
  if (insErr) {
    // Detect the "column doesn't exist" case → retry without the new
    // operational tracking field. Postgres error 42703 = undefined column.
    const msg = insErr.message ?? "";
    const isMissingColumn =
      (insErr as any).code === "42703" ||
      msg.includes("production_validation_date") ||
      msg.toLowerCase().includes("column");
    if (isMissingColumn) {
      console.warn(
        "[ensureProductionOrderForTaskList] column missing, retrying without production_validation_date — apply migration 021 to enable operational tracking"
      );
      const legacyPayload = { ...fullPayload };
      delete (legacyPayload as any).production_validation_date;
      const { data: ins2, error: insErr2 } = await supabase
        .from("production_orders")
        .insert(legacyPayload)
        .select("id")
        .single();
      if (insErr2) {
        console.error(
          "[ensureProductionOrderForTaskList] legacy insert also failed:",
          insErr2.message
        );
        throw new Error(
          `Could not create production order (legacy shape): ${insErr2.message}`
        );
      }
      inserted = ins2;
    } else {
      console.error(
        "[ensureProductionOrderForTaskList] insert failed:",
        insErr.message,
        "code=",
        (insErr as any).code
      );
      throw new Error(
        `Could not create production order for task list ${taskListId}: ${insErr.message}`
      );
    }
  } else {
    inserted = ins;
  }

  // Audit log — record the auto-create so the PO's timeline starts
  // with "Production order created from task list <X>".
  if (inserted?.id) {
    await emitEvent({
      entity_type: "production_order",
      entity_id: inserted.id,
      event_type: "po.created",
      message: `Production order created from task list ${taskListId.slice(0, 8)}…`,
      payload: {
        task_list_id: taskListId,
        quotation_id: tl.quotation_id,
        initial_status: "awaiting_deposit",
      },
      bestEffort: true,
    });
  }

  // Refresh every surface that lists production orders.
  revalidatePath("/production/orders");
  revalidatePath("/operations");
  revalidatePath("/order-follow-up");
  revalidatePath("/dashboard");
  revalidatePath("/business");
  revalidatePath("/clients");

  return inserted?.id ?? null;
}

/** Generic gateway used by every workflow transition button. */
async function transition(
  id: string,
  to: ProductionTaskListStatus,
  opts: {
    allowedFrom: ProductionTaskListStatus[];
    stampSubmittedAt?: boolean;
    /** Stamps validated_at + validated_by — used by the validate action. */
    stampValidator?: boolean;
    /** Optional human note appended to the transition event — surfaces in
     *  the validation history (e.g. the revision reason / sales response). */
    note?: string;
  }
) {
  // Note: per architectural decision Q3, role/capability gating no
  // longer happens here. Each public action calls requireCapability()
  // BEFORE invoking transition(). Keeping transition() free of auth
  // concerns makes the workflow rules (allowedFrom, status patches)
  // easier to reason about.
  const { userId } = await getCurrentUserRole();

  const supabase = createClient();
  const { data: row } = await supabase
    .from("production_task_lists")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row) throw new Error("Task list not found");
  const from = row.status as ProductionTaskListStatus;
  if (!opts.allowedFrom.includes(from)) {
    throw new Error(
      `Cannot move from "${from}" to "${to}". Workflow doesn't allow it.`
    );
  }

  const patch: Record<string, any> = { status: to };
  if (opts.stampSubmittedAt) patch.submitted_at = new Date().toISOString();
  if (opts.stampValidator) {
    patch.validated_at = new Date().toISOString();
    if (userId) patch.validated_by = userId;
  }

  const { error } = await supabase
    .from("production_task_lists")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Auto-create the linked production_order whenever the task list lands
  // at a status where production work can begin. Covers every transition
  // path centrally — including the under_validation → production_ready
  // fast-track that bypasses validateTaskList.
  if (to === "validated" || to === "production_ready") {
    await ensureProductionOrderForTaskList(id);
  }

  // Audit log — emit an event row so the timeline + dashboard surfaces
  // every transition with who/when/from→to. Best-effort: even if the
  // event log is down, the transition has already succeeded.
  const eventType = eventTypeForTransition(to);
  if (eventType) {
    await emitEvent({
      entity_type: "task_list",
      entity_id: id,
      event_type: eventType,
      message: opts.note
        ? `Task list moved ${from} → ${to} — ${opts.note}`
        : `Task list moved ${from} → ${to}`,
      payload: { from, to, note: opts.note ?? null },
      bestEffort: true,
    });
  }

  revalidatePath(`/task-lists/${id}`);
  revalidatePath("/task-lists");
  revalidatePath("/production/queue");
  // Validation creates the awaiting-deposit PO → the Sales deposit follow-up
  // appears in the Action Center; refresh both dashboards + operations.
  revalidatePath("/dashboard");
  revalidatePath("/operations");
}

// ---------- WORKFLOW TRANSITION ACTIONS ----------

/**
 * Sales hands off the task list to the production team for validation.
 * Allowed from `draft` (first submission) or `needs_revision` (re-submit
 * after fixes).
 */
export async function submitForValidation(formData: FormData) {
  await transition(String(formData.get("id")), "under_validation", {
    allowedFrom: ["draft", "needs_revision"],
    stampSubmittedAt: true,
  });
}

/**
 * Production team accepts the task list and starts technical enrichment.
 * Allowed from `under_validation` only — re-validation of an already-
 * production-ready task list goes through a separate re-open path.
 */
export async function validateTaskList(formData: FormData) {
  await requireCapability("task_list.validate");
  const id = String(formData.get("id"));
  const supabase = createClient();

  // D1.1 — SERVER-SIDE release gate (mirrors the Release-to-Production modal,
  // but authoritative: it holds even if the UI is bypassed). Reads the
  // autonomous factory mappings via the shared resolver — no per-task logic.
  const { data: row } = await supabase
    .from("production_task_lists")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row) throw new Error("Task list not found");
  const [missingCount, hasOpenRevision, lineCount] = await Promise.all([
    countMissingTaskListMappings(id),
    taskListHasOpenRevision(id),
    supabase
      .from("production_task_list_lines")
      .select("id", { count: "exact", head: true })
      .eq("task_list_id", id)
      .then((r) => r.count ?? 0),
  ]);
  const verdict = evaluateRelease({
    statusAllowed: row.status === "under_validation",
    missingCount,
    hasOpenRevision,
    lineCount,
  });
  if (!verdict.ok) {
    throw new Error(verdict.reason ?? "Cannot release to production.");
  }

  // Loop is answered → close any (now-resolved) revision requests so the
  // conversation stays clean.
  const { userId } = await getCurrentUserRole();
  await supabase
    .from("entity_messages")
    .update({ resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq("entity_type", "task_list")
    .eq("entity_id", id)
    .eq("message_kind", "request")
    .is("resolved_at", null);

  // Auto-create is handled centrally by transition() (ensureProductionOrder).
  await transition(id, "validated", {
    allowedFrom: ["under_validation"],
    stampValidator: true,
  });
  // Immediate operational handoff: jump straight to the production order.
  await handoffToProductionOrder(id);
}

/**
 * Production team marks all technical work complete — the factory PDF can
 * now be generated. Allowed from `validated` (normal flow) or
 * `under_validation` (fast-track when no enrichment is needed).
 */
export async function markProductionReady(formData: FormData) {
  await requireCapability("task_list.validate");
  const id = String(formData.get("id"));
  const supabase = createClient();

  // D1.1 — same server-side release gate as validate (this path ALSO creates
  // the production order, so it must not bypass the mapping/revision checks).
  const { data: row } = await supabase
    .from("production_task_lists")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row) throw new Error("Task list not found");
  const [missingCount, hasOpenRevision, lineCount] = await Promise.all([
    countMissingTaskListMappings(id),
    taskListHasOpenRevision(id),
    supabase
      .from("production_task_list_lines")
      .select("id", { count: "exact", head: true })
      .eq("task_list_id", id)
      .then((r) => r.count ?? 0),
  ]);
  const verdict = evaluateRelease({
    statusAllowed:
      row.status === "under_validation" || row.status === "validated",
    missingCount,
    hasOpenRevision,
    lineCount,
  });
  if (!verdict.ok) {
    throw new Error(verdict.reason ?? "Cannot release to production.");
  }

  await transition(id, "production_ready", {
    allowedFrom: ["validated", "under_validation"],
  });
  await handoffToProductionOrder(id);
}

/**
 * Validation → operational handoff. The production order already exists (the
 * transition ensured it); jump the user straight into its tracking/setup page.
 * Falls back to the task list if the order can't be resolved.
 */
async function handoffToProductionOrder(taskListId: string) {
  let poId: string | null = null;
  try {
    poId = await ensureProductionOrderForTaskList(taskListId);
  } catch {
    poId = null;
  }
  redirect(poId ? `/production/orders/${poId}` : `/task-lists/${taskListId}`);
}

/**
 * Production team bounces the task list back to sales for fixes. Sales can
 * edit again and re-submit. Allowed from any non-terminal post-draft state.
 */
export async function requestRevision(formData: FormData) {
  await requireCapability("task_list.validate");
  await transition(String(formData.get("id")), "needs_revision", {
    allowedFrom: ["under_validation", "validated", "production_ready"],
  });
}

/**
 * D1 — Production team sends the task list back to sales WITH a structured
 * reason. NEVER a blind revision: the category + message are recorded in the
 * conversation (entity_messages 'request') first; only then does the status
 * flip to needs_revision, stamping the reason into the validation history.
 */
export async function requestRevisionWithReason(formData: FormData) {
  await requireCapability("task_list.validate");
  const id = String(formData.get("id"));
  const category = String(formData.get("category") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  const fieldRaw = String(formData.get("field") ?? "").trim();
  const field =
    fieldRaw && fieldRaw !== "General task list" ? fieldRaw : null;

  if (!id) throw new Error("Missing task list id");
  if (!isRevisionCategory(category)) {
    throw new Error("Please choose a revision category.");
  }
  if (!message) {
    throw new Error("Please explain clearly what Sales must clarify or correct.");
  }

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  // Pre-check status so we never post a request that can't transition
  // (avoids an orphan request message with no status change).
  const allowed: ProductionTaskListStatus[] = [
    "under_validation",
    "validated",
    "production_ready",
  ];
  const { data: row } = await supabase
    .from("production_task_lists")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row) throw new Error("Task list not found");
  if (!allowed.includes(row.status as ProductionTaskListStatus)) {
    throw new Error(`Cannot request a revision from "${row.status}".`);
  }

  // Record the request in the conversation FIRST. If it fails we throw, so a
  // revision is NEVER created without a visible reason.
  const label = revisionCategoryLabel(category);
  const body = `🔧 Revision requested — ${label}${
    field ? ` · ${field}` : ""
  }\n\n${message}`;
  const { error: msgErr } = await supabase.from("entity_messages").insert({
    entity_type: "task_list",
    entity_id: id,
    user_id: userId,
    message: body,
    message_kind: "request",
    structured_payload: { kind: "revision_request", category, field },
  });
  if (msgErr) {
    throw new Error(
      `Could not record the revision request (${msgErr.message}). The task list was NOT sent back — please retry.`
    );
  }

  await transition(id, "needs_revision", {
    allowedFrom: allowed,
    note: `${label}${field ? ` (${field})` : ""}: ${message.slice(0, 160)}`,
  });
}

/**
 * D1 — Sales answers the revision and re-submits. Requires a response summary
 * (no blind re-submit). Posts the reply into the conversation, resolves the
 * open request, and flips needs_revision → under_validation with the response
 * recorded in the validation history.
 */
export async function resubmitWithResponse(formData: FormData) {
  const id = String(formData.get("id"));
  const response = String(formData.get("response") ?? "").trim();
  if (!id) throw new Error("Missing task list id");
  if (!response) {
    throw new Error(
      "Please summarize what you corrected or confirmed before re-submitting."
    );
  }

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  const { data: row } = await supabase
    .from("production_task_lists")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!row) throw new Error("Task list not found");
  if (row.status !== "needs_revision") {
    throw new Error(
      `Re-submit is only available while the task list needs revision (current: "${row.status}").`
    );
  }

  // Link the reply to the latest open request, if any.
  const { data: openReq } = await supabase
    .from("entity_messages")
    .select("id")
    .eq("entity_type", "task_list")
    .eq("entity_id", id)
    .eq("message_kind", "request")
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error: msgErr } = await supabase.from("entity_messages").insert({
    entity_type: "task_list",
    entity_id: id,
    user_id: userId,
    message: `✅ Sales response\n\n${response}`,
    message_kind: "reply",
    parent_message_id: openReq?.id ?? null,
    structured_payload: { kind: "revision_response" },
  });
  if (msgErr) {
    throw new Error(
      `Could not record your response (${msgErr.message}). The task list was NOT re-submitted — please retry.`
    );
  }

  // Best-effort resolve of the request (RLS may limit this to technical
  // roles; the reply above is the authoritative answer either way).
  if (openReq?.id) {
    await supabase
      .from("entity_messages")
      .update({ resolved_at: new Date().toISOString(), resolved_by: userId })
      .eq("id", openReq.id);
  }

  await transition(id, "under_validation", {
    allowedFrom: ["needs_revision"],
    stampSubmittedAt: true,
    note: `Sales response: ${response.slice(0, 160)}`,
  });
}

/**
 * Production team rejects the task list outright (terminal). Distinct from
 * `requestRevision` — there's no path back to sales after this.
 */
export async function rejectTaskList(formData: FormData) {
  await requireCapability("task_list.reject");
  await transition(String(formData.get("id")), "cancelled", {
    allowedFrom: [
      "draft",
      "under_validation",
      "needs_revision",
      "validated",
      "production_ready",
    ],
  });
}

/**
 * Production team reopens a `production_ready` task list for further edits.
 * Used when the factory PDF was reviewed and adjustments are needed before
 * release.
 */
export async function reopenForRevision(formData: FormData) {
  await requireCapability("task_list.validate");
  await transition(String(formData.get("id")), "validated", {
    allowedFrom: ["production_ready"],
  });
}

/**
 * Direct status set — kept as an escape hatch for admins to fix bad data.
 * Validated against the enum. Capability-gated so a super-admin can
 * grant override rights to non-TLM roles via the matrix if needed.
 */
export async function setTaskListStatus(formData: FormData) {
  await requireCapability("task_list.validate");
  const id = String(formData.get("id"));
  const status = String(formData.get("status") ?? "");
  if (!TASK_LIST_STATUSES.includes(status as ProductionTaskListStatus)) {
    throw new Error("Invalid status");
  }
  const supabase = createClient();
  const { error } = await supabase
    .from("production_task_lists")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Same auto-create hook as transition() — admins overriding a task
  // list straight to validated/production_ready also get the linked
  // production order.
  if (status === "validated" || status === "production_ready") {
    await ensureProductionOrderForTaskList(id);
  }

  // Audit log — flagged as HIGH severity since admin overrides bypass
  // the normal transition guardrails.
  await emitEvent({
    entity_type: "task_list",
    entity_id: id,
    event_type: "tl.status_overridden",
    severity: "high",
    message: `Status manually set to "${status}" (admin override)`,
    payload: { to: status },
    bestEffort: true,
  });

  revalidatePath(`/task-lists/${id}`);
  revalidatePath("/task-lists");
  revalidatePath("/production/queue");
}

/**
 * Hard delete a task list. **Super-admin only.**
 *
 * Per the soft-delete policy (D.1 architectural decision):
 *   - Sales / TLM should `rejectTaskList` (status → cancelled). The
 *     DB trigger cancels the linked PO automatically.
 *   - Admins should `archiveTaskList` (archived_at). The row stays
 *     queryable, just hidden from default lists.
 *   - Super-admins are the only ones who can physically delete.
 *
 * This used to be open to TLM/admin; the gap let sales/TLM nuke task
 * lists that other modules depended on (production orders pointing at
 * the now-deleted task_list_id would orphan).
 */
export async function deleteTaskList(formData: FormData) {
  await requireCapability("task_list.delete");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing task list id");

  const supabase = createClient();

  // Load context for the audit log before the row vanishes.
  const { data: ctx } = await supabase
    .from("production_task_lists")
    .select("number, status, quotation_id, client_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("production_task_lists")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Critical audit event — task list deletion is irreversible.
  await emitEvent({
    entity_type: "task_list",
    entity_id: id,
    event_type: "tl.deleted",
    severity: "critical",
    message: `Task list ${ctx?.number ?? id.slice(0, 8) + "…"} deleted`,
    payload: {
      number: ctx?.number ?? null,
      previous_status: ctx?.status ?? null,
      quotation_id: ctx?.quotation_id ?? null,
      client_id: ctx?.client_id ?? null,
    },
    bestEffort: true,
  });
  // Mirror the event on the parent quotation/client surface so it
  // shows up in their timeline too.
  if (ctx?.quotation_id) {
    await emitEvent({
      entity_type: "document",
      entity_id: ctx.quotation_id,
      event_type: "tl.deleted",
      severity: "critical",
      message: `Task list ${ctx?.number ?? id.slice(0, 8) + "…"} deleted`,
      payload: { task_list_id: id, number: ctx?.number ?? null },
      bestEffort: true,
    });
  }

  revalidatePath("/task-lists");
  redirect("/task-lists");
}

/**
 * Bulk repair: find every task list at validated/production_ready that
 * doesn't have a linked production_order and create one for each.
 *
 * Why this exists:
 *   The auto-create hook on transition() can silently fail if the DB
 *   isn't in the expected shape (RPC missing, RLS issue, column missing
 *   before migration 021 is applied). When this happens, the operational
 *   surfaces (/operations, /order-follow-up, /dashboard) appear empty
 *   even though task lists are actually marked validated.
 *
 *   This action is the safety net: admins/TLM can click "Sync orphan
 *   task lists" from /order-follow-up or /operations and we walk the
 *   gap, creating every missing PO via the same hardened helper.
 *
 * Returns a count of created orders so the calling form can show a
 * "Created N production orders" confirmation.
 *
 * Admin / TLM only.
 */
export async function syncOrphanProductionOrders(): Promise<{
  created: number;
  skipped: number;
  failures: { taskListId: string; error: string }[];
}> {
  await requireCapability("task_list.sync_orphans");

  const supabase = createClient();

  // Find every task list that should have an order but doesn't. We can't
  // do a NOT EXISTS subquery via PostgREST, so we pull both sets and
  // diff them in the app layer. The set sizes here are small (orders are
  // O(n) with deals won), so a memory diff is fine.
  const [{ data: candidates, error: candErr }, { data: existingOrders, error: ordErr }] =
    await Promise.all([
      supabase
        .from("production_task_lists")
        .select("id")
        .in("status", ["validated", "production_ready"]),
      supabase
        .from("production_orders")
        .select("task_list_id"),
    ]);
  if (candErr) {
    throw new Error(`Could not load task lists: ${candErr.message}`);
  }
  if (ordErr) {
    throw new Error(`Could not load production orders: ${ordErr.message}`);
  }

  const linkedIds = new Set(
    (existingOrders ?? []).map((o: any) => o.task_list_id)
  );
  const orphanIds = (candidates ?? [])
    .map((t: any) => t.id)
    .filter((id: string) => !linkedIds.has(id));

  let created = 0;
  let skipped = 0;
  const failures: { taskListId: string; error: string }[] = [];

  for (const taskListId of orphanIds) {
    try {
      const id = await ensureProductionOrderForTaskList(taskListId);
      if (id) created++;
      else skipped++;
    } catch (e: any) {
      failures.push({
        taskListId,
        error: e?.message ?? "Unknown error",
      });
    }
  }

  revalidatePath("/operations");
  revalidatePath("/order-follow-up");
  revalidatePath("/production/orders");
  revalidatePath("/dashboard");
  revalidatePath("/business");

  return { created, skipped, failures };
}

/**
 * Form-action wrapper for syncOrphanProductionOrders, so it can be
 * invoked from a `<form action={…}>` on the operations / follow-up
 * surfaces. Throws on any failure so the UI shows a Server Error
 * boundary; success path quietly returns.
 *
 * If you need the structured result (created/skipped/failures), call
 * `syncOrphanProductionOrders()` directly from a server component
 * instead — this form variant is for one-click buttons.
 */
export async function syncOrphanProductionOrdersAction(): Promise<void> {
  const result = await syncOrphanProductionOrders();
  if (result.failures.length > 0) {
    // Compose a single readable error so the user sees what went wrong.
    const sample = result.failures
      .slice(0, 3)
      .map((f) => `${f.taskListId.slice(0, 8)}…: ${f.error}`)
      .join(" · ");
    throw new Error(
      `Created ${result.created} / Failed ${result.failures.length}. First failure(s): ${sample}`
    );
  }
}

/* =====================================================================
   ARCHIVE / UNARCHIVE — soft delete (migration 024)
   =====================================================================
   Archive ≠ cancel. A cancelled task list represents "this deal died".
   An archived task list represents "operationally done, hide it from
   default lists so the UI doesn't get cluttered." Both can be
   reversed; only super-admin can issue a real DELETE.
   ===================================================================== */

/**
 * Archive a task list — sets archived_at so default queries skip it.
 *
 * Admin only. Doesn't cascade to linked POs by design — archiving a
 * task list doesn't necessarily mean its PO should disappear too.
 * Archive each entity explicitly so the operator stays in control.
 */
export async function archiveTaskList(formData: FormData) {
  await requireCapability("task_list.archive");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing task list id");

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("production_task_lists")
    .update({ archived_at: now, archived_by: userId })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "task_list",
    entity_id: id,
    event_type: "tl.status_overridden",
    severity: "medium",
    message: "Task list archived",
    payload: { archived_at: now },
    bestEffort: true,
  });

  revalidatePath(`/task-lists/${id}`);
  revalidatePath("/task-lists");
  revalidatePath("/operations");
  revalidatePath("/order-follow-up");
}

/** Reverse of archiveTaskList. */
export async function unarchiveTaskList(formData: FormData) {
  await requireCapability("task_list.archive");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing task list id");

  const supabase = createClient();
  const { error } = await supabase
    .from("production_task_lists")
    .update({ archived_at: null, archived_by: null })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "task_list",
    entity_id: id,
    event_type: "tl.status_overridden",
    severity: "low",
    message: "Task list unarchived",
    payload: {},
    bestEffort: true,
  });

  revalidatePath(`/task-lists/${id}`);
  revalidatePath("/task-lists");
}

/* ===========================================================================
   Client technical preset (factory-side, m071) — FIELD-LEVEL DELTAS.

   This layers ON TOP of the existing factory-mapping flow — it does NOT
   recreate or touch the sales configuration:

       Sales config (document_lines)              ← owned by sales
         → global factory_mappings (automatic)    ← admin/TLM, m014
           → CLIENT field overrides (this file)   ← ONLY the changed fields
             → order override (factory_overrides) ← this one line

   The client preset is a set of PATCHES, never a snapshot:
     - mapping: Record<salesFieldName, instruction> — only the sales fields the
       client genuinely differs on. Unset fields keep inheriting the global
       mapping, so when a global default improves later, every client that did
       NOT override it benefits automatically.
     - extras:  [{ key, label, value }] — only the factory-only attributes this
       client needs.

   Each save/remove touches ONE field, so promoting "bracket dimension" for a
   client never freezes battery/optic/panel — those still follow the global
   default. Promoting a field also clears that field's per-line order override
   so the row resolves cleanly as "Client preset" (not shadowed by "Order").

   Gated to technical roles. Soft-fails if the table/columns aren't migrated
   yet (m071) so the task-list page never crashes.
   =========================================================================== */

async function requireTechnical() {
  const { userId, role } = await getCurrentUserRole();
  if (!isTechnicalRole(role)) {
    throw new Error("Only production roles can edit the technical mapping.");
  }
  return userId;
}

/** Read a client preset row's current mapping as a clean Record (or {}). */
function asMapping(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim() !== "") out[k] = v;
  }
  return out;
}

/**
 * Save OR remove a SINGLE sales-field client override (delta).
 *   - `text` present → set mapping[field_name] = text, and clear that field's
 *     per-line order override so the row shows as "Client preset".
 *   - `text` empty   → delete mapping[field_name] (revert to global default).
 * Read-modify-write so we never clobber the client's other field overrides.
 */
export async function setClientFieldOverride(formData: FormData) {
  const userId = await requireTechnical();
  const clientId = String(formData.get("client_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  const fieldName = String(formData.get("field_name") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  const lineId = String(formData.get("line_id") ?? "");
  const taskListId = String(formData.get("task_list_id") ?? "");
  if (!clientId || !productId || !fieldName) {
    throw new Error("Missing client, product, or field");
  }

  const supabase = createClient();
  const { data: existing } = await supabase
    .from("client_technical_presets")
    .select("mapping")
    .eq("client_id", clientId)
    .eq("product_id", productId)
    .maybeSingle();

  const mapping = asMapping(existing?.mapping);
  if (text) mapping[fieldName] = text;
  else delete mapping[fieldName];

  const { error } = await supabase.from("client_technical_presets").upsert(
    {
      client_id: clientId,
      product_id: productId,
      mapping,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,product_id" }
  );
  if (
    error &&
    !/client_technical_presets|relation .* does not exist/i.test(
      error.message ?? ""
    )
  ) {
    throw new Error(error.message);
  }

  // When promoting to client, drop this field's order override so it isn't
  // shadowed by a stale per-line "This order" value.
  if (text && lineId) {
    const { data: ln } = await supabase
      .from("production_task_list_lines")
      .select("factory_overrides")
      .eq("id", lineId)
      .maybeSingle();
    const fo = asMapping(ln?.factory_overrides);
    if (fieldName in fo) {
      delete fo[fieldName];
      await supabase
        .from("production_task_list_lines")
        .update({ factory_overrides: fo })
        .eq("id", lineId);
    }
  }
  if (taskListId) revalidatePath(`/task-lists/${taskListId}`);
}

/**
 * Save OR remove a SINGLE additional factory attribute on the client preset
 * (delta), keyed by `key`.
 *   - `value` present → upsert { key, label, value } in extras, and clear the
 *     key from this line's order extras so it resolves as "Client preset".
 *   - `value` empty   → remove the key from extras.
 * Read-modify-write on the jsonb array. Soft-fails if `extras` isn't migrated.
 */
export async function setClientExtraOverride(formData: FormData) {
  const userId = await requireTechnical();
  const clientId = String(formData.get("client_id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  const lineId = String(formData.get("line_id") ?? "");
  const taskListId = String(formData.get("task_list_id") ?? "");
  if (!clientId || !productId || !key) {
    throw new Error("Missing client, product, or field key");
  }

  const supabase = createClient();
  const read = await supabase
    .from("client_technical_presets")
    .select("extras")
    .eq("client_id", clientId)
    .eq("product_id", productId)
    .maybeSingle();
  // If the extras column isn't migrated yet, bail quietly — nothing to persist.
  if (read.error && /extras|column .* does not exist/i.test(read.error.message ?? "")) {
    if (taskListId) revalidatePath(`/task-lists/${taskListId}`);
    return;
  }

  let extras = normalizeFactoryExtras(read.data?.extras).filter(
    (e) => e.key !== key
  );
  if (value) extras.push({ key, label: label || key, value });

  const { error } = await supabase.from("client_technical_presets").upsert(
    {
      client_id: clientId,
      product_id: productId,
      extras,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,product_id" }
  );
  if (
    error &&
    !/client_technical_presets|relation .* does not exist|extras|column .* does not exist/i.test(
      error.message ?? ""
    )
  ) {
    throw new Error(error.message);
  }

  // When promoting to client, drop the key from this line's order extras
  // (override or tombstone) so it resolves from the client preset.
  if (value && lineId) {
    const { data: ln, error: lnErr } = await supabase
      .from("production_task_list_lines")
      .select("factory_extras")
      .eq("id", lineId)
      .maybeSingle();
    if (!lnErr) {
      const orderExtras = normalizeFactoryExtras(ln?.factory_extras, {
        keepEmpty: true,
      }).filter((e) => e.key !== key);
      await supabase
        .from("production_task_list_lines")
        .update({ factory_extras: orderExtras })
        .eq("id", lineId);
    }
  }
  if (taskListId) revalidatePath(`/task-lists/${taskListId}`);
}

/* ---------------------------------------------------------------------------
   PER-FIELD ORDER overrides (this line only) — the "Order only" save mode.
   Read-modify-write a single field/key so one save never clobbers the line's
   other order overrides. Mirrors the per-field client actions above.
   --------------------------------------------------------------------------- */

/**
 * Save OR clear ONE sales-field order override on this line.
 *   - `text` present → set factory_overrides[field_name] = text.
 *   - `text` empty   → delete factory_overrides[field_name] (revert to client
 *     preset / global mapping).
 */
export async function setLineFieldOverride(formData: FormData) {
  await requireTechnical();
  const id = String(formData.get("id") ?? "");
  const fieldName = String(formData.get("field_name") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  const taskListId = String(formData.get("task_list_id") ?? "");
  if (!id || !fieldName) throw new Error("Missing line id or field");

  const supabase = createClient();
  const { data: ln } = await supabase
    .from("production_task_list_lines")
    .select("factory_overrides")
    .eq("id", id)
    .maybeSingle();
  const fo = asMapping(ln?.factory_overrides);
  if (text) fo[fieldName] = text;
  else delete fo[fieldName];

  const { error } = await supabase
    .from("production_task_list_lines")
    .update({ factory_overrides: fo })
    .eq("id", id);
  if (error) throw new Error(error.message);
  if (taskListId) revalidatePath(`/task-lists/${taskListId}`);
}

/**
 * Save / tombstone / remove ONE additional factory attribute on this line's
 * order layer.
 *   - `value` present       → upsert { key, label, value } (order override).
 *   - empty + `tombstone`=1  → store an empty-value entry (hides a client-
 *     preset key for THIS order).
 *   - empty + no tombstone   → remove the key entirely from the line.
 * Soft-fails if the `factory_extras` column isn't migrated yet.
 */
export async function setLineExtraOverride(formData: FormData) {
  await requireTechnical();
  const id = String(formData.get("id") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  const tombstone = String(formData.get("tombstone") ?? "") === "1";
  const taskListId = String(formData.get("task_list_id") ?? "");
  if (!id || !key) throw new Error("Missing line id or field key");

  const supabase = createClient();
  const read = await supabase
    .from("production_task_list_lines")
    .select("factory_extras")
    .eq("id", id)
    .maybeSingle();
  if (read.error && /factory_extras|column .* does not exist/i.test(read.error.message ?? "")) {
    if (taskListId) revalidatePath(`/task-lists/${taskListId}`);
    return;
  }

  let arr = normalizeFactoryExtras(read.data?.factory_extras, {
    keepEmpty: true,
  }).filter((e) => e.key !== key);
  if (value) arr.push({ key, label: label || key, value });
  else if (tombstone) arr.push({ key, label: label || key, value: "" });

  const { error } = await supabase
    .from("production_task_list_lines")
    .update({ factory_extras: arr })
    .eq("id", id);
  if (
    error &&
    !/factory_extras|column .* does not exist/i.test(error.message ?? "")
  ) {
    throw new Error(error.message);
  }
  if (taskListId) revalidatePath(`/task-lists/${taskListId}`);
}

/**
 * Save THIS order's additional factory attributes onto the task-list line.
 * The editor posts the minimal order layer (`factory_extras` JSON =
 * `[{ key, label, value }]`, where an empty value is a tombstone that hides a
 * client-preset key for this order). Soft-fails if the column isn't migrated.
 */
export async function updateTaskListLineFactoryExtras(formData: FormData) {
  await requireTechnical();
  const id = String(formData.get("id") ?? "");
  const taskListId = String(formData.get("task_list_id") ?? "");
  if (!id) throw new Error("Missing line id");

  // keepEmpty: order-layer tombstones must survive normalization.
  const factory_extras = parseFactoryExtras(
    formData.get("factory_extras") as string | null,
    { keepEmpty: true }
  );

  const supabase = createClient();
  const { error } = await supabase
    .from("production_task_list_lines")
    .update({ factory_extras })
    .eq("id", id);
  if (
    error &&
    !/factory_extras|column .* does not exist/i.test(error.message ?? "")
  ) {
    throw new Error(error.message);
  }
  if (taskListId) revalidatePath(`/task-lists/${taskListId}`);
}
