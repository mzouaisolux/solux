/**
 * CAPABILITY CATALOG — the SINGLE SOURCE OF TRUTH for the app's permission
 * capabilities.
 *
 * Add a capability HERE (one line) and it automatically:
 *   1. types `requireCapability()` / `hasCapability()` — the `Capability` union
 *      is DERIVED from this array, so a call site CANNOT use a key that isn't
 *      catalogued (compile error otherwise → no orphans, ever);
 *   2. appears in the Permissions matrix (/permissions/actions), grouped by
 *      module, WITHOUT editing that page;
 *   3. is verified by `npm run check:capabilities` (no orphan / no stale / no
 *      duplicate).
 *
 * No migration is required for a new capability to APPEAR and be TOGGLEABLE:
 * the matrix reads this catalog for the rows and `role_permissions` only for
 * the checkbox state (a not-yet-granted capability simply shows OFF for every
 * role until a super-admin enables it — fail-closed).
 *
 * GROUPING is derived from the key's MODULE PREFIX (the part before the first
 * "."), a naming convention — not a second hardcoded list. `MODULE_LABEL` only
 * prettifies known module ids; an unknown module falls back to a title-cased
 * id, so a brand-new module still groups + labels sensibly on its own.
 */

export type CapabilityDef = {
  /** Stable technical key, `module.action`. */
  key: string;
  /** Human-readable label. Optional — falls back to an auto label from the key. */
  label?: string;
  /** Optional longer help text (shown on hover). */
  description?: string;
};

// Order here = display order in the matrix (grouped by module as they appear).
export const CAPABILITY_CATALOG = [
  // Quotations & invoicing
  { key: "quotation.create", label: "Create & edit quotations / invoices" },
  { key: "quotation.cancel", label: "Cancel a quotation" },
  { key: "quotation.archive", label: "Archive a quotation" },
  { key: "quotation.delete", label: "Delete a quotation" },
  // Service requests (projects)
  { key: "project.create", label: "Create service requests" },
  { key: "project.approve", label: "Approve service requests" },
  { key: "project.enter_cost", label: "Enter factory cost" },
  { key: "project.enter_logistics", label: "Enter packing & freight" },
  { key: "project.set_pricing", label: "Set pricing (margins)" },
  { key: "project.generate_quotation", label: "Generate a quotation from a request" },
  { key: "project.view_cost", label: "View RMB cost" },
  { key: "project.override_cost", label: "Override the factory cost (audited)" },
  {
    key: "project.view_overview",
    label: "View the Service Request overview (all requests)",
    description:
      "Read-only central list of EVERY service request in the system (status, owner, dates) — supervision visibility, no workflow actions.",
  },
  // Task lists
  { key: "task_list.validate", label: "Validate / release task lists" },
  { key: "task_list.reject", label: "Reject a task list" },
  { key: "task_list.archive", label: "Archive a task list" },
  { key: "task_list.delete", label: "Delete a task list" },
  { key: "task_list.sync_orphans", label: "Sync orphan task lists" },
  // Factory mapping
  { key: "factory_mapping.access", label: "Access Factory Mapping" },
  // Production orders
  { key: "production_order.edit_status", label: "Edit production status" },
  { key: "production_order.edit_deadline", label: "Edit production deadline" },
  { key: "production_order.edit_payments", label: "Edit payments (deposit / balance)" },
  { key: "production_order.edit_shipment", label: "Edit shipment & logistics" },
  { key: "production_order.set_timeline", label: "Set the production timeline" },
  { key: "production_order.start_without_deposit", label: "Start production without a deposit" },
  { key: "production_order.archive", label: "Archive a production order" },
  { key: "production_order.delete", label: "Delete a production order" },
  // Sales orders / clients
  { key: "sales_order.edit", label: "Edit sales orders" },
  { key: "sales_client.merge", label: "Merge client records" },
  // Pricing
  { key: "pricing.manage", label: "Manage pricing lists" },
  { key: "pricing.manage_costs", label: "Manage / enter costs" },
  { key: "pricing.view_catalogue_prices", label: "View catalogue prices (flag exemption)" },
  // Finance
  { key: "finance.view", label: "View Finance (balances & LC)" },
  // Forecast
  { key: "forecast.view_global", label: "View the global forecast" },
  // Sales & analytics
  { key: "sales_analytics.view", label: "View the Sales & Analytics register" },
  // Prospects / CRM
  { key: "prospect.access", label: "Access prospects / CRM sandbox" },
  // Administration
  { key: "admin.manage_permissions", label: "Manage the permissions matrix" },
  { key: "admin.manage_users", label: "Manage users & roles" },
  { key: "admin.diagnostics", label: "Access admin diagnostics" },
  { key: "admin.manage_products", label: "Manage products" },
  { key: "admin.manage_categories", label: "Manage categories & config fields" },
  { key: "admin.manage_banks", label: "Manage bank accounts" },
  { key: "admin.manage_sales_conditions", label: "Manage sales conditions" },
] as const satisfies readonly CapabilityDef[];

