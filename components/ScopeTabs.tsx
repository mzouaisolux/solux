import Link from "next/link";
import type { ListScope, ScopeCounts } from "@/lib/queries";

/**
 * [Active] [All] [Archived] tabs — uniform across every list surface.
 *
 * Pure server component, no JS — each tab is a Link that flips the
 * `scope` URL search param. The selected tab gets the dark fill so
 * the current state is unambiguous.
 *
 * Pass the basePath WITHOUT any query string. Any sibling URL params
 * you want to keep alive when the user switches scope (search query,
 * filter selections, pagination cursor, etc.) should be passed via
 * `preserveParams` — without that, the tab links would drop those
 * params and reset the page state in a confusing way.
 *
 * Example:
 *   <ScopeTabs
 *     scope={scope}
 *     basePath="/operations"
 *     counts={counts}
 *     preserveParams={{ q: searchQuery, view: viewMode }}
 *   />
 *
 *   → Active link: /operations?q=SUKI&view=detailed
 *   → All link:    /operations?scope=all&q=SUKI&view=detailed
 *   → Archived:    /operations?scope=archived&q=SUKI&view=detailed
 */
export function ScopeTabs({
  scope,
  basePath,
  counts,
  preserveParams,
}: {
  scope: ListScope;
  basePath: string;
  counts: ScopeCounts;
  /** Additional URL params to keep alive across scope changes.
   *  Empty / null / undefined values are skipped. */
  preserveParams?: Record<string, string | null | undefined>;
}) {
  const items: { key: ListScope; label: string; count: number }[] = [
    { key: "active", label: "Active", count: counts.active },
    { key: "all", label: "All", count: counts.all },
    { key: "archived", label: "Archived", count: counts.archived },
  ];

  /** Compose the href for a scope key, merging preserveParams. */
  function hrefFor(key: ListScope): string {
    const qs = new URLSearchParams();
    if (key !== "active") qs.set("scope", key);
    if (preserveParams) {
      for (const [k, v] of Object.entries(preserveParams)) {
        if (v != null && v !== "") qs.set(k, String(v));
      }
    }
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  }

  return (
    <div
      className="inline-flex items-center rounded-lg border border-neutral-200 bg-white p-0.5"
      role="tablist"
      aria-label="View scope"
    >
      {items.map((item) => {
        const isActive = scope === item.key;
        const href = hrefFor(item.key);
        return (
          <Link
            key={item.key}
            href={href}
            role="tab"
            aria-selected={isActive}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {item.label}
            <span
              className={`tabular-nums text-[10px] rounded px-1 ${
                isActive
                  ? "bg-white/15 text-white/80"
                  : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {item.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
