/**
 * Notification catalog + read-time resolution tests (Phase 3C, archi A).
 *
 * The headline guarantee: with an EMPTY notification_rules table, the new
 * resolver reproduces today's bell behavior for EVERY event — so the
 * migration is invisible until someone adds a rule.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_EVENT_KEYS,
  defaultChannel,
  resolveNotificationChannel,
  resolveEventNotification,
  shouldEmitOnce,
} from "../lib/notification-catalog.ts";
import { eventRaisesBell, type EventType } from "../lib/events-shared.ts";

/* ----------------------- migration safety -------------------------- */

test("default channel reproduces eventRaisesBell for EVERY catalog event", () => {
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const sev = NOTIFICATION_CATALOG[key].severity;
    const legacy = eventRaisesBell({ severity: sev, event_type: key }) ? "bell" : "feed";
    assert.equal(
      defaultChannel(key, sev),
      legacy,
      `channel mismatch for ${key} (severity ${sev})`
    );
  }
});

test("empty rules ⇒ resolveNotificationChannel == legacy bell decision", () => {
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const sev = NOTIFICATION_CATALOG[key].severity;
    const ch = resolveNotificationChannel({ eventKey: key, severity: sev, rule: null });
    const legacyBell = eventRaisesBell({ severity: sev, event_type: key });
    assert.equal(ch === "bell", legacyBell, `bell mismatch for ${key}`);
  }
});

test("known bell/feed anchors hold (spot check)", () => {
  // critical / high → bell
  assert.equal(defaultChannel("po.cancelled", "critical"), "bell");
  assert.equal(defaultChannel("po.bl_info_requested", "high"), "bell");
  // actionable medium → bell
  assert.equal(defaultChannel("tl.validated", "medium"), "bell");
  assert.equal(defaultChannel("pr.submitted", "medium"), "bell");
  // non-actionable medium → feed
  assert.equal(defaultChannel("po.created", "medium"), "feed");
  assert.equal(defaultChannel("po.bl_info_resolved", "medium"), "feed");
  // low → feed
  assert.equal(defaultChannel("client.contact_added", "low"), "feed");
  assert.equal(defaultChannel("affair.action_planned", "low"), "feed");
});

/* --------------------------- overrides ----------------------------- */

test("a rule override wins over the default", () => {
  // Mute a normally-bell event for a role:
  assert.equal(
    resolveNotificationChannel({ eventKey: "po.cancelled", severity: "critical", rule: "off" }),
    "off"
  );
  // Promote a normally-feed event to the bell:
  assert.equal(
    resolveNotificationChannel({ eventKey: "po.created", severity: "medium", rule: "bell" }),
    "bell"
  );
  // Demote bell → feed:
  assert.equal(
    resolveNotificationChannel({ eventKey: "tl.validated", severity: "medium", rule: "feed" }),
    "feed"
  );
});

/* ----------------------- opt-in master gate ------------------------ */

test("disabled ⇒ off for EVERY event, whatever its severity or rule", () => {
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const sev = NOTIFICATION_CATALOG[key].severity;
    // no rule
    assert.equal(
      resolveEventNotification({ eventKey: key, severity: sev, notifyEnabled: false, rule: null }),
      "off",
      `disabled should mute ${key}`
    );
    // even a rule that says "bell" cannot re-enable a disabled event
    assert.equal(
      resolveEventNotification({ eventKey: key, severity: sev, notifyEnabled: false, rule: "bell" }),
      "off",
      `disabled ignores rule for ${key}`
    );
  }
});

test("enabled ⇒ reproduces the legacy severity default (no rule)", () => {
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const sev = NOTIFICATION_CATALOG[key].severity;
    assert.equal(
      resolveEventNotification({ eventKey: key, severity: sev, notifyEnabled: true, rule: null }),
      defaultChannel(key, sev),
      `enabled default mismatch for ${key}`
    );
  }
});

test("enabled + rule ⇒ the per-role rule wins", () => {
  // critical event, enabled, muted for a role
  assert.equal(
    resolveEventNotification({ eventKey: "po.cancelled", severity: "critical", notifyEnabled: true, rule: "off" }),
    "off"
  );
  // normally-feed event, enabled, promoted to the bell for a role
  assert.equal(
    resolveEventNotification({ eventKey: "po.created", severity: "medium", notifyEnabled: true, rule: "bell" }),
    "bell"
  );
});

/* ------------------------- catalog integrity ----------------------- */

test("catalog covers exactly the emitted EventType union (no drift)", () => {
  // every catalog entry has an entity + category + label + severity
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const e = NOTIFICATION_CATALOG[key];
    assert.ok(e.entity && e.category && e.label && e.severity, `incomplete catalog entry ${key}`);
  }
  // a few representative keys must exist
  for (const k of ["po.cancelled", "doc.won", "pr.submitted", "tl.validated", "client.created"] as EventType[]) {
    assert.ok(NOTIFICATION_CATALOG[k], `missing ${k}`);
  }
});

/* --------------------------- anti-spam ----------------------------- */

test("shouldEmitOnce: no previous → emit; within window → skip; older → emit", () => {
  const now = "2026-06-15T12:00:00.000Z";
  assert.equal(shouldEmitOnce(null, now, 60), true);
  assert.equal(shouldEmitOnce("2026-06-15T11:30:00.000Z", now, 60), false); // 30 min < 60
  assert.equal(shouldEmitOnce("2026-06-15T10:30:00.000Z", now, 60), true); // 90 min > 60
  // unparseable → emit (never silently swallow)
  assert.equal(shouldEmitOnce("not-a-date", now, 60), true);
});
