/**
 * Capability-based permissions — runtime check helpers.
 *
 * Backed by the role × capability matrix in tables `permissions` and
 * `role_permissions` (migration 026). Replaces the legacy hardcoded
 * `requireAdmin()` / `requireTaskListManagerOrAdmin()` checks in
 * server actions.
 *
 * Architecture (D.1 / D.2 confirmed by user):
 *   - App-level only. RLS policies on documents / production_orders /
 *     etc. are NOT changed; the capability check happens in the
 *     server action layer right before any mutation.
 *   - In-memory cache with 30s TTL. Reduces query load when an action
 *     calls hasCapability() multiple times per request. Trade-off:
 *     after a super-admin edits the matrix, the change is visible to
 *     other server instances within 30s (no immediate broadcast).
 *
 * Usage in a server action:
 *   import { requireCapability } from "@/lib/permissions";
 *
 *   export async function cancelProductionOrder(formData: FormData) {
 *     await requireCapability("production_order.edit_status");
 *     // ... rest of the action ...
 *   }
 *
 * Sub-step 3.A scope (this commit):
 *   - This file is created but NOT yet imported by any server action.
 *   - Behavior of the app is unchanged.
 *   - User validates DB state, then we move to 3.B (refactor actions).
 */

import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole, getEffectiveRole } from "@/lib/auth";
import { isAdminLike, type Role } from "@/lib/types";

/* ===========================================================================
   CAPABILITY KEY CATALOG
   ===========================================================================
   The full set of capability keys, mirroring migration 026's seed. The
   `Capability` type provides autocomplete + compile-time typo catching
   so a refactored server action can't accidentally check
   "production_order.cancel" (which doesn't exist) instead of
   "production_order.edit_status".

   When you add a new capability, ALWAYS:
     1. Add it to the migration (insert into permissions ...).
     2. Add the matrix rows (insert into role_permissions ...).
     3. Add the key to this `Capability` union below.
*/

export type Capability =
  // quotation
  | "quotation.create"
  | "quotation.cancel"
  | "quotation.archive"
  | "quotation.delete"
  // task list
  | "task_list.validate"
  | "task_list.reject"
  | "task_list.archive"
  | "task_list.delete"
  | "task_list.sync_orphans"
  // factory mapping (production configuration tool)
  | "factory_mapping.access"
  // production order
  | "production_order.edit_status"
  | "production_order.edit_deadline"
  | "production_order.edit_payments"
  | "production_order.edit_shipment"
  | "production_order.set_timeline"
  | "production_order.start_without_deposit"
  | "production_order.archive"
  | "production_order.delete"
  // forecast
  | "forecast.view_global"
  // project requests (m090)
  | "project.create"
  | "project.approve"
  | "project.enter_cost"
  | "project.enter_logistics"
  | "project.set_pricing"
  | "project.generate_quotation"
  | "project.view_cost"
  | "project.override_cost"
  // CRM sandbox (m104)
  | "prospect.access"
  // finance
  | "finance.view"
  // admin
  | "admin.manage_permissions"
  | "admin.manage_users"
  | "admin.diagnostics"
  // admin master data (m122 — governance: was hardcoded requireAdmin)
  | "admin.manage_products"
  | "admin.manage_categories"
  | "admin.manage_banks"
  | "admin.manage_sales_conditions"
  // pricing (m122 — was requireAdmin / requireAdminOrFinance)
  | "pricing.manage"
  | "pricing.manage_costs"
  // m142 — exemption from the test-phase "hide catalogue prices" flag
  | "pricing.view_catalogue_prices"
  // sales & analytics register (m138 — standalone module; seed in a follow-up
  // matrix migration. Until then admins pass via the anti-lockout floor.)
  | "sales_analytics.view"
  | "sales_order.edit"
  | "sales_client.merge";

/* ===========================================================================
   CACHE
   ===========================================================================
   Module-level Map keyed by role. Each entry holds the Set of enabled
   capability keys for that role + an expiresAt timestamp. On read, if
   the entry is fresh we return the cached Set; otherwise we hit the DB
   and refresh.

   The cache lives in the Node process. In Next.js dev (single process)
   this persists across requests perfectly. In production, each
   serverless instance has its own cache — that's fine, the TTL bounds
   inconsistency to 30s regardless.
*/

const CACHE_TTL_MS = 30_000;

type CacheEntry = {
  enabledSet: Set<string>;
  expiresAt: number;
};

const CACHE = new Map<Role, CacheEntry>();

/**
 * Fetch the set of enabled capability keys for a role, with caching.
 * Internal helper — callers should use hasCapability() or requireCapability().
 */
async function loadEnabledCapabilities(role: Role): Promise<Set<string>> {
  const cached = CACHE.get(role);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.enabledSet;
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("role_permissions")
    .select("permission_key")
    .eq("role", role)
    .eq("enabled", true);
  if (error) {
    console.error(
      "[permissions] loadEnabledCapabilities failed for role",
      role,
      "—",
      error.message
    );
    // Fail closed: return empty so requireCapability denies the action.
    // The deny is loud (throws with the capability name), so the user
    // will see exactly which capability is missing.
    return new Set();
  }
  const set = new Set((data ?? []).map((r: any) => r.permission_key));
  CACHE.set(role, { enabledSet: set, expiresAt: Date.now() + CACHE_TTL_MS });
  return set;
}

