/**
 * Tests for the Production Dossier vocabulary + appendix pipeline.
 *
 * Run with:  npm test
 *
 * Locks the behaviors carrying business risk:
 *   - bilingual section catalog (Chinese present on every title — the
 *     factory-facing requirement),
 *   - appendix classification + labelling (what gets merged vs "provided
 *     separately"),
 *   - battery detection (which fields aggregate into the Battery block),
 *   - WinAnsi safety of separator text (pdf-lib Helvetica would throw),
 *   - the pdf-lib merge itself (pages actually appended; corrupt files
 *     skipped without sinking the dossier).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOSSIER_SECTIONS,
  classifyAppendixFile,
  planAppendix,
  isBatteryLabel,
  asciiForSeparator,
  buildDossierEmail,
  BATTERY_CELL_KEY,
  type AppendixSource,
} from "../lib/production-dossier.ts";
import { mergeDossierWithAppendix } from "../lib/pdf-merge.ts";
import { PDFDocument } from "pdf-lib";

/* ------------------------------ section catalog ------------------------------ */

test("every dossier section title is bilingual (zh contains CJK, en non-empty)", () => {
  for (const [key, t] of Object.entries(DOSSIER_SECTIONS)) {
    assert.ok(t.zh.trim().length > 0, `${key}: zh empty`);
    assert.ok(t.en.trim().length > 0, `${key}: en empty`);
    assert.match(t.zh, /[一-鿿]/, `${key}: zh has no CJK characters`);
    assert.doesNotMatch(t.en, /[一-鿿]/, `${key}: en contains CJK`);
  }
});

test("owner-specified titles are used verbatim", () => {
  assert.equal(DOSSIER_SECTIONS.customer.zh, "客户信息");
  assert.equal(DOSSIER_SECTIONS.factory_instructions.zh, "工厂生产说明");
  assert.equal(DOSSIER_SECTIONS.battery_type.zh, "电池类型");
  assert.equal(DOSSIER_SECTIONS.lighting_program.zh, "灯光程序");
  assert.equal(DOSSIER_SECTIONS.appendix.zh, "附录");
});

/* --------------------------- appendix classification -------------------------- */

test("classifyAppendixFile: mime first, extension fallback", () => {
  assert.equal(classifyAppendixFile("study.pdf", "application/pdf"), "pdf");
  assert.equal(classifyAppendixFile("photo.jpg", "image/jpeg"), "image");
  assert.equal(classifyAppendixFile("logo.png", "image/png"), "image");
  // extension fallback when mime is missing
  assert.equal(classifyAppendixFile("drawing.PDF", null), "pdf");
  assert.equal(classifyAppendixFile("site.JPEG", ""), "image");
  // not embeddable
  assert.equal(classifyAppendixFile("dialux.zip", "application/zip"), "external");
  assert.equal(classifyAppendixFile("spec.docx", null), "external");
  assert.equal(classifyAppendixFile("anim.webp", "image/webp"), "external");
  assert.equal(classifyAppendixFile("vector.svg", "image/svg+xml"), "external");
});

function src(name: string, mime: string | null): AppendixSource {
  return {
    file_name: name,
    mime_type: mime,
    storage_path: `attachments/x/${name}`,
    type_label: "Other",
    note: null,
  };
}

test("planAppendix: sequential A-labels for embeddable, null for external", () => {
  const plan = planAppendix([
    src("a.pdf", "application/pdf"),
    src("b.zip", "application/zip"),
    src("c.png", "image/png"),
    src("d.docx", null),
    src("e.pdf", null),
  ]);
  assert.deepEqual(
    plan.map((p) => p.label),
    ["A1", null, "A2", null, "A3"]
  );
  assert.deepEqual(
    plan.map((p) => p.kind),
    ["pdf", "external", "image", "external", "pdf"]
  );
});

/* -------------------------------- battery detection --------------------------- */

