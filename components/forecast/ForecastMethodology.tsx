"use client";

import { useState } from "react";
import {
  PROBABILITY_STAGES,
  FORECAST_CATEGORIES,
  FORECAST_TONE_PILL,
  FORECAST_STALE_DAYS,
} from "@/lib/forecast";

/**
 * ForecastMethodology — the shared forecasting language, in one
 * collapsible panel.
 *
 * Two jobs:
 *   1. Glossary — what each probability stage + category means
 *      operationally, so a "50%" means the same thing across the
 *      whole company.
 *   2. Methodology — a few plain answers (weighted revenue, cadence,
 *      stale) so sales and management share one mental model.
 *
 * Collapsed by default: discoverable, never in the way. Minimalist,
 * operational, not corporate-training.
 */
export function ForecastMethodology() {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-xl border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-full border border-neutral-300 text-[11px] font-semibold text-neutral-600">
            ?
          </span>
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">
              How forecasting works
            </h3>
            <p className="text-[11px] text-neutral-500">
              Stage definitions + the method, so we all forecast the same way.
            </p>
          </div>
        </div>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 text-neutral-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-5 border-t border-neutral-100">
          {/* Stage glossary */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2 mt-3">
              Probability stages
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
                    <th className="py-1.5 pr-3 font-medium">Stage</th>
                    <th className="py-1.5 px-3 font-medium">Confidence</th>
                    <th className="py-1.5 px-3 font-medium">What it means</th>
                    <th className="py-1.5 pl-3 font-medium">Typical situation</th>
                  </tr>
                </thead>
                <tbody>
                  {PROBABILITY_STAGES.map((s) => (
                    <tr key={s.value} className="border-b border-neutral-100 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${FORECAST_TONE_PILL[s.tone]}`}
                        >
                          {s.label}
                          <span className="tabular-nums opacity-70">
                            {s.value}%
                          </span>
                        </span>
                      </td>
                      <td className="py-2 px-3 text-neutral-600 whitespace-nowrap">
                        {s.confidence}
                      </td>
                      <td className="py-2 px-3 text-neutral-700">{s.meaning}</td>
                      <td className="py-2 pl-3 text-neutral-500">
                        {s.situation}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Category legend */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
              Forecast categories
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
              {FORECAST_CATEGORIES.map((c) => (
                <div key={c.value} className="flex items-baseline gap-2">
                  <span
                    className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${FORECAST_TONE_PILL[c.tone]}`}
                  >
                    {c.label}
                  </span>
                  <span className="text-[11px] text-neutral-600 leading-snug">
                    {c.description}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Method Q&A */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
              The method
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
              <QA q="What is weighted revenue?">
                Each deal&apos;s value multiplied by its probability. A 100k deal
                at 50% contributes 50k. Summed across the pipeline, it&apos;s a
                realistic expectation, not the optimistic full total.
              </QA>
              <QA q="Probability vs. category?">
                Probability is how likely the deal is (it drives weighted
                revenue). Category is your management call: Commit means
                you&apos;re counting on it, Upside is a bonus, At risk is
                slipping. Two different dials.
              </QA>
              <QA q="How should stages be used?">
                Pick the stage that matches reality, not hope. Hover any stage to
                see its definition. Everyone uses the same ladder, so a 50% from
                one rep compares to a 50% from another.
              </QA>
              <QA q={`What makes a forecast stale?`}>
                No update in {FORECAST_STALE_DAYS}+ days. It turns orange. Stale
                forecasts drift from reality, so reconfirm or adjust. Touch a
                forecast whenever the deal moves, at least every couple of weeks.
              </QA>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function QA({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-neutral-900">{q}</div>
      <p className="text-[11px] text-neutral-600 leading-relaxed mt-0.5">
        {children}
      </p>
    </div>
  );
}
