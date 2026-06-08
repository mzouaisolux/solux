"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { VIEW_AS_COOKIE, getCurrentUserRole } from "@/lib/auth";
import { VIEW_AS_ROLES, type Role } from "@/lib/types";

/**
 * Sets the View As cookie so the super-admin's UI renders as the chosen
 * role. **Only super-admins can call this** — every other role is rejected
 * even if they craft the request manually.
 */
export async function setViewAsRole(formData: FormData) {
  const { isSuperAdmin } = await getCurrentUserRole();
  if (!isSuperAdmin) {
    throw new Error("View As is only available to super-admins.");
  }

  const raw = String(formData.get("role") ?? "");
  if (!VIEW_AS_ROLES.includes(raw as Role)) {
    throw new Error("Invalid view-as role");
  }

  cookies().set(VIEW_AS_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24h — keep simulation tied to a working session
  });

  // Re-render every page so the new effective role takes hold immediately.
  revalidatePath("/", "layout");
}

/**
 * Clear the View As cookie. Restores the super-admin to their real role.
 */
export async function clearViewAsRole() {
  const { isSuperAdmin } = await getCurrentUserRole();
  if (!isSuperAdmin) {
    // Silently no-op for non-super-admins — they shouldn't see this button
    // in the UI anyway, and there's nothing to clean up.
    return;
  }
  cookies().delete(VIEW_AS_COOKIE);
  revalidatePath("/", "layout");
}
