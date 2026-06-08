/**
 * Sales filter — operational scope-by-sales utilities.
 *
 * Used by technical roles (admin / TLM / operations / super-admin) to
 * narrow the dashboard + operational surfaces to "data owned by a
 * single sales rep" via a URL param (?sales=<uuid>).
 *
 * Sales users themselves never see this control — they're already
 * RLS-scoped to their own data, and the filter has no meaning in
 * their context.
 */

import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/lib/events-shared";

/** Each pill in the SalesFilterBar. */
export type SalesUserForFilter = {
  /** auth.users id — used as the ?sales= value. */
  id: string;
  /** Email (may be null if the auth row has no email). */
  email: string | null;
  /** Pre-formatted short label for the pill — "mehdi" (from email
   *  local-part) when possible, else "sales·1a2b3c". */
  label: string;
  /** Count of critical+open events tied to this sales' entities. */
  criticalCount: number;
};

/**
 * Parse the `?sales=` search param into a UUID (or null).
 * Accepts the param value as it comes from Next.js searchParams
 * (string | string[] | undefined).
 */
export function parseSalesFilterParam(
  raw: string | string[] | undefined
): string | null {
  if (!raw) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  // Lightweight UUID validation — accept any 32-hex-with-dashes shape.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    return null;
  }
  return v;
}

/**
 * Compute the EFFECTIVE sales scope for the current request:
 *   - If the caller is sales (scopedToMe), force the scope to their
 *     own user_id (RLS already enforces this; we still pass it for
 *     query consistency).
 *   - If the caller is technical AND a sales filter is requested in
 *     the URL, return that target sales' id.
 *   - Otherwise, no filter (= see everything within RLS).
 */
export function resolveEffectiveSalesScope({
  userId,
  scopedToMe,
  requestedSalesId,
}: {
  userId: string | null;
  scopedToMe: boolean;
  requestedSalesId: string | null;
}): string | null {
  if (scopedToMe) return userId ?? null;
  return requestedSalesId; // null when "All sales"
}

/**
 * Fetch the list of sales users for the filter bar, with per-user
 * counts of critical+open operational events.
 *
 * Pulls the user list via the m047 SECURITY DEFINER RPC (which gates
 * to technical roles at SQL level). Returns an empty list if:
 *   - m047 isn't applied yet (RPC missing)
 *   - the caller isn't technical (RPC raises 42501)
 *   - there are no sales users yet
 *
 * The critical counts are computed in-memory from the provided
 * opsFeedEvents list (already fetched by the page) + a documents /
 * task lists / production_orders ownership map.
 */
export async function getSalesUsersForFilter(
  opsFeedEvents: EventRow[]
): Promise<SalesUserForFilter[]> {
  const supabase = createClient();

  // 1. List sales users via the gated RPC.
  const { data: rows, error: rpcErr } = await supabase.rpc(
    "list_sales_for_filter"
  );
  if (rpcErr) {
    // Soft-fail in two cases:
    //   - RPC missing (m047 not applied yet)
    //   - Caller not technical (RPC raised 42501) — we still want
    //     the page to render, just without the filter bar.
    if (
      /list_sales_for_filter/i.test(rpcErr.message ?? "") ||
      rpcErr.code === "42501" ||
      /technical roles only/i.test(rpcErr.message ?? "")
    ) {
      return [];
    }
    console.warn("[getSalesUsersForFilter] rpc error:", rpcErr.message);
    return [];
  }
  if (!rows || rows.length === 0) return [];

  type RpcRow = { out_user_id: string; out_email: string | null; out_role: string };
  const salesRows = rows as RpcRow[];
  const salesIds = salesRows.map((r) => r.out_user_id);

  // 2. Map documents → owning sales user (only for sales' docs).
  const { data: docs } = await supabase
    .from("documents")
    .select("id, created_by")
    .in("created_by", salesIds);
  const docToSales = new Map<string, string>();
  for (const d of (docs ?? []) as Array<{ id: string; created_by: string | null }>) {
    if (d.created_by) docToSales.set(d.id, d.created_by);
  }
  const docIds = Array.from(docToSales.keys());

  // 3. Map production_orders + task_lists → owning sales (transitively
  //    via their quotation_id). Empty doc set short-circuits.
  const poToSales = new Map<string, string>();
  const tlToSales = new Map<string, string>();
  if (docIds.length > 0) {
    const [{ data: pos }, { data: tls }] = await Promise.all([
      supabase
        .from("production_orders")
        .select("id, quotation_id")
        .in("quotation_id", docIds),
      supabase
        .from("production_task_lists")
        .select("id, quotation_id")
        .in("quotation_id", docIds),
    ]);
    for (const po of (pos ?? []) as Array<{ id: string; quotation_id: string }>) {
      const sales = docToSales.get(po.quotation_id);
      if (sales) poToSales.set(po.id, sales);
    }
    for (const tl of (tls ?? []) as Array<{ id: string; quotation_id: string }>) {
      const sales = docToSales.get(tl.quotation_id);
      if (sales) tlToSales.set(tl.id, sales);
    }
  }

  // 4. Aggregate critical+open events per sales user.
  const criticalBySales = new Map<string, number>();
  for (const e of opsFeedEvents) {
    if (e.severity !== "critical") continue;
    if ((e.status ?? "open") === "resolved") continue;

    let owner: string | null = null;
    if (e.entity_type === "document") {
      owner = docToSales.get(e.entity_id) ?? null;
    } else if (e.entity_type === "production_order") {
      owner = poToSales.get(e.entity_id) ?? null;
    } else if (e.entity_type === "task_list") {
      owner = tlToSales.get(e.entity_id) ?? null;
    }
    if (owner) {
      criticalBySales.set(owner, (criticalBySales.get(owner) ?? 0) + 1);
    }
  }

  // 5. Build display rows.
  return salesRows.map((r): SalesUserForFilter => {
    const email = r.out_email ?? null;
    // Friendly label — "mehdi" from "mehdi@solux.com", else uid prefix.
    let label: string;
    if (email && email.includes("@")) {
      const local = email.split("@")[0];
      label = local.length > 0 ? local : `sales·${r.out_user_id.slice(0, 6)}`;
    } else {
      label = `sales·${r.out_user_id.slice(0, 6)}`;
    }
    return {
      id: r.out_user_id,
      email,
      label,
      criticalCount: criticalBySales.get(r.out_user_id) ?? 0,
    };
  });
}

/**
 * Pre-fetch document IDs owned by a target sales user so callers can
 * filter dependent tables (production_orders, production_task_lists,
 * events) by `quotation_id in (ids)` or `entity_id in (ids)`.
 *
 * Returns null when no filter is requested (caller should skip the
 * dependent filtering entirely). Returns [] when the sales user has
 * no docs (caller should hard-filter to nothing).
 */
export async function getDocIdsOwnedBySales(
  salesId: string | null
): Promise<string[] | null> {
  if (!salesId) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .eq("created_by", salesId);
  if (error) {
    console.warn("[getDocIdsOwnedBySales]", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => r.id as string);
}
