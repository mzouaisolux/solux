"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateQuotationForecast,
  clearQuotationForecast,
} from "@/app/(app)/documents/[id]/actions";
import {
  PROBABILITY_OPTIONS,
  isAllowedProbability,
  isForecastStale,
  forecastAgeDays,
  weightedValue,
  fmtMoney,
  type ForecastProbability,
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
 * - ONE dial: the probability, a CONTROLLED value (10–90 by 10, 95,
 *   100). No free text, no categories, no ranges. Weighted forecast =
 *   value × probability.
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
  initialExpectedCloseDate,
  initialUpdatedAt,
  prominent = false,
}: {
  documentId: string;
  total: number;
  currency: string;
  initialProbability: ForecastProbability | null;
  initialExpectedCloseDate: string | null;
  initialUpdatedAt: string | null;
  /** When true and no forecast is set yet, shows a loud call-to-action
   *  banner — used on a freshly-created version that inherited no
   *  forecast from the prior version and must be re-confirmed. */
  prominent?: boolean;
}) {
  const router = useRouter();
  const [probability, setProbability] = useState<number | null>(
    initialProbability
  );
  const [closeDate, setCloseDate] = useState(initialExpectedCloseDate ?? "");
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const hasForecast = probability != null;
  const stale = isForecastStale(updatedAt, hasForecast);
  const ageDays = forecastAgeDays(updatedAt);
  const weighted = weightedValue(total, probability);
  // Pre-m158 rows can still carry a legacy value (25 / 75) — flag it so
  // the rep re-picks from the standard ladder.
  const legacyValue =
    probability != null && !isAllowedProbability(probability)
      ? probability
      : null;

  /** Fire one field update + refresh. Optimistic — caller already set
   *  local state. Rolls back on failure. */
  const save = (
    patch: Partial<{ probability: string; expected_close_date: string }>,
    rollback: () => void
  ) => {
    setError(null);
    const fd = new FormData();
    fd.set("id", documentId);
    if (patch.probability !== undefined) fd.set("probability", patch.probability);
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

  const onDate = (value: string) => {
    const prev = closeDate;
    setCloseDate(value);
    save({ expected_close_date: value }, () => setCloseDate(prev));
  };

  const onClearAll = () => {
    const snapshot = { probability, closeDate };
    setProbability(null);
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

      {/* Legacy (pre-standardization) value — nudge to re-pick. */}
      {legacyValue != null && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          This deal still carries a legacy probability ({legacyValue}%).
          Pick one of the standard values below to update it.
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      {/* Probability — controlled values only */}
      <div className="mb-3">
        <div className="text-[11px] font-medium text-neutral-600 mb-1.5">
          Closing probability
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PROBABILITY_OPTIONS.map((o) => {
            const active = probability === o.value;
            const isWon = o.value === 100;
            return (
              <button
                key={o.value}
                type="button"
                disabled={pending}
                onClick={() => onProbability(o.value)}
                aria-pressed={active}
                title={o.meaning}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  active
                    ? isWon
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-neutral-900 bg-neutral-900 text-white"
                    : isWon
                    ? "border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
                    : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-neutral-400 mt-1.5">
          100% = won / confirmed order · 95% = almost certain, not confirmed
          yet.
        </p>
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
