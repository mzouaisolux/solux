// =====================================================================
// Event Registry — per-event detail (Step 1, m136). THE page.
//
// One screen that shows and configures the entire downstream life of a
// business event: identity, which roles consume it, and how each consumer
// (notification / dashboard / kpi / audit / automation) uses it. Config
// ROUTES; code PROJECTS — described/reserved consumers persist routing
// here but their projections are wired in code in later steps.
// =====================================================================

import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { isAdminLike, VIEW_AS_ROLES, ROLE_LABEL } from "@/lib/types";
import AccessDenied from "@/components/AccessDenied";
import { SubmitButton } from "@/components/SubmitButton";
import { NOTIFICATION_CATALOG } from "@/lib/notification-catalog";
import {
  CONSUMER_BY_KEY,
  NOTIFICATION_CHANNELS,
  DASHBOARD_SECTIONS,
  AUDIT_VISIBILITY,
  KPI_KEYS,
  resolveEventIdentity,
  indexRouting,
  type RoutingRow,
  type CatalogOverride,
  type ConsumerStatus,
} from "@/lib/event-registry";
import type { EventType } from "@/lib/events-shared";
import { saveEventConfig } from "../actions";

export const dynamic = "force-dynamic";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const CATEGORIES = ["workflow", "money", "production", "shipping", "crm", "governance", "bookkeeping"];

function StatusBadge({ status }: { status: ConsumerStatus }) {
  const tint =
    status === "live" ? "#dcfce7" : status === "described" ? "#e0e7ff" : "#f1f5f9";
  return (
    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: tint, color: "#334155", marginLeft: 8, verticalAlign: "middle" }}>
      {status}
    </span>
  );
}

/** Honest runtime-status note shown under a section. tone "ok" = enforced
 *  today; tone "warn" = stored but not consumed yet. Keeps the UI from
 *  implying that described/stored-only consumers act at runtime. */
