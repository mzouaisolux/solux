"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { SalesUserForFilter } from "@/lib/sales-filter";

/**
 * Horizontal pill bar that lets technical roles (admin / TLM /
 * operations / super-admin) narrow every operational surface to a
 * single sales rep's data.
 *
 * URL-driven: clicking a pill updates the ?sales= search param.
 * "All sales" clears the param. Other URL params are preserved
 * (scope tabs, search query, etc.).
 *
 * The parent page reads `searchParams.sales` and applies the scope
 * to its queries — this component is purely presentational + URL
 * manipulation.
 *
 * Rendering rules:
 *   - Sales role users: parent never mounts this component.
 *   - 0 sales users: parent shouldn't mount (nothing to filter on).
 *   - Many sales: horizontal scroll on overflow.
 */
export function SalesFilterBar({
  sales,
  /** Aggregate counts shown next to the "All sales" pill. */
  totalCriticalCount,
}: {
  sales: SalesUserForFilter[];
  totalCriticalCount?: number;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const current = params.get("sales");

  /** Build the destination URL for a given sales id (or null = clear). */
  function hrefFor(salesId: string | null): string {
    const next = new URLSearchParams(params.toString());
    if (salesId) next.set("sales", salesId);
    else next.delete("sales");
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  }

  if (sales.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
      <span className="text-[10px] uppercase tracking-widerx font-semibold text-neutral-500 shrink-0 mr-1">
        Sales:
      </span>
      <Pill
        href={hrefFor(null)}
        active={!current}
        label="All sales"
        count={totalCriticalCount}
      />
      {sales.map((s) => (
        <Pill
          key={s.id}
          href={hrefFor(s.id)}
          active={current === s.id}
          label={s.label}
          count={s.criticalCount}
          title={s.email ?? s.id}
        />
      ))}
    </div>
  );
}

function Pill({
  href,
  active,
  label,
  count,
  title,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title ?? label}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors shrink-0 ${
        active
          ? "bg-neutral-900 text-white border-neutral-900"
          : "bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300"
      }`}
    >
      <span className="capitalize">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold tabular-nums ${
            active
              ? "bg-rose-100 text-rose-800"
              : "bg-rose-100 text-rose-700"
          }`}
          title={`${count} critical issue${count === 1 ? "" : "s"} open`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
