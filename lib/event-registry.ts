// =====================================================================
// Unified Event Registry (Step 1) — the SINGLE descriptor of every
// CONSUMER that can subscribe to a business event, plus pure read-time
// resolvers.
//
// The event is still EMITTED from code (emitEvent + the EventType union).
// This layer only describes ROUTING + PRESENTATION — never business
// logic. Projections (dashboards, Today's Work, At Risk, KPIs, …) stay
// in code; the registry just declares WHERE an event flows and WHO sees
// it. The golden rule: config ROUTES, code PROJECTS.
//
// Same override philosophy as m123: the code catalog is the BASELINE;
// the DB (event_routing + event_catalog_overrides, m136) holds only
// OVERRIDES. An empty registry ⇒ today's behavior EXACTLY (locked by
// tests/event-registry.test.ts).
//
// Pure — no supabase, node-testable. Imports only proven-pure modules.
// =====================================================================

import {
  NOTIFICATION_CATALOG,
  type NotificationCatalogEntry,
} from "./notification-catalog.ts";
import {
  ACTIONABLE_MEDIUM_EVENTS,
  type EventType,
  type EventSeverity,
} from "./events-shared.ts";

/* ------------------------------------------------------------------ */
/* Consumers — every downstream surface an event can feed.             */
/* ------------------------------------------------------------------ */

export type Consumer =
  | "notification"
  | "dashboard"
  | "kpi"
  | "audit"
  | "automation";

/** LIVE   — a real projection in code reads these routing rows today.
 *  DESCRIBED — routing is persisted, but the projection isn't wired yet
 *              (Step 1 scaffolds these so the admin page is complete).
 *  RESERVED  — placeholder for a future subsystem. */
export type ConsumerStatus = "live" | "described" | "reserved";

/** UI field descriptor — drives the admin form generically, so adding a
 *  consumer is a descriptor edit here, not a bespoke form. */
export type ConsumerField =
  | {
      key: string;
      kind: "select";
      label: string;
      options: ReadonlyArray<{ value: string; label: string }>;
      default: string;
    }
  | {
      key: string;
      kind: "multiselect";
      label: string;
      options: ReadonlyArray<{ value: string; label: string }>;
    }
  | { key: string; kind: "toggle"; label: string; default: boolean };

export type ConsumerDescriptor = {
  key: Consumer;
  label: string;
  icon: string;
  description: string;
  status: ConsumerStatus;
  /** true  ⇒ config is meaningful per (event, role) — a role grid in the UI.
   *  false ⇒ one config per event (stored with role = GLOBAL_ROLE). */
  perRole: boolean;
  fields: ReadonlyArray<ConsumerField>;
};

/** Sentinel role for global (non per-role) consumers in event_routing. */
export const GLOBAL_ROLE = "*";

export const NOTIFICATION_CHANNELS = [
  { value: "default", label: "— default (inherit)" },
  { value: "bell", label: "🔔 bell" },
  { value: "feed", label: "📰 feed" },
  { value: "off", label: "🚫 off" },
] as const;

/** Dashboard sections an event can surface in — aligns with the
 *  Operations cockpit (Today's Work / Orders in Flight / At Risk / …). */
export const DASHBOARD_SECTIONS = [
  { value: "todays_work", label: "Today's Work" },
  { value: "orders_in_flight", label: "Orders in Flight" },
  { value: "at_risk", label: "At Risk" },
  { value: "waiting_customer", label: "Waiting Customer" },
] as const;

export const AUDIT_VISIBILITY = [
  { value: "visible", label: "Visible (human timeline)" },
  { value: "internal", label: "Internal only" },
] as const;

/** Placeholder KPI keys — DESCRIBED only; the metric computations live in
 *  code and get wired in a later step. */
export const KPI_KEYS = [
  { value: "delays", label: "Production delays" },
  { value: "won_value", label: "Won value" },
  { value: "pricing_throughput", label: "Pricing throughput" },
  { value: "validation_sla", label: "Validation SLA" },
] as const;

/**
 * THE single place that declares what can happen after an event is
 * emitted. Each consumer owns its config SHAPE here; its PROJECTION logic
 * (how it turns the event into output) stays in code elsewhere.
 */
