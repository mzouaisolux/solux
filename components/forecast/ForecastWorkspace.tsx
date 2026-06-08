"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateQuotationForecast } from "@/app/(app)/documents/[id]/actions";
import {
  PROBABILITY_STAGES,
  FORECAST_CATEGORIES,
  FORECAST_TONE_PILL,
  categoryTone,
  isForecastStale,
  forecastAgeDays,
  weightedValue,
  fmtMoney,
  type ForecastProbability,
  type ForecastCategory,
} from "@/lib/forecast";

/**
 * ForecastWorkspace — the operational heart of /forecast.
 *
 * Lists EVERY active quotation (sent / negotiating) and lets sales set
 * the forecast inline — probability dropdown, category dropdown, close
 * date — without ever opening the quotation. Each change auto-saves
 * (optimistic local state + server action + router.refresh to
 * reconcile the KPIs above).
 *
 * This is deliberately a dense, grid-like data surface: fast scanning,
 * fast editing, zero navigation. The opposite of a CRM opportunity
 * form.
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
  category: ForecastCategory | null;
  expectedCloseDate: string | null;
  updatedAt: string | null;
};

type SortKey = "weighted" | "value" | "close" | "stale";

export function ForecastWorkspace({
  initialRows,
  showOwner,
}: {
  initialRows: ForecastRow[];
  showOwner: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ForecastRow[]>(initialRows);
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});
  const [errorId, setErrorId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [sortKey, setSortKey] = useState<SortKey>("weighted");
  const [onlyUnset, setOnlyUnset] = useState(false);

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
  const onCategory = (id: string, value: string) => {
    patchRow(
      id,
      { category: value === "" ? null : (value as ForecastCategory) },
      { category: value }
    );
  };
  const onDate = (id: string, value: string) => {
    patchRow(id, { expectedCloseDate: value || null }, { expected_close_date: value });
  };

  const visibleRows = useMemo(() => {
    let out = onlyUnset ? rows.filter((r) => r.probability == null) : rows;
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
  }, [rows, sortKey, onlyUnset]);

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
              <th className="px-3 py-2 font-medium w-[150px]">Probability</th>
              <th className="px-3 py-2 font-medium w-[130px]">Category</th>
              <th className="px-3 py-2 font-medium w-[150px]">Expected close</th>
              <th className="px-3 py-2 font-medium text-right">Weighted</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r) => {
              const stale = isForecastStale(r.updatedAt, r.probability != null);
              const age = forecastAgeDays(r.updatedAt);
              const saving = !!savingIds[r.id];
              const errored = errorId === r.id;
              const tone = categoryTone(r.category);
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
                  {/* Probability */}
                  <td className="px-3 py-2">
                    <select
                      value={r.probability == null ? "" : String(r.probability)}
                      disabled={saving}
                      onChange={(e) => onProbability(r.id, e.target.value)}
                      className={`w-full rounded-md border px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:opacity-60 ${
                        r.probability == null
                          ? "border-neutral-200 bg-white text-neutral-400"
                          : "border-neutral-300 bg-white text-neutral-900"
                      }`}
                    >
                      <option value="">— set —</option>
                      {PROBABILITY_STAGES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label} · {s.value}%
                        </option>
                      ))}
                    </select>
                  </td>
                  {/* Category */}
                  <td className="px-3 py-2">
                    <select
                      value={r.category ?? ""}
                      disabled={saving}
                      onChange={(e) => onCategory(r.id, e.target.value)}
                      className={`w-full rounded-md border px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:opacity-60 ${
                        r.category == null
                          ? "border-neutral-200 bg-white text-neutral-400"
                          : "border-neutral-300 bg-white text-neutral-900"
                      }`}
                    >
                      <option value="">— set —</option>
                      {FORECAST_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {visibleRows.length === 0 && (
        <div className="px-5 py-8 text-center text-xs text-neutral-400">
          {onlyUnset
            ? "Every active quotation has a forecast. Nice."
            : "No active quotations to forecast right now."}
        </div>
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
