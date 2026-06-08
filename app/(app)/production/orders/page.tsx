import { redirect } from "next/navigation";

/**
 * /production/orders is now consolidated into /operations.
 *
 * The previous split created visual duplication — two pages listing
 * the same production orders with overlapping KPIs and slightly
 * different filters. The unified workspace at /operations now hosts:
 *   - the KPI strip
 *   - the action queue (top alerts)
 *   - the orphan banner (task lists pending sync)
 *   - the bottleneck banner (awaiting deposit > 7d / missing deadline /
 *     past due) — migrated here from this page
 *   - the search box (q param) — migrated here from this page
 *   - the [Active] [All] [Archived] scope tabs
 *   - the orders table with status-driven color accents
 *
 * The PO detail page /production/orders/[id] still exists and is the
 * canonical PO detail surface, linked from the /operations table rows.
 * Only this list-level page is redirected.
 *
 * This stub preserves any bookmarks/links that still point here.
 */
export default function ProductionOrdersListRedirect({
  searchParams,
}: {
  searchParams: { scope?: string; q?: string };
}) {
  // Pass through any URL params so deep-linking still works.
  const qs = new URLSearchParams();
  if (searchParams?.scope) qs.set("scope", searchParams.scope);
  if (searchParams?.q) qs.set("q", searchParams.q);
  const target = qs.toString() ? `/operations?${qs.toString()}` : "/operations";
  redirect(target);
}
