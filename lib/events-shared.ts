/**
 * Pure type + palette exports for the event log.
 *
 * Why a separate file
 * -------------------
 * `lib/events.ts` mixes pure exports (types, palettes, label maps)
 * with server-only functions (`emitEvent`, `listOperationsFeed`,
 * etc.) that import `createClient` from `@/lib/supabase/server` —
 * which itself imports `next/headers`. As soon as a CLIENT component
 * imports anything from `lib/events.ts`, Next.js tries to bundle the
 * whole module and fails: `next/headers` only works in Server
 * Components.
 *
 * Splitting the pure stuff out here gives client components a safe
 * import surface (types + palettes + helpers that don't touch the DB)
 * while `lib/events.ts` re-exports from this file so every existing
 * server-side `import { EventRow } from "@/lib/events"` keeps working.
 *
 * Rule of thumb: if a value/type touches Supabase or `next/headers`,
 * it stays in `lib/events.ts`. If it's pure data or formatting, put
 * it here.
 */

/* ===========================================================================
   Severity + status
   =========================================================================== */

export type EventSeverity = "low" | "medium" | "high" | "critical";

/** Workflow state for an operational event.
 *  m039 introduced open/ack/waiting/resolved.
 *  m044 added working + escalated for richer collaborative tickets. */
export type EventStatus =
  | "open"
  | "acknowledged"
  | "working"
  | "waiting"
  | "escalated"
  | "resolved";

export const EVENT_STATUSES: EventStatus[] = [
  "open",
  "acknowledged",
  "working",
  "waiting",
  "escalated",
  "resolved",
];

/** Who an event is waiting on. Only meaningful when status='waiting'.
 *  Constrained vocabulary so dashboards render consistent pills. */
export type EventWaitingFor =
  | "client"
  | "sales"
  | "operations"
  | "supplier"
  | "bank"
  | "management"
  | "other";

export const EVENT_WAITING_FOR_VALUES: EventWaitingFor[] = [
  "client",
  "sales",
  "operations",
  "supplier",
  "bank",
  "management",
  "other",
];

/* ===========================================================================
   Entity types + event catalog
   =========================================================================== */

export type EventEntityType =
  | "production_order"
  | "task_list"
  | "document"
  | "client"
  | "project_request"
  | "affair"
  // System-wide events (permissions matrix changes, user role changes,
  // dev resets) have no natural single entity — use "system" and set
  // entity_id to a UUID so the row is still uniquely keyed.
  | "system";

/**
 * Canonical event type catalog.
 *
 * Keep this list central so callers and consumers (timeline UI, filters,
 * Operations Feed) agree on the strings. The DB doesn't enforce the
 * enum — adding a new type doesn't require a migration, but the catalog
 * here must be kept in sync.
 */
export type EventType =
  // production_order events
  | "po.created"
  | "po.status_changed"
  | "po.deadline_changed"
  | "po.delay_event_edited"
  | "po.delay_event_deleted"
  | "po.timeline_set"
  | "po.deposit_received"
  | "po.balance_received"
  | "po.deposit_override" // admin started production before deposit landed
  | "po.shipment_updated"
  | "po.production_completed" // factory delivered — stamped via markProductionComplete
  | "po.bl_info_requested" // operations asked sales to complete the BL profile
  | "po.bl_info_resolved" // sales completed the BL profile — booking blocker lifted
  | "po.cancelled"
  // task_list events
  | "tl.submitted_for_validation"
  | "tl.validated"
  | "tl.production_ready"
  | "tl.needs_revision"
  | "tl.reopened"
  | "tl.cancelled"
  | "tl.deleted"
  | "tl.status_overridden"
  | "tl.header_changed"
  // document (quotation) events
  | "doc.created"
  | "doc.updated"
  | "doc.status_changed"
  | "doc.won"
  | "doc.lost"
  | "doc.cancelled"
  | "doc.deleted"
  // advisory validation loop (m068)
  | "doc.validation_requested"
  | "doc.validation_approved"
  | "doc.validation_rejected"
  // client events
  | "client.created"
  | "client.updated"
  | "client.deleted"
  // client contact events (m101)
  | "client.contact_added"
  | "client.contact_updated"
  | "client.contact_deleted"
  // affair CRM events (m103) — planned actions log into the timeline
  | "affair.action_planned"
  | "affair.action_done"
  | "affair.action_deleted"
  // BL workflow: affair-history mirror of po.bl_info_requested
  | "affair.bl_info_requested"
  // project request events (m090)
  | "pr.created"
  | "pr.submitted"
  | "pr.approved"
  | "pr.rejected"
  | "pr.info_requested"
  | "pr.cost_entered"
  | "pr.cost_overridden"
  | "pr.logistics_entered"
  | "pr.packing_entered"
  | "pr.freight_entered"
  | "pr.freight_update_requested"
  | "pr.freight_updated"
  | "pr.ready_for_pricing"
  | "pr.priced"
  | "pr.quotation_generated"
  | "pr.won"
  | "pr.lost"
  | "pr.cancelled"
  // admin / system
  | "admin.permissions_changed"
  | "admin.user_role_changed"
  | "system.dev_reset";

