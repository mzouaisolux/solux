/**
 * Prospect intelligence (m116 — Prospects & Tenders V2) — pure module.
 *
 * SOLUX is a manufacturer: tender winners/participants (integrators,
 * EPCs, distributors) are the most strategic prospection base. This
 * module holds the three pieces of business logic that must be exact,
 * shared and testable:
 *
 *   1. normalizeCompanyKey — the deduplication key. One company = ONE
 *      record, whatever the spelling/casing/accents across yearly
 *      attribution files.
 *   2. tenderActivityScore — commercial prioritisation: participation
 *      +1, win +3, recency bonus.
 *   3. The STATUS MODEL v2 with its official rule: a LEAD exists only
 *      after a RECIPROCAL interaction. An email sent is NOT a lead; an
 *      assignment is NOT a lead.
 *
 * Relative .ts imports convention (none needed — zero imports) keeps
 * the module loadable by the node test runner.
 */

/* ------------------------------------------------------------------ */
/* 1. Deduplication key                                                */
/* ------------------------------------------------------------------ */

/**
 * Normalised company identity: lowercase, accent-stripped, punctuation
 * collapsed to spaces, whitespace collapsed. "AFRIK  LONNYA", "Afrik
 * Lonnya." and "AFRIK-LONNYA" all map to "afrik lonnya".
 */
export function normalizeCompanyKey(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ") // punctuation/symbols → spaces
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* 2. Tender Activity Score                                            */
/* ------------------------------------------------------------------ */

export const SCORE_PER_PARTICIPATION = 1;
export const SCORE_PER_WIN = 3;
/** Recency bonus: active in the last 12 months → +2; last 24 → +1. */
export const SCORE_RECENCY_12M = 2;
export const SCORE_RECENCY_24M = 1;

export function tenderActivityScore(args: {
  participations: number;
  wins: number;
  /** YYYY-MM-DD (or ISO) of the most recent participation, if any. */
  lastParticipationAt?: string | null;
  /** Injectable for tests. */
  today?: string;
}): number {
  const participations = Math.max(0, args.participations | 0);
  const wins = Math.max(0, args.wins | 0);
  let score =
    participations * SCORE_PER_PARTICIPATION + wins * SCORE_PER_WIN;
  if (args.lastParticipationAt) {
    const last = Date.parse(String(args.lastParticipationAt).slice(0, 10));
    const ref = Date.parse(
      (args.today ?? new Date().toISOString()).slice(0, 10)
    );
    if (Number.isFinite(last) && Number.isFinite(ref) && last <= ref) {
      const days = Math.floor((ref - last) / 86_400_000);
      if (days <= 365) score += SCORE_RECENCY_12M;
      else if (days <= 730) score += SCORE_RECENCY_24M;
    }
  }
  return score;
}

/* ------------------------------------------------------------------ */
/* 3. Status model v2                                                  */
/* ------------------------------------------------------------------ */

export const PROSPECT_STATUSES_V2 = [
  "new", // never touched
  "assigned", // has an owner, no action yet
  "contacted", // ≥1 outbound action, NO reply yet
  "lead", // reciprocal interaction obtained (a reply)
  "opportunity", // identified project (price request, tender, consultation)
  "customer", // first order — converted to client
  "rejected", // not relevant
  "blacklisted", // never contact again
] as const;
export type ProspectStatusV2 = (typeof PROSPECT_STATUSES_V2)[number];

export const PROSPECT_STATUS_LABEL: Record<ProspectStatusV2, string> = {
  new: "New",
  assigned: "Assigned",
  contacted: "Contacted",
  lead: "Lead",
  opportunity: "Opportunity",
  customer: "Customer",
  rejected: "Rejected",
  blacklisted: "Blacklisted",
};

/** Forward-only rank — auto-advance may never move a prospect backwards. */
const STATUS_RANK: Record<ProspectStatusV2, number> = {
  new: 0,
  assigned: 1,
  contacted: 2,
  lead: 3,
  opportunity: 4,
  customer: 5,
  rejected: 99, // terminal-ish: never auto-advanced out of
  blacklisted: 99,
};

/**
 * Status after logging an activity — the OFFICIAL rule, enforced:
 *   - an OUTBOUND action (email/call/whatsapp/linkedin/meeting) moves
 *     new/assigned → contacted. It NEVER creates a lead.
 *   - a REPLY (is_reply) moves anything ≤ contacted → lead.
 *   - nothing ever moves backwards, and rejected/blacklisted/customer/
 *     opportunity are never touched automatically.
 *   - `note` is bookkeeping — it never advances anything.
 */
export function prospectStatusAfterActivity(
  current: string,
  kind: "email" | "call" | "whatsapp" | "linkedin" | "meeting" | "note",
  isReply: boolean
): ProspectStatusV2 | null {
  const cur = (PROSPECT_STATUSES_V2 as readonly string[]).includes(current)
    ? (current as ProspectStatusV2)
    : "new";
  if (STATUS_RANK[cur] >= STATUS_RANK.opportunity) return null; // hands off
  if (kind === "note" && !isReply) return null;
  const target: ProspectStatusV2 = isReply ? "lead" : "contacted";
  return STATUS_RANK[target] > STATUS_RANK[cur] ? target : null;
}

/* ------------------------------------------------------------------ */
/*  Contact intel merge (owner bug 2026-06-13 — ANAYI BF case)         */
/* ------------------------------------------------------------------ */

/**
 * Fill-empty contact merge: the company profile shown to the user can
 * NEVER carry less contact intel than the participant rows it derives
 * from. Existing prospect values (the Lead Manager's manual work)
 * always win — participant intel only fills the holes. The participant
 * field `manager_name` maps to the prospect field `leader_name`.
 *
 * Used at READ TIME by the tender workspace and the companies bundle,
 * so the profile is correct even when the materialized sync hasn't run
 * on that row yet (unlinked participant, pre-fix import, …).
 */
export function fillEmptyContactsFromParticipant<T extends Record<string, any>>(
  prospect: T,
  part: {
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    manager_name?: string | null;
  }
): T {
  return {
    ...prospect,
    email: prospect.email ?? part.email ?? null,
    phone: prospect.phone ?? part.phone ?? null,
    address: prospect.address ?? part.address ?? null,
    leader_name: prospect.leader_name ?? part.manager_name ?? null,
  };
}
