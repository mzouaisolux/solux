/**
 * PER-LINE LIGHTING SETUP (m180) — pure model, owner spec 2026-07-22.
 *
 * One quotation carries several product families with DIFFERENT factory
 * programming — the order-level lighting setup was too simplistic. Each
 * eligible task-list product line now owns its own setup, stored as ONE
 * jsonb blob on production_task_list_lines.lighting. That attachment point
 * is deliberate: lines are inside the m179 revision snapshot, locked by the
 * m179 freeze trigger, and covered by the field-level revision diff — so
 * "every revision owns its own Lighting Setup data, previous revisions
 * remain immutable, full history always available" (confirmed decision #1)
 * holds with zero extra machinery.
 *
 * Model principles (confirmed decisions #2–#4):
 *   - RECOMMENDED vs FINAL: automatic mode populates `recommended` from the
 *     approved study and copies it into `final`; the TLM then edits `final`
 *     freely during Pre-Validation while `recommended` stays visible and
 *     untouched. Automatic is never read-only.
 *   - ONE controller per line, generic `{type, config}` so future controller
 *     types / firmware / IoT parameters fit without a schema change.
 *   - Apply-to-all is a COPY (source.kind='copy', copied_from) — never a link.
 *   - Mode switches NEVER destroy data: the outgoing values are archived to
 *     `history` before anything changes.
 *
 * Client + server safe (no DB access). The app never trusts the stored
 * shape — always read through normalizeLineLighting().
 */

import type { LightingProgram } from "./types.ts";
import { normalizeLightingProgram } from "./validate.ts";

export type LineLightingMode = "automatic" | "manual";

/** The values production actually programs — the TLM's final word. */
export type LineLightingValues = {
  operating_hours: number | null;
  program: LightingProgram;
  /** Dusk-to-dawn: runs the full night; stage durations become indicative. */
  dusk_to_dawn: boolean;
  /** Fully autonomous mode (no external control). */
  autonomous: boolean;
  /** Control mode vocabulary is open — 'time_control', 'motion', vendor terms… */
  control_mode: string | null;
  /** ONE controller per line (decision #2); config is intentionally open. */
  controller: { type: string | null; config: Record<string, unknown> };
  factory_instructions: string | null;
};

/** The study's recommendation — preserved verbatim beside the final values. */
export type LineLightingRecommendation = {
  method: "energy_study" | "dialux";
  source_document: string | null;
  extracted_at: string | null;
  model: string | null;
  confidence: Record<string, number>;
  values: {
    operating_hours: number | null;
    program: LightingProgram;
    control_mode: string | null;
  };
};

export type LineLightingHistoryEntry = {
  at: string;
  by: string | null;
  event:
    | "auto_populated"
    | "switched_to_manual"
    | "switched_to_automatic"
    | "updated_study_imported"
    | "copied_from_line"
    | "edited";
  note: string | null;
  /** The FULL outgoing state (final + recommended) — nothing ever disappears. */
  previous: unknown;
};

export type LineLightingSetup = {
  schema: 1;
  mode: LineLightingMode;
  final: LineLightingValues;
  recommended: LineLightingRecommendation | null;
  source: { kind: "study" | "manual" | "copy"; copied_from: string | null };
  review: {
    state: "unreviewed" | "confirmed" | "adjusted";
    by: string | null;
    at: string | null;
  };
  audit: {
    created_by: string | null;
    created_at: string | null;
    updated_by: string | null;
    updated_at: string | null;
  };
  history: LineLightingHistoryEntry[];
};

// ---------------------------------------------------------------------------
// Construction / normalization
// ---------------------------------------------------------------------------

function cleanStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function cleanNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function emptyLineValues(): LineLightingValues {
  return {
    operating_hours: null,
    program: [],
    dusk_to_dawn: false,
    autonomous: false,
    control_mode: null,
    controller: { type: null, config: {} },
    factory_instructions: null,
  };
}

export function normalizeLineValues(raw: unknown): LineLightingValues {
  const base = emptyLineValues();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const controller =
    r.controller && typeof r.controller === "object"
      ? (r.controller as Record<string, unknown>)
      : {};
  return {
    operating_hours: cleanNum(r.operating_hours),
    program: normalizeLightingProgram(r.program),
    dusk_to_dawn: r.dusk_to_dawn === true,
    autonomous: r.autonomous === true,
    control_mode: cleanStr(r.control_mode),
    controller: {
      type: cleanStr(controller.type),
      config:
        controller.config && typeof controller.config === "object"
          ? (controller.config as Record<string, unknown>)
          : {},
    },
    factory_instructions: cleanStr(r.factory_instructions),
  };
}

