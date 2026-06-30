/**
 * Tests for the canonical generated-PDF filename helper (lib/pdf-filename.ts).
 *
 * Run with:  npm test
 *
 * Owner-locked convention: TYPE_NUMBER_CLIENT_AFFAIR[_Vn].pdf — the fixtures
 * below are the exact examples from the spec. Pure (no DB / no server imports).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPdfFilename, sanitizePart } from "../lib/pdf-filename.ts";

test("spec examples — quotation, proforma, commercial invoice", () => {
  assert.equal(
    buildPdfFilename({ kind: "quotation", number: "Q-2026-001", client: "TECHLIGHT", affair: "Victoria Park" }),
    "QUOTATION_Q-2026-001_TECHLIGHT_VICTORIA_PARK.pdf"
  );
  assert.equal(
    buildPdfFilename({ kind: "proforma", number: "PF-2026-008", client: "TECHLIGHT", affair: "Victoria Park" }),
    "PROFORMA_PF-2026-008_TECHLIGHT_VICTORIA_PARK.pdf"
  );
  assert.equal(
    buildPdfFilename({ kind: "commercial_invoice", number: "CI-2026-015", client: "TECHLIGHT", affair: "Victoria Park" }),
    "COMMERCIAL_INVOICE_CI-2026-015_TECHLIGHT_VICTORIA_PARK.pdf"
  );
});

test("version suffix: emitted only when > 1", () => {
  const base = { kind: "quotation", number: "Q-2026-001", client: "TECHLIGHT", affair: "Victoria Park" } as const;
  assert.equal(buildPdfFilename({ ...base, version: 1 }), "QUOTATION_Q-2026-001_TECHLIGHT_VICTORIA_PARK.pdf");
  assert.equal(buildPdfFilename({ ...base, version: 2 }), "QUOTATION_Q-2026-001_TECHLIGHT_VICTORIA_PARK_V2.pdf");
  assert.equal(buildPdfFilename({ ...base, version: null }), "QUOTATION_Q-2026-001_TECHLIGHT_VICTORIA_PARK.pdf");
});

test("accents fold to ASCII; spaces & specials become underscores", () => {
  assert.equal(
    buildPdfFilename({ kind: "proforma", number: "PF-2026-009", client: "Éclairage Léon & Fils", affair: "Réfection Hôtel-de-Ville" }),
    "PROFORMA_PF-2026-009_ECLAIRAGE_LEON_FILS_REFECTION_HOTEL-DE-VILLE.pdf"
  );
});

test("Windows/Mac illegal characters are stripped", () => {
  // < > : " / \ | ? *  and control chars must never reach the filename.
  const name = buildPdfFilename({ kind: "quotation", number: 'Q/2026:001', client: 'A<b>"c"', affair: "x|y?z*" });
  assert.ok(!/[<>:"/\\|?*]/.test(name), `illegal char leaked: ${name}`);
  assert.ok(name.endsWith(".pdf"));
});

test("missing parts are skipped (never UNDEFINED), empty falls back", () => {
  assert.equal(
    buildPdfFilename({ kind: "quotation", number: "Q-2026-002", client: null, affair: undefined }),
    "QUOTATION_Q-2026-002.pdf"
  );
  assert.equal(buildPdfFilename({ kind: "factory" }), "FACTORY.pdf");
  assert.equal(
    buildPdfFilename({ kind: "quotation", number: "   ", client: "   ", affair: "   " }),
    "QUOTATION.pdf"
  );
});

test("reserved Windows device names are guarded", () => {
  // A client literally named "CON" must not produce a reserved base.
  const name = buildPdfFilename({ kind: "factory", client: "CON" });
  assert.notEqual(name.toUpperCase(), "CON.PDF");
  assert.ok(name.endsWith(".pdf"));
});

test("sanitizePart caps length and trims separators", () => {
  const long = sanitizePart("a".repeat(80));
  assert.ok(long.length <= 40);
  assert.equal(sanitizePart("  spaced  name  "), "SPACED_NAME");
  assert.equal(sanitizePart("Q-2026-001"), "Q-2026-001");
});
