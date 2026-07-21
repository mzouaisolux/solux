/**
 * Historical Invoice Import — PDF text-layer extraction (server-only).
 *
 * Our historical invoices are DIGITAL PDFs (real text layer, not scans), all
 * from the same invoicing software. Extracting the text layer first and sending
 * TEXT to Claude is far cheaper than rendering page images — so this is the
 * primary path. `extract.ts` falls back to sending the PDF itself only when the
 * text layer is too thin (an unexpectedly image-only file).
 *
 * `unpdf` is a pure-JS, serverless-friendly PDF reader (no native deps, no
 * canvas). It is imported DYNAMICALLY so the app builds/boots even before the
 * dependency is installed; the import only runs when an extraction is attempted.
 */

export type PdfText = {
  text: string;
  pages: number;
  /** true when the text layer is rich enough to trust for structured parsing. */
  hasUsableText: boolean;
};

export type PdfTextOptions = {
  /**
   * Prefix each page with a `[[page N]]` marker (1-based) instead of merging
   * the pages into one flat string.
   *
   * The default (false) merges and normalizes form-feeds away, which destroys
   * every page boundary — fine for the invoice import (it never cites a page),
   * but it made the Energy-Study extractor's `tilt_source_page` unanswerable:
   * the model was asked for a page number from input with no page markers, so
   * it could only return null or invent one. Callers that cite a page must
   * opt in. Off by default so the import path keeps its exact prompt input.
   */
  pageMarkers?: boolean;
};

const MIN_USABLE_CHARS = 40;

/** The marker the model is told to cite. Kept in one place so the extractor
 *  prompt and the parser can never drift apart. */
export const PAGE_MARKER_RE = /^\[\[page (\d+)\]\]$/;

export function pageMarker(n: number): string {
  return `[[page ${n}]]`;
}

export async function extractPdfText(
  buffer: Uint8Array | Buffer,
  options: PdfTextOptions = {}
): Promise<PdfText> {
  let mod: any;
  try {
    // @ts-ignore — optional dependency installed by the owner (`npm i unpdf`).
    mod = await import("unpdf");
  } catch {
    throw new Error(
      "PDF reader not installed. Run `npm i unpdf` in ~/dev/facturation (owner step)."
    );
  }

  // pdf.js (via unpdf) explicitly REJECTS a Node Buffer — and a Buffer IS a
  // Uint8Array subclass, so we can't shortcut on `instanceof`. Always copy into
  // a plain, freshly-allocated Uint8Array.
  const src = buffer as Uint8Array;
  const bytes = new Uint8Array(src.byteLength);
  bytes.set(src);
  const pdf = await mod.getDocumentProxy(bytes);
  const wantMarkers = options.pageMarkers === true;
  const { text, totalPages } = await mod.extractText(pdf, {
    mergePages: !wantMarkers,
  });

  let merged: string;
  if (wantMarkers && Array.isArray(text)) {
    merged = text
      .map((p: unknown, i: number) => `${pageMarker(i + 1)}\n${String(p ?? "")}`)
      .join("\n\n");
  } else {
    // mergePages:true still hands back an array on some unpdf versions — and a
    // marker request can land here when it hands back a single string, in which
    // case there are no boundaries to mark and the caller simply gets none.
    merged = Array.isArray(text) ? text.join("\n") : String(text ?? "");
  }
  // Normalize page-break form-feeds to newlines; keep the rest of the layout.
  const cleaned = merged.replace(/\f/g, "\n").trim();

  return {
    text: cleaned,
    pages: typeof totalPages === "number" ? totalPages : 0,
    hasUsableText: cleaned.replace(/\s+/g, "").length >= MIN_USABLE_CHARS,
  };
}
