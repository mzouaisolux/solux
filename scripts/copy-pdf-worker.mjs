/**
 * Copy the pdf.js worker into public/ so the browser can fetch it by URL.
 *
 * WHY THIS EXISTS
 * ---------------
 * DocPreview rasterises the first page of a PDF for the affair file list. It
 * used to point pdf.js at its worker with the bundler form:
 *
 *     new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)
 *
 * which asks webpack to pull the worker INTO the bundle. pdfjs-dist v6's
 * worker uses syntax the Next 14 webpack build cannot parse, so `next build`
 * died on it — while `next dev` kept working, which is exactly why it went
 * unnoticed. Every production build was red.
 *
 * Serving the worker as a plain static asset sidesteps the bundler entirely:
 * pdf.js just fetches /pdf.worker.min.mjs at runtime.
 *
 * The copy is GITIGNORED and refreshed on every install and build, so it can
 * never drift from the installed pdfjs-dist version — which a committed copy
 * silently would.
 */

import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const DEST_DIR = join(process.cwd(), "public");
const DEST = join(DEST_DIR, "pdf.worker.min.mjs");

let src;
try {
  // Resolve through the package so the path follows pdfjs-dist's own layout.
  src = join(dirname(require.resolve("pdfjs-dist/package.json")), "build", "pdf.worker.min.mjs");
} catch {
  // Not installed (e.g. a lint-only CI job). PDF thumbnails degrade to the
  // typed placeholder — previews are strictly additive — so don't fail here.
  console.warn("[copy-pdf-worker] pdfjs-dist not installed — skipping.");
  process.exit(0);
}

if (!existsSync(src)) {
  console.warn(`[copy-pdf-worker] worker not found at ${src} — skipping.`);
  process.exit(0);
}

mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(src, DEST);
console.log("[copy-pdf-worker] public/pdf.worker.min.mjs updated.");
