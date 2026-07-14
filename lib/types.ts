/**
 * Application roles.
 *
 * `super_admin` is a virtual role: it's not stored in `user_roles.role`
 * (which stays as "admin"). Instead, it's surfaced when `user_roles.super_admin`
 * is true — the only practical difference is that super-admins can use the
 * "View As" simulator in the Nav.
 */
export type Role =
  | "admin"
  | "sales"
  | "task_list_manager"
  | "operations"
  | "super_admin"
  | "finance"
  | "sales_director";

/** True for any role that has admin-level write access. */
export const isAdminLike = (role: Role | null): boolean =>
  role === "admin" || role === "super_admin";

/** True when the role has technical-review privileges on task lists
 *  and production orders (working days, deadlines, shipment edits, etc.).
 *  Operations is treated identically to Task List Manager — same scope
 *  of "operational reality" responsibilities, just a different label
 *  for org-chart purposes. */
export const isTechnicalRole = (role: Role | null): boolean =>
  isAdminLike(role) ||
  role === "task_list_manager" ||
  role === "operations";

/** True for roles that SUPERVISE commercial workflows — approve quote
 *  validations, reassign deal / account / affair ownership — WITHOUT being a
 *  technical admin. Sales Director sits here alongside admin / super_admin.
 *  Deliberately separate from isAdminLike (no admin/system powers) and
 *  isTechnicalRole (no production powers): a commercial-supervision lever. */
export const canSupervise = (role: Role | null): boolean =>
  isAdminLike(role) || role === "sales_director";

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  sales: "Sales",
  sales_director: "Sales director",
  task_list_manager: "Task list manager",
  operations: "Operations",
  finance: "Finance",
};

/** Compact, ALL CAPS for inline badges. */
export const ROLE_SHORT_LABEL: Record<Role, string> = {
  super_admin: "Super",
  admin: "Admin",
  sales: "Sales",
  sales_director: "Director",
  task_list_manager: "TLM",
  operations: "Ops",
  finance: "Finance",
};

/** Roles selectable in the "View As" simulator. */
export const VIEW_AS_ROLES: Role[] = [
  "super_admin",
  "admin",
  "sales_director",
  "operations",
  "task_list_manager",
  "sales",
  "finance",
];

/**
 * Roles that can actually be stored in `user_roles.role` (DB-storable).
 *
 * `super_admin` is intentionally absent here: it's a separate boolean
 * flag on the user_roles row, NOT a value of the role column. The DB
 * CHECK constraint on user_roles.role rejects 'super_admin' literally.
 *
 * Use this list for:
 *  - The role assignment dropdown on /admin/users
 *  - Validating role values before passing to admin_set_user_role RPC
 *
 * To promote someone to super-admin, use the toggle (which keeps the
 * role at 'admin' and flips the super_admin flag).
 */
export type AssignableRole =
  | "admin"
  | "operations"
  | "task_list_manager"
  | "sales"
  | "sales_director"
  | "finance";
export const ASSIGNABLE_ROLES: AssignableRole[] = [
  "admin",
  "sales_director",
  "operations",
  "task_list_manager",
  "sales",
  "finance",
];

/* ===========================================================================
   PROJECT REQUESTS (m090) — the custom-project / tender lifecycle spine.
   =========================================================================== */

export type ProjectRequestStatus =
  | "draft"
  | "submitted"
  | "waiting_director_approval"
  | "waiting_factory_cost"
  | "waiting_logistics"
  | "ready_for_pricing"
  | "priced"
  | "quotation_generated"
  | "won"
  | "lost"
  | "cancelled";

export const PROJECT_REQUEST_STATUSES: ProjectRequestStatus[] = [
  "draft",
  "submitted",
  "waiting_director_approval",
  "waiting_factory_cost",
  "waiting_logistics",
  "ready_for_pricing",
  "priced",
  "quotation_generated",
  "won",
  "lost",
  "cancelled",
];

export const PROJECT_REQUEST_STATUS_LABEL: Record<ProjectRequestStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  waiting_director_approval: "Waiting director review",
  // Both internal waiting phases present as one stage to the user (m096+):
  // once sent to Operations the project is actively being processed.
  waiting_factory_cost: "Operations in progress",
  waiting_logistics: "Operations in progress",
  ready_for_pricing: "Ready for pricing",
  priced: "Priced",
  quotation_generated: "Quotation generated",
  won: "Won",
  lost: "Lost",
  cancelled: "Cancelled",
};

/** A child cost/logistics request's own lifecycle. */
export type ProjectSubRequestStatus = "pending" | "completed" | "cancelled";

export type ProjectRequestFileCategory =
  | "tender"
  | "spec"
  | "drawing"
  | "image"
  | "requirement"
  | "packing"
  | "costing" // m157 — costing Excel (cost-sensitive: view_cost only)
  | "pole_drawing" // m157 — pole drawing used for the quotation
  | "other";

export const PROJECT_FILE_CATEGORY_LABEL: Record<ProjectRequestFileCategory, string> = {
  tender: "Tender document",
  spec: "Technical spec",
  drawing: "Drawing",
  image: "Image",
  requirement: "Customer requirement",
  packing: "Packing list",
  costing: "Costing Excel",
  pole_drawing: "Pole drawing",
  other: "Other",
};

/**
 * Categories kept OUT of the free-category dropdown: they belong to a
 * dedicated, capability-scoped uploader ('costing' is cost-sensitive and
 * hidden from Sales — offering it in the general picker would let someone
 * upload a file they then cannot see).
 */
export const PROJECT_FILE_SPECIALIZED_CATEGORIES: ReadonlySet<ProjectRequestFileCategory> =
  new Set(["costing"]);

/** A single container line on a packing list (m094). */
export const PROJECT_CONTAINER_TYPES = ["20GP", "40GP", "40HQ", "LCL"] as const;
export type ProjectContainerType = (typeof PROJECT_CONTAINER_TYPES)[number];
export type PackingContainer = { type: string; quantity: number };

/** A freight breakdown line (m097) — derived from the packing list; only the
 *  per-unit rate is entered. Total = quantity × freight_per_unit. */
export type FreightContainer = { type: string; quantity: number; freight_per_unit: number };

