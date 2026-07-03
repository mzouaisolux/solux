"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUserRole } from "@/lib/auth";
import { requireCapability } from "@/lib/permissions";
import {
  PRODUCTION_ORDER_STATUSES,
  PRODUCTION_ORDER_STATUS_LABEL,
  PRODUCTION_COMPLETED_STATUSES,
  type ProductionOrderStatus,
} from "@/lib/types";
import { addWorkingDays } from "@/lib/working-days";
import { emitEvent } from "@/lib/events";
import { isBaselineLocked } from "@/lib/production-lifecycle";
import { DELAY_TYPES, addDaysIso, type DelayType } from "@/lib/delays";
import {
  normalizeBlProfile,
  blProfileStatus,
  blProfileMissingFields,
} from "@/lib/bl";
import { normalizeShippingDetails } from "@/lib/shipping";

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

function dateOrNull(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  if (!v) return null;
  // HTML <input type="date"> gives us YYYY-MM-DD already.
  return v;
}

function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

/**
 * Recompute the materialized ETA from the delay-event stream (m074).
 *
 *     current_production_deadline = initial_production_deadline + Σ days_added
 *
 * Called by every action that mutates the event stream (add / edit / delete)
 * so the materialized column stays in lockstep with the events. Silently
 * skips orders whose initial deadline isn't set yet (the column is meaningless
 * before activation).
 */
async function recomputeOrderDeadline(orderId: string): Promise<void> {
  const supabase = createClient();
  const { data: order } = await supabase
    .from("production_orders")
    .select("initial_production_deadline")
    .eq("id", orderId)
    .maybeSingle();
  const initial = order?.initial_production_deadline as string | null;
  if (!initial) return;

  // Pull every event for this order. Prefer authoritative `days_added`
  // (m073); fall back to date diff for un-backfilled rows.
  const { data: events } = await supabase
    .from("production_deadline_changes")
    .select("days_added, previous_date, new_date")
    .eq("production_order_id", orderId);
  let sum = 0;
  for (const e of (events ?? []) as any[]) {
    if (e.days_added != null) {
      const n = Number(e.days_added);
      if (Number.isFinite(n)) sum += n;
    } else if (e.previous_date) {
      const a = Date.parse(e.previous_date + "T00:00:00Z");
      const b = Date.parse(e.new_date + "T00:00:00Z");
      if (Number.isFinite(a) && Number.isFinite(b)) {
        sum += Math.round((b - a) / 86_400_000);
      }
    }
  }

  const d = new Date(initial + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + sum);
  const newEta = d.toISOString().slice(0, 10);
  await supabase
    .from("production_orders")
    .update({ current_production_deadline: newEta })
    .eq("id", orderId);
}

/** Bumps the order's updated_at + revalidates every surface it appears on. */
async function touch(orderId: string) {
  const supabase = createClient();
  await supabase
    .from("production_orders")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", orderId);
  revalidatePath(`/production/orders/${orderId}`);
  revalidatePath("/production/orders");
  revalidatePath("/operations");
  revalidatePath("/order-follow-up");
  revalidatePath("/dashboard");
  revalidatePath("/business");
}

/**
 * Flip a production order to a new status. Allowed by TLM + admin only.
 * The DB CHECK constraint enforces the value set; no transition graph here —
 * production teams sometimes need to skip steps (e.g. mark cancelled).
 */
export async function updateProductionOrderStatus(formData: FormData) {
  await requireCapability("production_order.edit_status");

  const id = String(formData.get("id"));
  const status = String(formData.get("status") ?? "");
  if (!id) throw new Error("Missing production order id");
  if (!PRODUCTION_ORDER_STATUSES.includes(status as ProductionOrderStatus)) {
    throw new Error("Invalid status");
  }

  const supabase = createClient();
  // Capture the previous status for the audit log.
  const { data: prev } = await supabase
    .from("production_orders")
    .select("status, actual_completion_date")
    .eq("id", id)
    .maybeSingle();
  const previousStatus = (prev?.status as ProductionOrderStatus) ?? null;

  const patch: Record<string, any> = { status };
  // Status-led completion (owner ruling): reaching ANY completed-set status
  // (production_completed / shipment_booked / shipped / delivered) stamps
  // actual_completion_date the FIRST time, if not already set. Forward jumps
  // (e.g. in_production → shipped) are allowed and still capture completion.
  if (
    PRODUCTION_COMPLETED_STATUSES.includes(status as ProductionOrderStatus) &&
    prev &&
    !prev.actual_completion_date
  ) {
    patch.actual_completion_date = new Date().toISOString().slice(0, 10);
  }
  const { error } = await supabase
    .from("production_orders")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Audit log — cancellation gets CRITICAL severity; flipping to
  // production_delayed gets HIGH (an explicit delay declaration must ring
  // the bell AND alert the dashboards — alert-routing audit); everything
  // else stays a medium status_changed event.
  const isCancel = status === "cancelled";
  const isDelayDeclaration = status === "production_delayed";
  await emitEvent({
    entity_type: "production_order",
    entity_id: id,
    event_type: isCancel ? "po.cancelled" : "po.status_changed",
    severity: isCancel ? "critical" : isDelayDeclaration ? "high" : "medium",
    message: isCancel
      ? `Production order cancelled${previousStatus ? ` (was: ${PRODUCTION_ORDER_STATUS_LABEL[previousStatus]})` : ""}`
      : `Status: ${previousStatus ? PRODUCTION_ORDER_STATUS_LABEL[previousStatus] + " → " : ""}${PRODUCTION_ORDER_STATUS_LABEL[status as ProductionOrderStatus]}`,
    payload: {
      from: previousStatus,
      to: status,
      auto_stamped_completion:
        patch.actual_completion_date !== undefined,
    },
    bestEffort: true,
  });

  await touch(id);
}

/**
 * Update the production deadline.
 *
 * CRITICAL: `initial_production_deadline` is set on the FIRST save only,
 * never overwritten. `current_production_deadline` is mutable. Every
 * change writes a row to `production_deadline_changes` so we keep the
 * full audit trail.
 *
 * Optionally accepts a `reason` ("battery shortage") stored on the
 * history row, and an `actual_completion_date` for production_completed
 * timestamps.
 */
