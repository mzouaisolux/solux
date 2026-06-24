// =====================================================================
// Canonical filename for every GENERATED PDF.
//
// Format:  TYPE_NUMBER_CLIENT_AFFAIR[_Vn].pdf
//   e.g.   QUOTATION_Q-2026-001_TECHLIGHT_VICTORIA_PARK.pdf
//          PROFORMA_PF-2026-008_TECHLIGHT_VICTORIA_PARK.pdf
//          QUOTATION_Q-2026-001_TECHLIGHT_VICTORIA_PARK_V2.pdf
//
// PURE + unit-tested (tests/pdf-filename.test.ts) — no I/O. Sanitized for
// Windows AND macOS filesystems: ASCII-folded, uppercased, illegal chars
// removed, Windows reserved device names guarded, length-capped. Only the
// GENERATED PDFs use this — uploaded attachments keep their original name.
// =====================================================================

export type PdfKind = "quotation" | "proforma" | "factory" | "commercial_invoice";

const KIND_LABEL: Record<PdfKind, string> = {
  quotation: "QUOTATION",
  proforma: "PROFORMA",
  factory: "FACTORY",
  commercial_invoice: "COMMERCIAL_INVOICE",
};

// Windows reserved device names (case-insensitive) — illegal as a filename base.
const RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

const MAX_PART = 40;
const MAX_STEM = 150;

/** Strip diacritics so accents fold to plain ASCII (é→E, ü→U, ñ→N). */
function deaccent(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/**
 * Sanitize ONE filename segment: ASCII-fold → UPPERCASE → keep only A-Z, 0-9
 * and hyphen (so a number like "Q-2026-001" survives intact); every other
 * character (spaces, accents-residue, and the Windows-illegal set
 * `< > : " / \ | ? *`, plus control chars) becomes "_". Repeats are collapsed,
 * separators trimmed, and the result capped at `max`.
 */
export function sanitizePart(raw: string | null | undefined, max = MAX_PART): string {
  let out = deaccent(String(raw ?? "")).toUpperCase().replace(/[^A-Z0-9-]+/g, "_");
  out = out.replace(/_+/g, "_").replace(/-+/g, "-").replace(/^[_-]+|[_-]+$/g, "");
  if (out.length > max) out = out.slice(0, max).replace(/[_-]+$/g, "");
  return out;
}

export type PdfNameParts = {
  kind: PdfKind;
  /** The REAL document number, e.g. "Q-2026-001" / "PF-2026-008" / "CI-0001". */
  number?: string | null;
  /** Client company name. */
  client?: string | null;
  /** Affair / project name. */
  affair?: string | null;
  /** Version — emits a `_V{n}` suffix only when > 1. */
  version?: number | null;
};

/**
 * Build the canonical PDF filename. Missing parts are skipped (never emits
 * "UNDEFINED"); an entirely empty result falls back to "DOCUMENT.pdf".
 */
export function buildPdfFilename(parts: PdfNameParts): string {
  const segs: string[] = [KIND_LABEL[parts.kind]];
  for (const p of [parts.number, parts.client, parts.affair]) {
    const s = sanitizePart(p);
    if (s) segs.push(s);
  }
  if (parts.version && parts.version > 1) segs.push(`V${parts.version}`);

  let stem = segs.join("_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (RESERVED.has(stem.toUpperCase())) stem = `${stem}_FILE`;
  if (stem.length > MAX_STEM) stem = stem.slice(0, MAX_STEM).replace(/_+$/g, "");
  if (!stem) stem = "DOCUMENT";
  return `${stem}.pdf`;
}
