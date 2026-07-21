/**
 * Tests for the m179 Final Validation revisions (lib/task-list-revisions.ts).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). Proves:
 *   - rev labels: A…Z then AA (append-only, count-derived);
 *   - the diff finds changed/added/removed fields, keys lines by identity so
 *     reordering is silent, flattens jsonb blobs, and excludes workflow
 *     columns (status flips must never read as "content changed");
 *   - attachment add/remove is tracked by storage path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  revLabelFromIndex,
  nextRevLabel,
  diffSnapshots,
  formatDiffValue,
  isFrozenStatus,
  type TaskListSnapshot,
} from "../lib/task-list-revisions.ts";

const snap = (over: Partial<TaskListSnapshot> = {}): TaskListSnapshot => ({
  task: { id: "t1", solar_panel_tilt_angle: 10, status: "validated" },
  lines: [],
  lighting: null,
  attachments: [],
  ...over,
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test("rev labels: A…Z then AA, AB", () => {
  assert.equal(revLabelFromIndex(0), "A");
  assert.equal(revLabelFromIndex(25), "Z");
  assert.equal(revLabelFromIndex(26), "AA");
  assert.equal(revLabelFromIndex(27), "AB");
  assert.equal(nextRevLabel([]), "A");
  assert.equal(nextRevLabel(["A", "B"]), "C");
});

test("frozen statuses", () => {
  assert.equal(isFrozenStatus("validated"), true);
  assert.equal(isFrozenStatus("production_ready"), true);
  assert.equal(isFrozenStatus("under_validation"), false);
  assert.equal(isFrozenStatus(null), false);
});

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

test("diff: a changed task field is reported with before/after", () => {
  const d = diffSnapshots(
    snap(),
    snap({ task: { id: "t1", solar_panel_tilt_angle: 15, status: "validated" } })
  );
  assert.deepEqual(d, [
    { path: "task.solar_panel_tilt_angle", kind: "changed", from: 10, to: 15 },
  ]);
});

test("diff: workflow columns are EXCLUDED — a status flip is not a content change", () => {
  const d = diffSnapshots(
    snap({ task: { id: "t1", status: "under_validation", validated_at: null, current_rev: null } }),
    snap({ task: { id: "t1", status: "validated", validated_at: "2026-07-21", current_rev: "A" } })
  );
  assert.deepEqual(d, []);
});

test("diff: jsonb blobs flatten to dot paths", () => {
  const d = diffSnapshots(
    snap({ task: { id: "t1", industrial_spec: { packaging: { version: "neutral" } } } }),
    snap({ task: { id: "t1", industrial_spec: { packaging: { version: "solux_standard" } } } })
  );
  assert.equal(d.length, 1);
  assert.equal(d[0].path, "task.industrial_spec.packaging.version");
  assert.equal(d[0].from, "neutral");
  assert.equal(d[0].to, "solux_standard");
});

test("diff: lines keyed by id — reordering is silent, edits are per-line", () => {
  const a = snap({
    lines: [
      { id: "l1", product_name: "SSLX 60", quantity: 10 },
      { id: "l2", product_name: "Pole 8m", quantity: 10 },
    ],
  });
  const b = snap({
    lines: [
      { id: "l2", product_name: "Pole 8m", quantity: 12 },
      { id: "l1", product_name: "SSLX 60", quantity: 10 },
    ],
  });
  const d = diffSnapshots(a, b);
  assert.deepEqual(d, [
    { path: "line[Pole 8m].quantity", kind: "changed", from: 10, to: 12 },
  ]);
});

test("diff: added and removed lines are called out by name", () => {
  const d = diffSnapshots(
    snap({ lines: [{ id: "l1", product_name: "SSLX 60" }] }),
    snap({ lines: [{ id: "l2", product_name: "AOSPRO 80" }] })
  );
  assert.deepEqual(
    d.map((c) => [c.path, c.kind]).sort(),
    [
      ["line[AOSPRO 80]", "added"],
      ["line[SSLX 60]", "removed"],
    ]
  );
});

test("diff: attachments tracked by storage path", () => {
  const d = diffSnapshots(
    snap({ attachments: [{ storage_path: "a/1.pdf", file_name: "old.pdf" }] }),
    snap({ attachments: [{ storage_path: "a/2.pdf", file_name: "new.pdf" }] })
  );
  assert.deepEqual(
    d.map((c) => [c.path, c.kind]).sort(),
    [
      ["attachment[new.pdf]", "added"],
      ["attachment[old.pdf]", "removed"],
    ]
  );
});

test("diff: lighting setup changes surface under lighting.*", () => {
  const d = diffSnapshots(
    snap({ lighting: { id: "s1", lighting_power: 15 } }),
    snap({ lighting: { id: "s1", lighting_power: 20 } })
  );
  assert.deepEqual(d, [
    { path: "lighting.lighting_power", kind: "changed", from: 15, to: 20 },
  ]);
});

test("diff: identical snapshots diff to nothing", () => {
  const a = snap({
    task: { id: "t1", industrial_spec: { spare_parts: [{ part: "Battery", quantity: 2 }] } },
    lines: [{ id: "l1", config_values: { battery: "65Ah" } }],
  });
  const b = JSON.parse(JSON.stringify(a));
  assert.deepEqual(diffSnapshots(a, b), []);
});

test("formatDiffValue: empty → em dash, long values truncated", () => {
  assert.equal(formatDiffValue(null), "—");
  assert.equal(formatDiffValue(""), "—");
  assert.equal(formatDiffValue(15), "15");
  assert.ok(formatDiffValue("x".repeat(300)).length <= 80);
});
