/**
 * Integrations Phase 1 (Step 1) — capability catalog + enum guards.
 * The server actions themselves (logInteraction / saveMyChannel) enforce
 * `requireCapability` + RLS, which are covered by the permissions system;
 * here we lock the catalog keys and the channel/direction/source validation
 * used by those actions (and mirrored by the m164/m165 CHECK constraints).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_CAPABILITY_KEYS } from "../features/Permissions/lib/capabilities.ts";
import {
  INTERACTION_CHANNELS,
  INTERACTION_DIRECTIONS,
  INTERACTION_SOURCES,
  USER_CHANNELS,
  isInteractionChannel,
  isInteractionDirection,
  isInteractionSource,
  isUserChannel,
} from "../features/Intergration/lib/integrations.ts";

test("capability catalog contains every integration.* key", () => {
  const expected = [
    "integration.log_interaction",
    "integration.send_business",
    "integration.view_team_interactions",
    "integration.manage",
    "integration.manage_api_keys",
  ];
  for (const key of expected) {
    assert.ok(ALL_CAPABILITY_KEYS.includes(key as never), `missing capability: ${key}`);
  }
});

test("interaction channel enum matches the m164 CHECK set", () => {
  assert.deepEqual([...INTERACTION_CHANNELS].sort(), [
    "call",
    "email",
    "meeting",
    "note",
    "telegram",
    "whatsapp",
    "whatsapp_business",
    "zalo",
    "zalo_oa",
  ]);
  assert.ok(isInteractionChannel("zalo_oa"));
  assert.ok(isInteractionChannel("note"));
  assert.equal(isInteractionChannel("sms"), false);
  assert.equal(isInteractionChannel(""), false);
});

test("direction + source enums validate", () => {
  assert.deepEqual([...INTERACTION_DIRECTIONS], ["outbound", "inbound"]);
  assert.deepEqual([...INTERACTION_SOURCES], ["manual", "auto"]);
  assert.ok(isInteractionDirection("inbound"));
  assert.equal(isInteractionDirection("sideways"), false);
  assert.ok(isInteractionSource("auto"));
  assert.equal(isInteractionSource("robot"), false);
});

test("user channel enum is deep-link channels only", () => {
  assert.deepEqual([...USER_CHANNELS], ["zalo", "whatsapp", "telegram"]);
  assert.ok(isUserChannel("whatsapp"));
  // business + non-deep-link channels are NOT self-serviceable handles
  assert.equal(isUserChannel("zalo_oa"), false);
  assert.equal(isUserChannel("email"), false);
});