function RuntimeNote({ tone = "warn", children }: { tone?: "ok" | "warn"; children: ReactNode }) {
  const c =
    tone === "ok"
      ? { bg: "#ecfdf5", bd: "#a7f3d0", fg: "#065f46" }
      : { bg: "#fffbeb", bd: "#fde68a", fg: "#92400e" };
  return (
    <p style={{ fontSize: 11.5, margin: "0 0 8px", padding: "5px 9px", borderRadius: 8, background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, lineHeight: 1.45 }}>
      {children}
    </p>
  );
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: { eventKey: string };
  searchParams: { saved?: string };
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
    if (error && /event_catalog_overrides|relation|does not exist/i.test(error.message ?? "")) tableMissing = true;
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

  // Current form values
  const reqActionValue =
    override?.requires_action === undefined ? "default" : override.requires_action ? "yes" : "no";
  const notifValue = (role: string) =>
    (idx.get(`notification:${role}`)?.config?.channel as string) ?? "default";
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

  const notifD = CONSUMER_BY_KEY["notification"];
  const dashD = CONSUMER_BY_KEY["dashboard"];
  const kpiD = CONSUMER_BY_KEY["kpi"];
  const auditD = CONSUMER_BY_KEY["audit"];
  const autoD = CONSUMER_BY_KEY["automation"];

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <section className="card sec ad-section">
          <div className="eyebrow">
            <Link href="/admin/events" style={{ color: "inherit" }}>Admin · Event Registry</Link> ·{" "}
            {identity.category}
          </div>
          <h2 className="ad-doc-title">
            {identity.icon ? `${identity.icon} ` : ""}
            {identity.label}
          </h2>
          <p className="ad-lead" style={{ marginBottom: 4 }}>
            <code>{eventKey}</code> — configure this event&apos;s whole downstream life. Events are
            emitted from code; here you set <b>routing &amp; presentation</b> only.
          </p>

          {searchParams?.saved && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-[13px] text-emerald-900" style={{ marginTop: 8 }}>
              ✓ Saved.
            </div>
          )}
          {tableMissing && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900" style={{ marginTop: 8 }}>
              ⚠ Registry tables missing — apply <code>136_event_registry.sql</code>. The form below
              shows code defaults and cannot save until the migration is applied.
            </div>
          )}

          <form action={saveEventConfig} style={{ marginTop: 14, display: "grid", gap: 16 }}>
            <input type="hidden" name="event_key" value={eventKey} />

            {/* ---------------- Identity ---------------- */}
            <fieldset style={{ border: "1px solid var(--sx-line-2, #e5e7eb)", borderRadius: 12, padding: 14 }}>
              <legend style={{ fontWeight: 700, fontSize: 13, padding: "0 6px" }}>Identity</legend>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ fontSize: 12 }}>
                  Label
                  <input name="id__label" defaultValue={override?.label ?? base.label} className="sx-input" style={{ width: "100%" }} />
                  <span style={{ color: "#a1a1aa" }}>code default: {base.label}</span>
                </label>
                <label style={{ fontSize: 12 }}>
                  Icon (emoji)
                  <input name="id__icon" defaultValue={override?.icon ?? ""} placeholder="(none)" className="sx-input" style={{ width: "100%" }} />
                </label>
                <label style={{ fontSize: 12, gridColumn: "1 / -1" }}>
                  Description
                  <textarea name="id__description" defaultValue={override?.description ?? ""} rows={2} placeholder="Optional — what this event represents." className="sx-input" style={{ width: "100%" }} />
                </label>
                <label style={{ fontSize: 12 }}>
                  Category
                  <select name="id__category" defaultValue={override?.category ?? base.category} className="sx-input" style={{ width: "100%" }}>
                    {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>
                  Severity <span style={{ color: "#a1a1aa" }}>(stored only — emitted events still use code-defined severity)</span>
                  <select name="id__severity" defaultValue={override?.severity ?? base.severity} className="sx-input" style={{ width: "100%" }}>
                    {SEVERITIES.map((s) => (<option key={s} value={s}>{s}</option>))}
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>
                  Requires action <span style={{ color: "#a1a1aa" }}>(stored only — not used at runtime yet)</span>
                  <select name="id__requires_action" defaultValue={reqActionValue} className="sx-input" style={{ width: "100%" }}>
                    <option value="default">— default ({resolveEventIdentity(typedKey, null).requiresAction ? "yes" : "no"})</option>
                    <option value="yes">yes</option>
                    <option value="no">no</option>
                  </select>
                </label>
                <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8, marginTop: 18 }}>
                  <input type="checkbox" name="id__enabled" defaultChecked={identity.enabled} />
                  Enabled <span style={{ color: "#a1a1aa" }}>(stored — does not block emission yet)</span>
                </label>
              </div>
            </fieldset>

            {/* ---------------- Notification (live, per role) ---------------- */}
            <fieldset style={{ border: "1px solid var(--sx-line-2, #e5e7eb)", borderRadius: 12, padding: 14 }}>
              <legend style={{ fontWeight: 700, fontSize: 13, padding: "0 6px" }}>
                {notifD.icon} {notifD.label}
                <StatusBadge status={notifD.status} />
              </legend>
              <p style={{ fontSize: 12, color: "#71717a", margin: "0 0 8px" }}>{notifD.description}</p>
              <RuntimeNote tone="ok">Notification routing is currently enforced by the bell/feed.</RuntimeNote>
              <RuntimeNote tone="warn"><b>Super admin</b> and <b>Admin</b> are separate notification channels. Configuring Admin does not automatically include Super admin.</RuntimeNote>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                {VIEW_AS_ROLES.map((role) => (
                  <label key={role} style={{ fontSize: 12 }}>
                    {ROLE_LABEL[role]}
                    <select name={`notification__${role}`} defaultValue={notifValue(role)} className="sx-input" style={{ width: "100%" }}>
                      {NOTIFICATION_CHANNELS.map((ch) => (<option key={ch.value} value={ch.value}>{ch.label}</option>))}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* ---------------- Dashboard (described, per role) ---------------- */}
            <fieldset style={{ border: "1px solid var(--sx-line-2, #e5e7eb)", borderRadius: 12, padding: 14 }}>
              <legend style={{ fontWeight: 700, fontSize: 13, padding: "0 6px" }}>
                {dashD.icon} {dashD.label}
                <StatusBadge status={dashD.status} />
              </legend>
              <p style={{ fontSize: 12, color: "#71717a", margin: "0 0 8px" }}>{dashD.description}</p>
              <RuntimeNote tone="warn">Dashboard routing is stored but not consumed yet.</RuntimeNote>
              <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
                Section
                <select name="dashboard__section" defaultValue={dashSection} className="sx-input" style={{ maxWidth: 240, display: "block" }}>
                  {DASHBOARD_SECTIONS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
                </select>
              </label>
              <div style={{ fontSize: 12, marginBottom: 4 }}>Visible on the dashboard of:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {VIEW_AS_ROLES.map((role) => (
                  <label key={role} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                    <input type="checkbox" name={`dashboard_role__${role}`} defaultChecked={dashChecked(role)} />
                    {ROLE_LABEL[role]}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* ---------------- KPI (described, global) ---------------- */}
            <fieldset style={{ border: "1px solid var(--sx-line-2, #e5e7eb)", borderRadius: 12, padding: 14 }}>
              <legend style={{ fontWeight: 700, fontSize: 13, padding: "0 6px" }}>
                {kpiD.icon} {kpiD.label}
                <StatusBadge status={kpiD.status} />
              </legend>
              <p style={{ fontSize: 12, color: "#71717a", margin: "0 0 8px" }}>{kpiD.description}</p>
              <RuntimeNote tone="warn">KPI routing is stored but not consumed yet.</RuntimeNote>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {KPI_KEYS.map((k) => (
                  <label key={k.value} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                    <input type="checkbox" name={`kpi__${k.value}`} defaultChecked={kpiSelected.has(k.value)} />
                    {k.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* ---------------- Audit (live, global) ---------------- */}
            <fieldset style={{ border: "1px solid var(--sx-line-2, #e5e7eb)", borderRadius: 12, padding: 14 }}>
              <legend style={{ fontWeight: 700, fontSize: 13, padding: "0 6px" }}>
                {auditD.icon} {auditD.label}
                <StatusBadge status={auditD.status} />
              </legend>
              <p style={{ fontSize: 12, color: "#71717a", margin: "0 0 8px" }}>{auditD.description}</p>
              <RuntimeNote tone="warn">Audit visibility is stored but not consumed yet. Events remain internally audited.</RuntimeNote>
              <label style={{ fontSize: 12 }}>
                Visibility
                <select name="audit__visibility" defaultValue={auditVis} className="sx-input" style={{ maxWidth: 280, display: "block" }}>
                  {AUDIT_VISIBILITY.map((v) => (<option key={v.value} value={v.value}>{v.label}</option>))}
                </select>
              </label>
            </fieldset>

            {/* ---------------- Automations (reserved) ---------------- */}
            <fieldset style={{ border: "1px dashed var(--sx-line-2, #e5e7eb)", borderRadius: 12, padding: 14, opacity: 0.6 }}>
              <legend style={{ fontWeight: 700, fontSize: 13, padding: "0 6px" }}>
                {autoD.icon} {autoD.label}
                <StatusBadge status={autoD.status} />
              </legend>
              <p style={{ fontSize: 12, color: "#71717a", margin: 0 }}>{autoD.description}</p>
            </fieldset>

            <div className="ad-matrix-savebar">
              <span className="note">Only non-default values are stored. Defaults = today&apos;s behavior.</span>
              <SubmitButton variant="ghost" className="sx-btn sx-btn-go" pendingLabel="Saving…">
                Save event configuration
              </SubmitButton>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
