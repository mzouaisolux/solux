// =====================================================================
// Event Registry — index (Step 1, m136).
//
// The home of "everything that happens after an event is emitted". One
// row per business event, grouped by category, with at-a-glance badges
// showing which consumers it currently feeds. Click through to configure
// the event's whole downstream life on one page.
// =====================================================================

import { Fragment } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { isAdminLike } from "@/lib/types";
import AccessDenied from "@/components/AccessDenied";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_EVENT_KEYS,
} from "@/lib/notification-catalog";
import {
  CONSUMERS,
  CONSUMER_BY_KEY,
  resolveEventIdentity,
  activeConsumers,
  type RoutingRow,
  type CatalogOverride,
} from "@/lib/event-registry";
import type { EventType } from "@/lib/events-shared";

export const dynamic = "force-dynamic";

const SEV_TINT: Record<string, string> = {
  low: "#eef2f7",
  medium: "#e0f2fe",
  high: "#fef3c7",
  critical: "#fde2e2",
};

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
    overrides = (data ?? []) as any[];
  }

  const byEvent = new Map<string, RoutingRow[]>();
  for (const r of routingRows) {
    const a = byEvent.get(r.event_key) ?? [];
    a.push(r);
    byEvent.set(r.event_key, a);
  }
  const ovByKey = new Map<string, CatalogOverride>();
  for (const o of overrides) ovByKey.set(o.event_key, o);

  // Group events by (resolved) category, preserving catalog order.
  const grouped = new Map<string, EventType[]>();
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const cat = resolveEventIdentity(key, ovByKey.get(key) ?? null).category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(key);
  }

  const configuredCount = byEvent.size;

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <section className="card sec ad-section">
          <div className="eyebrow">Admin · Event Registry</div>
          <h2 className="ad-doc-title">Events</h2>
          <p className="ad-lead">
            Every business event and where it goes once emitted. Events are still
            emitted from code — here you configure the <b>routing &amp; presentation</b>{" "}
            of each (who consumes it, in which surfaces). Open an event to see and
            configure its whole downstream life on one page.
          </p>

          {/* Consumer legend */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "10px 0 4px", fontSize: 12 }}>
            {CONSUMERS.map((c) => (
              <span key={c.key} title={c.description}>
                {c.icon} {c.label}
                <span
                  style={{
                    marginLeft: 4,
                    fontSize: 10,
                    padding: "1px 5px",
                    borderRadius: 8,
                    background: c.status === "live" ? "#dcfce7" : c.status === "described" ? "#e0e7ff" : "#f1f5f9",
                    color: "#334155",
                  }}
                >
                  {c.status}
                </span>
              </span>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "#71717a", margin: "2px 0 0" }}>
            <b>live</b> = enforced at runtime now · <b>described</b> = stored only, projection not wired yet · <b>reserved</b> = future. Today only <b>Notification</b> is live.
          </p>

          {tableMissing && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900" style={{ marginTop: 12 }}>
              ⚠ Tables <code>event_routing</code> / <code>event_catalog_overrides</code> missing —
              apply migration <code>136_event_registry.sql</code>. Until then every event shows its
              code defaults (read-only routing).
            </div>
          )}

          <p style={{ fontSize: 12, color: "#71717a", margin: "8px 0 0" }}>
            {NOTIFICATION_EVENT_KEYS.length} events · {configuredCount} with overrides
          </p>

          <div className="ad-mtx-wrap" style={{ marginTop: 12 }}>
            <table className="ad-mtx">
              <thead>
                <tr>
                  <th className="cap">Event</th>
                  <th>Severity</th>
                  <th>Consumers</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {Array.from(grouped.entries()).map(([category, keys]) => (
                  <Fragment key={`cat-${category}`}>
                    <tr>
                      <td colSpan={4} style={{ background: "#f4f4f5", fontWeight: 700, textTransform: "uppercase", fontSize: 11, letterSpacing: ".04em", padding: "6px 8px" }}>
                        {category}
                      </td>
                    </tr>
                    {keys.map((key) => {
                      const id = resolveEventIdentity(key, ovByKey.get(key) ?? null);
                      const active = activeConsumers(byEvent.get(key) ?? []);
                      return (
                        <tr key={key}>
                          <td className="cap">
                            <div style={{ fontWeight: 600 }}>
                              {id.icon ? `${id.icon} ` : ""}
                              {id.label}
                              {!id.enabled && (
                                <span style={{ marginLeft: 6, fontSize: 10, color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: 6, padding: "0 5px" }}>disabled</span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: "#71717a" }}>{key}</div>
                          </td>
                          <td>
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: SEV_TINT[id.severity] ?? "#eef2f7" }}>
                              {id.severity}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: 15, letterSpacing: 2 }}>
                              {CONSUMERS.filter((c) => active.has(c.key)).map((c) => (
                                <span key={c.key} title={`${c.label} configured`}>{c.icon}</span>
                              ))}
                              {active.size === 0 && <span style={{ fontSize: 11, color: "#a1a1aa" }}>defaults</span>}
                            </span>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <Link href={`/admin/events/${key}`} className="sx-btn" style={{ fontSize: 12, padding: "3px 10px" }}>
                              Configure →
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
