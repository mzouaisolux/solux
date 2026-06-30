"use server";

// =====================================================================
// CRM sandbox (m104) — prospects + raw tenders. Server actions.
//
// The two conversion paths both land in the same client → affair
// pipeline (PLAN_CRM_SOLUX §7):
//   • prospect --switch--> client (TRANSFORMATION, no duplicate: the
//     prospect keeps status='converted' + converted_client_id).
//   • open tender --attach to a company--> AFFAIR (source='tender',
//     source_tender_id). If attached to a prospect, the prospect is
//     converted to a client first — one click, zero friction.
//   • result tender → participants (intel) → each promotable to a
//     prospect (source='tender').
//
// Everything is gated by prospect.access + RLS (shared sandbox pool).
// =====================================================================

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/permissions";
import { getCurrentUserRole } from "@/lib/auth";
import { emitEvent } from "@/lib/events";
import {
  normalizeCompanyKey,
  prospectStatusAfterActivity,
  PROSPECT_STATUSES_V2,
} from "@/lib/prospect-intel";
import {
  pick,
  parseAmount,
  participantEntry,
  rawKeysOf,
  applyWinnerItemContacts,
  companyDirectory,
  winnersFromLots,
  chunkByUrlBudget,
  CONTACT_NESTS,
  CONTACT_KEYS,
  type AttributionContact,
} from "@/lib/attribution-parse";
import {
  extractLots,
  marketReferenceOf,
  matchTender,
  type TenderIdentity,
} from "@/lib/tender-identity";

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
const now = () => new Date().toISOString();

function revalidate() {
  revalidatePath("/prospects");
  // Tender Workspace pages read the same data (participants, prospects,
  // tasks) — keep them fresh after any CRM action.
  revalidatePath("/prospects/tenders/[id]", "page");
}

/* ---- Role separation (owner ruling 2026-06-13) ---------------------
   Salespeople WORK assigned projects (contact companies, create tasks
   and opportunities). They never assign, reassign or import. Enforced
   on the REAL role server-side — the UI gates are convenience only. */
const PROJECT_MGMT_ROLES = ["admin", "super_admin", "sales_director"] as const;
const PROJECT_IMPORT_ROLES = ["admin", "super_admin"] as const;

async function requireProjectManagement(): Promise<void> {
  const { role } = await getCurrentUserRole();
  if (!(PROJECT_MGMT_ROLES as readonly string[]).includes(role ?? "")) {
    throw new Error(
      "Only management (sales director / admin) can assign or reassign projects."
    );
  }
}

async function requireProjectImport(): Promise<void> {
  const { role } = await getCurrentUserRole();
  if (!(PROJECT_IMPORT_ROLES as readonly string[]).includes(role ?? "")) {
    throw new Error("Tender imports are managed by admins.");
  }
}

// ---------------------------- prospects ----------------------------

export async function createProspect(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const companyName = reqStr(formData, "company_name");
  // Deduplication is MANDATORY (V2 critical rule #3): one company, one
  // record — across years, imports and manual entries.
  const nameKey = normalizeCompanyKey(companyName);
  const { data: dupe } = await supabase
    .from("prospects")
    .select("id, company_name")
    .eq("name_key", nameKey)
    .is("merged_into_id", null)
    .limit(1)
    .maybeSingle();
  if (dupe) {
    throw new Error(
      `"${dupe.company_name}" already exists as a prospect company — open it instead of creating a duplicate.`
    );
  }

  const { error } = await supabase.from("prospects").insert({
    company_name: companyName,
    name_key: nameKey,
    country: str(formData, "country"),
    contact_name: str(formData, "contact_name"),
    email: str(formData, "email"),
    phone: str(formData, "phone"),
    notes: str(formData, "notes"),
    source: "manual",
    owner_id: user?.id ?? null,
    status: user?.id ? "assigned" : "new",
    created_by: user?.id ?? null,
  });
  if (error) {
    // Pre-m116 database: name_key / new status values don't exist yet.
    if (/name_key|status/.test(error.message ?? "")) {
      const { error: legacyErr } = await supabase.from("prospects").insert({
        company_name: companyName,
        country: str(formData, "country"),
        contact_name: str(formData, "contact_name"),
        email: str(formData, "email"),
        phone: str(formData, "phone"),
        notes: str(formData, "notes"),
        source: "manual",
        owner_id: user?.id ?? null,
        created_by: user?.id ?? null,
      });
      if (legacyErr) throw new Error(legacyErr.message);
    } else {
      throw new Error(error.message);
    }
  }
  revalidate();
}

