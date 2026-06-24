"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { postEntityComment } from "@/app/(app)/_actions/entity-messages";

/**
 * Strict pre-migration detection — only treat "schema not migrated yet" as a
 * soft-fail. Anything else (RLS denial, permission, FK conflict, network) MUST
 * surface as an error, otherwise Done buttons silently no-op and the dashboard
 * stays polluted with stale actions.
 *
 * Two error families to recognize:
 *
 *   1. Native Postgres (when the action runs against an unmigrated DB):
 *        42P01 = undefined_table     → `action_acks` table missing
 *        42703 = undefined_column    → `state` column missing
 *      Messages: `relation "action_acks" does not exist`,
 *                `column "state" of relation "action_acks" does not exist`.
 *
 *   2. PostgREST schema cache (the table/column exist but the PostgREST API
 *      cache hasn't reloaded yet — common right after an Alter Table):
 *        code: "PGRST204" / "PGRST205"
 *        Messages: `Could not find the '<col>' column of '<table>' in the
 *                   schema cache`,
 *                  `Could not find the table 'public.<table>' in the schema
 *                   cache`.
 *      Treated as soft-fail too — a stale cache is a schema-not-ready
 *      condition, not a real DB error. The operator can fix by running
 *      `notify pgrst, 'reload schema';` (already at the bottom of each
 *      migration).
 */
function isMissingActionAcksSchema(error: any): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "42P01" || code === "42703") return true;
  if (code === "PGRST204" || code === "PGRST205") return true;
  const msg = String(error.message ?? "");
  // Native Postgres "does not exist" — strict patterns so RLS / permission
  // errors that happen to mention the table name aren't swallowed.
  if (/does not exist/i.test(msg)) {
    if (/relation\s+"?action_acks"?\s+does not exist/i.test(msg)) return true;
    if (
      /column\s+"?state"?\s+of relation\s+"?action_acks"?\s+does not exist/i.test(
        msg
      )
    )
      return true;
    if (/column\s+"?action_acks"?\.\??"?state"?\s+does not exist/i.test(msg))
      return true;
  }
  // PostgREST schema-cache miss — distinct wording: "Could not find the
  // '<col>' column of '<table>' in the schema cache".
  if (/could not find/i.test(msg) && /schema cache/i.test(msg)) {
    if (/action_acks/i.test(msg)) return true;
  }
  return false;
}

/** Same idea for the m075 notes table — schema-missing vs real errors. */
function isMissingActionNotesSchema(error: any): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "42P01") return true;
  if (code === "PGRST204" || code === "PGRST205") return true;
  const msg = String(error.message ?? "");
  if (/does not exist/i.test(msg) && /action_notes/i.test(msg)) return true;
  if (/could not find/i.test(msg) && /schema cache/i.test(msg)) {
    if (/action_notes/i.test(msg)) return true;
  }
  return false;
}

/**
 * Acknowledge a follow-up item in the Action Center (m069).
 *
 * "Acknowledge" = a human has seen this and is on it. The item stays visible
 * but dims; it only disappears when the underlying condition resolves (the
 * engine simply stops deriving it). One ack per action_key, team-wide.
 *
 * Soft-fails if m069 isn't applied — never blocks the page.
 */
export async function acknowledgeAction(formData: FormData) {
  const action_key = String(formData.get("action_key") ?? "").trim();
  if (!action_key) throw new Error("Missing action key");
  const note = String(formData.get("note") ?? "").trim() || null;

  const { userId } = await getCurrentUserRole();
  const supabase = createClient();
  const { error } = await supabase.from("action_acks").upsert(
    {
      action_key,
      acknowledged_by: userId,
      acknowledged_at: new Date().toISOString(),
      state: "acknowledged",
      note,
    },
    { onConflict: "action_key" }
  );
  if (error && !isMissingActionAcksSchema(error)) {
    throw new Error(`Couldn't acknowledge action: ${error.message}`);
  }
  revalidatePath("/dashboard-v2");
  revalidatePath("/dashboard");
}

