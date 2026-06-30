// =====================================================================
// SERVICE TYPES registry — the single catalog of services a Service
// Request (internally the `project_requests` table/`project.*` caps) can
// ask the organisation for. The "New service request" form renders its
// checkboxes from the ACTIVE entries here, so the UI catalog is
// config-driven: adding a service = add an entry below (status 'active')
// + wire its data handler (child table / actions.ts) — no workflow rebuild.
//
// `status: 'future'` entries document the roadmap WITHOUT rendering yet.
// PURE — no I/O, safe to import in client or server code.
// =====================================================================

export type ServiceTypeKey =
  | "product_pricing"
  | "packing_list"
  | "freight"
  | "technical_study"
  | "lighting_study"
  | "autonomy_calculation"
  | "logistics"
  | "production"
  | "custom";

export type ServiceType = {
  key: ServiceTypeKey;
  /** Form field name posted to createProjectRequest — kept STABLE (the
   *  backend contract in projects/actions.ts reads these exact names). */
  field: string;
  /** User-facing label (sentence case). */
  label: string;
  /** Child table that holds this service's fulfilment data, if any. */
  childTable: string | null;
  /** Internal capability that fulfils it (informational for now). */
  capability: string | null;
  /** Requires a quantity before it can be requested. */
  needsQuantity: boolean;
  /** 'active' renders in the form today; 'future' is roadmap-only. */
  status: "active" | "future";
};

export const SERVICE_TYPES: ServiceType[] = [
  // ---- Active today (the first three service modules) ----
  {
    key: "product_pricing",
    field: "req_product_pricing",
    label: "Product pricing",
    childTable: "factory_cost_requests",
    capability: "project.enter_cost",
    needsQuantity: false,
    status: "active",
  },
  {
    key: "packing_list",
    field: "req_packing_list",
    label: "Packing list",
    childTable: "packing_list_requests",
    capability: "project.enter_logistics",
    needsQuantity: true,
    status: "active",
  },
  {
    key: "freight",
    field: "req_freight",
    label: "Freight cost estimate",
    childTable: "freight_cost_requests",
    capability: "project.enter_logistics",
    needsQuantity: true,
    status: "active",
  },
  // ---- Roadmap — not rendered until status flips to 'active' AND a data
  //      handler exists (child table or generic service_request_items). ----
  { key: "technical_study", field: "req_technical_study", label: "Technical study", childTable: null, capability: null, needsQuantity: false, status: "future" },
  { key: "lighting_study", field: "req_lighting_study", label: "Lighting study", childTable: null, capability: null, needsQuantity: false, status: "future" },
  { key: "autonomy_calculation", field: "req_autonomy_calculation", label: "Autonomy calculation", childTable: null, capability: null, needsQuantity: false, status: "future" },
  { key: "logistics", field: "req_logistics", label: "Logistics request", childTable: null, capability: null, needsQuantity: false, status: "future" },
  { key: "production", field: "req_production", label: "Production request", childTable: null, capability: null, needsQuantity: false, status: "future" },
  { key: "custom", field: "req_custom", label: "Custom service", childTable: null, capability: null, needsQuantity: false, status: "future" },
];

/** Services rendered in the form today (excludes 'future' roadmap items). */
export const ACTIVE_SERVICE_TYPES = SERVICE_TYPES.filter((s) => s.status === "active");

export function serviceTypeByField(field: string): ServiceType | undefined {
  return SERVICE_TYPES.find((s) => s.field === field);
}