export type ProjectRequest = {
  id: string;
  name: string;
  client_id: string | null;
  product_category_id: string | null;
  country: string | null;
  quantity: number | null;
  opportunity_value: number | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  // technical — solar product
  led_power: string | null;
  solar_panel_size: string | null;
  battery_spec: string | null;
  controller: string | null;
  iot_required: boolean;
  additional_notes: string | null;
  // pole (m096)
  pole_required: boolean;
  pole_quantity: number | null;
  pole_height: string | null;
  arm_length: string | null;
  pole_notes: string | null;
  // freight brief captured at creation (m096)
  freight_transport_mode: string | null;
  freight_destination: string | null;
  freight_notes: string | null;
  // information required (sales asks; director confirms at approval) — m091
  req_product_pricing: boolean;
  req_packing_list: boolean;
  req_freight: boolean;
  // pricing — independent Product vs Pole (m091)
  product_margin_pct: number | null;
  product_commission_pct: number | null;
  pole_margin_pct: number | null;
  pole_commission_pct: number | null;
  // final selling prices stored at pricing time (Sales-visible; cost is not)
  product_final_price: number | null;
  pole_final_price: number | null;
  // quotation output selection (m091)
  quote_include_product: boolean;
  quote_include_pole: boolean;
  quote_include_freight: boolean;
  // pricing (legacy notes)
  selling_price_per_unit: number | null;
  margin_notes: string | null;
  // workflow
  status: ProjectRequestStatus;
  generated_document_id: string | null;
};

export type FactoryCostRequest = {
  id: string;
  project_request_id: string;
  status: ProjectSubRequestStatus;
  product_cost_rmb: number | null; // RMB master (m091)
  pole_cost_rmb: number | null; // RMB master (m091)
  cost_per_unit: number | null; // legacy (m090), unused
  cost_notes: string | null;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
};

export type PackingListRequest = {
  id: string;
  project_request_id: string;
  status: ProjectSubRequestStatus;
  containers: PackingContainer[]; // m094 — multiple rows
  num_containers: number | null; // legacy (m091), unused
  container_type: string | null; // legacy (m091), unused
  total_cbm: number | null;
  loading_notes: string | null;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
};

export type FreightCostRequest = {
  id: string;
  project_request_id: string;
  status: ProjectSubRequestStatus;
  transport_mode: string | null; // m096
  incoterm: string | null; // m094
  port_of_destination: string | null; // m094
  destination_country: string | null;
  containers: FreightContainer[]; // m097 — per-container-type breakdown from packing
  freight_cost_per_container: number | null; // legacy (m091), unused
  estimated_total_freight: number | null; // auto = sum(quantity × freight_per_unit)
  notes: string | null;
  // m098 — freight validity + update workflow
  valid_until: string | null; // YYYY-MM-DD; freight pricing expires after this
  update_requested_at: string | null;
  update_requested_by: string | null;
  update_count: number;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
};

/** Freight validity state (m098). `none` = no validity set yet. */
export type FreightStatus = "valid" | "expiring_soon" | "expired" | "none";
// Owner spec 2026-07-08 (Task List industrial round): freight prices now move
// much faster than before — 60/90-day validities no longer reflect reality.
// Pills are 7/15/30 days; anything longer goes through the custom date picker.
export const FREIGHT_VALIDITY_PERIODS = [7, 15, 30] as const;

/** Append-only freight update audit row (m098). */
export type FreightCostAudit = {
  id: string;
  project_request_id: string;
  freight_cost_request_id: string | null;
  old_containers: FreightContainer[];
  new_containers: FreightContainer[];
  old_total: number | null;
  new_total: number | null;
  old_valid_until: string | null;
  new_valid_until: string | null;
  note: string | null;
  changed_by: string | null;
  changed_at: string;
};

/**
 * Project Product (m095) — the sellable item generated when a project is
 * priced. A SNAPSHOT scoped to the project; never a catalog product.
 */
export type ProjectProduct = {
  id: string;
  project_request_id: string;
  product_category_id: string | null;
  commercial_description: string | null;
  led_power: string | null;
  solar_panel_size: string | null;
  battery_spec: string | null;
  controller: string | null;
  pole_height: string | null;
  arm_length: string | null; // m096
  iot_required: boolean;
  currency: string;
  quantity: number | null;
  pole_quantity: number | null; // m096
  product_unit_price: number | null;
  pole_unit_price: number | null;
  freight_total: number | null;
  created_at: string;
  updated_at: string;
};

/** Freight transport modes (m096). */
export const TRANSPORT_MODES = ["sea", "air", "road", "multimodal"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];
export const TRANSPORT_MODE_LABEL: Record<TransportMode, string> = {
  sea: "Sea Freight",
  air: "Air Freight",
  road: "Road Freight",
  multimodal: "Multimodal",
};
/** Tolerant label lookup (handles legacy/free-text values). */
export function transportModeLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return (TRANSPORT_MODE_LABEL as Record<string, string>)[v] ?? v;
}

export type FactoryCostAudit = {
  id: string;
  project_request_id: string;
  factory_cost_request_id: string | null;
  field: string;
  old_value: number | null;
  new_value: number | null;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
};

export type LogisticsRequest = {
  id: string;
  project_request_id: string;
  status: ProjectSubRequestStatus;
  num_containers: number | null;
  container_type: string | null;
  total_cbm: number | null;
  total_weight: number | null;
  lead_time_days: number | null;
  logistics_notes: string | null;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
};

export type ProjectRequestFile = {
  id: string;
  project_request_id: string;
  storage_path: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  category: ProjectRequestFileCategory;
  uploaded_by: string | null;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  category: string | null;
  base_price: number;
  image_url: string | null;
  active: boolean;
  sku?: string | null;
  category_id?: string | null;
};

/** A named price list with three after-tax target margins (m084, pricing v4).
 *  The margins here are the list-level DEFAULT; per-category overrides live in
 *  price_list_margins (m086). */
export type PriceListStatus = "draft" | "published" | "archived";