/**
 * Mark an action "Done" — removes it from the Action Center list (both
 * dashboards). It stays hidden until the same condition recurs as a fresh
 * action. Use when you've handled something outside the app, or it no longer
 * needs tracking.
 *
 * Soft-fails ONLY when m069 isn't applied. Previously the regex was so loose
 * (`action_acks|state|relation .* does not exist`) that RLS / permission /
 * conflict errors silently no-op'd — the upsert never landed, the card came
 * back on revalidate, and the dashboard slowly filled with stale items the
 * user thought they had cleared. Strict schema-only soft-fail now.
 */
export async function markActionDone(formData: FormData) {
  const action_key = String(formData.get("action_key") ?? "").trim();
  if (!action_key) throw new Error("Missing action key");

  const { userId } = await getCurrentUserRole();
  const supabase = createClient();
  const { error } = await supabase.from("action_acks").upsert(
    {
      action_key,
      acknowledged_by: userId,
      acknowledged_at: new Date().toISOString(),
      state: "done",
    },
    { onConflict: "action_key" }
  );
  if (error && !isMissingActionAcksSchema(error)) {
    throw new Error(`Couldn't mark action done: ${error.message}`);
  }
  revalidatePath("/dashboard-v2");
  revalidatePath("/dashboard");
}

/** Undo an acknowledgement — the item returns to its active (un-dimmed) state. */
export async function unacknowledgeAction(formData: FormData) {
  const action_key = String(formData.get("action_key") ?? "").trim();
  if (!action_key) throw new Error("Missing action key");

  const supabase = createClient();
  const { error } = await supabase
    .from("action_acks")
    .delete()
    .eq("action_key", action_key);
  if (error && !isMissingActionAcksSchema(error)) {
    throw new Error(`Couldn't undo acknowledge: ${error.message}`);
  }
  revalidatePath("/dashboard-v2");
  revalidatePath("/dashboard");
}

/**
 * Pin a micro-operational note to an action card (m075).
 *
 * "Factory confirmed shipment next week", "Client informed on WhatsApp",
 * "Waiting supplier reply" — short status updates that stop the operational
 * nervous system from going deaf between Slack / WhatsApp / verbal nudges.
 * NOT a chat system — just a small append-only log per action item.
 *
 * Soft-fails if m075 isn't applied — never blocks the page.
 */
export async function addActionNote(formData: FormData) {
  const entity_type = String(formData.get("entity_type") ?? "").trim();
  const entity_id = String(formData.get("entity_id") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!entity_type || !entity_id) throw new Error("Missing entity for note");
  if (!body) return; // empty submit — no-op
  if (body.length > 4000)
    throw new Error("Note is too long (max 4000 characters).");

  // Canonical store = the per-entity conversation (entity_messages). Reusing
  // postEntityComment keeps the visibility guard (assertEntityReadable) + RLS,
  // and the note then shows in BOTH the conversation drawer and the bell —
  // one operational memory per order/project (Decision C). The legacy
  // action_notes table (m075) is no longer written.
  const fd = new FormData();
  fd.set("entity_type", entity_type);
  fd.set("entity_id", entity_id);
  fd.set("message", body);
  await postEntityComment(fd);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard-v2");
}

/** Delete one of your OWN notes from an action card. RLS enforces authorship
 *  at the DB layer; we don't need an extra check here. */
export async function deleteActionNote(formData: FormData) {
  const note_id = String(formData.get("note_id") ?? "").trim();
  if (!note_id) throw new Error("Missing note id");

  const supabase = createClient();
  const { error } = await supabase
    .from("action_notes")
    .delete()
    .eq("id", note_id);
  if (error && !isMissingActionNotesSchema(error)) {
    throw new Error(`Couldn't delete note: ${error.message}`);
  }
  revalidatePath("/dashboard-v2");
  revalidatePath("/dashboard");
}
