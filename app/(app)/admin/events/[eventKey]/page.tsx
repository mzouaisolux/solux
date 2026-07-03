// =====================================================================
// Event Registry — per-event detail (m136). Conservative redesign:
// re-prioritised around what is LIVE today. Order is now
//   Notification (live, primary) → Future projections (stored only,
//   collapsed) → Metadata & advanced (collapsed) → save footer.
// Config ROUTES; code PROJECTS. No runtime/model/DB change here — this
// pass only reorganises hierarchy, wording and guardrails. Field names
// are unchanged so saveEventConfig behaves exactly as before.
// =====================================================================

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { isAdminLike, VIEW_AS_ROLES, ROLE_LABEL } from "@/lib/types";
import AccessDenied from "@/components/AccessDenied";
import { NOTIFICATION_CATALOG, defaultChannel } from "@/lib/notification-catalog";
import {
  NOTIFICATION_CHANNELS,
  DASHBOARD_SECTIONS,
  AUDIT_VISIBILITY,
  KPI_KEYS,
  resolveEventIdentity,
  indexRouting,
  type RoutingRow,
  type CatalogOverride,
} from "@/lib/event-registry";
import type { EventType } from "@/lib/events-shared";
import { getEventHelp } from "@/lib/event-help";
import { saveEventConfig, resetEventConfig } from "../actions";
import NotificationConfig from "./NotificationConfig";
import EventConfigFooter from "./EventConfigFooter";
import EventHelp from "../EventHelp";
import { EvtIcon } from "../EvtIcons";