export type PriceList = {
  id: string;
  name: string;
  target_margin1: number; // tier 1 — under 50 pcs
  target_margin2: number; // tier 2 — 50–150 pcs
  target_margin3: number; // tier 3 — over 150 pcs
  is_default: boolean;
  /** v5 (m087): a price list belongs to one product category. */
  category_id?: string | null;
  status?: PriceListStatus;
  /**
   * m170 — when true, this published list is offered as a catalogue price
   * source in the quote builder (auto-fill → pricing_source='catalogue').
   * When false (default), its prices are never auto-fetched: sales must use
   * an approved Service Request or manual entry.
   */
  use_as_catalogue_pricing?: boolean;
  cost_batch_id?: string | null;
  created_by?: string | null;
  effective_date?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string | null;
  updated_by?: string | null;
};

/** Per-(price list, category) margin override (m086). */
export type PriceListMargin = {
  id: string;
  price_list_id: string;
  category_id: string;
  target_margin1: number;
  target_margin2: number;
  target_margin3: number;
};

export type PriceListAssigneeType = "team" | "group" | "seller";

/** Binds a price list to a team / group / seller (m084). */
export type PriceListAssignment = {
  id: string;
  price_list_id: string;
  assignee_type: PriceListAssigneeType;
  assignee_id: string | null;
  assignee_name: string | null;
  created_at?: string;
};

/**
 * A product category. Owns the dynamic configuration fields that apply to
 * every product in that category. Used to be called "product family" — now
 * unified with the existing `products.category` text to avoid duplication.
 */
export type ProductCategory = {
  id: string;
  name: string;
  position: number;
};

export type ConfigFieldType =
  | "dropdown"
  | "text"
  | "number"
  | "checkbox"
  | "textarea"
  | "checkbox_group";
export const CONFIG_FIELD_TYPES: ConfigFieldType[] = [
  "dropdown",
  "text",
  "number",
  "checkbox",
  "textarea",
  "checkbox_group",
];

/** Friendly labels shown in admin + sales UIs. */
export const CONFIG_FIELD_TYPE_LABEL: Record<ConfigFieldType, string> = {
  dropdown: "Dropdown",
  text: "Short text",
  number: "Number",
  checkbox: "Yes / No",
  textarea: "Long text",
  checkbox_group: "Checkbox Group",
};

/** Plain-English help text shown under each type in the admin picker. */
export const CONFIG_FIELD_TYPE_HINT: Record<ConfigFieldType, string> = {
  dropdown: "Pick from a list — e.g. Battery type, CCT, Optics",
  text: "One-line text — e.g. Logo wording, Cable colour",
  number: "Numeric input — e.g. Overall pole height in meters",
  checkbox: "On/off — e.g. Laser logo, Motion sensor",
  textarea: "Multi-line notes — e.g. Packaging instructions",
  checkbox_group: "Multi-select — tick several options e.g. Additional options, Certifications",
};

/** Compact icon glyph rendered on the type-picker cards. */
export const CONFIG_FIELD_TYPE_ICON: Record<ConfigFieldType, string> = {
  dropdown: "▾",
  text: "Aa",
  number: "#",
  checkbox: "✓",
  textarea: "¶",
  checkbox_group: "☑",
};

/**
 * Sentinel stored in `config_values[field_name]` when the sales user picks
 * "Custom…" from a dropdown that allows custom values. Pairs with a second
 * key `${field_name}__custom` holding the free-text content.
 */
export const CUSTOM_OPTION_SENTINEL = "__custom__";
export const customValueKey = (fieldName: string) => `${fieldName}__custom`;

/**
 * Returns what should be displayed/printed for a configuration value.
 * - If the stored value is the "Custom…" sentinel, returns the typed text.
 * - Otherwise returns the raw value (or "").
 *
 * Always use this when rendering config_values outside the editor — PDFs,
 * detail pages, summary sidebars — so the sentinel never leaks to users.
 */
export function resolveConfigValue(
  fieldName: string,
  values: Record<string, string> | null | undefined
): string {
  if (!values) return "";
  const raw = values[fieldName];
  if (raw === CUSTOM_OPTION_SENTINEL) {
    return values[customValueKey(fieldName)] ?? "";
  }
  return raw ?? "";
}

/** True if the key is a custom-value side-channel (e.g. "Battery type__custom"). */
export function isCustomValueKey(key: string): boolean {
  return key.endsWith("__custom");
}

/**
 * Sales vs technical scope for a configuration field:
 *  - "sales": editable by anyone, appears on the sales quotation builder.
 *  - "technical": editable only by task_list_manager + admin, appears in the
 *    technical section of the production task list. Used for internal
 *    references (battery codes, panel codes, drawing numbers, etc.).
 */
export type ConfigFieldScope = "sales" | "technical" | "both";
export const CONFIG_FIELD_SCOPES: ConfigFieldScope[] = ["sales", "technical", "both"];
export const CONFIG_FIELD_SCOPE_LABEL: Record<ConfigFieldScope, string> = {
  sales: "Sales",
  technical: "Technical",
  both: "Both",
};

/** Three-value access level that replaces the boolean internal_only. */
export type ConfigFieldAccess = "everyone" | "internal" | "admin";

export type ConfigField = {
  id: string;
  category_id: string;
  field_name: string;
  field_type: ConfigFieldType;
  required: boolean;
  default_value: string | null;
  placeholder: string | null;
  field_order: number;
  visible_in_quotation: boolean;
  visible_in_task_list: boolean;
  /** Factory-facing visibility (default true — factory sees same as task list). */
  visible_in_factory?: boolean;
  internal_only: boolean;
  active: boolean;
  /**
   * Sales vs technical scope. 'both' = editable in quotation builder AND
   * task list technical review. Defaults to "sales" for backward compat.
   */
  field_scope?: ConfigFieldScope;
  /**
   * Dropdown-only. When true, the UI shows a "Custom…" choice that reveals a
   * free-text input. The typed value is stored alongside the dropdown value.
   */
  allow_custom_value?: boolean;
  /** Whether the field is mandatory before a production order can be released. */
  required_for_production?: boolean;
  /** Three-level access control. Supersedes internal_only (kept in sync). */
  access_level?: ConfigFieldAccess;
  /** Populated client-side when joined with config_field_options. */
  options?: ConfigFieldOption[];
};

/**
 * Commercial→internal reference. The task list manager uses this dictionary
 * to translate simplified sales references ("18RH battery") into real
 * factory part numbers ("LFP-18RH-32700-G2W") when enriching task lists.
 */