export async function updateProductionOrderDeadline(formData: FormData) {
  await requireCapability("production_order.edit_deadline");

  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing production order id");

  // m073 — preferred event-mode input: `days_added` (signed integer).
  // Falls back to the legacy `current_production_deadline` (absolute date)
  // path for any caller that hasn't migrated yet.
  const daysAddedRaw = formData.get("days_added");
  const daysAdded =
    daysAddedRaw == null || String(daysAddedRaw).trim() === ""
      ? null
      : (() => {
          const n = parseInt(String(daysAddedRaw), 10);
          return Number.isFinite(n) ? n : null;
        })();
  const newDateLegacy = dateOrNull(formData, "current_production_deadline");
  const reason = str(formData, "reason");
  // m072: who is responsible? "production" → factory KPI; anything else →
  // external (does NOT poison factory metrics).
  const delayTypeRaw = str(formData, "delay_type");
  const delayType: DelayType | null =
    delayTypeRaw && (DELAY_TYPES as string[]).includes(delayTypeRaw)
      ? (delayTypeRaw as DelayType)
      : null;

  if (daysAdded == null && !newDateLegacy) {
    throw new Error(
      "Provide either `days_added` (new event-mode form) or `current_production_deadline` (legacy)."
    );
  }

  const { userId } = await getCurrentUserRole();
  const supabase = createClient();

  // Load current state so we can decide whether this is the initial set
  // or an additive delay event.
  const { data: existing } = await supabase
    .from("production_orders")
    .select("initial_production_deadline, current_production_deadline")
    .eq("id", id)
    .maybeSingle();
  if (!existing) throw new Error("Production order not found");

  const isInitialSet = !existing.initial_production_deadline;

  // Decide event-mode vs legacy-mode and compute the resulting ETA.
  //   event-mode (m073): days_added is the source of truth.
  //   legacy-mode: a date was posted; derive days_added from the diff.
  let newDate: string;
  let daysApplied: number;
  if (daysAdded != null) {
    if (isInitialSet) {
      throw new Error(
        "Initial deadline isn't yet set — start with the baseline (working days / validation date), not a delay event."
      );
    }
    daysApplied = daysAdded;
    newDate = addDaysIso(existing.current_production_deadline as string, daysAdded);
  } else {
    // newDateLegacy is guaranteed non-null by the earlier check.
    newDate = newDateLegacy as string;
    daysApplied = existing.current_production_deadline
      ? Math.round(
          (Date.parse(newDate + "T00:00:00Z") -
            Date.parse(
              (existing.current_production_deadline as string) + "T00:00:00Z"
            )) /
            86_400_000
        )
      : 0;
  }

  // Zero-day events are no-ops — skip silently so the form doesn't create
  // empty rows when the operator hits Save without changing anything.
  if (!isInitialSet && daysApplied === 0) {
    await touch(id);
    return;
  }

  // m072: any non-initial change MUST carry a delay_type so the factory
  // KPI stays honest.
  if (!isInitialSet && !delayType) {
    throw new Error(
      "Pick a delay type — production / payment / shipping / client / supplier / customs / other."
    );
  }

  const patch: Record<string, any> = {
    current_production_deadline: newDate,
  };
  if (isInitialSet) {
    patch.initial_production_deadline = newDate;
  }
  // Completion date is status-led — only the status setter / markProductionComplete
  // stamp actual_completion_date, never the deadline editor (prevents the
  // date-without-status mismatch, H6).

  const { error } = await supabase
    .from("production_orders")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);

  // For initial set, there's no slip — skip the event row.
  if (!isInitialSet) {
    const histRow: Record<string, any> = {
      production_order_id: id,
      previous_date: existing.current_production_deadline,
      new_date: newDate,
      days_added: daysApplied,
      changed_by: userId,
      reason,
      delay_type: delayType,
    };
    let { error: histErr } = await supabase
      .from("production_deadline_changes")
      .insert(histRow);
    // Tolerate older deployments where one of the new columns isn't
    // applied yet (m072 / m073). Retry without the missing field.
    if (
      histErr &&
      /days_added|delay_type|column .* does not exist/i.test(
        histErr.message ?? ""
      )
    ) {
      const msg = histErr.message ?? "";
      const legacy: Record<string, any> = { ...histRow };
      if (/days_added/i.test(msg)) delete legacy.days_added;
      if (/delay_type/i.test(msg)) delete legacy.delay_type;
      const retry = await supabase
        .from("production_deadline_changes")
        .insert(legacy);
      histErr = retry.error;
    }
    if (histErr) throw new Error(histErr.message);

    // Audit log — HIGH severity so the dashboard surfaces deadline
    // shifts in the critical-events feed.
    const signed = daysApplied > 0 ? `+${daysApplied}d` : `${daysApplied}d`;
    await emitEvent({
      entity_type: "production_order",
      entity_id: id,
      event_type: "po.deadline_changed",
      severity: "high",
      message: `Delay event ${signed}${
        delayType ? ` · ${delayType}` : ""
      } → ETA ${newDate}${reason ? ` (${reason})` : ""}`,
      payload: {
        from: existing.current_production_deadline,
        to: newDate,
        days_added: daysApplied,
        reason: reason ?? null,
        delay_type: delayType,
        is_initial: false,
      },
      bestEffort: true,
    });
  }

  // Belt-and-braces — the inline write above set current = newDate, but
  // recompute keeps us honest in case any future code path inserts a
  // historical row out of order.
  await recomputeOrderDeadline(id);
  await touch(id);
}

/**
 * Edit an existing delay event in place (m074).
 *
 * Editable fields: days_added, delay_type, reason. Any field omitted from
 * the form is left unchanged. After the patch lands we recompute the
 * materialized ETA so the strip / KPI catch up. The before / after diff
 * is captured in the audit log (`po.delay_event_edited`).
 */