function normalizeRecommendation(raw: unknown): LineLightingRecommendation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const method = r.method === "dialux" ? "dialux" : "energy_study";
  const values =
    r.values && typeof r.values === "object" ? (r.values as Record<string, unknown>) : {};
  const confidence: Record<string, number> = {};
  if (r.confidence && typeof r.confidence === "object") {
    for (const [k, v] of Object.entries(r.confidence as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) confidence[k] = Math.max(0, Math.min(1, n));
    }
  }
  return {
    method,
    source_document: cleanStr(r.source_document),
    extracted_at: cleanStr(r.extracted_at),
    model: cleanStr(r.model),
    confidence,
    values: {
      operating_hours: cleanNum(values.operating_hours),
      program: normalizeLightingProgram(values.program),
      control_mode: cleanStr(values.control_mode),
    },
  };
}

/** Normalize a stored blob; null when there is no usable setup at all. */
export function normalizeLineLighting(raw: unknown): LineLightingSetup | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const review =
    r.review && typeof r.review === "object" ? (r.review as Record<string, unknown>) : {};
  const audit =
    r.audit && typeof r.audit === "object" ? (r.audit as Record<string, unknown>) : {};
  const source =
    r.source && typeof r.source === "object" ? (r.source as Record<string, unknown>) : {};
  return {
    schema: 1,
    mode: r.mode === "manual" ? "manual" : "automatic",
    final: normalizeLineValues(r.final),
    recommended: normalizeRecommendation(r.recommended),
    source: {
      kind: source.kind === "manual" ? "manual" : source.kind === "copy" ? "copy" : "study",
      copied_from: cleanStr(source.copied_from),
    },
    review: {
      state:
        review.state === "confirmed" || review.state === "adjusted"
          ? (review.state as "confirmed" | "adjusted")
          : "unreviewed",
      by: cleanStr(review.by),
      at: cleanStr(review.at),
    },
    audit: {
      created_by: cleanStr(audit.created_by),
      created_at: cleanStr(audit.created_at),
      updated_by: cleanStr(audit.updated_by),
      updated_at: cleanStr(audit.updated_at),
    },
    history: Array.isArray(r.history)
      ? (r.history as LineLightingHistoryEntry[]).slice(0, 100)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Coherence validation (manual + edited-automatic values)
// ---------------------------------------------------------------------------

export type LineLightingValidation = { errors: string[]; warnings: string[] };

export function validateLineValues(v: LineLightingValues): LineLightingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [i, p] of v.program.entries()) {
    if (!(p.output >= 0 && p.output <= 100))
      errors.push(`Stage ${i + 1}: output must be 0–100%.`);
    if (!(p.duration_hours > 0) && !v.dusk_to_dawn)
      errors.push(`Stage ${i + 1}: duration must be positive.`);
  }
  const total = v.program.reduce((s, p) => s + (p.duration_hours || 0), 0);
  if (total > 24) errors.push(`Total programmed duration is ${total}h — a night cannot exceed 24h.`);
  if (
    v.operating_hours != null &&
    v.program.length > 0 &&
    !v.dusk_to_dawn &&
    Math.abs(total - v.operating_hours) > 0.51
  ) {
    warnings.push(
      `Stages sum to ${total}h but operating hours are ${v.operating_hours}h — check the schedule.`
    );
  }
  if (v.program.length === 0 && !v.dusk_to_dawn && v.operating_hours == null) {
    warnings.push("No stages, hours or dusk-to-dawn set yet.");
  }
  return { errors, warnings };
}

/** Does the setup carry any programming content at all? */
export function hasProgrammingContent(s: LineLightingSetup | null): boolean {
  if (!s) return false;
  const f = s.final;
  return (
    f.program.length > 0 ||
    f.operating_hours != null ||
    f.dusk_to_dawn ||
    f.autonomous ||
    f.control_mode != null ||
    f.factory_instructions != null
  );
}

// ---------------------------------------------------------------------------
// Status (drives the ✅ / ⚠ / ❌ / N/A chips AND the release gate)
// ---------------------------------------------------------------------------

export type ProgrammingRequirement = "required" | "optional" | "not_applicable";
export type LineLightingStatus = "complete" | "needs_review" | "missing" | "not_applicable";

export function lineLightingStatus(
  requirement: ProgrammingRequirement,
  setup: LineLightingSetup | null
): LineLightingStatus {
  if (requirement === "not_applicable") return "not_applicable";
  if (!hasProgrammingContent(setup)) return "missing"; // for optional: renders as "—", never gates
  if (setup!.mode === "automatic" && setup!.review.state === "unreviewed") return "needs_review";
  if (validateLineValues(setup!.final).errors.length > 0) return "needs_review";
  return "complete";
}

export const LINE_LIGHTING_STATUS_LABEL: Record<LineLightingStatus, string> = {
  complete: "✅ Complete",
  needs_review: "⚠ Needs review",
  missing: "❌ Missing programming",
  not_applicable: "N/A — not required",
};

// ---------------------------------------------------------------------------
// Transitions — every one archives the outgoing state (nothing disappears)
// ---------------------------------------------------------------------------

function archived(s: LineLightingSetup): unknown {
  return { mode: s.mode, final: s.final, recommended: s.recommended, review: s.review };
}

