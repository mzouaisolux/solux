// =====================================================================
// OrdersFilterBar — narrow the Orders-in-flight board by a dimension.
//
// v1 = filter by COMMERCIAL (the action-center handles many commercials'
// orders for Operations). Built as a generic dimension selector so team /
// region slot in later without changing this component (owner directive
// 2026-06-25). Pure server component — chips are <Link>s on a query param,
// no client JS. Options + hrefs are precomputed by the page.
// =====================================================================

import Link from "next/link";

export type FilterOption = {
  /** null = "All". */
  id: string | null;
  label: string;
  count: number;
  href: string;
};

export default function OrdersFilterBar({
  dimensionLabel,
  options,
  activeId,
}: {
  dimensionLabel: string;
  options: FilterOption[];
  activeId: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        {dimensionLabel}
      </span>
      {options.map((o) => {
        const active = (o.id ?? null) === (activeId ?? null);
        return (
          <Link
            key={o.id ?? "__all__"}
            href={o.href}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors ${
              active
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {o.label}
            <span className={`tabular-nums ${active ? "text-white/70" : "text-neutral-400"}`}>
              {o.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
