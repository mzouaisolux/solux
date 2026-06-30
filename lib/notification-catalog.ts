// =====================================================================
// Notification catalog + read-time channel resolution (Phase 3C, owner
// decision A 2026-06-13: rules at READ-TIME, conforme Règle #0 — one
// source, derive the bell at read time; NO materialized per-user table).
//
// The catalog is the single descriptive source for each event: which
// entity + category + human label it belongs to, plus its informational
// default severity (the AUTHORITATIVE severity stays in events.ts's
// DEFAULT_SEVERITY, stamped at emit time on the row — the read path uses
// the row's stored severity, so the two can never diverge).
//
// `resolveNotificationChannel` decides bell / feed / off for a (event,
// role) pair: a notification_rules override wins; otherwise it falls
// back to the LEGACY rule (== eventRaisesBell) so an empty rules table
// reproduces today's behavior EXACTLY (migration-safety test locks it).
//
// Pure — no supabase, node-testable. Imports only the pure events-shared.
// =====================================================================

import {
  ACTIONABLE_MEDIUM_EVENTS,
  type EventType,
  type EventSeverity,
} from "./events-shared.ts";

export type NotificationChannel = "bell" | "feed" | "off";

export type NotificationCategory =
  | "workflow" // handoffs between roles (validation, approvals, project steps)
  | "money" // deposits, balance, costs, freight, pricing
  | "production" // factory status, deadlines, delays, completion
  | "shipping" // BL profile, shipment, booking
  | "crm" // quotation outcomes, clients, deals
  | "governance" // permissions, roles, system
  | "bookkeeping"; // routine CRM logs — timeline only

export type NotificationCatalogEntry = {
  entity: string;
  category: NotificationCategory;
  /** Informational mirror of DEFAULT_SEVERITY (authoritative copy lives
   *  in events.ts and is stamped on the row at emit time). */
  severity: EventSeverity;
  label: string;
};

/** Every emitted event, described once. Severities mirror events.ts. */
export const NOTIFICATION_CATALOG: Record<EventType, NotificationCatalogEntry> = {
  // ---- production_order ----
  "po.created": { entity: "production_order", category: "production", severity: "medium", label: "Production order created" },
  "po.status_changed": { entity: "production_order", category: "production", severity: "medium", label: "Production status changed" },
  "po.deadline_changed": { entity: "production_order", category: "production", severity: "high", label: "Production deadline changed" },
  "po.delay_event_edited": { entity: "production_order", category: "production", severity: "medium", label: "Delay event edited" },
  "po.delay_event_deleted": { entity: "production_order", category: "production", severity: "high", label: "Delay event deleted" },
  "po.timeline_set": { entity: "production_order", category: "production", severity: "medium", label: "Production timeline set" },
  "po.deposit_received": { entity: "production_order", category: "money", severity: "medium", label: "Deposit received" },
  "po.balance_received": { entity: "production_order", category: "money", severity: "medium", label: "Balance received" },
  "po.deposit_override": { entity: "production_order", category: "money", severity: "high", label: "Production started without deposit" },
  "po.shipment_updated": { entity: "production_order", category: "shipping", severity: "medium", label: "Shipment updated" },
  "po.production_completed": { entity: "production_order", category: "production", severity: "high", label: "Production completed" },
  "po.bl_info_requested": { entity: "production_order", category: "shipping", severity: "high", label: "BL info requested from sales" },
  "po.bl_info_resolved": { entity: "production_order", category: "shipping", severity: "medium", label: "BL info completed" },
  "po.cancelled": { entity: "production_order", category: "production", severity: "critical", label: "Production order cancelled" },
  // ---- task_list ----
  "tl.submitted_for_validation": { entity: "task_list", category: "workflow", severity: "low", label: "Task list submitted for validation" },
  "tl.validated": { entity: "task_list", category: "workflow", severity: "medium", label: "Task list validated" },
  "tl.production_ready": { entity: "task_list", category: "workflow", severity: "medium", label: "Task list production-ready" },
  "tl.needs_revision": { entity: "task_list", category: "workflow", severity: "medium", label: "Task list needs revision" },
  "tl.reopened": { entity: "task_list", category: "workflow", severity: "medium", label: "Task list reopened" },
  "tl.cancelled": { entity: "task_list", category: "workflow", severity: "critical", label: "Task list cancelled" },
  "tl.deleted": { entity: "task_list", category: "workflow", severity: "critical", label: "Task list deleted" },
  "tl.status_overridden": { entity: "task_list", category: "workflow", severity: "high", label: "Task list status overridden" },
  "tl.header_changed": { entity: "task_list", category: "bookkeeping", severity: "low", label: "Task list header changed" },
  // ---- document (quotation) ----
  "doc.created": { entity: "document", category: "crm", severity: "low", label: "Quotation created" },
  "doc.updated": { entity: "document", category: "crm", severity: "low", label: "Quotation updated" },
  "doc.status_changed": { entity: "document", category: "crm", severity: "low", label: "Quotation status changed" },
  "doc.won": { entity: "document", category: "crm", severity: "medium", label: "Quotation won" },
  "doc.lost": { entity: "document", category: "crm", severity: "low", label: "Quotation lost" },
  "doc.cancelled": { entity: "document", category: "crm", severity: "critical", label: "Quotation cancelled" },
  "doc.deleted": { entity: "document", category: "crm", severity: "critical", label: "Quotation deleted" },
  "doc.validation_requested": { entity: "document", category: "workflow", severity: "high", label: "Quotation validation requested" },
  "doc.validation_approved": { entity: "document", category: "workflow", severity: "medium", label: "Quotation validation approved" },
  "doc.validation_rejected": { entity: "document", category: "workflow", severity: "high", label: "Quotation validation rejected" },
  // ---- client ----
  "client.created": { entity: "client", category: "crm", severity: "low", label: "Client created" },
  "client.updated": { entity: "client", category: "crm", severity: "low", label: "Client updated" },
  "client.deleted": { entity: "client", category: "crm", severity: "critical", label: "Client deleted" },
  "client.contact_added": { entity: "client", category: "bookkeeping", severity: "low", label: "Contact added" },
  "client.contact_updated": { entity: "client", category: "bookkeeping", severity: "low", label: "Contact updated" },
  "client.contact_deleted": { entity: "client", category: "bookkeeping", severity: "low", label: "Contact deleted" },
  // ---- affair (CRM) ----
  "affair.action_planned": { entity: "affair", category: "bookkeeping", severity: "low", label: "Next action planned" },
  "affair.action_done": { entity: "affair", category: "bookkeeping", severity: "low", label: "Action completed" },
  "affair.action_deleted": { entity: "affair", category: "bookkeeping", severity: "low", label: "Action deleted" },
  "affair.bl_info_requested": { entity: "affair", category: "shipping", severity: "low", label: "BL info requested (history)" },
  // ---- project_request ----
  "pr.created": { entity: "project_request", category: "workflow", severity: "low", label: "Service request created" },
  "pr.submitted": { entity: "project_request", category: "workflow", severity: "medium", label: "Service request submitted" },
  "pr.approved": { entity: "project_request", category: "workflow", severity: "medium", label: "Service request approved" },
  "pr.rejected": { entity: "project_request", category: "workflow", severity: "medium", label: "Service request rejected" },
  "pr.info_requested": { entity: "project_request", category: "workflow", severity: "medium", label: "More info requested" },
  "pr.cost_entered": { entity: "project_request", category: "money", severity: "medium", label: "Factory cost entered" },
  "pr.cost_overridden": { entity: "project_request", category: "money", severity: "high", label: "Factory cost overridden" },
  "pr.logistics_entered": { entity: "project_request", category: "workflow", severity: "low", label: "Logistics entered" },
  "pr.packing_entered": { entity: "project_request", category: "workflow", severity: "medium", label: "Packing list entered" },
  "pr.freight_entered": { entity: "project_request", category: "money", severity: "medium", label: "Freight entered" },
  "pr.freight_update_requested": { entity: "project_request", category: "money", severity: "medium", label: "Freight update requested" },
  "pr.freight_updated": { entity: "project_request", category: "money", severity: "medium", label: "Freight updated" },
  "pr.ready_for_pricing": { entity: "project_request", category: "workflow", severity: "medium", label: "Ready for pricing" },
  "pr.priced": { entity: "project_request", category: "money", severity: "medium", label: "Service request priced" },
  "pr.quotation_generated": { entity: "project_request", category: "workflow", severity: "medium", label: "Quotation generated" },
  "pr.won": { entity: "project_request", category: "crm", severity: "medium", label: "Service request won" },
  "pr.lost": { entity: "project_request", category: "crm", severity: "low", label: "Service request lost" },
  "pr.cancelled": { entity: "project_request", category: "crm", severity: "critical", label: "Service request cancelled" },
  // ---- admin / system ----
  "admin.permissions_changed": { entity: "system", category: "governance", severity: "high", label: "Permissions matrix changed" },
  "admin.user_role_changed": { entity: "system", category: "governance", severity: "high", label: "User role changed" },
  "system.dev_reset": { entity: "system", category: "governance", severity: "critical", label: "Dev reset" },
};

