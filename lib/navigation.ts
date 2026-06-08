import type { Capability } from "@/lib/permissions";

/**
 * CENTRAL NAVIGATION CONFIG — the single source of truth for the top mega
 * menu. Every menu item declares: label, route (href), and the visibility
 * rule that decides whether the current user sees it. Items are grouped,
 * groups are grouped into top-level categories.
 *
 * PERMISSION MODEL (read this before adding items)
 * ------------------------------------------------
 * Menu visibility MIRRORS each route's already-validated guard — it does
 * NOT introduce a new access rule. For every item, `visibility` is set to
 * the SAME thing the page/route already enforces:
 *   - { kind: "capability", capability } → the page gates on this capability
 *       (hasUiCapability / requireCapability). The ONLY correct choice for a
 *       capability-gated page (Factory mapping, Users, Permissions, …).
 *   - { kind: "adminLike" }              → the page's guard is isAdminLike()
 *       (admin master-data pages: Products, Pricing, Categories, Sales
 *       conditions, Banks). No dedicated capability exists for these.
 *   - { kind: "technical" }              → the page's guard is isTechnicalRole()
 *       (Component mappings).
 *   - { kind: "adminLikeOrFinance" }     → mirrors /cost-entry's guard.
 *   - { kind: "always" }                 → page is reachable by every signed-in
 *       user; content is scoped per-row by RLS/teams, not by page access.
 *
 * The role helpers used here (isAdminLike / isTechnicalRole) are the SAME
 * helpers the route guards use — so the menu can never show a link the route
 * would deny, and never hide a page the user can actually open. Route guards
 * stay independent (in their pages); this file only decides what to RENDER.
 *
 * HOW TO ADD A NEW MENU ITEM (future)
 * -----------------------------------
 *   1. Find (or add) the right category + group below.
 *   2. Add `{ label, href, visibility }` with the visibility that matches the
 *      page's existing guard. If the page is capability-gated, use
 *      { kind: "capability", capability: "<the.same.key>" }.
 *   3. That's it — the mega menu renders it, hides it when the user lacks the
 *      capability/role, and hides the whole group/category if it becomes empty.
 *      No JSX changes, no role checks sprinkled anywhere.
 */

export type NavVisibility =
  | { kind: "always" }
  | { kind: "capability"; capability: Capability }
  | { kind: "adminLike" }
  | { kind: "technical" }
  | { kind: "adminLikeOrFinance" };

export type NavItem = {
  label: string;
  href: string;
  visibility: NavVisibility;
  /** Optional one-line hint shown under the label in the mega panel. */
  description?: string;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export type NavCategory = {
  /** Stable id used as the open/close key in the client menu. */
  id: string;
  label: string;
  /**
   * If set, the category label is a DIRECT link (no mega panel) — used for
   * single-destination categories like Dashboard / Operations. When `groups`
   * also has visible items the panel still opens; the label links here too.
   */
  href?: string;
  /** Visibility of a DIRECT-link category (ignored when groups decide it). */
  visibility?: NavVisibility;
  groups: NavGroup[];
};

/* ===========================================================================
   THE MENU
   =========================================================================== */

export const NAVIGATION: NavCategory[] = [
  // 1) Dashboard — direct link, no panel.
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    visibility: { kind: "always" },
    groups: [],
  },

  // 2) Clients & Business
  {
    id: "clients-business",
    label: "Clients & Business",
    groups: [
      {
        title: "Clients",
        items: [
          { label: "Clients", href: "/clients", visibility: { kind: "always" } },
          {
            // Deep-links to the clients page and auto-opens the creation modal
            // (handled in NewClientPanel via the `?new=1` param). No new access
            // rule: client creation lives on /clients, which is `always`.
            label: "New client",
            href: "/clients?new=1",
            visibility: { kind: "always" },
          },
        ],
      },
      {
        title: "Sales",
        items: [
          {
            label: "Business overview",
            href: "/business",
            visibility: { kind: "always" },
          },
          {
            label: "New quotation",
            href: "/documents/new",
            visibility: { kind: "capability", capability: "quotation.create" },
          },
          { label: "Forecast", href: "/forecast", visibility: { kind: "always" } },
        ],
      },
    ],
  },

  // 3) Projects — custom-project / tender lifecycle (m090/m091). The list is
  //    `always`-visible (RLS scopes rows); the work-queue views mirror their
  //    page guards: approvals→project.approve, cost→project.view_cost,
  //    logistics→project.enter_logistics.
  {
    id: "projects",
    label: "Projects",
    groups: [
      {
        title: "Projects",
        items: [
          {
            label: "Project Requests",
            href: "/projects",
            visibility: { kind: "always" },
            description: "Custom projects & tenders",
          },
          {
            label: "Pending Approvals",
            href: "/projects/approvals",
            visibility: { kind: "capability", capability: "project.approve" },
            description: "Awaiting director decision",
          },
          {
            label: "Cost Requests",
            href: "/projects/cost-requests",
            visibility: { kind: "capability", capability: "project.view_cost" },
            description: "Factory cost to enter",
          },
          {
            label: "Logistics Requests",
            href: "/projects/logistics-requests",
            visibility: { kind: "capability", capability: "project.enter_logistics" },
            description: "Packing & freight to enter",
          },
        ],
      },
    ],
  },

  // 4) Task Lists — Factory mapping lives here (linked to task-list generation)
  {
    id: "task-lists",
    label: "Task Lists",
    groups: [
      {
        title: "Task lists",
        items: [
          { label: "All task lists", href: "/task-lists", visibility: { kind: "always" } },
          {
            label: "Pending validation",
            href: "/task-lists?status=under_validation",
            visibility: { kind: "always" },
          },
          {
            label: "Needs revision",
            href: "/task-lists?status=needs_revision",
            visibility: { kind: "always" },
          },
          {
            label: "Validated",
            href: "/task-lists?status=validated",
            visibility: { kind: "always" },
          },
        ],
      },
      {
        title: "Factory configuration",
        items: [
          {
            label: "Factory mapping",
            href: "/factory-mapping",
            visibility: { kind: "capability", capability: "factory_mapping.access" },
            description: "Per-option factory instructions",
          },
          {
            label: "Component mappings",
            href: "/admin/components",
            visibility: { kind: "technical" },
            description: "Commercial → internal references",
          },
        ],
      },
    ],
  },

  // 4) Operations — direct link (production orders / follow-up all live here).
  {
    id: "operations",
    label: "Operations",
    href: "/operations",
    visibility: { kind: "always" },
    groups: [],
  },

  // 5) Pricing — its own top-level category, split by single responsibility:
  //    Catalog & costs (products / categories / cost entry) and Price lists
  //    (create vs the Library management workspace).
  {
    id: "pricing",
    label: "Pricing",
    groups: [
      {
        title: "Catalog & costs",
        items: [
          {
            label: "Product Catalog",
            href: "/admin/products",
            visibility: { kind: "adminLike" },
            description: "Categories + products in one workspace",
          },
          {
            label: "Cost Entry",
            href: "/cost-entry",
            visibility: { kind: "adminLikeOrFinance" },
            description: "Finance — RMB costs & versions",
          },
        ],
      },
      {
        title: "Price lists",
        items: [
          {
            label: "Price Lists",
            href: "/admin/pricing",
            visibility: { kind: "adminLike" },
            description: "Create a new price list",
          },
          {
            label: "Price List Library",
            href: "/admin/pricing/library",
            visibility: { kind: "adminLike" },
            description: "Manage, assign & publish all lists",
          },
        ],
      },
    ],
  },

  // 6) Admin — Users, Roles & Permissions grouped together + company/system.
  {
    id: "admin",
    label: "Admin",
    groups: [
      {
        title: "Access & permissions",
        items: [
          {
            label: "Users",
            href: "/admin/users",
            visibility: { kind: "capability", capability: "admin.manage_users" },
            description: "Assign roles, manage accounts",
          },
          {
            label: "Permissions",
            href: "/permissions/actions",
            visibility: { kind: "capability", capability: "admin.manage_permissions" },
            description: "Role × capability matrix",
          },
          {
            label: "Roles & teams",
            href: "/permissions/teams",
            visibility: { kind: "capability", capability: "admin.manage_permissions" },
            description: "Teams, members & scopes",
          },
        ],
      },
      {
        title: "Company settings",
        items: [
          {
            label: "Sales conditions",
            href: "/admin/sales-conditions",
            visibility: { kind: "adminLike" },
          },
          { label: "Bank accounts", href: "/admin/banks", visibility: { kind: "adminLike" } },
        ],
      },
      {
        title: "System",
        items: [
          {
            label: "Diagnostics",
            href: "/admin/diagnostics",
            visibility: { kind: "capability", capability: "admin.diagnostics" },
          },
        ],
      },
    ],
  },
];

