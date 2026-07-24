/**
 * Visibility engine (m067, Phase 2a) — the single source of truth for
 * "which rows can this user SEE?". Distinct from action permissions
 * (lib/permissions.ts), which answer "what can this user DO?".
 *
 * A user's effective scope is the UNION of their `access_grants`:
 *   - all        → no row restriction
 *   - self       → records they own
 *   - team       → records owned by members of that team
 *   - region     → records whose CLIENT is in that region
 *   - lens(key)  → cross-owner, state-filtered slice (production / finance /
 *                  logistics)
 *
 * SAFETY: when a user has NO grants (or m067 isn't applied), we fall back
 * to today's behavior — technical roles see all, sales see their own — so
 * wiring this in never locks anyone out or regresses existing pages.
 *
 * Server-only (request-scoped Supabase client). Callers should resolve the
 * scope once and pass it down; a 30s memo could be added later if needed.
 */

// NB: the Supabase server client is imported LAZILY inside getVisibilityScope
// (it pulls next/headers, which can't load in the pure unit-test runner). This
// keeps the module's PURE exports (canSeeRecord, lensExposes, LENS_STATUSES…)
// unit-testable without a Next runtime.
import { isTechnicalRole, canSupervise, type Role } from "../../../lib/types.ts";

export type Lens = "production" | "finance" | "logistics";

/** State filters per lens — kept here so RLS + app stay in sync later. */
export const LENS_STATUSES: Record<Lens, { documents?: string[]; taskLists?: string[] }> = {
  production: { taskLists: ["validated", "production_ready"] },
  finance: { documents: ["won"] },
  logistics: { documents: ["won"] },
};

export type VisibilityScope = {
  /** Sees everything — no owner/region restriction. */
  all: boolean;
  /** Owner user-ids the user may see (self + resolved team members). */
  ownerIds: Set<string>;
  /** Region (team) ids whose clients the user may see. */
  regionIds: Set<string>;
  /** Cross-owner state lenses. */
  lenses: Set<Lens>;
  /** True when derived from explicit grants; false = legacy fallback. */
  fromGrants: boolean;
};

function emptyScope(): VisibilityScope {
  return {
    all: false,
    ownerIds: new Set(),
    regionIds: new Set(),
    lenses: new Set(),
    fromGrants: false,
  };
}

/**
 * Resolve a user's visibility scope. `role` is the user's REAL role (used
 * only for the legacy fallback when no grants exist).
 */
export async function getVisibilityScope(
  userId: string | null,
  role: Role | null
): Promise<VisibilityScope> {
  if (!userId) return emptyScope(); // no session → see nothing

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = createClient();

  // Load active grants (RLS allows self-read). Soft-fail to legacy if m067
  // isn't applied yet.
  let grants: Array<{
    scope_type: string;
    team_id: string | null;
    lens_key: string | null;
    expires_at: string | null;
  }> | null = null;
  {
    const { data, error } = await supabase
      .from("access_grants")
      .select("scope_type, team_id, lens_key, expires_at")
      .eq("user_id", userId);
    if (!error) grants = (data ?? []) as any[];
  }

  const now = Date.now();
  const active = (grants ?? []).filter(
    (g) => !g.expires_at || new Date(g.expires_at).getTime() > now
  );

  // ---- Legacy fallback: no grants configured → preserve current behavior.
  // F1: sales_director is a commercial SUPERVISOR (canSupervise grants it
  // validation-review + owner-reassign on ANY client/affair/doc). Org-wide
  // visibility is the consistent counterpart — without it a director with no
  // grant + no team sees nothing. Mirrors the RLS "see all" branch (m132).
  if (grants === null || active.length === 0) {
    if (isTechnicalRole(role) || canSupervise(role)) {
      return { ...emptyScope(), all: true };
    }
    return { ...emptyScope(), ownerIds: new Set([userId]) };
  }

  // ---- Derive scope from grants.
  const scope = emptyScope();
  scope.fromGrants = true;
  const teamIdsForMembers: string[] = [];

  for (const g of active) {
    switch (g.scope_type) {
      case "all":
        scope.all = true;
        break;
      case "self":
        scope.ownerIds.add(userId);
        break;
      case "team":
        if (g.team_id) teamIdsForMembers.push(g.team_id);
        break;
      case "region":
        if (g.team_id) scope.regionIds.add(g.team_id);
        break;
      case "lens":
        if (g.lens_key) scope.lenses.add(g.lens_key as Lens);
        break;
    }
  }

  if (teamIdsForMembers.length > 0) {
    const { data: members } = await supabase
      .from("team_members")
      .select("user_id")
      .in("team_id", teamIdsForMembers);
    for (const m of (members ?? []) as Array<{ user_id: string }>) {
      scope.ownerIds.add(m.user_id);
    }
  }

  // Region → owners: region is account-centric, so a region grant means
  // "see the owners of that region's clients". Expanding into ownerIds lets
  // every page filter on ONE uniform axis. (A rep who owns clients in
  // several regions is included via their owned accounts — acceptable for
  // v1; precise per-account region filtering can refine later.)
  if (scope.regionIds.size > 0) {
    const { data: regionClients } = await supabase
      .from("clients")
      .select("created_by, sales_owner_id")
      .in("region_id", [...scope.regionIds]);
    for (const c of (regionClients ?? []) as any[]) {
      const owner = (c.sales_owner_id ?? c.created_by) as string | null;
      if (owner) scope.ownerIds.add(owner);
    }
  }

  // A user always sees their own records.
  scope.ownerIds.add(userId);
  return scope;
}

