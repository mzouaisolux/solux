"use server";

// =====================================================================
// SALES & ANALYTICS — server actions for the editable register (m138).
//
// Every mutation: (1) gates on sales_order.edit (admins pass via the
// anti-lockout floor), (2) writes the change, (3) records a per-field diff in
// sales_audit_log (who / what / when) using the pure lib/sales/audit helper.
// Standalone module — no CRM tables touched.
// =====================================================================

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireCapabilityOrAdmin } from "@/lib/permissions";
import { getCurrentUserRole } from "@/lib/auth";
import { isAdminLike } from "@/lib/types";
import { diffFields, markerEntry } from "@/lib/sales/audit";
import { normalizedClientKey } from "@/lib/sales/client-key";
import { bestClientMatch, type ClientCandidate } from "@/lib/sales/client-match";

// Editable columns + how a string cell value coerces to its DB type.
type FieldType = "text" | "num" | "int" | "date" | "enum" | "uuid";
const FIELD_TYPES: Record<string, FieldType> = {
  sales_client_id: "uuid",
  saler_id: "uuid",
  year: "int",
  month: "int",
  order_date: "date",
  country: "text",
  pi_no: "text",
  payment_terms: "text",
  pi_amount: "num",
  sales_amount: "num",
  transportation: "num",
  received_amount: "num",
  bank_charge: "num",
  balance: "num",
  amount_status: "enum",
  currency: "text",
  shipment_date: "date",
  eta_note: "text",
  pickup: "text",
};