/** All catalog keys (for the future admin matrix + seeds). */
export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_CATALOG) as EventType[];

/**
 * LEGACY default channel for an event of `severity` (== eventRaisesBell):
 *   critical / high            → bell
 *   medium                     → bell iff actionable, else feed
 *   low                        → feed
 * Used as the fallback when no notification_rules override exists.
 */
export function defaultChannel(eventKey: string, severity: EventSeverity): NotificationChannel {
  if (severity === "critical" || severity === "high") return "bell";
  if (severity === "medium") {
    return ACTIONABLE_MEDIUM_EVENTS.has(eventKey as EventType) ? "bell" : "feed";
  }
  return "feed";
}

/**
 * Resolve the channel for a (role, event) pair at READ time. A
 * notification_rules override (passed in as `rule`) wins; otherwise we
 * fall back to the legacy default — so an empty rules table = today's
 * behavior, exactly.
 *
 * `rule` is the channel the caller looked up for this role+event in
 * notification_rules (null/undefined when no override).
 */
export function resolveNotificationChannel(args: {
  eventKey: string;
  severity: EventSeverity;
  rule?: NotificationChannel | null;
}): NotificationChannel {
  return args.rule ?? defaultChannel(args.eventKey, args.severity);
}

/* ------------------------------------------------------------------ */
/* Anti-spam — pure decision for emit-once-within-window               */
/* ------------------------------------------------------------------ */

/**
 * Should a new event be emitted, given the timestamp of the last
 * identical one (same dedup key) and a window? Pure so it's testable;
 * the DB lookup of `lastAtIso` lives in the emit helper.
 *   - no previous event → emit
 *   - previous within `windowMinutes` → SKIP (duplicate)
 *   - previous older than the window → emit again
 */
export function shouldEmitOnce(
  lastAtIso: string | null | undefined,
  nowIso: string,
  windowMinutes: number
): boolean {
  if (!lastAtIso) return true;
  const last = Date.parse(lastAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return true;
  return now - last > windowMinutes * 60_000;
}
