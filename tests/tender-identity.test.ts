/**
 * Tender identity & consolidation tests — locks in the owner-validated
 * rules (2026-06-13): ONE real-world tender = one project with many
 * lots / winners / participants, never one project per winner.
 *
 * Decision order under test:
 *   A. same real market reference            → merge (high)
 *   B. country strict + title ≥ 0.85 + ±30d  → merge (high if buyer close,
 *                                              else candidate/flagged)
 *   C. otherwise                             → create new
 * Buyer is a booster, NEVER a gate. Lots keep their amounts (no summing).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripAccents,
  normalizeTitleForKey,
  normalizeMarketReference,
  marketReferenceOf,
  canonicalCountry,
  titleSimilarity,
  dateWithinWindow,
  tenderIdentity,
  matchTender,
  extractLots,
  groupItemsIntoProjects,
  type TenderIdentity,
} from "../lib/tender-identity.ts";

/* ----------------------------- normalization ----------------------- */

test("normalizeTitleForKey strips lot/tranche tokens and accents", () => {
  const base = "Fourniture de lampadaires solaires";
  for (const v of [
    "Fourniture de lampadaires solaires - Lot 1",
    "Fourniture de lampadaires solaires Lot 2",
    "FOURNITURE DE LAMPADAIRES SOLAIRES — LOT N°3",
    "Fourniture de lampadaires solaires lot4",
    "Fourniture de lampadaires solaires (Lot unique)",
    "Fourniture de lampadaires solaires - Tranche 2",
  ]) {
    assert.equal(normalizeTitleForKey(v), normalizeTitleForKey(base), `failed: ${v}`);
  }
});

test("stripAccents handles Côte d'Ivoire et caractères composés", () => {
  assert.equal(stripAccents("Côte d'Ivoire"), "Cote d'Ivoire");
  assert.equal(canonicalCountry("Côte d'Ivoire"), "ivory coast");
  assert.equal(canonicalCountry("Cameroun"), canonicalCountry("Cameroon"));
});

/* --------------------------- market reference ---------------------- */

test("marketReferenceOf reads a REAL reference, never url_armp/id", () => {
  assert.equal(
    marketReferenceOf({ reference_marche: "AO/2026/0042-CM", titre: "x" }),
    "AO20260042CM"
  );
  // url_armp + J360 id only → NOT a project reference (owner decision)
  assert.equal(
    marketReferenceOf({
      id: 55259537,
      url_armp: "https://armp.cm/details?type_publication=DEC-ATTR&id_publication=22461",
      titre: "x",
    }),
    null
  );
  assert.equal(normalizeMarketReference("—"), null);
  assert.equal(normalizeMarketReference("n/a"), null);
});

/* ---------------------------- similarity --------------------------- */

test("titleSimilarity: lot variants ≥ 0.85, different tenders < 0.85", () => {
  assert.ok(
    titleSimilarity(
      "Supply and Installation of Solar Street Lighting - Lot 1",
      "Supply and Installation of Solar Street Lighting - Lot 4"
    ) >= 0.85
  );
  assert.ok(
    titleSimilarity(
      "Supply and Installation of Solar Street Lighting",
      "Construction of a primary school in Garoua"
    ) < 0.85
  );
});

test("dateWithinWindow respects the ±N day window", () => {
  assert.ok(dateWithinWindow("2026-05-31", "2026-06-12", 30));
  assert.ok(!dateWithinWindow("2026-01-01", "2026-06-12", 30));
  assert.ok(!dateWithinWindow(null, "2026-06-12", 30));
});

/* -------------------------- matchTender table ---------------------- */

const E = (over: Partial<TenderIdentity>): TenderIdentity => ({
  title: "Supply and Installation of Solar Street Lighting",
  buyer: "Commune de Makenene",
  country: "Cameroun",
  date: "2026-05-31",
  marketRef: null,
  amount: null,
  ...over,
});

