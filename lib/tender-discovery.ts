/**
 * Tender discovery signals (m117 UI v2) — pure module.
 *
 * Turns raw attribution data into SALES DECISION signals:
 *
 *   1. usdEquivalent  — every amount comparable at a glance. ESTIMATES
 *      on purpose (static indicative rates): the goal is ranking
 *      opportunities, not accounting. The original amount stays shown.
 *   2. funderOf       — World Bank ≠ small municipality. Extracted from
 *      the buyer text (FR/EN patterns).
 *   3. projectPriorityScore — 0-100: "which project should I work on
 *      first?" Amount + funder quality + winner/participants/contacts.
 *
 * Zero imports → loadable by the node test runner.
 */

/* ------------------------------------------------------------------ */
/* 1. USD equivalent                                                    */
/* ------------------------------------------------------------------ */

/** Indicative conversion rates → 1 USD. Estimates for COMPARISON only —
 *  update casually; precision is irrelevant at ranking granularity. */
export const USD_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.78,
  // CFA francs (both zones trade ~655 per EUR → ~600/USD)
  XOF: 600,
  XAF: 600,
  FCFA: 600,
  CFA: 600,
  MAD: 10,
  DZD: 135,
  TND: 3.1,
  EGP: 48,
  NGN: 1500,
  GHS: 15,
  KES: 130,
  ZAR: 18,
  CNY: 7.2,
};

/** Fallback currency by country when the file omits it — main Solux
 *  markets only; anything unknown stays unconverted (honest "—"). */
const COUNTRY_CURRENCY: Record<string, string> = {
  "burkina faso": "XOF",
  senegal: "XOF",
  sénégal: "XOF",
  mali: "XOF",
  niger: "XOF",
  togo: "XOF",
  benin: "XOF",
  bénin: "XOF",
  "cote d'ivoire": "XOF",
  "côte d'ivoire": "XOF",
  "guinee-bissau": "XOF",
  cameroun: "XAF",
  cameroon: "XAF",
  tchad: "XAF",
  chad: "XAF",
  gabon: "XAF",
  congo: "XAF",
  "republique centrafricaine": "XAF",
  "central african republic": "XAF",
  "guinee equatoriale": "XAF",
  maroc: "MAD",
  morocco: "MAD",
  algerie: "DZD",
  algérie: "DZD",
  algeria: "DZD",
  tunisie: "TND",
  tunisia: "TND",
  egypte: "EGP",
  égypte: "EGP",
  egypt: "EGP",
  nigeria: "NGN",
  ghana: "GHS",
  kenya: "KES",
  "afrique du sud": "ZAR",
  "south africa": "ZAR",
};

function normCurrency(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = raw.trim().toUpperCase().replace(/\./g, "");
  if (c in USD_RATES) return c;
  if (/^F\s?CFA$/.test(c) || c === "FRANC CFA" || c === "FRANCS CFA") return "XOF";
  if (c === "€" || c === "EURO" || c === "EUROS") return "EUR";
  if (c === "$" || c === "US$" || c === "USD$") return "USD";
  if (c === "DH" || c === "DHS" || c === "DIRHAM" || c === "DIRHAMS") return "MAD";
  return null;
}

/**
 * Estimated USD value of an amount. Currency resolution order: explicit
 * currency → country fallback → null (no guessing a 287M FCFA into
 * $287M). Returns null when not convertible.
 */
export function usdEquivalent(args: {
  amount: number | null | undefined;
  currency?: string | null;
  country?: string | null;
}): number | null {
  const { amount } = args;
  if (amount == null || !Number.isFinite(Number(amount))) return null;
  const cur =
    normCurrency(args.currency) ??
    (args.country
      ? COUNTRY_CURRENCY[args.country.trim().toLowerCase()] ?? null
      : null);
  if (!cur) return null;
  const rate = USD_RATES[cur];
  if (!rate) return null;
  return Number(amount) / rate;
}

/**
 * USD value of a TENDER ROW — source-exact first. v2 exports carry the
 * authoritative USD (stored by the import in specs.montant_usd); that
 * wins and is NOT labeled "estimated". Otherwise estimate from the
 * local amount (budget_usd column = amount in `currency` — the app-wide
 * semantic) via USD_RATES.
 *
 * Bug 2026-06-13 (MAGNA/WABANE): the import had stored the file's USD
 * (260,866) into budget_usd; the UI then re-converted it as XAF and
 * displayed $435. One semantic per field, forever: budget_usd = LOCAL,
 * specs.montant_usd = USD.
 */
