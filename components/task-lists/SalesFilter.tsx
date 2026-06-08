"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/**
 * Sales (owner) filter for the Task Lists list — built for the Task List
 * Manager who supervises MANY salespeople at once.
 *
 * - Multi-select: click chips to toggle one / several sales; "All" clears.
 * - Each chip carries a workload signal: total task lists + a loud amber
 *   badge for items currently awaiting validation (the TLM's queue).
 * - State lives in the URL (`?sales=id1,id2`), preserving the status tab,
 *   so the server component re-renders filtered + links stay shareable.
 *
 * Names shown here are the canonical Display Names (Admin → User roles),
 * resolved server-side via resolveUserLabelStrings — change a name there
 * and it propagates here on the next render, no remapping.
 */
export type SalesOption = {
  id: string;
  name: string;
  total: number;
  pending: number; // awaiting validation
  overdue: number; // awaiting validation for too long (> N days)
};

export function SalesFilter({
  options,
  selected,
}: {
  options: SalesOption[];
  selected: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function apply(next: string[]) {
    const params = new URLSearchParams(sp.toString());
    if (next.length === 0) params.delete("sales");
    else params.set("sales", next.join(","));
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const toggle = (id: string) =>
    apply(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id]
    );

  if (options.length === 0) return null;

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      active
        ? "border-solux bg-solux text-white"
        : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mr-1">
        Sales
      </span>
      <button
        type="button"
        onClick={() => apply([])}
        className={chip(selected.length === 0)}
      >
        All sales
      </button>
      {options.map((o) => {
        const active = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => toggle(o.id)}
            className={chip(active)}
            title={`${o.name} — ${o.total} task list${
              o.total === 1 ? "" : "s"
            }${o.pending > 0 ? `, ${o.pending} awaiting validation` : ""}${
              o.overdue > 0 ? ` (${o.overdue} overdue > 3 days)` : ""
            }`}
          >
            <span>{o.name}</span>
            <span
              className={`tabular-nums ${
                active ? "text-white/80" : "text-neutral-400"
              }`}
            >
              {o.total}
            </span>
            {/* Awaiting validation (amber) — the TLM review queue. */}
            {o.pending > 0 && (
              <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold tabular-nums">
                {o.pending}
              </span>
            )}
            {/* Overdue (red) — waiting on the TLM for too long. */}
            {o.overdue > 0 && (
              <span
                title={`${o.overdue} overdue (> 3 days awaiting validation)`}
                className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-semibold tabular-nums"
              >
                ⏰{o.overdue}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
