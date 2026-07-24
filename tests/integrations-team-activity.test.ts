/**
 * Integrations area D — team-activity rollup (pure aggregation).
 *
 * The action does capability-gated, RLS-scoped queries + name resolution
 * (covered by the permissions system); here we lock the pure bucketing and
 * stale detection the view depends on.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weekStartUTC,
  recentWeekStarts,
  buildTeamActivity,
} from "../features/Intergration/lib/team-activity.ts";

test("weekStartUTC anchors to the Monday of the week (UTC)", () => {
  assert.equal(weekStartUTC(new Date("2026-07-22T13:00:00Z")), "2026-07-20"); // Wed → Mon
  assert.equal(weekStartUTC(new Date("2026-07-20T00:00:00Z")), "2026-07-20"); // Mon → itself
  assert.equal(weekStartUTC(new Date("2026-07-19T23:59:00Z")), "2026-07-13"); // Sun → prev Mon
});

test("recentWeekStarts returns N Monday anchors, oldest → newest", () => {
  const w = recentWeekStarts(new Date("2026-07-22T00:00:00Z"), 4);
  assert.deepEqual(w, ["2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20"]);
});

test("buildTeamActivity buckets interactions by rep × week and sorts by total", () => {
  const now = new Date("2026-07-22T12:00:00Z"); // week of 07-20
  const r = buildTeamActivity({
    now,
    weeks: 4,
    staleDays: 14,
    clients: [],
    interactions: [
      { repId: "klairs", happenedAt: "2026-07-21T09:00:00Z" }, // wk 07-20
      { repId: "klairs", happenedAt: "2026-07-20T09:00:00Z" }, // wk 07-20
      { repId: "klairs", happenedAt: "2026-07-08T09:00:00Z" }, // wk 07-06
      { repId: "minh", happenedAt: "2026-07-21T09:00:00Z" }, // wk 07-20
      { repId: null, happenedAt: "2026-07-21T09:00:00Z" }, // no rep → ignored
      { repId: "klairs", happenedAt: "2026-01-01T00:00:00Z" }, // outside window → ignored
    ],
  });
  assert.deepEqual(r.weeks, ["2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20"]);
  assert.equal(r.reps[0].repId, "klairs"); // higher total sorts first
  assert.deepEqual(r.reps[0].perWeek, [0, 1, 0, 2]);
  assert.equal(r.reps[0].total, 3);
  assert.equal(r.reps[1].repId, "minh");
  assert.deepEqual(r.reps[1].perWeek, [0, 0, 0, 1]);
  assert.deepEqual(r.totalsPerWeek, [0, 1, 0, 3]);
});

test("buildTeamActivity flags stale + never-contacted accounts, never first, gap desc", () => {
  const now = new Date("2026-07-22T00:00:00Z");
  const r = buildTeamActivity({
    now,
    weeks: 4,
    staleDays: 14,
    interactions: [],
    clients: [
      { id: "fresh", lastAt: "2026-07-20T00:00:00Z" }, // 2 days → not stale
      { id: "quiet14", lastAt: "2026-07-01T00:00:00Z" }, // 21 days → stale
      { id: "quiet30", lastAt: "2026-06-15T00:00:00Z" }, // 37 days → stale
      { id: "never", lastAt: null }, // never → stale, first
    ],
  });
  assert.deepEqual(
    r.stale.map((s) => s.clientId),
    ["never", "quiet30", "quiet14"]
  );
  assert.equal(r.stale.find((s) => s.clientId === "never")?.daysSince, null);
  assert.equal(r.stale.find((s) => s.clientId === "quiet14")?.daysSince, 21);
});
