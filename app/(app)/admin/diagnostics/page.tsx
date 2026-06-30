import {
  hasUiCapability,
  requireCapability,
} from "@/lib/permissions";
import Link from "next/link";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@/lib/supabase/server";
import AccessDenied from "@/components/AccessDenied";
import { HealthSection } from "./HealthSection";
import { MigrationsSection } from "./MigrationsSection";
import { LifecycleSection } from "./LifecycleSection";
import { InspectorSection } from "./InspectorSection";
import { SettingsSection } from "./SettingsSection";
import { PREVENTIVE_DAYS_KEY, PREVENTIVE_DAYS_DEFAULT } from "@/lib/app-settings";

/**
 * Super-admin diagnostics page.
 *
 * Goal
 * ----
 * One place for super-admins to answer "is the system healthy?" and
 * "why is THIS specific entity in THIS state?" without writing SQL.
 *
 * Sections (built progressively across étape 5)
 * --------------------------------------------
 *   5.B — Health counters
 *     Cross-table counts of broken/orphan/drift states:
 *       - Task lists won w/o linked PO
 *       - Docs won w/o linked task list
 *       - POs past current_production_deadline + non-terminal status
 *       - Lifecycle mismatches (doc cancelled vs TL active, etc.)
 *       - Clients archived with active POs
 *       - Users without role assignment
 *
 *   5.C — Lifecycle diagram
 *     Static SVG / DOM rendering of the canonical state machine,
 *     read from lib/lifecycle.ts so doc == truth. Surfaces the legal
 *     transitions per entity type so we can spot anyone trying to
 *     reach an illegal state.
 *
 *   5.D — Entity inspector
 *     Paste an ID, get back:
 *       - the row across all the tables that reference it
 *       - its event timeline
 *       - the RLS filters that apply to it for a chosen role
 *       - the capabilities that would gate each action
 *
 * Gating
 * ------
 *   - Route: hasUiCapability("admin.diagnostics") + requireCapability().
 *     Default: super-admin only (migration 033). The matrix lets the
 *     super-admin grant it to admin / TLM later if desired.
 *   - Tab: filtered server-side in /admin/layout.tsx so non-eligible
 *     users don't even see "Diagnostics" in the admin nav.
 */
export default async function DiagnosticsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  // Page-level gates (View-As faithful + real-role enforcement).
  // Same capability the Diagnostics tab uses — no silent dashboard redirect.
  const canSeePage = await hasUiCapability("admin.diagnostics");
  if (!canSeePage) return <AccessDenied capability="admin.diagnostics" />;
  await requireCapability("admin.diagnostics");

  // ----- Health counters (5.B) -----
  // Single RPC round-trip returns counts + up to 10 sample offenders
  // per category. Defensive: if migration 034 isn't applied yet, the
  // RPC errors and we surface a clean fallback instead of crashing
  // the whole diagnostics page.
  const supabase = createClient();
  // Perf (2026-06-12): the three data sources (health counters, migration
  // probes, ledger) are independent — ONE parallel wave instead of three
  // stacked ~110 ms cloud round trips.
  const [healthRpc, probesRpc, ledgerRes, settingsProbe] = await Promise.all([
    supabase.rpc("admin_diagnostics_health"),
    supabase.rpc("admin_migration_probes"),
    supabase
      .from("schema_migrations")
      .select("filename, applied_at")
      .order("filename", { ascending: true }),
    // m120 — product settings (defensive: section shows an apply hint pre-m120)
    supabase.from("app_settings").select("key, value").eq("key", PREVENTIVE_DAYS_KEY).maybeSingle(),
  ]);
  const settingsAvailable = !settingsProbe.error;
  const preventiveDays = settingsProbe.error
    ? PREVENTIVE_DAYS_DEFAULT
    : (() => {
        const v = (settingsProbe.data?.value as any)?.value ?? settingsProbe.data?.value;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : PREVENTIVE_DAYS_DEFAULT;
      })();
  const healthPayload = (healthRpc.data as any) ?? null;
  const healthError = healthRpc.error
    ? healthRpc.error.code === "42883"
      ? "RPC admin_diagnostics_health() is not deployed. Apply migration 034 in Supabase and reload."
      : healthRpc.error.message
    : null;

  // ----- Migrations registry (m113, audit P0) -----
  // Probes answer "is this migration's artifact live in THIS database?"
  // Ledger tracks applications from m113 onward. Both defensive: if
  // m113 isn't applied yet the section renders an instruction callout.
  const probes = Array.isArray(probesRpc.data) ? (probesRpc.data as any[]) : null;
  const probesError = probesRpc.error
    ? probesRpc.error.code === "42883"
      ? "RPC admin_migration_probes() is not deployed. Apply migration 113_schema_migrations_ledger.sql in Supabase and reload."
      : probesRpc.error.message
    : null;

  const ledger = ledgerRes.error ? null : ((ledgerRes.data as any[]) ?? []);
  const ledgerError = ledgerRes.error
    ? /schema_migrations/.test(ledgerRes.error.message ?? "")
      ? "schema_migrations table missing — apply migration 113 in Supabase."
      : ledgerRes.error.message
    : null;

  // Migration files shipped with THIS build of the code (dev: the repo's
  // supabase/migrations folder). Best-effort — serverless bundles may not
  // include the folder, in which case the disk comparison is simply
  // omitted and probes + ledger still render.
  let diskFiles: string[] | null = null;
  try {
    diskFiles = readdirSync(join(process.cwd(), "supabase", "migrations"))
      .filter((f) => /^\d{3}_.+\.sql$/.test(f))
      .sort();
  } catch {
    diskFiles = null;
  }

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <section className="card sec ad-section">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div>
              <div className="eyebrow">Admin · Diagnostics</div>
              <h2 className="ad-doc-title">System health &amp; entity inspector</h2>
              <p className="ad-lead">
                Cross-table sanity checks, the canonical lifecycle diagram, and a per-entity inspector for
                debugging operational issues without writing SQL. Super-admin only by default — adjust in the
                permissions matrix if other roles need access.
              </p>
            </div>
            {/* Dev reset entry point — discoverable but discreet. The destructive
                page lives at a sub-route so a misnavigation here doesn't even get
                the user near the wipe button. */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/admin/diagnostics/tender-merge" className="sx-btn sx-btn-sm">
                Tender duplicates (dry-run)
              </Link>
              <Link href="/admin/diagnostics/reset" className="sx-btn sx-btn-danger sx-btn-sm">
                ⚠ Dev reset
              </Link>
            </div>
          </div>

          {/* SECTION 1 — Health counters (étape 5.B) — LIVE */}
          <HealthSection payload={healthPayload} error={healthError} />

          {/* SECTION 1b — Migrations registry (m113, audit P0) — LIVE */}
          <MigrationsSection
            probes={probes as any}
            probesError={probesError}
            ledger={ledger as any}
            ledgerError={ledgerError}
            diskFiles={diskFiles}
          />

          {/* SECTION 1c — Product settings (m120, Phase 2 dashboard) */}
          <SettingsSection preventiveDays={preventiveDays} available={settingsAvailable} />

          {/* SECTION 2 — Lifecycle diagram (étape 5.C) — LIVE */}
          <LifecycleSection />

          {/* SECTION 3 — Entity inspector (étape 5.D) — LIVE */}
          <InspectorSection q={searchParams?.q ?? null} />
        </section>
      </div>
    </div>
  );
}