/**
 * SECURITY check — uses the REAL role from getCurrentUserRole().
 *
 * Returns true when the current user's REAL role has `capability`
 * enabled. The optional `role` param overrides which role to check
 * (used by hasUiCapability below for View-As simulation).
 *
 * **Use this for server-action enforcement** (requireCapability calls
 * this). NEVER use for UI gating — see hasUiCapability for that.
 *
 * Returns false if:
 *  - the user isn't authenticated (no role)
 *  - the role × capability row is missing or enabled=false
 *  - the DB read errors out (fail-closed for safety)
 */
export async function hasCapability(
  capability: Capability,
  role?: Role
): Promise<boolean> {
  let targetRole = role;
  if (!targetRole) {
    const { role: r } = await getCurrentUserRole();
    if (!r) return false;
    targetRole = r;
  }
  const enabledSet = await loadEnabledCapabilities(targetRole);
  return enabledSet.has(capability);
}

/**
 * UI VISIBILITY check — uses the EFFECTIVE role from getEffectiveRole().
 *
 * Honors the View-As simulation cookie. When a super-admin is viewing
 * as sales, this returns false for admin-only capabilities — so the
 * admin nav links / buttons hide as if they really were a sales user.
 *
 * **Use this for nav links, button visibility, conditional rendering.**
 * NEVER use this for security gates — call hasCapability /
 * requireCapability in the server action layer instead.
 *
 * The split keeps the simulation faithful (UI behaves like the
 * simulated role) AND the security tight (server actions ignore
 * View-As and use the real role).
 */
export async function hasUiCapability(
  capability: Capability
): Promise<boolean> {
  const { effectiveRole } = await getEffectiveRole();
  if (!effectiveRole) return false;
  return hasCapability(capability, effectiveRole);
}

/**
 * Throws unless the current user has `capability`. Use as the first line
 * of any server action that performs a privileged mutation.
 *
 * The error message includes the capability name so the user can ask
 * the right question to their admin ("can you enable
 * production_order.archive for my role?").
 *
 * Always uses the REAL role (not effective) — View-As cannot grant
 * permissions a user doesn't actually have, and a super-admin viewing
 * as sales can still mutate anything they normally could (because the
 * UI button is hidden, but the server doesn't know nor care).
 */
export async function requireCapability(capability: Capability): Promise<void> {
  const ok = await hasCapability(capability);
  if (!ok) {
    throw new Error(
      `Missing required capability: ${capability}. Ask a super-admin to enable this for your role in /permissions/actions.`
    );
  }
}

/**
 * Drop the in-memory cache so the next hasCapability() call hits the DB.
 *
 * Invoked from the admin matrix UI after a save — without this the
 * super-admin would wait up to 30s for their own changes to take effect
 * in the running process. Other server instances still see the change
 * within the TTL window.
 */
/**
 * Throws unless the caller is admin/super_admin OR has `capability`.
 *
 * Anti-lockout migration helper (m122): admin & super_admin ALWAYS pass —
 * exactly reproducing the old `requireAdmin()` floor, so the gate behaves
 * identically the instant the code ships, whether or not the matrix seed
 * migration has been applied yet. The capability is the DELEGATION lever:
 * a super-admin can grant it to another role (e.g. finance → pricing) from
 * /permissions WITHOUT touching code. Uses the REAL role (View-As can't
 * grant real access).
 */
export async function requireCapabilityOrAdmin(capability: Capability): Promise<void> {
  const { role } = await getCurrentUserRole();
  if (isAdminLike(role)) return; // admin / super_admin floor (== old requireAdmin)
  if (await hasCapability(capability)) return; // delegated via the matrix
  throw new Error(
    `Missing required capability: ${capability}. Ask a super-admin to enable this for your role in /permissions/actions.`
  );
}

/**
 * PAGE-ACCESS check (UI/View-As faithful, anti-lockout). True when the
 * EFFECTIVE role is admin/super_admin, OR is finance (when opts.finance),
 * OR holds ANY of `capabilities`. Mirrors requireCapabilityOrAdmin but
 * for page guards + uses the effective role so View-As previews delegated
 * access correctly. Security still lives in the server actions.
 */
export async function canAccessOrAdmin(
  capabilities: Capability[],
  opts?: { finance?: boolean }
): Promise<boolean> {
  const { effectiveRole } = await getEffectiveRole();
  if (isAdminLike(effectiveRole)) return true;
  if (opts?.finance && effectiveRole === "finance") return true;
  for (const c of capabilities) {
    if (await hasCapability(c, effectiveRole ?? undefined)) return true;
  }
  return false;
}

export function clearCapabilityCache(): void {
  CACHE.clear();
}

/**
 * Read the full enabled set for a role — useful for client UIs that
 * need to know what to render conditionally (e.g. hiding a button if
 * the user lacks the capability).
 *
 * **Important:** server actions must STILL call requireCapability().
 * The client-side gate is UX only, not security.
 */
export async function getEnabledCapabilities(
  role: Role
): Promise<Set<string>> {
  return loadEnabledCapabilities(role);
}
