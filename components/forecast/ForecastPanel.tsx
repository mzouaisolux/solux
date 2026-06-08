"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateQuotationForecast,
  clearQuotationForecast,
} from "@/app/(app)/documents/[id]/actions";
import {
  PROBABILITY_STAGES,
  FORECAST_CATEGORIES,
  FORECAST_TONE_IDLE,
  FORECAST_TONE_ACTIVE,
  isForecastStale,
  forecastAgeDays,
  weightedValue,
  fmtMoney,
  type ForecastProbability,
  type ForecastCategory,
} from "@/lib/forecast";

/**
 * Inline forecast panel — the fast, frictionless dial sales touches to
 * keep a quotation's commercial read fresh.
 *
 * Principles
 * ----------
 * - One-click chips. No Save button — each click auto-saves via the
 *   server action, then router.refresh() reconciles. Optimistic local
 *   state keeps it feeling instant.
 * - Probability + category are independent dials (see lib/forecast).
 * - A stale forecast (>30d) flips the header to an orange warning so
 *   the rep knows their read is drifting.
 *
 * Shown only for active, non-draft quotations (sent / negotiating) —
 * the host page gates this; the component itself just renders.
 */
export function ForecastPanel({
  documentId,
  total,
  currency,
  initialProbability,
  initialCategory,
  initialExpectedCloseDate,
  initialUpdatedAt,
  prominent = false,
}: {
  documentId: string;
  total: number;
  currency: string;
  initialProbability: ForecastProbability | null;
  initialCategory: ForecastCategory | null;
  initialExpectedCloseDate: string | null;
  initialUpdatedAt: string | null;
  /** When true and no forecast is set yet, shows a loud call-to-action
   *  banner — used on a freshly-created version that inherited no
   *  forecast from the prior version and must be re-confirmed. */
  prominent?: boolean;
}) {
  const router = useRouter();
  const [probability, setProbability] = useState(initialProbability);
  const [category, setCategory] = useState(initialCategory);
  const [closeDate, setCloseDate] = useState(initialExpectedCloseDate ?? "");
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hasForecast = probability != null;
  const stale = isForecastStale(updatedAt, hasForecast);
  const ageDays = forecastAgeDays(updatedAt);
  const weighted = weightedValue(total, probability);

  /** Fire one field update + refresh. Optimistic — caller already set
   *  local state. Rolls back on failure. */
  const save = (
    patch: Partial<{
      probability: string;
      category: string;
      expected_close_date: string;
    }>,
    rollback: () => void
  ) => {
    setError(null);
    const fd = new FormData();
    fd.set("id", documentId);
    if (patch.probability !== undefined) fd.set("probability", patch.probability);
    if (patch.category !== undefined) fd.set("category", patch.category);
    if (patch.expected_close_date !== undefined)
      fd.set("expected_close_date", patch.expected_close_date);

    startTransition(async () => {
      try {
        await updateQuotationForecast(fd);
        setUpdatedAt(new Date().toISOString());
        router.refresh();
      } catch (e: any) {
        rollback();
        setError(e?.message ?? "Failed to save forecast");
      }
    });
  };

  const onProbability = (value: ForecastProbability) => {
    const prev = probability;
    const next = probability === value ? null : value; // click active = clear
    setProbability(next);
    save({ probability: next == null ? "" : String(next) }, () =>
      setProbability(prev)
    );
  };

  const onCategory = (value: ForecastCategory) => {
    const prev = category;
    const next = category === value ? null : value;
    setCategory(next);
    save({ category: next ?? "" }, () => setCategory(prev));
  };

  const onDate = (value: string) => {
    const prev = closeDate;
    setCloseDate(value);
    save({ expected_close_date: value }, () => setCloseDate(prev));
  };

  const onClearAll = () => {
    const snapshot = { probability, category, closeDate };
    setProbability(null);
    setCategory(null);
    setCloseDate("");
    setError(null);
    const fd = new FormData();
    fd.set("id", documentId);
    startTransition(async () => {
      try {
        await clearQuotationForecast(fd);
        setUpdatedAt(null);
        router.refresh();
      } catch (e: any) {
        setProbability(snapshot.probability);
        setCategory(snapshot.category);
        setCloseDate(snapshot.closeDate);
        setError(e?.message ?? "Failed to clear forecast");
      }
    });
  };

  return (
    <section className="panel p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="eyebrow">Forecast</div>
          <p className="text-xs text-neutral-500 mt-0.5">
            A quick commercial read on this deal — drives the weighted
            pipeline. Update it in a click.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending && (
            <span className="text-[11px] text-neutral-400">Saving…</span>
          )}
          {hasForecast && (
            <span className="text-[11px] text-neutral-500 tabular-nums">
              Weighted{" "}
              <b className="text-neutral-900">{fmtMoney(weighted, currency)}</b>
            </span>
          )}
        </div>
      </div>

      {/* Prominent "needs a forecast" call-to-action — shown on a fresh
          version that didn't inherit a forecast from the prior one. */}
      {prominent && !hasForecast && (
        <div className="mb-3 rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2.5">
          <div className="text-[12px] font-semibold text-amber-900">
            This version needs a forecast
          </div>
          <p className="text-[11px] text-amber-800 mt-0.5">
            The forecast doesn&apos;t carry over to a new version — set the
            closing probability below so this deal counts in the pipeline
            again.
          </p>
        </div>
      )}

      {/* Stale warning */}
      {stale && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>
            Forecast outdated
            {ageDays != null ? ` — last updated ${ageDays}d ago` : ""}. Reconfirm
            the read to keep the pipeline reliable.
          </span>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      {/* Probability ladder */}
      <div className="mb-3">
        <div className="text-[11px] font-medium text-neutral-600 mb-1.5">
          Closing probability
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROBABILITY_STAGES.map((s) => {
            const active = probability === s.value;
            return (
              <button
                key={s.value}
                type="button"
                disabled={pending}
                onClick={() => onProbability(s.value)}
                aria-pressed={active}
                title={`${s.label} · ${s.value}% — ${s.confidence} confidence\n${s.meaning}\n${s.situation}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  active ? FORECAST_TONE_ACTIVE[s.tone] : FORECAST_TONE_IDLE[s.tone]
                }`}
              >
                <span>{s.label}</span>
                <span
                  className={`tabular-nums ${active ? "opacity-80" : "opacity-50"}`}
                >
                  {s.value}%
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Category buckets */}
      <div className="mb-3">
        <div className="text-[11px] font-medium text-neutral-600 mb-1.5">
          Forecast category
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FORECAST_CATEGORIES.map((c) => {
            const active = category === c.value;
            return (
              <button
                key={c.value}
                type="button"
                disabled={pending}
                onClick={() => onCategory(c.value)}
                aria-pressed={active}
                title={c.description}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  active ? FORECAST_TONE_ACTIVE[c.tone] : FORECAST_TONE_IDLE[c.tone]
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Expected close + clear */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <label className="block">
          <span className="block text-[11px] font-medium text-neutral-600 mb-1">
            Expected closing date
          </span>
          <input
            type="date"
            value={closeDate}
            disabled={pending}
            onChange={(e) => onDate(e.target.value)}
            className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400 disabled:opacity-60"
          />
        </label>
        {hasForecast && (
          <button
            type="button"
            onClick={onClearAll}
            disabled={pending}
            className="text-[11px] text-neutral-400 hover:text-rose-600 underline-offset-2 hover:underline disabled:opacity-60"
          >
            Clear forecast
          </button>
        )}
      </div>
    </section>
  );
}
