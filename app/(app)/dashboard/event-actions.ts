"use server";

/**
 * Server actions for the Operations Feed event workflow.
 *
 * Lifecycle (m044 — collaborative ticket model):
 *
 *      ┌──────────────────────────────────────────────────────┐
 *      │                                                      │
 *   open ──→ acknowledged ──→ working ──→ resolved            │
 *      │      │           │     │                             │
 *      │      ▼           ▼     │                             │
 *      └──→ waiting ←─────┴─────┘                             │
 *           (with waiting_for: client/supplier/bank/…)        │
 *                                                             │
 *           escalated ←──── (any non-resolved) ────────────── ┘
 *
 *   resolved ──→ open  (reopen)
 *
 * Status transitions are intentionally permissive — operations work
 * isn't linear, and forcing a strict graph (e.g. "must ack before
 * working") creates friction. The drawer UI surfaces only the
 * transitions that make sense from the current state.
 *
 * Comments are append-only — see `addEventComment`.
 * Ownership is claimed via `claimEventOwnership` and can be reassigned
 * by anyone (this is a coordination tool, not an access control).
 *
 * RLS: every authenticated user can update events (m039) + insert
 * comments (m039). No capability gate here — operations coordination
 * spans every role.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import type { EventStatus, EventWaitingFor } from "@/lib/events-shared";

/* ===========================================================================
   Status transitions
   =========================================================================== */

type Transition =
  | { status: "open"; clearResolved?: boolean }
  | { status: "acknowledged" }
  | { status: "working"; claimOwnership?: boolean }
  | { status: "waiting"; waitingFor: EventWaitingFor | null }
  | { status: "escalated" }
  | { status: "resolved" };

async function setEventStatus(eventId: string, next: Transition) {
  if (!eventId) throw new Error("Missing event id");
  const supabase = createClient();
  const { userId } = await getCurrentUserRole();
  const now = new Date().toISOString();

  // Patch shape varies per transition so the audit columns stay
  // accurate (acknowledged_at only stamped when entering ack, etc.).
  const patch: Record<string, any> = { status: next.status };
  switch (next.status) {
    case "open":
      if (next.clearResolved) {
        patch.resolved_at = null;
      }
      // Reopening clears the waiting reason — it's stale signal.
      patch.waiting_for = null;
      break;
    case "acknowledged":
      patch.acknowledged_at = now;
      patch.acknowledged_by = userId;
      // Acknowledging clears any prior waiting context.
      patch.waiting_for = null;
      break;
    case "working":
      patch.acknowledged_at = now;
      patch.acknowledged_by = userId;
      patch.waiting_for = null;
      // Claiming ownership on transition to working is the default —
      // "I'm working on it" implies I'm the owner.
      if (next.claimOwnership !== false) {
        patch.owner_id = userId;
        patch.owner_assigned_at = now;
      }
      break;
    case "waiting":
      patch.acknowledged_at = now;
      patch.acknowledged_by = userId;
      patch.waiting_for = next.waitingFor;
      break;
    case "escalated":
      patch.acknowledged_at = now;
      patch.acknowledged_by = userId;
      patch.waiting_for = "management";
      break;
    case "resolved":
      patch.resolved_at = now;
      patch.acknowledged_at = patch.acknowledged_at ?? now;
      patch.acknowledged_by = patch.acknowledged_by ?? userId;
      // Clear the waiting reason — the ticket is closed.
      patch.waiting_for = null;
      break;
  }

  // Defensive write: if m044 hasn't been applied, the new columns
  // (waiting_for / owner_id) don't exist. Retry without them so the
  // base m039 status update still goes through. We surface a clearer
  // error if the base status column is also missing.
  let attempt = await supabase
    .from("events")
    .update(patch)
    .eq("id", eventId);
  if (attempt.error && /waiting_for|owner_id|owner_assigned_at/.test(attempt.error.message ?? "")) {
    const { waiting_for: _w, owner_id: _o, owner_assigned_at: _oa, ...fallback } = patch;
    void _w; void _o; void _oa;
    attempt = await supabase
      .from("events")
      .update(fallback)
      .eq("id", eventId);
  }
  if (attempt.error) {
    if (/status|acknowledged|resolved|due_date/.test(attempt.error.message ?? "")) {
      throw new Error(
        "Event status workflow is not deployed yet. Apply migrations 039 and 044 in Supabase and try again."
      );
    }
    throw new Error(attempt.error.message);
  }

  // Revalidate every surface that renders events so the feed reflects
  // the new state immediately.
  revalidatePath("/dashboard");
  revalidatePath("/operations");
}

/** Mark an event acknowledged (someone has seen it). */
export async function acknowledgeEvent(formData: FormData) {
  const id = String(formData.get("event_id"));
  await setEventStatus(id, { status: "acknowledged" });
}

/** "I'm working on it" — claims ownership by default + stamps the
 *  working status. The owner is the user who clicked the button. */
export async function markEventWorking(formData: FormData) {
  const id = String(formData.get("event_id"));
  const claim = formData.get("claim_ownership");
  await setEventStatus(id, {
    status: "working",
    claimOwnership: claim == null ? true : claim !== "false",
  });
}

