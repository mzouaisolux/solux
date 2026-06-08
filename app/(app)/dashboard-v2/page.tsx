import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import KpiCard from "@/components/dashboard/KpiCard";
import { ActionCenterV2 } from "@/components/action-center/ActionCenterV2";
import { getActionCenterV2, DOC_ACTIVE_STATUSES } from "@/lib/action-center";

/**
 * Dashboard V2 — EXPERIMENTAL (beta). Non-destructive: lives at its own route
 * alongside the classic /dashboard so the two philosophies can be compared.
 *
 * Keeps the Operations / Business split (which was right), but rebuilds the
 * Operations side as an ACTION CENTER — derived, prioritized, self-clearing —
 * instead of widgets + feeds. The Business side keeps the forecast/KPI view.
 *
 * Reversible: delete this folder + its nav link to remove entirely. Nothing
 * in the classic dashboard is touched.
 */

type Tab = "operations" | "business";

export default async function DashboardV2Page({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab: Tab = searchParams?.tab === "business" ? "business" : "operations";
  const { userId, effectiveRole: role } = await getEffectiveRole();

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-5">
      {/* Header + beta marker */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="eyebrow">Dashboard</span>
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
              Beta · V2
            </span>
          </div>
          <h1 className="doc-title mt-1">What needs you now</h1>
          <p className="text-xs text-neutral-500 mt-2 max-w-xl">
            An experiment: actions instead of widgets. Each item is something to
            do — it appears when it's needed and disappears once handled. Compare
            it with the{" "}
            <Link href="/dashboard" className="underline hover:text-neutral-700">
              classic dashboard
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Operations / Business tabs */}
      <div className="flex items-center gap-1 border-b border-neutral-200">
        <TabLink href="/dashboard-v2?tab=operations" active={tab === "operations"}>
          Operations
        </TabLink>
        <TabLink href="/dashboard-v2?tab=business" active={tab === "business"}>
          Business
        </TabLink>
      </div>

      {tab === "operations" ? (
        <OperationsTab userId={userId} role={role} />
      ) : (
        <BusinessTab />
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-4 py-2 text-sm ${
        active
          ? "border-neutral-900 text-neutral-900 font-semibold"
          : "border-transparent text-neutral-500 hover:text-neutral-900"
      }`}
    >
      {children}
    </Link>
  );
}

/* ---------------- OPERATIONS (Action Center) ---------------- */

async function OperationsTab({
  userId,
  role,
}: {
  userId: string | null;
  role: Awaited<ReturnType<typeof getEffectiveRole>>["effectiveRole"];
}) {
  const data = await getActionCenterV2(userId, role);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span className="tabular-nums font-medium text-neutral-700">
          {data.actionCount}
        </span>{" "}
        to do
        {data.followupCount > 0 && (
          <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            {data.followupCount} to follow up
          </span>
        )}
      </div>
      <ActionCenterV2 data={data} />
    </div>
  );
}

/* ---------------- BUSINESS (forecast / KPI) ---------------- */

async function BusinessTab() {
  const supabase = createClient();
  // RLS scopes this to what the viewer may see (sales = own; technical = all).
  const { data: docs } = await supabase
    .from("documents")
    .select("status, total_price, currency")
    .limit(5000);

  let pipeline = 0;
  let won = 0;
  let activeCount = 0;
  let wonCount = 0;
  for (const d of (docs ?? []) as any[]) {
    const v = Number(d.total_price || 0);
    if (DOC_ACTIVE_STATUSES.includes(d.status)) {
      pipeline += v;
      activeCount++;
    } else if (d.status === "won") {
      won += v;
      wonCount++;
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label="Active pipeline"
          value={money(pipeline)}
          featured
        />
        <KpiCard label="Won (value)" value={money(won)} />
        <KpiCard
          label="Active deals"
          value={`${activeCount}`}
        />
      </div>
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="text-xs text-neutral-500">
          This tab keeps the commercial-visibility philosophy (forecast,
          pipeline, KPIs, risks). For the full breakdown use{" "}
          <Link href="/forecast" className="underline hover:text-neutral-700">
            Forecast
          </Link>{" "}
          and{" "}
          <Link href="/business" className="underline hover:text-neutral-700">
            Business
          </Link>
          . We'll progressively decide what belongs here vs. the classic view.
        </p>
      </div>
    </div>
  );
}

function money(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "$0";
  const abs = Math.abs(v);
  if (abs >= 1_000_000)
    return `$${(v / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
  if (abs >= 1_000)
    return `$${(v / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