/* ===========================================================================
   Bell eligibility (Decision D)
   =========================================================================== */

/**
 * Medium-severity events that still raise the bell because they require the
 * viewer's-role action. The notification feed is already visibility-scoped to
 * the user's own deals, so a type allowlist approximates "requires action from
 * the user or their role" without a per-role gate. Tunable.
 */
export const ACTIONABLE_MEDIUM_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  "tl.needs_revision",
  "tl.validated",
  "tl.production_ready",
  "doc.validation_approved",
  "po.shipment_updated",
  // Project Request workflow handoffs — each completed step needs the NEXT
  // actor's attention (m092 made these events visible to the right roles).
  "pr.submitted", // → director
  "pr.approved", // → operations
  "pr.cost_entered", // → director
  "pr.packing_entered", // → director
  "pr.freight_entered", // → director
  "pr.freight_update_requested", // → operations
  "pr.freight_updated", // → sales
  "pr.ready_for_pricing", // → director
  "pr.priced", // → sales
  "pr.quotation_generated", // → sales
  "pr.info_requested", // → sales (owner)
  "pr.rejected", // → sales (owner)
]);

/**
 * Decision D — should this event raise the notification bell on CREATION,
 * independent of any comment? critical/high always; medium only when
 * role-actionable (see allowlist); low / informational never.
 */
export function eventRaisesBell(
  e: Pick<EventRow, "severity" | "event_type">
): boolean {
  if (e.severity === "critical" || e.severity === "high") return true;
  if (e.severity === "medium") return ACTIONABLE_MEDIUM_EVENTS.has(e.event_type);
  return false;
}

/* ===========================================================================
   Row shapes
   =========================================================================== */

export type EventRow = {
  id: string;
  entity_type: EventEntityType;
  entity_id: string;
  event_type: EventType;
  severity: EventSeverity;
  payload: Record<string, any>;
  message: string;
  actor_id: string | null;
  created_at: string;
  /** m039 fields — defaults to 'open' on every row. */
  status?: EventStatus;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  resolved_at?: string | null;
  due_date?: string | null;
  /** m044 collaborative ticket fields. */
  waiting_for?: EventWaitingFor | null;
  owner_id?: string | null;
  owner_assigned_at?: string | null;
};

/** Single comment in an event's discussion thread. */
export type EventComment = {
  id: string;
  event_id: string;
  user_id: string | null;
  comment: string;
  created_at: string;
};

/* ===========================================================================
   Presentation palettes (Tailwind classes)
   =========================================================================== */

/** Tailwind class for the severity dot/badge. */
export const SEVERITY_DOT: Record<EventSeverity, string> = {
  low: "bg-neutral-300",
  medium: "bg-sky-500",
  high: "bg-amber-500",
  critical: "bg-rose-600",
};

/** Tailwind class for the severity pill background. */
export const SEVERITY_PILL: Record<EventSeverity, string> = {
  low: "bg-neutral-100 text-neutral-700 border-neutral-200",
  medium: "bg-sky-50 text-sky-700 border-sky-200",
  high: "bg-amber-50 text-amber-800 border-amber-200",
  critical: "bg-rose-50 text-rose-700 border-rose-200",
};

/** Display label for severity. */
export const SEVERITY_LABEL: Record<EventSeverity, string> = {
  low: "Info",
  medium: "Update",
  high: "Important",
  critical: "Critical",
};

/** Tailwind palette for the status pill in the operations feed.
 *  m044 added working (sky-darker) + escalated (purple). */
export const STATUS_PILL: Record<EventStatus, string> = {
  open: "bg-neutral-900 text-white border-neutral-900",
  acknowledged: "bg-sky-100 text-sky-900 border-sky-200",
  working: "bg-sky-600 text-white border-sky-700",
  waiting: "bg-amber-100 text-amber-900 border-amber-200",
  escalated: "bg-purple-100 text-purple-900 border-purple-300",
  resolved: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

/** Human label for the status pill. */
export const STATUS_LABEL: Record<EventStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  working: "Working on it",
  waiting: "Waiting",
  escalated: "Escalated",
  resolved: "Resolved",
};

/** Label per waiting_for value, used as a sub-pill next to "Waiting". */
export const WAITING_FOR_LABEL: Record<EventWaitingFor, string> = {
  client: "Waiting client",
  sales: "Waiting sales",
  operations: "Waiting operations",
  supplier: "Waiting supplier",
  bank: "Waiting bank",
  management: "Waiting management",
  other: "Waiting",
};