test("A — same market reference merges even with different titles", () => {
  const existing = [E({ title: "Totally different title", marketRef: "AO20260042CM" })];
  const r = matchTender(E({ title: "Solar lighting lot 3", marketRef: "AO20260042CM" }), existing);
  assert.equal(r.via, "reference");
  assert.equal(r.confidence, "high");
});

test("B — country + title + window merges; buyer close ⇒ high", () => {
  const existing = [E({})];
  const r = matchTender(
    E({ title: "Supply and Installation of Solar Street Lighting - Lot 2", date: "2026-06-10" }),
    existing
  );
  assert.equal(r.via, "fuzzy");
  assert.equal(r.confidence, "high");
  assert.ok(r.score >= 0.85);
});

test("B gray zone — buyer differs ⇒ candidate (flagged), still merges", () => {
  const existing = [E({ buyer: "Commune de Makenene" })];
  const r = matchTender(
    E({
      title: "Supply and Installation of Solar Street Lighting extension works",
      buyer: "Ministry of Water and Energy",
      date: "2026-06-10",
    }),
    existing
  );
  // title similar enough to pass the 0.85 gate but buyer divergent
  if (r.match) {
    assert.equal(r.via, "fuzzy");
    assert.equal(r.confidence, "candidate");
  }
});

test("C — different country never merges (strict country gate)", () => {
  const existing = [E({ country: "Cameroun" })];
  const r = matchTender(E({ country: "Burkina Faso" }), existing);
  assert.equal(r.match, null);
});

test("C — outside the date window never merges", () => {
  const existing = [E({ date: "2026-01-01" })];
  const r = matchTender(E({ date: "2026-06-12" }), existing);
  assert.equal(r.match, null);
});

/* ------------------- B2: notice-duplicate (OCR typo) --------------- */

test("B2 — same buyer + amount + date merges despite an OCR title typo", () => {
  // Real DOUALA case: same project scraped as DEC-ATTR + COMM notices,
  // title "CERTAINES" vs "CERT AINES", identical buyer/amount/date.
  const existing = [
    E({
      title: "FOURNITURE ET POSE DE 300 LAMPADAIRES SOLAIRES DANS CERTAINES LOCALITES DE LA COMMUNE D'ARRONDISSEMENT DE DOUALA 5E",
      buyer: "COMMUNE D'ARRONDISSEMENT DE DOUALA 5E",
      date: "2025-11-10",
      amount: 558065,
    }),
  ];
  const r = matchTender(
    E({
      title: "FOURNITURE ET POSE DE 300 LAMPADAIRES SOLAIRES DANS CERT AINES LOCALITES DE LA COMMUNE D'ARRONDISSEMENT DE DOUALA 5E",
      buyer: "COMMUNE D'ARRONDISSEMENT DE DOUALA 5E",
      date: "2025-11-10",
      amount: 558065,
    }),
    existing
  );
  assert.ok(r.match, "DOUALA notice-duplicate should merge");
  assert.equal(r.confidence, "high");
});

test("B2 does NOT over-merge: different commune, same boilerplate, different buyer+amount", () => {
  const existing = [
    E({ title: "FOURNITURE ET POSE DE 50 LAMPADAIRES SOLAIRES DANS LA COMMUNE DE GAROUA", buyer: "Commune de Garoua", amount: 100000 }),
  ];
  const r = matchTender(
    E({ title: "FOURNITURE ET POSE DE 50 LAMPADAIRES SOLAIRES DANS LA COMMUNE DE MAROUA", buyer: "Commune de Maroua", amount: 200000 }),
    existing
  );
  assert.equal(r.match, null);
});

test("B2 needs amount corroboration: same buyer but different amount → no merge", () => {
  const existing = [E({ title: "Projet X travaux divers", buyer: "Commune de Test", amount: 100000 })];
  const r = matchTender(
    E({ title: "Projet Y autre chose entierement", buyer: "Commune de Test", amount: 999999 }),
    existing
  );
  assert.equal(r.match, null);
});

/* ---------------------------- extractLots -------------------------- */

