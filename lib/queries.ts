/**
 * Active vs Archive filtering — unified scope helpers.
 *
 * Single source of truth for what "active" / "all" / "archived" mean
 * across the app's list surfaces. Pages read the `scope` URL param,
 * call parseListScope() to validate, then pass it to one of the
 * applyXxxScope() helpers to filter their query builder consistently.
 *
 * Why centralized
 * ---------------
 * Before this module each page made up its own definition of "show
 * cancelled or not" — /operations showed cancelled by default,
 * /dashboard filtered them out, /order-follow-up was inconsistent.
 * The visible mismatch ("I cancelled this order but it still shows
 * here") is exactly what this helpers prevent.
 *
 * Semantics
 * ---------
 *  - active   : alive AND not archived. The default view.
 *  - all      : every row regardless of state. Used by the "All" tab.
 *  - archived : only archived_at IS NOT NULL. Used by the "Archived" tab.
 *
 * Per-entity definitions of "alive":
 *  - production_orders : status NOT IN (cancelled, delivered)
 *  - documents         : status NOT IN (cancelled, lost)
 *  - production_task_lists : status NOT IN (cancelled)
 */

import {
  DOC_DEAD_STATUSES,
  PO_TERMINAL_STATUSES,
  TASK_LIST_DEAD_STATUSES,
} from "@/lib/lifecycle";

export type ListScope = "active" | "all" | "archived";

export const LIST_SCOPES: ListScope[] = ["active", "all", "archived"];

/**
 * Parse the `scope` URL search param. Anything other than the three
 * known values falls back to "active" so a typo doesn't accidentally
 * reveal archived rows.
 */
export function parseListScope(value: string | null | undefined): ListScope {
  if (value === "all" || value === "archived") return value;
  return "active";
}

/** Build the "(a,b,c)" syntax that PostgREST's `.not(col, "in", ...)` expects. */
function inList(values: readonly string[]): string {
  return `(${values.join(",")})`;
}

/* ===========================================================================
   APPLY SCOPE FILTERS
   ===========================================================================
   Each helper takes an in-flight Supabase query builder and applies the
   right filters for the requested scope. Returns the chained builder
   so callers can continue refining (further .eq, .order, etc.).

   Typed as `any` because Supabase's filter builder types are deeply
   parameterized and chaining through generic helpers fights the
   inference. Callers keep their own typed builders before/after the
   helper — only the filter chain step is `any`.
   =========================================================================== */

/**
 * Apply scope filter to a production_orders query.
 *
 * - active   : NOT archived AND status NOT IN (cancelled, delivered)
 * - all      : no filter applied
 * - archived : archived_at IS NOT NULL
 */
export function applyPOScope(builder: any, scope: ListScope = "active"): any {
  if (scope === "archived") {
    return builder.not("archived_at", "is", null);
  }
  if (scope === "all") return builder;
  return builder
    .is("archived_at", null)
    .not("status", "in", inList(PO_TERMINAL_STATUSES));
}

/**
 * Apply scope filter to a documents (quotations) query.
 *
 * - active   : NOT archived AND status NOT IN (cancelled, lost)
 * - all      : no filter applied
 * - archived : archived_at IS NOT NULL
 */
export function applyDocScope(builder: any, scope: ListScope = "active"): any {
  if (scope === "archived") {
    return builder.not("archived_at", "is", null);
  }
  if (scope === "all") return builder;
  return builder
    .is("archived_at", null)
    .not("status", "in", inList(DOC_DEAD_STATUSES));
}

/**
 * Apply scope filter to a production_task_lists query.
 *
 * - active   : NOT archived AND status NOT IN (cancelled)
 * - all      : no filter applied
 * - archived : archived_at IS NOT NULL
 */
export function applyTaskListScope(
  builder: any,
  scope: ListScope = "active"
): any {
  if (scope === "archived") {
    return builder.not("archived_at", "is", null);
  }
  if (scope === "all") return builder;
  return builder
    .is("archived_at", null)
    .not("status", "in", inList(TASK_LIST_DEAD_STATUSES));
}

/* ===========================================================================
   COUNT HELPERS — for the [Active] [All] [Archived] tabs
   ===========================================================================
   Three head-only count queries per page is fine — they're fast and
   the data sizes are small. If you need to scope counts to a subset
   (e.g. sales user → only their docs), pass `applyExtraFilter` so the
   per-page constraint is mirrored across all three counts.
   =========================================================================== */

export type ScopeCounts = {
  active: number;
  all: number;
  archived: number;
};

type FilterAugment = (builder: any) => any;
const identity: FilterAugment = (b) => b;

/**
 * Count production_orders per scope. `applyExtraFilter` runs BEFORE
 * the scope filter so per-page constraints (e.g. .in("quotation_id",
 * wonDocIds)) apply uniformly across the three counts.
 */
export async function countProductionOrders(
  supabase: any,
  applyExtraFilter: FilterAugment = identity
): Promise<ScopeCounts> {
  const mk = (scope: ListScope) =>
    applyPOScope(
      applyExtraFilter(
        supabase
          .from("production_orders")
          .select("id", { count: "exact", head: true })
      ),
      scope
    );
  const [a, l, ar] = await Promise.all([mk("active"), mk("all"), mk("archived")]);
  return {
    active: a.count ?? 0,
    all: l.count ?? 0,
    archived: ar.count ?? 0,
  };
}

/** Same idea for documents (used by /business and dashboards). */
export async function countDocuments(
  supabase: any,
  applyExtraFilter: FilterAugment = identity
): Promise<ScopeCounts> {
  const mk = (scope: ListScope) =>
    applyDocScope(
      applyExtraFilter(
        supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
      ),
      scope
    );
  const [a, l, ar] = await Promise.all([mk("active"), mk("all"), mk("archived")]);
  return {
    active: a.count ?? 0,
    all: l.count ?? 0,
    archived: ar.count ?? 0,
  };
}

/** Same idea for task lists. */
export async function countTaskLists(
  supabase: any,
  applyExtraFilter: FilterAugment = identity
): Promise<ScopeCounts> {
  const mk = (scope: ListScope) =>
    applyTaskListScope(
      applyExtraFilter(
        supabase
          .from("production_task_lists")
          .select("id", { count: "exact", head: true })
      ),
      scope
    );
  const [a, l, ar] = await Promise.all([mk("active"), mk("all"), mk("archived")]);
  return {
    active: a.count ?? 0,
    all: l.count ?? 0,
    archived: ar.count ?? 0,
  };
}