/** Tailwind tone for the waiting_for pill — same amber family as
 *  the base "Waiting" status, with darker text for client/supplier
 *  (the most operationally urgent ones). */
export const WAITING_FOR_PILL: Record<EventWaitingFor, string> = {
  client: "bg-amber-50 text-amber-900 border-amber-300",
  sales: "bg-amber-50 text-amber-800 border-amber-200",
  operations: "bg-amber-50 text-amber-800 border-amber-200",
  supplier: "bg-amber-50 text-amber-900 border-amber-300",
  bank: "bg-amber-50 text-amber-800 border-amber-200",
  management: "bg-purple-50 text-purple-800 border-purple-200",
  other: "bg-amber-50 text-amber-800 border-amber-200",
};

/* ===========================================================================
   Pure helpers (no server deps)
   =========================================================================== */

/** Resolve the URL of the entity an event is about. */
export function eventEntityHref(e: {
  entity_type: EventEntityType;
  entity_id: string;
}): string | null {
  switch (e.entity_type) {
    case "document":
      return `/documents/${e.entity_id}`;
    case "task_list":
      return `/task-lists/${e.entity_id}`;
    case "production_order":
      return `/production/orders/${e.entity_id}`;
    case "client":
      return `/clients/${e.entity_id}`;
    case "project_request":
      return `/projects/${e.entity_id}`;
    case "affair":
      return `/affairs/${e.entity_id}`;
    default:
      return null;
  }
}

/** Format an event_type string into a readable category label. */
export function eventTypeLabel(t: EventType): string {
  const map: Record<EventType, string> = {
    "po.created": "Production order created",
    "po.status_changed": "Status changed",
    "po.deadline_changed": "Deadline changed",
    "po.delay_event_edited": "Delay event edited",
    "po.delay_event_deleted": "Delay event deleted",
    "po.timeline_set": "Timeline set",
    "po.deposit_received": "Deposit received",
    "po.balance_received": "Balance received",
    "po.deposit_override": "Started without deposit",
    "po.shipment_updated": "Shipment updated",
    "po.production_completed": "Production completed",
    "po.cancelled": "Production order cancelled",
    "tl.submitted_for_validation": "Submitted for validation",
    "tl.validated": "Task list validated",
    "tl.production_ready": "Production ready",
    "tl.needs_revision": "Needs revision",
    "tl.reopened": "Reopened",
    "tl.cancelled": "Task list cancelled",
    "tl.deleted": "Task list deleted",
    "tl.status_overridden": "Status overridden",
    "tl.header_changed": "Task list header updated",
    "doc.created": "Quotation created",
    "doc.updated": "Quotation edited",
    "doc.status_changed": "Quotation status changed",
    "doc.won": "Quotation won",
    "doc.lost": "Quotation lost",
    "doc.cancelled": "Quotation cancelled",
    "doc.deleted": "Quotation deleted",
    "doc.validation_requested": "Validation requested",
    "doc.validation_approved": "Validation approved",
    "doc.validation_rejected": "Changes requested",
    "client.created": "Client created",
    "client.updated": "Client details updated",
    "client.deleted": "Client deleted",
    "client.contact_added": "Contact added",
    "client.contact_updated": "Contact updated",
    "client.contact_deleted": "Contact removed",
    "affair.action_planned": "Action planned",
    "affair.action_done": "Action completed",
    "affair.action_deleted": "Planned action removed",
    "po.bl_info_requested": "Shipping info requested",
    "po.bl_info_resolved": "Shipping info completed",
    "affair.bl_info_requested": "Shipping info requested",
    "pr.created": "Project request created",
    "pr.submitted": "Submitted for approval",
    "pr.approved": "Sent to operations",
    "pr.rejected": "Project rejected",
    "pr.info_requested": "More information requested",
    "pr.cost_entered": "Factory cost entered",
    "pr.cost_overridden": "Factory cost overridden",
    "pr.logistics_entered": "Logistics entered",
    "pr.packing_entered": "Packing list entered",
    "pr.freight_entered": "Freight cost entered",
    "pr.freight_update_requested": "Freight update requested",
    "pr.freight_updated": "Freight updated",
    "pr.ready_for_pricing": "Ready for pricing",
    "pr.priced": "Project priced",
    "pr.quotation_generated": "Quotation generated",
    "pr.won": "Project won",
    "pr.lost": "Project lost",
    "pr.cancelled": "Project cancelled",
    "admin.permissions_changed": "Permissions matrix changed",
    "admin.user_role_changed": "User role changed",
    "system.dev_reset": "Dev data reset",
  };
  return map[t] ?? t;
}