export async function updateDelayEvent(formData: FormData) {
  await requireCapability("production_order.edit_deadline");

  const eventId = String(formData.get("event_id") ?? "");
  if (!eventId) throw new Error("Missing event id");

  // Parse the patch — undefined for fields the form didn't send, so we
  // can leave them untouched.
  const daysRaw = formData.get("days_added");
  const daysAdded =
    daysRaw == null || String(daysRaw).trim() === ""
      ? undefined
      : (() => {
          const n = parseInt(String(daysRaw), 10);
          return Number.isFinite(n) ? n : undefined;
        })();
  const delayTypeRaw = formData.has("delay_type")
    ? str(formData, "delay_type")
    : undefined;
  const delayType: DelayType | undefined =
    delayTypeRaw === undefined
      ? undefined
      : delayTypeRaw && (DELAY_TYPES as string[]).includes(delayTypeRaw)
      ? (delayTypeRaw as DelayType)
      : undefined;
  const reason = formData.has("reason") ? str(formData, "reason") : undefined;

  if (daysAdded === undefined && delayType === undefined && reason === undefined) {
    return; // nothing to patch
  }
  if (daysAdded !== undefined && daysAdded === 0) {
    throw new Error(
      "Editing to zero days isn't allowed — delete the event instead."
    );
  }

  const { userId } = await getCurrentUserRole();
  const supabase = createClient();

  // Load current state for the audit diff + the orderId we'll recompute.
  const { data: before } = await supabase
    .from("production_deadline_changes")
    .select(
      "id, production_order_id, days_added, delay_type, reason, previous_date, new_date"
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!before) throw new Error("Delay event not found");

  const patch: Record<string, any> = {
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  if (daysAdded !== undefined) patch.days_added = daysAdded;
  if (delayType !== undefined) patch.delay_type = delayType;
  if (reason !== undefined) patch.reason = reason;

  let { error } = await supabase
    .from("production_deadline_changes")
    .update(patch)
    .eq("id", eventId);
  // Tolerate older deployments without updated_at / updated_by (m074).
  if (
    error &&
    /updated_at|updated_by|column .* does not exist/i.test(error.message ?? "")
  ) {
    const { updated_at, updated_by, ...legacy } = patch;
    const retry = await supabase
      .from("production_deadline_changes")
      .update(legacy)
      .eq("id", eventId);
    error = retry.error;
  }
  if (error) throw new Error(error.message);

  // Recompute the materialized ETA from the new event stream.
  await recomputeOrderDeadline(before.production_order_id as string);

  // Audit — compact before/after summary for the Timeline.
  const diff: string[] = [];
  if (daysAdded !== undefined && daysAdded !== before.days_added) {
    diff.push(`days ${before.days_added ?? "?"} → ${daysAdded}`);
  }
  if (delayType !== undefined && delayType !== before.delay_type) {
    diff.push(`type ${before.delay_type ?? "—"} → ${delayType}`);
  }
  if (reason !== undefined && reason !== before.reason) {
    diff.push(`reason updated`);
  }
  await emitEvent({
    entity_type: "production_order",
    entity_id: before.production_order_id as string,
    event_type: "po.delay_event_edited",
    message: `Delay event edited (${diff.join(" · ") || "no-op"})`,
    payload: {
      event_id: eventId,
      before: {
        days_added: before.days_added,
        delay_type: before.delay_type,
        reason: before.reason,
      },
      after: {
        days_added: daysAdded ?? before.days_added,
        delay_type: delayType ?? before.delay_type,
        reason: reason ?? before.reason,
      },
    },
    bestEffort: true,
  });

  await touch(before.production_order_id as string);
}

/**
 * Delete a delay event (m074). Recomputes the materialized ETA from the
 * remaining events and writes a `po.delay_event_deleted` audit row carrying
 * the deleted values, so the Timeline preserves the history even when the
 * row itself is gone.
 */
export async function deleteDelayEvent(formData: FormData) {
  await requireCapability("production_order.edit_deadline");

  const eventId = String(formData.get("event_id") ?? "");
  if (!eventId) throw new Error("Missing event id");

  const supabase = createClient();
  const { data: before } = await supabase
    .from("production_deadline_changes")
    .select(
      "id, production_order_id, days_added, delay_type, reason, previous_date, new_date, created_at"
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!before) throw new Error("Delay event not found");

  const { error } = await supabase
    .from("production_deadline_changes")
    .delete()
    .eq("id", eventId);
  if (error) throw new Error(error.message);

  await recomputeOrderDeadline(before.production_order_id as string);

  const signed =
    before.days_added != null && Number(before.days_added) > 0
      ? `+${before.days_added}d`
      : `${before.days_added ?? "?"}d`;
  await emitEvent({
    entity_type: "production_order",
    entity_id: before.production_order_id as string,
    event_type: "po.delay_event_deleted",
    message: `Delay event removed (${signed}${
      before.delay_type ? ` · ${before.delay_type}` : ""
    }${before.reason ? ` — ${before.reason}` : ""})`,
    payload: {
      event_id: eventId,
      deleted: {
        days_added: before.days_added,
        delay_type: before.delay_type,
        reason: before.reason,
        created_at: before.created_at,
      },
    },
    bestEffort: true,
  });

  await touch(before.production_order_id as string);
}

/**
 * Update payment receipts on a production order.
 *
 * - Records deposit + balance amounts and dates from the form.
 * - If the deposit becomes fully received (>= expected from the linked
 *   quotation) AND the order is currently in `awaiting_deposit`, the
 *   status auto-advances to `deposit_received`. This makes the
 *   "production can start" signal automatic.
 * - If the balance also becomes fully received, no auto-advance happens
 *   (the production team controls the shipment / delivery flow).
 */
export async function updateProductionOrderPayments(formData: FormData) {
  await requireCapability("production_order.edit_payments");

  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing production order id");

  // Coerce numeric inputs safely. We accept "" as 0 because the form
  // ships empty strings for un-filled fields.
  function numericOrZero(key: string): number {
    const raw = formData.get(key);
    if (raw == null || String(raw).trim() === "") return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  const patch: Record<string, any> = {
    deposit_received_amount: numericOrZero("deposit_received_amount"),
    deposit_received_at: dateOrNull(formData, "deposit_received_at"),
    balance_received_amount: numericOrZero("balance_received_amount"),
    balance_received_at: dateOrNull(formData, "balance_received_at"),
    payment_notes: str(formData, "payment_notes"),
    // m114 (audit Phase 1 — cash). balance_due_date is the MANUAL
    // override: blank clears it and the app falls back to the derived
    // due date (deadline / ETA — computeEffectiveBalanceDueDate).
    balance_due_date: dateOrNull(formData, "balance_due_date"),
    lc_expiry_date: dateOrNull(formData, "lc_expiry_date"),
  };

  const supabase = createClient();

  // Load context: the order's current status + the linked quotation's
  // payment_terms / total_price so we can decide if the deposit is fully
  // received and the status should auto-advance. Also captures the
  // previous receipt amounts for the audit log.
  const { data: existing, error: loadErr } = await supabase
    .from("production_orders")
    .select(
      // production_working_days + initial_production_deadline added so
      // the deposit-activation block below can compute & stamp the
      // Initial Project Completion (only when working_days is set and
      // initial isn't already stamped).
      "id, status, quotation_id, deposit_received_amount, balance_received_amount, production_working_days, initial_production_deadline, documents:quotation_id(total_price, payment_mode, payment_terms)"
    )
    .eq("id", id)
    .maybeSingle();
  if (loadErr || !existing) throw new Error("Production order not found");

  const prevDeposit = Number(existing.deposit_received_amount ?? 0);
  const prevBalance = Number(existing.balance_received_amount ?? 0);

  // Defensive write (same pattern as baseline_locked_at below): if m114
  // isn't applied yet, drop its two columns from the patch and retry so
  // recording receipts keeps working on a pre-m114 database.
  let updateAttempt = await supabase
    .from("production_orders")
    .update(patch)
    .eq("id", id);
  if (
    updateAttempt.error &&
    /balance_due_date|lc_expiry_date/.test(updateAttempt.error.message ?? "")
  ) {
    const { balance_due_date: _d1, lc_expiry_date: _d2, ...fallback } = patch;
    void _d1;
    void _d2;
    updateAttempt = await supabase
      .from("production_orders")
      .update(fallback)
      .eq("id", id);
  }
  if (updateAttempt.error) throw new Error(updateAttempt.error.message);

  // Auto-advance: if the deposit is now fully covered and the order was
  // sitting in awaiting_deposit, move it to deposit_received. Skip if
  // there's no deposit expected (LC mode etc.) — the workflow stays
  // wherever it is.
  const doc = (existing as any).documents;
  let autoAdvanced = false;
  if (existing.status === "awaiting_deposit" && doc) {
    const expectedDeposit = computeExpectedDepositForUpdate(
      Number(doc.total_price ?? 0),
      doc.payment_mode,
      doc.payment_terms
    );
    if (
      expectedDeposit > 0 &&
      patch.deposit_received_amount + 0.01 >= expectedDeposit
    ) {
      // Production ACTIVATES here. Three things happen atomically:
      //   1. Status flips to deposit_received.
      //   2. Initial Project Completion is computed and frozen
      //      (= deposit_received_at + working_days).
      //   3. Baseline is locked — working_days can no longer change,
      //      because changing it would invalidate the frozen
      //      Initial Project Completion.
      const activationPatch: Record<string, any> = {
        status: "deposit_received",
        // Lock the baseline at the activation moment. Pre-activation,
        // working_days stays editable for planning; once we stamp the
        // completion, we must lock the inputs that produced it.
        baseline_locked_at: new Date().toISOString(),
      };
      const startDate = patch.deposit_received_at as string | null;
      const workingDays = (existing as any).production_working_days as
        | number
        | null;
      const alreadyStamped = (existing as any).initial_production_deadline;
      if (startDate && workingDays != null && !alreadyStamped) {
        const projected = addWorkingDays(startDate, workingDays);
        if (projected) {
          activationPatch.initial_production_deadline = projected;
          activationPatch.current_production_deadline = projected;
        }
      }
      // Defensive write: if m041 hasn't been applied, baseline_locked_at
      // doesn't exist — drop it from the patch and retry so the deposit
      // activation still completes. The lock will then be implicit via
      // `isProductionActive` (safety net in isBaselineLocked helper).
      let actAttempt = await supabase
        .from("production_orders")
        .update(activationPatch)
        .eq("id", id);
      if (
        actAttempt.error &&
        /baseline_locked_at/.test(actAttempt.error.message ?? "")
      ) {
        const { baseline_locked_at: _drop, ...fallback } = activationPatch;
        void _drop;
        actAttempt = await supabase
          .from("production_orders")
          .update(fallback)
          .eq("id", id);
      }
      if (actAttempt.error) throw new Error(actAttempt.error.message);
      autoAdvanced = true;
    }
  }

  // Audit log — fire one event per receipt type that actually changed.
  // Deposit-received gets MEDIUM severity (normal cashflow), balance
  // received gets MEDIUM too. Auto-advance gets its own status_changed
  // event so the timeline reads naturally: "Deposit received" then
  // "Status: Awaiting deposit → Deposit received".
  if (patch.deposit_received_amount !== prevDeposit) {
    await emitEvent({
      entity_type: "production_order",
      entity_id: id,
      event_type: "po.deposit_received",
      message: `Deposit updated: ${prevDeposit.toFixed(0)} → ${Number(
        patch.deposit_received_amount
      ).toFixed(0)}`,
      payload: {
        from: prevDeposit,
        to: patch.deposit_received_amount,
        date: patch.deposit_received_at,
      },
      bestEffort: true,
    });
  }
  if (patch.balance_received_amount !== prevBalance) {
    await emitEvent({
      entity_type: "production_order",
      entity_id: id,
      event_type: "po.balance_received",
      message: `Balance updated: ${prevBalance.toFixed(0)} → ${Number(
        patch.balance_received_amount
      ).toFixed(0)}`,
      payload: {
        from: prevBalance,
        to: patch.balance_received_amount,
        date: patch.balance_received_at,
      },
      bestEffort: true,
    });
  }
  if (autoAdvanced) {
    await emitEvent({
      entity_type: "production_order",
      entity_id: id,
      event_type: "po.status_changed",
      message:
        "Status: Awaiting deposit → Deposit received (auto-advance after deposit fully covered)",
      payload: { from: "awaiting_deposit", to: "deposit_received", auto: true },
      bestEffort: true,
    });
  }

  await touch(id);
}

/**
 * Local copy of the deposit-expected calculation kept out of the public
 * helpers so the action file doesn't need to import client-side helpers
 * (server actions and shared types are fine to inline this).
 */
function computeExpectedDepositForUpdate(
  totalPrice: number,
  paymentMode: string | null,
  paymentTerms: any
): number {
  if (!paymentTerms || !paymentMode) return 0;
  if (paymentMode === "lc") return 0;
  const pct = Number(paymentTerms?.deposit_percent ?? 0);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return (totalPrice * pct) / 100;
}

/**
 * Set the production timeline — working days commitment + automatic
 * deadline derivation.
 *
 * Behavior:
 *   - Always updates `production_working_days`.
 *   - Computes a projected deadline = production_validation_date + working_days
 *     (skipping weekends). If `production_validation_date` is missing
 *     (legacy row), we fall back to today.
 *   - On the FIRST write only, also sets the immutable
 *     `initial_production_deadline` — this preserves the "we committed to X
 *     originally" invariant from migration 018.
 *   - Always updates `current_production_deadline` and writes a row into
 *     `production_deadline_changes` so the audit trail stays complete.
 *
 * Accepts an optional `reason` ("battery sourcing slipped") stored in the
 * deadline-change row.
 */
export async function setProductionTimeline(formData: FormData) {
  await requireCapability("production_order.set_timeline");

  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing production order id");

  const daysRaw = formData.get("production_working_days");
  if (daysRaw == null || String(daysRaw).trim() === "") {
    throw new Error("Working days are required");
  }
  const days = Number(daysRaw);
  if (!Number.isFinite(days) || days < 0 || !Number.isInteger(days)) {
    throw new Error("Working days must be a non-negative whole number");
  }
  const reason = str(formData, "reason");

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  // SELECT * — returns whatever columns the DB actually has, never
  // fails on a missing column (m025 deposit_override_*, m041
  // baseline_locked_at). We then read fields defensively from the row
  // with sensible defaults so the action keeps working regardless of
  // which migrations are applied. Real DB errors are surfaced clearly.
  const { data: existing, error: loadErr } = await supabase
    .from("production_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) {
    throw new Error(
      `Could not load production order — ${loadErr.message}.`
    );
  }
  if (!existing) throw new Error("Production order not found");

  // M6 — the working-days baseline freezes at activation. The UI hides the
  // field once locked; the server must enforce it too, or a stale tab / re-
  // submitted POST would silently overwrite the frozen baseline that the
  // delay/lateness model depends on. (Admin "unlock" is the separate PERM-5
  // decision; until then the lock is hard.)
  if (isBaselineLocked(existing)) {
    throw new Error(
      "Production baseline is locked (order activated) — working days can no longer be changed."
    );
  }

  // Validation date — fall back to today only if missing.
  const anchor =
    existing.production_validation_date ??
    new Date().toISOString().slice(0, 10);

  const patch: Record<string, any> = {
    production_working_days: days,
  };
  // Stamp validation date if not already (legacy rows).
  if (!existing.production_validation_date) {
    patch.production_validation_date = anchor;
  }
  // NOTE — baseline_locked_at is NOT stamped here.
  // Per Solux ops workflow, working_days must remain editable BEFORE
  // production activates so commercial / planning can revise the
  // commitment. The lock fires later, at activation (recordPayments /
  // startWithoutDeposit), at the exact moment Initial Project
  // Completion is frozen from `start_date + working_days`.

  /* ----- DEADLINE STAMPING — only at ACTIVATION ---------------------
     The "Initial Project Completion" must NOT be computed from
     validation_date (old behaviour, wrong per Solux workflow). It's
     computed from PRODUCTION START DATE (= deposit_received_at OR
     deposit_override_at) and frozen at activation.

     Cases when this action runs:

     A) Activation already happened (deposit / override) BEFORE working
        days were set → we now have all inputs to compute the FIRST
        deadline. Stamp it once.
     B) Activation hasn't happened yet → leave initial + current
        deadlines NULL. recordPayments / startWithoutDeposit will stamp
        them when activation fires.

     In neither case do we compute from validation_date — that's the
     bug we're fixing here.                                              */
  const startDate =
    existing.deposit_received_at ??
    (existing.deposit_override_at
      ? String(existing.deposit_override_at).slice(0, 10)
      : null);
  let projected: string | null = null;
  if (startDate && !existing.initial_production_deadline) {
    projected = addWorkingDays(startDate, days);
    if (projected) {
      patch.initial_production_deadline = projected;
      // Current starts equal to initial; later edits to current go
      // through changeDeadline and emit deadline_changes events.
      patch.current_production_deadline = projected;
    }
  }

  const { error } = await supabase
    .from("production_orders")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Audit trail — only record a deadline shift when we actually stamped
  // one (case A above: late activation triggered first stamp here).
  // The pre-activation case writes no deadline_changes row because
  // the deadline didn't move — there wasn't one before.
  if (projected && existing.current_production_deadline !== projected) {
    const { error: histErr } = await supabase
      .from("production_deadline_changes")
      .insert({
        production_order_id: id,
        previous_date: existing.current_production_deadline,
        new_date: projected,
        changed_by: userId,
        reason:
          reason ??
          `Initial Project Completion stamped at activation (${days} working days)`,
      });
    if (histErr) throw new Error(histErr.message);
  }

  // Audit event — surface the baseline commitment so sales sees
  // when the factory window "locks in", whether or not the
  // Initial Project Completion was stamped on the same call.
  await emitEvent({
    entity_type: "production_order",
    entity_id: id,
    event_type: "po.timeline_set",
    message: projected
      ? `Production baseline confirmed · ${days} working days · projected completion ${projected}`
      : `Production baseline confirmed · ${days} working days · awaiting deposit to activate`,
    payload: {
      working_days: days,
      anchor: anchor,
      projected,
      from: existing.current_production_deadline,
      to: projected,
      reason: reason ?? null,
    },
    bestEffort: true,
  });

  await touch(id);
}

/**
 * Set / clear the balance reminder offset for a production order.
 *
 * Form fields:
 *   - id    (required)
 *   - days  (number 0-90, OR "none"/"" to clear)
 *
 * Capability: `production_order.edit_payments` (TLM / admin / operations).
 *
 * When set + the order has an ETA + balance not yet received, the
 * dashboard cockpit Payments card surfaces a "balance due in Nd"
 * counter, AND each row's pill flips to amber starting that many
 * days before ETA. Lets ops + sales coordinate proactively instead
 * of reacting once balance is already overdue.
 *
 * Defensive: if m048 isn't applied yet, the update errors on the
 * unknown column — we surface a clean message so the user knows what
 * to apply.
 */
export async function updateBalanceReminderOffset(formData: FormData) {
  await requireCapability("production_order.edit_payments");

  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing production order id");
  const raw = formData.get("balance_reminder_days_before_eta");
  let days: number | null = null;
  const s = raw == null ? "" : String(raw).trim();
  if (s !== "" && s !== "none" && s !== "null") {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 90) {
      throw new Error("Reminder offset must be between 0 and 90 days");
    }
    days = Math.round(n);
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("production_orders")
    .update({ balance_reminder_days_before_eta: days })
    .eq("id", id);
  if (error) {
    if (/balance_reminder_days_before_eta/.test(error.message ?? "")) {
      throw new Error(
        "Balance reminder column not deployed yet. Apply migration 048 in Supabase and try again."
      );
    }
    throw new Error(error.message);
  }

  await emitEvent({
    entity_type: "production_order",
    entity_id: id,
    event_type: "po.shipment_updated", // Re-use existing event type — closest semantic match.
    severity: "low",
    message:
      days == null
        ? "Balance reminder cleared"
        : `Balance reminder set ${days} day${days === 1 ? "" : "s"} before ETA`,
    payload: { balance_reminder_days_before_eta: days },
    bestEffort: true,
  });

  await touch(id);
}

/** Update shipment-related fields (booking + ETD + ETA + notes). */
export async function updateProductionOrderShipment(formData: FormData) {
  await requireCapability("production_order.edit_shipment");

  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing production order id");

  const patch = {
    shipment_booked: bool(formData, "shipment_booked"),
    etd: dateOrNull(formData, "etd"),
    eta: dateOrNull(formData, "eta"),
    shipping_notes: str(formData, "shipping_notes"),
  };

  const supabase = createClient();
  // Capture previous shipment state for audit log.
  const { data: prev } = await supabase
    .from("production_orders")
    .select("shipment_booked, etd, eta, shipping_details, client_id")
    .eq("id", id)
    .maybeSingle();

  // BL workflow gate: CONFIRMING the booking (unchecked → checked) requires a
  // COMPLETE Shipping / BL profile on the client. Every other field on this
  // form can be filled in ahead of time — only the final confirmation is
  // blocked, so Operations never books a shipment that can't be documented.
  if (patch.shipment_booked && !prev?.shipment_booked && prev?.client_id) {
    const { data: cl } = await supabase
      .from("clients")
      .select("bl_profile")
      .eq("id", prev.client_id)
      .maybeSingle();
    const status = blProfileStatus(normalizeBlProfile(cl?.bl_profile ?? null));
    if (status !== "complete") {
      throw new Error(
        "Shipping profile must be completed before logistics booking can be confirmed. " +
          "Use “Request information from Sales” on the Shipping / BL profile block."
      );
    }
  }

  const { error } = await supabase
    .from("production_orders")
    .update(patch)
    .eq("id", id);

  // Shipping / BL execution details (m070) — saved separately so a missing
  // column never blocks the core shipment save. jsonb blob from lib/shipping.
  // MERGE-SAFE: only overwrite the keys actually present in this submission.
  // The order-detail form ships the 9 original keys (no booking/container/
  // tracking), so WITHOUT this guard every save from that form would wipe the
  // 3 Quick-Update keys. Absent keys keep their previous value; present-but-
  // empty keys clear (unchanged behaviour for the full order-detail form).
  const prevShipping = normalizeShippingDetails(prev?.shipping_details ?? null);
  const strOrKeep = (k: string, keep: string | null) =>
    formData.has(k) ? str(formData, k) : keep;
  const numOrKeep = (k: string, keep: number | null) => {
    if (!formData.has(k)) return keep;
    const s = String(formData.get(k) ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const shipping_details = {
    bl_number: strOrKeep("bl_number", prevShipping.bl_number),
    forwarder: strOrKeep("forwarder", prevShipping.forwarder),
    vessel: strOrKeep("vessel", prevShipping.vessel),
    voyage: strOrKeep("voyage", prevShipping.voyage),
    gross_weight: numOrKeep("gross_weight", prevShipping.gross_weight),
    net_weight: numOrKeep("net_weight", prevShipping.net_weight),
    cbm: numOrKeep("cbm", prevShipping.cbm),
    packages: numOrKeep("packages", prevShipping.packages),
    hs_code: strOrKeep("hs_code", prevShipping.hs_code),
    booking_number: strOrKeep("booking_number", prevShipping.booking_number),
    container_number: strOrKeep(
      "container_number",
      prevShipping.container_number
    ),
    tracking_url: strOrKeep("tracking_url", prevShipping.tracking_url),
  };
  const { error: blErr } = await supabase
    .from("production_orders")
    .update({ shipping_details })
    .eq("id", id);
  if (blErr && !/shipping_details|column .* does not exist/i.test(blErr.message ?? "")) {
    throw new Error(blErr.message);
  }
  if (error) throw new Error(error.message);

  // Audit log — surface ETD/ETA changes so sales sees shipment slips.
  const changedFields: string[] = [];
  if (prev?.shipment_booked !== patch.shipment_booked)
    changedFields.push(
      `booking ${prev?.shipment_booked ? "yes" : "no"} → ${patch.shipment_booked ? "yes" : "no"}`
    );
  if ((prev?.etd ?? null) !== patch.etd)
    changedFields.push(`ETD ${prev?.etd ?? "—"} → ${patch.etd ?? "—"}`);
  if ((prev?.eta ?? null) !== patch.eta)
    changedFields.push(`ETA ${prev?.eta ?? "—"} → ${patch.eta ?? "—"}`);

  // SHIP-2 — BL / shipment execution details (bl_number, forwarder, vessel,
  // weights, …) previously changed with NO event, so a BL-only save left no
  // feed/audit trace (the exact data the "BL missing" card watches). Diff them
  // too and fold any change into the same po.shipment_updated event.
  const prevDetails = (prev?.shipping_details ?? {}) as Record<string, unknown>;
  const BL_LABELS: Record<keyof typeof shipping_details, string> = {
    bl_number: "BL#",
    forwarder: "forwarder",
    vessel: "vessel",
    voyage: "voyage",
    gross_weight: "gross wt",
    net_weight: "net wt",
    cbm: "CBM",
    packages: "packages",
    hs_code: "HS code",
    booking_number: "booking#",
    container_number: "container#",
    tracking_url: "tracking",
  };
  const blChanged: string[] = [];
  for (const k of Object.keys(shipping_details) as (keyof typeof shipping_details)[]) {
    if ((prevDetails[k] ?? null) !== (shipping_details[k] ?? null)) {
      blChanged.push(BL_LABELS[k]);
    }
  }
  if (blChanged.length > 0) {
    changedFields.push(`BL details (${blChanged.join(", ")})`);
  }

  if (changedFields.length > 0) {
    await emitEvent({
      entity_type: "production_order",
      entity_id: id,
      event_type: "po.shipment_updated",
      message: `Shipment updated: ${changedFields.join(", ")}`,
      payload: {
        from: {
          shipment_booked: prev?.shipment_booked ?? null,
          etd: prev?.etd ?? null,
          eta: prev?.eta ?? null,
        },
        to: patch,
        ...(blChanged.length > 0
          ? { bl_changed: blChanged, shipping_details_to: shipping_details }
          : {}),
      },
      bestEffort: true,
    });
  }

  await touch(id);
}

/**
 * Admin escape hatch — manually create a production_order for a task list
 * that for some reason didn't auto-create one (legacy data, etc.).
 */
export async function manuallyCreateProductionOrder(formData: FormData) {
  // Same audience as syncOrphanProductionOrders — admin escape hatch
  // for legacy data fixup. Sales should never need this.
  await requireCapability("task_list.sync_orphans");
  const task_list_id = String(formData.get("task_list_id"));
  if (!task_list_id) throw new Error("Missing task list id");

  const supabase = createClient();
  const { data: existing } = await supabase
    .from("production_orders")
    .select("id")
    .eq("task_list_id", task_list_id)
    .maybeSingle();
  if (existing) {
    revalidatePath(`/production/orders/${existing.id}`);
    return;
  }

  const { data: tl, error: tlErr } = await supabase
    .from("production_task_lists")
    .select("quotation_id, client_id")
    .eq("id", task_list_id)
    .single();
  if (tlErr || !tl) throw new Error(tlErr?.message ?? "Task list not found");

  // PO number stays continuous with the quotation (PO-<quote number>),
  // falling back to the per-year counter only if the quote has no number.
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
    const { data: numberRow } = await supabase.rpc(
      "next_production_order_number"
    );
    poNumber = (numberRow as string) ?? null;
  }
  const { userId } = await getCurrentUserRole();
  const { error } = await supabase.from("production_orders").insert({
    number: poNumber,
    task_list_id,
    quotation_id: tl.quotation_id,
    client_id: tl.client_id,
    status: "awaiting_deposit",
    created_by: userId,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/production/orders");
}

/* =====================================================================
   DEPOSIT OVERRIDE — controlled exception for trusted clients
   =====================================================================
   Migration 025 stores `deposit_override_at`, `_by`, `_reason`. This
   action is the one path that writes those fields. Strict admin-only
   so a sales user can never bypass the deposit gate via a crafted
   request.

   Behavior:
     - Refuses to run if the order is not in `awaiting_deposit` status
       (otherwise the override is meaningless — production has already
       progressed past the deposit gate).
     - Refuses to re-activate an existing override (idempotent + loud).
     - Flips status from `awaiting_deposit` → `deposit_received` so
       downstream production tracking unblocks immediately.
     - Emits a HIGH-severity `po.deposit_override` event so the
       timeline + dashboard surface the exception prominently.
   ===================================================================== */

/**
 * Activate the deposit override for a production order.
 *
 * Reads `id` from formData and a REQUIRED `reason` text (audit 2026-06-11
 * P0: a financial exception with no recorded justification is unauditable
 * — who approved it and why must be answerable months later). Admin /
 * super-admin only — TLM is intentionally excluded because TLM normally
 * tracks production state but doesn't authorize financial exceptions.
 */
export async function startWithoutDeposit(formData: FormData) {
  await requireCapability("production_order.start_without_deposit");

  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing production order id");
  const reason = str(formData, "reason");
  if (!reason) {
    throw new Error(
      "A reason is required to start production without deposit — record why the deposit gate is being bypassed (e.g. trusted long-term client, written CFO approval)."
    );
  }

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  // Load context — refuse to act if state doesn't make sense. Pull
  // working_days + initial deadline so we can stamp the Initial
  // Project Completion at the same moment we flip the override.
  const { data: prev, error: loadErr } = await supabase
    .from("production_orders")
    .select(
      "status, deposit_override_at, number, production_working_days, initial_production_deadline"
    )
    .eq("id", id)
    .maybeSingle();
  if (loadErr) throw new Error(loadErr.message);
  if (!prev) throw new Error("Production order not found");

  if (prev.deposit_override_at) {
    throw new Error(
      "Deposit override is already active for this order — re-activation is not allowed."
    );
  }
  if (prev.status !== "awaiting_deposit") {
    throw new Error(
      `Override only applies while the order is awaiting deposit (current status: ${prev.status}).`
    );
  }

  // Stamp the override and unblock production. This is the canonical
  // production activation moment for the override path — same as a
  // received deposit on the normal path. Three things happen atomically:
  //   1. deposit_override_* columns stamped (audit who/when/why).
  //   2. Status flips to deposit_received.
  //   3. Initial Project Completion frozen from `today + working_days`
  //      AND baseline_locked_at stamped (working_days now read-only).
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const overridePatch: Record<string, any> = {
    deposit_override_at: now,
    deposit_override_by: userId,
    deposit_override_reason: reason,
    status: "deposit_received",
    // Lock baseline at the activation moment, just like the normal
    // deposit path. Working_days becomes read-only from here.
    baseline_locked_at: now,
  };
  if (
    (prev as any).production_working_days != null &&
    !(prev as any).initial_production_deadline
  ) {
    const projected = addWorkingDays(
      today,
      (prev as any).production_working_days
    );
    if (projected) {
      overridePatch.initial_production_deadline = projected;
      overridePatch.current_production_deadline = projected;
    }
  }
  // Same defensive fallback as recordPayments: if m041 isn't applied,
  // drop baseline_locked_at from the patch and retry so the override
  // still completes. isBaselineLocked() will fall back to the
  // isProductionActive() safety net.
  let overrideAttempt = await supabase
    .from("production_orders")
    .update(overridePatch)
    .eq("id", id);
  if (
    overrideAttempt.error &&
    /baseline_locked_at/.test(overrideAttempt.error.message ?? "")
  ) {
    const { baseline_locked_at: _drop, ...fallback } = overridePatch;
    void _drop;
    overrideAttempt = await supabase
      .from("production_orders")
      .update(fallback)
      .eq("id", id);
  }
  if (overrideAttempt.error) throw new Error(overrideAttempt.error.message);

  // HIGH-severity event — surfaces on PO timeline + dashboard critical
  // feed so sales / management see the exception immediately.
  await emitEvent({
    entity_type: "production_order",
    entity_id: id,
    event_type: "po.deposit_override",
    severity: "high",
    message: `Production started WITHOUT deposit${
      reason ? ` — ${reason}` : ""
    } (admin override)`,
    payload: {
      override: true,
      previous_status: "awaiting_deposit",
      new_status: "deposit_received",
      reason,
      activated_at: now,
    },
    bestEffort: true,
  });

  await touch(id);
}

/* =====================================================================
   MARK PRODUCTION COMPLETE — explicit completion milestone
   =====================================================================
   The "live tracking" panel surfaces a primary Mark Complete CTA once
   production is active. This action is the canonical entry point:

     - Validates state (must have started, must not be cancelled, must
       not already be complete).
     - Stamps `actual_completion_date` (defaults to today, but accepts
       an explicit override via the form — useful when retroactively
       recording a past completion).
     - Flips status to `production_completed`.
     - Computes the FINAL delay vs. the frozen Initial Project
       Completion (actual − initial) so the timeline event records it
       once and for all.
     - Emits a HIGH-severity `po.production_completed` event so sales
       sees the milestone immediately on the dashboard.

   Why a dedicated action (vs. just using updateProductionOrderStatus)?
     - Distinct capability semantics — completion is a milestone, not a
       generic status flip. The dedicated audit event captures the
       FINAL delay, which the generic status_changed event doesn't.
     - Pre-flight validation: refuses to complete an order that
       hasn't started (no deposit + no override) so the data stays
       coherent.
     - Notes field — lets ops record "shipped via Cosco, container
       SLXU1234567" on the completion event itself.
   ===================================================================== */

/**
 * Mark a production order as complete. Stamps the actual completion
 * date, flips status to `production_completed`, emits a high-severity
 * milestone event.
 *
 * Capability: production_order.edit_status (same as status changes).
 * State guards: must be started (deposit received OR override), not
 * cancelled, not already complete.
 *
 * Form fields:
 *   - id (required) — production order id
 *   - actual_completion_date (optional) — defaults to today
 *   - notes (optional) — appended to the milestone event message
 */
export async function markProductionComplete(formData: FormData) {
  await requireCapability("production_order.edit_status");

  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing production order id");

  const explicitDate = dateOrNull(formData, "actual_completion_date");
  const completionDate =
    explicitDate ?? new Date().toISOString().slice(0, 10);
  const notes = str(formData, "notes");

  const supabase = createClient();
  // Load all the state we need to validate + compute the final delay
  // for the audit event. SELECT * keeps us defensive against missing
  // migrations (deposit_override_*, etc. may not exist on legacy DBs).
  const { data: prev, error: loadErr } = await supabase
    .from("production_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) throw new Error(loadErr.message);
  if (!prev) throw new Error("Production order not found");

  // State guards — refuse to act if the data wouldn't make sense.
  if (prev.actual_completion_date) {
    throw new Error(
      `Production was already marked complete on ${prev.actual_completion_date}.`
    );
  }
  // Status-led no-regression backstop: an order already at/after completion
  // (shipment_booked / shipped / delivered, possibly with a NULL legacy date)
  // must not be flipped back to production_completed.
  if (
    PRODUCTION_COMPLETED_STATUSES.includes(prev.status as ProductionOrderStatus)
  ) {
    throw new Error(
      `Production is already complete (status: ${
        PRODUCTION_ORDER_STATUS_LABEL[prev.status as ProductionOrderStatus]
      }) — marking complete would move it backward.`
    );
  }
  if (prev.status === "cancelled") {
    throw new Error(
      "Cannot mark complete — this production order is cancelled."
    );
  }
  if (!prev.deposit_received_at && !prev.deposit_override_at) {
    throw new Error(
      "Cannot mark complete — production hasn't started yet (no deposit received and no override active)."
    );
  }

  const patch: Record<string, any> = {
    actual_completion_date: completionDate,
    status: "production_completed",
  };
  const { error: updErr } = await supabase
    .from("production_orders")
    .update(patch)
    .eq("id", id);
  if (updErr) throw new Error(updErr.message);

  // Final delay vs. the FROZEN Initial Project Completion. This is the
  // number that goes into the audit log forever; computing it once
  // here makes the event payload self-contained for reporting later.
  const initial = prev.initial_production_deadline as string | null;
  let delayDays: number | null = null;
  if (initial) {
    const initialMs = new Date(initial).getTime();
    const completionMs = new Date(completionDate).getTime();
    if (Number.isFinite(initialMs) && Number.isFinite(completionMs)) {
      delayDays = Math.round(
        (completionMs - initialMs) / (1000 * 60 * 60 * 24)
      );
    }
  }
  const delayLabel =
    delayDays == null
      ? ""
      : delayDays > 0
      ? ` · ${delayDays} day${delayDays === 1 ? "" : "s"} late vs. baseline`
      : delayDays < 0
      ? ` · ${Math.abs(delayDays)} day${
          Math.abs(delayDays) === 1 ? "" : "s"
        } ahead of baseline`
      : " · on time vs. baseline";

  await emitEvent({
    entity_type: "production_order",
    entity_id: id,
    event_type: "po.production_completed",
    severity: "high",
    message: `Production completed on ${completionDate}${delayLabel}${
      notes ? ` — ${notes}` : ""
    }`,
    payload: {
      completion_date: completionDate,
      initial_baseline: initial,
      current_deadline: prev.current_production_deadline ?? null,
      delay_vs_baseline_days: delayDays,
      previous_status: prev.status,
      notes: notes ?? null,
    },
    bestEffort: true,
  });

  await touch(id);
}

/* =====================================================================
   ARCHIVE / DELETE — soft delete (migration 024)
   ===================================================================== */

/**
 * Archive a production order — sets archived_at so default queries
 * skip it. Admin only.
 *
 * Use this for orders that completed long ago or were cancelled and
 * you want to clean up the lists. The row stays in DB for auditing.
 */
export async function archiveProductionOrder(formData: FormData) {
  await requireCapability("production_order.archive");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing production order id");

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("production_orders")
    .update({ archived_at: now, archived_by: userId })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "production_order",
    entity_id: id,
    event_type: "po.status_changed",
    severity: "medium",
    message: "Production order archived",
    payload: { archived_at: now },
    bestEffort: true,
  });

  await touch(id);
}

/** Reverse of archiveProductionOrder. */
export async function unarchiveProductionOrder(formData: FormData) {
  await requireCapability("production_order.archive");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing production order id");

  const supabase = createClient();
  const { error } = await supabase
    .from("production_orders")
    .update({ archived_at: null, archived_by: null })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "production_order",
    entity_id: id,
    event_type: "po.status_changed",
    severity: "low",
    message: "Production order unarchived",
    payload: {},
    bestEffort: true,
  });

  await touch(id);
}

/**
 * Hard delete a production order. **Super-admin only.**
 *
 * Reserved for data cleanup. Use cancelProductionOrder (via
 * updateProductionOrderStatus → 'cancelled') or archiveProductionOrder
 * for normal "make it go away" workflows.
 */
export async function deleteProductionOrder(formData: FormData) {
  await requireCapability("production_order.delete");
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing production order id");

  const supabase = createClient();
  // Capture context for the audit log before the row vanishes.
  const { data: ctx } = await supabase
    .from("production_orders")
    .select("number, status, task_list_id, quotation_id, client_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("production_orders")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "production_order",
    entity_id: id,
    event_type: "po.cancelled",
    severity: "critical",
    message: `Production order ${ctx?.number ?? id.slice(0, 8) + "…"} permanently deleted`,
    payload: {
      number: ctx?.number ?? null,
      previous_status: ctx?.status ?? null,
      task_list_id: ctx?.task_list_id ?? null,
      quotation_id: ctx?.quotation_id ?? null,
      client_id: ctx?.client_id ?? null,
      hard_delete: true,
    },
    bestEffort: true,
  });

  revalidatePath("/production/orders");
  revalidatePath("/operations");
  revalidatePath("/order-follow-up");
  revalidatePath("/dashboard");
  revalidatePath("/business");
}

/* ===========================================================================
   requestBlInfoFromSales — BL workflow step (Operations → Sales).
   ===========================================================================
   Operations discovers the Shipping / BL profile is incomplete BEFORE
   booking, not at the last minute. One click produces, from existing
   mechanics (no new tables):
     1. NOTIFICATION — `po.bl_info_requested` event, severity HIGH → rings
        the bell of the deal's sales owner (events RLS routes visibility).
     2. TASK — a high-stakes planned_action on the affair (m103), due today:
        "Complete Shipping / BL Profile". Shows up red on the affair card
        and in the sales to-do until done.
     3. AFFAIR HISTORY — `affair.bl_info_requested` timeline entry
        ("Operations requested completion of Shipping / BL Profile") with
        actor + timestamp, as every event carries.
   The payload carries client/affair identifiers so the Sales dashboard
   widget ("Missing Shipping Profiles") can render without extra joins.
*/
export async function requestBlInfoFromSales(formData: FormData) {
  await requireCapability("production_order.edit_shipment");

  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing production order id");

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();

  const { data: order } = await supabase
    .from("production_orders")
    .select(
      "id, number, client_id, quotation_id, documents:quotation_id(id, number, affair_id, affair_name, sales_owner_id, created_by), clients:client_id(company_name, bl_profile)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!order) throw new Error("Production order not found");

  const o = order as any;
  const clientName = o.clients?.company_name ?? "—";
  const affairId = (o.documents?.affair_id as string | null) ?? null;
  const affairName = (o.documents?.affair_name as string | null) ?? null;
  const missing = blProfileMissingFields(
    normalizeBlProfile(o.clients?.bl_profile ?? null)
  );

  // Server truth first: if the profile is already complete there is
  // nothing to request — tell Operations instead of spamming Sales.
  if (missing.length === 0) {
    throw new Error(
      "The Shipping / BL profile is already complete — nothing to request. Refresh the page if the panel still shows it as missing."
    );
  }

  // Anti-duplicate: ONE pending request per order. A request is pending
  // while no po.bl_info_resolved event is newer than it (the resolution
  // is emitted automatically when Sales completes the profile). If the
  // profile became incomplete AGAIN after a resolution, a new request is
  // allowed — that's a new issue, not a duplicate.
  const { data: lastReq } = await supabase
    .from("events")
    .select("created_at")
    .eq("entity_type", "production_order")
    .eq("entity_id", id)
    .eq("event_type", "po.bl_info_requested")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastReq) {
    const { data: lastRes } = await supabase
      .from("events")
      .select("created_at")
      .eq("entity_type", "production_order")
      .eq("entity_id", id)
      .eq("event_type", "po.bl_info_resolved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const stillPending =
      !lastRes ||
      Date.parse(lastRes.created_at) < Date.parse(lastReq.created_at);
    if (stillPending) {
      throw new Error(
        `Request already sent to Sales on ${new Date(
          lastReq.created_at
        ).toLocaleString()} — still pending until the BL profile is completed. No duplicate was sent.`
      );
    }
  }

  // 1. Notification — HIGH severity on the order (bell for the sales owner).
  await emitEvent({
    entity_type: "production_order",
    entity_id: id,
    event_type: "po.bl_info_requested",
    message:
      `Operations cannot proceed with shipment booking — the Shipping / BL ` +
      `profile for ${clientName} is incomplete (missing: ${missing.join(", ") || "—"}).`,
    payload: {
      client_id: o.client_id,
      client_name: clientName,
      affair_id: affairId,
      affair_name: affairName,
      missing_fields: missing,
      requested_by: userId,
      // Surfaced on the Sales dashboard card (order ref + deep links).
      order_number: o.number ?? null,
      doc_number: o.documents?.number ?? null,
    },
    bestEffort: true,
  });

  // 2 + 3. Task + affair history — only when the order is filed under an
  // affair (the CRM hierarchy). Legacy unlinked orders still get the
  // notification above.
  if (affairId) {
    await supabase.from("planned_actions").insert({
      affair_id: affairId,
      action_type: "other",
      title: "Complete Shipping / BL Profile",
      due_date: new Date().toISOString().slice(0, 10),
      notes:
        "Operations cannot proceed with shipment booking because the " +
        "Shipping / BL Profile is incomplete. Priority: High.",
      created_by: userId ?? null,
    });

    await emitEvent({
      entity_type: "affair",
      entity_id: affairId,
      event_type: "affair.bl_info_requested",
      message: "Operations requested completion of Shipping / BL Profile.",
      payload: {
        client_id: o.client_id,
        client_name: clientName,
        production_order_id: id,
        missing_fields: missing,
      },
      bestEffort: true,
    });
  }

  revalidatePath(`/production/orders/${id}`);
  revalidatePath("/dashboard");
  if (affairId) revalidatePath(`/affairs/${affairId}`);
}