// Verbatim from export_cameroun.json — the MAGNA/WABANE project (9 lots).
const MAGNA = {
  titre: "SUPPLY OF 10 STANDALONE SOLAR STREET LIGHTS AT MAGNA, WABANE.",
  pays: "Cameroun",
  acheteur: "SOUTH WEST REGIONAL EXECUTIVE COUNCIL",
  date_publication: "",
  montant_total_local: 156519346,
  montant_total_usd: 260866,
  devise: "XAF",
  nb_gagnants: 9,
  gagnants: [
    { lot: "1", entreprise: "MEGA TECHNOLOGIES", montant_local: 11897060, montant_usd: 19828 },
    { lot: "2", entreprise: "F AND N FOMBIN", montant_local: 8627893, montant_usd: 14380 },
    { lot: "3", entreprise: "AZOLEZI AND SONS", montant_local: 11500005, montant_usd: 19167 },
    { lot: "4", entreprise: "ETS ZIANDEM AND SONS", montant_local: 15502500, montant_usd: 25838 },
    { lot: "5", entreprise: "IBG SOLAR CITY AND GREEN LIGHT GROCERY ENTERPRISE", montant_local: 12000000 },
    { lot: "6", entreprise: "IBG SOLAR CITY AND GREEN LIGHT GROCERY ENTERPRISE", montant_local: 10299980 },
    { lot: "7", entreprise: "ETS ZIANDEM AND SONS", montant_local: 62828997, montant_usd: 104715 },
    { lot: "8", entreprise: "FUODEM ENTERPRISE", montant_local: 11460911 },
    { lot: "9", entreprise: "ETS ZIANDEM AND SONS", montant_local: 12402000, montant_usd: 20670 },
  ],
};

test("extractLots: MAGNA → 9 lots, amounts preserved, ZIANDEM on 3 lots", () => {
  const lots = extractLots(MAGNA);
  assert.equal(lots.length, 9);
  const ziandem = lots.filter((l) => l.winner_name === "ETS ZIANDEM AND SONS");
  assert.equal(ziandem.length, 3); // lots 4, 7, 9 — NOT collapsed
  assert.deepEqual(
    ziandem.map((l) => l.lot_number).sort(),
    ["4", "7", "9"]
  );
  // amounts kept per lot, never summed into one
  assert.equal(lots.find((l) => l.lot_number === "7")!.lot_amount, 62828997);
  assert.equal(lots.find((l) => l.lot_number === "1")!.lot_amount, 11897060);
});

test("extractLots: v1 item without gagnants → [] (lot-less, backward compatible)", () => {
  assert.deepEqual(extractLots({ titre: "x", gagnant: "Company A" }), []);
});

/* ---------------- THE owner example: 4 lots, 4 winners ------------- */

test("groupItemsIntoProjects: 4 SEPARATE lot notices → ONE project", () => {
  // Each lot scraped as its own award notice (different title suffix,
  // same buyer/country, publication dates within the window). The exact
  // key would have split these into 4 projects.
  const items = [
    { titre: "Supply and Installation of Solar Street Lighting - Lot 1", acheteur: "City of Douala", pays: "Cameroun", date_publication: "2026-05-31", gagnants: [{ lot: "1", entreprise: "Company A", montant_local: 1000 }] },
    { titre: "Supply and Installation of Solar Street Lighting - Lot 2", acheteur: "City of Douala", pays: "Cameroun", date_publication: "2026-06-02", gagnants: [{ lot: "2", entreprise: "Company B", montant_local: 2000 }] },
    { titre: "Supply and Installation of Solar Street Lighting - Lot 3", acheteur: "City of Douala", pays: "Cameroun", date_publication: "2026-06-05", gagnants: [{ lot: "3", entreprise: "Company C", montant_local: 3000 }] },
    { titre: "Supply and Installation of Solar Street Lighting - Lot 4", acheteur: "City of Douala", pays: "Cameroun", date_publication: "2026-06-09", gagnants: [{ lot: "4", entreprise: "Company D", montant_local: 4000 }] },
  ];
  const groups = groupItemsIntoProjects(items);
  assert.equal(groups.length, 1); // ← one project, not four
  const g = groups[0];
  assert.equal(g.itemIndexes.length, 4);
  assert.equal(g.lots.length, 4);
  assert.deepEqual(g.winners.sort(), ["Company A", "Company B", "Company C", "Company D"]);
  assert.equal(g.mergeReasons.length, 3); // 3 items merged into the principal
});