export type ComponentMapping = {
  id: string;
  commercial_name: string;
  internal_reference: string;
  category: string | null;
  notes: string | null;
  active: boolean;
};

/**
 * Factory instruction mapping. Translates a sales-facing dropdown option
 * (e.g. Battery=18H) into a detailed factory instruction (e.g. "Use
 * LiFePO4 12.8V 30Ah, cell type 32700, BMS reference XXX…"). 1:1 with a
 * config_field_option.
 */
export type FactoryMapping = {
  id: string;
  field_id: string;
  option_id: string;
  factory_instruction: string;
  factory_code: string | null;
  notes: string | null;
  active: boolean;
};

/**
 * Resolution result for one sales config value on a task list line.
 *  - "override":      a per-ORDER override exists (TLM customized this line).
 *  - "client_preset": resolved via this client's saved technical preset.
 *  - "mapping":       resolved via the global factory_mappings table (default).
 *  - "missing":       no mapping is configured — render a warning.
 *
 * Resolution priority: override > client_preset > mapping > missing.
 */
export type FactoryInstructionSource =
  | "override"
  | "client_preset"
  | "mapping"
  | "missing";
export type ResolvedFactoryInstruction = {
  field_name: string;
  sales_value: string;
  text: string;
  source: FactoryInstructionSource;
  /** Present when source !== "missing" — used by override-clear actions. */
  mapping_id?: string | null;
  factory_code?: string | null;
};

/**
 * Normalized key for the option lookup map: `${category_id}|${field_name}|${value}`.
 *
 * MUST be CATEGORY-SCOPED. config_field field names are only unique WITHIN a
 * category, so two families that share a field+value (notably a family and the
 * copy produced by duplicateCategory — identical field names AND values) would
 * collide on a bare `${field_name}|${value}` key. A global, last-wins map then
 * points the key at ONE category's option_id, and a mapping bound to the OTHER
 * category's option_id resolves to "missing" even though it exists and is
 * active. Prefixing with category_id makes the key globally unique so every
 * line resolves against its own family's options. Field name verbatim; value
 * lower-cased (case-insensitive value match — same convention as before).
 *
 * Every builder of an `optionIdByFieldValue` map AND `resolveFactoryInstruction`
 * use THIS helper — one source of truth so the key format can never drift.
 */
export function optionLookupKey(
  categoryId: string | null | undefined,
  fieldName: string,
  value: string
): string {
  return `${categoryId ?? ""}|${fieldName}|${String(value).toLowerCase()}`;
}

/**
 * Resolves a single sales (field_name, sales_value) into a factory
 * instruction using overrides → global mapping → missing fallback.
 *
 * `optionIdByFieldValue` maps the CATEGORY-SCOPED `optionLookupKey` to the
 * option_id, so the caller can pre-compute it from a flat list of
 * config_field_options across any number of categories without cross-family
 * collisions.
 */
export function resolveFactoryInstruction(args: {
  /** The line's product category — disambiguates field names shared by other families. */
  categoryId: string | null;
  fieldName: string;
  salesValue: string;
  overrides: Record<string, string> | null | undefined;
  /** This client's saved technical preset (fieldName → override text). */
  clientOverrides?: Record<string, string> | null;
  /** Map of option_id → FactoryMapping. */
  mappingsByOption: Map<string, FactoryMapping>;
  /** Map of `optionLookupKey(category_id, field_name, value)` → option_id. */
  optionIdByFieldValue: Map<string, string>;
}): ResolvedFactoryInstruction {
  const {
    categoryId,
    fieldName,
    salesValue,
    overrides,
    clientOverrides,
    mappingsByOption,
    optionIdByFieldValue,
  } = args;

  const overrideText = overrides?.[fieldName];
  const clientText = clientOverrides?.[fieldName];
  // Look up the canonical mapping so we can attach mapping_id/code even when
  // an override is present (useful for "reset to mapping" actions).
  const optionId = optionIdByFieldValue.get(
    optionLookupKey(categoryId, fieldName, salesValue)
  );
  const mapping = optionId ? mappingsByOption.get(optionId) : undefined;

  // Priority: order override > client preset > global mapping > missing.
  if (overrideText != null && overrideText.trim() !== "") {
    return {
      field_name: fieldName,
      sales_value: salesValue,
      text: overrideText,
      source: "override",
      mapping_id: mapping?.id ?? null,
      factory_code: mapping?.factory_code ?? null,
    };
  }

  if (clientText != null && clientText.trim() !== "") {
    return {
      field_name: fieldName,
      sales_value: salesValue,
      text: clientText,
      source: "client_preset",
      mapping_id: mapping?.id ?? null,
      factory_code: mapping?.factory_code ?? null,
    };
  }

  if (mapping && mapping.active) {
    return {
      field_name: fieldName,
      sales_value: salesValue,
      text: mapping.factory_instruction,
      source: "mapping",
      mapping_id: mapping.id,
      factory_code: mapping.factory_code,
    };
  }

  return {
    field_name: fieldName,
    sales_value: salesValue,
    text: "",
    source: "missing",
  };
}

export type ConfigFieldOption = {
  id: string;
  field_id: string;
  option_value: string;
  option_order: number;
};

/**
 * Production task list validation workflow:
 *
 *   draft ─► under_validation ─► validated ─► production_ready
 *      ▲          │   │                            │
 *      │          │   ▼                            │
 *      │          │   needs_revision ──────────────┘
 *      │          ▼   ▲ (re-submit)
 *      └──────────┘   │
 *                     │
 *   (anywhere non-terminal) ─► cancelled  [Reject]
 *
 * Stages:
 *  - draft           : sales is still preparing the task list.
 *  - under_validation: sales submitted, waiting for the production team to pick it up.
 *  - needs_revision  : production team bounced it back — sales needs to fix and resubmit.
 *  - validated       : production team accepted; technical enrichment is in progress.
 *  - production_ready: technical work complete — ready for the factory PDF release.
 *  - cancelled       : terminal — rejected.
 *
 * The factory PDF is **not** a status transition. It's a role-gated action
 * (TLM/admin) available when status === "production_ready".
 */
export type ProductionTaskListStatus =
  | "draft"
  | "under_validation"
  | "needs_revision"
  | "validated"
  | "production_ready"
  | "cancelled";

