/**
 * Order severity tests — locks the Operations V2 board's 3-tier scoring.
 *
 * deriveOrderSeverity only RANKS signals that already exist (alert level,
 * stage tone, pill tones, attached action sections). These tests pin the
 * precedence (blocked > at risk > on track) and the rank ordering so the
 * sort never silently inverts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveOrderSeverity } from "../lib/order-severity.ts";

test("a blocking alert level → blocked", () => {
  for (const level of ["overdue", "delayed", "balance_due"] as const) {
    assert.equal(deriveOrderSeverity({ alertLevel: level }).tier, "blocked");
  }
});

test("a red stage tone → blocked (no production order needed)", () => {
  assert.equal(
    deriveOrderSeverity({ alertLevel: null, stageTone: "red" }).tier,
    "blocked"
  );
});

test("a danger pill → blocked", () => {
  assert.equal(
    deriveOrderSeverity({ pillTones: ["default", "danger"] }).tier,
    "blocked"
  );
});

test("a blocked-category signal → blocked", () => {
  assert.equal(
    deriveOrderSeverity({ actionCategories: ["blocked"] }).tier,
    "blocked"
  );
});

test("awaiting deposit / completion approaching → at risk", () => {
  for (const level of ["awaiting_deposit", "completion_approaching"] as const) {
    assert.equal(deriveOrderSeverity({ alertLevel: level }).tier, "at_risk");
  }
});

test("an action-required-category signal → action required", () => {
  assert.equal(
    deriveOrderSeverity({ actionCategories: ["action_required"] }).tier,
    "action_required"
  );
});

test("an at-risk-category signal → at risk", () => {
  assert.equal(
    deriveOrderSeverity({ actionCategories: ["at_risk"] }).tier,
    "at_risk"
  );
});

test("clean order → on track", () => {
  assert.equal(
    deriveOrderSeverity({ alertLevel: "ok", stageTone: "sky", pillTones: ["info"] })
      .tier,
    "on_track"
  );
});

test("tier ranks: blocked > action required > at risk > on track", () => {
  const blocked = deriveOrderSeverity({ alertLevel: "overdue" }).rank;
  const action = deriveOrderSeverity({ actionCategories: ["action_required"] }).rank;
  const atRisk = deriveOrderSeverity({ alertLevel: "awaiting_deposit" }).rank;
  const onTrack = deriveOrderSeverity({ alertLevel: "ok" }).rank;
  assert.ok(blocked > action, "blocked > action required");
  assert.ok(action > atRisk, "action required > at risk");
  assert.ok(atRisk > onTrack, "at risk > on track");
});

test("blocked precedence wins over an action-required signal", () => {
  assert.equal(
    deriveOrderSeverity({
      stageTone: "red", // blocking (e.g. needs revision / delayed)
      actionCategories: ["action_required"], // also has a to-do
    }).tier,
    "blocked"
  );
});

test("more alarming signals sort above fewer, within the same tier", () => {
  const many = deriveOrderSeverity({
    alertLevel: "overdue",
    pillTones: ["danger", "danger"],
    actionSections: ["urgent"],
  }).rank;
  const few = deriveOrderSeverity({ alertLevel: "overdue" }).rank;
  assert.ok(many > few, "3-problem deal sorts above 1-problem deal");
});

test("blocked precedence wins even when at-risk signals are also present", () => {
  assert.equal(
    deriveOrderSeverity({
      alertLevel: "awaiting_deposit", // at-risk
      stageTone: "red", // blocking
    }).tier,
    "blocked"
  );
});
