"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getCurrentUserRole } from "@/lib/auth";
import { requireCapability } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import {
  ROLE_LABEL,
  ASSIGNABLE_ROLES,
  type AssignableRole,
  type Role,
} from "@/lib/types";

/**
 * Architecture note
 * -----------------
 * Writes to `user_roles` go through SECURITY DEFINER SQL RPCs:
 *   - admin_set_user_role(target_user_id, new_role)
 *   - admin_toggle_super_admin(target_user_id, enable)
 *
 * Those functions run as the function owner (postgres), so they
 * bypass RLS on user_roles — which avoids the policy-fighting we
 * went through with migration 028. The functions check that the
 * caller is a super-admin at SQL level (auth.uid() lookup), so the
 * authorization is enforced regardless of how they're called.
 *
 * The app-level requireCapability("admin.manage_users") here is
 * still useful: it gives a friendly UI error (caught by error.tsx
 * as the amber permission banner) before we even reach the RPC,
 * and it provides a single source of truth for super-admins who
 * granted/revoked admin.manage_users via the matrix.
 */

export async function setUserRole(formData: FormData) {
  await requireCapability("admin.manage_users");

  const targetUserId = String(formData.get("user_id") ?? "");
  const newRole = String(formData.get("role") ?? "") as AssignableRole;
  if (!targetUserId) throw new Error("Missing user id");
  // Only the 3 DB-storable roles are valid here. super_admin is a
  // separate flag, not a role value — use toggleSuperAdmin for that.
  if (!ASSIGNABLE_ROLES.includes(newRole)) {
    throw new Error(
      `Invalid role: ${newRole}. Allowed: ${ASSIGNABLE_ROLES.join(", ")}. To promote to super-admin, use the toggle.`
    );
  }

  const supabase = createClient();
  const { userId: actorId } = await getCurrentUserRole();

  // Self-demotion guard (app-level — the RPC also refuses, redundancy
  // is fine). We bail early with a clear message before bothering the DB.
  if (actorId === targetUserId) {
    throw new Error(
      "You can't change your own role. Ask another super-admin to do it."
    );
  }

  // Load current state — used only for the audit event diff. RLS will
  // happily let a super-admin read user_roles (existing read policy is
  // permissive enough). If RLS hides the row, previousRole comes back
  // as null; the audit event then reads "unset → <role>".
  const { data: prev } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", targetUserId)
    .maybeSingle();
  const previousRole = prev?.role ?? null;
  if (previousRole === newRole) return; // no-op

  // Perform the write via the security-definer RPC.
  const { error: rpcErr } = await supabase.rpc("admin_set_user_role", {
    target_user_id: targetUserId,
    new_role: newRole,
  });
  if (rpcErr) {
    throw new Error(`Could not set role: ${rpcErr.message}`);
  }

  await emitEvent({
    entity_type: "system",
    entity_id: targetUserId,
    event_type: "admin.user_role_changed",
    severity: "high",
    message: `User role changed: ${
      previousRole ? ROLE_LABEL[previousRole as Role] : "unset"
    } → ${ROLE_LABEL[newRole]}`,
    payload: {
      target_user_id: targetUserId,
      from: previousRole,
      to: newRole,
    },
    bestEffort: true,
  });

  revalidatePath("/admin/users");
  revalidatePath("/", "layout"); // refresh capability-driven nav everywhere
}

/**
 * Set (or clear) a user's human display name. Admin / super-admin only.
 *
 * Writes directly to `user_profiles` — RLS on that table enforces the
 * admin/super-admin gate at SQL level, and the app-level capability
 * check gives the friendly UI error. Self-edit IS allowed here (unlike
 * role/super changes): naming yourself is harmless.
 */
export async function setUserDisplayName(formData: FormData) {
  await requireCapability("admin.manage_users");

  const targetUserId = String(formData.get("user_id") ?? "");
  const raw = String(formData.get("display_name") ?? "").trim();
  if (!targetUserId) throw new Error("Missing user id");
  if (raw.length > 80) {
    throw new Error("Display name is too long (80 characters max).");
  }
  const displayName = raw || null; // empty clears the name

  const supabase = createClient();
  const { userId: actorId } = await getCurrentUserRole();

  const { error } = await supabase.from("user_profiles").upsert(
    {
      user_id: targetUserId,
      display_name: displayName,
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    },
    { onConflict: "user_id" }
  );
  if (error) {
    if (/user_profiles/.test(error.message ?? "")) {
      throw new Error(
        "user_profiles table missing — apply migration m052 (052_user_profiles.sql) in Supabase."
      );
    }
    throw new Error(`Could not set display name: ${error.message}`);
  }

  revalidatePath("/admin/users");
  revalidatePath("/", "layout"); // names show in nav-adjacent surfaces
}

export async function toggleSuperAdmin(formData: FormData) {
  await requireCapability("admin.manage_users");

  const targetUserId = String(formData.get("user_id") ?? "");
  const enable = formData.get("enable") === "true";
  if (!targetUserId) throw new Error("Missing user id");

  const supabase = createClient();
  const { userId: actorId } = await getCurrentUserRole();

  if (actorId === targetUserId) {
    throw new Error(
      "You can't toggle your own super-admin flag. Ask another super-admin to do it."
    );
  }

  // Read previous state for the audit log.
  const { data: prev } = await supabase
    .from("user_roles")
    .select("super_admin")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (prev?.super_admin === enable) return; // no-op

  // The RPC itself enforces the "last super-admin" guard, the self
  // check, and bypasses RLS via SECURITY DEFINER.
  const { error: rpcErr } = await supabase.rpc("admin_toggle_super_admin", {
    target_user_id: targetUserId,
    enable,
  });
  if (rpcErr) {
    throw new Error(`Could not toggle super-admin: ${rpcErr.message}`);
  }

  await emitEvent({
    entity_type: "system",
    entity_id: targetUserId,
    event_type: "admin.user_role_changed",
    severity: "high",
    message: enable
      ? "User promoted to super-admin"
      : "User demoted from super-admin",
    payload: {
      target_user_id: targetUserId,
      super_admin_change: { from: !!prev?.super_admin, to: enable },
    },
    bestEffort: true,
  });

  revalidatePath("/admin/users");
  revalidatePath("/", "layout");
}
