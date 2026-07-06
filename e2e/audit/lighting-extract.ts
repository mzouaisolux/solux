// =====================================================================
// LIGHTING EXTRACTION EVAL — run the AI parsers against a real study PDF.
//
// The owner sends real Energy Studies / DIALux reports to harden the
// parsers (lib/lighting/extract-energy-study.ts + extract-dialux.ts).
// This tool runs one or both extractors on a local PDF and prints the
// structured result for comparison against the document (ground truth).
//
// Usage (from ~/dev/facturation; needs ANTHROPIC_API_KEY in .env.local):
//   node --env-file=.env.local --experimental-strip-types \
//     e2e/audit/lighting-extract.ts <path-to.pdf> [energy|dialux|both]
//
// Notes:
//   - macOS sandboxes some folders (e.g. Mail Downloads) — EPERM there;
//     ask for the file on the Desktop or uploaded into the app instead.
//   - Calibrated so far on: "SSLX Pro 6K" (energy, presence detector),
//     "ECLAIRAGE GLAZOUE LOGOZOHE" (DIALux FR, Optique T1, no qty),
//     "Penessoulou Semere QGMI" (combined doc, 2 design versions, T35,
//     no false presence detection from boilerplate).
// =====================================================================

import fs from "node:fs";
import { extractDialux } from "../../lib/lighting/extract-dialux.ts";
import { extractLightingFromEnergyStudy } from "../../lib/lighting/extract-energy-study.ts";
import { extractPdfText } from "../../lib/import/pdf-text.ts";

const file = process.argv[2];
const mode = (process.argv[3] || "both").toLowerCase();
if (!file) {
  console.error("Usage: lighting-extract.ts <path-to.pdf> [energy|dialux|both]");
  process.exit(2);
}

const bytes = new Uint8Array(fs.readFileSync(file));
const t = await extractPdfText(bytes).catch(() => null);
console.log(
  `# ${file}\n# text-layer: pages=${t?.pages ?? "?"} usable=${t?.hasUsableText ?? "?"} chars=${t?.text.length ?? 0}\n`
);

if (mode === "energy" || mode === "both") {
  console.log("===== ENERGY PARSER =====");
  try {
    console.log(JSON.stringify(await extractLightingFromEnergyStudy({ pdf: bytes }), null, 2));
  } catch (e: any) {
    console.log(`ERROR: ${e?.message ?? e}`);
  }
}
if (mode === "dialux" || mode === "both") {
  console.log("===== DIALUX PARSER =====");
  try {
    console.log(JSON.stringify(await extractDialux({ pdf: bytes }), null, 2));
  } catch (e: any) {
    console.log(`ERROR: ${e?.message ?? e}`);
  }
}
