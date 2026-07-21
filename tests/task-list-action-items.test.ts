/**
 * Tests for the m178 Pre-Validation action items (lib/task-list-action-items.ts)
 * and their release-gate integration (evaluateRelease).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). Proves:
 *   - normalization survives junk and fails safe (unknown status keeps gating);
 *   - only OPEN blocking items gate — done/dismissed release the gate;
 *   - evaluateRelease refuses while blocking items are open, with the item
 *     count in the reason, and still passes when they're resolved.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeActionItem,
  openBlockingItems,
  pendingItemsSorted,
  isPendingActionStatus,
  type TaskListActionItem,
} from "../lib/task-list-action-items.ts";
import { evaluateRelease } from "../lib/task-list-mapping-status.ts";

const item = (over: Partial<TaskListActionItem>): TaskListActionItem => ({
  id: "i1",
  task_list_id: "tl1",
  title: "Waiting for pole calculation",
  details: null,
  department: "factory",
  assignee: null,
  status: "open",
  blocking: false,
  due_date: null,
  created_by: null,
  created_at: "2026-07-21T00:00:00Z",
  resolved_at: null,
  resolved_by: null,
  ...over,
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test("normalize: junk and title-less rows are unusable", () => {
  assert.equal(normalizeActionItem(null), null);
  assert.equal(normalizeActionItem("x"), null);
  assert.equal(normalizeActionItem({ id: "a", task_list_id: "b" }), null);
});

test("normalize: unknown department falls back to 'other', unknown status to 'open'", () => {
  const r = normalizeActionItem({
    id: "a",
    task_list_id: "b",
    title: "T",
    department: "aliens",
    status: "approved??",
    blocking: true,
  })!;
  assert.equal(r.department, "other");
  // Fail-safe: an unrecognized status must KEEP the item pending (and thus
  // keep gating when blocking) rather than silently vanish from the board.
  assert.equal(r.status, "open");
  assert.equal(r.blocking, true);
});

// ---------------------------------------------------------------------------
// Gate semantics
// ---------------------------------------------------------------------------

test("only OPEN/IN-PROGRESS blocking items gate", () => {
  const items = [
    item({ id: "1", blocking: true, status: "open" }),
    item({ id: "2", blocking: true, status: "in_progress" }),
    item({ id: "3", blocking: true, status: "done" }),
    item({ id: "4", blocking: true, status: "dismissed" }),
    item({ id: "5", blocking: false, status: "open" }),
  ];
  assert.deepEqual(openBlockingItems(items).map((i) => i.id), ["1", "2"]);
  assert.equal(isPendingActionStatus("done"), false);
  assert.equal(isPendingActionStatus("in_progress"), true);
});

test("pending sort: blocking first, then earliest due date", () => {
  const items = [
    item({ id: "late", due_date: "2026-09-01" }),
    item({ id: "block", blocking: true, due_date: "2026-12-31" }),
    item({ id: "soon", due_date: "2026-08-01" }),
    item({ id: "resolved", status: "done" }),
  ];
  assert.deepEqual(pendingItemsSorted(items).map((i) => i.id), ["block", "soon", "late"]);
});

// ---------------------------------------------------------------------------
// evaluateRelease (m178)
// ---------------------------------------------------------------------------

const BASE = {
  statusAllowed: true,
  missingCount: 0,
  hasOpenRevision: false,
  lineCount: 3,
};

test("evaluateRelease (m178): REFUSES while blocking items are open, with count", () => {
  const r = evaluateRelease({ ...BASE, openBlockingActionItems: 2 });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /2 blocking pre-validation items/i);
});

test("evaluateRelease (m178): blocking items outrank the revision loop", () => {
  const r = evaluateRelease({
    ...BASE,
    hasOpenRevision: true,
    openBlockingActionItems: 1,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /blocking pre-validation item/i);
});

test("evaluateRelease (m178): PASSES at zero / undefined (pre-migration)", () => {
  assert.equal(evaluateRelease({ ...BASE, openBlockingActionItems: 0 }).ok, true);
  assert.equal(evaluateRelease(BASE).ok, true);
});
