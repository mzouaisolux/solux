// =====================================================================
// Tender IDENTITY & consolidation — Phase "tender extraction" (owner
// ruling 2026-06-13): a real-world tender is ONE project with many
// lots, many winners, many participants — NOT one project per winner.
//
// The import was already project-level (1 source item = 1 tender), but
// the dedup key was EXACT `title|buyer|date`, so a procurement split
// across several award notices (per-lot, different dates, lot suffix in
// the title) created duplicate projects, and lots were flattened to
// participants with their amounts SUMMED — losing which lot each
// company won.
//
// This PURE, node-testable lib is the single brain for:
//   • normalization (lot-stripped title, buyer, market reference, country)
//   • similarity scoring (token-set Jaccard)
//   • matchTender — the owner-locked decision order:
//       A. same real market reference        → merge (high)
//       B. country strict + title ≥ 0.85 + ±30d window → merge
//          (high if buyer also close, else candidate/flagged)
//       C. otherwise                          → create new
//   • extractLots — 1 entry per lot, amounts PRESERVED (no summing)
//   • groupItemsIntoProjects — in-memory clustering reused by both the
//     import (find-or-merge) and the retro dry-run report.
//
// No DB, no supabase import — calibrated against verbatim J360 fixtures
// before anything is written (tests/tender-identity.test.ts).
// =====================================================================

import { pick, parseAmount } from "./attribution-parse.ts";

/* ------------------------------------------------------------------ */
/* 1. Normalization                                                    */
/* ------------------------------------------------------------------ */

/** Drop diacritics: "Côte d'Ivoire" → "Cote d'Ivoire". */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Canonical title for fuzzy matching: lowercased, de-accented, with LOT
 * / TRANCHE / ALLOTISSEMENT tokens and stray notice numbers removed so
 * that "…Lot 1" and "…Lot 2" of the same procurement collapse to the
 * same key. Punctuation → space, whitespace compacted.
 */
