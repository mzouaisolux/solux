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
    const notif = rows
      .filter((r) => r.consumer === "notification" && r.enabled !== false)
      .map((r) => ({
        role: r.role,
        roleLabel: ROLE_SHORT_LABEL[r.role as Role] ?? r.role,
        channel: r.config?.channel as "bell" | "feed" | "off",
      }))
      .filter((n) => n.channel === "bell" || n.channel === "feed" || n.channel === "off");
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
      notif,
      futureStored,
      // Effective default channel when a role inherits (no override). Uses the
      // CODE severity (runtime ignores the metadata-only severity override), so
      // this matches what the bell actually does today.
      defaultCh: defaultChannel(key, NOTIFICATION_CATALOG[key].severity) as
        | "bell"
        | "feed",
    });
  }

  const modifiedCount = events.filter(
    (e) => e.isModified || e.notif.length > 0 || e.futureStored
  ).length;
  const criticalCount = events.filter((e) => e.severity === "critical").length;

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <section className="card sec ad-section">
          <div className="eyebrow">Admin · Event Registry</div>
          <h2 className="ad-doc-title">Events</h2>
          <p className="ad-lead">
            Every business event and where it goes once emitted. Events are{" "}
            <b>emitted from code</b> — here you configure their{" "}
            <b>routing &amp; presentation</b> (who is notified, in which surfaces).
            Open an event to configure its whole downstream life on one page.
          </p>

          {/* Honest runtime banner — what actually takes effect today. */}
          <div className="evt-banner" role="note">
            <span className="evt-banner-dot" />
            <div>
              <b>Today, only notifications are enforced at runtime.</b> Bell &amp;
              feed routing takes effect immediately. Dashboard, KPI and Audit
              settings are <b>stored for later</b> and have no effect yet.
            </div>
          </div>

          {/* Status legend. */}
          <div className="evt-legend">
            <span className="evt-leg">
              <span className="evt-leg-badge live">Live</span> enforced today
              (Notification)
            </span>
            <span className="evt-leg">
              <span className="evt-leg-badge store">Stored only</span> saved, not
              used yet (Dashboard, KPI, Audit)
            </span>
            <span className="evt-leg">
              <span className="evt-leg-badge future">Future</span> not
              configurable yet (Automations)
            </span>
          </div>

          {tableMissing && (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900"
              style={{ marginTop: 12 }}
            >
              ⚠ Tables <code>event_routing</code> /{" "}
              <code>event_catalog_overrides</code> missing — apply migration{" "}
              <code>136_event_registry.sql</code>. Until then every event shows
              its code defaults (read-only routing).
            </div>
          )}

          <p className="evt-counts">
            <span className="evt-stat">
              <b>{events.length}</b> events
            </span>
            <span className="evt-stat-sep">·</span>
            <span className="evt-stat">
              <b>{modifiedCount}</b> modified
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
