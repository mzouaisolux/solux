/**
 * Appendix merger — assembles the final Production Dossier:
 *
 *     [ @react-pdf dossier ]  +  [ separator A1 | file A1 pages ]  +  …
 *
 * pdf-lib only (no DOM APIs), so this module runs in the browser (the export
 * buttons) AND under node --test. Uploaded PDFs are copied page-by-page;
 * uploaded PNG/JPEG images become full-size A4 pages (image embedded at its
 * NATIVE resolution — drawing size only affects layout, never pixel data, so
 * quality is preserved). Files that can't be embedded were already labelled
 * "provided separately" by the appendix plan and are skipped here.
 *
 * Separator pages use standard Helvetica, which only encodes WinAnsi (Latin):
 * all drawn text is ASCII-folded (lib/production-dossier). The bilingual
 * appendix INDEX lives inside the @react-pdf part where Noto Sans SC is
 * available — the separators just carry the reference + filename.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
// Relative import (not "@/…") so this module also loads under `node --test`.
import { asciiForSeparator, type AppendixItem } from "./production-dossier.ts";

/** A planned appendix item with its downloaded bytes. */
export type AppendixPayload = AppendixItem & {
  bytes: ArrayBuffer | Uint8Array;
};

const A4 = { width: 595.28, height: 841.89 } as const;
const MARGIN = 34; // matches the dossier's 1.2 cm page margin

const INK = rgb(0, 0, 0);
const MUTED = rgb(0.32, 0.32, 0.32);
const HAIR = rgb(0.86, 0.87, 0.88);

/**
 * Merge the rendered dossier with its appendix files. Items whose kind is
 * "external" (or that fail to parse — corrupt upload, wrong extension) are
 * skipped and reported in `skipped` so the caller can surface them; the
 * dossier itself is never lost to a bad attachment.
 */
/**
 * Concatenate several PDFs into one, no base dossier and no separator pages —
 * used to bundle the selected datasheets into a single "datasheets" attachment
 * (Change 2). Each source keeps its own pages/branding. A source that fails to
 * parse is skipped and reported, never aborting the bundle.
 */
export async function mergePdfs(
  items: { bytes: ArrayBuffer | Uint8Array; label?: string | null }[]
): Promise<{ bytes: Uint8Array; embedded: string[]; skipped: string[] }> {
  const out = await PDFDocument.create();
  const embedded: string[] = [];
  const skipped: string[] = [];
  for (const item of items) {
    try {
      const src = await PDFDocument.load(item.bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      embedded.push(item.label ?? "");
    } catch {
      skipped.push(item.label ?? "");
    }
  }
  const bytes = await out.save();
  return { bytes, embedded, skipped };
}

export async function mergeDossierWithAppendix(
  dossierBytes: ArrayBuffer | Uint8Array,
  items: AppendixPayload[],
  /** Options. `separators` (default true) inserts a labelled A4 page before
   *  each appended file — the Production Dossier wants them; the quotation
   *  package (branded datasheets that carry their own header) does not. */
  opts: { separators?: boolean } = {}
): Promise<{ bytes: Uint8Array; embedded: string[]; skipped: string[] }> {
  const withSeparators = opts.separators !== false;
  const out = await PDFDocument.load(dossierBytes);
  const helv = await out.embedFont(StandardFonts.Helvetica);
  const helvBold = await out.embedFont(StandardFonts.HelveticaBold);

  const embedded: string[] = [];
  const skipped: string[] = [];

  const drawSeparator = (item: AppendixPayload) => {
    const page = out.addPage([A4.width, A4.height]);
    const midY = A4.height / 2 + 60;
    page.drawLine({
      start: { x: MARGIN, y: midY + 46 },
      end: { x: A4.width - MARGIN, y: midY + 46 },
      thickness: 1,
      color: INK,
    });
    page.drawText("APPENDIX", {
      x: MARGIN,
      y: midY + 20,
      size: 11,
      font: helv,
      color: MUTED,
    });
    page.drawText(item.label ?? "", {
      x: MARGIN,
      y: midY - 22,
      size: 40,
      font: helvBold,
      color: INK,
    });
    page.drawText(asciiForSeparator(item.type_label), {
      x: MARGIN,
      y: midY - 46,
      size: 11,
      font: helv,
      color: INK,
    });
    page.drawText(asciiForSeparator(item.file_name), {
      x: MARGIN,
      y: midY - 64,
      size: 9,
      font: helv,
      color: MUTED,
    });
    if (item.note) {
      page.drawText(asciiForSeparator(item.note).slice(0, 120), {
        x: MARGIN,
        y: midY - 80,
        size: 8,
        font: helv,
        color: MUTED,
      });
    }
    page.drawLine({
      start: { x: MARGIN, y: midY - 96 },
      end: { x: A4.width - MARGIN, y: midY - 96 },
      thickness: 0.5,
      color: HAIR,
    });
  };

  for (const item of items) {
    if (item.kind === "external" || !item.label) continue;
    try {
      if (item.kind === "pdf") {
        const src = await PDFDocument.load(item.bytes, {
          ignoreEncryption: true,
        });
        const pages = await out.copyPages(src, src.getPageIndices());
        if (withSeparators) drawSeparator(item);
        for (const p of pages) out.addPage(p);
      } else {
        // image — embed at native resolution, draw fitted to the page frame
        // (no thumbnails: the image fills the printable area, aspect kept).
        const bytes =
          item.bytes instanceof Uint8Array
            ? item.bytes
            : new Uint8Array(item.bytes);
        const isPng =
          bytes.length > 8 &&
          bytes[0] === 0x89 &&
          bytes[1] === 0x50 &&
          bytes[2] === 0x4e &&
          bytes[3] === 0x47;
        const img = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        if (withSeparators) drawSeparator(item);
        const page = out.addPage([A4.width, A4.height]);
        const frameW = A4.width - MARGIN * 2;
        const frameH = A4.height - MARGIN * 2 - 24; // caption strip at bottom
        const scale = Math.min(frameW / img.width, frameH / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, {
          x: (A4.width - w) / 2,
          y: MARGIN + 24 + (frameH - h) / 2,
          width: w,
          height: h,
        });
        page.drawText(
          `${item.label} — ${asciiForSeparator(item.file_name)}`,
          {
            x: MARGIN,
            y: MARGIN + 6,
            size: 8,
            font: helv,
            color: MUTED,
          }
        );
      }
      embedded.push(item.file_name);
    } catch {
      // Corrupt / mislabelled file — keep the dossier, report the miss.
      skipped.push(item.file_name);
    }
  }

  // Global page numbers over the WHOLE package (dossier + appendix) — the
  // @react-pdf footer deliberately carries none (it can't know the appendix
  // length). Bottom-right, Helvetica, tolerant of odd appendix page sizes.
  const pages = out.getPages();
  const total = pages.length;
  pages.forEach((page, i) => {
    try {
      const label = `${i + 1} / ${total}`;
      page.drawText(label, {
        x: page.getWidth() - MARGIN - helv.widthOfTextAtSize(label, 7.5),
        y: 8,
        size: 7.5,
        font: helv,
        color: MUTED,
      });
    } catch {
      // Never lose the dossier to a page-numbering quirk.
    }
  });

  return { bytes: await out.save(), embedded, skipped };
}
