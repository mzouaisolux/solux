"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateQuotationForecast } from "@/app/(app)/documents/[id]/actions";
import { ForecastHistoryDrawer } from "@/components/forecast/ForecastHistoryDrawer";
import {
  ALLOWED_PROBABILITIES,
  PROBABILITY_OPTIONS,
  isAllowedProbability,
  isForecastStale,
  forecastAgeDays,
  weightedValue,
  fmtMoney,
  type ForecastProbability,
} from "@/lib/forecast";

/**
 * ForecastWorkspace — the operational heart of /forecast.
 *
 * Lists EVERY active quotation (sent / negotiating) and lets sales set
 * the forecast inline — probability dropdown (controlled values only)
 * and close date — without ever opening the quotation. Each change
 * auto-saves (optimistic local state + server action + router.refresh
 * to reconcile the KPIs above).
 *
 * This is deliberately a dense, grid-like data surface: fast scanning,
 * fast editing, zero navigation. The opposite of a CRM opportunity
 * form.
 *
 * `canViewAudit` (management only) adds a per-row History button that
 * opens the forecast audit trail drawer. Sales users never see it —
 * their surface stays simple.
 */

export type ForecastRow = {
  id: string;
  number: string | null;
  clientName: string | null;
  country: string | null;
  ownerLabel: string | null;
  total: number;
  currency: string;
  status: string;
  probability: ForecastProbability | null;
  expectedCloseDate: string | null;
  updatedAt: string | null;
};

type SortKey = "weighted" | "value" | "close" | "stale";

