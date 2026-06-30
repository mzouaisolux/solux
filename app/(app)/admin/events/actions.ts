"use server";

// =====================================================================
// Event Registry — save action (Step 1, m136).
//
// Persists ONE event's full downstream config in two places:
//   event_catalog_overrides — identity (only NON-baseline fields stored;
//                             all-baseline ⇒ the row is deleted).
//   event_routing           — per-(consumer, role) routing, rewritten
//                             clean-slate for this event_key.
// Gated to admin / super_admin to match the m136 RLS.
// Config ROUTES; code PROJECTS — this never stores business logic.
// =====================================================================

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import { isAdminLike, VIEW_AS_ROLES } from "@/lib/types";
import { NOTIFICATION_CATALOG } from "@/lib/notification-catalog";
import { KPI_KEYS, type CatalogOverride } from "@/lib/event-registry";
import { emitEvent } from "@/lib/events";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export async function saveEventConfig(formData: FormData): Promise<void> {
  const { role } = await getCurrentUserRole();
  if (!isAdminLike(role)) throw new Error("Admins only");

  const eventKey = String(formData.get("event_key") ?? "");
  const base = (
    NOTIFICATION_CATALOG as Record<
      string,
      { category: string; severity: string; label: string }
    >
  )[eventKey];
  if (!base) throw new Error(`Unknown event: ${eventKey}`);

  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id ?? null;
  const now = new Date().toISOString();

  // ---------- identity override (store ONLY non-baseline fields) ----------
  const sevRaw = String(formData.get("id__severity") ?? base.severity);
  const severity = (
    SEVERITIES.includes(sevRaw as (typeof SEVERITIES)[number])
      ? sevRaw
      : base.severity
  ) as CatalogOverride["severity"];
  const label = String(formData.get("id__label") ?? "").trim();
  const description = String(formData.get("id__description") ?? "").trim();
  const icon = String(formData.get("id__icon") ?? "").trim();
  const category = String(formData.get("id__category") ?? base.category).trim();
  const reqRaw = String(formData.get("id__requires_action") ?? "default");
  const enabledOn = formData.get("id__enabled") != null; // checkbox present ⇒ enabled

  const override: CatalogOverride = {};
  if (label && label !== base.label) override.label = label;
  if (description) override.description = description;
  if (icon) override.icon = icon;
  if (category && category !== base.category) override.category = category;
  if (severity && severity !== base.severity) override.severity = severity;
  if (reqRaw === "yes" || reqRaw === "no") override.requires_action = reqRaw === "yes";
  if (!enabledOn) override.enabled = false;

  if (Object.keys(override).length === 0) {
    await supabase.from("event_catalog_overrides").delete().eq("event_key", eventKey);
  } else {
    const { error } = await supabase
      .from("event_catalog_overrides")
      .upsert(
        { event_key: eventKey, ...override, updated_by: uid, updated_at: now },
        { onConflict: "event_key" }
      );
    if (error) throw new Error(`Could not save event identity: ${error.message}`);
  }

  // ---------- routing (clean slate for this single event) -----------------
  type Row = {
    event_key: string;
    consumer: string;
    role: string;
    config: Record<string, unknown>;
    updated_by: string | null;
    updated_at: string;
  };
  const desired: Row[] = [];

  // notification — per-role channel (default ⇒ no row ⇒ legacy behavior)
  for (const r of VIEW_AS_ROLES) {
    const v = String(formData.get(`notification__${r}`) ?? "default");
    if (v === "bell" || v === "feed" || v === "off") {
      desired.push({ event_key: eventKey, consumer: "notification", role: r, config: { channel: v }, updated_by: uid, updated_at: now });
    }
  }
  // dashboard — per-role visibility + a shared section
  const section = String(formData.get("dashboard__section") ?? "todays_work");
  for (const r of VIEW_AS_ROLES) {
    if (formData.get(`dashboard_role__${r}`) != null) {
      desired.push({ event_key: eventKey, consumer: "dashboard", role: r, config: { section }, updated_by: uid, updated_at: now });
    }
  }
  // kpi — global multiselect (role '*')
  const kpis = KPI_KEYS.map((k) => k.value).filter((v) => formData.get(`kpi__${v}`) != null);
  if (kpis.length > 0) {
    desired.push({ event_key: eventKey, consumer: "kpi", role: "*", config: { kpis }, updated_by: uid, updated_at: now });
  }
  // audit — global visibility (store only the non-default 'internal')
  if (String(formData.get("audit__visibility") ?? "visible") === "internal") {
    desired.push({ event_key: eventKey, consumer: "audit", role: "*", config: { visibility: "internal" }, updated_by: uid, updated_at: now });
  }

  await supabase.from("event_routing").delete().eq("event_key", eventKey);
  if (desired.length > 0) {
    const { error } = await supabase.from("event_routing").insert(desired);
    if (error) throw new Error(`Could not save event routing: ${error.message}`);
  }

  // Audit the config change in the event log. NOTE: events.entity_id is
  // `uuid NOT NULL` (m022) — a non-UUID string (e.g. `event_config:<key>`) is
  // rejected at INSERT (22P02) and, under bestEffort, was silently dropped, so
  // registry changes were never audited. Use the actor's uuid (nil-uuid
  // fallback), matching the permissions-matrix emit; the event_key lives in the
  // payload. bestEffort stays true so an audit hiccup never blocks the save —
  // emitEvent still console.errors on failure, so a dev trace remains.
  await emitEvent({
    entity_type: "system",
    entity_id: uid ?? "00000000-0000-0000-0000-000000000000",
    event_type: "admin.permissions_changed",
    message: `Event registry: ${eventKey} configuration updated`,
    payload: { scope: "event_registry", event_key: eventKey, routing: desired.length },
    bestEffort: true,
  });

  revalidatePath("/", "layout"); // bell + future consumers read these
  revalidatePath(`/admin/events/${eventKey}`);
  redirect(`/admin/events/${eventKey}?saved=1`);
}

/**
 * Reset ONE event back to its code defaults: drop its identity override
 * AND every routing row. Same "clean slate" as a save with all-default
 * values, but explicit and one-click. Scoped to a single event_key, so it
 * can never touch another event. Gated to admin / super_admin (m136 RLS).
 * No schema / model change — just deletes this event's override rows.
 */
export async function resetEventConfig(formData: FormData): Promise<void> {
  const { role } = await getCurrentUserRole();
  if (!isAdminLike(role)) throw new Error("Admins only");

  const eventKey = String(formData.get("event_key") ?? "");
  if (!(eventKey in NOTIFICATION_CATALOG)) throw new Error(`Unknown event: ${eventKey}`);

  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id ?? null;

  await supabase.from("event_catalog_overrides").delete().eq("event_key", eventKey);
  await supabase.from("event_routing").delete().eq("event_key", eventKey);

  await emitEvent({
    entity_type: "system",
    entity_id: uid ?? "00000000-0000-0000-0000-000000000000",
    event_type: "admin.permissions_changed",
    message: `Event registry: ${eventKey} configuration reset to defaults`,
    payload: { scope: "event_registry", event_key: eventKey, action: "reset" },
    bestEffort: true,
  });

  revalidatePath("/", "layout");
  revalidatePath(`/admin/events/${eventKey}`);
  redirect(`/admin/events/${eventKey}?reset=1`);
}
