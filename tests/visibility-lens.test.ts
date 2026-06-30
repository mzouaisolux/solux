/**
 * Visibility engine (m067) — lens narrowing vs the Task List Manager queue.
 *
 * Regression lock for the "a SUBMITTED task list never appears for the Task
 * List Manager" bug. Root cause: the `production` lens exposes task lists only
 * at validated/production_ready, so a TLM whose visibility scope is a
 * production lens (not `all`) had every just-submitted (`under_validation`)
 * task list hidden by canSeeRecord — masked when testing as admin (scope.all).
 *
 * Fix (app/(app)/task-lists/page.tsx): a technical role always keeps its
 * actionable queue (TASK_LIST_TLM_QUEUE = under_validation) regardless of the
 * lens. These tests pin the lens contract + the queue the guard protects.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { canSeeRecord, type VisibilityScope } from "../lib/visibility.ts";
import { TASK_LIST_TLM_QUEUE } from "../lib/types.ts";

const scope = (over: Partial<VisibilityScope>): VisibilityScope => ({
  all: false,
  ownerIds: new Set<string>(),
  regionIds: new Set<string>(),
  lenses: new Set(),
  fromGrants: true,
  ...over,
});

test("ROOT CAUSE: a production lens HIDES an under_validation task list owned by someone else", () => {
  assert.equal(
    canSeeRecord(scope({ lenses: new Set(["production"]) }), {
      kind: "task_list",
      status: "under_validation",
      ownerId: "another-user",
    }),
    false
  );
});

test("a production lens EXPOSES validated / production_ready task lists (lens works as designed)", () => {
  const s = scope({ lenses: new Set(["production"]) });
  assert.equal(canSeeRecord(s, { kind: "task_list", status: "validated", ownerId: "x" }), true);
  assert.equal(canSeeRecord(s, { kind: "task_list", status: "production_ready", ownerId: "x" }), true);
});

test("an 'all' scope (default ungranted technical role) sees an under_validation task list", () => {
  assert.equal(
    canSeeRecord(scope({ all: true }), {
      kind: "task_list",
      status: "under_validation",
      ownerId: "x",
    }),
    true
  );
});

test("the TLM actionable queue the page guard protects includes under_validation", () => {
  // The page-level guard re-admits exactly these statuses for technical roles,
  // compensating for the lens gap above.
  assert.ok(TASK_LIST_TLM_QUEUE.includes("under_validation"));
});

test("owning the record still grants visibility regardless of lens/status", () => {
  assert.equal(
    canSeeRecord(scope({ ownerIds: new Set(["me"]) }), {
      kind: "task_list",
      status: "under_validation",
      ownerId: "me",
    }),
    true
  );
});
