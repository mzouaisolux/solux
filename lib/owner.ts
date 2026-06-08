/**
 * Sales owner helpers (m066).
 *
 * The "owner" of a client (account manager) or a document (deal owner) is
 * the assignable `sales_owner_id` when set, else the record's `created_by`.
 * Management can (re)assign it via the OwnerAssignSelect; everything that
 * shows/filters by owner should resolve through `effectiveOwnerId`.
 *
 * Server-only (uses the request-scoped Supabase client + a SECURITY DEFINER
 * RPC). Soft-fails to an empty list when the caller isn't management or
 * m066 isn't applied.
 */

import { createClient } from "@/lib/supabase/server";

export type OwnerOption = { id: string; name: string; role?: string | null };

/** Effective owner = explicit assignment first, then the creator. */
export function effectiveOwnerId(
  salesOwnerId: string | null | undefined,
  createdBy: string | null | undefined
): string | null {
  return (salesOwnerId ?? null) || (createdBy ?? null);
}

/**
 * Directory of assignable users for the owner pickers, via
 * `list_assignable_owners()` (management-only). Returns [] for non-managers
 * or when m066 isn't applied — so callers can simply hide the picker.
 */
export async function listAssignableOwners(): Promise<OwnerOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("list_assignable_owners");
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    id: r.user_id as string,
    name:
      (r.display_name && String(r.display_name).trim()) ||
      (r.email as string | null) ||
      `user·${String(r.user_id).slice(0, 6)}`,
    role: (r.role as string | null) ?? null,
  }));
}
