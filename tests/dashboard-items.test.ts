/**
 * Dashboard items engine tests — Phase 2 (locked spec PLAN_CRM_SOLUX
 * §11.2). Locks in the OWNER-VALIDATED definitions:
 *
 *   • Devis bloqué = sent + still active + (no open action on its
 *     affair OR every open action overdue). An open reminder counts as
 *     "someone is pushing". No double-listing with "no next action".
 *   • Affaire sans next action (critical) vs affaire endormie
 *     (preventive: actions exist, none inside the window).
 *   • Buckets: Critical → Due Today → Preventive; ownership scope =
 *     owner_id ?? created_by; preventive window comes from the m120
 *     setting (param, never hardcoded).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSalesItems,
  buildOpsPreventive,
  opsBucketOf,
  latestPerFamily,
} from "../lib/dashboard-items.ts";

const TODAY = "2026-06-13";
const ME = "user-me";
const OTHER = "user-other";

const affair = (id: string, over: any = {}) => ({
  id,
  name: `Affair ${id}`,
  status: "quotation",
  owner_id: ME,
  created_by: ME,
  archived_at: null,
  clients: { company_name: "ACME" },
  ...over,
});

const action = (id: string, affairId: string, due: string, over: any = {}) => ({
  id,
  affair_id: affairId,
  tender_id: null,
  action_type: "call",
  title: `Call ${id}`,
  due_date: due,
  affairs: {
    id: affairId,
    name: `Affair ${affairId}`,
    status: "quotation",
    archived_at: null,
    owner_id: ME,
    created_by: ME,
    clients: { company_name: "ACME" },
  },
  ...over,
});

const doc = (id: string, over: any = {}) => ({
  id,
  number: `Q-${id}`,
  status: "sent",
  total_price: 1000,
  currency: "USD",
  date: "2026-06-01",
  created_by: ME,
  sales_owner_id: null,
  affair_id: null,
  root_document_id: null,
  version: 1,
  archived_at: null,
  ...over,
});

const build = (over: any = {}) =>
  buildSalesItems({
    actions: [],
    affairs: [],
    quoteFamilyDocs: [],
    reminders: [],
    today: TODAY,
    preventiveDays: 7,
    scopeUserId: null,
    ...over,
  });

/* ------------------------- devis bloqué ---------------------------- */

test("blocked quote: sent + no action anywhere → critical", () => {
  const r = build({ quoteFamilyDocs: [doc("q1")] });
  assert.equal(r.critical.length, 1);
  assert.equal(r.critical[0].kind, "blocked_quote");
  assert.equal(r.critical[0].href, "/documents/q1");
});

test("blocked quote: a FUTURE action on its affair = someone is pushing → not blocked", () => {
  const r = build({
    affairs: [affair("a1")],
    actions: [action("ac1", "a1", "2026-06-20")],
    quoteFamilyDocs: [doc("q1", { affair_id: "a1" })],
  });
  assert.ok(!r.critical.some((i) => i.kind === "blocked_quote"));
});

test("blocked quote: ONLY overdue actions on its affair → blocked (locked definition)", () => {
  const r = build({
    affairs: [affair("a1")],
    actions: [action("ac1", "a1", "2026-06-01")], // overdue
    quoteFamilyDocs: [doc("q1", { affair_id: "a1" })],
  });
  assert.ok(r.critical.some((i) => i.kind === "blocked_quote"));
  // and the overdue action itself is also critical
  assert.ok(r.critical.some((i) => i.kind === "action_overdue"));
});

test("blocked quote: an open reminder counts as pushing → not blocked", () => {
  const r = build({
    quoteFamilyDocs: [doc("q1")],
    reminders: [
      { id: "r1", user_id: ME, document_id: "q1", remind_at: "2026-06-20", status: "open", note: null },
    ],
  });
  assert.ok(!r.critical.some((i) => i.kind === "blocked_quote"));
});

test("no double-listing: quote on a no-next-action affair → only the affair item", () => {
  const r = build({
    affairs: [affair("a1")],
    quoteFamilyDocs: [doc("q1", { affair_id: "a1" })],
  });
  const kinds = r.critical.map((i) => i.kind);
  assert.ok(kinds.includes("no_next_action"));
  assert.ok(!kinds.includes("blocked_quote"));
});

test("latest version decides: family whose latest is won → no blocked item", () => {
  const fam = [
    doc("q1", { root_document_id: "q1", version: 1, status: "sent" }),
    doc("q2", { root_document_id: "q1", version: 2, status: "won" }),
  ];
  assert.equal(latestPerFamily(fam)[0].id, "q2");
  const r = build({ quoteFamilyDocs: fam });
  assert.equal(r.critical.length, 0);
});

