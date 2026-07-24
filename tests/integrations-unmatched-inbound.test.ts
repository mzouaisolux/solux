/**
 * Integrations — unmatched-inbound (m184) pure logic.
 *
 * The server actions (list/reconcile/ignore) enforce requireCapability +
 * RLS, covered by the permissions system. Here we lock the pure pieces the
 * inbound route + review panel share: the status enum (mirrors the m184 CHECK
 * set), the phone-based match resolver, and the review-list summary.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNMATCHED_STATUSES,
  isUnmatchedStatus,
  resolveInboundMatch,
  inboundSummary,
  type InboundMatchCandidate,
} from "../features/Intergration/lib/integrations.ts";

test("unmatched status enum matches the m184 CHECK set", () => {
  assert.deepEqual([...UNMATCHED_STATUSES].sort(), ["ignored", "pending", "resolved"]);
  assert.ok(isUnmatchedStatus("pending"));
  assert.ok(isUnmatchedStatus("resolved"));
  assert.ok(isUnmatchedStatus("ignored"));
  assert.ok(!isUnmatchedStatus("done"));
  assert.ok(!isUnmatchedStatus(""));
});

test("resolveInboundMatch matches an E.164 sender to a stored local number", () => {
  const candidates: InboundMatchCandidate[] = [
    { clientId: "c1", phone: "090 123 4567" }, // stored local
    { clientId: "c2", phone: "091 999 8888" },
  ];
  // inbound arrives in full E.164 with country code + spacing/+.
  const hit = resolveInboundMatch("+84 90 123 4567", candidates);
  assert.equal(hit?.clientId, "c1");
});

test("resolveInboundMatch returns the FIRST candidate that matches (order preserved)", () => {
  const candidates: InboundMatchCandidate[] = [
    { clientId: "cA", contactId: "kA", phone: "0901234567" },
    { clientId: "cB", contactId: "kB", phone: "0901234567" }, // same line, later
  ];
  const hit = resolveInboundMatch("84901234567", candidates);
  assert.equal(hit?.clientId, "cA");
  assert.equal(hit?.contactId, "kA");
});

test("resolveInboundMatch returns null when nothing matches — the unmatched case", () => {
  const candidates: InboundMatchCandidate[] = [{ clientId: "c1", phone: "0912223333" }];
  assert.equal(resolveInboundMatch("+84 90 000 0000", candidates), null);
  // Too few digits to be confident is a non-match, not a false hit.
  assert.equal(resolveInboundMatch("123", [{ clientId: "c", phone: "123" }]), null);
  // Empty / missing sender never matches.
  assert.equal(resolveInboundMatch("", candidates), null);
  assert.equal(resolveInboundMatch(null, candidates), null);
  assert.equal(resolveInboundMatch("+84900000000", []), null);
});

test("inboundSummary collapses whitespace, trims, and truncates with an ellipsis", () => {
  assert.equal(inboundSummary("  hello   world \n"), "hello world");
  assert.equal(inboundSummary(""), null);
  assert.equal(inboundSummary(null), null);
  assert.equal(inboundSummary("   "), null);

  const long = "a".repeat(120);
  const s = inboundSummary(long)!;
  assert.equal(s.length, 80);
  assert.ok(s.endsWith("…"));

  // Exactly at the limit is kept verbatim (no ellipsis).
  const exact = "b".repeat(80);
  assert.equal(inboundSummary(exact), exact);
});