export async function setProspectStatus(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const status = reqStr(formData, "status");
  if (!(PROSPECT_STATUSES_V2 as readonly string[]).includes(status)) {
    throw new Error("Invalid prospect status");
  }
  const supabase = createClient();
  const { error } = await supabase
    .from("prospects")
    .update({ status, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

export async function deleteProspect(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const { error } = await supabase.from("prospects").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

/**
 * Shared transformation core: prospect row → client row (+ its primary
 * contact in the m101 address book). Returns the new client id. Idempotent
 * per prospect: an already-converted prospect returns its existing client.
 */
async function convertProspectCore(
  supabase: ReturnType<typeof createClient>,
  prospectId: string,
  userId: string | null
): Promise<string> {
  const { data: p, error: loadErr } = await supabase
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .maybeSingle();
  if (loadErr || !p) throw new Error("Prospect not found");
  if (p.converted_client_id) return p.converted_client_id as string;

  const { data: created, error } = await supabase
    .from("clients")
    .insert({
      company_name: p.company_name,
      country: p.country,
      contact_name: p.contact_name,
      email: p.email,
      phone_number: p.phone,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Mirror the person into the m101 address book (best effort — the
  // client row is the transformation that matters).
  if (p.contact_name) {
    await supabase.from("contacts").insert({
      client_id: created.id,
      name: p.contact_name,
      email: p.email,
      phone: p.phone,
      is_primary: true,
      created_by: userId,
    });
  }

  // V2 status model: a converted prospect IS a customer (first order /
  // real client). Falls back to the legacy value pre-m116.
  const conv = await supabase
    .from("prospects")
    .update({
      status: "customer",
      converted_client_id: created.id,
      updated_at: now(),
    })
    .eq("id", prospectId);
  if (conv.error && /status/.test(conv.error.message ?? "")) {
    await supabase
      .from("prospects")
      .update({
        status: "converted",
        converted_client_id: created.id,
        updated_at: now(),
      })
      .eq("id", prospectId);
  }

  await emitEvent({
    entity_type: "client",
    entity_id: created.id,
    event_type: "client.created",
    message: `Client created from prospect "${p.company_name}"`,
    payload: { from_prospect: prospectId, source: p.source },
    bestEffort: true,
  });
  return created.id as string;
}

/** "Switch to client" — the prospect becomes a real client (no duplicate). */
export async function convertProspectToClient(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const clientId = await convertProspectCore(supabase, id, user?.id ?? null);
  revalidate();
  revalidatePath("/clients");
  redirect(`/clients/${clientId}?flash=${encodeURIComponent("Client created from prospect")}`);
}

// ---------------------------- tenders ----------------------------

export async function createTender(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const type = reqStr(formData, "type");
  if (type !== "open" && type !== "result") throw new Error("Invalid tender type");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("tenders").insert({
    title: reqStr(formData, "title"),
    reference: str(formData, "reference"),
    country: str(formData, "country"),
    type,
    value: numOrNull(formData, "value"),
    deadline: str(formData, "deadline"),
    notes: str(formData, "notes"),
    owner_id: user?.id ?? null,
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);
  revalidate();
}

/** Open tender: hook it to the company that will carry the bid. */
export async function attachTender(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  // value is "client:<uuid>" or "prospect:<uuid>" from one combined select.
  const target = reqStr(formData, "target");
  const [kind, targetId] = target.split(":");
  if (!targetId || (kind !== "client" && kind !== "prospect")) {
    throw new Error("Pick a company to attach");
  }
  const supabase = createClient();
  const { error } = await supabase
    .from("tenders")
    .update({
      attached_client_id: kind === "client" ? targetId : null,
      attached_prospect_id: kind === "prospect" ? targetId : null,
      status: "in_progress",
      updated_at: now(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  // m111 pipeline auto-advance: assigning a partner moves an ACCEPTED /
  // searching tender to Partner Assigned. A 'new' tender is NOT advanced —
  // qualification (Accept / Reject) always comes first.
  await supabase
    .from("tenders")
    .update({ commercial_status: "partner_assigned", updated_at: now() })
    .eq("id", id)
    .in("commercial_status", ["accepted", "searching_partner"]);
  revalidate();
}

/**
 * Open tender → AFFAIR under the attached company (the §7 conversion).
 * If the tender is attached to a prospect, the prospect is transformed
 * into a client first. Lands on the new affair page.
 */
export async function convertTenderToAffair(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: t, error: loadErr } = await supabase
    .from("tenders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadErr || !t) throw new Error("Tender not found");
  if (t.type !== "open") throw new Error("Only open tenders become affairs");
  if (t.converted_affair_id) redirect(`/affairs/${t.converted_affair_id}`);

  let clientId: string | null = t.attached_client_id ?? null;
  if (!clientId && t.attached_prospect_id) {
    clientId = await convertProspectCore(supabase, t.attached_prospect_id, user?.id ?? null);
  }
  if (!clientId) {
    throw new Error("Attach the tender to a client or prospect first (the bidding partner).");
  }

  const { data: affair, error } = await supabase
    .from("affairs")
    .insert({
      name: t.title,
      client_id: clientId,
      owner_id: user?.id ?? null,
      status: "lead",
      source: "tender",
      source_tender_id: t.id,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await supabase
    .from("tenders")
    .update({
      status: "converted",
      converted_affair_id: affair.id,
      attached_client_id: clientId,
      updated_at: now(),
    })
    .eq("id", id);

  revalidate();
  revalidatePath("/clients");
  redirect(`/affairs/${affair.id}`);
}

export async function closeTender(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const { error } = await supabase
    .from("tenders")
    .update({ status: "closed", updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

export async function deleteTender(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const { error } = await supabase.from("tenders").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

// ---------------------- tender participants (intel) ----------------------

export async function addTenderParticipant(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("tender_participants").insert({
    tender_id: reqStr(formData, "tender_id"),
    company_name: reqStr(formData, "company_name"),
    country: str(formData, "country"),
    is_winner: formData.get("is_winner") === "on",
    bid_value: numOrNull(formData, "bid_value"),
    notes: str(formData, "notes"),
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);
  revalidate();
}

export async function deleteTenderParticipant(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const { error } = await supabase.from("tender_participants").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

/** Result tender: a participant is a hot lead — promote it to a prospect. */
export async function promoteParticipantToProspect(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: part, error: loadErr } = await supabase
    .from("tender_participants")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadErr || !part) throw new Error("Participant not found");
  if (part.promoted_prospect_id) return; // already promoted — nothing to do

  // Two-level assignment (m118): the prospect inherits the company-level
  // owner, then the project owner, then the promoter.
  const { data: parentTender } = await supabase
    .from("tenders")
    .select("owner_id")
    .eq("id", part.tender_id)
    .maybeSingle();
  const inheritedOwner =
    (part as any).owner_id ?? (parentTender as any)?.owner_id ?? user?.id ?? null;

  // Dedup first (V2): if the company already exists as a prospect, LINK
  // the participant to it instead of creating a duplicate record.
  const nameKey = normalizeCompanyKey(part.company_name);
  const { data: existing } = await supabase
    .from("prospects")
    .select("id")
    .eq("name_key", nameKey)
    .is("merged_into_id", null)
    .limit(1)
    .maybeSingle();

  let prospectId: string;
  if (existing) {
    prospectId = existing.id as string;
  } else {
    const { data: created, error } = await supabase
      .from("prospects")
      .insert({
        company_name: part.company_name,
        name_key: nameKey,
        country: part.country,
        notes: part.notes,
        // m117 — the attribution file's contact intel travels with the
        // company the moment a salesperson decides it becomes a prospect.
        email: (part as any).email ?? null,
        phone: (part as any).phone ?? null,
        address: (part as any).address ?? null,
        leader_name: (part as any).manager_name ?? null,
        source: "tender",
        source_tender_id: part.tender_id,
        owner_id: inheritedOwner,
        status: inheritedOwner ? "assigned" : "new",
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    prospectId = created.id as string;
  }

  await supabase
    .from("tender_participants")
    .update({ promoted_prospect_id: prospectId })
    .eq("id", id);
  await recomputeProspectTenderStats(supabase, [prospectId]);
  revalidate();
}

// =====================================================================
// Tender management (m107) — JSON import + commercial fields + next
// actions. The import is the source of truth for EXTERNAL data only;
// CRM-internal fields (owner, notes, commercial_status, attachments,
// planned actions) are never touched by a re-import.
// =====================================================================

/** Normalised dedup key: title + buyer + closing date. */
function tenderImportKey(title: string, buyer: string | null, closing: string | null): string {
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(title)}|${norm(buyer)}|${(closing ?? "").slice(0, 10)}`;
}

const dateOrNullStr = (v: any): string | null => {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const numOrNullAny = (v: any): number | null => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const boolOrNull = (v: any): boolean | null => {
  if (v === true || v === "true" || v === "yes" || v === "Yes" || v === 1) return true;
  if (v === false || v === "false" || v === "no" || v === "No" || v === 0) return false;
  return null;
};

/** pertinence → readable relevance label (haute / moyenne / a_verifier…). */
const RELEVANCE_LABEL: Record<string, string> = {
  haute: "High",
  moyenne: "Medium",
  basse: "Low",
  a_verifier: "To verify",
};

/**
 * Tolerant mapper from the intelligence-tool JSON ("Solux AO Live" —
 * FRENCH keys: titre / pays / acheteur / date_cloture / …) to tender
 * EXTERNAL columns. English spellings are also accepted so format
 * evolutions don't break the import; anything unrecognised inside
 * `specs` is kept verbatim (the UI renders specs dynamically).
 */
function mapTenderItem(item: any): { external: Record<string, any>; key: string } | { error: string } {
  const title = pick(item, "title", "titre", "name", "tender_title");
  if (!title) return { error: "missing title (titre)" };
  const buyer = pick(item, "buyer", "acheteur", "buyer_name", "authority", "client");
  const closing = dateOrNullStr(
    pick(item, "closing_date", "date_cloture", "deadline", "close_date", "submission_deadline")
  );
  const budget = item?.budget ?? {};
  const contact = item?.contact ?? {};
  const docsRaw = item?.documents ?? item?.docs ?? [];
  const documents = Array.isArray(docsRaw)
    ? docsRaw.map((d: any) => ({
        type: String(pick(d, "type", "kind", "category") ?? "Other"),
        name: String(pick(d, "name", "nom", "label", "filename") ?? "Document"),
        imported: boolOrNull(pick(d, "imported", "importe", "downloaded")) ?? false,
        url: pick(d, "url", "link", "download_url"),
      }))
    : [];
  const specsBase =
    item?.specs && typeof item.specs === "object" && !Array.isArray(item.specs)
      ? item.specs
      : {};
  // note_specs + descriptif are external context worth keeping — folded
  // into specs so the dynamic renderer displays them (and re-imports
  // refresh them with the rest of the external data).
  const noteSpecs = pick(item, "note_specs");
  const descriptif = pick(item, "descriptif", "description", "summary");
  const specs = {
    ...specsBase,
    ...(descriptif ? { descriptif } : {}),
    ...(noteSpecs ? { note_specs: noteSpecs } : {}),
  };

  // solaire_confirme is a SOURCE string ("titre" / "documents" /
  // "descriptif" / "cps"), not a boolean: any source = confirmed;
  // "indetermine" = unknown. Plain booleans still work.
  const solarRaw = pick(item, "solar_confirmed", "solaire_confirme", "solar");
  const solar =
    boolOrNull(solarRaw) ??
    (solarRaw == null || String(solarRaw).toLowerCase() === "indetermine"
      ? null
      : true);

  const relevanceRaw = pick(item, "relevance", "pertinence");
  const relevance = relevanceRaw
    ? RELEVANCE_LABEL[String(relevanceRaw).toLowerCase()] ?? String(relevanceRaw)
    : null;

  // budget_usd: the tool exports 0 for "unknown" — treat as absent.
  const budgetUsd = numOrNullAny(pick(budget, "usd", "budget_usd") ?? pick(item, "budget_usd"));

  const external: Record<string, any> = {
    title: String(title),
    type: pick(item, "type") === "result" ? "result" : "open",
    country: pick(item, "country", "pays"),
    city: pick(item, "city", "ville"),
    buyer,
    platform: pick(item, "platform", "plateforme", "source", "portal"),
    source_url: pick(item, "source_url", "url", "link"),
    publication_date: dateOrNullStr(
      pick(item, "publication_date", "date_publication", "published_at", "published")
    ),
    deadline: closing,
    reference: pick(item, "reference", "ref", "tender_id"),
    score: numOrNullAny(pick(item, "score")),
    relevance,
    solar_confirmed: solar,
    value: numOrNullAny(
      pick(budget, "amount") ?? pick(item, "montant", "budget_amount", "amount", "value")
    ),
    currency: pick(budget, "currency") ?? pick(item, "devise", "budget_currency", "currency"),
    budget_usd: budgetUsd && budgetUsd > 0 ? budgetUsd : null,
    contact_name: pick(contact, "name", "responsable") ?? pick(item, "contact_name"),
    contact_email: pick(contact, "email") ?? pick(item, "contact_email", "email"),
    contact_phone: pick(contact, "phone", "telephone") ?? pick(item, "contact_phone", "phone"),
    contact_phone2:
      pick(contact, "phone_secondary", "secondary_phone", "telephone2") ??
      pick(item, "contact_phone2"),
    specs,
    documents,
  };
  return { external, key: tenderImportKey(String(title), buyer, closing) };
}

export type TenderImportSummary = {
  total: number;
  created: number;
  updated: number;
  errors: string[];
};

/**
 * Import tenders from the intelligence tool's JSON. `dryRun` = preview
 * (counts only, no writes). Dedup on import_key (title+buyer+closing):
 * found → UPDATE external fields only; not found → CREATE.
 */
export async function importTenders(
  itemsJson: string,
  dryRun: boolean
): Promise<TenderImportSummary> {
  await requireCapability("prospect.access");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let parsed: any;
  try {
    parsed = JSON.parse(itemsJson);
  } catch {
    return { total: 0, created: 0, updated: 0, errors: ["Invalid JSON file."] };
  }
  // "Solux AO Live" exports wrap the array in { resultats: [...] };
  // plain arrays and { tenders } / { items } wrappers are accepted too.
  const items: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.resultats)
      ? parsed.resultats
      : Array.isArray(parsed?.tenders)
        ? parsed.tenders
        : Array.isArray(parsed?.items)
          ? parsed.items
          : [];
  if (items.length === 0) {
    return {
      total: 0,
      created: 0,
      updated: 0,
      errors: ["No tenders found in the file (expected an array, or { resultats: [...] } / { tenders: [...] })."],
    };
  }

  const mapped: Array<{ external: Record<string, any>; key: string }> = [];
  const errors: string[] = [];
  items.forEach((it, i) => {
    const m = mapTenderItem(it);
    if ("error" in m) errors.push(`Item ${i + 1}: ${m.error}`);
    else mapped.push(m);
  });

  // Existing keys → update; the rest → create. (Within-file duplicates
  // collapse onto the same key: last one wins.)
  const byKey = new Map<string, Record<string, any>>();
  for (const m of mapped) byKey.set(m.key, m.external);
  const keys = [...byKey.keys()];
  const existing = new Map<string, string>(); // key → tender id
  if (keys.length > 0) {
    const { data } = await supabase.from("tenders").select("id, import_key").in("import_key", keys);
    for (const r of (data ?? []) as any[]) {
      if (r.import_key) existing.set(r.import_key, r.id);
    }
  }

  const created = keys.filter((k) => !existing.has(k)).length;
  const updated = keys.length - created;

  if (!dryRun) {
    const nowIso = new Date().toISOString();
    for (const [key, external] of byKey.entries()) {
      const id = existing.get(key);
      if (id) {
        // UPDATE — external fields only. owner_id / notes /
        // commercial_status / attachments stay untouched.
        const { error } = await supabase
          .from("tenders")
          .update({ ...external, import_key: key, last_import_at: nowIso, updated_at: nowIso })
          .eq("id", id);
        if (error) errors.push(`Update "${external.title}": ${error.message}`);
      } else {
        const { error } = await supabase.from("tenders").insert({
          ...external,
          import_key: key,
          imported_at: nowIso,
          last_import_at: nowIso,
          commercial_status: "new",
          created_by: user?.id ?? null,
        });
        if (error) errors.push(`Create "${external.title}": ${error.message}`);
      }
    }
    revalidate();
  }

  return { total: keys.length, created, updated, errors };
}

// ---------------------- commercial management ----------------------

// m110 — the qualification pipeline (New → Accepted → … → Opportunity
// Created, with Rejected / Lost as terminal alternatives).
const COMMERCIAL_STATUSES = [
  "new", "accepted", "searching_partner", "partner_assigned", "contacted",
  "waiting_feedback", "interested", "project_request",
  "opportunity_created", "rejected", "lost",
] as const;

const REJECT_REASONS = [
  "budget_too_small", "outside_target_market", "already_awarded",
  "specification_not_suitable", "no_local_partner", "political_country_risk",
  "duplicate_tender", "not_strategic", "other",
] as const;

// Stages from "Partner Identified" onward describe a RELATIONSHIP with a
// local partner — they are meaningless without one attached. Partner
// Identified itself is only reached through "Assign existing client" /
// "Create new prospect" (attachTender / createPartnerAndAttach), never
// by hand-picking the status.
const PARTNER_REQUIRED_STATUSES = new Set([
  "partner_assigned", "contacted", "waiting_feedback",
  "interested", "project_request",
]);

export async function setTenderCommercialStatus(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const status = reqStr(formData, "commercial_status");
  if (!(COMMERCIAL_STATUSES as readonly string[]).includes(status)) {
    throw new Error("Invalid tender status");
  }
  if (status === "opportunity_created") {
    throw new Error("Use “Convert to Opportunity” — this status is set by the conversion itself.");
  }
  const supabase = createClient();
  if (PARTNER_REQUIRED_STATUSES.has(status)) {
    const { data: t } = await supabase
      .from("tenders")
      .select("attached_client_id, attached_prospect_id")
      .eq("id", id)
      .maybeSingle();
    if (!t?.attached_client_id && !t?.attached_prospect_id) {
      throw new Error(
        "Attach a partner first — use “Assign existing client” or “Create new prospect”."
      );
    }
  }
  const { error } = await supabase
    .from("tenders")
    .update({ commercial_status: status, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

export async function setTenderOwner(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  await requireProjectManagement();
  const id = reqStr(formData, "id");
  const raw = String(formData.get("owner_id") ?? "");
  const owner_id = raw && raw !== "__unassign__" ? raw : null;
  const supabase = createClient();
  const { error } = await supabase
    .from("tenders")
    .update({ owner_id, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

/**
 * Delete ALL awarded-tender PROJECTS (type='result') — wipe-and-restart
 * for clean re-imports. Cascades participants / planned actions /
 * follow-ups (FK on delete cascade). Prospect companies are KEPT
 * (source_tender_id → null) and auto-relink by name_key on the next
 * import. Inbox tenders (type != 'result') are untouched. Admin only.
 */
export async function deleteAllAttributionProjects(): Promise<{ deleted: number; error: string | null }> {
  await requireCapability("prospect.access");
  await requireProjectImport();
  const supabase = createClient();
  const { count } = await supabase
    .from("tenders")
    .select("id", { count: "exact", head: true })
    .eq("type", "result");
  const { error } = await supabase.from("tenders").delete().eq("type", "result");
  if (error) return { deleted: 0, error: error.message };
  revalidate();
  return { deleted: count ?? 0, error: null };
}

/** Delete ONE awarded-tender project by id (scoped to type='result' for
 *  safety — never an inbox tender). Cascades as above. Admin only. */
export async function deleteTenderProject(tenderId: string): Promise<{ error: string | null }> {
  await requireCapability("prospect.access");
  await requireProjectImport();
  if (!tenderId) return { error: "Missing project id" };
  const supabase = createClient();
  const { error } = await supabase
    .from("tenders")
    .delete()
    .eq("id", tenderId)
    .eq("type", "result");
  if (error) return { error: error.message };
  revalidate();
  return { error: null };
}

export async function saveTenderNotes(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const { error } = await supabase
    .from("tenders")
    .update({ notes: str(formData, "notes"), updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

// ---------------------- next actions (planned_actions on a tender) ----------------------

const TENDER_ACTION_TYPES = ["call", "meeting", "visit", "follow_up", "send_quote", "other"] as const;

export async function createTenderNextAction(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const tenderId = reqStr(formData, "tender_id");
  const type = String(formData.get("action_type") ?? "other");
  const dueDate = reqStr(formData, "due_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("A next action needs a due date");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("planned_actions").insert({
    tender_id: tenderId,
    affair_id: null,
    action_type: (TENDER_ACTION_TYPES as readonly string[]).includes(type) ? type : "other",
    title: str(formData, "title"),
    due_date: dueDate,
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);
  revalidate();
}

export async function completeTenderNextAction(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("planned_actions")
    .update({ done_at: now(), done_by: user?.id ?? null, updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

export async function deleteTenderNextAction(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const { error } = await supabase.from("planned_actions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

/**
 * m108 — [ Create Opportunity ] from a tender, WITHOUT requiring a
 * partner. Many tenders are identified before the local distributor /
 * EPC / installer is known, so:
 *   • partner attached (client or prospect) → affair under that client
 *     (an attached prospect is transformed into a client first);
 *   • NO partner → clientless affair in the dedicated stage
 *     'partner_selection' — the partner is attached later.
 * The affair carries source='tender' + source_tender_id, so tender data
 * (buyer, closing, budget, documents) stays readable AT THE SOURCE
 * (Règle #0 — no duplication). Lands on the new affair.
 */
export async function createOpportunityFromTender(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: t, error: loadErr } = await supabase
    .from("tenders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (loadErr || !t) throw new Error("Tender not found");
  if (t.converted_affair_id) redirect(`/affairs/${t.converted_affair_id}`);

  // m111 maturity gate: conversion requires an identified partner AND a
  // confirmed interest (the journal moved the tender to Interested /
  // Quotation Requested). No shortcut from acceptance straight to
  // opportunity.
  if (!t.attached_client_id && !t.attached_prospect_id) {
    throw new Error("Assign a partner before converting this tender into an opportunity.");
  }
  if (!["interested", "project_request"].includes(t.commercial_status)) {
    throw new Error(
      "Conversion unlocks once the partner confirms interest (status Interested or Project Request)."
    );
  }

  // Resolve the partner when one is already attached; otherwise the
  // opportunity starts clientless in Partner Selection.
  let clientId: string | null = t.attached_client_id ?? null;
  if (!clientId && t.attached_prospect_id) {
    clientId = await convertProspectCore(supabase, t.attached_prospect_id, user?.id ?? null);
  }

  const { data: affair, error } = await supabase
    .from("affairs")
    .insert({
      name: t.title,
      client_id: clientId,
      // The tender's assigned salesperson automatically owns the
      // opportunity — no extra owner selection (spec §3).
      owner_id: t.owner_id ?? user?.id ?? null,
      // m109 pipeline: a tender-sourced opportunity starts in Tender
      // Review (then Partner Selection → Quotation → Negotiation → Won).
      status: "tender_review",
      source: "tender",
      source_tender_id: t.id,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await supabase
    .from("tenders")
    .update({
      converted_affair_id: affair.id,
      status: "converted",
      // m110 pipeline terminal happy-path + metric timestamp.
      commercial_status: "opportunity_created",
      converted_at: now(),
      attached_client_id: clientId ?? t.attached_client_id,
      updated_at: now(),
    })
    .eq("id", id);

  revalidate();
  revalidatePath("/clients");
  redirect(`/affairs/${affair.id}`);
}

// =====================================================================
// m109 — BULK tender actions. Imports generate many irrelevant tenders;
// the lead manager cleans/assigns in batches. ids arrive as a JSON
// array string (hidden field). Gated by prospect.access + RLS (a sales
// user physically cannot touch tenders they don't own — m108 policies).
// =====================================================================

function parseIds(formData: FormData): string[] {
  try {
    const arr = JSON.parse(String(formData.get("ids") ?? "[]"));
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function bulkDeleteTenders(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const ids = parseIds(formData);
  if (ids.length === 0) throw new Error("Nothing selected");
  const supabase = createClient();
  const { error } = await supabase.from("tenders").delete().in("id", ids);
  if (error) throw new Error(error.message);
  revalidate();
}

export async function bulkAssignTenders(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  await requireProjectManagement();
  const ids = parseIds(formData);
  if (ids.length === 0) throw new Error("Nothing selected");
  const raw = String(formData.get("owner_id") ?? "");
  const owner_id = raw && raw !== "__unassign__" ? raw : null;
  const supabase = createClient();
  const { error } = await supabase
    .from("tenders")
    .update({ owner_id, updated_at: now() })
    .in("id", ids);
  if (error) throw new Error(error.message);
  revalidate();
}

export async function bulkSetTenderStatus(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const ids = parseIds(formData);
  if (ids.length === 0) throw new Error("Nothing selected");
  const status = reqStr(formData, "commercial_status");
  if (!(COMMERCIAL_STATUSES as readonly string[]).includes(status)) {
    throw new Error("Invalid tender status");
  }
  if (status === "opportunity_created") {
    throw new Error("Use “Convert to Opportunity” on each tender — this status is set by the conversion itself.");
  }
  const supabase = createClient();
  let query = supabase
    .from("tenders")
    .update({ commercial_status: status, updated_at: now() })
    .in("id", ids);
  // Partner-relationship stages only apply to tenders with a partner
  // attached — silently skip the others instead of corrupting them.
  if (PARTNER_REQUIRED_STATUSES.has(status)) {
    query = query.or("attached_client_id.not.is.null,attached_prospect_id.not.is.null");
  }
  const { error } = await query;
  if (error) throw new Error(error.message);
  revalidate();
}

// =====================================================================
// m110 — qualification workflow actions.
// =====================================================================

/** Accept Tender — the salesperson becomes responsible for the follow-up. */
export async function acceptTender(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: t } = await supabase
    .from("tenders")
    .select("owner_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase
    .from("tenders")
    .update({
      commercial_status: "accepted",
      accepted_at: now(),
      // Accepting makes you responsible when nobody is assigned yet.
      owner_id: t?.owner_id ?? user?.id ?? null,
      // Clear any previous rejection (a director may overturn it).
      rejected_reason: null,
      rejected_comment: null,
      rejected_by: null,
      rejected_at: null,
      updated_at: now(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

/** Reject Tender — reason from the fixed list + a MANDATORY comment.
 *  The rejection stays visible so the Sales Director can challenge it. */
export async function rejectTender(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const reason = reqStr(formData, "rejected_reason");
  if (!(REJECT_REASONS as readonly string[]).includes(reason)) {
    throw new Error("Pick a rejection reason");
  }
  const comment = str(formData, "rejected_comment");
  if (!comment) throw new Error("Why are you rejecting this tender? A comment is required.");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("tenders")
    .update({
      commercial_status: "rejected",
      rejected_reason: reason,
      rejected_comment: comment,
      rejected_by: user?.id ?? null,
      rejected_at: now(),
      updated_at: now(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

/** Option C — no partner identified yet: keep the tender active. */
export async function markTenderSearchingPartner(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const supabase = createClient();
  const { error } = await supabase
    .from("tenders")
    .update({ commercial_status: "searching_partner", updated_at: now() })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

/** Option B — quick-create a NEW partner (prospect card) and attach it. */
export async function createPartnerAndAttach(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const tenderId = reqStr(formData, "tender_id");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: created, error } = await supabase
    .from("prospects")
    .insert({
      company_name: reqStr(formData, "company_name"),
      country: str(formData, "country"),
      contact_name: str(formData, "contact_name"),
      email: str(formData, "email"),
      phone: str(formData, "phone"),
      notes: str(formData, "notes"),
      source: "manual",
      owner_id: user?.id ?? null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: attachErr } = await supabase
    .from("tenders")
    .update({
      attached_prospect_id: created.id,
      attached_client_id: null,
      commercial_status: "partner_assigned",
      updated_at: now(),
    })
    .eq("id", tenderId);
  if (attachErr) throw new Error(attachErr.message);
  revalidate();
}

/** m111 — the commercial JOURNAL drives the pipeline. Each entry kind
 *  maps to a pipeline stage; the status only ever moves FORWARD (except
 *  "Not interested", which sends the tender back to Searching Partner so
 *  another local partner can be hunted). Terminal states (rejected /
 *  lost / opportunity_created) are never touched by the journal. */
const FOLLOWUP_KINDS = [
  "contact_attempt", "email_sent", "meeting", "interested",
  "not_interested", "waiting_feedback", "technical_discussion",
  "quotation_requested",
  // legacy (m110)
  "communication", "feedback", "progress",
] as const;

const PIPELINE_ORDER = [
  "new", "accepted", "searching_partner", "partner_assigned",
  "contacted", "waiting_feedback", "interested", "project_request",
  "opportunity_created",
] as const;

const KIND_TO_STAGE: Record<string, string | null> = {
  contact_attempt: "contacted",
  email_sent: "contacted",
  meeting: "contacted",
  communication: "contacted", // legacy
  waiting_feedback: "waiting_feedback",
  interested: "interested",
  technical_discussion: "interested",
  // The partner asking for a quote = time to open the technical request.
  quotation_requested: "project_request",
  not_interested: "searching_partner", // explicit regression — hunt again
  feedback: null, // legacy — no automatic move
  progress: null, // legacy — no automatic move
};

export async function addTenderFollowUp(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const tenderId = reqStr(formData, "tender_id");
  const kindRaw = String(formData.get("kind") ?? "communication");
  const kind = (FOLLOWUP_KINDS as readonly string[]).includes(kindRaw)
    ? kindRaw
    : "communication";
  const comment = reqStr(formData, "comment");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("tender_followups").insert({
    tender_id: tenderId,
    kind,
    comment,
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  // Pipeline auto-advance from the journal entry.
  const target = KIND_TO_STAGE[kind];
  if (target) {
    const { data: t } = await supabase
      .from("tenders")
      .select("commercial_status")
      .eq("id", tenderId)
      .maybeSingle();
    const current = t?.commercial_status as string | undefined;
    const curIdx = current ? (PIPELINE_ORDER as readonly string[]).indexOf(current) : -1;
    const tgtIdx = (PIPELINE_ORDER as readonly string[]).indexOf(target);
    const isRegression = kind === "not_interested";
    const forwardMove = curIdx >= 0 && tgtIdx > curIdx;
    // "Not interested" regresses only from a partner-engaged stage.
    const regressionOk =
      isRegression &&
      ["partner_assigned", "contacted", "waiting_feedback", "interested"].includes(
        current ?? ""
      );
    if (forwardMove || regressionOk) {
      await supabase
        .from("tenders")
        .update({ commercial_status: target, updated_at: now() })
        .eq("id", tenderId);
    }
  }
  revalidate();
}

// =====================================================================
// PROSPECTS & TENDERS V2 (m116) — tender attributions → prospect intel
// =====================================================================
// SOLUX is a manufacturer: tender winners/participants are the most
// strategic prospection base. The attribution import feeds Prospect
// Companies AUTOMATICALLY — deduplicated on name_key, NEVER auto-leads
// (critical rule #1), unassigned (assignment is the Lead Manager's
// explicit step), with lifetime tender history via tender_participants.
// =====================================================================

/**
 * Rewrite the denormalized tender counters for a set of prospects from
 * the source of truth (tender_participants ⋈ tenders) — AND sync the
 * participants' contact intel onto the prospect profile (fill-empty
 * only, owner request 2026-06-13: "les champs doivent se remplir
 * automatiquement"). Runs on every import / promotion / merge, so a
 * re-import heals prospects created before the contact pipeline existed.
 */
async function recomputeProspectTenderStats(
  supabase: ReturnType<typeof createClient>,
  prospectIds: string[]
): Promise<number> {
  const ids = [...new Set(prospectIds)].filter(Boolean);
  if (ids.length === 0) return 0;
  // m117: pull the participants' CONTACT intel along with the stats so
  // the prospect profile fills itself (fill-EMPTY-only — the Lead
  // Manager's manual work is never overwritten). Degrades to stats-only
  // on a pre-m117 database.
  let parts: any[] = [];
  let hasContactCols = true;
  {
    const full = await supabase
      .from("tender_participants")
      .select(
        "promoted_prospect_id, is_winner, email, phone, address, manager_name, tenders:tender_id(publication_date, created_at)"
      )
      .in("promoted_prospect_id", ids);
    if (!full.error) {
      parts = (full.data ?? []) as any[];
    } else {
      hasContactCols = false;
      const legacy = await supabase
        .from("tender_participants")
        .select(
          "promoted_prospect_id, is_winner, tenders:tender_id(publication_date, created_at)"
        )
        .in("promoted_prospect_id", ids);
      if (legacy.error) return 0; // stats are a cache — never block the flow
      parts = (legacy.data ?? []) as any[];
    }
  }

  type Agg = {
    p: number; w: number; lastP: string | null; lastW: string | null;
    email: string | null; phone: string | null;
    address: string | null; manager: string | null;
  };
  const agg = new Map<string, Agg>();
  for (const id of ids) {
    agg.set(id, {
      p: 0, w: 0, lastP: null, lastW: null,
      email: null, phone: null, address: null, manager: null,
    });
  }
  for (const row of parts) {
    const a = agg.get(row.promoted_prospect_id);
    if (!a) continue;
    const date =
      (row.tenders?.publication_date as string | null) ??
      (row.tenders?.created_at ? String(row.tenders.created_at).slice(0, 10) : null);
    a.p += 1;
    if (date && (!a.lastP || date > a.lastP)) a.lastP = date;
    if (row.is_winner) {
      a.w += 1;
      if (date && (!a.lastW || date > a.lastW)) a.lastW = date;
    }
    // First non-empty contact wins (a company's intel is spread across
    // its participations).
    a.email ??= row.email ?? null;
    a.phone ??= row.phone ?? null;
    a.address ??= row.address ?? null;
    a.manager ??= row.manager_name ?? null;
  }

  // Current prospect values — needed for the fill-empty contact sync.
  const currentById = new Map<string, any>();
  if (hasContactCols) {
    const { data: cur } = await supabase
      .from("prospects")
      .select("id, email, phone, address, leader_name")
      .in("id", ids);
    for (const c of (cur ?? []) as any[]) currentById.set(c.id, c);
  }

  // Returns the number of prospect profiles that actually received
  // contact intel, DB-confirmed (failed updates don't count) — the
  // import summary surfaces it so the sync is OBSERVABLE, not assumed.
  const results = await Promise.all(
    ids.map(async (id) => {
      const a = agg.get(id)!;
      const patch: Record<string, any> = {
        tender_participations: a.p,
        tender_wins: a.w,
        last_tender_participation_at: a.lastP,
        last_tender_win_at: a.lastW,
        updated_at: now(),
      };
      const cur = currentById.get(id);
      if (cur) {
        if (!cur.email && a.email) patch.email = a.email;
        if (!cur.phone && a.phone) patch.phone = a.phone;
        if (!cur.address && a.address) patch.address = a.address;
        if (!cur.leader_name && a.manager) patch.leader_name = a.manager;
      }
      const enriched =
        patch.email !== undefined ||
        patch.phone !== undefined ||
        patch.address !== undefined ||
        patch.leader_name !== undefined;
      const { error } = await supabase.from("prospects").update(patch).eq("id", id);
      return !error && enriched;
    })
  );
  return results.filter(Boolean).length;
}

export type AttributionImportSummary = {
  attributions: number;
  attributionsCreated: number;
  attributionsUpdated: number;
  /** Company rows carried by the file (winners + participants). */
  participants: number;
  /** Companies with at least an email or phone — the callable ones. */
  contactsFound: number;
  /** GROUND TRUTH after a real run: attribution tenders counted in the
   *  database right after the writes (null on dry-run). */
  dbAttributionsTotal: number | null;
  /** Prospect profiles that received contact intel during the post-import
   *  sync — DB-confirmed (null on dry-run). */
  profilesSynced: number | null;
  /** Source records that merged into an EXISTING tender instead of
   *  creating a duplicate project (consolidation — owner ruling
   *  2026-06-13). On dry-run this is the projected count. */
  merged: number | null;
  /** Of those merges, how many were gray-zone (merge_flagged) — fuzzy
   *  but below the high-confidence bar, kept reviewable & reversible. */
  mergedFlagged: number | null;
  /** Contact-mapping audit (first companies of the file): which raw JSON
   *  keys were seen, what got mapped, what was ignored — answers "where
   *  does the contact information disappear?" right in the preview. */
  fieldAudit: Array<{
    company: string;
    mapped: Record<string, string>;
    unmappedKeys: string[];
  }>;
  errors: string[];
};

/** Attribution dates arrive as full dates or bare years — normalise to YYYY-MM-DD. */
function parseAttributionDate(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d{4}$/.test(s)) return `${s}-01-01`;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  const m = s.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/); // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/**
 * Import tender ATTRIBUTIONS (awarded tenders) — workflow v3 (m117):
 * PROJECTS FIRST. The import records the attribution + every company
 * WITH its contact intel. It NO LONGER auto-creates Prospect Companies
 * (owner ruling 2026-06-13): the salesperson assigns the project and
 * decides which companies become prospects (winner / participant / all).
 *
 * Still enforced: import_key dedup on attributions, lifetime history
 * (participant rows are never deleted), prospect links preserved.
 */
export async function importTenderAttributions(
  itemsJson: string,
  dryRun: boolean
): Promise<AttributionImportSummary> {
  await requireCapability("prospect.access");
  await requireProjectImport();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const empty = (errs: string[]): AttributionImportSummary => ({
    attributions: 0, attributionsCreated: 0, attributionsUpdated: 0,
    participants: 0, contactsFound: 0, dbAttributionsTotal: null,
    profilesSynced: null, merged: null, mergedFlagged: null,
    fieldAudit: [], errors: errs,
  });

  // HARD GUARD (audit 2026-06-13): contact columns (m117) are NOT
  // optional for this import — silently dropping email/phone/manager was
  // exactly the "No contact info in the file" bug. Refuse loudly instead.
  const m117Probe = await supabase
    .from("tender_participants")
    .select("email")
    .limit(1);
  if (m117Probe.error && /email/.test(m117Probe.error.message ?? "")) {
    return empty([
      "Migration 117 is NOT applied — importing now would LOSE every contact (email, phone, manager). Apply 117_tender_project_intel.sql (and 118) in Supabase, then re-import.",
    ]);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(itemsJson);
  } catch {
    return empty(["Invalid JSON file."]);
  }
  const items: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.projets)
      ? parsed.projets
      : Array.isArray(parsed?.attributions)
        ? parsed.attributions
        : Array.isArray(parsed?.resultats)
          ? parsed.resultats
          : [];
  if (items.length === 0) {
    const isCompaniesFile =
      Array.isArray(parsed?.companies) ||
      Array.isArray(parsed?.prospects) ||
      Array.isArray(parsed?.societes);
    return empty([
      isCompaniesFile
        ? "This looks like a COMPANIES list — use “Import companies (JSON)” in the Prospects universe."
        : "No attributions found (expected { projets: [...] } or a plain array).",
    ]);
  }

  // v2 export: separate entreprises[] directory (empty map otherwise).
  const directory = companyDirectory(parsed);

  const errors: string[] = [];
  const fieldAudit: AttributionImportSummary["fieldAudit"] = [];
  const auditCompany = (raw: unknown, mapped: AttributionContact | null) => {
    if (fieldAudit.length >= 6 || !mapped || typeof raw !== "object") return;
    const mappedOut: Record<string, string> = {};
    if (mapped.email) mappedOut.email = mapped.email;
    if (mapped.phone) mappedOut.phone = mapped.phone;
    if (mapped.address) mappedOut.address = mapped.address;
    if (mapped.manager) mappedOut.manager = mapped.manager;
    const knownFlat = new Set<string>([
      "nom", "name", "company", "societe", "société", "entreprise",
      "montant", "amount", "bid", "historique", "history",
      "participations_historique", "historique_j360",
      // v2 export keys (lots + directory)
      "lot", "montant_local", "montant_usd", "quantite_lampadaires",
      "delai", "marches", "nb_marches", "budget_total_local",
      "budget_total_usd", "devise", "site", "linkedin", "fonction",
      ...CONTACT_NESTS,
      ...CONTACT_KEYS.email, ...CONTACT_KEYS.phone,
      ...CONTACT_KEYS.address, ...CONTACT_KEYS.manager,
    ]);
    const unmappedKeys = rawKeysOf(raw).filter((k) => {
      const leaf = k.includes(".") ? k.split(".")[1] : k;
      return !knownFlat.has(leaf);
    });
    fieldAudit.push({ company: mapped.name, mapped: mappedOut, unmappedKeys });
  };
  type ParticipantRow = AttributionContact & {
    isWinner: boolean;
    lot_number: string | null;
    lot_title: string | null;
    lot_amount: number | null;
    lot_status: "winner" | "participant";
  };
  type MappedAttribution = {
    key: string;
    external: Record<string, any>;
    participants: ParticipantRow[];
  };
  const byKey = new Map<string, MappedAttribution>();

  items.forEach((it, i) => {
    const title = pick(it, "titre", "title", "projet", "intitule") as string | null;
    if (!title) {
      errors.push(`Item ${i + 1}: missing title (titre).`);
      return;
    }
    const buyer = (pick(it, "acheteur", "buyer", "autorite", "autorité") ?? null) as string | null;
    const country = (pick(it, "pays", "country") ?? null) as string | null;
    // KEY date: unchanged derivation — changing it would shift import_key
    // for already-imported rows and DUPLICATE them on re-import.
    const date = parseAttributionDate(
      pick(it, "date_attribution", "date", "annee", "année", "year", "date_publication")
    );
    // DISPLAY date: v1 files carry date_pub, never part of the key.
    const pubDate = date ?? parseAttributionDate(pick(it, "date_pub"));
    // ONE SEMANTIC PER FIELD (bug 2026-06-13: $260,866 displayed as $435):
    // budget_usd column = LOCAL amount in `currency` (app-wide reading),
    // the file's authoritative USD goes to specs.montant_usd.
    const amountUsd = parseAmount(pick(it, "montant_total_usd"));
    const amount = parseAmount(
      pick(it, "montant", "amount", "budget", "budget_usd", "montant_total_local")
    );
    const currency = (pick(it, "devise", "currency", "monnaie") ?? null) as string | null;
    const scoreRaw = parseAmount(pick(it, "score"));
    const relevance = (pick(it, "pertinence", "relevance", "potentiel") ?? null) as string | null;
    const sourceUrl = (pick(it, "lien", "lien_source", "source_url", "url", "source", "url_armp") ?? null) as string | null;
    const j360Url = (pick(it, "j360", "lien_j360", "j360_url", "url_j360") ?? null) as string | null;
    const winnerRaw = pick(it, "gagnant", "winner", "attributaire");
    // J360 exports put the WINNER's contacts at the item level (email /
    // telephone / dirigeant / adresse next to `gagnant`) — fill-empty.
    const winner = applyWinnerItemContacts(participantEntry(winnerRaw), it);
    auditCompany(winnerRaw, winner);

    const rawParts: unknown[] = Array.isArray(it?.participants_data)
      ? it.participants_data
      : Array.isArray(it?.participants)
        ? it.participants
        : [];
    // Participants are now keyed by (company, LOT) — a company winning
    // several lots yields one row per lot, amounts PRESERVED (owner
    // ruling 2026-06-13: never flatten lots away). Sources without lots
    // leave lot_number null → identical to the previous behaviour.
    const seen = new Set<string>();
    const participants: ParticipantRow[] = [];
    const pushRow = (
      e: AttributionContact | null,
      isWinner: boolean,
      lot: { lot_number: string | null; lot_title: string | null; lot_amount: number | null } | null
    ) => {
      if (!e) return;
      const ck = normalizeCompanyKey(e.name);
      if (!ck) return;
      const lotNum = lot?.lot_number ?? null;
      const dedup = `${ck}|${lotNum ?? ""}`;
      if (seen.has(dedup)) {
        const prev = participants.find(
          (p) => normalizeCompanyKey(p.name) === ck && (p.lot_number ?? "") === (lotNum ?? "")
        );
        if (prev) {
          if (isWinner) {
            prev.isWinner = true;
            prev.lot_status = "winner";
          }
          prev.email ??= e.email;
          prev.phone ??= e.phone;
          prev.address ??= e.address;
          prev.manager ??= e.manager;
          prev.history ??= e.history;
        }
        return;
      }
      seen.add(dedup);
      participants.push({
        ...e,
        isWinner,
        amount: lot?.lot_amount ?? e.amount ?? null, // bid_value = this lot's amount
        lot_number: lotNum,
        lot_title: lot?.lot_title ?? null,
        lot_amount: lot?.lot_amount ?? null,
        lot_status: isWinner ? "winner" : "participant",
      });
    };
    // v2 export: winners BY LOT (gagnants[]) — one row per lot, contacts
    // enriched from the entreprises[] directory.
    const lotEntries = extractLots(it);
    if (lotEntries.length > 0) {
      const winnerContacts = new Map(
        winnersFromLots(it, directory).map((w) => [w.name, w] as const)
      );
      for (const lot of lotEntries) {
        const c =
          winnerContacts.get(lot.winner_name) ??
          ({ name: lot.winner_name, amount: null, email: null, phone: null, address: null, manager: null, history: null } as AttributionContact);
        auditCompany(directory.get(lot.winner_name) ?? null, c);
        pushRow(c, true, lot);
      }
    } else if (winner) {
      // v1 export: single `gagnant`, lot-less.
      pushRow(winner, true, null);
    }
    for (const rp of rawParts) {
      const entry = participantEntry(rp);
      auditCompany(rp, entry);
      pushRow(entry, false, null);
    }

    const key = tenderImportKey(title, buyer, date);
    const statut = (pick(it, "statut", "status") ?? null) as string | null;
    const lieu = (pick(it, "lieu", "location") ?? null) as string | null;
    const nbLamp = parseAmount(pick(it, "nb_lampadaires"));
    const specs: Record<string, any> = {};
    if (statut) specs.statut = statut;
    if (lieu) specs.lieu = lieu;
    if (nbLamp != null) specs.nb_lampadaires = nbLamp;
    if (amountUsd != null) specs.montant_usd = amountUsd;
    const marketRef = marketReferenceOf(it);
    byKey.set(key, {
      key,
      external: {
        title,
        buyer,
        country,
        type: "result",
        budget_usd: amount, // LOCAL amount only — USD lives in specs.montant_usd
        currency,
        publication_date: pubDate,
        market_reference: marketRef,
        score: scoreRaw != null ? Math.round(scoreRaw) : null,
        relevance,
        source_url: sourceUrl,
        j360_url: j360Url,
        ...(Object.keys(specs).length > 0 ? { specs } : {}),
      },
      participants,
    });
  });

  const keys = [...byKey.keys()];
  // Chunked by URL budget — one .in() with every key FAILED SILENTLY at
  // the gateway (~30 KB URL), classified everything "new" and the run
  // died on duplicate keys (bug 2026-06-13). A failed chunk ABORTS:
  // misclassifying writes garbage, refusing writes nothing.
  const existingTenders = new Map<string, string>();
  for (const chunk of chunkByUrlBudget(keys)) {
    const { data, error } = await supabase
      .from("tenders")
      .select("id, import_key")
      .in("import_key", chunk);
    if (error) {
      return empty([
        `Could not check which projects already exist (${error.message}) — import aborted, nothing was written.`,
      ]);
    }
    for (const r of (data ?? []) as any[]) if (r.import_key) existingTenders.set(r.import_key, r.id);
  }

  // ---- Consolidation candidates (owner ruling 2026-06-13): a real
  // tender is ONE project. Before creating, fuzzy-match against existing
  // result tenders (matchTender: A market reference / B country+title+
  // window / C create). Bounded read of result tenders, matched in
  // memory. Defensive: pre-m121 DBs lack market_reference → retry.
  type DbCandidate = TenderIdentity & { id: string };
  const dbCandidates: DbCandidate[] = [];
  {
    let q: any = await supabase
      .from("tenders")
      .select("id, title, buyer, country, publication_date, market_reference, budget_usd")
      .eq("type", "result")
      .limit(5000);
    if (q.error && /market_reference/.test(q.error.message ?? "")) {
      q = await supabase
        .from("tenders")
        .select("id, title, buyer, country, publication_date, budget_usd")
        .eq("type", "result")
        .limit(5000);
    }
    for (const r of (q.data ?? []) as any[]) {
      dbCandidates.push({
        id: r.id,
        title: r.title ?? null,
        buyer: r.buyer ?? null,
        country: r.country ?? null,
        date: (r.publication_date as string | null)?.slice(0, 10) ?? null,
        marketRef: (r.market_reference as string | null) ?? null,
        amount: r.budget_usd != null ? Number(r.budget_usd) : null,
      });
    }
  }
  const identityFromExternal = (ext: Record<string, any>): TenderIdentity => ({
    title: ext.title ?? null,
    buyer: ext.buyer ?? null,
    country: ext.country ?? null,
    date: (ext.publication_date as string | null)?.slice(0, 10) ?? null,
    marketRef: (ext.market_reference as string | null) ?? null,
    amount: ext.budget_usd != null ? Number(ext.budget_usd) : null,
  });

  const allParticipants = [...byKey.values()].flatMap((m) => m.participants);
  const contactsFound = allParticipants.filter((p) => p.email || p.phone).length;

  // ---- Resolution plan (shared by dry-run preview AND the real writes):
  // exact import_key → update; else fuzzy → merge into existing (DB) or
  // into a tender created earlier in THIS run; else create. Run targets
  // have no id until executed, so merge_run references the creating
  // plan index, resolved live during execution.
  type PlanItem = {
    key: string;
    m: MappedAttribution;
    action: "exact" | "merge_db" | "merge_run" | "create";
    targetId?: string;
    runRef?: number;
    via?: string;
    score?: number;
    confidence?: string;
  };
  const plan: PlanItem[] = [];
  const runTargets: { identity: TenderIdentity; planIndex: number }[] = [];
  {
    let pi = 0;
    for (const [key, m] of byKey.entries()) {
      const identity = identityFromExternal(m.external);
      const exactId = existingTenders.get(key);
      if (exactId) {
        plan.push({ key, m, action: "exact", targetId: exactId });
        runTargets.push({ identity, planIndex: pi });
      } else {
        const dbHit = matchTender(identity, dbCandidates);
        if (dbHit.match && dbHit.confidence) {
          plan.push({ key, m, action: "merge_db", targetId: dbHit.match.id, via: dbHit.via ?? undefined, score: dbHit.score, confidence: dbHit.confidence });
        } else {
          const runHit = matchTender(identity, runTargets.map((r) => r.identity));
          if (runHit.match && runHit.confidence) {
            const ref = runTargets.find((r) => r.identity === runHit.match)!.planIndex;
            plan.push({ key, m, action: "merge_run", runRef: ref, via: runHit.via ?? undefined, score: runHit.score, confidence: runHit.confidence });
          } else {
            plan.push({ key, m, action: "create" });
            runTargets.push({ identity, planIndex: pi });
          }
        }
      }
      pi++;
    }
  }
  const willCreate = plan.filter((p) => p.action === "create").length;
  const willUpdate = plan.filter((p) => p.action === "exact").length;
  const willMerge = plan.filter((p) => p.action === "merge_db" || p.action === "merge_run").length;
  const willMergeFlagged = plan.filter(
    (p) => (p.action === "merge_db" || p.action === "merge_run") && p.confidence === "candidate"
  ).length;

  if (dryRun) {
    return {
      attributions: keys.length,
      attributionsCreated: willCreate,
      attributionsUpdated: willUpdate,
      participants: allParticipants.length,
      contactsFound,
      dbAttributionsTotal: null,
      profilesSynced: null,
      merged: willMerge,
      mergedFlagged: willMergeFlagged,
      fieldAudit,
      errors,
    };
  }

  const nowIso = now();
  // Every prospect linked to a participant we touch gets its stats AND
  // contact intel re-synced after the writes (the sync was lost in the
  // projects-first rewrite — bug found 2026-06-13: re-imports updated
  // participants but never the prospect profiles).
  const touchedProspects: string[] = [];

  // Dedup rule (m116): one company = ONE prospect row. A participant whose
  // name matches an existing prospect gets LINKED at import time — without
  // the link the contact sync can never find it (ANAYI BF bug 2026-06-13:
  // participant carried email/phone/address, profile stayed empty).
  const prospectIdByKey = new Map<string, string>();
  {
    const allKeys = [
      ...new Set(allParticipants.map((p) => normalizeCompanyKey(p.name)).filter(Boolean)),
    ];
    if (allKeys.length > 0) {
      const { data: prRows } = await supabase
        .from("prospects")
        .select("id, name_key, merged_into_id")
        .in("name_key", allKeys);
      for (const r of (prRows ?? []) as any[]) {
        if (!r.merged_into_id && r.name_key && !prospectIdByKey.has(r.name_key)) {
          prospectIdByKey.set(r.name_key, r.id);
        }
      }
    }
  }

  let actualCreated = 0;
  let actualUpdated = 0;
  let actualMerged = 0;
  let actualMergedFlagged = 0;
  // Run-created tender ids, by plan index — lets a later merge_run resolve
  // the id of a tender created earlier in THIS same import.
  const idByPlanIndex = new Map<number, string>();

  const insertTender = async (key: string, external: Record<string, any>, externalLegacy: Record<string, any>) => {
    let ins = await supabase
      .from("tenders")
      .insert({ ...external, import_key: key, imported_at: nowIso, last_import_at: nowIso, commercial_status: "new", created_by: user?.id ?? null })
      .select("id")
      .single();
    if (ins.error && /j360_url|market_reference/.test(ins.error.message ?? "")) {
      ins = await supabase
        .from("tenders")
        .insert({ ...externalLegacy, import_key: key, imported_at: nowIso, last_import_at: nowIso, commercial_status: "new", created_by: user?.id ?? null })
        .select("id")
        .single();
    }
    return ins;
  };

  for (let pi = 0; pi < plan.length; pi++) {
    const item = plan[pi];
    const { key, m } = item;
    // m117 j360_url / m121 market_reference may be missing on old DBs — keep
    // a legacy projection to retry without them.
    const { j360_url: _j360, market_reference: _mref, ...externalLegacy } = m.external;
    let tenderId: string | null = null;

    if (item.action === "exact") {
      tenderId = item.targetId ?? null;
      if (tenderId) {
        idByPlanIndex.set(pi, tenderId);
        let upd = await supabase
          .from("tenders")
          .update({ ...m.external, import_key: key, last_import_at: nowIso, updated_at: nowIso })
          .eq("id", tenderId);
        if (upd.error && /j360_url|market_reference/.test(upd.error.message ?? "")) {
          upd = await supabase
            .from("tenders")
            .update({ ...externalLegacy, import_key: key, last_import_at: nowIso, updated_at: nowIso })
            .eq("id", tenderId);
        }
        if (upd.error) errors.push(`Update "${m.external.title}": ${upd.error.message}`);
        else actualUpdated += 1;
      }
    } else if (item.action === "create") {
      const ins = await insertTender(key, m.external, externalLegacy);
      if (!ins.error && ins.data) {
        tenderId = ins.data.id as string;
        idByPlanIndex.set(pi, tenderId);
        actualCreated += 1;
      } else if (/duplicate key|uq_tenders_import_key/i.test(ins.error?.message ?? "")) {
        const { data: ex } = await supabase.from("tenders").select("id").eq("import_key", key).maybeSingle();
        if (ex?.id) { tenderId = ex.id as string; idByPlanIndex.set(pi, tenderId); actualUpdated += 1; }
      }
      if (!tenderId) {
        errors.push(`Create "${m.external.title}": ${ins.error?.message ?? "insert failed"}`);
        continue;
      }
    } else {
      // merge_db (existing tender) or merge_run (created earlier this run)
      tenderId =
        item.action === "merge_db"
          ? item.targetId ?? null
          : item.runRef != null
            ? idByPlanIndex.get(item.runRef) ?? null
            : null;
      if (!tenderId) {
        // Merge target vanished (creation failed) — fall back to creating.
        const ins = await insertTender(key, m.external, externalLegacy);
        if (!ins.error && ins.data) { tenderId = ins.data.id as string; idByPlanIndex.set(pi, tenderId); actualCreated += 1; }
        if (!tenderId) { errors.push(`Create "${m.external.title}": ${ins.error?.message ?? "insert failed"}`); continue; }
      } else {
        idByPlanIndex.set(pi, tenderId);
        actualMerged += 1;
        if (item.confidence === "candidate") actualMergedFlagged += 1;
        // Provenance — NEVER discard: source URLs + market ref + merge log.
        const { data: tgt } = await supabase
          .from("tenders")
          .select("specs, source_url, j360_url, market_reference")
          .eq("id", tenderId)
          .maybeSingle();
        const specs = tgt?.specs && typeof tgt.specs === "object" && !Array.isArray(tgt.specs) ? { ...(tgt.specs as any) } : {};
        const urls = new Set<string>(Array.isArray(specs.source_urls) ? specs.source_urls : []);
        for (const u of [tgt?.source_url, tgt?.j360_url, m.external.source_url, m.external.j360_url]) if (u) urls.add(u);
        specs.source_urls = [...urls];
        const log = Array.isArray(specs.merge_log) ? specs.merge_log : [];
        log.push({ from: m.external.title ?? key, via: item.via ?? "", score: item.score ?? null, confidence: item.confidence ?? "", at: nowIso });
        specs.merge_log = log;
        if (item.confidence === "candidate") specs.merge_flagged = true;
        const patch: Record<string, any> = { specs, last_import_at: nowIso, updated_at: nowIso };
        if (!tgt?.market_reference && m.external.market_reference) patch.market_reference = m.external.market_reference;
        let u = await supabase.from("tenders").update(patch).eq("id", tenderId);
        if (u.error && /market_reference/.test(u.error.message ?? "")) {
          const { market_reference: _mr, ...p2 } = patch;
          u = await supabase.from("tenders").update(p2).eq("id", tenderId);
        }
        if (u.error) errors.push(`Merge "${m.external.title}": ${u.error.message}`);
      }
    }

    if (!tenderId) continue;

    // ---- Participants upsert — keyed by (company, LOT). Contacts + lot
    // columns fill empty only; m117/m121 columns degrade gracefully. ----
    const { data: existingParts } = await supabase
      .from("tender_participants")
      .select("*")
      .eq("tender_id", tenderId);
    const existingByKey = new Map<string, any>();
    // Legacy winner rows (pre-m121: one row per company, lot_number null)
    // queued per company so a re-import UPGRADES them to per-lot rows in
    // place instead of inserting duplicates beside them.
    const legacyWinnerByCompany = new Map<string, any[]>();
    for (const ep of (existingParts ?? []) as any[]) {
      const eck = normalizeCompanyKey(ep.company_name);
      existingByKey.set(`${eck}|${ep.lot_number ?? ""}`, ep);
      if ((ep.lot_number == null || ep.lot_number === "") && ep.is_winner) {
        const q = legacyWinnerByCompany.get(eck);
        if (q) q.push(ep);
        else legacyWinnerByCompany.set(eck, [ep]);
      }
    }
    const consumedLegacy = new Set<string>();
    for (const p of m.participants) {
      const ck = normalizeCompanyKey(p.name);
      const dk = `${ck}|${p.lot_number ?? ""}`;
      let ep = existingByKey.get(dk);
      // Transition: new row carries a real lot but only a legacy null-lot
      // winner row exists → reuse (upgrade) it once, no duplicate.
      if (!ep && p.lot_number != null) {
        const q = legacyWinnerByCompany.get(ck);
        while (q && q.length) {
          const cand = q.shift();
          if (cand && !consumedLegacy.has(cand.id)) {
            ep = cand;
            consumedLegacy.add(cand.id);
            break;
          }
        }
      }
      const linkedProspectId = (ep?.promoted_prospect_id as string | null) ?? prospectIdByKey.get(ck) ?? null;
      if (linkedProspectId) touchedProspects.push(linkedProspectId);
      const contactCols: Record<string, any> = {
        email: p.email, phone: p.phone, address: p.address,
        manager_name: p.manager, source_history: p.history ?? null,
      };
      const lotCols: Record<string, any> = {
        lot_number: p.lot_number, lot_title: p.lot_title,
        lot_amount: p.lot_amount, lot_status: p.lot_status,
      };
      if (ep) {
        const patch: Record<string, any> = {};
        if (!ep.promoted_prospect_id && linkedProspectId) patch.promoted_prospect_id = linkedProspectId;
        if (!!ep.is_winner !== p.isWinner) patch.is_winner = p.isWinner;
        if (p.amount != null && ep.bid_value == null) patch.bid_value = p.amount;
        for (const [col, val] of Object.entries(contactCols)) if (val != null && (ep[col] == null || ep[col] === "")) patch[col] = val;
        for (const [col, val] of Object.entries(lotCols)) if (val != null && (ep[col] == null || ep[col] === "")) patch[col] = val;
        if (Object.keys(patch).length > 0) {
          let u = await supabase.from("tender_participants").update(patch).eq("id", ep.id);
          // LAYERED degradation — contacts (m117) and lots (m121) are
          // INDEPENDENT: a missing lot column must NEVER drop contacts
          // (the ZEROX bug 2026-06-16). Strip lots first, contacts only
          // if THEY are the problem.
          if (u.error && /lot_number|lot_title|lot_amount|lot_status/.test(u.error.message ?? "")) {
            const { lot_number: _ln, lot_title: _lt, lot_amount: _la, lot_status: _ls, ...noLot } = patch;
            u = Object.keys(noLot).length > 0
              ? await supabase.from("tender_participants").update(noLot).eq("id", ep.id)
              : ({ error: null } as any);
          }
          if (u.error && /email|phone|address|manager_name|source_history/.test(u.error.message ?? "")) {
            const { email: _e, phone: _p, address: _a, manager_name: _m2, source_history: _h, lot_number: _ln2, lot_title: _lt2, lot_amount: _la2, lot_status: _ls2, ...legacyPatch } = patch;
            u = Object.keys(legacyPatch).length > 0
              ? await supabase.from("tender_participants").update(legacyPatch).eq("id", ep.id)
              : ({ error: null } as any);
          }
          if (u.error) errors.push(`Participant "${p.name}": ${u.error.message}`);
        }
      } else {
        const baseRow = {
          tender_id: tenderId,
          company_name: p.name,
          country: m.external.country ?? null,
          is_winner: p.isWinner,
          bid_value: p.amount,
          promoted_prospect_id: linkedProspectId,
          created_by: user?.id ?? null,
        };
        let insP = await supabase.from("tender_participants").insert({ ...baseRow, ...contactCols, ...lotCols });
        // LAYERED degradation: missing lot columns (m121) must NOT cost us
        // the contacts (m117). Drop lots first, contacts only if needed.
        if (insP.error && /lot_number|lot_title|lot_amount|lot_status/.test(insP.error.message ?? "")) {
          insP = await supabase.from("tender_participants").insert({ ...baseRow, ...contactCols });
        }
        if (insP.error && /email|phone|address|manager_name|source_history/.test(insP.error.message ?? "")) {
          insP = await supabase.from("tender_participants").insert(baseRow);
        }
        if (insP.error) errors.push(`Participant "${p.name}": ${insP.error.message}`);
      }
    }
  }

  // Sync stats + contacts onto every linked prospect (fill-empty only).
  const profilesSynced = await recomputeProspectTenderStats(supabase, touchedProspects);

  // GROUND TRUTH — recount attribution tenders straight from the DB.
  const { count: dbAttributionsTotal } = await supabase
    .from("tenders")
    .select("id", { count: "exact", head: true })
    .eq("type", "result");

  if (errors.length > 0) {
    console.error("[importTenderAttributions] errors:", errors);
  }

  revalidate();
  return {
    attributions: keys.length,
    // ACTUAL outcomes (DB-confirmed) — not the planned classification.
    attributionsCreated: actualCreated,
    attributionsUpdated: actualUpdated,
    participants: allParticipants.length,
    contactsFound,
    dbAttributionsTotal: dbAttributionsTotal ?? null,
    profilesSynced,
    merged: actualMerged,
    mergedFlagged: actualMergedFlagged,
    fieldAudit,
    errors,
  };
}

/**
 * Assign ONE COMPANY inside a project (m118 — two-level assignment).
 * Management only, like project assignment. The prospect created later
 * inherits this owner.
 */
export async function setParticipantOwner(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  await requireProjectManagement();
  const id = reqStr(formData, "id");
  const raw = String(formData.get("owner_id") ?? "");
  const owner_id = raw && raw !== "__unassign__" ? raw : null;
  const supabase = createClient();
  const { error } = await supabase
    .from("tender_participants")
    .update({ owner_id })
    .eq("id", id);
  if (error) {
    if (/owner_id/.test(error.message ?? "")) {
      throw new Error(
        "Company-level assignment is not installed — apply migration 118 in Supabase first."
      );
    }
    throw new Error(error.message);
  }
  // If the company is already a prospect, keep the prospect's owner in
  // sync (assignment is the management decision, wherever it lands).
  const { data: part } = await supabase
    .from("tender_participants")
    .select("promoted_prospect_id")
    .eq("id", id)
    .maybeSingle();
  const prospectId = (part as any)?.promoted_prospect_id as string | null;
  if (prospectId) {
    const { data: pr } = await supabase
      .from("prospects")
      .select("status")
      .eq("id", prospectId)
      .maybeSingle();
    const patch: Record<string, any> = { owner_id, updated_at: now() };
    if (owner_id && pr?.status === "new") patch.status = "assigned";
    if (!owner_id && pr?.status === "assigned") patch.status = "new";
    await supabase.from("prospects").update(patch).eq("id", prospectId);
  }
  revalidate();
}

/**
 * Explicit prospect creation from a project (m117 — the salesperson
 * decides): scope 'winner' | 'participants' | 'all'. Deduplicated on
 * name_key (existing companies get LINKED + contact-enriched, never
 * duplicated). New prospects inherit the PROJECT owner when assigned.
 */
export async function createProspectsForTender(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const tenderId = reqStr(formData, "tender_id");
  // winner | participants | all | custom (Prospecting Assistant filters)
  const scope = reqStr(formData, "scope");
  if (!["winner", "participants", "all", "custom"].includes(scope)) {
    throw new Error("Invalid scope");
  }
  const flag = (k: string) => formData.get(k) === "on" || formData.get(k) === "true";
  const includeWinner =
    scope === "all" || scope === "winner" || (scope === "custom" && flag("include_winner"));
  const includeParticipants =
    scope === "all" ||
    scope === "participants" ||
    (scope === "custom" && flag("include_participants"));
  const requireEmail = scope === "custom" && flag("require_email");
  const requirePhone = scope === "custom" && flag("require_phone");
  // Assistant default: skip companies ALREADY in the CRM unless ticked.
  const includeExisting = scope !== "custom" || flag("include_existing");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: tender }, { data: parts }] = await Promise.all([
    supabase.from("tenders").select("id, owner_id, country").eq("id", tenderId).maybeSingle(),
    supabase.from("tender_participants").select("*").eq("tender_id", tenderId),
  ]);
  if (!tender) throw new Error("Project not found");

  let targets = ((parts ?? []) as any[])
    .filter((p) => (p.is_winner ? includeWinner : includeParticipants))
    .filter((p) => {
      if (!requireEmail && !requirePhone) return true;
      return (requireEmail && p.email) || (requirePhone && p.phone);
    });

  if (!includeExisting && targets.length > 0) {
    // Drop companies already in the CRM (promoted, or name_key match).
    const keys = targets.map((p) => normalizeCompanyKey(p.company_name)).filter(Boolean);
    const existing = new Set<string>();
    for (let i = 0; i < keys.length; i += 500) {
      const { data } = await supabase
        .from("prospects")
        .select("name_key")
        .in("name_key", keys.slice(i, i + 500))
        .is("merged_into_id", null);
      for (const r of (data ?? []) as any[]) existing.add(r.name_key);
    }
    targets = targets.filter(
      (p) => !p.promoted_prospect_id && !existing.has(normalizeCompanyKey(p.company_name))
    );
  }
  if (targets.length === 0) throw new Error("No companies match these filters.");

  const touched: string[] = [];
  for (const part of targets) {
    // Two-level assignment (m118): company owner ?? project owner ?? me.
    const ownerId =
      (part as any).owner_id ?? (tender as any).owner_id ?? user?.id ?? null;
    let prospectId = part.promoted_prospect_id as string | null;
    if (!prospectId) {
      const nameKey = normalizeCompanyKey(part.company_name);
      const { data: existing } = await supabase
        .from("prospects")
        .select("id")
        .eq("name_key", nameKey)
        .is("merged_into_id", null)
        .limit(1)
        .maybeSingle();
      if (existing) {
        prospectId = existing.id as string;
      } else {
        const { data: created, error } = await supabase
          .from("prospects")
          .insert({
            company_name: part.company_name,
            name_key: nameKey,
            country: part.country ?? (tender as any).country ?? null,
            email: part.email ?? null,
            phone: part.phone ?? null,
            address: part.address ?? null,
            leader_name: part.manager_name ?? null,
            source: "tender_attribution",
            source_tender_id: tenderId,
            owner_id: ownerId,
            status: ownerId ? "assigned" : "new",
            created_by: user?.id ?? null,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        prospectId = created.id as string;
      }
      await supabase
        .from("tender_participants")
        .update({ promoted_prospect_id: prospectId })
        .eq("id", part.id);
    } else {
      // Already a prospect — fill its empty contact fields from the file.
      const { data: pr } = await supabase
        .from("prospects").select("*").eq("id", prospectId).maybeSingle();
      if (pr) {
        const patch: Record<string, any> = {};
        if (!(pr as any).email && part.email) patch.email = part.email;
        if (!(pr as any).phone && part.phone) patch.phone = part.phone;
        if (!(pr as any).address && part.address) patch.address = part.address;
        if (!(pr as any).leader_name && part.manager_name) patch.leader_name = part.manager_name;
        if (Object.keys(patch).length > 0) {
          patch.updated_at = now();
          await supabase.from("prospects").update(patch).eq("id", prospectId);
        }
      }
    }
    touched.push(prospectId);
  }
  await recomputeProspectTenderStats(supabase, touched);
  revalidate();
}

/** Assign ONE prospect (owner change). status new → assigned, nothing else. */
export async function assignProspect(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const raw = str(formData, "owner_id");
  const ownerId = raw && raw !== "__unassign__" ? raw : null;
  const supabase = createClient();
  const { data: p } = await supabase.from("prospects").select("status").eq("id", id).maybeSingle();
  const patch: Record<string, any> = { owner_id: ownerId, updated_at: now() };
  if (ownerId && p?.status === "new") patch.status = "assigned";
  if (!ownerId && p?.status === "assigned") patch.status = "new";
  const { error } = await supabase.from("prospects").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

/** Bulk assignment (V2 critical rule #5): N companies → one owner, one click. */
export async function bulkAssignProspects(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const ids = reqStr(formData, "ids").split(",").map((s) => s.trim()).filter(Boolean);
  const ownerId = reqStr(formData, "owner_id");
  if (ids.length === 0) throw new Error("No prospects selected");
  const supabase = createClient();
  // Two-step so only NEW rows flip to ASSIGNED (assignment is NOT a lead
  // and must not touch contacted/lead/... statuses).
  const { error: e1 } = await supabase
    .from("prospects")
    .update({ owner_id: ownerId, status: "assigned", updated_at: now() })
    .in("id", ids)
    .eq("status", "new");
  const { error: e2 } = await supabase
    .from("prospects")
    .update({ owner_id: ownerId, updated_at: now() })
    .in("id", ids)
    .neq("status", "new");
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  revalidate();
}

/**
 * Log a commercial activity (email/call/whatsapp/linkedin/meeting/note)
 * and apply the OFFICIAL status rule (lib/prospect-intel):
 *   outbound → contacted (never a lead) · reply → lead · never backwards.
 */
export async function logProspectActivity(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const prospectId = reqStr(formData, "prospect_id");
  const kind = reqStr(formData, "kind") as any;
  const body = str(formData, "body");
  const isReply = formData.get("is_reply") === "on" || formData.get("is_reply") === "true";
  if (!["email", "call", "whatsapp", "linkedin", "meeting", "note"].includes(kind)) {
    throw new Error("Invalid activity kind");
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("prospect_activities").insert({
    prospect_id: prospectId,
    kind,
    body,
    is_reply: isReply,
    created_by: user?.id ?? null,
  });
  if (error) {
    if (/prospect_activities/.test(error.message ?? "")) {
      throw new Error("Activity log not installed — apply migration 116 in Supabase first.");
    }
    throw new Error(error.message);
  }

  const { data: p } = await supabase
    .from("prospects")
    .select("status")
    .eq("id", prospectId)
    .maybeSingle();
  const next = prospectStatusAfterActivity(p?.status ?? "new", kind, isReply);
  const patch: Record<string, any> = { last_activity_at: now(), updated_at: now() };
  if (next) patch.status = next;
  await supabase.from("prospects").update(patch).eq("id", prospectId);
  revalidate();
}

/** Lead Manager enrichment — profile fields, dedup-guarded on rename. */
export async function updateProspectCompany(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const id = reqStr(formData, "id");
  const companyName = reqStr(formData, "company_name");
  const nameKey = normalizeCompanyKey(companyName);
  const supabase = createClient();

  const { data: dupe } = await supabase
    .from("prospects")
    .select("id, company_name")
    .eq("name_key", nameKey)
    .is("merged_into_id", null)
    .neq("id", id)
    .limit(1)
    .maybeSingle();
  if (dupe) {
    throw new Error(
      `"${dupe.company_name}" already exists — use Merge instead of renaming into a duplicate.`
    );
  }

  const { error } = await supabase
    .from("prospects")
    .update({
      company_name: companyName,
      name_key: nameKey,
      country: str(formData, "country"),
      address: str(formData, "address"),
      website: str(formData, "website"),
      linkedin_url: str(formData, "linkedin_url"),
      leader_name: str(formData, "leader_name"),
      leader_role: str(formData, "leader_role"),
      contact_name: str(formData, "contact_name"),
      email: str(formData, "email"),
      phone: str(formData, "phone"),
      notes: str(formData, "notes"),
      updated_at: now(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidate();
}

/**
 * Merge duplicates (Lead Manager). The LOSER's tender history and
 * activities are repointed to the SURVIVOR; empty survivor fields are
 * filled from the loser; the loser is kept (audit) but flagged
 * merged_into_id so it disappears from every list. History is never
 * lost (critical rule #4).
 */
export async function mergeProspects(formData: FormData): Promise<void> {
  await requireCapability("prospect.access");
  const survivorId = reqStr(formData, "survivor_id");
  const loserId = reqStr(formData, "loser_id");
  if (survivorId === loserId) throw new Error("Pick two different companies to merge.");
  const supabase = createClient();

  const [{ data: survivor }, { data: loser }] = await Promise.all([
    supabase.from("prospects").select("*").eq("id", survivorId).maybeSingle(),
    supabase.from("prospects").select("*").eq("id", loserId).maybeSingle(),
  ]);
  if (!survivor || !loser) throw new Error("Prospect not found");
  if ((survivor as any).merged_into_id || (loser as any).merged_into_id) {
    throw new Error("One of these companies is already merged.");
  }

  // Repoint history + activities.
  await supabase
    .from("tender_participants")
    .update({ promoted_prospect_id: survivorId })
    .eq("promoted_prospect_id", loserId);
  await supabase
    .from("prospect_activities")
    .update({ prospect_id: survivorId })
    .eq("prospect_id", loserId);

  // Fill survivor's empty fields from the loser (enrichment is precious).
  const fillable = [
    "country", "address", "website", "linkedin_url", "leader_name",
    "leader_role", "contact_name", "email", "phone",
  ] as const;
  const patch: Record<string, any> = { updated_at: now() };
  for (const f of fillable) {
    if (!(survivor as any)[f] && (loser as any)[f]) patch[f] = (loser as any)[f];
  }
  if ((loser as any).notes) {
    patch.notes = [(survivor as any).notes, `[merged from ${(loser as any).company_name}] ${(loser as any).notes}`]
      .filter(Boolean)
      .join("\n");
  }
  await supabase.from("prospects").update(patch).eq("id", survivorId);

  // Park the loser — kept for audit, hidden everywhere.
  await supabase
    .from("prospects")
    .update({ merged_into_id: survivorId, updated_at: now() })
    .eq("id", loserId);

  await recomputeProspectTenderStats(supabase, [survivorId]);
  revalidate();
}

export type ProspectImportSummary = {
  total: number;
  created: number;
  enriched: number;
  errors: string[];
};

/**
 * Import PROSPECT COMPANIES directly (V2) — the Prospects-side import,
 * distinct from the tender-attribution import. Accepts a JSON array (or
 * { prospects | companies | societes: [...] }) of company objects from
 * LinkedIn exports, trade-show lists, etc.
 *
 * Dedup on name_key (critical rule #3): an existing company is ENRICHED
 * (empty fields filled — email/phone/linkedin/…), never duplicated.
 * New companies arrive UNASSIGNED with status NEW (never auto-leads).
 */
export async function importProspectCompanies(
  itemsJson: string,
  dryRun: boolean
): Promise<ProspectImportSummary> {
  await requireCapability("prospect.access");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let parsed: any;
  try {
    parsed = JSON.parse(itemsJson);
  } catch {
    return { total: 0, created: 0, enriched: 0, errors: ["Invalid JSON file."] };
  }
  const items: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.prospects)
      ? parsed.prospects
      : Array.isArray(parsed?.companies)
        ? parsed.companies
        : Array.isArray(parsed?.societes)
          ? parsed.societes
          : [];
  if (items.length === 0) {
    const isAttributionFile =
      Array.isArray(parsed?.projets) || Array.isArray(parsed?.attributions);
    return {
      total: 0, created: 0, enriched: 0,
      errors: [
        isAttributionFile
          ? "This is a tender ATTRIBUTIONS file ({ projets: [...] }) — re-pick it: the import detects it automatically now. (Or use Import attributions in the Tenders universe.)"
          : "No companies found (expected an array, or { companies: [...] } / { prospects: [...] }).",
      ],
    };
  }

  const errors: string[] = [];
  type Mapped = Record<string, any> & { name_key: string };
  const byKey = new Map<string, Mapped>();
  items.forEach((it, i) => {
    const name = pick(it, "nom", "name", "company", "societe", "société", "company_name") as string | null;
    if (!name) {
      errors.push(`Item ${i + 1}: missing company name.`);
      return;
    }
    const key = normalizeCompanyKey(name);
    if (!key) return;
    byKey.set(key, {
      name_key: key,
      company_name: name,
      country: pick(it, "pays", "country"),
      email: pick(it, "email", "mail"),
      phone: pick(it, "telephone", "téléphone", "phone", "tel"),
      website: pick(it, "site", "site_web", "website", "web"),
      linkedin_url: pick(it, "linkedin", "linkedin_url"),
      leader_name: pick(it, "dirigeant", "leader", "leader_name", "ceo"),
      leader_role: pick(it, "fonction", "role", "leader_role", "titre"),
      address: pick(it, "adresse", "address"),
      contact_name: pick(it, "contact", "contact_name", "contact_person"),
      notes: pick(it, "notes", "note", "commentaire"),
    });
  });

  const keys = [...byKey.keys()];
  const existing = new Map<string, any>();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const { data } = await supabase
      .from("prospects")
      .select("*")
      .in("name_key", chunk)
      .is("merged_into_id", null);
    for (const r of (data ?? []) as any[]) {
      if (r.name_key && !existing.has(r.name_key)) existing.set(r.name_key, r);
    }
  }

  const toCreate = keys.filter((k) => !existing.has(k));
  if (dryRun) {
    return { total: keys.length, created: toCreate.length, enriched: keys.length - toCreate.length, errors };
  }

  // Create the new ones — UNASSIGNED, status NEW, source 'import'.
  for (let i = 0; i < toCreate.length; i += 200) {
    const rows = toCreate.slice(i, i + 200).map((k) => ({
      ...byKey.get(k)!,
      source: "import",
      status: "new",
      owner_id: null,
      created_by: user?.id ?? null,
    }));
    const { error } = await supabase.from("prospects").insert(rows);
    if (error) errors.push(`Create: ${error.message}`);
  }

  // Enrich the existing ones — fill EMPTY fields only, never overwrite
  // the Lead Manager's work.
  const fillable = [
    "country", "email", "phone", "website", "linkedin_url",
    "leader_name", "leader_role", "address", "contact_name",
  ] as const;
  for (const k of keys) {
    const row = existing.get(k);
    if (!row) continue;
    const incoming = byKey.get(k)!;
    const patch: Record<string, any> = {};
    for (const f of fillable) {
      if (!row[f] && incoming[f]) patch[f] = incoming[f];
    }
    if (Object.keys(patch).length > 0) {
      patch.updated_at = now();
      const { error } = await supabase.from("prospects").update(patch).eq("id", row.id);
      if (error) errors.push(`Enrich "${row.company_name}": ${error.message}`);
    }
  }

  revalidate();
  return { total: keys.length, created: toCreate.length, enriched: keys.length - toCreate.length, errors };
}
