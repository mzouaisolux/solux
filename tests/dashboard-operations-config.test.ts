/**
 * Operations dashboard rulebook tests — guards the single source of tuning.
 * The values WILL change with calibration; these only lock invariants that
 * keep the dashboard coherent, not the specific calibration choices.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIGNAL_RULES,
  ruleFor,
  DEFAULT_RULE,
  categoryTone,
  CATEGORY_META,
} from "../lib/dashboard-operations-config.ts";

const CATEGORIES = ["blocked", "action_required", "at_risk"] as const;
const PLACEMENTS = ["today", "flight", "both", "off"] as const;

test("every rule has a valid category, placement and non-empty label", () => {
  for (const [kind, r] of Object.entries(SIGNAL_RULES)) {
    assert.ok(CATEGORIES.includes(r.category as any), `${kind} category`);
    assert.ok(PLACEMENTS.includes(r.placement as any), `${kind} placement`);
    assert.ok(r.label.trim().length > 0, `${kind} label`);
    assert.equal(typeof r.priority, "number", `${kind} priority`);
  }
});

test("ruleFor falls back to DEFAULT_RULE for an unknown kind", () => {
  assert.deepEqual(ruleFor("totally_unknown_kind"), DEFAULT_RULE);
});

test("ruleFor returns the configured rule for a known kind", () => {
  assert.equal(ruleFor("production_late").category, "blocked");
  assert.equal(ruleFor("deposit").category, "at_risk");
});

test("tenders are disabled in the Operations toggle (placement off)", () => {
  assert.equal(ruleFor("tender_stalled").placement, "off");
});

test("categoryTone maps each category to a badge tone", () => {
  assert.equal(categoryTone("blocked"), "danger");
  assert.equal(categoryTone("action_required"), "warn");
  assert.equal(categoryTone("at_risk"), "info");
});

test("CATEGORY_META covers all three categories", () => {
  for (const c of CATEGORIES) {
    assert.ok(CATEGORY_META[c]?.label, `${c} meta`);
  }
});
