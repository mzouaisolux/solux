/**
 * Prospect intelligence tests (m116 — Prospects & Tenders V2).
 *
 * Run with:  npm test   (Node ≥ 22.6, built-in runner + native TS stripping)
 *
 * Locks in: the deduplication key (one company = one record across
 * years and spellings), the Tender Activity Score formula and the
 * OFFICIAL status rule — a LEAD only exists after a reciprocal
 * interaction; an email sent is NOT a lead; an assignment is NOT a lead.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCompanyKey,
  tenderActivityScore,
  prospectStatusAfterActivity,
} from "../lib/prospect-intel.ts";

/* ------------------------------------------------------------------ */
/* normalizeCompanyKey                                                  */
/* ------------------------------------------------------------------ */

test("dedup key: casing, spacing, punctuation and accents collapse", () => {
  const expected = "afrik lonnya";
  assert.equal(normalizeCompanyKey("AFRIK LONNYA"), expected);
  assert.equal(normalizeCompanyKey("  Afrik   Lonnya  "), expected);
  assert.equal(normalizeCompanyKey("AFRIK-LONNYA."), expected);
  assert.equal(normalizeCompanyKey("Afrik Lonnyà"), expected);
  assert.equal(normalizeCompanyKey(""), "");
  assert.equal(normalizeCompanyKey(null), "");
});

test("dedup key: different companies stay different", () => {
  assert.notEqual(normalizeCompanyKey("WATAM"), normalizeCompanyKey("WATAM SA 2"));
  assert.notEqual(normalizeCompanyKey("ANAYI BF"), normalizeCompanyKey("ANAYI"));
});

/* ------------------------------------------------------------------ */
/* tenderActivityScore                                                  */
/* ------------------------------------------------------------------ */

test("score: participation +1, win +3", () => {
  assert.equal(tenderActivityScore({ participations: 0, wins: 0 }), 0);
  assert.equal(tenderActivityScore({ participations: 4, wins: 0 }), 4);
  // 4 participations + 2 wins = 4 + 6
  assert.equal(tenderActivityScore({ participations: 4, wins: 2 }), 10);
});

test("score: recency bonus (+2 ≤12 months, +1 ≤24 months, none after)", () => {
  const today = "2026-06-13";
  const base = { participations: 1, wins: 0 };
  assert.equal(
    tenderActivityScore({ ...base, lastParticipationAt: "2026-01-10", today }),
    1 + 2
  );
  assert.equal(
    tenderActivityScore({ ...base, lastParticipationAt: "2025-01-10", today }),
    1 + 1
  );
  assert.equal(
    tenderActivityScore({ ...base, lastParticipationAt: "2023-01-10", today }),
    1
  );
});

/* ------------------------------------------------------------------ */
/* Status machine — the OFFICIAL rule                                   */
/* ------------------------------------------------------------------ */

test("status: an outbound email is NOT a lead — it makes Contacted", () => {
  assert.equal(prospectStatusAfterActivity("new", "email", false), "contacted");
  assert.equal(prospectStatusAfterActivity("assigned", "call", false), "contacted");
  // already contacted → another outbound changes nothing
  assert.equal(prospectStatusAfterActivity("contacted", "whatsapp", false), null);
});

test("status: a REPLY makes a Lead", () => {
  assert.equal(prospectStatusAfterActivity("new", "email", true), "lead");
  assert.equal(prospectStatusAfterActivity("assigned", "linkedin", true), "lead");
  assert.equal(prospectStatusAfterActivity("contacted", "call", true), "lead");
});

test("status: never backwards, never past opportunity automatically", () => {
  assert.equal(prospectStatusAfterActivity("lead", "email", false), null);
  assert.equal(prospectStatusAfterActivity("lead", "email", true), null);
  assert.equal(prospectStatusAfterActivity("opportunity", "meeting", true), null);
  assert.equal(prospectStatusAfterActivity("customer", "email", true), null);
  assert.equal(prospectStatusAfterActivity("rejected", "email", true), null);
  assert.equal(prospectStatusAfterActivity("blacklisted", "call", false), null);
});

test("status: a plain note never advances anything", () => {
  assert.equal(prospectStatusAfterActivity("new", "note", false), null);
  assert.equal(prospectStatusAfterActivity("assigned", "note", false), null);
});

/* ------------------------------------------------------------------ */
/*  Contact intel merge — owner bug report 2026-06-13 (ANAYI BF):      */
/*  the participant card showed email/phone/address while the company  */
/*  profile drawer was empty. The profile must fill from participant   */
/*  intel, and the Lead Manager's manual values must never be erased.  */
/* ------------------------------------------------------------------ */

import { fillEmptyContactsFromParticipant } from "../lib/prospect-intel.ts";

test("ANAYI BF: empty profile fills from the participant card", () => {
  const prospect = {
    id: "p1",
    company_name: "ANAYI BF",
    email: null,
    phone: null,
    address: null,
    leader_name: null,
  };
  const participant = {
    email: "anayisarl@yahoo.fr",
    phone: "+226 70 88 63 06 / 64 20 06 06",
    address: "10 BP 825 Ouaga 10",
    manager_name: null,
  };
  const merged = fillEmptyContactsFromParticipant(prospect, participant);
  assert.equal(merged.email, "anayisarl@yahoo.fr");
  assert.equal(merged.phone, "+226 70 88 63 06 / 64 20 06 06");
  assert.equal(merged.address, "10 BP 825 Ouaga 10");
  assert.equal(merged.leader_name, null);
  // Identity untouched.
  assert.equal(merged.id, "p1");
  assert.equal(merged.company_name, "ANAYI BF");
});

test("manual profile values are NEVER overwritten by participant intel", () => {
  const prospect = {
    id: "p1",
    email: "direction@anayi.bf", // typed by the Lead Manager
    phone: null,
    address: null,
    leader_name: "Mme Ouédraogo",
  };
  const participant = {
    email: "anayisarl@yahoo.fr",
    phone: "+226 70 88 63 06",
    address: "10 BP 825 Ouaga 10",
    manager_name: "Quelqu'un d'autre",
  };
  const merged = fillEmptyContactsFromParticipant(prospect, participant);
  assert.equal(merged.email, "direction@anayi.bf"); // kept
  assert.equal(merged.leader_name, "Mme Ouédraogo"); // kept
  assert.equal(merged.phone, "+226 70 88 63 06"); // hole filled
  assert.equal(merged.address, "10 BP 825 Ouaga 10"); // hole filled
});

test("participant manager_name maps to prospect leader_name", () => {
  const merged = fillEmptyContactsFromParticipant(
    { id: "p2", email: null, phone: null, address: null, leader_name: null },
    { manager_name: "SAWADOGO Issaka" }
  );
  assert.equal(merged.leader_name, "SAWADOGO Issaka");
  assert.equal(merged.email, null);
});

test("repeated fills accumulate across several participations", () => {
  let p: Record<string, any> = { id: "p3", email: null, phone: null, address: null, leader_name: null };
  p = fillEmptyContactsFromParticipant(p, { email: "a@b.bf" }); // tender 2023
  p = fillEmptyContactsFromParticipant(p, { email: "x@y.bf", phone: "+226 1" }); // tender 2024
  assert.equal(p.email, "a@b.bf"); // first non-empty wins, never replaced
  assert.equal(p.phone, "+226 1");
});
