/**
 * PDF font registration — single source of truth for @react-pdf fonts.
 *
 * The redesigned proforma/quotation PDF uses two paid commercial
 * typefaces. We don't ship the files; the user drops them in
 * `public/fonts/` per the README there.
 *
 * Graceful fallback
 * -----------------
 * If a font file is missing, fontkit logs a warning but continues —
 * any text using that family falls back to Helvetica in the rendered
 * PDF. The app keeps working; the document just looks plainer until
 * the licensed files land. Don't throw here.
 *
 * Idempotency
 * -----------
 * `Font.register` is keyed by `family`, so calling it multiple times
 * with the same family is a no-op. Safe to import this module
 * repeatedly across components.
 *
 * Why a separate file
 * -------------------
 * `@react-pdf/renderer` keeps its font registry as module-level state.
 * Centralising the calls here means:
 *   - one place to add a new weight,
 *   - one place to verify expected filenames,
 *   - the PDF component itself stays focused on layout.
 */

import { Font } from "@react-pdf/renderer";

/** Resolve the absolute URL of a font dropped in `public/fonts/`. */
function fontUrl(filename: string): string {
  // @react-pdf accepts URLs that the browser can fetch. Next.js serves
  // anything in `public/` from the root, so `/fonts/foo.ttf` works in
  // both dev and prod, client- and server-rendered PDF generation.
  return `/fonts/${filename}`;
}

/** Family names used by `StyleSheet.create` calls in the PDF component. */
export const PDF_FONT_FAMILIES = {
  body: "Armin Grotesk",
  title: "Akzidenz Extended",
} as const;

/**
 * Register all fonts. Called once at module load time on the client
 * (where @react-pdf actually runs) via a side-effect import.
 *
 * Weight mapping convention
 * -------------------------
 *   ultraLight  → 200
 *   regular     → 400
 *   semibold    → 600
 *   light       → 300  (title face only)
 *
 * In the PDF stylesheet, write `fontWeight: 200 | 400 | 600` and it
 * picks the right variant. Missing weights silently fall back to the
 * nearest registered weight — so even a single-weight install renders.
 */
export function registerPdfFonts() {
  // Body face — Armin Grotesk in five weights, sourced from the
  // brand fonts pack (SLX I Brand Fonts 2024). Files are OTF; @react-pdf
  // / fontkit handles OTF natively. Black is used for emphasis where
  // SemiBold isn't punchy enough (e.g. the quotation reference in the
  // document title).
  Font.register({
    family: PDF_FONT_FAMILIES.body,
    fonts: [
      // ⚠ Each (family, weight) MUST use a UNIQUE file URL. @react-pdf keys its
      // font cache by `src`, so two weights pointing at the SAME file collapse
      // and one weight becomes unresolvable ("Could not resolve font … fontWeight
      // 200"). Two problems were fixed here (2026-06-30):
      //   1. ArminGrotesk-UltraLight.otf cannot be parsed by the browser's
      //      @react-pdf/fontkit (Node parses it fine) → it's excluded entirely.
      //   2. Weight 200 (the body default, used on EVERY PDF) must keep a
      //      distinct, parseable file. Weight 100 is unused by any PDF, so the
      //      ultralight body (200) is backed by Thin.otf — the lightest parseable
      //      face, a close match to the intended UltraLight.
      // ⚠ Owner: once the REAL licensed UltraLight + Akzidenz files are dropped
      // in public/fonts (distinct, valid), restore 200→UltraLight and the title.
      { src: fontUrl("ArminGrotesk-Thin.otf"), fontWeight: 200 },
      { src: fontUrl("ArminGrotesk-Regular.otf"), fontWeight: 400 },
      { src: fontUrl("ArminGrotesk-SemiBold.otf"), fontWeight: 600 },
      { src: fontUrl("ArminGrotesk-Black.otf"), fontWeight: 900 },
      // ⚠ Italic variants are REQUIRED, not optional. @react-pdf/font resolves
      // strictly by fontStyle with NO italic→normal fallback: any text with
      // `fontStyle: "italic"` and no matching italic face throws "Could not
      // resolve font … fontWeight N" and aborts the ENTIRE PDF. The Factory PDF
      // uses italic for warnings + factory-mapping hints (weight 200), so the
      // lighter weights nearest-match down to the regular italic below.
      { src: fontUrl("ArminGrotesk-Italic.otf"), fontWeight: 400, fontStyle: "italic" },
      { src: fontUrl("ArminGrotesk-BlackItalic.otf"), fontWeight: 900, fontStyle: "italic" },
    ],
  });

  // Title face — Akzidenz-Grotesk BQ Light Extended (single weight).
  // The brand pack filename (no "BQ" in the name on disk) is mapped
  // here. The family alias stays "Akzidenz Extended" so the stylesheet
  // doesn't need to know about the filename.
  Font.register({
    family: PDF_FONT_FAMILIES.title,
    fonts: [
      {
        // AkzidenzGrotesk-LightExtended.otf is a byte-identical DUPLICATE of
        // the unparseable ArminGrotesk-UltraLight.otf, so it can't back the
        // title. Use the distinct, otherwise-unused Armin_Grotesk_Normal.otf —
        // a UNIQUE src that collides with none of the body weights above (a
        // shared src would collapse and drop a weight). Until the real
        // Akzidenz-Grotesk BQ Light Extended file is supplied, this keeps the
        // title rendering.
        src: fontUrl("Armin_Grotesk_Normal.otf"),
        fontWeight: 300,
      },
    ],
  });

  // Tell fontkit to be lenient about hyphenation so long product
  // descriptions don't blow up the layout when a word doesn't fit
  // a column. Defaults break on every character which looks broken.
  Font.registerHyphenationCallback((word) => [word]);
}

/**
 * Re-export for places that just want to know the family names without
 * pulling in the side-effect. Useful when constructing dynamic styles.
 */
export const PDF_FONT_FAMILY = PDF_FONT_FAMILIES;
