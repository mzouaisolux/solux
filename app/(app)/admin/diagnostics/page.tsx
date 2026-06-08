import {
  hasUiCapability,
  requireCapability,
} from "@/lib/permissions";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import AccessDenied from "@/components/AccessDenied";
import { HealthSection } from "./HealthSection";
import { LifecycleSection } from "./LifecycleSection";
import { InspectorSection } from "./InspectorSection";

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
  const healthRpc = await supabase.rpc("admin_diagnostics_health");
  const healthPayload = (healthRpc.data as any) ?? null;
  const healthError = healthRpc.error
    ? healthRpc.error.code === "42883"
      ? "RPC admin_diagnostics_health() is not deployed. Apply migration 034 in Supabase and reload."
      : healthRpc.error.message
    : null;

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Admin · Diagnostics</div>
          <h1 className="doc-title mt-1">System health &amp; entity inspector</h1>
          <p className="text-xs text-neutral-500 mt-2 max-w-2xl">
            Cross-table sanity checks, the canonical lifecycle diagram, and
            a per-entity inspector for debugging operational issues
            without writing SQL. Super-admin only by default — adjust in
            the permissions matrix if other roles need access.
          </p>
        </div>
        {/* Dev reset entry point — discoverable but discreet. The
            destructive page lives at a sub-route so a misnavigation
            here doesn't even get the user near the wipe button. */}
        <Link
          href="/admin/diagnostics/reset"
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50/40 text-rose-700 hover:bg-rose-50 hover:border-rose-300 px-2.5 py-1 text-[11px] font-medium transition-colors"
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1 4h2v6H9V6Zm0 8h2v2H9v-2Z" />
          </svg>
          Dev reset
        </Link>
      </div>

      {/* SECTION 1 — Health counters (étape 5.B) — LIVE */}
      <HealthSection payload={healthPayload} error={healthError} />

      {/* SECTION 2 — Lifecycle diagram (étape 5.C) — LIVE */}
      <LifecycleSection />

      {/* SECTION 3 — Entity inspector (étape 5.D) — LIVE */}
      <InspectorSection q={searchParams?.q ?? null} />
    </div>
  );
}