export const TASK_LIST_STATUSES: ProductionTaskListStatus[] = [
  "draft",
  "under_validation",
  "needs_revision",
  "validated",
  "production_ready",
  "cancelled",
];
export const TASK_LIST_STATUS_LABEL: Record<ProductionTaskListStatus, string> = {
  draft: "Draft",
  under_validation: "Under validation",
  needs_revision: "Needs revision",
  validated: "Validated",
  production_ready: "Production ready",
  cancelled: "Cancelled",
};
/** Tailwind classes for the colored dot in the status badge. */
export const TASK_LIST_STATUS_DOT: Record<ProductionTaskListStatus, string> = {
  draft: "bg-neutral-400",
  under_validation: "bg-sky-500",
  needs_revision: "bg-red-500",
  validated: "bg-amber-500",
  production_ready: "bg-emerald-500",
  cancelled: "bg-neutral-300",
};

/**
 * A task list is locked for sales edits once it's submitted for validation —
 * sales can only edit again when the production team bounces it back to
 * `needs_revision` (or starts a fresh draft).
 */
export const TASK_LIST_LOCKED_FOR_SALES: ProductionTaskListStatus[] = [
  "under_validation",
  "validated",
  "production_ready",
  "cancelled",
];
/**
 * Statuses where the production team has work TO DO RIGHT NOW.
 *
 * Drives /production/queue ("Pending production validation"). Only
 * `under_validation` belongs here — that's the only state actively
 * blocking on TLM input. `validated` and `production_ready` are
 * POST-review and used to incorrectly stay in the queue, causing it
 * to accumulate "done" items forever; they're now excluded.
 *
 * `needs_revision` waits on SALES (not TLM) so it also doesn't belong
 * in this TLM-actionable queue.
 *
 * If you need the broader "all task lists the TLM should care about"
 * list, use TASK_LIST_TLM_QUEUE_BROAD below.
 */
export const TASK_LIST_TLM_QUEUE: ProductionTaskListStatus[] = [
  "under_validation",
];

/**
 * Broader view: every status that's part of the production workflow
 * (still active, pre-shipping). Used by stage counters that want to
 * show the full funnel, not just the actionable queue.
 */
export const TASK_LIST_TLM_QUEUE_BROAD: ProductionTaskListStatus[] = [
  "under_validation",
  "validated",
  "production_ready",
];

export type ProductionTaskList = {
  id: string;
  number: string | null;
  quotation_id: string;
  client_id: string | null;
  date: string;
  production_notes: string | null;
  technical_notes: string | null;
  shipping_method: string | null;
  status: ProductionTaskListStatus;
  submitted_at: string | null;
  factory_sent_at: string | null;
};

export type ProductionTaskListLine = {
  id?: string;
  task_list_id?: string;
  product_id: string;
  quantity: number;
  config_values: Record<string, string>;
  /** Technical-only values keyed by field_name (added by task_list_manager). */
  technical_values: Record<string, string>;
  internal_notes: string | null;
  position: number;
};

/**
 * Production order — the operational tracking object that exists after a
 * task list has been validated. Sits "above" the task list:
 *
 *   Quotation (won) → Task list (validated) → Production order (operational)
 *
 * Auto-created when a task list flips to "validated"; one per task list.
 */
export type ProductionOrderStatus =
  | "awaiting_deposit"
  | "deposit_received"
  | "production_scheduled"
  | "in_production"
  | "production_delayed"
  | "production_completed"
  | "shipment_booked"
  | "shipped"
  | "delivered"
  | "cancelled";

export const PRODUCTION_ORDER_STATUSES: ProductionOrderStatus[] = [
  "awaiting_deposit",
  "deposit_received",
  "production_scheduled",
  "in_production",
  "production_delayed",
  "production_completed",
  "shipment_booked",
  "shipped",
  "delivered",
  "cancelled",
];

export const PRODUCTION_ORDER_STATUS_LABEL: Record<
  ProductionOrderStatus,
  string
