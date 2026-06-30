/**
 * Attribution parsing tests — fixtures are VERBATIM entries from the
 * owner's real export (~/Desktop/projets_j360_2026-06-11.json, item 3).
 *
 * Locks in the two contact-mapping rules found the hard way:
 *   1. J360 exports are WINNER-CENTRIC — when `gagnant` is a plain
 *      string, the winner's email/telephone/dirigeant/adresse sit at
 *      the ITEM level. (AFRIK LONNYA SARL bug 2026-06-13: card showed
 *      "No email / No phone" while the JSON carried both.)
 *   2. Participants take their contacts ONLY from their own
 *      participants_data entry — never from the item level.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  participantEntry,
  applyWinnerItemContacts,
} from "../lib/attribution-parse.ts";

/* Item 3 of projets_j360_2026-06-11.json — history trimmed, contact
 * values verbatim. */
const REAL_ITEM = {
  titre:
    "Acquisition et installation de Kits d'éclairage public dans le cadre de la mise en œuvre de la sous-composante résilience du PCE-LON",
  pays: "Burkina Faso",
  date_pub: "2026-05-31",
  acheteur: "World Bank",
  montant: "287555400.0",
  devise: "FCFA",
  gagnant: "AFRIK LONNYA SARL",
  email: "contact@afriklonnya.com",
  telephone: "25 34 24 66 / 70 20 22 82",
  dirigeant: "Julien MALO",
  fonction: "Directly or indirectly holding 25 % or more of the Voting Rights",
  adresse: "17 BP 352 Ouagadougou 17, Burkina Faso",
  participants: ["ANAYI BF", "WESTERN CO", "SOCIETE GLOBAL EQUIPEMENT SARL", "WATAM SA"],
  participants_data: [
    {
      name: "ANAYI BF",
      historique_j360: [
        {
          titre:
            "Acquisition et installation de Kits d'éclairage public dans le cadre de la mise en œuvre de la sous-composante résilience du PCE-LON",
          pays: "Burkina Faso",
          date: "2026-05-31",
          role: "participant",
        },
      ],
      email: "anayisarl@yahoo.fr",
      telephone: "+226 70 88 63 06 / 64 20 06 06",
      site: "",
      adresse: "10 BP 825 Ouaga 10, Burkina Faso",
      linkedin: "",
      dirigeant: "",
      fonction: "",
    },
    {
      name: "WESTERN CO",
      email: "",
      telephone: "+39 0735 751248",
      site: "",
      adresse: "San Benedetto del Tronto (AP), Italy",
      linkedin: "",
      dirigeant: "",
      fonction: "",
    },
  ],
};

test("AFRIK LONNYA SARL: string winner inherits the ITEM-level contacts", () => {
  const winner = applyWinnerItemContacts(
    participantEntry(REAL_ITEM.gagnant),
    REAL_ITEM
  );
  assert.ok(winner);
  assert.equal(winner!.name, "AFRIK LONNYA SARL");
  assert.equal(winner!.email, "contact@afriklonnya.com");
  assert.equal(winner!.phone, "25 34 24 66 / 70 20 22 82");
  assert.equal(winner!.manager, "Julien MALO");
  assert.equal(winner!.address, "17 BP 352 Ouagadougou 17, Burkina Faso");
});

test("participants keep THEIR OWN contacts — never the item-level ones", () => {
  const anayi = participantEntry(REAL_ITEM.participants_data[0]);
  assert.ok(anayi);
  assert.equal(anayi!.email, "anayisarl@yahoo.fr");
  assert.equal(anayi!.phone, "+226 70 88 63 06 / 64 20 06 06");
  assert.equal(anayi!.address, "10 BP 825 Ouaga 10, Burkina Faso");
  assert.equal(anayi!.manager, null); // dirigeant: "" → empty, NOT Julien MALO

  const western = participantEntry(REAL_ITEM.participants_data[1]);
  assert.ok(western);
  assert.equal(western!.email, null); // "" in the file → truly no email
  assert.equal(western!.phone, "+39 0735 751248");
});

