/**
 * Product Lighting Setup — pure validation + program normalization.
 *
 * The SINGLE computation source for the "is the lighting setup complete?" gate
 * and for coercing the dimming program into its structured shape. Pure (no DB,
 * no I/O) so it is unit-testable end-to-end and can run identically on the
 * client (to enable/disable the launch button) and on the server (the real
 * gate inside launchProduction — defense in depth).
 */

import type {
  LightingProgram,
  LightingProgramPeriod,
  LightingSetupInput,
} from "./types.ts";

/** The exact user-facing message required by the owner spec when the gate fails. */
export const LIGHTING_INCOMPLETE_MESSAGE =
  "Product Lighting Setup is incomplete. Please complete the lighting configuration before launching production.";

export type LightingField =
  | "energy_study"
  | "lighting_power"
  | "lighting_program"
  | "operating_hours"
  | "approved_optics";

export const LIGHTING_FIELD_LABEL: Record<LightingField, string> = {
  energy_study: "Energy Study",
  lighting_power: "Lighting Power",
  lighting_program: "Lighting Program",
  operating_hours: "Operating Hours",
  approved_optics: "Approved Optics",
};

export type LightingValidation = {
  ok: boolean;
  /** Which required fields are still missing (empty when ok). */
  missing: LightingField[];
};

/** A finite, strictly-positive number? (used for power / hours / program values) */
function isPositiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Coerce arbitrary input (JSON from the DB, a form payload, or an AI result)
 * into a clean LightingProgram. Drops malformed entries, clamps output to
 * 0..100, keeps order. Never throws — safe on any input.
 */
export function normalizeLightingProgram(raw: unknown): LightingProgram {
  if (!Array.isArray(raw)) return [];
  const out: LightingProgram = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const outputNum = toNum(rec.output);
    const durNum = toNum(rec.duration_hours ?? (rec as any).duration ?? (rec as any).hours);
    if (outputNum == null || durNum == null) continue;
    const period: LightingProgramPeriod = {
      output: clamp(outputNum, 0, 100),
      duration_hours: durNum,
    };
    // Preserve presence-detection metadata (SOLUX detector phases) — kept as a
    // first-class part of the program so it is never silently flattened.
    const detOutput = toNum(rec.detection_output);
    const hasDetection = rec.presence_detection === true || detOutput != null;
    if (hasDetection) {
      period.presence_detection = true;
      period.detection_output = detOutput == null ? 100 : clamp(detOutput, 0, 100);
      period.detection_hold_seconds = toNum(rec.detection_hold_seconds);
      period.estimated_detections = toNum(rec.estimated_detections);
    }
    out.push(period);
  }
  return out;
}

/** A program is "complete" when it has ≥1 period with a positive duration. */
export function isLightingProgramComplete(program: LightingProgram): boolean {
  return (
    program.length > 0 &&
    program.every(
      (p) =>
        typeof p.output === "number" &&
        Number.isFinite(p.output) &&
        p.output >= 0 &&
        p.output <= 100 &&
        isPositiveNumber(p.duration_hours)
    )
  );
}

/**
 * The completeness rule. Required: Lighting Power, Lighting Program, Approved
 * Optics, Operating Hours (drives battery sizing / the factory profile).
 *
 * Technical documents are NOT required (owner rule 2026-07-05, supersedes the
 * original Energy-Study-required spec): some projects create a production
 * configuration directly, with no Energy Study nor Dialux — "l'analyse IA doit
 * être une aide, jamais une obligation". Both workflows must be first-class:
 *   assisted: upload → analyze → validate → production
 *   manual:   direct entry → production
 */
export function validateLightingSetup(
  input: LightingSetupInput
): LightingValidation {
  const missing: LightingField[] = [];

  if (!isPositiveNumber(input.lighting_power)) {
    missing.push("lighting_power");
  }
  if (!isLightingProgramComplete(normalizeLightingProgram(input.lighting_program))) {
    missing.push("lighting_program");
  }
  if (!isPositiveNumber(input.operating_hours)) {
    missing.push("operating_hours");
  }
  if (!input.approved_optics || !input.approved_optics.trim()) {
    missing.push("approved_optics");
  }

  return { ok: missing.length === 0, missing };
}

/** Total programmed hours — handy summary for the read-only card. */
export function totalProgramHours(program: LightingProgram): number {
  return normalizeLightingProgram(program).reduce(
    (sum, p) => sum + (Number.isFinite(p.duration_hours) ? p.duration_hours : 0),
    0
  );
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