export function normalizeTitleForKey(title: string | null | undefined): string {
  let s = stripAccents(String(title ?? "")).toLowerCase();
  // lot / tranche / allotissement followed by an optional n° and a number
  s = s.replace(/\b(lot|allotissement|tranche)\s*(n\s*[°ºo]?\s*)?\d+/g, " ");
  s = s.replace(/\blot\s+unique\b/g, " ");
  // standalone decision/notice numbers ("n° 006/CM/...") — noise, not identity
  s = s.replace(/\bn\s*[°ºo]\s*[\w/.-]+/g, " ");
  s = s.replace(/[^a-z0-9]+/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Buyer normalized for comparison (booster only — never a hard gate). */
export function normalizeBuyer(buyer: string | null | undefined): string {
  return stripAccents(String(buyer ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Placeholder values the intelligence tools emit for "no value". */
const REF_PLACEHOLDERS = new Set(["", "-", "—", "n/a", "na", "none", "null"]);

/**
 * A REAL market / tender reference, normalized (upper, separators
 * stripped). Returns null for placeholders. Deliberately does NOT read
 * url_armp / url_j360 / id — those are per-NOTICE (per-lot), so they
 * would PREVENT consolidation, not help it (owner decision 2026-06-13).
 */
export function normalizeMarketReference(ref: string | null | undefined): string | null {
  if (ref == null) return null;
  const raw = String(ref).trim();
  if (REF_PLACEHOLDERS.has(raw.toLowerCase())) return null;
  const norm = stripAccents(raw).toUpperCase().replace(/[\s/.\-_]+/g, "");
  return norm.length >= 3 ? norm : null;
}

const MARKET_REF_KEYS = [
  "market_reference", "reference_marche", "reference", "ref",
  "numero_marche", "num_marche", "no_marche", "ao_reference",
  "reference_ao", "appel_offre", "dossier", "marche",
] as const;

/** Pull a real market reference from a raw source item (never url/id). */
export function marketReferenceOf(item: any): string | null {
  const raw = pick(item, ...MARKET_REF_KEYS);
  return normalizeMarketReference(raw);
}

/** Country aliases so FR/EN spellings of the same country gate-match. */
const COUNTRY_ALIASES: Record<string, string> = {
  cameroun: "cameroon",
  "cote d ivoire": "ivory coast",
  "cote divoire": "ivory coast",
  rdc: "democratic republic of the congo",
  "republique democratique du congo": "democratic republic of the congo",
  benin: "benin",
  "burkina faso": "burkina faso",
  maroc: "morocco",
  senegal: "senegal",
  tchad: "chad",
  "guinee": "guinea",
};

/** Canonical country token for the STRICT country gate. */
export function canonicalCountry(country: string | null | undefined): string {
  const base = stripAccents(String(country ?? ""))
    .toLowerCase()
    .replace(/[^a-z\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return COUNTRY_ALIASES[base] ?? base;
}

/* ------------------------------------------------------------------ */
/* 2. Similarity                                                       */
/* ------------------------------------------------------------------ */

/** Word tokens (≥ 2 chars) of a normalized string, as a Set. */
export function tokenSet(s: string): Set<string> {
  return new Set(s.split(" ").filter((t) => t.length >= 2));
}

/** Jaccard overlap of two token sets, 0..1. Empty vs empty = 0. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Title similarity on the LOT-STRIPPED normalized titles (0..1). */
export function titleSimilarity(a: string | null, b: string | null): number {
  return jaccard(tokenSet(normalizeTitleForKey(a)), tokenSet(normalizeTitleForKey(b)));
}

/** Buyer similarity — booster only. */
export function buyerSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeBuyer(a);
  const nb = normalizeBuyer(b);
  if (na && nb && na === nb) return 1;
  return jaccard(tokenSet(na), tokenSet(nb));
}

/** |a − b| ≤ days. Missing dates → false (can't claim same period). */
export function dateWithinWindow(a: string | null, b: string | null, days: number): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return Math.abs(ta - tb) <= days * 86400000;
}

/* ------------------------------------------------------------------ */
/* 3. Identity + matching                                              */
/* ------------------------------------------------------------------ */

export type TenderIdentity = {
  title: string | null;
  buyer: string | null;
  country: string | null;
  /** publication date YYYY-MM-DD */
  date: string | null;
  marketRef: string | null;
  /** total amount (local) — corroborates the B2 OCR-typo merge path */
  amount: number | null;
};

/** Build a tender identity from a raw J360 source item (v1 or v2). */
export function tenderIdentity(item: any): TenderIdentity {
  return {
    title: pick(item, "titre", "title", "projet", "intitule") ?? null,
    buyer: pick(item, "acheteur", "buyer", "autorite", "autorité") ?? null,
    country: pick(item, "pays", "country") ?? null,
    date:
      (pick(item, "date_publication", "date_pub", "date_attribution", "date") as string | null)?.slice(0, 10) ??
      null,
    marketRef: marketReferenceOf(item),
    amount: parseAmount(pick(item, "montant_total_local", "montant", "amount", "budget", "montant_total_usd")),
  };
}

/** |a − b| within tolerance (default 2%). Both must be present. */
export function amountClose(a: number | null, b: number | null, tolPct = 0.02): boolean {
  if (a == null || b == null) return false;
  const hi = Math.max(Math.abs(a), Math.abs(b));
  if (hi === 0) return true;
  return Math.abs(a - b) / hi <= tolPct;
}

export type MatchOptions = {
  windowDays?: number; // ± publication window for the fuzzy gate
  titleThreshold?: number; // minimum title similarity for the fuzzy gate
  highTitleThreshold?: number; // ≥ this + close buyer ⇒ high confidence
  /** B2 corroborated path: lower title bar accepted when buyer + amount agree. */
  corroboratedTitleThreshold?: number;
  buyerStrongThreshold?: number;
  amountTolerancePct?: number;
};

export const DEFAULT_MATCH_OPTIONS: Required<MatchOptions> = {
  windowDays: 30,
  titleThreshold: 0.85,
  highTitleThreshold: 0.92,
  corroboratedTitleThreshold: 0.6,
  buyerStrongThreshold: 0.9,
  amountTolerancePct: 0.02,
};

export type MatchResult<T extends TenderIdentity> = {
  match: T | null;
  via: "reference" | "fuzzy" | null;
  score: number; // 1.0 for reference, title similarity for fuzzy, 0 if none
  confidence: "high" | "candidate" | null;
  reason: string;
};

/**
 * Decide whether `candidate` belongs to an existing tender — owner-locked
 * order (2026-06-13):
 *   A. same real market reference        → merge (high)
 *   B. country strict + title ≥ threshold + within ±window
 *        · buyer also close & title ≥ highTitleThreshold → high
 *        · otherwise                                     → candidate (flagged)
 *   B2. country strict + window + buyer≈equal + amount≈equal + title ≥ 0.6
 *        → high. Catches the same project scraped as two notices with an
 *        OCR typo in the title (e.g. "CERTAINES" vs "CERT AINES"), WITHOUT
 *        the boilerplate over-merge a pure character metric would cause
 *        (different communes have different buyer AND amount).
 *   C. otherwise                          → create new (match: null)
 *
 * Buyer is NEVER a gate for B (it only lifts confidence). In B2 buyer +
 * amount are CORROBORATION that lets a lower title score through — they
 * never block the plain B path.
 */
export function matchTender<T extends TenderIdentity>(
  candidate: TenderIdentity,
  existing: T[],
  options: MatchOptions = {}
): MatchResult<T> {
  const opts = { ...DEFAULT_MATCH_OPTIONS, ...options };

  // A — real market reference primes over everything.
  if (candidate.marketRef) {
    const refHit = existing.find((e) => e.marketRef && e.marketRef === candidate.marketRef);
    if (refHit) {
      return {
        match: refHit,
        via: "reference",
        score: 1,
        confidence: "high",
        reason: `Same market reference ${candidate.marketRef}`,
      };
    }
  }

  // B — country-strict fuzzy.
  const cc = canonicalCountry(candidate.country);
  let best: { e: T; score: number; buyerSim: number } | null = null;
  for (const e of existing) {
    if (canonicalCountry(e.country) !== cc) continue; // strict country gate
    if (!dateWithinWindow(candidate.date, e.date, opts.windowDays)) continue;
    const score = titleSimilarity(candidate.title, e.title);
    if (score < opts.titleThreshold) continue;
    const buyerSim = buyerSimilarity(candidate.buyer, e.buyer);
    if (!best || score > best.score) best = { e, score, buyerSim };
  }
  if (best) {
    const buyerClose = best.buyerSim >= 0.6;
    const high = best.score >= opts.highTitleThreshold && buyerClose;
    return {
      match: best.e,
      via: "fuzzy",
      score: best.score,
      confidence: high ? "high" : "candidate",
      reason:
        `Title ${(best.score * 100).toFixed(0)}% · same country · within ${opts.windowDays}d` +
        (buyerClose ? " · buyer matches" : " · buyer differs (flagged)"),
    };
  }

  // B2 — corroborated low-title merge (OCR typo case).
  let best2: { e: T; score: number } | null = null;
  for (const e of existing) {
    if (canonicalCountry(e.country) !== cc) continue;
    if (!dateWithinWindow(candidate.date, e.date, opts.windowDays)) continue;
    if (buyerSimilarity(candidate.buyer, e.buyer) < opts.buyerStrongThreshold) continue;
    if (!amountClose(candidate.amount, e.amount, opts.amountTolerancePct)) continue;
    const score = titleSimilarity(candidate.title, e.title);
    if (score < opts.corroboratedTitleThreshold) continue;
    if (!best2 || score > best2.score) best2 = { e, score };
  }
  if (best2) {
    return {
      match: best2.e,
      via: "fuzzy",
      score: best2.score,
      confidence: "high",
      reason: `Same buyer + amount + date · title ${(best2.score * 100).toFixed(0)}% (notice-duplicate)`,
    };
  }

  // C — new project.
  return { match: null, via: null, score: 0, confidence: null, reason: "No similar tender" };
}

/* ------------------------------------------------------------------ */
/* 4. Lot extraction (MVP: lots carried on participants)               */
/* ------------------------------------------------------------------ */

export type LotEntry = {
  lot_number: string | null;
  lot_title: string | null;
  lot_amount: number | null; // LOCAL amount of THIS lot — never summed away
  winner_name: string;
  status: "winner";
};

/**
 * Lots of a v2 item (`gagnants[]`), ONE entry per lot — amounts kept
 * per lot, not aggregated. A company winning several lots yields several
 * entries (e.g. ETS ZIANDEM on lots 4, 7, 9). Empty for v1 items (no
 * `gagnants`), so v1 keeps its lot-less behaviour.
 */
export function extractLots(item: any): LotEntry[] {
  const lots = Array.isArray(item?.gagnants) ? item.gagnants : [];
  const out: LotEntry[] = [];
  for (const lot of lots) {
    const winner = String(lot?.entreprise ?? lot?.nom ?? lot?.name ?? "").trim();
    if (!winner || winner === "—") continue;
    out.push({
      lot_number: lot?.lot != null && String(lot.lot).trim() !== "" ? String(lot.lot).trim() : null,
      lot_title: (pick(lot, "lot_titre", "intitule", "intitule_lot", "objet") as string | null) ?? null,
      lot_amount: parseAmount(lot?.montant_local ?? lot?.montant ?? lot?.amount),
      winner_name: winner,
      status: "winner",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 5. In-memory clustering (import find-or-merge + retro report share)  */
/* ------------------------------------------------------------------ */

export type ProjectGroup = {
  /** Identity of the group's principal (first item; ref filled if any later item has one). */
  identity: TenderIdentity;
  /** Indices of the source items that landed in this group. */
  itemIndexes: number[];
  /** All lots across the grouped items (deduped on lot_number + winner). */
  lots: LotEntry[];
  /** Distinct winner company names across the group. */
  winners: string[];
  /** Why each non-principal item was merged in. */
  mergeReasons: Array<{ itemIndex: number; via: string; score: number; confidence: string; reason: string }>;
  /** True if any merge in this group was a gray-zone (candidate) merge. */
  flagged: boolean;
};

/**
 * Cluster raw source items into real-world projects using matchTender.
 * Used by the import (incrementally, against DB + same-run groups) and by
 * the retro dry-run report (against existing tenders). Pure: same input
 * → same grouping, no side effects.
 */
export function groupItemsIntoProjects(items: any[], options: MatchOptions = {}): ProjectGroup[] {
  const groups: ProjectGroup[] = [];
  items.forEach((item, itemIndex) => {
    const identity = tenderIdentity(item);
    const lots = extractLots(item);
    const winners = lots.map((l) => l.winner_name);

    const res = matchTender(
      identity,
      groups.map((g) => g.identity),
      options
    );
    if (res.match && res.confidence) {
      // Find the group whose identity is the matched one.
      const gi = groups.findIndex((g) => g.identity === res.match);
      const g = groups[gi];
      g.itemIndexes.push(itemIndex);
      for (const l of lots) {
        const dup = g.lots.some(
          (x) => x.lot_number === l.lot_number && x.winner_name === l.winner_name
        );
        if (!dup) g.lots.push(l);
      }
      for (const w of winners) if (!g.winners.includes(w)) g.winners.push(w);
      // A later item may carry the market reference the principal lacked.
      if (!g.identity.marketRef && identity.marketRef) g.identity.marketRef = identity.marketRef;
      g.mergeReasons.push({
        itemIndex,
        via: res.via ?? "",
        score: res.score,
        confidence: res.confidence,
        reason: res.reason,
      });
      if (res.confidence === "candidate") g.flagged = true;
    } else {
      groups.push({
        identity,
        itemIndexes: [itemIndex],
        lots: [...lots],
        winners: [...new Set(winners)],
        mergeReasons: [],
        flagged: false,
      });
    }
  });
  return groups;
}

/* ------------------------------------------------------------------ */
/* 6. Retro clustering — find duplicate tenders ALREADY in the DB      */
/* ------------------------------------------------------------------ */

export type IdentifiedTender = TenderIdentity & {
  id: string;
  participantCount: number;
  importedAt: string | null;
};

export type TenderCluster = {
  /** Survivor: most participants, tie → earliest imported. */
  principal: IdentifiedTender;
  duplicates: Array<{
    tender: IdentifiedTender;
    via: string;
    score: number;
    confidence: string;
    reason: string;
  }>;
};

/**
 * Cluster EXISTING tenders into real-world projects (retro dry-run).
 * Uses the SAME matchTender as the import, so the report and the live
 * import agree. Pure — no DB. Returns only clusters with ≥ 1 duplicate;
 * the principal is the richest record (most participants, then oldest).
 */
export function clusterTenders(
  tenders: IdentifiedTender[],
  options: MatchOptions = {}
): TenderCluster[] {
  const groups: { members: IdentifiedTender[]; edges: Map<string, { via: string; score: number; confidence: string; reason: string }> }[] = [];

  for (const t of tenders) {
    let placed = false;
    for (const g of groups) {
      // match against the group's current representative (first member)
      const r = matchTender(t, [g.members[0]], options);
      if (r.match && r.confidence) {
        g.members.push(t);
        g.edges.set(t.id, {
          via: r.via ?? "",
          score: r.score,
          confidence: r.confidence,
          reason: r.reason,
        });
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ members: [t], edges: new Map() });
  }

  const out: TenderCluster[] = [];
  for (const g of groups) {
    if (g.members.length < 2) continue;
    // principal = most participants, tie → earliest importedAt, tie → id
    const principal = [...g.members].sort((a, b) => {
      if (b.participantCount !== a.participantCount) return b.participantCount - a.participantCount;
      const ai = a.importedAt ?? "9999";
      const bi = b.importedAt ?? "9999";
      if (ai !== bi) return ai.localeCompare(bi);
      return a.id.localeCompare(b.id);
    })[0];
    out.push({
      principal,
      duplicates: g.members
        .filter((m) => m.id !== principal.id)
        .map((m) => ({
          tender: m,
          via: g.edges.get(m.id)?.via ?? "",
          score: g.edges.get(m.id)?.score ?? 0,
          confidence: g.edges.get(m.id)?.confidence ?? "",
          reason: g.edges.get(m.id)?.reason ?? "",
        })),
    });
  }
  return out;
}
