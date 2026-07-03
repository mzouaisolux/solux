/**
 * Event contextual help tests.
 *
 * Guarantees the business-facing help stays 1:1 with the emitted catalog
 * (no event ships without an explanation, no stale help for a removed
 * event) and that every entry is actually filled in.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_HELP, getEventHelp } from "../lib/event-help.ts";
import { NOTIFICATION_EVENT_KEYS } from "../lib/notification-catalog.ts";

test("help covers EXACTLY the emitted catalog (no drift)", () => {
  const helpKeys = new Set(Object.keys(EVENT_HELP));
  const catalogKeys = new Set(NOTIFICATION_EVENT_KEYS as string[]);
  for (const k of catalogKeys) {
    assert.ok(helpKeys.has(k), `missing help for emitted event ${k}`);
  }
  for (const k of helpKeys) {
    assert.ok(catalogKeys.has(k), `stale help for unknown event ${k}`);
  }
  assert.equal(helpKeys.size, catalogKeys.size, "help/catalog size mismatch");
});

test("every help entry is complete (when / why / ≥1 recipient)", () => {
  for (const key of NOTIFICATION_EVENT_KEYS) {
    const h = EVENT_HELP[key];
    assert.ok(h.when.trim().length > 10, `when too short: ${key}`);
    assert.ok(h.why.trim().length > 10, `why too short: ${key}`);
    assert.ok(
      Array.isArray(h.recipients) && h.recipients.length >= 1,
      `no recipients: ${key}`
    );
    for (const r of h.recipients) {
      assert.ok(r.trim().length > 0, `blank recipient in ${key}`);
    }
  }
});

test("getEventHelp: known key returns entry, unknown returns null", () => {
  assert.ok(getEventHelp("po.created"));
  assert.equal(getEventHelp("does.not.exist"), null);
});