> = {
  awaiting_deposit: "Awaiting deposit",
  deposit_received: "Deposit received",
  production_scheduled: "Production scheduled",
  in_production: "In production",
  production_delayed: "Production delayed",
  production_completed: "Production completed",
  shipment_booked: "Shipment booked",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** Colored dot used in status badges. */
export const PRODUCTION_ORDER_STATUS_DOT: Record<
  ProductionOrderStatus,
  string
> = {
  awaiting_deposit: "bg-neutral-400",
  deposit_received: "bg-sky-500",
  production_scheduled: "bg-indigo-500",
  in_production: "bg-amber-500",
  production_delayed: "bg-red-500",
  production_completed: "bg-emerald-500",
  shipment_booked: "bg-violet-500",
  shipped: "bg-violet-700",
  delivered: "bg-emerald-700",
  cancelled: "bg-neutral-300",
};

/** Statuses where production is actively running. */
export const PRODUCTION_ACTIVE_STATUSES: ProductionOrderStatus[] = [
  "awaiting_deposit",
  "deposit_received",
  "production_scheduled",
  "in_production",
  "production_delayed",
];

/** Statuses where production is done but shipping is still in motion. */
export const PRODUCTION_SHIPPING_STATUSES: ProductionOrderStatus[] = [
  "production_completed",
  "shipment_booked",
  "shipped",
];

/** Terminal statuses — no further operational changes. */
export const PRODUCTION_TERMINAL_STATUSES: ProductionOrderStatus[] = [
  "delivered",
  "cancelled",
];

/* --------------------------------------------------------------------------
 * Order Documents hub (m099) — files centralized inside a production order.
 * ------------------------------------------------------------------------ */
export type OrderDocumentCategory = "production" | "shipping" | "financial" | "other";
export const ORDER_DOC_CATEGORIES: OrderDocumentCategory[] = [
  "production",
  "shipping",
  "financial",
  "other",
];
export const ORDER_DOC_CATEGORY_LABEL: Record<OrderDocumentCategory, string> = {
  production: "Production",
  shipping: "Shipping",
  financial: "Financial",
  other: "Other",
};

/** One stored file = one VERSION. A logical document = rows sharing group_id. */
export type OrderDocument = {
  id: string;
  production_order_id: string;
  group_id: string;
  version: number;
  name: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  category: OrderDocumentCategory | string;
  uploaded_by: string | null;
  created_at: string;
  archived_at: string | null;
  archived_by: string | null;
};

export type OrderDocumentAuditAction = "upload" | "replace" | "archive" | "restore";
export type OrderDocumentAudit = {
  id: string;
  production_order_id: string;
  document_group_id: string | null;
  action: OrderDocumentAuditAction | string;
  file_name: string | null;
  actor: string | null;
  created_at: string;
};

/**
 * Statuses that mean PRODUCTION IS FINISHED — the single source of truth for
 * "production complete" (status-led model, owner ruling 2026-06-02). Reaching
 * any of these auto-stamps `actual_completion_date` (first time only) and makes
 * the order read as completed everywhere. Excludes `cancelled` (dead, not done).
 * Note: this is PRODUCTION_SHIPPING_STATUSES + `delivered`.
 */
export const PRODUCTION_COMPLETED_STATUSES: ProductionOrderStatus[] = [
  "production_completed",
  "shipment_booked",
  "shipped",
  "delivered",
];

export type ProductionOrder = {
  id: string;
  number: string | null;
  task_list_id: string;
  quotation_id: string;
  client_id: string | null;
  status: ProductionOrderStatus;
  // Operational anchor — stamped when the task list is validated and
  // submitted to production. Acts as "day zero" for working-day-based
  // deadline computation. See migration 021.
  production_validation_date: string | null;
  // How many working days the production team committed to. Used together
  // with production_validation_date to derive the initial deadline.
  production_working_days: number | null;
  initial_production_deadline: string | null;
  current_production_deadline: string | null;
  actual_completion_date: string | null;
  shipment_booked: boolean;
  etd: string | null;
  eta: string | null;
  shipping_notes: string | null;
  // Payment receipts (migration 019). Expected amounts derive from the
  // linked quotation; we only store what's actually been received.
  deposit_received_amount: number;
  deposit_received_at: string | null;
  balance_received_amount: number;
  balance_received_at: string | null;
  payment_notes: string | null;
  // Cash-collection tracking (m114, audit Phase 1). OPTIONAL because the
  // migration may not be applied yet — readers must tolerate undefined.
  // balance_due_date is the MANUAL override; when null/absent the
  // effective due date is derived at read time by
  // computeEffectiveBalanceDueDate (one source of truth — it follows
  // deadline/ETA changes automatically until someone freezes it).
  balance_due_date?: string | null;
  // Letter of Credit validity end — alerts fire when it approaches or
  // passes while the balance is still outstanding.
  lc_expiry_date?: string | null;
  // Deposit override (migration 025) — admin-only escape hatch to
  // launch production before the deposit lands. When set, the row
  // reads "Started without deposit" across the app.
  deposit_override_at: string | null;
  deposit_override_by: string | null;
  deposit_override_reason: string | null;
  // Archive state (migration 024) — soft delete.
  archived_at: string | null;
  archived_by: string | null;
  // Baseline lock (m041). NULL = baseline still editable (legacy /
  // unset). timestamptz = baseline was confirmed and is now read-only.
  // Admin override is gated by capability `production_order.unlock_baseline`.
  baseline_locked_at?: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
};

/**
 * Computed payment state for a production order — derived from the
 * linked quotation's expected amounts + the order's received amounts.
 * Use this to drive payment badges and "production can start" gating.
 */
export type ProductionPaymentState =
  | "no_terms" // Quotation has no payment terms recorded
  | "awaiting_deposit" // 0 < received < expected deposit
  | "deposit_received" // Deposit fully in, balance not yet due / not yet paid
  | "partial_balance" // Some balance received, not yet full
  | "paid_in_full" // Both deposit + balance fully received
  | "no_deposit_required"; // Payment terms say 0% deposit

/**
 * Computes how much of a quotation's total is the expected deposit, based
 * on the quotation's payment_terms JSONB. Modes:
 *   - "deposit_balance"  → deposit_percent of total
 *   - "lc"               → no upfront deposit (LC handles payment)
 *   - "hybrid"           → deposit_percent of total
 *   - missing/unknown    → 0
 */
export function computeExpectedDeposit(
  totalPrice: number,
  paymentMode: PaymentMode | null,
  paymentTerms: PaymentTerms | null
): number {
  if (!paymentTerms || !paymentMode) return 0;
  if (paymentMode === "lc") return 0;
  const pct = Number(paymentTerms.deposit_percent ?? 0);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return (totalPrice * pct) / 100;
}

/** Expected balance = total − expected deposit. */
export function computeExpectedBalance(
  totalPrice: number,
  paymentMode: PaymentMode | null,
  paymentTerms: PaymentTerms | null
): number {
  const deposit = computeExpectedDeposit(totalPrice, paymentMode, paymentTerms);
  return Math.max(0, totalPrice - deposit);
}

/**
 * Computes the high-level payment state for a production order.
 * Tolerant of small rounding (1 cent) so receipts saved against
 * computed amounts don't fall just short of "fully paid".
 */
export function computeProductionPaymentState(args: {
  totalPrice: number;
  paymentMode: PaymentMode | null;
  paymentTerms: PaymentTerms | null;
  depositReceived: number;
  balanceReceived: number;
}): ProductionPaymentState {
  const { totalPrice, paymentMode, paymentTerms, depositReceived, balanceReceived } =
    args;
  if (!paymentTerms || !paymentMode) return "no_terms";
  const expectedDeposit = computeExpectedDeposit(
    totalPrice,
    paymentMode,
    paymentTerms
  );
  const expectedBalance = computeExpectedBalance(
    totalPrice,
    paymentMode,
    paymentTerms
  );
  const epsilon = 0.01;
  const depositFull = depositReceived + epsilon >= expectedDeposit;
  const balanceFull = balanceReceived + epsilon >= expectedBalance;

  if (expectedDeposit <= 0) {
    // No deposit required. Move straight to balance state.
    if (balanceFull && expectedBalance > 0) return "paid_in_full";
    if (balanceReceived > 0) return "partial_balance";
    return "no_deposit_required";
  }

  if (!depositFull) return "awaiting_deposit";
  if (depositFull && balanceFull) return "paid_in_full";
  if (depositFull && balanceReceived > 0) return "partial_balance";
  return "deposit_received";
}

/** Friendly labels for the badges. */
export const PRODUCTION_PAYMENT_STATE_LABEL: Record<
  ProductionPaymentState,
  string
> = {
  no_terms: "No terms",
  awaiting_deposit: "Awaiting deposit",
  deposit_received: "Deposit received",
  partial_balance: "Balance partial",
  paid_in_full: "Paid in full",
  no_deposit_required: "No deposit",
};

/* ---------------------------------------------------------------------
   Balance due date (m114, audit Phase 1 — cash)
   ---------------------------------------------------------------------
   The due date is DERIVED at read time unless explicitly overridden, so
   it follows deadline/ETA changes automatically (Règle Produit #0 — a
   view displays, it never owns a copy). Rules, in order:

     1. manual    — production_orders.balance_due_date set → wins as-is.
     2. deadline  — deposit_balance + "before_shipment": the balance must
                    be in before goods leave → due = current production
                    deadline (the shipment can't happen earlier anyway).
     3. eta_lc    — lc / hybrid with usance days: documents are presented
                    at shipment and the LC pays N days later → ETA + N.
     4. eta       — everything else that settles around arrival documents
                    (against_documents, LC at sight) → ETA when known.
     5. null      — no anchor yet (no deadline, no ETA): no due date, no
                    overdue alert. Honest absence beats a fake date.
   ------------------------------------------------------------------ */

export type BalanceDueSource = "manual" | "deadline" | "eta_lc" | "eta";

/** UI labels explaining where the effective due date comes from. */
export const BALANCE_DUE_SOURCE_LABEL: Record<BalanceDueSource, string> = {
  manual: "set manually",
  deadline: "auto · production deadline",
  eta_lc: "auto · ETA + LC days",
  eta: "auto · ETA",
};

/** Calendar-day add on a YYYY-MM-DD string (UTC, no DST surprises). */
function addCalendarDays(iso: string, days: number): string | null {
  const t = Date.parse(iso + "T00:00:00Z");
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computeEffectiveBalanceDueDate(args: {
  /** Explicit override (production_orders.balance_due_date, m114). */
  balanceDueDate?: string | null;
  paymentMode: PaymentMode | null;
  paymentTerms: PaymentTerms | null;
  currentProductionDeadline: string | null;
  eta: string | null;
}): { date: string | null; source: BalanceDueSource | null } {
  const {
    balanceDueDate,
    paymentMode,
    paymentTerms,
    currentProductionDeadline,
    eta,
  } = args;

  if (balanceDueDate) return { date: balanceDueDate, source: "manual" };
  if (!paymentMode || !paymentTerms) return { date: null, source: null };

  if (
    paymentMode === "deposit_balance" &&
    paymentTerms.balance_condition === "before_shipment"
  ) {
    return currentProductionDeadline
      ? { date: currentProductionDeadline, source: "deadline" }
      : { date: null, source: null };
  }

  const lcDays = Number(paymentTerms.lc_days ?? 0);
  if (
    (paymentMode === "lc" || paymentMode === "hybrid") &&
    eta &&
    Number.isFinite(lcDays) &&
    lcDays > 0
  ) {
    const due = addCalendarDays(eta, lcDays);
    return due ? { date: due, source: "eta_lc" } : { date: null, source: null };
  }

  if (eta) return { date: eta, source: "eta" };
  return { date: null, source: null };
}

export type ProductionDeadlineChange = {
  id: string;
  production_order_id: string;
  previous_date: string | null;
  new_date: string;
  changed_by: string | null;
  reason: string | null;
  created_at: string;
};

/**
 * Compute delay in whole days between the initial and current production
 * deadlines. Returns null if either date is missing.
 *  - positive number → pushed back by N days
 *  - 0              → on track
 *  - negative       → pulled forward (unusual but valid)
 */
export function computeProductionDelay(
  order: Pick<
    ProductionOrder,
    "initial_production_deadline" | "current_production_deadline"
  >
): number | null {
  const i = order.initial_production_deadline;
  const c = order.current_production_deadline;
  if (!i || !c) return null;
  const initial = new Date(i).getTime();
  const current = new Date(c).getTime();
  if (!Number.isFinite(initial) || !Number.isFinite(current)) return null;
  return Math.round((current - initial) / (1000 * 60 * 60 * 24));
}

export type Option = {
  id: string;
  product_id: string;
  option_type: string;
  option_value: string;
  price_modifier: number;
};

export type PricingTier = "high" | "medium" | "low";

export type PriceVersion = {
  id: string;
  product_id: string;
  price: number;
  valid_from: string;
  pricing_tier: PricingTier;
};

export type ClientCustomField = {
  label: string;
  value: string;
};

export type Client = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone_number: string | null;
  country: string | null;
  client_code?: string | null;
  starting_sequence_number?: number;
  custom_fields?: ClientCustomField[];
  /** Full multi-line address — free-form to handle inconsistent international formats. */
  address?: string | null;
  /** Tax / VAT registration number (e.g. "GB287451982"). */
  vat_number?: string | null;
  /** Default "Attention to" line on PDFs (e.g. "Purchasing Department").
   *  Per-document override lives on `documents.attention_to`. */
  default_attention_to?: string | null;
  /** Soft-archive timestamp (m031). null = active. */
  archived_at?: string | null;
};

export type Currency = "USD" | "EUR" | "CNY";
export const CURRENCIES: Currency[] = ["USD", "EUR", "CNY"];

export type SalesCondition = {
  id: string;
  title: string;
  content: string;
  is_default: boolean;
};

export type BankAccount = {
  id: string;
  /** Internal label used in dropdowns / lists (e.g. "Solux China USD"). */
  account_name: string;
  /** Legal entity name printed on the proforma / invoice PDF
   *  (e.g. "CHANGZHOU SOLUX TECHNOLOGY CO., LTD"). When null, the PDF
   *  falls back to `account_name`. Added in m038. */
  business_account_name?: string | null;
  currency: Currency;
  bank_name: string | null;
  bank_address: string | null;
  account_number: string | null;
  swift: string | null;
  is_default: boolean;
};

export type Incoterm = "EXW" | "FOB" | "CFR" | "CIF" | "DDP" | "DDU";
export type FreightType = "LCL" | "20ft" | "40ft" | "40ft HC";

// "LCL" represents LCL / Groupage shipments. Treated as a row in the same
// table as containers for simplicity. Wooden box packaging is only used
// when container_type === "LCL".
export type ContainerType = "LCL" | "20ft" | "40ft" | "40ft HC";
export const CONTAINER_TYPES: ContainerType[] = [
  "LCL",
  "20ft",
  "40ft",
  "40ft HC",
];

export function containerTypeLabel(t: ContainerType): string {
  return t === "LCL" ? "LCL / Groupage" : t;
}

export type DocumentContainer = {
  id?: string;
  container_type: ContainerType;
  quantity: number;
  unit_price: number;
  /** Optional, LCL-only. 0 for non-LCL rows. */
  wooden_box_cost?: number;
};

export type ProductionMode = "working_days" | "calendar_days" | "fixed_date";
export type ProductionTime = {
  mode: ProductionMode;
  days?: number | null;
  date?: string | null; // YYYY-MM-DD
};
export type DocType = "quotation" | "proforma";

export type DocStatus =
  | "draft"
  | "sent"
  | "negotiating"
  | "won"
  | "lost"
  | "cancelled";
export const DOC_STATUSES: DocStatus[] = [
  "draft",
  "sent",
  "negotiating",
  "won",
  "lost",
  "cancelled",
];
export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  cancelled: "Cancelled",
};
/** Statuses where the deal is still alive — Mark Won is offered. */
export const DOC_ACTIVE_STATUSES: DocStatus[] = [
  "draft",
  "sent",
  "negotiating",
];
/** Terminal statuses — no further sales actions available. */
export const DOC_TERMINAL_STATUSES: DocStatus[] = [
  "won",
  "lost",
  "cancelled",
];
export type PricingMode = "auto" | "manual";
export type DiscountType = "percentage" | "fixed";

