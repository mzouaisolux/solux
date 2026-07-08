import Link from "next/link";
import { canAccessOrAdmin } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import { loadForecastDeals, resolveOwnerLabels } from "@/lib/forecast-data";
import {
  loadForecastAuditEvents,
  loadClosedForecastDeals,
} from "@/lib/forecast-audit";
import {
  probabilityReliability,
  computeSlippage,
  computeRepBehavior,
  computeAmountVariation,
  MIN_CLOSED_FOR_BIAS,
  type RepBehavior,
} from "@/lib/forecast-insights";
import { FORECAST_STALE_DAYS, fmtMoney } from "@/lib/forecast";

export const dynamic = "force-dynamic";

/**
 * FORECAST BEHAVIOR ANALYTICS — /forecast/insights (management only).
 *
 * The management-side companion of /forecast: how reliable is the
 * pipeline, and how does each rep actually forecast? Built entirely on
 * the immutable audit trail (m158) + the current book:
 *
 *   - Probability reliability — win rate at each EXACT value (how many
 *     deals marked 80% actually closed won).
 *   - Closing-period slippage — how often expected close gets pushed.
 *   - Per-rep behavior — average marked probability vs. actual win
 *     rate → optimistic / conservative flags, volatility, staleness.
 *   - Recent forecast changes timeline.
 *
 * Access = capability `forecast.view_audit` (super_admin, admin,
 * sales_director by default). Sales users never see this page — their
 * forecast surface stays simple. The audit trail itself is additionally
 * protected by RLS, so even a broken gate leaks nothing.
 */
