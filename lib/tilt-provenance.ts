/**
 * Solar-panel tilt angle — AI extraction PROVENANCE (m176).
 *
 * m159 gave the task list a first-class `solar_panel_tilt_angle` column and an
 * Energy-Study AI assist; m160 added an explicit "AI Find" button. Neither kept
 * any record of WHERE the number came from: the confidence, the source document
 * and the page were computed, shown in a toast, and thrown away. After a
 * refresh nobody could tell an AI-read value from a hand-typed one.
 *
 * This module is the single source of truth for that record, stored as ONE
 * jsonb blob (`production_task_lists.tilt_ai_provenance`) — same pattern as
 * industrial_spec (m159) / sticker_requirements (m061).
 *
 * It also encodes the CONFLICT rule (owner decision 2026-07-21). The task list
 * is born with the tilt Sales stated on the Service Request, so the field is
 * essentially never empty — which is exactly why the m159 auto-fill (which only
 * wrote into a NULL field) never fired in practice. The fix is NOT to let the
 * study overwrite production silently: a tilt drives the pole drawing, so when
 * the study disagrees with the stored value we keep the stored value, record
 * the study's, and raise a PENDING conflict a human must settle. The
 * pole-drawing checkpoint stays blocked until they do.
 *
 * Client + server safe (no DB access). The app NEVER trusts the raw stored
 * shape — always read through normalizeTiltProvenance().
 */

import { cleanTiltAngle } from "./industrial-spec.ts";

/**
 * Where in the study the number came from, ordered by authority (owner spec).
 * The extractor ranks its candidates with these; `pickTiltCandidate` resolves.
 */
export type TiltPriorityBasis =
  | "final_recommended" // 1. the study's final recommended project tilt
  | "product_specific" // 2. tied to a specific product / model
  | "project_installation" // 3. the project's installation tilt
  | "simulation_input" // 4. a simulation input explicitly used for the final calc
  | "general_default"; // 5. a generic / default tilt

/** Rank of each basis — lower wins. Unknown basis sorts last. */
const BASIS_RANK: Record<TiltPriorityBasis, number> = {
  final_recommended: 1,
  product_specific: 2,
  project_installation: 3,
  simulation_input: 4,
  general_default: 5,
};

export const TILT_BASIS_LABELS: Record<TiltPriorityBasis, string> = {
  final_recommended: "Final recommended tilt",
  product_specific: "Product-specific tilt",
  project_installation: "Project installation tilt",
  simulation_input: "Simulation input (final calculation)",
  general_default: "General / default tilt",
};

const VALID_BASIS = new Set(Object.keys(BASIS_RANK) as TiltPriorityBasis[]);

/** One tilt value the study states, with where it was read. */
export type TiltCandidate = {
  value: number;
  basis: TiltPriorityBasis | null;
  /** The sentence/paragraph it was read from — the reviewer's evidence. */
  source_text: string | null;
  /** 1-based page, when the text layer carried page markers. */
  source_page: number | null;
};

/**
 * How the extracted value stands relative to the value in production.
 *  • applied      — the field was empty, the AI value went straight in.
 *  • pending      — it disagrees with the stored value (or the study is
 *                   ambiguous): a human must settle it. Blocks the checkpoint.
 *  • accepted_ai  — a human took the AI value.
 *  • kept_manual  — a human kept the stored value.
 */
export type TiltResolution = "applied" | "pending" | "accepted_ai" | "kept_manual";

const VALID_RESOLUTION = new Set<TiltResolution>([
  "applied",
  "pending",
  "accepted_ai",
  "kept_manual",
]);

export type TiltProvenance = {
  /** The extracted value, normalized to degrees. */
  value: number;
  /** Always "degrees" — every source format is normalized on the way in. */
  unit: "degrees";
  basis: TiltPriorityBasis | null;
  source_document: string | null;
  source_page: number | null;
  source_text: string | null;
  /** 0..1 as reported by the model, when it reported one. */
  confidence: number | null;
  model: string | null;
  /** ISO timestamp of the extraction. */
  extracted_at: string;
  /** The study states several plausible values and the model could not choose. */
  ambiguous: boolean;
  /** Every value seen, kept so a reviewer can pick a different one. */
  candidates: TiltCandidate[];
  resolution: TiltResolution;
  resolved_by: string | null;
  resolved_at: string | null;
  /** True once a human edited the tilt AFTER this extraction landed. */
  manually_modified_after: boolean;
};

function cleanStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Clamp a reported confidence into 0..1; anything unusable becomes null. */
export function cleanConfidence(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

/** A 1-based page number, or null. */
function cleanPage(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.round(n);
}

function cleanBasis(v: unknown): TiltPriorityBasis | null {
  return typeof v === "string" && VALID_BASIS.has(v as TiltPriorityBasis)
    ? (v as TiltPriorityBasis)
    : null;
}

/** Source sentences can be long — keep the evidence readable in the UI. */
const MAX_SOURCE_TEXT = 400;

function cleanSourceText(v: unknown): string | null {
  const s = cleanStr(v);
  if (s == null) return null;
  // Collapse the PDF text layer's ragged whitespace so the quote reads as prose.
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat === "") return null;
  return flat.length > MAX_SOURCE_TEXT ? `${flat.slice(0, MAX_SOURCE_TEXT - 1)}…` : flat;
}

export function normalizeTiltCandidate(raw: unknown): TiltCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const value = cleanTiltAngle(r.value);
  if (value == null) return null; // out of 0..90 or unparseable → not a tilt
  return {
    value,
    basis: cleanBasis(r.basis),
    source_text: cleanSourceText(r.source_text),
    source_page: cleanPage(r.source_page),
  };
}

/**
 * Choose the authoritative candidate by the owner's source priority, and say
 * whether the study is AMBIGUOUS — i.e. two DIFFERENT values tie at the best
 * rank, or the winner has no basis at all and disagrees with another value.
 * Ambiguity never guesses: it is surfaced for human validation.
 */
export function pickTiltCandidate(candidates: TiltCandidate[]): {
  picked: TiltCandidate | null;
  ambiguous: boolean;
} {
  const list = candidates.filter((c) => c != null);
  if (list.length === 0) return { picked: null, ambiguous: false };
  if (list.length === 1) return { picked: list[0], ambiguous: false };

  const rankOf = (c: TiltCandidate) => (c.basis ? BASIS_RANK[c.basis] : 99);
  const best = Math.min(...list.map(rankOf));
  const top = list.filter((c) => rankOf(c) === best);

  // A tie at the top rank is only ambiguous when the values actually disagree.
  const distinct = new Set(top.map((c) => c.value));
  if (distinct.size > 1) return { picked: top[0], ambiguous: true };

  // Unranked winner + other values present = we cannot justify the choice.
  const allValues = new Set(list.map((c) => c.value));
  const unjustified = best === 99 && allValues.size > 1;
  return { picked: top[0], ambiguous: unjustified };
}

/**
 * Normalize a stored (possibly partial / legacy / null) blob. Returns null when
 * there is no usable provenance — callers treat null as "never AI-extracted".
 */
export function normalizeTiltProvenance(raw: unknown): TiltProvenance | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const value = cleanTiltAngle(r.value);
  if (value == null) return null; // a provenance without a value is noise

  const candidates = (Array.isArray(r.candidates) ? r.candidates : [])
    .map(normalizeTiltCandidate)
    .filter((c): c is TiltCandidate => c != null);

  const extracted_at = cleanStr(r.extracted_at);
  const resolution =
    typeof r.resolution === "string" && VALID_RESOLUTION.has(r.resolution as TiltResolution)
      ? (r.resolution as TiltResolution)
      : "applied";

  return {
    value,
    unit: "degrees",
    basis: cleanBasis(r.basis),
    source_document: cleanStr(r.source_document),
    source_page: cleanPage(r.source_page),
    source_text: cleanSourceText(r.source_text),
    confidence: cleanConfidence(r.confidence),
    model: cleanStr(r.model),
    // A blob written before this field existed still needs a date to display;
    // the epoch is an honest "unknown" rather than a fabricated recent time.
    extracted_at: extracted_at ?? new Date(0).toISOString(),
    ambiguous: r.ambiguous === true,
    candidates,
    resolution,
    resolved_by: cleanStr(r.resolved_by),
    resolved_at: cleanStr(r.resolved_at),
    manually_modified_after: r.manually_modified_after === true,
  };
}

/**
 * Is there an unresolved AI/production disagreement on this task list?
 * Pending conflicts BLOCK the pole-drawing checkpoint: the drawing must not be
 * signed off against a tilt nobody has confirmed.
 */
export function tiltConflictPending(prov: TiltProvenance | null): boolean {
  return prov != null && prov.resolution === "pending";
}

/**
 * Decide what a fresh extraction means against the value already stored.
 * `storedTilt` is the task list's current angle (null = empty field).
 *
 * Empty field           → applied (write it).
 * Same value            → applied (agreement, nothing to settle).
 * Different / ambiguous → pending (keep production, raise the conflict).
 */
export function resolveExtraction(
  extractedValue: number,
  storedTilt: number | null,
  ambiguous: boolean
): { resolution: TiltResolution; writeValue: number | null } {
  if (storedTilt == null) {
    // Nothing to contradict — but an ambiguous read still wants a human.
    return ambiguous
      ? { resolution: "pending", writeValue: null }
      : { resolution: "applied", writeValue: extractedValue };
  }
  if (!ambiguous && storedTilt === extractedValue) {
    return { resolution: "applied", writeValue: null }; // already correct
  }
  return { resolution: "pending", writeValue: null };
}