/**
 * Durable provenance of a line's SELLING price — the lock that decouples the
 * catalogue (what we manufacture) from the approved commercial price (what we
 * sell). See m139.
 *   catalogue                -> catalogue model selection MAY drive the price
 *   manual                   -> LOCKED: sales typed/edited the selling price
 *   approved_service_request -> LOCKED: generated from an approved Service Request
 *   imported                 -> LOCKED: historical-import origin (forward-looking)
 * Lock predicate: `pricing_source !== "catalogue"`. Use `isLineLocked()`.
 */
export type PricingSource =
  | "catalogue"
  | "manual"
  | "approved_service_request"
  | "imported";

/**
 * A line whose price is locked must never be recomputed from the catalogue:
 * `original_unit_price` is the commercial truth and the attached `product_id`
 * is a MANUFACTURING REFERENCE only. A missing/legacy `pricing_source` falls
 * back to the mechanical mode (manual => locked) so pre-m139 rows behave right
 * even before the backfill lands.
 */
export function isLineLocked(line: {
  pricing_source?: PricingSource | null;
  pricing_mode?: PricingMode;
}): boolean {
  if (line.pricing_source) return line.pricing_source !== "catalogue";
  return line.pricing_mode === "manual";
}

export type DocumentLine = {
  id?: string;
  product_id: string;
  quantity: number;
  selected_options: Record<string, string>;
  unit_price: number; // final (after discount)
  total_price: number; // unit_price * quantity
  pricing_mode: PricingMode;
  pricing_tier: PricingTier;
  original_unit_price: number; // before discount
  discount_type: DiscountType | null;
  discount_value: number;
  client_product_name?: string | null;
  /**
   * Line-level product family (m133). The factory-mapping resolver scopes by
   * category — not product_id — so a free-text / Service-Request line
   * (product_id null) stays resolvable as long as it carries its category here.
   */
  category_id?: string | null;
  /** Dynamic per-family configuration values, keyed by field_name. */
  config_values?: Record<string, string>;
  /**
   * Commercial-price provenance / lock (m139). When this is anything other than
   * "catalogue" the line is LOCKED: `original_unit_price` is the approved
   * selling price and must never be recomputed from the catalogue tier map —
   * the attached `product_id` is a manufacturing reference only. Defaults to
   * "catalogue" for fresh ad-hoc lines; set to "manual" the moment sales edits
   * the price, and "approved_service_request" for SR-generated lines.
   */
  pricing_source?: PricingSource | null;
  /** The Service Request this line's approved price came from (audit/routing). */
  source_project_request_id?: string | null;
  /** Who approved the SR pricing (from project_products.priced_by). */
  approved_by?: string | null;
  /** When the SR pricing was approved (from project_products.priced_at). */
  approved_at?: string | null;
  /**
   * m140 — which approved SR price this line takes ('product' | 'pole').
   * Stamped at generation so the selective Keep/Apply flow never has to guess
   * (lib/costing-apply refuses ambiguity instead).
   */
  source_component?: "product" | "pole" | null;
  // UI-only (not persisted): set when a line was pre-filled from a previous quotation
  previous_unit_price?: number;
};