/**
 * The `Capability` union — DERIVED from the catalog. This is what makes the
 * system self-maintaining: `requireCapability(cap: Capability)` accepts ONLY
 * keys present above, so any capability the app enforces is guaranteed to be
 * in the catalog (and therefore in the matrix).
 */
export type Capability = (typeof CAPABILITY_CATALOG)[number]["key"];

/** Every capability key, in catalog order. */
export const ALL_CAPABILITY_KEYS: readonly Capability[] = CAPABILITY_CATALOG.map(
  (c) => c.key
);

/** The module id = the part before the first "." (naming convention). */
export function capabilityModuleId(key: string): string {
  const i = key.indexOf(".");
  return i === -1 ? "other" : key.slice(0, i);
}

// Pretty names for known modules. NOT required for correctness — an unknown
// module falls back to a title-cased id, so new modules group + label on their
// own. This map is optional polish, not a second capability list.
const MODULE_LABEL: Record<string, string> = {
  quotation: "Quotations",
  project: "Service Requests",
  task_list: "Task Lists",
  factory_mapping: "Factory Mapping",
  production_order: "Production Orders",
  sales_order: "Sales Orders",
  sales_client: "Clients",
  pricing: "Pricing",
  finance: "Finance",
  forecast: "Forecast",
  sales_analytics: "Sales & Analytics",
  prospect: "Prospects / CRM",
  admin: "Administration",
};

function titleCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Pretty module name — override map first, else a title-cased id (automatic). */
export function moduleLabel(moduleId: string): string {
  return MODULE_LABEL[moduleId] ?? titleCase(moduleId);
}

/** Human label for a capability — explicit label, else auto from the action. */
export function capabilityLabel(def: CapabilityDef): string {
  if (def.label) return def.label;
  const dot = def.key.indexOf(".");
  return titleCase(dot === -1 ? def.key : def.key.slice(dot + 1));
}

export type CapabilityGroup = {
  moduleId: string;
  label: string;
  caps: { key: string; label: string; description?: string }[];
};

/**
 * The catalog grouped by module, in catalog order. This is what the matrix
 * page renders — so the page has ZERO hardcoded capability or group list.
 */
export function groupCapabilities(
  catalog: readonly CapabilityDef[] = CAPABILITY_CATALOG
): CapabilityGroup[] {
  const groups: CapabilityGroup[] = [];
  const byModule = new Map<string, CapabilityGroup>();
  for (const def of catalog) {
    const moduleId = capabilityModuleId(def.key);
    let g = byModule.get(moduleId);
    if (!g) {
      g = { moduleId, label: moduleLabel(moduleId), caps: [] };
      byModule.set(moduleId, g);
      groups.push(g);
    }
    g.caps.push({
      key: def.key,
      label: capabilityLabel(def),
      description: def.description,
    });
  }
  return groups;
}