/* ===========================================================================
   RESOLVER
   =========================================================================== */

/**
 * Resolution context. The caller (components/Nav.tsx) pre-computes the role
 * flags using the SAME validated helpers the route guards use
 * (`isAdminLike` / `isTechnicalRole` from lib/types) and resolves the
 * capability set via `hasUiCapability`. Passing booleans keeps this module
 * dependency-free (no `@/` runtime imports) so it stays pure and testable,
 * and means there are NO role-name literals in the menu config.
 */
export type NavContext = {
  /** Capabilities the user has (resolved via hasUiCapability, EFFECTIVE role). */
  granted: Set<Capability>;
  /** isAdminLike(effectiveRole). */
  adminLike: boolean;
  /** isTechnicalRole(effectiveRole). */
  technical: boolean;
  /** effectiveRole === "finance". */
  finance: boolean;
};

/** All distinct capability keys referenced anywhere in the menu. The Nav
 *  resolves these in one batch (hasUiCapability) before filtering. */
export function navCapabilities(): Capability[] {
  const set = new Set<Capability>();
  const visit = (v?: NavVisibility) => {
    if (v && v.kind === "capability") set.add(v.capability);
  };
  for (const cat of NAVIGATION) {
    visit(cat.visibility);
    for (const g of cat.groups) for (const i of g.items) visit(i.visibility);
  }
  return [...set];
}

/** Whether a single visibility rule passes for the given context. */
export function isVisible(v: NavVisibility | undefined, ctx: NavContext): boolean {
  if (!v) return true;
  switch (v.kind) {
    case "always":
      return true;
    case "capability":
      return ctx.granted.has(v.capability);
    case "adminLike":
      return ctx.adminLike;
    case "technical":
      return ctx.technical;
    case "adminLikeOrFinance":
      return ctx.adminLike || ctx.finance;
  }
}

/**
 * Prune the menu to what `ctx` is allowed to see:
 *   - drop items whose visibility fails,
 *   - drop groups left with no items,
 *   - drop categories left with no groups AND no visible direct link.
 * Returns plain serializable data, safe to hand to the client mega menu.
 */
export function buildVisibleNavigation(ctx: NavContext): NavCategory[] {
  const out: NavCategory[] = [];
  for (const cat of NAVIGATION) {
    const groups = cat.groups
      .map((g) => ({
        title: g.title,
        items: g.items.filter((i) => isVisible(i.visibility, ctx)),
      }))
      .filter((g) => g.items.length > 0);

    const directLinkVisible = !!cat.href && isVisible(cat.visibility, ctx);

    if (groups.length > 0 || directLinkVisible) {
      out.push({ ...cat, groups });
    }
  }
  return out;
}