export default async function ForecastInsightsPage() {
  const allowed = await canAccessOrAdmin(["forecast.view_audit"]);
  if (!allowed) return <AccessDenied capability="forecast.view_audit" />;

  const [events, activeDeals, closedDeals] = await Promise.all([
    loadForecastAuditEvents(),
    loadForecastDeals(null),
    loadClosedForecastDeals(),
  ]);

  const reliability = probabilityReliability(closedDeals, events).filter(
    (r) => r.closed > 0
  );
  const slippage = computeSlippage(events);
  const reps = computeRepBehavior(activeDeals, closedDeals, events);
  const amountVar = computeAmountVariation(events);

  const ownerLabels = await resolveOwnerLabels(
    Array.from(
      new Set([
        ...reps.map((r) => r.ownerId),
        ...events.map((e) => e.changedBy ?? "").filter(Boolean),
      ])
    )
  );
  const label = (id: string | null) =>
    id ? ownerLabels.get(id) ?? id.slice(0, 8) + "…" : "—";

  const staleTotal = reps.reduce((s, r) => s + r.staleCount, 0);
  const recentEvents = events.slice(0, 50);
  const noHistory = events.length === 0;

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Forecast · Management</div>
          <h1 className="doc-title mt-1">Forecast behavior analytics</h1>
          <p className="text-xs text-neutral-500 mt-2 max-w-2xl">
            How the forecast evolves — probability reliability, closing
            slippage and per-rep behavior, computed from the append-only
            forecast audit trail. Management only; work-related forecast
            changes only.
          </p>
        </div>
        <Link
          href="/forecast"
          className="text-xs text-neutral-600 hover:text-neutral-900 underline underline-offset-2"
        >
          ← Back to forecast
        </Link>
      </div>

      {noHistory && (
        <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/50 px-6 py-8 text-center">
          <h2 className="text-sm font-semibold text-neutral-900">
            No audit history yet
          </h2>
          <p className="text-xs text-neutral-500 mt-2 max-w-md mx-auto">
            Forecast changes start being recorded once migration m158 is
            applied. From then on, every probability, amount, close-date
            and status change is captured automatically — this page fills
            up as the team works.
          </p>
        </div>
      )}

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Audit events"
          value={String(events.length)}
          hint="Immutable forecast changes recorded"
        />
        <Kpi
          label="Close dates pushed later"
          value={String(slippage.pushedLater)}
          hint={`${slippage.dealsWithSlippage} deal${
            slippage.dealsWithSlippage === 1 ? "" : "s"
          } slipped · ${slippage.pulledEarlier} pulled earlier`}
          accent={slippage.pushedLater > 0 ? "amber" : undefined}
        />
        <Kpi
          label="Amount changes"
          value={String(amountVar.changes)}
          hint={
            amountVar.changes > 0
              ? `${Math.round(
                  amountVar.totalAbsoluteChange
                ).toLocaleString()} total variation (face value)`
              : "No amount edits on forecasted deals"
          }
        />
        <Kpi
          label="Stale forecasts"
          value={String(staleTotal)}
          hint={`Active forecasts untouched ${FORECAST_STALE_DAYS}+ days`}
          accent={staleTotal > 0 ? "amber" : undefined}
        />
      </div>

      {/* Probability reliability */}
      <section className="panel overflow-hidden">
        <div className="px-5 py-3 border-b border-neutral-200">
          <h3 className="text-sm font-semibold text-neutral-900">
            Probability reliability
          </h3>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            For each exact probability value: how many closed deals carried
            it at close, and how many were actually won. A healthy book wins
            ~50% of its 50% deals.
          </p>
        </div>
        {reliability.length === 0 ? (
          <p className="px-5 py-6 text-xs text-neutral-400">
            No closed deals with a forecast yet — reliability appears once
            forecasted deals start closing (won or lost).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200 bg-neutral-50/60">
                  <th className="px-4 py-2 font-medium">Marked at</th>
                  <th className="px-4 py-2 font-medium text-right">Won</th>
                  <th className="px-4 py-2 font-medium text-right">Lost</th>
                  <th className="px-4 py-2 font-medium text-right">
                    Actual win rate
                  </th>
                  <th className="px-4 py-2 font-medium">vs. marked</th>
                </tr>
              </thead>
              <tbody>
                {reliability.map((r) => {
                  const rate = r.winRate == null ? null : r.winRate * 100;
                  const gap = rate == null ? null : rate - r.probability;
                  return (
                    <tr key={r.probability} className="border-b border-neutral-100">
                      <td className="px-4 py-2 font-medium tabular-nums text-neutral-900">
                        {r.probability}%
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                        {r.won}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-rose-700">
                        {r.lost}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium text-neutral-900">
                        {rate == null ? "—" : `${Math.round(rate)}%`}
                      </td>
                      <td className="px-4 py-2">
                        {gap == null ? (
                          <span className="text-neutral-300">—</span>
                        ) : Math.abs(gap) <= 10 ? (
                          <span className="text-[10px] text-neutral-500">
                            on target
                          </span>
                        ) : gap < 0 ? (
                          <span className="text-[10px] text-amber-700">
                            {Math.round(Math.abs(gap))} pts optimistic
                          </span>
                        ) : (
                          <span className="text-[10px] text-sky-700">
                            {Math.round(gap)} pts conservative
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Per-rep behavior */}
      <section className="panel overflow-hidden">
        <div className="px-5 py-3 border-b border-neutral-200">
          <h3 className="text-sm font-semibold text-neutral-900">
            Forecast accuracy by sales rep
          </h3>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Marked probability vs. actual outcome, volatility and slippage
            per rep. Optimistic = marks high, wins less; conservative =
            marks low, wins more. Flags need ≥ {MIN_CLOSED_FOR_BIAS} closed
            deals.
          </p>
        </div>
        {reps.length === 0 ? (
          <p className="px-5 py-6 text-xs text-neutral-400">
            No forecasted deals yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200 bg-neutral-50/60">
                  <th className="px-4 py-2 font-medium">Rep</th>
                  <th className="px-4 py-2 font-medium text-right">Active</th>
                  <th className="px-4 py-2 font-medium text-right">Avg prob.</th>
                  <th className="px-4 py-2 font-medium text-right">
                    At creation
                  </th>
                  <th className="px-4 py-2 font-medium text-right">
                    Before close
                  </th>
                  <th className="px-4 py-2 font-medium text-right">
                    Won / Lost
                  </th>
                  <th className="px-4 py-2 font-medium text-right">Win rate</th>
                  <th className="px-4 py-2 font-medium text-right">
                    Changes / deal
                  </th>
                  <th className="px-4 py-2 font-medium text-right">Slippage</th>
                  <th className="px-4 py-2 font-medium text-right">Stale</th>
                  <th className="px-4 py-2 font-medium">Read</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((r) => (
                  <tr key={r.ownerId} className="border-b border-neutral-100">
                    <td className="px-4 py-2 whitespace-nowrap font-medium text-neutral-900">
                      {label(r.ownerId)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.activeDeals}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {pct(r.avgProbability)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {pct(r.avgProbabilityAtCreation)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {pct(r.avgProbabilityBeforeClose)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                      <span className="text-emerald-700">{r.wonCount}</span>
                      {" / "}
                      <span className="text-rose-700">{r.lostCount}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {r.winRate == null ? "—" : `${Math.round(r.winRate * 100)}%`}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.probabilityChangesPerDeal == null
                        ? "—"
                        : r.probabilityChangesPerDeal.toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {r.slippageCount}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${
                        r.staleCount > 0 ? "text-amber-700" : ""
                      }`}
                    >
                      {r.staleCount}
                    </td>
                    <td className="px-4 py-2">
                      <BiasBadge rep={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent changes timeline */}
      <section className="panel overflow-hidden">
        <div className="px-5 py-3 border-b border-neutral-200">
          <h3 className="text-sm font-semibold text-neutral-900">
            Forecast changes timeline
          </h3>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            The {recentEvents.length} most recent audit events, newest first.
            Per-deal history lives in the History drawer on the forecast
            workspace.
          </p>
        </div>
        {recentEvents.length === 0 ? (
          <p className="px-5 py-6 text-xs text-neutral-400">No events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200 bg-neutral-50/60">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Deal</th>
                  <th className="px-4 py-2 font-medium">Client</th>
                  <th className="px-4 py-2 font-medium">Field</th>
                  <th className="px-4 py-2 font-medium">Change</th>
                  <th className="px-4 py-2 font-medium">By</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((e) => (
                  <tr key={e.id} className="border-b border-neutral-100">
                    <td
                      className="px-4 py-2 whitespace-nowrap tabular-nums text-neutral-500"
                      title={new Date(e.createdAt).toLocaleString()}
                    >
                      {new Date(e.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {e.documentId ? (
                        <Link
                          href={`/documents/${e.documentId}`}
                          className="font-medium text-neutral-900 hover:underline underline-offset-2"
                        >
                          {e.quotationNumber ?? e.documentId.slice(0, 8) + "…"}
                        </Link>
                      ) : (
                        e.quotationNumber ?? "—"
                      )}
                    </td>
                    <td className="px-4 py-2 max-w-[160px] truncate text-neutral-600">
                      {e.clientName ?? "—"}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-neutral-700">
                      {e.field.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums text-neutral-700">
                      {e.field === "amount" && e.oldAmount != null && e.newAmount != null
                        ? `${fmtMoney(e.oldAmount, e.currency ?? "USD")} → ${fmtMoney(
                            e.newAmount,
                            e.currency ?? "USD"
                          )}`
                        : `${e.oldValue ?? "—"} → ${e.newValue ?? "—"}`}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-neutral-600">
                      {label(e.changedBy)}
                      {e.changedByRole ? (
                        <span className="text-neutral-400"> · {e.changedByRole}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[9px] font-medium text-neutral-500">
                        {e.changeSource.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function Kpi({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "amber";
}) {
  return (
    <div className="panel p-4">
      <div className="eyebrow">{label}</div>
      <div
        className={`mt-2 text-2xl font-semibold tabular-nums leading-tight ${
          accent === "amber" ? "text-amber-700" : "text-neutral-900"
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-neutral-500 mt-1.5">{hint}</div>}
    </div>
  );
}

function BiasBadge({ rep }: { rep: RepBehavior }) {
  if (rep.bias == null) {
    return (
      <span className="text-[10px] text-neutral-300">
        needs {MIN_CLOSED_FOR_BIAS}+ closed
      </span>
    );
  }
  const pts = Math.round(Math.abs(rep.biasPoints ?? 0));
  if (rep.bias === "optimistic") {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
        Optimistic +{pts} pts
      </span>
    );
  }
  if (rep.bias === "conservative") {
    return (
      <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
        Conservative −{pts} pts
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
      Balanced
    </span>
  );
}

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}