export const CONSUMERS: ReadonlyArray<ConsumerDescriptor> = [
  {
    key: "notification",
    label: "Notification",
    icon: "🔔",
    description:
      "Bell / feed routing per role (email later). LIVE — the bell/feed enforces these rows today.",
    status: "live",
    perRole: true,
    fields: [
      {
        key: "channel",
        kind: "select",
        label: "Channel",
        options: NOTIFICATION_CHANNELS,
        default: "default",
      },
    ],
  },
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "📊",
    description:
      "STORED ONLY — not consumed yet. The dashboard section projection isn't wired; this routing has no runtime effect.",
    status: "described",
    perRole: true,
    fields: [
      {
        key: "section",
        kind: "select",
        label: "Section",
        options: DASHBOARD_SECTIONS,
        default: "todays_work",
      },
    ],
  },
  {
    key: "kpi",
    label: "KPI / Counters",
    icon: "📈",
    description:
      "STORED ONLY — not consumed yet. The KPI/counter computations aren't wired; this routing has no runtime effect.",
    status: "described",
    perRole: false,
    fields: [
      {
        key: "kpis",
        kind: "multiselect",
        label: "Contributes to",
        options: KPI_KEYS,
      },
    ],
  },
  {
    key: "audit",
    label: "Audit Trail",
    icon: "📜",
    description:
      "STORED ONLY — not consumed yet. Every event is ALWAYS internally audited (immutable events row); this Visible/Internal toggle is not enforced yet.",
    status: "described",
    perRole: false,
    fields: [
      {
        key: "visibility",
        kind: "select",
        label: "Visibility",
        options: AUDIT_VISIBILITY,
        default: "visible",
      },
    ],
  },
  {
    key: "automation",
    label: "Automations",
    icon: "⚙️",
    description:
      "Reserved — reactive side-effects (reminders, escalations) are a later, separate subsystem.",
    status: "reserved",
    perRole: false,
    fields: [],
  },
];

export const CONSUMER_BY_KEY: Record<Consumer, ConsumerDescriptor> =
  Object.fromEntries(CONSUMERS.map((c) => [c.key, c])) as Record<
    Consumer,
    ConsumerDescriptor
  >;

/* ------------------------------------------------------------------ */
/* Identity resolution — code baseline + DB override.                  */
/* ------------------------------------------------------------------ */

export type EventIdentity = {
  eventKey: EventType;
  label: string;
  description: string | null;
  icon: string | null;
  category: string;
  severity: EventSeverity;
  requiresAction: boolean;
  enabled: boolean;
};

/** A row from event_catalog_overrides (every field optional). */
export type CatalogOverride = Partial<{
  label: string;
  description: string;
  icon: string;
  category: string;
  severity: EventSeverity;
  requires_action: boolean;
  enabled: boolean;
}>;

/**
 * Code baseline for "requires action": critical/high always, medium iff
 * in the actionable allowlist, low never. Mirrors eventRaisesBell so the
 * registry's default matches today's bell-on-creation decision exactly.
 */
export function baselineRequiresAction(
  eventKey: EventType,
  severity: EventSeverity
): boolean {
  if (severity === "critical" || severity === "high") return true;
  if (severity === "medium") return ACTIONABLE_MEDIUM_EVENTS.has(eventKey);
  return false;
}

/**
 * Merge the code catalog baseline with an optional DB override, field by
 * field (override wins; absent fields fall back to the baseline). When
 * severity is overridden but requires_action is not, requires_action is
 * recomputed from the NEW severity.
 */
export function resolveEventIdentity(
  eventKey: EventType,
  override?: CatalogOverride | null
): EventIdentity {
  const base: NotificationCatalogEntry = NOTIFICATION_CATALOG[eventKey];
  const severity = override?.severity ?? base.severity;
  return {
    eventKey,
    label: override?.label ?? base.label,
    description: override?.description ?? null,
    icon: override?.icon ?? null,
    category: override?.category ?? base.category,
    severity,
    requiresAction:
      override?.requires_action ?? baselineRequiresAction(eventKey, severity),
    enabled: override?.enabled ?? true,
  };
}

/* ------------------------------------------------------------------ */
/* Routing helpers (pure) — used by the admin UI + consumer read paths */
/* ------------------------------------------------------------------ */

/** One row of event_routing as read from the DB. */
export type RoutingRow = {
  event_key: string;
  consumer: string;
  role: string;
  config: Record<string, unknown>;
  enabled?: boolean;
};

/** Index routing rows by `${consumer}:${role}` → config, for O(1) lookup
 *  while rendering the per-event admin page or resolving a consumer. */
export function indexRouting(rows: RoutingRow[]): Map<string, RoutingRow> {
  const m = new Map<string, RoutingRow>();
  for (const r of rows) m.set(`${r.consumer}:${r.role}`, r);
  return m;
}

/** Which consumers have at least one enabled routing row for an event —
 *  drives the at-a-glance badges on the registry index. */
export function activeConsumers(rows: RoutingRow[]): Set<Consumer> {
  const s = new Set<Consumer>();
  for (const r of rows) {
    if (r.enabled === false) continue;
    if ((CONSUMER_BY_KEY as Record<string, ConsumerDescriptor>)[r.consumer]) {
      s.add(r.consumer as Consumer);
    }
  }
  return s;
}