export function ForecastWorkspace({
  initialRows,
  showOwner,
  canViewAudit = false,
}: {
  initialRows: ForecastRow[];
  showOwner: boolean;
  canViewAudit?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ForecastRow[]>(initialRows);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [errorId, setErrorId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [sortKey, setSortKey] = useState<SortKey>("weighted");
  const [onlyUnset, setOnlyUnset] = useState(false);
  // Multi-select filter on EXACT probability values (spec: filter by
  // one or several exact probabilities — no ranges).
  const [probFilter, setProbFilter] = useState<Set<number>>(new Set());
  const [historyRow, setHistoryRow] = useState<ForecastRow | null>(null);

  const setSaving = (id: string, v: boolean) =>
    setSavingIds((s) => ({ ...s, [id]: v }));

  /** Patch one row locally + persist. Rolls back on failure. */
  const patchRow = (
    id: string,
    patch: Partial<ForecastRow>,
    formPatch: Record<string, string>
  ) => {
    const prev = rows.find((r) => r.id === id);
    if (!prev) return;
    setErrorId(null);
    setRows((rs) =>
      rs.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
    setSaving(id, true);

    const fd = new FormData();
    fd.set("id", id);
    for (const [k, v] of Object.entries(formPatch)) fd.set(k, v);

    startTransition(async () => {
      try {
        await updateQuotationForecast(fd);
        // Stamp the local updated_at so the stale indicator clears
        // immediately, matching what the server just wrote.
        setRows((rs) =>
          rs.map((r) =>
            r.id === id ? { ...r, updatedAt: new Date().toISOString() } : r
          )
        );
        router.refresh();
      } catch (e: any) {
        // Roll back to the previous row state.
        setRows((rs) => rs.map((r) => (r.id === id ? prev : r)));
        setErrorId(id);
      } finally {
        setSaving(id, false);
      }
    });
  };

  const onProbability = (id: string, value: string) => {
    const p = value === "" ? null : (Number(value) as ForecastProbability);
    patchRow(id, { probability: p }, { probability: value });
  };
  const onDate = (id: string, value: string) => {
    patchRow(id, { expectedCloseDate: value || null }, { expected_close_date: value });
  };

  const toggleProbFilter = (p: number) => {
    setProbFilter((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const visibleRows = useMemo(() => {
    let out = onlyUnset ? rows.filter((r) => r.probability == null) : rows;
    if (probFilter.size > 0) {
      out = out.filter(
        (r) => r.probability != null && probFilter.has(r.probability)
      );
    }
    out = [...out].sort((a, b) => {
      switch (sortKey) {
        case "value":
          return b.total - a.total;
        case "close": {
          const av = a.expectedCloseDate ?? "9999";
          const bv = b.expectedCloseDate ?? "9999";
          return av < bv ? -1 : av > bv ? 1 : 0;
        }
        case "stale": {
          const as = isForecastStale(a.updatedAt, a.probability != null) ? 1 : 0;
          const bs = isForecastStale(b.updatedAt, b.probability != null) ? 1 : 0;
          return bs - as;
        }
        case "weighted":
        default:
          return (
            weightedValue(b.total, b.probability) -
            weightedValue(a.total, a.probability)
          );
      }
    });
    return out;
  }, [rows, sortKey, onlyUnset, probFilter]);

  const unsetCount = rows.filter((r) => r.probability == null).length;

  return (
    <section className="panel overflow-hidden">
      <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">
            Pipeline workspace
          </h3>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Every active quotation. Set the forecast inline — it saves as
            you go.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {unsetCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyUnset((v) => !v)}
              className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
                onlyUnset
                  ? "border-amber-500 bg-amber-50 text-amber-800"
                  : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {onlyUnset ? "Showing unset" : `${unsetCount} without forecast`}
            </button>
          )}
          <label className="flex items-center gap-1.5 text-neutral-500">
            Sort
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-800 focus:border-neutral-400 focus:outline-none"
            >
              <option value="weighted">Weighted value</option>
              <option value="value">Deal value</option>
              <option value="close">Closing date</option>
              <option value="stale">Stale first</option>
            </select>
          </label>
        </div>
      </div>

      {/* Probability filter — exact values, multi-select */}
      <div className="px-5 py-2 border-b border-neutral-100 flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium mr-1">
          Probability
        </span>
        {ALLOWED_PROBABILITIES.map((p) => {
          const active = probFilter.has(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => toggleProbFilter(p)}
              aria-pressed={active}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium tabular-nums transition-colors ${
                active
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"
              }`}
            >
              {p}%
            </button>
          );
        })}
        {probFilter.size > 0 && (
          <button
            type="button"
            onClick={() => setProbFilter(new Set())}
            className="text-[10px] text-neutral-400 hover:text-neutral-700 underline underline-offset-2 ml-1"
          >
            Clear filter
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500 border-b border-neutral-200 bg-neutral-50/60">
              <th className="px-3 py-2 font-medium">Quote</th>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">Country</th>
              {showOwner && <th className="px-3 py-2 font-medium">Rep</th>}
              <th className="px-3 py-2 font-medium text-right">Value</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium w-[110px]">Probability</th>
              <th className="px-3 py-2 font-medium w-[150px]">Expected close</th>
              <th className="px-3 py-2 font-medium text-right">Weighted</th>
              <th className="px-3 py-2 font-medium">Updated</th>
              {canViewAudit && <th className="px-3 py-2 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const stale = isForecastStale(r.updatedAt, r.probability != null);
              const age = forecastAgeDays(r.updatedAt);
              const saving = !!savingIds[r.id];
              const errored = errorId === r.id;
              const legacy =
                r.probability != null && !isAllowedProbability(r.probability);
              return (
                <tr
                  key={r.id}
                  className={`border-b border-neutral-100 align-middle ${
                    errored ? "bg-rose-50/50" : "hover:bg-neutral-50/50"
                  }`}
                >
                  {/* Quote ref */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link
                      href={`/documents/${r.id}`}
                      className="font-medium text-neutral-900 hover:underline underline-offset-2"
                    >
                      {r.number ?? r.id.slice(0, 8) + "…"}
                    </Link>
                  </td>
                  {/* Client */}
                  <td className="px-3 py-2 max-w-[180px] truncate text-neutral-700">
                    {r.clientName ?? "—"}
                  </td>
                  {/* Country */}
                  <td className="px-3 py-2 text-neutral-600 whitespace-nowrap">
                    {r.country ?? "—"}
                  </td>
                  {/* Rep */}
                  {showOwner && (
                    <td className="px-3 py-2 text-neutral-600 whitespace-nowrap">
                      {r.ownerLabel ?? "—"}
                    </td>
                  )}
                  {/* Value */}
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-700 whitespace-nowrap">
                    {fmtMoney(r.total, r.currency)}
                  </td>
                  {/* Status */}
                  <td className="px-3 py-2">
                    <StatusPill status={r.status} />
                  </td>
                  {/* Probability — controlled dropdown, exact values only */}
                  <td className="px-3 py-2">
                    <select
                      value={r.probability == null ? "" : String(r.probability)}
                      disabled={saving}
                      onChange={(e) => onProbability(r.id, e.target.value)}
                      className={`w-full rounded-md border px-2 py-1 text-[11px] tabular-nums focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:opacity-60 ${
                        r.probability == null
                          ? "border-neutral-200 bg-white text-neutral-400"
                          : "border-neutral-300 bg-white text-neutral-900"
                      }`}
                    >
                      <option value="">— set —</option>
                      {/* Legacy pre-standard value (25 / 75) — shown so the
                          select isn't blank, but not offered as a choice. */}
                      {legacy && (
                        <option value={String(r.probability)} disabled>
                          {r.probability}% (legacy)
                        </option>
                      )}
                      {PROBABILITY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value} title={o.meaning}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {/* Expected close */}
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      value={r.expectedCloseDate ?? ""}
                      disabled={saving}
                      onChange={(e) => onDate(r.id, e.target.value)}
                      className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:opacity-60"
                    />
                  </td>
                  {/* Weighted */}
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-neutral-900 whitespace-nowrap">
                    {r.probability
                      ? fmtMoney(weightedValue(r.total, r.probability), r.currency)
                      : "—"}
                  </td>
                  {/* Updated / stale / saving */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {saving ? (
                      <span className="text-[10px] text-neutral-400">Saving…</span>
                    ) : errored ? (
                      <span className="text-[10px] text-rose-600">Failed</span>
                    ) : r.probability == null ? (
                      <span className="text-[10px] text-neutral-300">—</span>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] ${
                          stale ? "text-amber-700" : "text-neutral-400"
                        }`}
                        title={
                          r.updatedAt
                            ? new Date(r.updatedAt).toLocaleString()
                            : "Never updated"
                        }
                      >
                        {stale && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        )}
                        {age == null
                          ? "—"
                          : age === 0
                          ? "today"
                          : `${age}d ago`}
                      </span>
                    )}
                  </td>
                  {/* Admin-only audit trail */}
                  {canViewAudit && (
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => setHistoryRow(r)}
                        title="Forecast change history (management)"
                        className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-[10px] font-medium text-neutral-500 hover:bg-neutral-50 hover:text-neutral-800"
                      >
                        History
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {visibleRows.length === 0 && (
        <div className="px-5 py-8 text-center text-xs text-neutral-400">
          {onlyUnset || probFilter.size > 0
            ? "No quotation matches the current filters."
            : "No active quotations to forecast right now."}
        </div>
      )}

      {canViewAudit && historyRow && (
        <ForecastHistoryDrawer
          documentId={historyRow.id}
          title={historyRow.number ?? historyRow.id.slice(0, 8) + "…"}
          subtitle={historyRow.clientName ?? undefined}
          onClose={() => setHistoryRow(null)}
        />
      )}
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    sent: "border-sky-200 bg-sky-50 text-sky-800",
    negotiating: "border-amber-200 bg-amber-50 text-amber-800",
  };
  const label =
    status === "sent" ? "Sent" : status === "negotiating" ? "Negotiating" : status;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
        map[status] ?? "border-neutral-200 bg-neutral-50 text-neutral-700"
      }`}
    >
      {label}
    </span>
  );
}
