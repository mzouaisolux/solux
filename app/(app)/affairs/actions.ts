"use server";

// =====================================================================
// Affairs (Projects) — server actions. P2b-1.
//
// Writes to the `affairs` table (m076/m077). RLS already gates these
// (insert/update by creator/owner/technical). Owner reassignment is
// additionally gated to management here. No deletes — cleanup is status
// (lost/abandoned) or a soft archive (archived_at + mandatory reason).
// =====================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import { canSupervise } from "@/lib/types";
import { emitEvent } from "@/lib/events";

const LIFECYCLE = [
  "lead",
  // m109 — first stage of a tender-sourced opportunity: review the tender.
  "tender_review",
  // m108 — tender-sourced opportunity created BEFORE the local partner
  // (distributor / EPC / installer) is known.
  "partner_selection",
  "opportunity",
  "quotation",
  "negotiation",
  "won",
  "in_production",
  "shipped",
  "completed",
  "lost",
  "abandoned",
] as const;

const now = () => new Date().toISOString();

/** Affair source — the commercial origin of a deal (m102, revised m125).
 *  Not exported — "use server" files may only export async functions; the
 *  UI labels live in components/affairs/affair-sources.ts. Keep this list in
 *  sync with that file and the affairs_source_check constraint. */
const AFFAIR_SOURCES = [
  "tender",
  "prospecting",
  "referral",
  "existing_customer_opportunity",
  "partner",
  "website_inquiry",
  "exhibition_event",
  "direct_request",
  "other",
] as const;

function parseSource(raw: FormDataEntryValue | null): string | null {
  const v = String(raw ?? "").trim();
  return (AFFAIR_SOURCES as readonly string[]).includes(v) ? v : null;
}

/** Create a project FIRST — before any quotation. */
export async function createAffair(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Project name is required");
  const client_id = String(formData.get("client_id") ?? "") || null;
  const ownerRaw = String(formData.get("owner_id") ?? "");
  const owner_id = ownerRaw && ownerRaw !== "__unassign__" ? ownerRaw : user?.id ?? null;
  const source = parseSource(formData.get("source"));

  const base = {
    name,
    client_id,
    owner_id,
    status: "lead",
    created_by: user?.id ?? null,
  };
  let { data, error } = await supabase
    .from("affairs")
    .insert({ ...base, source })
    .select("id")
    .single();
  // Defensive pre-m102: if the source column doesn't exist yet, retry
  // without it so affair creation never breaks on a pending migration.
  if (error && /source/i.test(error.message)) {
    ({ data, error } = await supabase
      .from("affairs")
      .insert(base)
      .select("id")
      .single());
  }
  if (error) throw new Error(error.message);
  revalidatePath("/affairs");
  revalidatePath("/clients");
  // Return the new id so the caller can redirect to the created affair (#2).
  return { id: (data?.id as string) ?? null };
}

/** Inline "+ New Project" from the quotation builder. Creates the affair and
 *  RETURNS its {id, name} so the client can append + auto-select it without a
 *  page reload (no form data lost). Description persists once m129 is applied;
 *  before that it falls back to creating without it. */
export async function quickCreateAffair(input: {
  clientId: string;
  name: string;
  description?: string | null;
}): Promise<{ id: string; name: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const name = input.name.trim();
  if (!name) throw new Error("Project name is required");
  if (!input.clientId) throw new Error("A client is required");
  const description = (input.description ?? "").trim() || null;

  const base = {
    name,
    client_id: input.clientId,
    owner_id: user?.id ?? null,
    status: "lead",
    created_by: user?.id ?? null,
    source: "direct_request",
  };
  let res = await supabase
    .from("affairs")
    .insert({ ...base, description })
    .select("id, name")
    .single();
  // Defensive: retry without description (pre-m129), keeping source; if source
  // itself is unsupported (pre-m102) drop it too — the inline "+ New Project"
  // must never lose the in-progress quote over a pending migration.
  if (res.error && /description|source/i.test(res.error.message)) {
    res = await supabase.from("affairs").insert(base).select("id, name").single();
    if (res.error && /source/i.test(res.error.message)) {
      const { source: _src, ...baseNoSource } = base;
      res = await supabase
        .from("affairs")
        .insert(baseNoSource)
        .select("id, name")
        .single();
    }
  }
  if (res.error || !res.data) {
    // FK 23503 on client_id = the client row is GONE (deleted while this
    // builder was open; a client delete SET NULLs its affairs, m076). The raw
    // Postgres message reads like a server bug — say what actually happened.
    if (res.error?.code === "23503" && /client/i.test(res.error.message)) {
      throw new Error(
        "This client no longer exists — it may have been deleted while this page was open. Reload the page and select a current client."
      );
    }
    throw new Error(res.error?.message ?? "Could not create the project");
  }
  revalidatePath("/clients");
  revalidatePath("/affairs");
  return { id: res.data.id as string, name: res.data.name as string };
}