test("an explicit winner OBJECT keeps its own contacts over item-level", () => {
  const item = {
    gagnant: { nom: "SOCIETE X", email: "direct@societe-x.com" },
    email: "fallback@item-level.com",
    telephone: "+226 11 11 11 11",
  };
  const winner = applyWinnerItemContacts(participantEntry(item.gagnant), item);
  assert.equal(winner!.email, "direct@societe-x.com"); // own value wins
  assert.equal(winner!.phone, "+226 11 11 11 11"); // hole filled from item
});

test("historique_j360 is captured — participant AND item-level winner", () => {
  // Participant: ANAYI BF's history rides its participants_data entry.
  const anayi = participantEntry(REAL_ITEM.participants_data[0]);
  assert.ok(Array.isArray(anayi!.history));
  assert.equal((anayi!.history as any[]).length, 1);

  // Winner: item 2 of the real file — STE IMIS, string winner, history
  // and address at the ITEM level, no email/phone in the file.
  const item2 = {
    gagnant: "STE IMIS EQUIPEMENT SOUSS SARL",
    email: "",
    telephone: "",
    dirigeant: "",
    adresse: "N° 04 Immeuble Adrar Bd 11 Janvier Cité Dakhla - Agadir (M)",
    historique_j360: [{ titre: "Achat de fourniture électrique", role: "gagnant" }],
  };
  const winner = applyWinnerItemContacts(participantEntry(item2.gagnant), item2);
  assert.equal(winner!.email, null); // truly absent from the file
  assert.equal(winner!.address, "N° 04 Immeuble Adrar Bd 11 Janvier Cité Dakhla - Agadir (M)");
  assert.equal((winner!.history as any[]).length, 1);
});

test("placeholder winner '—' stays null (no ghost company)", () => {
  assert.equal(applyWinnerItemContacts(participantEntry("—"), REAL_ITEM), null);
});

/* ------------------------------------------------------------------ */
/*  v2 export format — owner file export_cameroun.json (2026-06-12):   */
/*  { meta, projets[], entreprises[] }. Winners arrive BY LOT in       */
/*  gagnants[]; contacts live in the separate entreprises[] directory. */
/*  Fixtures below are VERBATIM entries from the real file.            */
/* ------------------------------------------------------------------ */

import { companyDirectory, winnersFromLots } from "../lib/attribution-parse.ts";

const CAMEROUN_ROOT = {
  meta: { source: "J360 Bid Results — Solux", pays: "Cameroun" },
  projets: [],
  entreprises: [
    {
      nom: "ETS GENELEC",
      nb_marches: 1,
      budget_total_local: 27499944,
      budget_total_usd: 45833,
      devise: "XAF",
      contact: {
        dirigeant: "Charles Njakoi",
        fonction: "",
        telephone: "697 26 47 53",
        email: "NjakoiCharles63@gmail.com",
        site: "",
        adresse: "",
        linkedin: "",
      },
      marches: [
        {
          titre: "TRAVAUX DE FOURNITURES ET POSE DE TRENTE DEUX (32) LAMPADAIRES SOLAIRES",
          acheteur: "COMMUNE DE MAKENENE",
          montant_local: 27499944,
        },
      ],
    },
  ],
};

const GENELEC_ITEM = {
  id: 55259537,
  titre: "TRAVAUX DE FOURNITURES ET POSE DE TRENTE DEUX (32) LAMPADAIRES SOLAIRES (…) COMMUNE DE MAKENENE",
  pays: "Cameroun",
  acheteur: "COMMUNE DE MAKENENE",
  date_publication: "2026-06-02",
  statut: "attribue",
  montant_total_local: 27499944,
  montant_total_usd: 45833,
  devise: "XAF",
  nb_lampadaires: 32,
  nb_gagnants: 1,
  gagnants: [
    {
      lot: "Unique",
      entreprise: "ETS GENELEC",
      montant_local: 27499944,
      montant_usd: 45833,
      quantite_lampadaires: 32,
      telephone: "697 26 47 53",
      delai: "TROIS (03) MOIS",
    },
  ],
};

