/**
 * AI review states for the lighting extraction (phase 2 of the
 * Pre-Validation workflow, owner spec 2026-07-21) — pure logic.
 *
 * Every AI-extracted value must show whether it has been REVIEWED:
 *   - (unreviewed)  — extracted, no human has acted on it yet;
 *   - confirmed     — a human explicitly confirmed the AI value;
 *   - corrected     — a human saved a DIFFERENT value than the AI extracted
 *                     (detected server-side at save time, never self-reported).
 *
 * The state lives inside the existing `ai_extracted` jsonb blob on
 * product_lighting_setups (`review` map) — no migration needed, and the
 * m179 freeze triggers automatically protect it once the task list reaches
 * Final Validation. The solar-panel tilt is NOT handled here: it has the
 * richer m176 state machine on the task list itself.
 *
 * Client + server safe (no DB access).
 */

import type { LightingProgram } from "./types.ts";

/** The Energy-Study fields a human reviews (tilt excluded — m176 owns it). */
export const AI_REVIEWABLE_FIELDS = [
  "lighting_power",
  "operating_hours",
  "lighting_program",
] as const;
export type AiReviewableField = (typeof AI_REVIEWABLE_FIELDS)[number];

export type AiFieldReview = {
  state: "confirmed" | "corrected";
  by: string | null;
  at: string;
  /** For corrections: what the AI said vs what the human saved. */
  ai_value?: unknown;
  saved_value?: unknown;
};

export type AiReviewMap = Partial<Record<AiReviewableField, AiFieldReview>>;

export function isReviewableField(v: unknown): v is AiReviewableField {
  return (AI_REVIEWABLE_FIELDS as readonly string[]).includes(String(v));
}

/**
 * Program equality for correction detection — CONTENT, not representation.
 * The saved program passes through normalizeLightingProgram, which rebuilds
 * period objects with a different key order than the stored AI blob; naive
 * JSON.stringify equality false-positived on that (caught live 2026-07-21).
 * Project both sides onto a canonical fixed-key shape first.
 */
function canonicalProgram(p: unknown): string {
  const arr = Array.isArray(p) ? p : [];
  return JSON.stringify(
    arr.map((x: any) => ({
      output: x?.output ?? null,
      duration_hours: x?.duration_hours ?? null,
      presence_detection: x?.presence_detection === true,
      detection_output: x?.detection_output ?? null,
      detection_hold_seconds: x?.detection_hold_seconds ?? null,
      estimated_detections: x?.estimated_detections ?? null,
    }))
  );
}

function sameProgram(a: unknown, b: unknown): boolean {
  return canonicalProgram(a) === canonicalProgram(b);
}

function sameNumber(a: unknown, b: unknown): boolean {
  const na = a == null ? null : Number(a);
  const nb = b == null ? null : Number(b);
  return (na == null && nb == null) || (na != null && nb != null && na === nb);
}

/**
 * Detect manual corrections at save time: for every AI-extracted field whose
 * SAVED value now differs, stamp `corrected` (overwriting an earlier
 * `confirmed` — the human changed their mind and the newer act wins). Fields
 * whose saved value still equals the AI value keep their existing review
 * unchanged: matching the AI is not evidence of review, and an earlier
 * correction is history, not something a later identical save erases.
 *
 * Pure: returns the NEXT review map (never mutates the input).
 */
export function applyCorrectionsAfterSave(args: {
  aiFields: {
    lighting_power?: number | null;
    operating_hours?: number | null;
    lighting_program?: LightingProgram | null;
  } | null;
  existingReview: AiReviewMap | null | undefined;
  saved: {
    lighting_power: number | null;
    operating_hours: number | null;
    lighting_program: LightingProgram;
  };
  userId: string | null;
  now: string;
}): AiReviewMap {
  const next: AiReviewMap = { ...(args.existingReview ?? {}) };
  const ai = args.aiFields;
  if (!ai) return next;

  const stamp = (field: AiReviewableField, aiValue: unknown, savedValue: unknown) => {
    next[field] = {
      state: "corrected",
      by: args.userId,
      at: args.now,
      ai_value: aiValue,
      saved_value: savedValue,
    };
  };

  if (ai.lighting_power != null && !sameNumber(ai.lighting_power, args.saved.lighting_power)) {
    stamp("lighting_power", ai.lighting_power, args.saved.lighting_power);
  }
  if (ai.operating_hours != null && !sameNumber(ai.operating_hours, args.saved.operating_hours)) {
    stamp("operating_hours", ai.operating_hours, args.saved.operating_hours);
  }
  if (
    ai.lighting_program != null &&
    (ai.lighting_program as LightingProgram).length > 0 &&
    !sameProgram(ai.lighting_program, args.saved.lighting_program)
  ) {
    stamp("lighting_program", ai.lighting_program, args.saved.lighting_program);
  }
  return next;
}

/** Normalize a stored review map — unknown fields/states are dropped. */
export function normalizeAiReview(raw: unknown): AiReviewMap {
  if (!raw || typeof raw !== "object") return {};
  const out: AiReviewMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isReviewableField(k) || !v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (r.state !== "confirmed" && r.state !== "corrected") continue;
    out[k] = {
      state: r.state,
      by: typeof r.by === "string" ? r.by : null,
      at: typeof r.at === "string" ? r.at : "",
      ai_value: r.ai_value,
      saved_value: r.saved_value,
    };
  }
  return out;
}
