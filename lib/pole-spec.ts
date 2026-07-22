/**
 * POLE MANUFACTURING SPEC (m181) — pure vocabulary + normalizer.
 *
 * Cost-impacting pole options captured at Service-Request time (owner spec
 * 2026-07-22): Operations must receive the complete pole configuration from
 * the FIRST submission — surface treatment class, galvanization, finish and
 * colour drive the manufacturing cost and previously lived nowhere (only
 * height / arm / free-text notes existed).
 *
 * Stored as ONE jsonb blob (`project_requests.pole_spec`) and carried into
 * the generated quotation's pole line NAME via formatPoleSpec(), so the spec
 * survives quotation → proforma → task list → factory export exactly like
 * the m135 height/arm convention.
 *
 * Client + server safe (no DB access).
 */

export const SURFACE_TREATMENTS = ["", "C3", "C4", "C5", "C5M"] as const;
export type SurfaceTreatment = (typeof SURFACE_TREATMENTS)[number];

export const SURFACE_TREATMENT_LABELS: Record<Exclude<SurfaceTreatment, "">, string> = {
  C3: "C3 — medium corrosivity",
  C4: "C4 — high corrosivity",
  C5: "C5 — very high corrosivity",
  C5M: "C5-M — marine",
};

export const POLE_FINISHES = [
  "",
  "hot_dip_galvanized",
  "galvanized_powder_coated",
  "galvanized_painted",
  "powder_coated",
  "painted",
] as const;
export type PoleFinish = (typeof POLE_FINISHES)[number];

export const POLE_FINISH_LABELS: Record<Exclude<PoleFinish, "">, string> = {
  hot_dip_galvanized: "Hot-dip galvanized (raw)",
  galvanized_powder_coated: "Hot-dip galvanized + powder coated",
  galvanized_painted: "Hot-dip galvanized + painted",
  powder_coated: "Powder coated only",
  painted: "Painted only",
};

export type PoleColourMode = "" | "standard" | "custom";

export type PoleSpec = {
  surface_treatment: SurfaceTreatment;
  finish: PoleFinish;
  colour_mode: PoleColourMode;
  /** RAL code / free colour text — meaningful for both modes. */
  colour: string | null;
};

export function emptyPoleSpec(): PoleSpec {
  return { surface_treatment: "", finish: "", colour_mode: "", colour: null };
}

function cleanStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Normalize a stored blob — unknown values fall back to unset, never crash. */
export function normalizePoleSpec(raw: unknown): PoleSpec {
  const base = emptyPoleSpec();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  return {
    surface_treatment: (SURFACE_TREATMENTS as readonly string[]).includes(String(r.surface_treatment))
      ? (r.surface_treatment as SurfaceTreatment)
      : "",
    finish: (POLE_FINISHES as readonly string[]).includes(String(r.finish))
      ? (r.finish as PoleFinish)
      : "",
    colour_mode:
      r.colour_mode === "standard" || r.colour_mode === "custom" ? r.colour_mode : "",
    colour: cleanStr(r.colour),
  };
}

/** Anything cost-impacting actually set? (Drives display + summaries.) */
export function poleSpecHasContent(s: PoleSpec): boolean {
  return s.surface_treatment !== "" || s.finish !== "" || s.colour != null;
}

/**
 * One-line human/factory summary — rides the pole line name and the
 * original-sales-request block, e.g.:
 *   "C4 · hot-dip galvanized + powder coated · RAL 7016 (custom)"
 */
export function formatPoleSpec(s: PoleSpec): string {
  const bits: string[] = [];
  if (s.surface_treatment) bits.push(s.surface_treatment);
  if (s.finish) bits.push(POLE_FINISH_LABELS[s.finish].toLowerCase());
  if (s.colour) bits.push(`${s.colour}${s.colour_mode === "custom" ? " (custom colour)" : ""}`);
  return bits.join(" · ");
}
