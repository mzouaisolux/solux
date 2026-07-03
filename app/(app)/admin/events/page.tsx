// =====================================================================
// Event Registry — index (m136). Conservative redesign pass: clearer
// hierarchy, honest runtime banner, search/filters + a per-row status
// that says what actually happens today (live notification routing vs
// default vs stored-for-later). Data resolution stays server-side; the
// interactive table is a thin client island. NO override is written by
// viewing — this page only reads.
// =====================================================================

import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { isAdminLike, ROLE_SHORT_LABEL, type Role } from "@/lib/types";
import AccessDenied from "@/components/AccessDenied";
import {
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_CATALOG,
  defaultChannel,
} from "@/lib/notification-catalog";
import {
  resolveEventIdentity,
  type RoutingRow,
  type CatalogOverride,
} from "@/lib/event-registry";
import { getEventHelp } from "@/lib/event-help";
import EventRegistryTable, { type EvtRow } from "./EventRegistryTable";

export const dynamic = "force-dynamic";

export default async function EventRegistryIndex() {
  const { effectiveRole } = await getEffectiveRole();
  if (!isAdminLike(effectiveRole)) {
    return <AccessDenied message="Event registry is admin-only." />;
  }

  const supabase = createClient();
  let tableMissing = false;
  let routingRows: RoutingRow[] = [];
  let overrides: Array<{ event_key: string } & CatalogOverride> = [];
  {
    const { data, error } = await supabase
      .from("event_routing")
      .select("event_key, consumer, role, config, enabled");
    if (error) tableMissing = true;
    else routingRows = (data ?? []) as RoutingRow[];
  }
  {
    const { data } = await supabase.from("event_catalog_overrides").select("*");
    overrides = (data ?? []) as Array<{ event_key: string } & CatalogOverride>;
  }

  const byEvent = new Map<string, RoutingRow[]>();
  for (const r of routingRows) {
    const a = byEvent.get(r.event_key) ?? [];
    a.push(r);
    byEvent.set(r.event_key, a);
  }
  const ovByKey = new Map<string, CatalogOverride>();
  for (const o of overrides) ovByKey.set(o.event_key, o);

  // Resolve every event server-side into a flat, serializable row.
  const events: EvtRow[] = [];
  const categories: string[] = [];
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const ov = ovByKey.get(key) ?? null;
    const id = resolveEventIdentity(key, ov);
    if (!categories.includes(id.category)) categories.push(id.category);
    const rows = byEvent.get(key) ?? [];
    // Per-role channel overrides (exclude the master role='*' switch, which
    // carries no channel — it only says notifications are ON for the event).
    const notif = rows
      .filter(
        (r) =>
          r.consumer === "notification" &&
          r.role !== "*" &&
          r.enabled !== false
      )
      .map((r) => ({
        role: r.role,
        roleLabel: ROLE_SHORT_LABEL[r.role as Role] ?? r.role,
        channel: r.config?.channel as "bell" | "feed" | "off",
      }))
      .filter((n) => n.channel === "bell" || n.channel === "feed" || n.channel === "off");
    // Opt-in master: notifications enabled ⇔ a role='*' row exists (enabled).
    const notifEnabled = rows.some(
      (r) => r.consumer === "notification" && r.role === "*" && r.enabled !== false
    );
    const futureStored = rows.some((r) =>
      ["dashboard", "kpi", "audit"].includes(r.consumer)
    );
    events.push({
      key,
      label: id.label,
      icon: id.icon,
      category: id.category,
      severity: id.severity,
      enabled: id.enabled,
      isModified: !!ov && Object.keys(ov).length > 0,
      notifEnabled,
      notif,
      futureStored,
      help: getEventHelp(key),
      // Effective default channel a role inherits once the event is enabled.
      // Uses the CODE severity (runtime ignores the metadata-only severity
      // override), so this matches what the bell actually does.
      defaultCh: defaultChannel(key, NOTIFICATION_CATALOG[key].severity) as
        | "bell"
        | "feed",
    });
  }

  const enabledCount = events.filter((e) => e.notifEnabled).length;
  const criticalCount = events.filter((e) => e.severity === "critical").length;

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <section className="card sec ad-section">
          <div className="eyebrow">Admin · Event Registry</div>
          <h2 className="ad-doc-title">Events</h2>
          <p className="ad-lead">
            Every business event and where it goes once emitted. Events are{" "}
            <b>emitted from code</b> — here you decide which ones actually{" "}
            <b>notify people</b>. Hover the{" "}
            <span className="evt-inline-i" aria-hidden>i</span> on any event to
            see, in plain language, what it means and who would care.
          </p>

          {/* Opt-in banner — the new default philosophy. */}
          <div className="evt-banner" role="note">
            <span className="evt-banner-dot off" />
            <div>
              <b>Notifications are off by default.</b> Every event starts
              disabled and notifies no one. Turn on only the events that prove
              useful — open an event and enable it to choose recipients.
            </div>
          </div>

          {/* Badge legend — how to read the list at a glance. */}
          <div className="evt-legend">
            <span className="evt-leg">
              <span className="evt-leg-badge on">Enabled</span> notifies people
            </span>
            <span className="evt-leg">
              <span className="evt-leg-badge off">Disabled</span> notifies no one
            </span>
            <span className="evt-leg">
              <span className="evt-leg-badge custom">Customized</span> tuned per
              recipient
            </span>
            <span className="evt-leg">
              <span className="evt-leg-badge critical">Critical</span> high-impact
              event
            </span>
          </div>

          {tableMissing && (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900"
              style={{ marginTop: 12 }}
            >
              ⚠ Tables <code>event_routing</code> /{" "}
              <code>event_catalog_overrides</code> missing — apply migration{" "}
              <code>136_event_registry.sql</code>. Until then every event stays
              disabled and configuration cannot be saved.
            </div>
          )}

          <p className="evt-counts">
            <span className="evt-stat">
              <b>{events.length}</b> events
            </span>
            <span className="evt-stat-sep">·</span>
            <span className="evt-stat">
              <b>{enabledCount}</b> enabled
            </span>
            <span className="evt-stat-sep">·</span>
            <span className="evt-stat crit">
              <b>{criticalCount}</b> critical
            </span>
          </p>

          <EventRegistryTable events={events} categories={categories} />
        </section>
      </div>
    </div>
  );
}
