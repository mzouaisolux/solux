import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_CATALOG } from "../lib/notification-catalog.ts";
import type { EventType } from "../lib/events-shared.ts";

// =====================================================================
// Invariant (owner 2026-07-15): a role that is ROUTED a notification for an
// event MUST be able to READ that event's entity_type under RLS. Otherwise the
// bell is "emitted but muted" — exactly the bug where doc.approved_price_changed
// was routed to sales_director but the read scope excluded them for 'document'
// events, so the bell was emitted yet permanently empty (fixed by m172).
//
// This test mirrors, in code, two DB-side facts. Keep it in sync when either
// changes (a failure here means routing and RLS have drifted apart):
//   1. ROUTED — the notification routing seed (event_routing, consumer=
//      'notification', role<>'*'), migrations 162 / 168 / 171.
//   2. READ  — the `events read scoped` policy, migrations 092 / 103 / 172.
//
// entity_type per event is read from the CODE source of truth (NOTIFICATION_
// CATALOG), so a change to an event's entity is caught automatically.
// =====================================================================

// 1) Notification routing seed — who is routed what (role<>'*'). Mirror of the
//    DB event_routing rows (verified live 2026-07-15).
const ROUTED: Record<string, EventType[]> = {
  operations: ["doc.shipping_update_requested", "pr.approved", "transport.requested"],
  sales: [
    "doc.shipping_update_completed",
    "pr.info_requested",
    "pr.priced",
    "pr.quotation_generated",
    "pr.rejected",
    "pr.spec_adjusted",
    "transport.cancelled",
    "transport.completed",
    "transport.reopened",
  ],
  sales_director: ["doc.approved_price_changed", "pr.ready_for_pricing", "pr.submitted"],
};

// 2) events read scoped — roles with BROAD read of every event entity (m103).
const BROAD_READERS = new Set(["admin", "task_list_manager", "operations", "super_admin"]);

//    Per-entity read grants beyond the broad roles. An owner-scoped role
//    (e.g. 'sales' owning the underlying document/affair/PR) is listed here as a
//    reader because the routed recipient in that workflow IS the owner. The
//    sales_director / finance broad grants come from m092/m103 (project_request)
//    and m172 (document).
const ENTITY_EXTRA_READERS: Record<string, Set<string>> = {
  document: new Set(["sales" /* owner, m103 */, "sales_director" /* m172 */]),
  project_request: new Set(["sales" /* owner */, "sales_director", "finance" /* m092/m103 */]),
  affair: new Set(["sales" /* owner/client-owner, m103 */]),
  task_list: new Set(["sales" /* owner via quotation, m103 */]),
  production_order: new Set(["sales" /* owner via quotation, m103 */]),
  client: new Set(["sales" /* owner via document, m103 */]),
  system: new Set([]),
};

const canRead = (role: string, entity: string): boolean =>
  BROAD_READERS.has(role) || (ENTITY_EXTRA_READERS[entity]?.has(role) ?? false);

test("every routed notification recipient can READ the event's entity (no 'emitted but muted')", () => {
  const gaps: string[] = [];
  for (const [role, events] of Object.entries(ROUTED)) {
    for (const eventKey of events) {
      const entry = NOTIFICATION_CATALOG[eventKey];
      assert.ok(entry, `routed event ${eventKey} missing from NOTIFICATION_CATALOG`);
      const entity = entry.entity;
      if (!canRead(role, entity)) {
        gaps.push(`${role} is routed ${eventKey} (entity=${entity}) but cannot READ that entity`);
      }
    }
  }
  assert.deepEqual(gaps, [], `Routing↔RLS gaps found:\n  - ${gaps.join("\n  - ")}`);
});

test("regression: sales_director can read 'document' events (doc.approved_price_changed mute, m172)", () => {
  // The concrete bug this whole change fixed. Without the m172 grant, this fails.
  assert.equal(NOTIFICATION_CATALOG["doc.approved_price_changed"].entity, "document");
  assert.ok(
    canRead("sales_director", "document"),
    "sales_director must be able to read 'document' events (m172) — else the approved-price-change bell is muted"
  );
});
