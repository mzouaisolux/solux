"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUserRole } from "@/lib/auth";
import { addDaysIso, todayIso } from "@/lib/reminders";

/* ===========================================================================
   Helpers
   =========================================================================== */

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

function intOrNull(fd: FormData, key: string): number | null {
  const v = fd.get(key);
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** Bump every surface that lists reminders. Cheap broadcast; the
 *  per-document path is the only one that matters in the common case,
 *  but the dashboard + operations feed query reminders too. */
function revalidateAll(docId: string) {
  revalidatePath(`/documents/${docId}`);
  revalidatePath("/dashboard");
  revalidatePath("/operations");
  revalidatePath("/business");
}

/* ===========================================================================
   createReminder — sales user attaches a follow-up to a quotation
   ===========================================================================
   Form fields:
     - document_id (required)
     - remind_at   (optional — defaults to today + 7 days)
     - note        (optional, free text)

   Defaults to +7 days because "next week" is the sales reality 90% of
   the time. The picker UI also exposes presets (+3d, +14d, +30d).

   RLS policy `qr_insert_self` enforces `user_id = auth.uid()`, so the
   action layer just trusts the resolved userId. We don't need a
   separate capability check — every authenticated user can manage
   their own reminders.
*/
export async function createReminder(formData: FormData) {
  const { userId } = await getCurrentUserRole();
  if (!userId) throw new Error("Not authenticated");

  const documentId = str(formData, "document_id");
  if (!documentId) throw new Error("Missing document_id");

  const remindAt = str(formData, "remind_at") ?? addDaysIso(todayIso(), 7);
  const note = str(formData, "note");

  // Basic shape validation — RLS will catch the rest. Refuse blatantly
  // wrong date strings so we get a clean error here rather than at the
  // DB.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(remindAt)) {
    throw new Error("Invalid remind_at — expected YYYY-MM-DD");
  }

  const supabase = createClient();
  const { error } = await supabase.from("quotation_reminders").insert({
    document_id: documentId,
    user_id: userId,
    remind_at: remindAt,
    note,
    status: "open",
  });
  if (error) throw new Error(error.message);

  revalidateAll(documentId);
}

/* ===========================================================================
   snoozeReminder — push the reminder date out
   ===========================================================================
   Two modes (form fields):
     - days        (preset: 3, 7, 14, 30) → new date = today + days
     - remind_at   (custom YYYY-MM-DD)    → new date = remind_at

   IMPORTANT: snoozing computes from TODAY, not from the current
   remind_at. Snoozing an overdue reminder by "+3 days" should land
   3 days from now, not 3 days from the past date. This is the
   ergonomic expectation; the old date is irrelevant once you snooze.

   Bumps snooze_count + last_snoozed_at so we can surface
   "chronically snoozed" deals later (e.g. snoozed 5+ times = stale).
*/
export async function snoozeReminder(formData: FormData) {
  const { userId } = await getCurrentUserRole();
  if (!userId) throw new Error("Not authenticated");

  const id = str(formData, "id");
  if (!id) throw new Error("Missing reminder id");

  const days = intOrNull(formData, "days");
  const explicitDate = str(formData, "remind_at");

  const supabase = createClient();
  const { data: existing, error: loadErr } = await supabase
    .from("quotation_reminders")
    .select("id, document_id, remind_at, status, snooze_count")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) throw new Error(loadErr.message);
  if (!existing) throw new Error("Reminder not found");
  if (existing.status !== "open") {
    throw new Error(
      `Cannot snooze a ${existing.status} reminder — re-open it first.`
    );
  }

  let newDate: string;
  if (explicitDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) {
      throw new Error("Invalid remind_at — expected YYYY-MM-DD");
    }
    newDate = explicitDate;
  } else if (days != null && days > 0) {
    newDate = addDaysIso(todayIso(), days);
  } else {
    throw new Error("Provide either a `days` preset or a `remind_at` date.");
  }

  const { error } = await supabase
    .from("quotation_reminders")
    .update({
      remind_at: newDate,
      snooze_count: (existing.snooze_count ?? 0) + 1,
      last_snoozed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidateAll(existing.document_id);
}

/* ===========================================================================
   rescheduleReminder — explicit "move this to a specific date"
   ===========================================================================
   Semantically distinct from snooze: rescheduling means "I'm planning
   ahead", not "I'm pushing this away because I haven't dealt with it".
   So we do NOT bump snooze_count — that metric stays useful as a
   freshness signal for the surfacing logic later.

   Form fields:
     - id        (required)
     - remind_at (required, YYYY-MM-DD)
*/
export async function rescheduleReminder(formData: FormData) {
  const { userId } = await getCurrentUserRole();
  if (!userId) throw new Error("Not authenticated");

  const id = str(formData, "id");
  const remindAt = str(formData, "remind_at");
  if (!id) throw new Error("Missing reminder id");
  if (!remindAt) throw new Error("Missing remind_at");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(remindAt)) {
    throw new Error("Invalid remind_at — expected YYYY-MM-DD");
  }

  const supabase = createClient();
  const { data: existing, error: loadErr } = await supabase
    .from("quotation_reminders")
    .select("document_id, status")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) throw new Error(loadErr.message);
  if (!existing) throw new Error("Reminder not found");
  if (existing.status !== "open") {
    throw new Error(
      `Cannot reschedule a ${existing.status} reminder — re-open it first.`
    );
  }

  const { error } = await supabase
    .from("quotation_reminders")
    .update({ remind_at: remindAt })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidateAll(existing.document_id);
}

/* ===========================================================================
   markReminderDone — the happy path. Stamps the done timestamps,
   flips status, and gets the row out of the user's active list.
   =========================================================================== */
export async function markReminderDone(formData: FormData) {
  const { userId } = await getCurrentUserRole();
  if (!userId) throw new Error("Not authenticated");

  const id = str(formData, "id");
  if (!id) throw new Error("Missing reminder id");

  const supabase = createClient();
  const { data: existing, error: loadErr } = await supabase
    .from("quotation_reminders")
    .select("document_id, status")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) throw new Error(loadErr.message);
  if (!existing) throw new Error("Reminder not found");
  if (existing.status !== "open") {
    throw new Error(`Reminder is already ${existing.status}.`);
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("quotation_reminders")
    .update({ status: "done", done_at: now, done_by: userId })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidateAll(existing.document_id);
}

/* ===========================================================================
   cancelReminder — "I don't need this anymore" (different from Done).
   =========================================================================
   Cancellation means "this was set in error or no longer relevant".
   We keep the row for audit (don't hard-delete) so admin can still
   inspect what was on the user's tickler if needed.
*/
export async function cancelReminder(formData: FormData) {
  const { userId } = await getCurrentUserRole();
  if (!userId) throw new Error("Not authenticated");

  const id = str(formData, "id");
  if (!id) throw new Error("Missing reminder id");

  const supabase = createClient();
  const { data: existing, error: loadErr } = await supabase
    .from("quotation_reminders")
    .select("document_id, status")
    .eq("id", id)
    .maybeSingle();
  if (loadErr) throw new Error(loadErr.message);
  if (!existing) throw new Error("Reminder not found");
  if (existing.status !== "open") {
    throw new Error(`Reminder is already ${existing.status}.`);
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("quotation_reminders")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_by: userId,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidateAll(existing.document_id);
}