export const dynamic = "force-dynamic";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const CATEGORIES = [
  "workflow",
  "money",
  "production",
  "shipping",
  "crm",
  "governance",
  "bookkeeping",
];

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: { eventKey: string };
  searchParams: { saved?: string; reset?: string };
}) {
  const { effectiveRole } = await getEffectiveRole();
  if (!isAdminLike(effectiveRole)) {
    return <AccessDenied message="Event registry is admin-only." />;
  }

  const eventKey = decodeURIComponent(params.eventKey);
  if (!(eventKey in NOTIFICATION_CATALOG)) notFound();
  const typedKey = eventKey as EventType;
  const base = NOTIFICATION_CATALOG[typedKey];

  const supabase = createClient();
  let override: CatalogOverride | null = null;
  let routingRows: RoutingRow[] = [];
  let tableMissing = false;
  {
    const { data, error } = await supabase
      .from("event_catalog_overrides")
      .select("*")
      .eq("event_key", eventKey)
      .maybeSingle();
    if (error && /event_catalog_overrides|relation|does not exist/i.test(error.message ?? ""))
      tableMissing = true;
    else override = (data as CatalogOverride | null) ?? null;
  }
  {
    const { data, error } = await supabase
      .from("event_routing")
      .select("event_key, consumer, role, config, enabled")
      .eq("event_key", eventKey);
    if (error) tableMissing = true;
    else routingRows = (data ?? []) as RoutingRow[];
  }

  const idx = indexRouting(routingRows);
  const identity = resolveEventIdentity(typedKey, override);
  const isCritical = identity.severity === "critical";
  const hasConfig =
    (!!override && Object.keys(override).length > 0) || routingRows.length > 0;
  // What "inherit" resolves to WHEN enabled (code severity, role-independent).
  const baselineChannel = defaultChannel(typedKey, base.severity);
  // Opt-in master switch: notifications are ON only when the master role='*'
  // routing row exists and isn't disabled. Absent ⇒ disabled (the default).
  const masterRow = idx.get("notification:*");
  const notifyEnabled = !!masterRow && masterRow.enabled !== false;
  const help = getEventHelp(eventKey);

  // ---- current form values ----
  const reqActionValue =
    override?.requires_action === undefined
      ? "default"
      : override.requires_action
        ? "yes"
        : "no";
  const notifValues: Record<string, string> = {};
  for (const role of VIEW_AS_ROLES) {
    notifValues[role] =
      (idx.get(`notification:${role}`)?.config?.channel as string) ?? "default";
  }
  const dashChecked = (role: string) => idx.has(`dashboard:${role}`);
  const dashSection = (() => {
    for (const role of VIEW_AS_ROLES) {
      const r = idx.get(`dashboard:${role}`);
      if (r?.config?.section) return r.config.section as string;
    }
    return DASHBOARD_SECTIONS[0].value;
  })();
  const kpiSelected = new Set<string>(
    (idx.get("kpi:*")?.config?.kpis as string[] | undefined) ?? []
  );
  const auditVis = (idx.get("audit:*")?.config?.visibility as string) ?? "visible";

  const notifRoles = VIEW_AS_ROLES.map((role) => ({
    role,
    label: ROLE_LABEL[role],
  }));

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <section className="card sec ad-section">
          {/* ---------------- Header ---------------- */}
          <div className="eyebrow">
            <Link href="/admin/events" style={{ color: "inherit" }}>
              Admin · Event Registry
            </Link>{" "}
            · {identity.category}
          </div>
          <h2 className="ad-doc-title evt-title-row">
            <span>
              {identity.icon ? `${identity.icon} ` : ""}
              {identity.label}
            </span>
            {help && <EventHelp title={identity.label} help={help} />}
          </h2>
          <div className="evt-head-meta">
            <code>{eventKey}</code>
            <span className="evt-head-chip">category · {identity.category}</span>
            <span className="evt-head-chip">
              severity · {base.severity}{" "}
              <span className="evt-muted">(code-defined)</span>
            </span>
            {hasConfig && <span className="evt-head-chip mod">Modified</span>}
          </div>
          <p className="ad-lead" style={{ marginBottom: 4 }}>
            Events are emitted from code. This page configures{" "}
            <b>routing &amp; presentation</b> only.
          </p>

          {searchParams?.saved && (
            <div className="evt-flash ok" role="status">
              ✓ Configuration saved.{" "}
              {notifyEnabled
                ? "Notifications are enabled and take effect immediately."
                : "Notifications stay disabled — this event notifies no one."}
            </div>
          )}
          {searchParams?.reset && (
            <div className="evt-flash ok" role="status">
              ↩ Reset to default behavior. All overrides for this event were
              removed.
            </div>
          )}
          {tableMissing && (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900"
              style={{ marginTop: 8 }}
            >
              ⚠ Registry tables missing — apply <code>136_event_registry.sql</code>.
              The form below shows code defaults and cannot save until the
              migration is applied.
            </div>
          )}
          {isCritical && (
            <div className="evt-crit-banner" role="note">
              <div>
                <b>Critical event.</b>{" "}
                {notifyEnabled ? (
                  <>
                    Be careful when muting notifications for{" "}
                    <b>Super admin</b> or <b>Admin</b> — they would stop being
                    alerted when this happens.
                  </>
                ) : (
                  <>
                    It is currently <b>disabled</b>, so no one is alerted when
                    it happens. Consider enabling it for <b>Super admin</b> /{" "}
                    <b>Admin</b>.
                  </>
                )}
              </div>
            </div>
          )}

          <form action={saveEventConfig} className="evt-form">
            <input type="hidden" name="event_key" value={eventKey} />

            {/* ---------------- B. Notification (live, primary, opt-in) ----- */}
            <div className="evt-section evt-section-primary">
              <div className="evt-section-head">
                <EvtIcon name="bell" size={17} />
                <span className="evt-section-title">Notifications</span>
              </div>
              <p className="evt-section-sub">
                Notifications are <b>off by default</b>. Enable this event to
                notify people; bell / feed routing then takes effect
                immediately.
              </p>
              <NotificationConfig
                roles={notifRoles}
                channels={NOTIFICATION_CHANNELS as unknown as { value: string; label: string }[]}
                values={notifValues}
                isCritical={isCritical}
                defaultChannel={baselineChannel}
                initialEnabled={notifyEnabled}
              />
            </div>

            {/* ---------------- C. Future projections (stored only) --------- */}
            <details className="evt-details evt-future">
              <summary className="evt-summary">
                <span className="evt-summary-title">Future projections</span>
                <span className="evt-leg-badge store">Stored only</span>
                <span className="evt-summary-hint">
                  Dashboard · KPI · Audit — saved, no runtime effect yet
                </span>
                <span className="evt-summary-chev" aria-hidden>
                  ▸
                </span>
              </summary>
              <div className="evt-details-body">
                <p className="evt-plan-note">
                  <b>Planned capability.</b> Stored now, not consumed by runtime
                  yet — saving these has no effect today.
                </p>

                {/* Dashboard */}
                <div className="evt-sub">
                  <div className="evt-sub-h">
                    <EvtIcon name="dashboard" size={14} /> Dashboard
                  </div>
                  <label className="evt-field">
                    Section
                    <select
                      name="dashboard__section"
                      defaultValue={dashSection}
                      className="sx-input"
                      style={{ maxWidth: 240, display: "block" }}
                    >
                      {DASHBOARD_SECTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="evt-field-label">Visible on the dashboard of:</div>
                  <div className="evt-checks">
                    {VIEW_AS_ROLES.map((role) => (
                      <label key={role} className="evt-check">
                        <input
                          type="checkbox"
                          name={`dashboard_role__${role}`}
                          defaultChecked={dashChecked(role)}
                        />
                        {ROLE_LABEL[role]}
                      </label>
                    ))}
                  </div>
                </div>

                {/* KPI */}
                <div className="evt-sub">
                  <div className="evt-sub-h">
                    <EvtIcon name="kpi" size={14} /> KPI / Counters
                  </div>
                  <div className="evt-checks">
                    {KPI_KEYS.map((k) => (
                      <label key={k.value} className="evt-check">
                        <input
                          type="checkbox"
                          name={`kpi__${k.value}`}
                          defaultChecked={kpiSelected.has(k.value)}
                        />
                        {k.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Audit */}
                <div className="evt-sub">
                  <div className="evt-sub-h">
                    <EvtIcon name="audit" size={14} /> Audit visibility
                  </div>
                  <p className="evt-muted" style={{ margin: "0 0 8px" }}>
                    Every event is always internally audited. This
                    Visible/Internal toggle is not enforced yet.
                  </p>
                  <label className="evt-field">
                    Visibility
                    <select
                      name="audit__visibility"
                      defaultValue={auditVis}
                      className="sx-input"
                      style={{ maxWidth: 280, display: "block" }}
                    >
                      {AUDIT_VISIBILITY.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <p className="evt-future-foot">
                  <EvtIcon name="automation" size={13} /> Automations (reminders,
                  escalations) are a separate future subsystem — not configurable
                  yet.
                </p>
              </div>
            </details>

            {/* ---------------- D. Metadata & advanced ---------------------- */}
            <details className="evt-details evt-meta">
              <summary className="evt-summary">
                <span className="evt-summary-title">Metadata &amp; advanced</span>
                <span className="evt-summary-hint">
                  Label, icon, description, category — plus stored-only fields
                </span>
                <span className="evt-summary-chev" aria-hidden>
                  ▸
                </span>
              </summary>
              <div className="evt-details-body">
                <div className="evt-grid2">
                  <label className="evt-field">
                    Label
                    <input
                      name="id__label"
                      defaultValue={override?.label ?? base.label}
                      className="sx-input"
                      style={{ width: "100%" }}
                    />
                    <span className="evt-muted">code default: {base.label}</span>
                  </label>
                  <label className="evt-field">
                    Icon (emoji)
                    <input
                      name="id__icon"
                      defaultValue={override?.icon ?? ""}
                      placeholder="(none)"
                      className="sx-input"
                      style={{ width: "100%" }}
                    />
                  </label>
                  <label className="evt-field" style={{ gridColumn: "1 / -1" }}>
                    Description
                    <textarea
                      name="id__description"
                      defaultValue={override?.description ?? ""}
                      rows={2}
                      placeholder="Optional — what this event represents."
                      className="sx-input"
                      style={{ width: "100%" }}
                    />
                  </label>
                  <label className="evt-field">
                    Category
                    <select
                      name="id__category"
                      defaultValue={override?.category ?? base.category}
                      className="sx-input"
                      style={{ width: "100%" }}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Stored-only metadata — clearly walled off. */}
                <div className="evt-stored-box">
                  <div className="evt-stored-head">
                    <span className="evt-leg-badge store">Metadata only</span>
                    These do not affect emitted events yet.
                  </div>
                  <div className="evt-grid2">
                    <label className="evt-field">
                      Severity
                      <select
                        name="id__severity"
                        defaultValue={override?.severity ?? base.severity}
                        className="sx-input evt-stored-input"
                        style={{ width: "100%" }}
                      >
                        {SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <span className="evt-muted">
                        Emitted events use the code-defined severity.
                      </span>
                    </label>
                    <label className="evt-field">
                      Requires action
                      <select
                        name="id__requires_action"
                        defaultValue={reqActionValue}
                        className="sx-input evt-stored-input"
                        style={{ width: "100%" }}
                      >
                        <option value="default">
                          — default ({resolveEventIdentity(typedKey, null).requiresAction ? "yes" : "no"})
                        </option>
                        <option value="yes">yes</option>
                        <option value="no">no</option>
                      </select>
                      <span className="evt-muted">Not used at runtime yet.</span>
                    </label>
                  </div>
                  <label className="evt-enabled">
                    <input
                      type="checkbox"
                      name="id__enabled"
                      defaultChecked={identity.enabled}
                    />
                    <span>
                      <b>Enabled</b>
                      <span className="evt-enabled-note">
                        Metadata only — unchecking does not block the event from
                        being emitted.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            </details>

            {/* ---------------- E. Save footer ------------------------------ */}
            <EventConfigFooter
              resetAction={resetEventConfig}
              isCritical={isCritical}
              hasConfig={hasConfig}
            />
          </form>
        </section>
      </div>
    </div>
  );
}
