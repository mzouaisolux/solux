// =====================================================================
// Custom pole (mât) — a project-specific, NON-catalogue quotation line.
//
// Owner req 2026-07-03: a rep creating a quote directly must be able to add a
// custom pole with a few commercial parameters (height, arm, thickness,
// treatment, painting, price) WITHOUT going through the product catalogue and
// WITHOUT the full production configuration. It is a manual quotation line,
// not a catalogue product.
//
// Storage — reuses the existing document_lines shape, ZERO migration:
//   • product_id = null, category_id = null  → a free-text / manual line
//     (already exempt from the mandatory-catalogue-model rule).
//   • client_product_name = the human, client-facing description (so it shows
//     as the primary line on the page + PDF via the existing free-text promo).
//   • config_values = { line_type: "custom_pole", pole_spec: <JSON> } — the
//     structured spec, so the line reloads into the editor. The single JSON
//     key keeps config rendering guardable (see isCustomPoleLine): pole lines
//     never spill raw metadata into the customer PDF.
//   • pricing_mode / pricing_source = "manual" → the price is sales-entered
//     and never recomputed from a catalogue tier.
//
// Pure + dependency-free so the client card and any server logic agree.
// =====================================================================

export const POLE_LINE_TYPE = "custom_pole";

export type HeightReference = "total_pole_height" | "light_point_height";
export type ArmType = "no_arm" | "single_arm" | "double_arm";
export type SurfaceTreatment = "hot_dip_galvanized" | "c3" | "c4" | "c5" | "other";

export type PoleSpec = {
  heightReference: HeightReference;
  totalPoleHeightM: number | null;
  lightPointHeightM: number | null;
  armType: ArmType;
  armLengthM: number | null;
  thicknessMm: number | null;
  surfaceTreatment: SurfaceTreatment | null;
  painting: boolean;
  ralColor: string | null;
  note: string | null;
};

export const HEIGHT_REFERENCE_OPTIONS: { value: HeightReference; label: string }[] = [
  { value: "total_pole_height", label: "Total pole height" },
  { value: "light_point_height", label: "Light point height" },
];
export const ARM_TYPE_OPTIONS: { value: ArmType; label: string }[] = [
  { value: "no_arm", label: "No arm" },
  { value: "single_arm", label: "Single arm" },
  { value: "double_arm", label: "Double arm" },
];
export const SURFACE_TREATMENT_OPTIONS: { value: SurfaceTreatment; label: string }[] = [
  { value: "hot_dip_galvanized", label: "Hot-dip galvanized" },
  { value: "c3", label: "C3" },
  { value: "c4", label: "C4" },
  { value: "c5", label: "C5" },
  { value: "other", label: "Other / Custom" },
];

export function emptyPoleSpec(): PoleSpec {
  return {
    heightReference: "total_pole_height",
    totalPoleHeightM: null,
    lightPointHeightM: null,
    armType: "single_arm",
    armLengthM: null,
    thicknessMm: null,
    surfaceTreatment: "hot_dip_galvanized",
    painting: false,
    ralColor: null,
    note: null,
  };
}

/** True when a quotation line is a custom pole (discriminator in config_values). */
export function isCustomPoleLine(
  line: { config_values?: Record<string, unknown> | null } | null | undefined
): boolean {
  return isCustomPoleConfig(line?.config_values ?? null);
}

/** True when a raw config_values blob belongs to a custom pole line. */
export function isCustomPoleConfig(
  cv: Record<string, unknown> | null | undefined
): boolean {
  return !!cv && (cv as any).line_type === POLE_LINE_TYPE;
}

/** Serialize a spec into the config_values shape stored on the line. */
export function poleSpecToConfigValues(spec: PoleSpec): Record<string, string> {
  return { line_type: POLE_LINE_TYPE, pole_spec: JSON.stringify(spec) };
}

/** Rebuild a spec from a stored line's config_values (null if not a pole). */
export function poleSpecFromConfigValues(
  cv: Record<string, unknown> | null | undefined
): PoleSpec | null {
  if (!isCustomPoleConfig(cv)) return null;
  try {
    const raw = JSON.parse(String((cv as any).pole_spec ?? "{}"));
    return { ...emptyPoleSpec(), ...raw };
  } catch {
    return emptyPoleSpec();
  }
}

const HEIGHT_LABEL: Record<HeightReference, string> = {
  total_pole_height: "total pole height",
  light_point_height: "light point height",
};

function treatmentPhrase(t: SurfaceTreatment | null): string | null {
  switch (t) {
    case "hot_dip_galvanized":
      return "hot-dip galvanized";
    case "c3":
    case "c4":
    case "c5":
      return `${t.toUpperCase()} treatment`;
    case "other":
      return "custom treatment";
    default:
      return null;
  }
}

const armWord: Record<ArmType, string> = {
  no_arm: "no arm",
  single_arm: "single arm",
  double_arm: "double arm",
};

/** Trim trailing zeros: 1.5 → "1.5", 8 → "8". */
function n(v: number): string {
  return String(Number(v));
}

/**
 * Client-facing description, e.g.
 *   "Custom pole – total pole height 8m, single arm, arm length 1.5m,
 *    thickness 4mm, hot-dip galvanized, painting included"
 * The chosen height reference leads; the other height is appended when set.
 */
export function buildPoleDescription(spec: PoleSpec): string {
  const parts: string[] = [];

  // Heights — chosen reference first, the other one after if provided.
  const ordered: HeightReference[] =
    spec.heightReference === "light_point_height"
      ? ["light_point_height", "total_pole_height"]
      : ["total_pole_height", "light_point_height"];
  for (const ref of ordered) {
    const v =
      ref === "total_pole_height" ? spec.totalPoleHeightM : spec.lightPointHeightM;
    if (v != null && v > 0) parts.push(`${HEIGHT_LABEL[ref]} ${n(v)}m`);
  }

  parts.push(armWord[spec.armType]);
  if (spec.armType !== "no_arm" && spec.armLengthM != null && spec.armLengthM > 0) {
    parts.push(`arm length ${n(spec.armLengthM)}m`);
  }
  if (spec.thicknessMm != null && spec.thicknessMm > 0) {
    parts.push(`thickness ${n(spec.thicknessMm)}mm`);
  }
  const treat = treatmentPhrase(spec.surfaceTreatment);
  if (treat) parts.push(treat);
  parts.push(
    spec.painting
      ? spec.ralColor && spec.ralColor.trim()
        ? `painting included (${spec.ralColor.trim()})`
        : "painting included"
      : "no painting"
  );

  return `Custom pole – ${parts.join(", ")}`;
}

/**
 * Spec-level validation (heights). Returns an error string or null.
 * Rule: at least ONE height must be entered — never block on knowing both.
 * Quantity + unit price are line-level and validated by the form.
 */
export function validatePoleSpec(spec: PoleSpec): string | null {
  const hasHeight =
    (spec.totalPoleHeightM != null && spec.totalPoleHeightM > 0) ||
    (spec.lightPointHeightM != null && spec.lightPointHeightM > 0);
  if (!hasHeight) {
    return "Enter at least one height — the total pole height or the light point height.";
  }
  return null;
}