function withHistory(
  s: LineLightingSetup,
  event: LineLightingHistoryEntry["event"],
  by: string | null,
  now: string,
  note: string | null = null
): LineLightingHistoryEntry[] {
  return [
    { at: now, by, event, note, previous: archived(s) },
    ...s.history,
  ].slice(0, 100);
}

/** Fresh setup populated from a study recommendation (automatic mode). */
export function setupFromRecommendation(
  rec: LineLightingRecommendation,
  by: string | null,
  now: string
): LineLightingSetup {
  return {
    schema: 1,
    mode: "automatic",
    final: {
      ...emptyLineValues(),
      operating_hours: rec.values.operating_hours,
      program: rec.values.program,
      control_mode: rec.values.control_mode,
    },
    recommended: rec,
    source: { kind: "study", copied_from: null },
    review: { state: "unreviewed", by: null, at: null },
    audit: { created_by: by, created_at: now, updated_by: by, updated_at: now },
    history: [],
  };
}

/** Fresh manual setup (no study). */
export function manualSetup(
  values: LineLightingValues,
  by: string | null,
  now: string
): LineLightingSetup {
  return {
    schema: 1,
    mode: "manual",
    final: values,
    recommended: null,
    source: { kind: "manual", copied_from: null },
    review: { state: "confirmed", by, at: now }, // a human typed it — reviewed by definition
    audit: { created_by: by, created_at: now, updated_by: by, updated_at: now },
    history: [],
  };
}

/** Automatic → Manual: keeps the values editable, archives, preserves rec. */
export function switchToManual(
  s: LineLightingSetup,
  by: string | null,
  now: string
): LineLightingSetup {
  return {
    ...s,
    mode: "manual",
    // recommended stays — the study's word remains visible (decision #3).
    review: { state: "confirmed", by, at: now },
    audit: { ...s.audit, updated_by: by, updated_at: now },
    history: withHistory(s, "switched_to_manual", by, now),
  };
}

/** Manual → Automatic: caller MUST have warned the user first. Archives the
 *  manual values, re-populates from the recommendation. */
export function switchToAutomatic(
  s: LineLightingSetup,
  rec: LineLightingRecommendation,
  by: string | null,
  now: string
): LineLightingSetup {
  return {
    ...s,
    mode: "automatic",
    final: {
      ...s.final,
      operating_hours: rec.values.operating_hours,
      program: rec.values.program,
      control_mode: rec.values.control_mode,
    },
    recommended: rec,
    source: { kind: "study", copied_from: null },
    review: { state: "unreviewed", by: null, at: null },
    audit: { ...s.audit, updated_by: by, updated_at: now },
    history: withHistory(s, "switched_to_automatic", by, now),
  };
}

/** Edit the FINAL values (allowed in both modes — automatic is never
 *  read-only). In automatic mode an edit marks the review 'adjusted'. */
export function editedSetup(
  s: LineLightingSetup,
  values: LineLightingValues,
  by: string | null,
  now: string
): LineLightingSetup {
  return {
    ...s,
    final: values,
    review:
      s.mode === "automatic"
        ? { state: "adjusted", by, at: now }
        : { state: "confirmed", by, at: now },
    audit: { ...s.audit, updated_by: by, updated_at: now },
    history: withHistory(s, "edited", by, now),
  };
}

/** Import a NEWER study recommendation (explicit user decision, decision #5). */
export function importUpdatedRecommendation(
  s: LineLightingSetup,
  rec: LineLightingRecommendation,
  by: string | null,
  now: string
): LineLightingSetup {
  return {
    ...s,
    mode: "automatic",
    final: {
      ...s.final,
      operating_hours: rec.values.operating_hours,
      program: rec.values.program,
      control_mode: rec.values.control_mode,
    },
    recommended: rec,
    review: { state: "unreviewed", by: null, at: null },
    audit: { ...s.audit, updated_by: by, updated_at: now },
    history: withHistory(s, "updated_study_imported", by, now),
  };
}

/** One-time COPY onto another line (decision #4 — never a link). */
export function copiedSetup(
  source: LineLightingSetup,
  fromLineLabel: string,
  by: string | null,
  now: string
): LineLightingSetup {
  return {
    schema: 1,
    mode: source.mode,
    final: JSON.parse(JSON.stringify(source.final)),
    recommended: source.recommended
      ? JSON.parse(JSON.stringify(source.recommended))
      : null,
    source: { kind: "copy", copied_from: fromLineLabel },
    review: { state: source.review.state, by, at: now },
    audit: { created_by: by, created_at: now, updated_by: by, updated_at: now },
    history: [
      {
        at: now,
        by,
        event: "copied_from_line",
        note: `Copied from ${fromLineLabel}`,
        previous: null,
      },
    ],
  };
}

/** A newer approved extraction exists than what this line imported? */
export function hasNewerStudy(
  setup: LineLightingSetup | null,
  studyExtractedAt: string | null | undefined
): boolean {
  if (!studyExtractedAt) return false;
  if (!setup?.recommended?.extracted_at) return setup?.mode === "automatic";
  return studyExtractedAt > setup.recommended.extracted_at;
}
