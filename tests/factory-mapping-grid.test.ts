/**
 * Tests for the Factory Mapping bulk-edit grid logic (lib/factory-mapping-grid.ts).
 *
 * Run with:  npm test
 *
 * Pure (no DB / no React). These lock the spreadsheet behaviors that carry the
 * business risk: Excel clipboard parsing, paste fan-out over visible rows, the
 * live counters, and — most importantly — the save/delete payload derivation
 * (a cleared instruction must DELETE the mapping, never upsert "").
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseClipboardGrid,
  isMultiCellPaste,
  buildPastePatches,
  computeCounters,
  buildBulkSavePayload,
  isRowDirty,
  type MappingGridRow,
  type WorkingCell,
} from "../lib/factory-mapping-grid.ts";

function row(over: Partial<MappingGridRow> & { optionId: string }): MappingGridRow {
  return {
    categoryId: "cat-1",
    categoryName: "Solar Pro",
    fieldId: "field-1",
    fieldName: "SOLAR PANEL",
    fieldScope: "sales",
    optionValue: "18V / 60W",
    instruction: "",
    code: "",
    hasMapping: false,
    notes: null,
    active: true,
    ...over,
  };
}

// --- parseClipboardGrid ------------------------------------------------------

test("parseClipboardGrid: single Excel column → one value per row", () => {
  assert.deepEqual(parseClipboardGrid("Panel 18V 60W\nPanel 18V 72W\nPanel 18V 105W\n"), [
    ["Panel 18V 60W"],
    ["Panel 18V 72W"],
    ["Panel 18V 105W"],
  ]);
});

test("parseClipboardGrid: keeps interior blanks (they clear cells), drops trailing newline", () => {
  assert.deepEqual(parseClipboardGrid("a\n\nb\n"), [["a"], [""], ["b"]]);
});

test("parseClipboardGrid: tab-separated columns and \\r\\n line endings", () => {
  assert.deepEqual(parseClipboardGrid("ins A\tCODE-A\r\nins B\tCODE-B\r\n"), [
    ["ins A", "CODE-A"],
    ["ins B", "CODE-B"],
  ]);
});

test("isMultiCellPaste: newline or tab → multi, plain text → single", () => {
  assert.equal(isMultiCellPaste("a\nb"), true);
  assert.equal(isMultiCellPaste("a\tb"), true);
  assert.equal(isMultiCellPaste("just one value"), false);
});

// --- buildPastePatches -------------------------------------------------------

const VISIBLE = [{ optionId: "o1" }, { optionId: "o2" }, { optionId: "o3" }];
const EMPTY = () => "";

test("buildPastePatches: column paste fills successive visible rows from the start cell", () => {
  const patches = buildPastePatches({
    grid: [["A"], ["B"], ["C"]],
    visible: VISIBLE,
    startIndex: 0,
    startCol: "instruction",
    current: EMPTY,
  });
  assert.deepEqual(patches, [
    { optionId: "o1", col: "instruction", prev: "", next: "A" },
    { optionId: "o2", col: "instruction", prev: "", next: "B" },
    { optionId: "o3", col: "instruction", prev: "", next: "C" },
  ]);
});

test("buildPastePatches: overflow past the last visible row is ignored", () => {
  const patches = buildPastePatches({
    grid: [["A"], ["B"], ["C"], ["D"], ["E"]],
    visible: VISIBLE,
    startIndex: 1,
    startCol: "instruction",
    current: EMPTY,
  });
  assert.equal(patches.length, 2); // rows o2, o3 only
  assert.equal(patches[0].optionId, "o2");
  assert.equal(patches[1].optionId, "o3");
});

test("buildPastePatches: two clipboard columns land on instruction+code", () => {
  const patches = buildPastePatches({
    grid: [["ins A", "CODE-A"]],
    visible: VISIBLE,
    startIndex: 0,
    startCol: "instruction",
    current: EMPTY,
  });
  assert.deepEqual(patches, [
    { optionId: "o1", col: "instruction", prev: "", next: "ins A" },
    { optionId: "o1", col: "code", prev: "", next: "CODE-A" },
  ]);
});

test("buildPastePatches: pasting into the code column ignores clipboard overflow columns", () => {
  const patches = buildPastePatches({
    grid: [["CODE-A", "overflow"]],
    visible: VISIBLE,
    startIndex: 0,
    startCol: "code",
    current: EMPTY,
  });
  assert.deepEqual(patches, [
    { optionId: "o1", col: "code", prev: "", next: "CODE-A" },
  ]);
});

test("buildPastePatches: no-op cells produce no patch (exact undo)", () => {
  const patches = buildPastePatches({
    grid: [["same"], ["different"]],
    visible: VISIBLE,
    startIndex: 0,
    startCol: "instruction",
    current: (id) => (id === "o1" ? "same" : ""),
  });
  assert.equal(patches.length, 1);
  assert.equal(patches[0].optionId, "o2");
});

test("buildPastePatches: values are trimmed", () => {
  const patches = buildPastePatches({
    grid: [["  padded  "]],
    visible: VISIBLE,
    startIndex: 0,
    startCol: "instruction",
    current: EMPTY,
  });
  assert.equal(patches[0].next, "padded");
});

// --- computeCounters ---------------------------------------------------------

test("computeCounters: counts mapped/missing over the WORKING state", () => {
  const rows = [
    row({ optionId: "o1", instruction: "saved", hasMapping: true }),
    row({ optionId: "o2" }),
    row({ optionId: "o3" }),
  ];
  const working = (id: string) => (id === "o2" ? "just typed" : id === "o1" ? "saved" : "");
  assert.deepEqual(computeCounters(rows, working), { total: 3, mapped: 2, missing: 1 });
});

// --- buildBulkSavePayload ----------------------------------------------------

function workingOf(map: Record<string, WorkingCell>, rows: MappingGridRow[]) {
  const byId = new Map(rows.map((r) => [r.optionId, r]));
  return (id: string): WorkingCell =>
    map[id] ?? { ins: byId.get(id)!.instruction, code: byId.get(id)!.code };
}

test("payload: new instruction on unmapped row → upsert (code null when blank)", () => {
  const rows = [row({ optionId: "o1", fieldId: "f9" })];
  const p = buildBulkSavePayload({
    rows,
    working: workingOf({ o1: { ins: "Panel 18V 60W", code: "" } }, rows),
  });
  assert.deepEqual(p.deletes, []);
  assert.deepEqual(p.upserts, [
    { field_id: "f9", option_id: "o1", factory_instruction: "Panel 18V 60W", factory_code: null },
  ]);
});

test("payload: cleared instruction on a mapped row → DELETE, never an empty upsert", () => {
  const rows = [row({ optionId: "o1", instruction: "old", hasMapping: true })];
  const p = buildBulkSavePayload({
    rows,
    working: workingOf({ o1: { ins: "   ", code: "" } }, rows),
  });
  assert.deepEqual(p.upserts, []);
  assert.deepEqual(p.deletes, ["o1"]);
});

test("payload: blank instruction on an unmapped row → nothing", () => {
  const rows = [row({ optionId: "o1" })];
  const p = buildBulkSavePayload({ rows, working: workingOf({}, rows) });
  assert.deepEqual(p, { upserts: [], deletes: [] });
});

test("payload: unchanged rows are skipped; code-only change still upserts", () => {
  const rows = [
    row({ optionId: "o1", instruction: "keep", code: "K-1", hasMapping: true }),
    row({ optionId: "o2", instruction: "keep", code: "", hasMapping: true }),
  ];
  const p = buildBulkSavePayload({
    rows,
    working: workingOf({ o2: { ins: "keep", code: "NEW-CODE" } }, rows),
  });
  assert.equal(p.upserts.length, 1);
  assert.equal(p.upserts[0].option_id, "o2");
  assert.equal(p.upserts[0].factory_code, "NEW-CODE");
});

test("payload: copiedExtras carry notes/active only for those rows", () => {
  const rows = [
    row({ optionId: "o1" }),
    row({ optionId: "o2" }),
  ];
  const p = buildBulkSavePayload({
    rows,
    working: workingOf(
      { o1: { ins: "from copy", code: "" }, o2: { ins: "typed by hand", code: "" } },
      rows
    ),
    copiedExtras: { o1: { notes: "src note", active: false } },
  });
  const o1 = p.upserts.find((u) => u.option_id === "o1")!;
  const o2 = p.upserts.find((u) => u.option_id === "o2")!;
  assert.equal(o1.notes, "src note");
  assert.equal(o1.active, false);
  assert.equal("notes" in o2, false);
  assert.equal("active" in o2, false);
});

test("isRowDirty: trims both sides", () => {
  const r = row({ optionId: "o1", instruction: "abc", code: "", hasMapping: true });
  assert.equal(isRowDirty(r, { ins: " abc ", code: "" }), false);
  assert.equal(isRowDirty(r, { ins: "abcd", code: "" }), true);
  assert.equal(isRowDirty(r, { ins: "abc", code: "X" }), true);
});
