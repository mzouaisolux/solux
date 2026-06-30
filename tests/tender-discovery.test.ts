/**
 * Tender discovery signal tests (m117 UI v2 — lib/tender-discovery).
 *
 * Run with:  npm test   (Node ≥ 22.6, built-in runner + native TS stripping)
 *
 * Locks in: USD conversion (with country fallback and the honest-null
 * rule), funder extraction (FR/EN), and the priority-score weights.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  usdEquivalent,
  fmtUsd,
  funderOf,
  projectPriorityScore,
  opportunityTier,
} from "../lib/tender-discovery.ts";

/* ------------------------------------------------------------------ */
/* usdEquivalent                                                        */
/* ------------------------------------------------------------------ */

test("usd: FCFA / XOF / MAD convert at indicative rates", () => {
  assert.equal(usdEquivalent({ amount: 600_000, currency: "FCFA" }), 1_000);
  assert.equal(usdEquivalent({ amount: 600_000, currency: "XOF" }), 1_000);
  assert.equal(usdEquivalent({ amount: 100, currency: "MAD" }), 10);
  assert.equal(usdEquivalent({ amount: 92, currency: "EUR" }), 100);
  assert.equal(usdEquivalent({ amount: 500, currency: "USD" }), 500);
});

test("usd: missing currency falls back to the COUNTRY currency", () => {
  const v = usdEquivalent({ amount: 600_000, currency: null, country: "Burkina Faso" });
  assert.equal(v, 1_000);
  const mar = usdEquivalent({ amount: 100, currency: null, country: "Maroc" });
  assert.equal(mar, 10);
});

test("usd: never guesses — unknown currency AND country → null", () => {
  assert.equal(usdEquivalent({ amount: 287_555_400, currency: null, country: "Atlantis" }), null);
  assert.equal(usdEquivalent({ amount: null, currency: "USD" }), null);
});

test("usd: compact formatting", () => {
  assert.equal(fmtUsd(1_234_000), "$1.2M");
  assert.equal(fmtUsd(495_000), "$495K");
  assert.equal(fmtUsd(820), "$820");
  assert.equal(fmtUsd(null), "—");
});

/* ------------------------------------------------------------------ */
/* funderOf                                                             */
/* ------------------------------------------------------------------ */

test("funder: international donors detected in French and English", () => {
  assert.equal(funderOf("Banque Mondiale — projet PASEL"), "world_bank");
  assert.equal(funderOf("World Bank / IDA"), "world_bank");
  assert.equal(funderOf("Banque Africaine de Développement"), "afdb");
  assert.equal(funderOf("Agence Française de Développement"), "afd");
  assert.equal(funderOf("PNUD Burkina"), "undp");
  assert.equal(funderOf("Union Européenne"), "eu");
});

test("funder: public buyers split government vs municipality", () => {
  assert.equal(funderOf("Commune urbaine de TAROUDANT"), "municipality");
  assert.equal(funderOf("Ministère de l'Énergie"), "government");
  assert.equal(funderOf("Agence Nationale d'Électrification"), "government");
  assert.equal(funderOf("Société XYZ"), "unknown");
  assert.equal(funderOf(null), "unknown");
});

/* ------------------------------------------------------------------ */
/* projectPriorityScore                                                 */
/* ------------------------------------------------------------------ */

test("priority: big World Bank project with full intel ≈ top score", () => {
  const s = projectPriorityScore({
    usd: 1_200_000,
    funder: "world_bank",
    hasWinner: true,
    participantsCount: 5,
    contactsCount: 5,
    relevanceScore: 80,
  });
  // 35 + 25 + 10 + 10 + 15 + 5 = 100 (capped)
  assert.equal(s, 100);
});

test("priority: small municipal project with no intel stays low", () => {
  const s = projectPriorityScore({
    usd: 5_000,
    funder: "municipality",
    hasWinner: false,
    participantsCount: 0,
    contactsCount: 0,
  });
  // 5 + 8 = 13
  assert.equal(s, 13);
});

test("priority: contacts and winner materially move the score", () => {
  const base = {
    usd: 150_000,
    funder: "government" as const,
    hasWinner: false,
    participantsCount: 0,
    contactsCount: 0,
  };
  const bare = projectPriorityScore(base); // 25 + 12 = 37
  assert.equal(bare, 37);
  const withIntel = projectPriorityScore({
    ...base,
    hasWinner: true,
    participantsCount: 4,
    contactsCount: 3,
  }); // +10 +10 +15 = 72
  assert.equal(withIntel, 72);
});

test("opportunity tier: thresholds", () => {
  assert.equal(opportunityTier(100).tier, "high");
  assert.equal(opportunityTier(65).tier, "high");
  assert.equal(opportunityTier(50).tier, "medium");
  assert.equal(opportunityTier(20).tier, "low");
});

/* ------------------------------------------------------------------ */
/*  tenderUsd — owner bug 2026-06-13 (MAGNA, WABANE): the import had    */
/*  stored the file's USD (260,866) in budget_usd; the UI re-converted  */
/*  it as XAF and showed $435. Verbatim fixture from export_cameroun.   */
/* ------------------------------------------------------------------ */

import { tenderUsd } from "../lib/tender-discovery.ts";

test("MAGNA: source-exact USD wins — never re-converted", () => {
  const row = {
    budget_usd: 156519346, // LOCAL amount (montant_total_local)
    currency: "XAF",
    country: "Cameroun",
    specs: { montant_usd: 260866, nb_lampadaires: 99, statut: "attribue" },
  };
  const r = tenderUsd(row);
  assert.equal(r.usd, 260866); // NOT 435, NOT 156M
  assert.equal(r.exact, true); // no "estimated" label
});

test("v1 rows (no specs.montant_usd) keep the estimated conversion", () => {
  const r = tenderUsd({
    budget_usd: 287555400, // PCE-LON, FCFA
    currency: "FCFA",
    country: "Burkina Faso",
    specs: {},
  });
  assert.equal(r.exact, false);
  assert.ok(Math.abs((r.usd as number) - 287555400 / 600) < 1); // ≈ $479K
});

test("tenderUsd: no amounts at all → null, estimated", () => {
  const r = tenderUsd({ budget_usd: null, currency: "XAF", specs: {} });
  assert.equal(r.usd, null);
  assert.equal(r.exact, false);
});