export type DocumentRow = {
  id: string;
  number: string | null;
  client_id: string | null;
  type: DocType;
  date: string;
  total_price: number;
  status: string;
  incoterm: Incoterm | null;
  freight_type: FreightType | null;
  freight_cost: number;
  manual_pricing: boolean;
  pdf_url: string | null;
  created_by: string | null;
};

// { product_id: { high?: number, medium?: number, low?: number } }
export type TierPriceMap = Record<string, Partial<Record<PricingTier, number>>>;

// { product_id: cost_price } — admin-only
export type CostMap = Record<string, number>;

export type PaymentMode = "deposit_balance" | "lc" | "hybrid";
export type BalanceCondition = "before_shipment" | "against_documents";
export type LCType = "at_sight" | "usance";
export const LC_DAYS_OPTIONS = [30, 60, 90, 120] as const;
export type LCDays = (typeof LC_DAYS_OPTIONS)[number];

export type PaymentTerms = {
  deposit_percent?: number;
  balance_condition?: BalanceCondition;
  lc_type?: LCType;
  lc_days?: number;
};

export type ClientHistoryItem = {
  product_id: string;
  product_name: string;
  category: string | null;
  selected_options: Record<string, string>;
  unit_price: number;
  pricing_tier: PricingTier | null;
  date: string;
};