test("isBatteryLabel groups battery-bearing fields, leaves the rest alone", () => {
  assert.ok(isBatteryLabel("Battery type"));
  assert.ok(isBatteryLabel("Battery autonomy (nights)"));
  assert.ok(isBatteryLabel("BMS reference"));
  assert.ok(isBatteryLabel("bms_reference"));
  assert.ok(isBatteryLabel("Cell reference"));
  assert.ok(isBatteryLabel("cell_reference"));
  assert.ok(isBatteryLabel(BATTERY_CELL_KEY));
  // near-misses must NOT be captured
  assert.ok(!isBatteryLabel("Miscellaneous"));
  assert.ok(!isBatteryLabel("Excellent finish"));
  assert.ok(!isBatteryLabel("CCT"));
  assert.ok(!isBatteryLabel("Controller"));
});

/* ------------------------------ separator safety ------------------------------ */

test("asciiForSeparator folds to WinAnsi-safe text", () => {
  assert.equal(asciiForSeparator("étude énergétique.pdf"), "etude energetique.pdf");
  assert.equal(asciiForSeparator("能耗报告.pdf"), "????.pdf");
  assert.equal(asciiForSeparator("   "), "-");
  assert.equal(asciiForSeparator("plain.pdf"), "plain.pdf");
});

test("buildDossierEmail carries number, project and filename", () => {
  const { subject, body } = buildDossierEmail({
    number: "PTL-26-0042",
    affair: "Victoria Park",
    client: "Techlight",
    fileName: "FACTORY_PTL-26-0042_TECHLIGHT_VICTORIA_PARK.pdf",
  });
  assert.match(subject, /PTL-26-0042/);
  assert.match(subject, /Victoria Park/);
  assert.match(body, /Techlight/);
  assert.match(body, /FACTORY_PTL-26-0042_TECHLIGHT_VICTORIA_PARK\.pdf/);
});

/* --------------------------------- pdf merge ---------------------------------- */

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595.28, 841.89]);
  return doc.save();
}

/** Minimal valid 1×1 PNG. */
const TINY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  )
);

test("mergeDossierWithAppendix: appends separator + pages per embeddable file", async () => {
  const main = await makePdf(3);
  const attachment = await makePdf(2);

  const { bytes, embedded, skipped } = await mergeDossierWithAppendix(main, [
    {
      ...src("study.pdf", "application/pdf"),
      kind: "pdf",
      label: "A1",
      bytes: attachment,
    },
    {
      ...src("photo.png", "image/png"),
      kind: "image",
      label: "A2",
      bytes: TINY_PNG,
    },
  ]);

  const merged = await PDFDocument.load(bytes);
  // 3 (main) + 1 (sep A1) + 2 (pdf) + 1 (sep A2) + 1 (image page) = 8
  assert.equal(merged.getPageCount(), 8);
  assert.deepEqual(embedded, ["study.pdf", "photo.png"]);
  assert.deepEqual(skipped, []);
});

test("mergeDossierWithAppendix: corrupt file is skipped, dossier survives", async () => {
  const main = await makePdf(2);
  const { bytes, embedded, skipped } = await mergeDossierWithAppendix(main, [
    {
      ...src("broken.pdf", "application/pdf"),
      kind: "pdf",
      label: "A1",
      bytes: new Uint8Array([1, 2, 3, 4]),
    },
  ]);
  const merged = await PDFDocument.load(bytes);
  assert.equal(merged.getPageCount(), 2); // untouched dossier
  assert.deepEqual(embedded, []);
  assert.deepEqual(skipped, ["broken.pdf"]);
});

test("mergeDossierWithAppendix: external/unlabelled items are ignored", async () => {
  const main = await makePdf(1);
  const { bytes } = await mergeDossierWithAppendix(main, [
    {
      ...src("dialux.zip", "application/zip"),
      kind: "external",
      label: null,
      bytes: new Uint8Array([0]),
    },
  ]);
  const merged = await PDFDocument.load(bytes);
  assert.equal(merged.getPageCount(), 1);
});
