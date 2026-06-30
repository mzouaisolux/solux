/**
 * Unified Event Registry tests (Step 1, m136).
 *
 * Headline guarantees:
 *  - the CONSUMERS descriptor is internally consistent (drives the admin UI),
 *  - identity resolution with NO override reproduces the code catalog EXACTLY
 *    for every event (so the registry ships invisible),
 *  - overrides win field-by-field, and a severity override recomputes
 *    requires_action unless explicitly pinned.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSUMERS,
  CONSUMER_BY_KEY,
  GLOBAL_ROLE,
  resolveEventIdentity,
  baselineRequiresAction,
  indexRouting,
  activeConsumers,
  type RoutingRow,
} from "../lib/event-registry.ts";
import {
  NOTIFICATION_CATALOG,
  NOTIFICATION_EVENT_KEYS,
} from "../lib/notification-catalog.ts";
import { eventRaisesBell } from "../lib/events-shared.ts";

/* --------------------------- descriptor ---------------------------- */

test("CONSUMERS registry is internally consistent", () => {
  const keys = CONSUMERS.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length, "consumer keys must be unique");
  assert.ok(CONSUMER_BY_KEY["notification"], "notification consumer present");
  assert.equal(CONSUMER_BY_KEY["notification"].status, "live");
  assert.equal(CONSUMER_BY_KEY["automation"].status, "reserved");
  for (const c of CONSUMERS) {
    assert.ok(c.label && c.icon, `descriptor missing label/icon: ${c.key}`);
    assert.ok(Array.isArray(c.fields), `descriptor fields not array: ${c.key}`);
    for (const f of c.fields) {
      assert.ok(f.key && f.kind && f.label, `bad field on ${c.key}`);
      if (f.kind === "select" || f.kind === "multiselect") {
        assert.ok(f.options.length > 0, `empty options on ${c.key}.${f.key}`);
      }
    }
  }
  assert.equal(GLOBAL_ROLE, "*");
});

/* ----------------------- migration safety -------------------------- */

test("resolveEventIdentity with NO override == code baseline, every event", () => {
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const base = NOTIFICATION_CATALOG[key];
    const id = resolveEventIdentity(key, null);
    assert.equal(id.label, base.label, `label ${key}`);
    assert.equal(id.category, base.category, `category ${key}`);
    assert.equal(id.severity, base.severity, `severity ${key}`);
    assert.equal(id.enabled, true, `enabled default ${key}`);
    assert.equal(id.description, null, `description default ${key}`);
    assert.equal(id.icon, null, `icon default ${key}`);
    // requires_action baseline mirrors the legacy bell-on-creation decision
    assert.equal(
      id.requiresAction,
      eventRaisesBell({ severity: base.severity, event_type: key }),
      `requiresAction ${key}`
    );
  }
});

test("baselineRequiresAction mirrors eventRaisesBell exactly", () => {
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const sev = NOTIFICATION_CATALOG[key].severity;
    assert.equal(
      baselineRequiresAction(key, sev),
      eventRaisesBell({ severity: sev, event_type: key }),
      `mismatch ${key}`
    );
  }
});

/* --------------------------- overrides ----------------------------- */

test("identity override wins field-by-field; severity recomputes action", () => {
  const key = "client.contact_added"; // normally low / no action
  const base = NOTIFICATION_CATALOG[key];
  assert.equal(base.severity, "low");

  const a = resolveEventIdentity(key, {
    label: "Custom label",
    icon: "🎯",
    description: "hi",
  });
  assert.equal(a.label, "Custom label");
  assert.equal(a.icon, "🎯");
  assert.equal(a.description, "hi");
  assert.equal(a.category, base.category, "untouched field falls back to baseline");
  assert.equal(a.requiresAction, false, "still low ⇒ no action");

  // bump severity low → high ⇒ requires_action recomputed to true
  const b = resolveEventIdentity(key, { severity: "high" });
  assert.equal(b.severity, "high");
  assert.equal(b.requiresAction, true);

  // explicit requires_action override wins over the recompute
  const c = resolveEventIdentity(key, { severity: "high", requires_action: false });
  assert.equal(c.requiresAction, false);

  // enabled flag
  assert.equal(resolveEventIdentity(key, { enabled: false }).enabled, false);
});

/* ----------------------- routing helpers --------------------------- */

test("indexRouting + activeConsumers", () => {
  const rows: RoutingRow[] = [
    { event_key: "po.cancelled", consumer: "notification", role: "sales", config: { channel: "off" } },
    { event_key: "po.cancelled", consumer: "dashboard", role: "operations", config: { section: "at_risk" } },
    { event_key: "po.cancelled", consumer: "audit", role: "*", config: { visibility: "internal" }, enabled: false },
    { event_key: "po.cancelled", consumer: "bogus", role: "*", config: {} },
  ];
  const idx = indexRouting(rows);
  assert.equal(idx.get("notification:sales")?.config.channel, "off");
  assert.equal(idx.get("dashboard:operations")?.config.section, "at_risk");

  const active = activeConsumers(rows);
  assert.ok(active.has("notification"));
  assert.ok(active.has("dashboard"));
  assert.ok(!active.has("audit"), "disabled row excluded");
  assert.ok(!active.has("kpi"), "no kpi row");
  assert.equal(active.size, 2, "unknown consumer ignored");
});