/* ----------------- sans next action vs endormie -------------------- */

test("live affair without open action → critical no_next_action", () => {
  const r = build({ affairs: [affair("a1")] });
  assert.equal(r.critical[0].kind, "no_next_action");
});

test("won/archived affairs are exempt from the golden rule", () => {
  const r = build({
    affairs: [affair("a1", { status: "won" }), affair("a2", { archived_at: "2026-01-01" })],
  });
  assert.equal(r.critical.length, 0);
});

test("parked affair: actions exist but none inside the window → preventive", () => {
  const r = build({
    affairs: [affair("a1")],
    actions: [action("ac1", "a1", "2026-07-15")], // 32d away > 7d window
  });
  assert.ok(!r.critical.some((i) => i.kind === "no_next_action"));
  assert.equal(r.preventive[0]?.kind, "parked_affair");
});

test("affair with an action INSIDE the window: neither critical nor parked", () => {
  const r = build({
    affairs: [affair("a1")],
    actions: [action("ac1", "a1", "2026-06-18")], // 5d < 7d window
  });
  assert.equal(r.critical.length, 0);
  assert.equal(r.preventive.length, 0);
});

/* ------------------------ buckets + scope -------------------------- */

test("action due today → due_today; overdue → critical; reminders likewise", () => {
  const r = build({
    affairs: [affair("a1")],
    actions: [action("ac1", "a1", TODAY), action("ac2", "a1", "2026-06-10")],
    reminders: [
      { id: "r1", user_id: ME, document_id: "d1", remind_at: TODAY, status: "open", note: null },
      { id: "r2", user_id: ME, document_id: "d2", remind_at: "2026-06-01", status: "open", note: "old" },
    ],
  });
  assert.deepEqual(
    r.dueToday.map((i) => i.kind).sort(),
    ["action_today", "reminder_today"]
  );
  assert.ok(r.critical.some((i) => i.kind === "action_overdue"));
  assert.ok(r.critical.some((i) => i.kind === "reminder_overdue"));
});

test("My Items scope: owner_id ?? created_by — other people's items drop", () => {
  const r = build({
    scopeUserId: ME,
    affairs: [affair("a1"), affair("a2", { owner_id: OTHER, created_by: OTHER })],
    quoteFamilyDocs: [doc("q1", { created_by: OTHER })],
  });
  assert.equal(r.critical.length, 1); // only MY sleeping affair
  assert.equal(r.critical[0].id, "aff:a1");
});

test("quote without reply: sent beyond the window, pushed → preventive (not blocked)", () => {
  const r = build({
    affairs: [affair("a1")],
    actions: [action("ac1", "a1", "2026-06-15")], // future = pushing
    quoteFamilyDocs: [doc("q1", { affair_id: "a1", date: "2026-06-01" })], // 12d > 7
  });
  assert.ok(r.preventive.some((i) => i.kind === "quote_no_reply"));
  assert.ok(!r.critical.some((i) => i.kind === "blocked_quote"));
});

/* -------------------------- operations ----------------------------- */

test("ops re-bucketing follows the locked mapping", () => {
  assert.equal(opsBucketOf("urgent"), "critical");
  assert.equal(opsBucketOf("waiting_me"), "due_today");
  assert.equal(opsBucketOf("info_missing"), "due_today");
  assert.equal(opsBucketOf("waiting_client"), "preventive");
});

test("ops preventive: ETA close, prod deadline close, tasklist incomplete — window applied", () => {
  const items = buildOpsPreventive({
    orders: [
      { id: "o1", order_number: "SO-1", status: "in_production", eta: "2026-06-18" },
      { id: "o2", order_number: "SO-2", status: "in_production", current_production_deadline: "2026-06-16" },
      { id: "o3", order_number: "SO-3", status: "deposit_received", quotation_id: "q9" },
      { id: "o4", order_number: "SO-4", status: "in_production", eta: "2026-08-01" }, // beyond window
      { id: "o5", order_number: "SO-5", status: "shipped", eta: "2026-06-14" }, // terminal
    ],
    taskListStatusByQuotation: new Map([["q9", "draft"]]),
    today: TODAY,
    windowDays: 7,
  });
  assert.deepEqual(items.map((i) => i.kind).sort(), [
    "eta_close",
    "prod_deadline_close",
    "tasklist_incomplete",
  ]);
  const eta = items.find((i) => i.kind === "eta_close")!;
  assert.equal(eta.href, "/operations/o1");
});