function coerce(field: string, raw: string | null): any {
  const t = FIELD_TYPES[field];
  const s = (raw ?? "").trim();
  if (s === "") return field === "currency" ? "USD" : null;
  switch (t) {
    case "num": {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    case "int": {
      const n = Number(s);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case "enum":
      return s === "invoiced" ? "invoiced" : "provisional";
    default:
      return s; // text / date / uuid — stored as-is
  }
}

type Result = { ok: true } | { ok: false; error: string };

/** Inline edit of one or more cells on a sales order. */
export async function updateSalesOrder(id: string, patch: Record<string, string | null>): Promise<Result> {
  await requireCapabilityOrAdmin("sales_order.edit");
  if (!id) return { ok: false, error: "Missing order id" };
  const fields = Object.keys(patch).filter((f) => f in FIELD_TYPES);
  if (fields.length === 0) return { ok: true };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: before } = await supabase
    .from("sales_orders")
    .select(fields.join(","))
    .eq("id", id)
    .maybeSingle();

  const update: Record<string, any> = {};
  for (const f of fields) update[f] = coerce(f, patch[f]);
  update.updated_at = new Date().toISOString();
  update.updated_by = user?.id ?? null;

  const { error } = await supabase.from("sales_orders").update(update).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const entries = diffFields("sales_order", id, (before ?? {}) as Record<string, unknown>, update, fields, user?.id ?? null);
  if (entries.length) await supabase.from("sales_audit_log").insert(entries);
  // No revalidatePath here: the grid keeps optimistic local state so typing
  // never loses focus. Structural changes (add/delete) do revalidate.
  return { ok: true };
}

export type NewOrderRow = {
  id: string;
  sales_client_id: string | null;
  saler_id: string | null;
  year: number | null;
  month: number | null;
  order_date: string | null;
  country: string | null;
  pi_no: string | null;
  payment_terms: string | null;
  pi_amount: number | null;
  sales_amount: number | null;
  transportation: number | null;
  received_amount: number | null;
  bank_charge: number | null;
  balance: number | null;
  amount_status: string;
  currency: string;
  shipment_date: string | null;
  eta_note: string | null;
  pickup: string | null;
  client: { code: string; name: string } | null;
  saler: { name: string } | null;
};

/** Add a blank order row (manual entry), optionally prefilled with a year. */
export async function createSalesOrder(defaults?: { year?: number | null }): Promise<{ ok: true; row: NewOrderRow } | { ok: false; error: string }> {
  await requireCapabilityOrAdmin("sales_order.edit");
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("sales_orders")
    .insert({ year: defaults?.year ?? null, amount_status: "provisional", currency: "USD", source: "manual", created_by: user?.id ?? null })
    .select("id, sales_client_id, saler_id, year, month, order_date, country, pi_no, payment_terms, pi_amount, sales_amount, transportation, received_amount, bank_charge, balance, amount_status, currency, shipment_date, eta_note, pickup")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert failed" };

  await supabase.from("sales_audit_log").insert([markerEntry("sales_order", data.id, "create", user?.id ?? null)]);
  revalidatePath("/sales");
  return { ok: true, row: { ...(data as any), client: null, saler: null } };
}

/** Delete an order row (admin only — matches the RLS delete policy). */
export async function deleteSalesOrder(id: string): Promise<Result> {
  const { role } = await getCurrentUserRole();
  if (!isAdminLike(role)) return { ok: false, error: "Only an admin can delete a row." };
  if (!id) return { ok: false, error: "Missing order id" };
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("sales_orders").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await supabase.from("sales_audit_log").insert([markerEntry("sales_order", id, "delete", user?.id ?? null)]);
  revalidatePath("/sales");
  return { ok: true };
}

/** Autocomplete over the master client list (name or code). */
export async function searchSalesClients(q: string): Promise<ClientCandidate[]> {
  const term = (q ?? "").trim();
  const supabase = createClient();
  let query = supabase.from("sales_clients").select("id, code, name").is("merged_into_id", null).order("name").limit(20);
  if (term) query = query.or(`name.ilike.%${term.replace(/[%,]/g, "")}%,code.ilike.%${term.replace(/[%,]/g, "")}%`);
  const { data } = await query;
  return (data ?? []) as ClientCandidate[];
}

/**
 * Create a NEW master client from a typed name — running the §4 dedup guard:
 *   - if the normalized key already exists → reuse that client (no dup),
 *   - else if a fuzzy "same/similar" candidate exists → propose it (never
 *     auto-merge); the caller confirms "use existing" or "create anyway",
 *   - else create the client + its self-alias and return it.
 */
export async function createSalesClient(
  name: string,
  opts?: { force?: boolean },
): Promise<
  | { mode: "created" | "reused"; client: ClientCandidate }
  | { mode: "suggest"; candidate: ClientCandidate; score: number }
  | { mode: "error"; error: string }
> {
  await requireCapabilityOrAdmin("sales_order.edit");
  const clean = (name ?? "").trim();
  if (!clean) return { mode: "error", error: "Name required" };
  const key = normalizedClientKey(clean);
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 1. exact normalized-key hit → reuse the existing client.
  if (key) {
    const { data: alias } = await supabase
      .from("sales_client_aliases")
      .select("sales_client_id, sales_clients:sales_client_id(id, code, name)")
      .eq("normalized_key", key)
      .maybeSingle();
    if (alias?.sales_clients) return { mode: "reused", client: alias.sales_clients as any };
  }

  // 2. fuzzy guard against the whole master list (unless the user forces).
  if (!opts?.force) {
    const { data: all } = await supabase.from("sales_clients").select("id, code, name").is("merged_into_id", null);
    const best = bestClientMatch(clean, (all ?? []) as ClientCandidate[]);
    if (best && best.comparison.band !== "distinct") {
      return { mode: "suggest", candidate: best.candidate, score: Math.round(best.comparison.score * 100) };
    }
  }

  // 3. create — next C#### code, + a self-alias so future entries auto-attach.
  const { data: codes } = await supabase.from("sales_clients").select("code");
  let maxN = 0;
  for (const r of (codes ?? []) as any[]) {
    const m = /^C(\d+)$/.exec(String(r.code ?? ""));
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  const code = "C" + String(maxN + 1).padStart(4, "0");
  const { data: created, error } = await supabase
    .from("sales_clients")
    .insert({ code, name: clean, created_by: user?.id ?? null })
    .select("id, code, name")
    .single();
  if (error || !created) return { mode: "error", error: error?.message ?? "create failed" };

  if (key) {
    await supabase.from("sales_client_aliases").insert({ sales_client_id: created.id, raw_text: clean, normalized_key: key, source: "manual", confirmed_by: user?.id ?? null, confirmed_at: new Date().toISOString() });
  }
  await supabase.from("sales_audit_log").insert([markerEntry("sales_client", created.id, "create", user?.id ?? null, { new_value: clean })]);
  revalidatePath("/sales");
  return { mode: "created", client: created as ClientCandidate };
}

export type AuditRow = { action: string; field: string | null; old_value: string | null; new_value: string | null; user_id: string | null; created_at: string };

/** Change history for one order (newest first) — the inline traceability. */
export async function getOrderAudit(id: string): Promise<AuditRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("sales_audit_log")
    .select("action, field, old_value, new_value, user_id, created_at")
    .eq("entity_type", "sales_order")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as AuditRow[];
}

// =====================================================================
// MERGE QUEUE (§4.3) — resolve a suspected duplicate: keep one client, absorb
// the other. NEVER automatic; a human decides here. In-module only.
// =====================================================================
export async function resolveMerge(input: { suggestionId: string; decision: "merge" | "separate"; winnerId?: string; loserId?: string }): Promise<Result> {
  await requireCapabilityOrAdmin("sales_client.merge");
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const now = new Date().toISOString();

  if (input.decision === "separate") {
    const { error } = await supabase.from("sales_merge_suggestions").update({ status: "kept_separate", decided_by: user?.id ?? null, decided_at: now }).eq("id", input.suggestionId);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const winner = input.winnerId, loser = input.loserId;
  if (!winner || !loser || winner === loser) return { ok: false, error: "Choix du client à garder invalide." };

  // 1. move the loser's orders to the winner.
  const { error: e1 } = await supabase.from("sales_orders").update({ sales_client_id: winner, updated_at: now, updated_by: user?.id ?? null }).eq("sales_client_id", loser);
  if (e1) return { ok: false, error: e1.message };

  // 2. move the loser's aliases (drop one that would collide with the winner's).
  const { data: aliases } = await supabase.from("sales_client_aliases").select("id").eq("sales_client_id", loser);
  for (const a of (aliases ?? []) as any[]) {
    const { error: eu } = await supabase.from("sales_client_aliases").update({ sales_client_id: winner, source: "auto_match", confirmed_by: user?.id ?? null, confirmed_at: now }).eq("id", a.id);
    if (eu && (eu as { code?: string }).code === "23505") await supabase.from("sales_client_aliases").delete().eq("id", a.id);
  }

  // 3. deactivate the loser, point it at the winner (soft-merge keeps history).
  const { error: e3 } = await supabase.from("sales_clients").update({ merged_into_id: winner, is_active: false, updated_at: now, updated_by: user?.id ?? null }).eq("id", loser);
  if (e3) return { ok: false, error: e3.message };

  // 4. resolve the suggestion + 5. audit both sides.
  await supabase.from("sales_merge_suggestions").update({ status: "merged", decided_by: user?.id ?? null, decided_at: now }).eq("id", input.suggestionId);
  await supabase.from("sales_audit_log").insert([
    markerEntry("sales_client", loser, "merge", user?.id ?? null, { new_value: `fusionné dans ${winner}` }),
    markerEntry("sales_client", winner, "merge", user?.id ?? null, { new_value: `a absorbé ${loser}` }),
  ]);
  revalidatePath("/sales/merges");
  revalidatePath("/sales");
  return { ok: true };
}
