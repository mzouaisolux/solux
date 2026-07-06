import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  VIEW_AS_ROLES,
  isAdminLike,
  type Role,
} from "@/lib/types";

/** Cookie name used by the View As simulator. */
export const VIEW_AS_COOKIE = "solux_view_as_role";

/**
 * Returns the REAL role of the currently authenticated user.
 *
 * If `user_roles.super_admin` is true, this surfaces the virtual role
 * `"super_admin"` (so the UI can tell the difference). The DB column
 * `user_roles.role` stays untouched — RLS keeps working unchanged.
 *
 * **This function never reads the View As cookie.** Use it everywhere
 * permission decisions are made — server actions, requireAdmin, etc.
 */
export const getCurrentUserRole = cache(async function getCurrentUserRole(): Promise<{
  userId: string | null;
  role: Role | null;
  isSuperAdmin: boolean;
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userId: null, role: null, isSuperAdmin: false };

  const { data } = await supabase
    .from("user_roles")
    .select("role, super_admin")
    .eq("user_id", user.id)
    .maybeSingle();

  const dbRole = (data?.role ?? null) as Role | null;
  const isSuperAdmin = !!data?.super_admin;
  // Virtual surface — super_admin overrides the stored role for type
  // purposes, since the DB column stays "admin" for RLS compatibility.
  const role: Role | null = isSuperAdmin ? "super_admin" : dbRole;

  return { userId: user.id, role, isSuperAdmin };
});

/**
 * Returns what the UI should render as. For super-admins, honors the
 * `solux_view_as_role` cookie so they can preview the app as any other
 * role. For every other user, returns the real role unchanged — they
 * can't simulate.
 *
 * **Never use this for permission checks.** It only affects rendering.
 */
export const getEffectiveRole = cache(async function getEffectiveRole(): Promise<{
  userId: string | null;
  realRole: Role | null;
  effectiveRole: Role | null;
  isSuperAdmin: boolean;
  isSimulating: boolean;
}> {
  const { userId, role: realRole, isSuperAdmin } = await getCurrentUserRole();

  if (!isSuperAdmin) {
    return {
      userId,
      realRole,
      effectiveRole: realRole,
      isSuperAdmin,
      isSimulating: false,
    };
  }

  const cookieStore = cookies();
  const raw = cookieStore.get(VIEW_AS_COOKIE)?.value;
  const candidate = (raw ?? "") as Role;
  const isValid = VIEW_AS_ROLES.includes(candidate);

  // If the cookie is missing, invalid, or matches the real role, no
  // simulation is in effect.
  if (!isValid || candidate === realRole) {
    return {
      userId,
      realRole,
      effectiveRole: realRole,
      isSuperAdmin,
      isSimulating: false,
    };
  }

  return {
    userId,
    realRole,
    effectiveRole: candidate,
    isSuperAdmin,
    isSimulating: true,
  };
});

/**
 * Throws unless the caller has admin-level write access. Accepts both
 * "admin" and the virtual "super_admin" role.
 */
export async function requireAdmin() {
  const { role } = await getCurrentUserRole();
  if (!isAdminLike(role)) {
    throw new Error("Admins only");
  }
}

/**
 * Throws unless the caller has technical-review privileges on task lists.
 * Used to gate technical_values edits, factory PDF generation, and the
 * task_list_manager / operations dashboard / component mappings admin.
 *
 * `operations` shares the same scope as `task_list_manager` for this
 * gate (production planning / shipment / deadlines), so both pass.
 */
export async function requireTaskListManagerOrAdmin() {
  const { role } = await getCurrentUserRole();
  if (
    !isAdminLike(role) &&
    role !== "task_list_manager" &&
    role !== "operations"
  ) {
    throw new Error("Task list manager, operations or admin only");
  }
}

/**
 * Throws unless the caller is a super-admin (has `user_roles.super_admin = true`).
 *
 * Reserved for genuinely destructive operations that must never be
 * available to regular admins:
 *   - Physical DELETE of business records (quotation / task list / PO)
 *   - Future: editing system tables, role/permission management UI
 *
 * Per the soft-delete policy: regular admins should `cancel` (status) or
 * `archive` (archived_at) records. Only super-admins can issue a
 * real SQL DELETE — and that should be rare (RGPD takedowns, test data
 * cleanup, deduplication).
 */
export async function requireSuperAdmin() {
  const { isSuperAdmin } = await getCurrentUserRole();
  if (!isSuperAdmin) {
    throw new Error(
      "Super-admin only — this action permanently deletes data and is reserved for system administrators."
    );
  }
}