test("v2: winner by lot, enriched from the entreprises[] directory", () => {
  const dir = companyDirectory(CAMEROUN_ROOT);
  const winners = winnersFromLots(GENELEC_ITEM, dir);
  assert.equal(winners.length, 1);
  const w = winners[0];
  assert.equal(w.name, "ETS GENELEC");
  assert.equal(w.amount, 27499944);
  assert.equal(w.phone, "697 26 47 53"); // lot-level
  assert.equal(w.email, "NjakoiCharles63@gmail.com"); // directory contact{}
  assert.equal(w.manager, "Charles Njakoi"); // directory dirigeant
  assert.ok(Array.isArray(w.history)); // directory marches[]
});

test("v2: a company winning SEVERAL lots = ONE entry, amounts summed", () => {
  // Verbatim multi-lot project (ETS TRAIC, commune d'Obala).
  const item = {
    gagnants: [
      {
        lot: "Lot 1",
        entreprise: "ETS DES TRAVAUX INDUSTRIELS DU CAMEROUN (ETS TRAIC)",
        montant_local: 14999658,
        telephone: "694 46 12 04 / 697 47 30 65",
      },
      {
        lot: "Lot 2",
        entreprise: "ETS DES TRAVAUX INDUSTRIELS DU CAMEROUN (ETS TRAIC)",
        montant_local: 9999444,
        telephone: "694 46 12 04 / 697 47 30 65",
      },
    ],
  };
  const winners = winnersFromLots(item, new Map());
  assert.equal(winners.length, 1);
  assert.equal(winners[0].amount, 14999658 + 9999444);
  assert.equal(winners[0].phone, "694 46 12 04 / 697 47 30 65");
});

test("v2: company absent from the directory keeps its lot phone", () => {
  const winners = winnersFromLots(
    { gagnants: [{ lot: "Unique", entreprise: "ETS ABOUSAD", montant_local: 5000000, telephone: "699 11 22 33" }] },
    companyDirectory(CAMEROUN_ROOT)
  );
  assert.equal(winners[0].phone, "699 11 22 33");
  assert.equal(winners[0].email, null);
});

test("v2: cancelled project (gagnants: []) yields no companies", () => {
  const winners = winnersFromLots(
    { titre: "Travaux … Commune de Madingring", statut: "annule", gagnants: [], nb_gagnants: 0 },
    new Map()
  );
  assert.deepEqual(winners, []);
});

test("v2 helpers ignore v1 items (no gagnants array)", () => {
  assert.deepEqual(winnersFromLots(REAL_ITEM, new Map()), []);
  assert.equal(companyDirectory([1, 2, 3]).size, 0); // plain-array v1 root
});

/* ------------------------------------------------------------------ */
/*  .in() URL budget — 111 title-based keys ≈ 30 KB in ONE URL killed   */
/*  the existence lookup silently (re-import said "111 new", then 111   */
/*  duplicate-key errors, zero updates).                                */
/* ------------------------------------------------------------------ */

import { chunkByUrlBudget } from "../lib/attribution-parse.ts";

test("chunkByUrlBudget keeps every key, in order, under the budget", () => {
  // Realistic keys: ~270 encoded chars each (the real file's average).
  const keys = Array.from({ length: 111 }, (_, i) =>
    `travaux de fournitures et pose de lampadaires solaires ${i} — commune n°${i}|commune ${i}|2026-06-0${(i % 9) + 1}`
  );
  const chunks = chunkByUrlBudget(keys, 6000, 30);
  assert.deepEqual(chunks.flat(), keys); // nothing lost, order kept
  assert.ok(chunks.length > 1); // actually split
  for (const c of chunks) {
    const size = c.reduce((n, k) => n + encodeURIComponent(k).length + 3, 0);
    assert.ok(size <= 6000, `chunk too big: ${size}`);
    assert.ok(c.length <= 30);
  }
});

test("chunkByUrlBudget: empty input → no chunks; one huge key still passes", () => {
  assert.deepEqual(chunkByUrlBudget([]), []);
  const huge = "x".repeat(9000);
  assert.deepEqual(chunkByUrlBudget([huge], 6000, 30), [[huge]]); // never dropped
});