/** Park an event in "waiting" — accepts an optional `waiting_for`
 *  sub-state from the form (client/supplier/bank/etc.). */
export async function markEventWaiting(formData: FormData) {
  const id = String(formData.get("event_id"));
  const rawWaitingFor = String(formData.get("waiting_for") ?? "").trim();
  const valid: EventWaitingFor[] = [
    "client",
    "sales",
    "operations",
    "supplier",
    "bank",
    "management",
    "other",
  ];
  const waitingFor = valid.includes(rawWaitingFor as EventWaitingFor)
    ? (rawWaitingFor as EventWaitingFor)
    : null;
  await setEventStatus(id, { status: "waiting", waitingFor });
}

/** Flag an event for management review. Sets waiting_for=management
 *  in the same write so the badge surfaces the routing. */
export async function escalateEvent(formData: FormData) {
  const id = String(formData.get("event_id"));
  await setEventStatus(id, { status: "escalated" });
}

/** Close the loop on an event. */
export async function resolveEvent(formData: FormData) {
  const id = String(formData.get("event_id"));
  await setEventStatus(id, { status: "resolved" });
}

/** Re-open a previously resolved event. */
export async function reopenEvent(formData: FormData) {
  const id = String(formData.get("event_id"));
  await setEventStatus(id, { status: "open", clearResolved: true });
}

/* ===========================================================================
   Ownership
   =========================================================================== */

/** Claim ownership of an event without changing its status.
 *  Useful when you want to "carry" an event that's already in
 *  waiting/escalated/etc. without resetting its workflow state. */
export async function claimEventOwnership(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  if (!eventId) throw new Error("Missing event id");
  const { userId } = await getCurrentUserRole();
  const supabase = createClient();
  const now = new Date().toISOString();

  let attempt = await supabase
    .from("events")
    .update({ owner_id: userId, owner_assigned_at: now })
    .eq("id", eventId);
  if (attempt.error && /owner_id|owner_assigned_at/.test(attempt.error.message ?? "")) {
    throw new Error(
      "Ownership tracking is not deployed yet. Apply migration 044 in Supabase."
    );
  }
  if (attempt.error) throw new Error(attempt.error.message);

  revalidatePath("/dashboard");
  revalidatePath("/operations");
}

/** Release ownership (the row's owner_id becomes NULL). */
export async function releaseEventOwnership(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  if (!eventId) throw new Error("Missing event id");
  const supabase = createClient();

  let attempt = await supabase
    .from("events")
    .update({ owner_id: null, owner_assigned_at: null })
    .eq("id", eventId);
  if (attempt.error && /owner_id|owner_assigned_at/.test(attempt.error.message ?? "")) {
    throw new Error(
      "Ownership tracking is not deployed yet. Apply migration 044 in Supabase."
    );
  }
  if (attempt.error) throw new Error(attempt.error.message);

  revalidatePath("/dashboard");
  revalidatePath("/operations");
}

/* ===========================================================================
   Comments
   =========================================================================== */

/* ===========================================================================
   Read state — per-user "I've seen this event up to NOW" bookkeeping.
   ===========================================================================
   `markEventRead` is a fire-and-forget side effect called when the
   drawer opens. Soft-fails (warn, never throw) so a stale schema or
   a flaky network doesn't break the drawer UX. The unread count
   helpers in lib/events.ts derive everything from this table. */

export async function markEventRead(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  if (!eventId) return; // silent — this is a side effect, no UI feedback
  const { userId } = await getCurrentUserRole();
  if (!userId) return;

  const supabase = createClient();
  const { error } = await supabase.from("event_reads").upsert(
    {
      user_id: userId,
      event_id: eventId,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "user_id,event_id" }
  );
  if (error) {
    // Soft-fail: m045 not applied yet, RLS quirk, etc. — log and move
    // on rather than crashing the drawer.
    console.warn("[markEventRead] soft-fail:", error.message);
    return;
  }

  // Revalidate so the next render reflects the fresh read state
  // (unread badges disappear from the feed + cockpit).
  revalidatePath("/dashboard");
  revalidatePath("/operations");
}

/** Append a comment to the event's thread. */
export async function addEventComment(formData: FormData) {
  const eventId = String(formData.get("event_id"));
  const comment = String(formData.get("comment") ?? "").trim();
  if (!eventId) throw new Error("Missing event id");
  if (!comment) throw new Error("Comment cannot be empty");
  if (comment.length > 2000) throw new Error("Comment is too long");

  const supabase = createClient();
  const { userId } = await getCurrentUserRole();
  const { error } = await supabase.from("event_comments").insert({
    event_id: eventId,
    user_id: userId ?? null,
    comment,
  });
  if (error) {
    if (
      /relation .*event_comments.* does not exist/i.test(error.message ?? "")
    ) {
      throw new Error(
        "Event comments table is not deployed yet. Apply migration 039 in Supabase and try again."
      );
    }
    throw new Error(error.message);
  }

  revalidatePath("/dashboard");
  revalidatePath("/operations");
}