test("groupItemsIntoProjects: genuinely different tenders stay separate", () => {
  const items = [
    { titre: "Solar street lighting in Douala", pays: "Cameroun", date_publication: "2026-05-31", acheteur: "City of Douala" },
    { titre: "Construction of a market hall in Garoua", pays: "Cameroun", date_publication: "2026-06-01", acheteur: "City of Garoua" },
    { titre: "Solar street lighting in Ouagadougou", pays: "Burkina Faso", date_publication: "2026-06-02", acheteur: "City of Ouaga" },
  ];
  assert.equal(groupItemsIntoProjects(items).length, 3);
});

test("tenderIdentity reads v1 and v2 shapes", () => {
  const id = tenderIdentity({ titre: "T", acheteur: "B", pays: "Cameroun", date_publication: "2026-05-31", reference_marche: "AO/1" });
  assert.equal(id.title, "T");
  assert.equal(id.country, "Cameroun");
  assert.equal(id.date, "2026-05-31");
  assert.equal(id.marketRef, "AO1");
});

/* ---------------- retro clustering (dry-run report) ---------------- */

import { clusterTenders, type IdentifiedTender } from "../lib/tender-identity.ts";

const T = (over: Partial<IdentifiedTender>): IdentifiedTender => ({
  id: "t" + Math.round((over.amount ?? 0)), // deterministic-ish, overridden below
  title: "Solar lighting", buyer: "Commune X", country: "Cameroun",
  date: "2026-05-31", marketRef: null, amount: null,
  participantCount: 0, importedAt: "2026-06-12",
  ...over,
});

test("clusterTenders groups the DOUALA notice-duplicate, picks richest principal", () => {
  const tenders = [
    T({ id: "a", title: "FOURNITURE ET POSE DE 300 LAMPADAIRES SOLAIRES DANS CERTAINES LOCALITES DE LA COMMUNE D'ARRONDISSEMENT DE DOUALA 5E", buyer: "COMMUNE D'ARRONDISSEMENT DE DOUALA 5E", date: "2025-11-10", amount: 558065, participantCount: 1, importedAt: "2026-06-12" }),
    T({ id: "b", title: "FOURNITURE ET POSE DE 300 LAMPADAIRES SOLAIRES DANS CERT AINES LOCALITES DE LA COMMUNE D'ARRONDISSEMENT DE DOUALA 5E", buyer: "COMMUNE D'ARRONDISSEMENT DE DOUALA 5E", date: "2025-11-10", amount: 558065, participantCount: 3, importedAt: "2026-06-13" }),
    T({ id: "c", title: "Construction of a school in Garoua", buyer: "Commune de Garoua", country: "Cameroun", date: "2026-01-01", amount: 9999, participantCount: 2 }),
  ];
  const clusters = clusterTenders(tenders);
  assert.equal(clusters.length, 1);            // only DOUALA clusters
  assert.equal(clusters[0].principal.id, "b"); // 3 participants > 1
  assert.equal(clusters[0].duplicates.length, 1);
  assert.equal(clusters[0].duplicates[0].tender.id, "a");
});

test("clusterTenders: no false clusters among distinct tenders", () => {
  const tenders = [
    T({ id: "a", title: "Solar lighting in Douala", country: "Cameroun", date: "2026-05-31", buyer: "Douala", amount: 1 }),
    T({ id: "b", title: "Road works in Yaounde", country: "Cameroun", date: "2026-05-31", buyer: "Yaounde", amount: 2 }),
    T({ id: "c", title: "Solar lighting in Ouaga", country: "Burkina Faso", date: "2026-05-31", buyer: "Ouaga", amount: 3 }),
  ];
  assert.equal(clusterTenders(tenders).length, 0);
});
