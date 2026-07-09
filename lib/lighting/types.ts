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
  /** Output level as a percentage 0..100 held during this period (the baseline). */
  output: number;
  /** How long that level is held, in hours (e.g. 5, 2). */
  duration_hours: number;
  /**
   * Presence detection (SOLUX autonomous luminaires): when true, during this
   * period the luminaire holds `output`% as a LOW baseline and BOOSTS to
   * `detection_output`% for `detection_hold_seconds` on each motion detection
   * (studies estimate ~`estimated_detections` per night). Absent/false = a plain
   * fixed level. This is essential for manufacturing/controller programming, so
   * it is a first-class part of the program, never flattened away.
   */
  presence_detection?: boolean;
  /** Boost output % reached on each detection (e.g. 100). */
  detection_output?: number | null;
  /** Seconds held at the boost level per detection (e.g. 40). */
  detection_hold_seconds?: number | null;
  /** Estimated detections per night the study assumed (e.g. 80). */
  estimated_detections?: number | null;
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

/** What the optional Auto-fill produced, kept for human review/audit.
 *  `fields` = the Energy-Study extraction; `dialux` = the Dialux extraction
 *  (production configurations). Either half may be absent — the user can run
 *  one assist, both, or neither. */
export type LightingAiProvenance = {
  fields?: {
    lighting_power: number | null;
    operating_hours: number | null;
    lighting_program: LightingProgram;
    /** m159 — tilt angle the Energy Study stated (audit of the auto-fill). */
    tilt_angle?: number | null;
  };
  confidence?: Record<string, number>;
  model?: string;
  extracted_at?: string;
  dialux?: DialuxProvenance;
};

/** The Dialux extraction as persisted for review/transfer to production. */
export type DialuxProvenance = {
  configurations: DialuxConfiguration[];
  model: string;
  extracted_at: string;
};

/** What the Auto-fill extraction returns to the form. */
export type LightingExtraction = {
  lighting_power: number | null;
  operating_hours: number | null;
  lighting_program: LightingProgram;
  /**
   * m159 — Solar panel tilt angle in degrees when the Energy Study states it
   * ("Tilt Angle" / "Panel Tilt" / "PV Tilt" / "inclinaison"). Consumed by the
   * task list's industrial file (auto-fills solar_panel_tilt_angle when the
   * field is still empty — manual override always wins).
   */
  tilt_angle: number | null;
  /** m160 — page of the study where the tilt was read (1-based), when known. */
  tilt_source_page: number | null;
  confidence: Record<string, number>;
  model: string;
};

// ---------------------------------------------------------------------------
// DIALux report extraction (Production-relevant fields only).
// ---------------------------------------------------------------------------
// A DIALux report may hold SEVERAL independent lighting configurations (one per
// area / luminaire type / optic). Each becomes a separate production
// configuration — NEVER merged. The Energy Study stays the source of truth for
// the operating profile / program / battery; DIALux provides mounting height,
// optics, CCT and quantities. Extraction is optional + always user-editable,
// with a per-field confidence score (same contract as the Energy Study).

export type DialuxConfiguration = {
  /** A human label for this config (area/zone/scene/luminaire name), if any. */
  label: string | null;
  /** Luminaire power in watts, if stated for this configuration. */
  power: number | null;
  /** Mounting height (hauteur de feu) in metres. */
  mounting_height: number | null;
  /** Optic code / reference (one of the most important fields). */
  optic_code: string | null;
  /** Lens type, if distinct from the code. */
  optic_lens_type: string | null;
  /** Beam / photometric distribution (e.g. "Type II", "2M", "wide"). */
  optic_beam_distribution: string | null;
  /** Correlated colour temperature in kelvin (e.g. 3000, 4000). */
  cct: number | null;
  /** Number of luminaires in this configuration. */
  quantity: number | null;
  /** Per-field confidence 0..1 (keys: power, mounting_height, optic, cct, quantity). */
  confidence: Record<string, number>;
};

export type DialuxExtraction = {
  configurations: DialuxConfiguration[];
  model: string;
};
