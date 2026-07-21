/**
 * Copy the pdf.js worker into public/ so the browser fetches it by URL.
 *
 * WHY THIS EXISTS (root cause, reproduced & verified 2026-07-21)
 * --------------------------------------------------------------
 * DocPreview (components/affairs/DocPreview.tsx) rasterises PDF first pages
 * for the affair file list. It used to point pdf.js at its worker with the
 * bundler form:
 *
 *     new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)
 *
 * webpack emits that reference as a RAW ASSET (static/media/pdf.worker.min
 * .<hash>.mjs). Next 14's minify plugin then parses emitted .mjs assets in
 * SCRIPT mode — and the pdfjs-dist v6 worker is pure ESM, so minification
 * dies on its module syntax:
 *
 *     static/media/pdf.worker.min.cd6fc86d.mjs from Terser
 *       x 'import.meta' cannot be used outside of module code.
 *       x 'import', and 'export' cannot be used outside of module code
 *
 * Dev never minifies, so `next dev` always worked while every production
 * build failed. The legacy build ships the same ESM shape (verified:
 * `export{...}` + import.meta) and fails identically, so downgrading is not
 * a fix. Serving the worker as a plain static file keeps the bundler out of
 * the worker entirely — which is pdf.js's own documented deployment model
 * (GlobalWorkerOptions.workerSrc = a URL your site serves).
 *
 * The copy is GITIGNORED and refreshed on postinstall + predev + prebuild,
 * so it can never drift from the installed pdfjs-dist version — the API and
 * worker versions must match exactly, which a committed copy would silently
 * break on upgrade. On Vercel both hooks fire (`npm ci` → postinstall,
 * `npm run build` → prebuild), so the file exists in every deployment.
 *
 * pdfjs-dist is PINNED to an exact version in package.json: the main
 * library (pdf.min.mjs) IS bundled and minified by webpack, so a silently
 * newer 6.x with newer syntax could break the build again on npm update.
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
  // Package not installed at all (e.g. a lint-only CI job with pruned deps).
  // PDF thumbnails are additive — don't fail such environments.
  console.warn("[copy-pdf-worker] pdfjs-dist not installed — skipping.");
  process.exit(0);
}

if (!existsSync(src)) {
  // The package IS installed but the worker moved — a pdfjs packaging change.
  // Failing the build here is deliberate: shipping without the worker would
  // 404 at runtime and silently degrade every PDF thumbnail.
  console.error(
    `[copy-pdf-worker] pdfjs-dist is installed but ${src} does not exist — ` +
      "the package layout changed. Update scripts/copy-pdf-worker.mjs (and " +
      "the workerSrc in components/affairs/DocPreview.tsx) for the new layout."
  );
  process.exit(1);
}

mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(src, DEST);
console.log("[copy-pdf-worker] public/pdf.worker.min.mjs updated.");
