/**
 * Tests for the client-code generator (lib/client-code.ts).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no server imports). Covers the owner's spec examples, the
 * DB constraint (^[A-Z]{3}$, no digits), collision walk, exhaustive
 * guarantee, and accent folding.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_CODE_RE,
  isValidClientCode,
  normalizeClientCode,
  deriveClientCodeBase,
  clientCodeCandidates,
  suggestClientCode,
} from "../lib/client-code.ts";

test("spec examples — base derived from the first three letters", () => {
  assert.equal(deriveClientCodeBase("Solux Africa"), "SOL");
  assert.equal(deriveClientCodeBase("Benin Energy"), "BEN");
  assert.equal(deriveClientCodeBase("Lighting Group"), "LIG");
});

test("first suggestion equals the base when nothing is taken", () => {
  assert.equal(suggestClientCode("Solux Africa", []), "SOL");
  assert.equal(suggestClientCode("Benin Energy", new Set<string>()), "BEN");
});

test("collision — SOL taken proposes another VALID 3-letter code, still name-anchored", () => {
  const code = suggestClientCode("Solux Africa", ["SOL"]);
  assert.notEqual(code, "SOL");
  assert.match(code, CLIENT_CODE_RE); // 3 letters, no digits (DB CHECK)
  assert.ok(code.startsWith("S"), `expected a Solux-anchored code, got ${code}`);
});

test("deep collision — many taken codes still yields a free, valid, unique code", () => {
  // Take SOL + every SO? and the per-word initials so the walk must go deeper.
  const taken = new Set<string>(["SOL", "SOA"]);
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") taken.add("SO" + ch);
  const code = suggestClientCode("Solux Africa", taken);
  assert.match(code, CLIENT_CODE_RE);
  assert.ok(!taken.has(code), `${code} should be free`);
});

test("exhaustive guarantee — never returns a taken code even under huge pressure", () => {
  // Take the entire AAA..AZZ..YZZ space except a single known-free code.
  const taken = new Set<string>();
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const a of A) for (const b of A) for (const c of A) taken.add(a + b + c);
  taken.delete("ZZQ");
  const code = suggestClientCode("Whatever Corp", taken);
  assert.equal(code, "ZZQ");
});

test("candidate stream is unique, valid, and starts with the base", () => {
  const it = clientCodeCandidates("Solux Africa");
  const first = it.next().value as string;
  assert.equal(first, "SOL");
  const seen = new Set<string>([first]);
  let n = 1;
  for (const c of it) {
    assert.match(c, CLIENT_CODE_RE);
    assert.ok(!seen.has(c), `duplicate candidate ${c}`);
    seen.add(c);
    if (++n >= 500) break; // lazy: we never need the full 17k tail
  }
  assert.ok(n >= 100);
});

test("accents fold to ASCII, digits/symbols are ignored", () => {
  assert.equal(deriveClientCodeBase("Éléctrique Bénin"), "ELE");
  assert.equal(deriveClientCodeBase("3M Company"), "MCO");
  assert.equal(deriveClientCodeBase("A&B Corp"), "ABC");
  assert.equal(normalizeClientCode("s.o.l "), "SOL");
  assert.equal(normalizeClientCode("sölu"), "SOL");
});

test("short / letter-poor names still produce a valid 3-letter code", () => {
  assert.match(suggestClientCode("GE", []), CLIENT_CODE_RE);
  assert.match(suggestClientCode("Xi", []), CLIENT_CODE_RE);
  // No letters at all → falls back to the exhaustive stream, still valid.
  assert.match(suggestClientCode("123", []), CLIENT_CODE_RE);
});

test("isValidClientCode enforces the DB CHECK exactly", () => {
  assert.ok(isValidClientCode("SOL"));
  assert.ok(!isValidClientCode("SO1")); // digits rejected by ^[A-Z]{3}$
  assert.ok(!isValidClientCode("so l"));
  assert.ok(!isValidClientCode("SOLU"));
  assert.ok(!isValidClientCode(""));
  assert.ok(!isValidClientCode(null));
});

test("two reps, same name — the ordering makes the loser deterministically take the next code", () => {
  // Simulates the app's insert-retry: rep A wins SOL, rep B must advance.
  const winner = suggestClientCode("Solux Africa", []);
  const loser = suggestClientCode("Solux Africa", [winner]);
  assert.equal(winner, "SOL");
  assert.notEqual(loser, winner);
  assert.match(loser, CLIENT_CODE_RE);
});
