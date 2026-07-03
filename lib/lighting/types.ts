/**
 * Product Lighting Setup — shared pure types + vocabulary.
 *
 * Client + server safe (no DB access). This is the SINGLE source of truth for
 * the lighting-program shape so every future consumer (controller programming,
 * factory sheets, QR codes, commissioning, QC, Digital Product Passport,
 * installation docs) reads the same structured schedule — never free text.
 */

/** One dimming period in the lighting program: hold `output`% for `duration_hours`. */
export type LightingProgramPeriod = {
  /** Output level as a percentage 0..100 (e.g. 100, 70, 50). */
  output: number;
  /** How long that level is held, in hours (e.g. 5, 2). */
  duration_hours: number;
};

/** The ordered dimming schedule. Any number of periods; order is meaningful. */
export type LightingProgram = LightingProgramPeriod[];

/**
 * Approved optic presets (owner spec). The field also accepts free text for
 * custom projects (stored verbatim), so the UI offers these as suggestions,
 * not a closed list — future work can additionally source the product's own
 * available optics from the catalog.
 */
export const OPTIC_PRESETS: readonly string[] = [
  "Type II",
  "Type III",
  "Type IV",
  "Type V",
  "Pedestrian",
  "Asymmetric",
  "Custom",
] as const;

/** The editable configuration a user submits from the setup form. */
export type LightingSetupInput = {
  lighting_power: number | null;
  operating_hours: number | null;
  lighting_program: LightingProgram;
  approved_optics: string | null;
  energy_study_path: string | null;
  energy_study_name?: string | null;
  dialux_path?: string | null;
  dialux_name?: string | null;
};

/** A persisted row from product_lighting_setups. */
export type LightingSetupRow = {
  id: string;
  document_id: string;
  affair_id: string | null;
  client_id: string | null;
  lighting_power: number | null;
  operating_hours: number | null;
  lighting_program: LightingProgram;
  approved_optics: string | null;
  energy_study_path: string | null;
  energy_study_name: string | null;
  dialux_path: string | null;
  dialux_name: string | null;
  ai_extracted: LightingAiProvenance | null;
  created_at: string;
};

/** What the optional Auto-fill produced, kept for human review/audit. */
export type LightingAiProvenance = {
  fields: {
    lighting_power: number | null;
    operating_hours: number | null;
    lighting_program: LightingProgram;
  };
  confidence: Record<string, number>;
  model: string;
  extracted_at: string;
};

/** What the Auto-fill extraction returns to the form. */
export type LightingExtraction = {
  lighting_power: number | null;
  operating_hours: number | null;
  lighting_program: LightingProgram;
  confidence: Record<string, number>;
  model: string;
};
