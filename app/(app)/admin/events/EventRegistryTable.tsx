"use client";

// =====================================================================
// Event Registry index — interactive table (client island).
//
// Pure presentation: the server resolves every row (identity + routing
// summary) and hands a serializable array down. Here we add search, quick
// filters, an at-a-glance status badge (enabled / disabled / customized /
// critical) and a plain-language help popover — NO data fetching, NO
// override is ever written by viewing or filtering.
// =====================================================================

import { useMemo, useState, Fragment } from "react";
import Link from "next/link";
import type { EventHelp as EventHelpData } from "@/lib/event-help";
import EventHelp from "./EventHelp";

export type NotifRoute = {
  role: string;
  roleLabel: string;
  channel: "bell" | "feed" | "off";
};

export type EvtRow = {
  key: string;
  label: string;
  icon: string | null;
  category: string;
  severity: "low" | "medium" | "high" | "critical";
  enabled: boolean;
  /** identity override exists (label/icon/category/severity/…) */
  isModified: boolean;
  /** notifications are turned ON for this event (opt-in master switch) */
  notifEnabled: boolean;
  /** per-role notification overrides (only meaningful when enabled) */
  notif: NotifRoute[];
  /** dashboard/kpi/audit routing exists — stored, no runtime effect */
  futureStored: boolean;
  /** plain-language help for the info popover */
  help: EventHelpData | null;
  /** effective channel a role inherits when enabled with no override */
  defaultCh: "bell" | "feed";
};

const CH_LABEL: Record<NotifRoute["channel"], string> = {
  bell: "bell",
  feed: "feed",
  off: "off",
};

/** Notification status of a row — drives the primary at-a-glance badge. */
type Status = "enabled" | "disabled" | "customized";
function rowStatus(e: EvtRow): Status {
  if (!e.notifEnabled) return "disabled";
  return e.notif.length > 0 ? "customized" : "enabled";
}
const STATUS_BADGE: Record<Status, { cls: string; label: string }> = {
  enabled: { cls: "on", label: "Enabled" },
  disabled: { cls: "off", label: "Disabled" },
  customized: { cls: "custom", label: "Customized" },
};

type Quick = "all" | "enabled" | "disabled" | "customized" | "critical";

export default function EventRegistryTable({
  events,
  categories,
}: {
  events: EvtRow[];
  categories: string[];
}) {
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<Quick>("all");
  const [cat, setCat] = useState<string>("all");

  const counts = useMemo(
    () => ({
      all: events.length,
      enabled: events.filter((e) => e.notifEnabled).length,
      disabled: events.filter((e) => !e.notifEnabled).length,
      customized: events.filter((e) => e.notifEnabled && e.notif.length > 0)
        .length,
      critical: events.filter((e) => e.severity === "critical").length,
    }),
    [events]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (cat !== "all" && e.category !== cat) return false;
      if (quick === "enabled" && !e.notifEnabled) return false;
      if (quick === "disabled" && e.notifEnabled) return false;
      if (quick === "customized" && !(e.notifEnabled && e.notif.length > 0))
        return false;
      if (quick === "critical" && e.severity !== "critical") return false;
      if (needle && !`${e.label} ${e.key}`.toLowerCase().includes(needle))
        return false;
      return true;
    });
  }, [events, q, quick, cat]);

  const grouped = useMemo(() => {
    const m = new Map<string, EvtRow[]>();
    for (const c of categories) m.set(c, []);
    for (const e of filtered) {
      if (!m.has(e.category)) m.set(e.category, []);
      m.get(e.category)!.push(e);
    }
    return Array.from(m.entries()).filter(([, rows]) => rows.length > 0);
  }, [filtered, categories]);

  const chips: { key: Quick; label: string; n: number }[] = [
    { key: "all", label: "All", n: counts.all },
    { key: "enabled", label: "Enabled", n: counts.enabled },
    { key: "disabled", label: "Disabled", n: counts.disabled },
    { key: "customized", label: "Customized", n: counts.customized },
    { key: "critical", label: "Critical", n: counts.critical },
  ];

  const emptyMsg =
    quick === "enabled"
      ? "No events are enabled yet — open an event to turn its notifications on."
      : quick === "customized"
        ? "No enabled event has per-recipient overrides yet."
        : quick === "disabled"
          ? "Every event is currently enabled."
          : quick === "critical"
            ? "No critical events match."
            : "No events match your search.";

  return (
    <>
      <div className="evt-toolbar">
        <input
          className="evt-search"
          type="search"
          placeholder="Search events by name or key (e.g. po.created)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search events"
        />
        <select
          className="evt-catsel"
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
      </div>

      <div className="evt-chips">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`evt-chip${quick === c.key ? " on" : ""}${c.key === "critical" && c.n > 0 ? " crit" : ""}`}
            onClick={() => setQuick(c.key)}
            aria-pressed={quick === c.key}
          >
            {c.label}
            <span className="evt-chip-ct">{c.n}</span>
          </button>
        ))}
      </div>

      <div className="ad-mtx-wrap evt-mtx-wrap" style={{ marginTop: 12 }}>
        <table className="ad-mtx evt-mtx">
          <thead>
            <tr>
              <th className="cap">Event</th>
              <th>Severity</th>
              <th>Notifications</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {grouped.length === 0 && (
              <tr>
                <td colSpan={4} className="evt-empty">
                  {emptyMsg}
                </td>
              </tr>
            )}
            {grouped.map(([category, rows]) => (
              <Fragment key={`cat-${category}`}>
                <tr className="evt-catrow">
                  <td colSpan={4}>
                    <span className="evt-cat-name">{category}</span>
                    <span className="evt-cat-ct">{rows.length}</span>
                  </td>
                </tr>
                {rows.map((e) => {
                  const status = rowStatus(e);
                  const badge = STATUS_BADGE[status];
                  return (
                    <tr
                      key={e.key}
                      className={e.severity === "critical" ? "evt-row-crit" : undefined}
                    >
                      <td className="cap">
                        <div className="cl">
                          {e.icon ? `${e.icon} ` : ""}
                          {e.label}
                          {e.help && (
                            <EventHelp title={e.label} help={e.help} />
                          )}
                        </div>
                        <div className="ck">
                          <span className="evt-key">{e.key}</span>
                          {e.severity === "critical" && (
                            <span className="evt-tag evt-tag-crit">Critical</span>
                          )}
                          {e.isModified && (
                            <span className="evt-tag evt-tag-mod">Modified</span>
                          )}
                          {!e.isModified && e.futureStored && (
                            <span className="evt-tag evt-tag-store">
                              Stored (future)
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`evt-sev evt-sev-${e.severity}`}>
                          {e.severity}
                        </span>
                      </td>
                      <td>
                        <div className="evt-notif-cell-idx">
                          <span className={`evt-status-badge ${badge.cls}`}>
                            {badge.label}
                          </span>
                          {e.notifEnabled && (
                            <span className="evt-routes">
                              {e.notif.length > 0 ? (
                                e.notif.map((n) => (
                                  <span
                                    key={n.role}
                                    className={`evt-ch evt-ch-${n.channel}`}
                                    title={`${n.roleLabel}: ${n.channel}`}
                                  >
                                    {n.roleLabel} · {CH_LABEL[n.channel]}
                                  </span>
                                ))
                              ) : (
                                <span
                                  className={`evt-ch evt-ch-${e.defaultCh} is-default`}
                                  title="Built-in default from this event's severity"
                                >
                                  All roles · {CH_LABEL[e.defaultCh]}
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link
                          href={`/admin/events/${e.key}`}
                          className="sx-btn evt-cfg-btn"
                        >
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
    </>
  );
}
