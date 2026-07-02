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
  | { kind: "adminLikeOrFinance" }
  // admin/super_admin OR any of these capabilities (+ optionally finance).
  // Anti-lockout: admins always pass even before the matrix is seeded.
  | { kind: "capabilityOrAdmin"; capabilities: Capability[]; includeFinance?: boolean };

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

  // 2) Clients & Projects — clients, the commercial overview, and the
  //    custom-project / tender lifecycle, grouped together because a project
  //    is always tied to a client (Client → Project → Pricing → Quotation →
  //    Order). Merged from the former "Clients & Business" + "Projects".
  //    Every item keeps the SAME visibility its route already enforces.
  {
    id: "clients-projects",
    label: "Clients & Projects",
    href: "/clients",
    groups: [
      {
        // FUTURE CLIENTS — future business not yet active customers. Tender
        // rows are RLS-scoped (m108): a sales rep sees ONLY their assigned
        // tenders here; a director/admin sees all — same pages, different rows.
        title: "Future Clients",
        items: [
          {
            label: "Prospect Companies",
            href: "/prospects?u=prospects&p=companies",
            visibility: { kind: "capability", capability: "prospect.access" },
          },
          {
            label: "Tender Inbox",
            href: "/prospects?u=tenders",
            visibility: { kind: "capability", capability: "prospect.access" },
          },
          {
            label: "Tender Pipeline",
            href: "/prospects/pipeline",
            visibility: { kind: "capability", capability: "prospect.access" },
            description: "Work accepted tenders to opportunity",
          },
        ],
      },
      {
        // CLIENTS & BUSINESS — active commercial work + the daily create
        // actions, grouped because they belong to one revenue-generating flow.
        title: "Clients & Business",
        items: [
          { label: "Clients", href: "/clients", visibility: { kind: "always" } },
          {
            // ?new=1 opens the create modal (handled in NewClientPanel).
            label: "New client",
            href: "/clients?new=1",
            visibility: { kind: "always" },
          },
          {
            // No CRM opportunities list yet (the affairs list was retired) — for
            // now this is the salesperson's OWN project requests (?mine=1). A
            // real "My Opportunities" comes with the affair/pipeline CRM layer.
            label: "My service requests",
            href: "/projects?mine=1",
            visibility: { kind: "always" },
          },
          {
            label: "New service request",
            href: "/projects/new",
            visibility: { kind: "capability", capability: "project.create" },
          },
          {
            label: "New quotation",
            href: "/documents/new",
            visibility: { kind: "capability", capability: "quotation.create" },
          },
        ],
      },
      {
        // REPORTING — both pages scope their own content (global for
        // management, personal otherwise).
        title: "Reporting",
        items: [
          { label: "Forecast", href: "/forecast", visibility: { kind: "always" } },
          {
            label: "Business overview",
            href: "/business",
            visibility: { kind: "always" },
          },
        ],
      },
    ],
  },

  // 4) Task Lists — Factory mapping lives here (linked to task-list generation)
  {
    id: "task-lists",
    label: "Task Lists",
    href: "/task-lists",
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
        ],
      },
    ],
  },

  // 4) Orders — order tracking (production / shipping / delivery follow-up).
  //    Renamed from "Operations": the module shows orders, deposits, balances,
  //    production status, ETA, shipping & delivery — business language is
  //    "Orders", not "Operations". The route stays /operations (no broken
  //    links); only the label + id change. Filtering lives inside the page.
  {
    id: "orders",
    label: "Orders",
    href: "/operations",
    visibility: { kind: "always" },
    groups: [
      {
        title: "Orders",
        items: [
          { label: "All orders", href: "/operations", visibility: { kind: "always" } },
          {
            label: "In Production",
            href: "/operations?status=in_production",
            visibility: { kind: "always" },
            description: "Active production",
          },
          {
            label: "Shipping",
            href: "/operations?status=shipping",
            visibility: { kind: "always" },
            description: "Booked & shipped",
          },
          {
            label: "Delivered",
            href: "/operations?status=delivered",
            visibility: { kind: "always" },
          },
          {
            label: "Finance — balances & LC",
            href: "/finance",
            visibility: { kind: "capability", capability: "finance.view" },
          },
          {
            label: "Archived",
            href: "/operations?scope=archived",
            visibility: { kind: "always" },
          },
        ],
      },
    ],
  },

  // 4b) Sales — the standalone Sales & Analytics register ("online Excel"): the
  //     since-2019 order ledger + its statistics. Autonomous module (m138), zero
  //     CRM link. Anti-lockout: admins always see it; other roles get it once
  //     sales_analytics.view is granted in the matrix.
  {
    id: "sales",
    label: "Sales",
    href: "/sales",
    visibility: { kind: "capabilityOrAdmin", capabilities: ["sales_analytics.view"], includeFinance: true },
    groups: [],
  },

  // 5) Catalog — product master data: the catalog STRUCTURE that feeds
  //    quotations and production task lists. Pulled OUT of "Pricing" (catalog
  //    structure is not pricing) and given a first-level home so Categories is
  //    discoverable. Each item mirrors its route's existing guard.
  {
    id: "catalog",
    label: "Catalog",
    groups: [
      {
        title: "Product catalog",
        items: [
          {
            label: "Products",
            href: "/admin/products",
            visibility: { kind: "capabilityOrAdmin", capabilities: ["admin.manage_products", "admin.manage_categories"] },
            description: "All products & SKUs",
          },
          {
            label: "Categories",
            href: "/admin/categories",
            visibility: { kind: "adminLike" },
            description: "Structure & config fields",
          },
          {
            label: "Component mappings",
            href: "/admin/components",
            visibility: { kind: "technical" },
            description: "Commercial → internal references",
          },
          {
            label: "Templates",
            href: "/admin/categories#templates",
            visibility: { kind: "adminLike" },
            description: "Reusable field sets",
          },
        ],
      },
    ],
  },

  // 6) Pricing — costs + price lists (catalog structure moved to Catalog).
  {
    id: "pricing",
    label: "Pricing",
    groups: [
      {
        title: "Costs",
        items: [
          {
            label: "Cost Entry",
            href: "/cost-entry",
            visibility: { kind: "capabilityOrAdmin", capabilities: ["pricing.manage_costs"], includeFinance: true },
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
            visibility: { kind: "capabilityOrAdmin", capabilities: ["pricing.manage"] },
            description: "Create a new price list",
          },
          {
            label: "Price List Library",
            href: "/admin/pricing/library",
            visibility: { kind: "capabilityOrAdmin", capabilities: ["pricing.manage"] },
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
          {
            label: "Event Registry",
            href: "/admin/events",
            visibility: { kind: "adminLike" },
            description: "Every event & its consumers (notification, dashboard, KPI, audit)",
          },
        ],
      },
      {
        title: "Company settings",
        items: [
          {
            label: "Sales conditions",
            href: "/admin/sales-conditions",
            visibility: { kind: "capabilityOrAdmin", capabilities: ["admin.manage_sales_conditions"] },
          },
          { label: "Bank accounts", href: "/admin/banks", visibility: { kind: "capabilityOrAdmin", capabilities: ["admin.manage_banks"] } },
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
    if (!v) return;
    if (v.kind === "capability") set.add(v.capability);
    else if (v.kind === "capabilityOrAdmin") v.capabilities.forEach((c) => set.add(c));
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
    case "capabilityOrAdmin":
      return (
        ctx.adminLike ||
        (!!v.includeFinance && ctx.finance) ||
        v.capabilities.some((c) => ctx.granted.has(c))
      );
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

    // A pure direct-link category (no groups, e.g. Dashboard) shows on its own
    // href. A category WITH groups is gated by its visible items only — its
    // href is just the click target and must never force-show an empty section.
    const directLinkVisible =
      cat.groups.length === 0 && !!cat.href && isVisible(cat.visibility, ctx);

    if (groups.length > 0 || directLinkVisible) {
      // Click target (Option A): the section's designated landing page, or —
      // when none is set — its first visible item, so the click always lands
      // on a page the user can actually open.
      const href = cat.href ?? groups[0]?.items[0]?.href;
      out.push({ ...cat, href, groups });
    }
  }
  return out;
}