export function tenderUsd(t: {
  budget_usd?: number | string | null;
  currency?: string | null;
  country?: string | null;
  specs?: any;
}): { usd: number | null; exact: boolean } {
  const direct = t?.specs?.montant_usd;
  const directNum = direct == null ? null : Number(direct);
  if (directNum != null && Number.isFinite(directNum) && directNum > 0) {
    return { usd: directNum, exact: true };
  }
  return {
    usd: usdEquivalent({
      amount: t?.budget_usd != null ? Number(t.budget_usd) : null,
      currency: t?.currency,
      country: t?.country,
    }),
    exact: false,
  };
}

/** "$495K" / "$1.2M" — compact, scannable. */
export function fmtUsd(usd: number | null): string {
  if (usd == null) return "—";
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}K`;
  return `$${Math.round(usd)}`;
}

/* ------------------------------------------------------------------ */
/* 2. Funder extraction                                                 */
/* ------------------------------------------------------------------ */

export type FunderKey =
  | "world_bank"
  | "afdb"
  | "afd"
  | "eu"
  | "undp"
  | "isdb"
  | "government"
  | "municipality"
  | "unknown";

export const FUNDER_LABEL: Record<FunderKey, string> = {
  world_bank: "World Bank",
  afdb: "African Development Bank",
  afd: "AFD",
  eu: "European Union",
  undp: "UNDP",
  isdb: "Islamic Development Bank",
  government: "Government",
  municipality: "Municipality",
  unknown: "Unknown funder",
};

/** Institutional quality for the priority score (international donors
 *  fund bigger, better-paid projects than small municipalities). */
const FUNDER_QUALITY: Record<FunderKey, number> = {
  world_bank: 25,
  afdb: 25,
  isdb: 22,
  eu: 22,
  undp: 20,
  afd: 20,
  government: 12,
  municipality: 8,
  unknown: 5,
};

export function funderOf(buyer: string | null | undefined): FunderKey {
  if (!buyer) return "unknown";
  const b = buyer
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (/banque mondiale|world bank|\bbird\b|\bida\b|\bibrd\b/.test(b)) return "world_bank";
  if (/banque africaine|african development|\bafdb\b|\bbad\b/.test(b)) return "afdb";
  if (/banque islamique|islamic development|\bisdb\b|\bbid\b/.test(b)) return "isdb";
  if (/union europeenne|european union|\bue\b|\beu\b|europeaid/.test(b)) return "eu";
  if (/\bpnud\b|\bundp\b|nations unies|united nations|\bunops\b|\bunicef\b/.test(b)) return "undp";
  if (/\bafd\b|agence francaise de developpement/.test(b)) return "afd";
  if (/commune|mairie|municipalite|municipality|ville de|city of|conseil regional/.test(b))
    return "municipality";
  if (
    /ministere|ministry|gouvernement|government|direction generale|agence nationale|office national|societe nationale|etat de|fonds national|prefecture/.test(b)
  )
    return "government";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/* 3. Priority score                                                    */
/* ------------------------------------------------------------------ */

/**
 * 0-100 — "which project should I work on first?"
 *   Amount (USD)        up to 35
 *   Funder quality      up to 25
 *   Winner identified   +10
 *   Participants ≥ 2    +10
 *   Contacts found      +10 (≥1) / +15 (≥3)
 *   Relevance bonus     +5 (tool score ≥ 70)
 */
export function projectPriorityScore(args: {
  usd: number | null;
  funder: FunderKey;
  hasWinner: boolean;
  participantsCount: number;
  contactsCount: number;
  relevanceScore?: number | null;
}): number {
  let score = 0;
  const usd = args.usd ?? 0;
  if (usd >= 1_000_000) score += 35;
  else if (usd >= 500_000) score += 30;
  else if (usd >= 100_000) score += 25;
  else if (usd >= 50_000) score += 18;
  else if (usd >= 10_000) score += 10;
  else if (usd > 0) score += 5;

  score += FUNDER_QUALITY[args.funder];

  if (args.hasWinner) score += 10;
  if (args.participantsCount >= 2) score += 10;
  if (args.contactsCount >= 3) score += 15;
  else if (args.contactsCount >= 1) score += 10;

  const rel = Number(args.relevanceScore ?? NaN);
  if (Number.isFinite(rel) && rel >= 70) score += 5;

  return Math.min(100, score);
}

/* ------------------------------------------------------------------ */
/* 4. Opportunity tier — the VISUAL score (workspace redesign v2)      */
/* ------------------------------------------------------------------ */
/** Salespeople don't read numbers — they read green/yellow/low. Tiers
 *  derive from projectPriorityScore (amount + funder + intel density). */
export type OpportunityTier = "high" | "medium" | "low";

export function opportunityTier(score: number): {
  tier: OpportunityTier;
  label: string;
} {
  if (score >= 65) return { tier: "high", label: "High Opportunity" };
  if (score >= 40) return { tier: "medium", label: "Medium Opportunity" };
  return { tier: "low", label: "Low Opportunity" };
}
