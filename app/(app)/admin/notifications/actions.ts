"use server";

// =====================================================================
// Notification rules matrix — save action (Phase 3C UI).
//
// Persists the FULL matrix state like /permissions does, but stores ONLY
// overrides: a cell set to "default" means NO row (legacy behavior).
// Gated to admin / super_admin to match the m123 RLS.
// =====================================================================

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import { isAdminLike, VIEW_AS_ROLES } from "@/lib/types";
import { NOTIFICATION_EVENT_KEYS } from "@/lib/notification-catalog";
import { emitEvent } from "@/lib/events";
import { revalidatePath } from "next/cache";

export async function saveNotificationRules(formData: FormData): Promise<void> {
  const { role } = await getCurrentUserRole();
  if (!isAdminLike(role)) throw new Error("Admins only");
  const supabase = createClient();

  // Desired = every non-"default" cell.
  const desired: Array<{ role: string; event_key: string; channel: string }> = [];
  for (const r of VIEW_AS_ROLES) {
    for (const key of NOTIFICATION_EVENT_KEYS) {
      const v = String(formData.get(`${r}__${key}`) ?? "default");
      if (v === "bell" || v === "feed" || v === "off") {
        desired.push({ role: r, event_key: key, channel: v });
      }
    }
  }

  // Upsert desired FIRST (no empty window), then remove the rest.
  if (desired.length > 0) {
    const { error } = await supabase
      .from("notification_rules")
      .upsert(desired, { onConflict: "role,event_key" });
    if (error) throw new Error(`Could not save notification rules: ${error.message}`);
  }
  const desiredKeys = new Set(desired.map((d) => `${d.role}:${d.event_key}`));
  const { data: current } = await supabase.from("notification_rules").select("role, event_key");
  for (const c of (current ?? []) as any[]) {
    if (!desiredKeys.has(`${c.role}:${c.event_key}`)) {
      await supabase.from("notification_rules").delete().eq("role", c.role).eq("event_key", c.event_key);
    }
  }

  await emitEvent({
    entity_type: "system",
    entity_id: "notification_rules",
    event_type: "admin.permissions_changed",
    message: "Notification rules updated",
    payload: { scope: "notification_rules", overrides: desired.length },
    bestEffort: true,
  });

  revalidatePath("/", "layout"); // bell uses these rules everywhere
  revalidatePath("/admin/notifications");
}