/**
 * Row-level visibility check used by the list pages, on the OWNER axis.
 *
 * - `all` scope → everything.
 * - any lens present → broad for now (lens state-filtering is wired per
 *   page in Phase 2c; we don't over-hide lens users in the meantime).
 * - otherwise → the row's owner must be in the allowlist.
 *
 * Because the legacy fallback returns `all` for technical roles and
 * `{ self }` for sales, ungranted users behave exactly as before.
 */
export function canSeeRow(
  scope: VisibilityScope,
  ownerId: string | null | undefined
): boolean {
  if (scope.all) return true;
  // A lens broadens visibility on owner-only surfaces (e.g. the client
  // directory, which carries no per-row workflow status to narrow on).
  // Pages that DO know a row's kind + status should call canSeeRecord
  // instead, so lens grants narrow precisely (Phase 2c).
  if (scope.lenses.size > 0) return true;
  return !!ownerId && scope.ownerIds.has(ownerId);
}

/* ---------------------------------------------------------------------------
   Lens narrowing (Phase 2c).
   ---------------------------------------------------------------------------
   A lens is a cross-owner, workflow-based slice: it exposes records by
   (kind, status) regardless of who owns them.

     production → factory queue: task lists at validated / production_ready,
                  plus every production order (what the factory builds).
     finance    → won quotations + every production order (invoicing,
                  deposits, balances).
     logistics  → won quotations + every production order (shipping, BL,
                  booking).

   Production orders only ever exist for WON deals, so every back-office lens
   may see them; the per-lens status arrays in LENS_STATUSES gate task lists
   and quotations.
--------------------------------------------------------------------------- */

export type RecordKind = "task_list" | "document" | "order";

export type RecordContext = {
  /** Row owner (sales_owner_id ?? created_by). */
  ownerId?: string | null;
  kind: RecordKind;
  /** Task-list status or document status (ignored for orders). */
  status?: string | null;
};

/** Does one lens expose this (kind, status)? */
function lensExposes(lens: Lens, ctx: RecordContext): boolean {
  if (ctx.kind === "order") return true; // shared post-won operational record
  const def = LENS_STATUSES[lens];
  const allowed = ctx.kind === "task_list" ? def.taskLists : def.documents;
  if (!allowed) return false;
  // Unknown status (not loaded) → don't hide; the page filtered the query.
  return !ctx.status || allowed.includes(ctx.status);
}

/**
 * Full row-visibility check across every axis: `all`, owner/team/region
 * (via ownerIds), and lens status-slices. Prefer this over canSeeRow on
 * pages that know the row's kind + status (task lists, orders) so a lens
 * grant narrows precisely instead of showing everything.
 */
export function canSeeRecord(
  scope: VisibilityScope,
  ctx: RecordContext
): boolean {
  if (scope.all) return true;
  if (ctx.ownerId && scope.ownerIds.has(ctx.ownerId)) return true;
  for (const lens of scope.lenses) {
    if (lensExposes(lens, ctx)) return true;
  }
  return false;
}

/** Can this user see a record owned by `ownerId`? (owner/team/all axes) */
export function canSeeOwner(scope: VisibilityScope, ownerId: string | null): boolean {
  if (scope.all) return true;
  return !!ownerId && scope.ownerIds.has(ownerId);
}

/**
 * Owner-id allowlist for query filtering, or `null` when unrestricted
 * (scope.all). Note: region + lens axes are evaluated separately by the
 * caller (region needs the client's region_id; lens needs status).
 */
export function ownerAllowList(scope: VisibilityScope): string[] | null {
  if (scope.all) return null;
  return [...scope.ownerIds];
}

/** Short human description for the UI ("Everything", "3 owners + 1 region"). */
export function describeScope(scope: VisibilityScope): string {
  if (scope.all) return "Everything";
  const parts: string[] = [];
  if (scope.ownerIds.size) parts.push(`${scope.ownerIds.size} owner${scope.ownerIds.size === 1 ? "" : "s"}`);
  if (scope.regionIds.size) parts.push(`${scope.regionIds.size} region${scope.regionIds.size === 1 ? "" : "s"}`);
  if (scope.lenses.size) parts.push([...scope.lenses].join(" + "));
  return parts.length ? parts.join(" · ") : "Nothing";
}