/** CRM step 3 (m102): tag / re-tag where the deal came from. */
export async function setAffairSource(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing project id");
  const source = parseSource(formData.get("source"));
  const supabase = createClient();
  const { error } = await supabase
    .from("affairs")
    .update({ source, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/affairs/${id}`);
  revalidatePath("/clients");
}

export async function renameAffair(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id) throw new Error("Missing project id");
  if (!name) throw new Error("Project name is required");
  const supabase = createClient();
  const { error } = await supabase
    .from("affairs")
    .update({ name, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/affairs");
}

/** Set the independent project lifecycle status (also used by lost/abandoned). */
export async function setAffairStatus(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id) throw new Error("Missing project id");
  if (!(LIFECYCLE as readonly string[]).includes(status)) {
    throw new Error("Invalid project status");
  }
  const supabase = createClient();
  const { error } = await supabase
    .from("affairs")
    .update({ status, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/affairs");
}

/** Assign the project owner; owner is inherited by the project's documents. */
export async function setAffairOwner(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing project id");
  const raw = String(formData.get("owner_id") ?? "");
  const owner_id = raw && raw !== "__unassign__" ? raw : null;

  const { role } = await getCurrentUserRole();
  if (!canSupervise(role)) {
    throw new Error("Only management roles can reassign project ownership.");
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("affairs")
    .update({ owner_id, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Owner inheritance: propagate to this project's documents (m066).
  await supabase.from("documents").update({ sales_owner_id: owner_id }).eq("affair_id", id);

  revalidatePath("/affairs");
}

/** Soft archive — reason is mandatory (Decision F). No destructive delete. */
export async function archiveAffair(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!id) throw new Error("Missing project id");
  if (!reason) throw new Error("An archive reason is required.");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("affairs")
    .update({
      archived_at: now(),
      archived_by: user?.id ?? null,
      archive_reason: reason,
      updated_at: now(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/affairs");
}

/**
 * Hard-delete a project — only when EMPTY. If any quotation is still linked,
 * refuse and point the user to Archive (mirrors the client-delete safety rule:
 * never orphan linked records). Quotations themselves are never deleted here.
 */
export async function deleteAffair(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing project id");
  const supabase = createClient();

  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("affair_id", id);
  if ((count ?? 0) > 0) {
    throw new Error(
      `Cannot delete this project — ${count} quotation(s) are still linked. ` +
        `Remove them from the project first, or use "Archive project" instead.`,
    );
  }

  const { error } = await supabase.from("affairs").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/affairs");
  revalidatePath("/clients", "layout");
}

/** Resolve a document's whole version family (root + all its revisions). */
async function familyIds(
  supabase: ReturnType<typeof createClient>,
  documentId: string,
): Promise<string[]> {
  const { data: doc } = await supabase
    .from("documents")
    .select("id, root_document_id")
    .eq("id", documentId)
    .single();
  const root = (doc?.root_document_id as string | null) ?? documentId;
  const { data: fam } = await supabase
    .from("documents")
    .select("id")
    .or(`id.eq.${root},root_document_id.eq.${root}`);
  const ids = (fam ?? []).map((d: { id: string }) => d.id);
  return ids.length ? ids : [documentId];
}

/** Assign an existing quotation (and its whole version family) to a project. */
export async function assignDocumentToAffair(formData: FormData) {
  const affair_id = String(formData.get("affair_id") ?? "");
  const document_id = String(formData.get("document_id") ?? "");
  if (!affair_id || !document_id) throw new Error("Missing project or document id");
  const supabase = createClient();
  const ids = await familyIds(supabase, document_id);
  const { error } = await supabase.from("documents").update({ affair_id }).in("id", ids);
  if (error) throw new Error(error.message);
  // Keep linked production records consistent (the version family moves together).
  await supabase.from("production_task_lists").update({ affair_id }).in("quotation_id", ids);
  await supabase.from("production_orders").update({ affair_id }).in("quotation_id", ids);
  revalidatePath("/affairs");
  revalidatePath(`/affairs/${affair_id}`);
}

/** Remove a quotation (and its version family) from its project. */
export async function unassignDocument(formData: FormData) {
  const document_id = String(formData.get("document_id") ?? "");
  const affair_id = String(formData.get("affair_id") ?? "");
  if (!document_id) throw new Error("Missing document id");
  const supabase = createClient();
  const ids = await familyIds(supabase, document_id);
  const { error } = await supabase
    .from("documents")
    .update({ affair_id: null })
    .in("id", ids);
  if (error) throw new Error(error.message);
  await supabase.from("production_task_lists").update({ affair_id: null }).in("quotation_id", ids);
  await supabase.from("production_orders").update({ affair_id: null }).in("quotation_id", ids);
  revalidatePath("/affairs");
  if (affair_id) revalidatePath(`/affairs/${affair_id}`);
}

// =====================================================================
// CRM step 4 (m103) — planned actions: the affair's to-do engine.
// One thin table; completing an action logs into `events` (entity
// 'affair') so history lives in the existing timeline. Golden rule
// (enforced visually, not in DB): a live affair always has a next
// action with a date.
// =====================================================================

const ACTION_TYPES = ["call", "meeting", "visit", "follow_up", "send_quote", "other"] as const;
const ACTION_LABEL: Record<string, string> = {
  call: "Call",
  meeting: "Meeting",
  visit: "Site visit",
  follow_up: "Follow-up",
  send_quote: "Send quote",
  other: "Action",
};

export async function createPlannedAction(formData: FormData) {
  const affairId = String(formData.get("affair_id") ?? "");
  if (!affairId) throw new Error("Missing project id");
  const type = String(formData.get("action_type") ?? "");
  if (!(ACTION_TYPES as readonly string[]).includes(type)) {
    throw new Error("Pick an action type");
  }
  const dueDate = String(formData.get("due_date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error("A planned action needs a due date");
  }
  const title = String(formData.get("title") ?? "").trim() || null;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("planned_actions").insert({
    affair_id: affairId,
    action_type: type,
    title,
    due_date: dueDate,
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "affair",
    entity_id: affairId,
    event_type: "affair.action_planned",
    message: `${ACTION_LABEL[type]} planned${title ? `: ${title}` : ""} — due ${dueDate}`,
    payload: { action_type: type, title, due_date: dueDate },
    bestEffort: true,
  });
  revalidatePath(`/affairs/${affairId}`);
}

export async function completePlannedAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const affairId = String(formData.get("affair_id") ?? "");
  if (!id || !affairId) throw new Error("Missing action id");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: snapshot } = await supabase
    .from("planned_actions")
    .select("action_type, title, due_date")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("planned_actions")
    .update({ done_at: now(), done_by: user?.id ?? null, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  const label = ACTION_LABEL[snapshot?.action_type ?? "other"] ?? "Action";
  await emitEvent({
    entity_type: "affair",
    entity_id: affairId,
    event_type: "affair.action_done",
    message: `${label} done${snapshot?.title ? `: ${snapshot.title}` : ""}`,
    payload: snapshot ?? undefined,
    bestEffort: true,
  });
  revalidatePath(`/affairs/${affairId}`);
}

export async function deletePlannedAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const affairId = String(formData.get("affair_id") ?? "");
  if (!id || !affairId) throw new Error("Missing action id");

  const supabase = createClient();
  const { data: snapshot } = await supabase
    .from("planned_actions")
    .select("action_type, title")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("planned_actions").delete().eq("id", id);
  if (error) throw new Error(error.message);

  const label = ACTION_LABEL[snapshot?.action_type ?? "other"] ?? "Action";
  await emitEvent({
    entity_type: "affair",
    entity_id: affairId,
    event_type: "affair.action_deleted",
    message: `Planned ${label.toLowerCase()} removed${snapshot?.title ? `: ${snapshot.title}` : ""}`,
    bestEffort: true,
  });
  revalidatePath(`/affairs/${affairId}`);
}
