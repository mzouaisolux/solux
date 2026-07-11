// =====================================================================
// REQUEST TYPE REGISTRY — the single source of truth for the Request Hub
// (owner 2026-07-08): the workflow-first navigation layer. "What do I need
// to move this affair forward?" → the user creates a Request instead of
// hunting for a screen.
//
// Add a request type HERE (one line) and it automatically appears in:
//   1. the mega menu "⚡ Requests" section (lib/navigation.ts builds from
//      this registry),
//   2. the client page "New Request" button,
//   3. the affair page "➕ New Request ▼" zone.
//
// `status: "active"` types deep-link to a real screen (today: the Service
// Request wizard, with the right services pre-checked via ?services=).
// `status: "coming_soon"` types render greyed with a "Coming Soon" badge —
// they train users to the architecture before the module ships; activating
// one later = set status + href on its line. Nothing else changes.
//
// This layer is ADDITIVE: it replaces no menu and changes no existing flow.
// =====================================================================

export type RequestContext = {
  clientId?: string | null;
  affairId?: string | null;
};

export type RequestTypeDef = {
  /** Stable key. */
  key: string;
  /** Menu label, e.g. "Product Cost Request". */
  label: string;
  /** One-line description shown under the label. */
  description?: string;
  emoji?: string;
  /** NavIcons glyph for premium surfaces (mega menu); emoji stays for
   *  plain-text surfaces. */
  icon?: string;
  status: "active" | "coming_soon";
  /** Service-type keys pre-checked in the SR wizard (see lib/service-types). */
  services?: readonly string[];
  /** Dedicated module path — overrides the default SR-wizard target
   *  (e.g. the Transport Request module at /transport/new). */
  path?: string;
};

export const REQUEST_TYPES = [
  {
    key: "product_cost",
    label: "Product Cost Request",
    description: "Factory costing for products on an affair",
    emoji: "💰",
    icon: "dollar",
    status: "active",
    services: ["product_pricing"],
  },
  {
    key: "custom_product",
    label: "Custom Product Request",
    description: "Non-catalogue product — specs to study & price",
    emoji: "🛠️",
    icon: "package",
    status: "active",
    services: ["product_pricing"],
  },
  {
    key: "transport",
    label: "Transport Request",
    description: "Packing list, freight quote or price update",
    emoji: "🚢",
    icon: "truck",
    status: "active",
    // Dedicated module (m161) — packing list / price / price update, with
    // product lines + configs and the versioned transport price history.
    path: "/transport/new",
  },
  {
    key: "lighting_energy",
    label: "Lighting & Energy Study Request",
    description: "Lighting / energy study (Dialux, autonomy)",
    emoji: "💡",
    icon: "bulb",
    status: "coming_soon",
  },
  {
    key: "pole_calculation",
    label: "Pole Calculation Request",
    description: "Structural calculation for a pole / mast",
    emoji: "📐",
    icon: "dividers",
    status: "coming_soon",
  },
  {
    key: "technical_validation",
    label: "Technical Validation Request",
    description: "Technical review & validation by the TLM team",
    emoji: "✅",
    icon: "check-circle",
    status: "coming_soon",
  },
] as const satisfies readonly RequestTypeDef[];

export const ACTIVE_REQUEST_TYPES = REQUEST_TYPES.filter(
  (r) => r.status === "active"
);

/**
 * Deep-link for a request type. Active types land on the Service Request
 * wizard with the affair/client context carried and the matching services
 * pre-checked (the wizard keeps enforcing the mandatory-affair core rule).
 */
export function requestHref(def: RequestTypeDef, ctx: RequestContext): string {
  const params = new URLSearchParams();
  if (ctx.affairId) params.set("affair", ctx.affairId);
  else if (ctx.clientId) params.set("client", ctx.clientId);
  if (def.services?.length) params.set("services", def.services.join(","));
  const qs = params.toString();
  return `${def.path ?? "/projects/new"}${qs ? `?${qs}` : ""}`;
}
