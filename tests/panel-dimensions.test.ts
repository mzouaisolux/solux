import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePanelDimensions } from "../lib/panel-dimensions.ts";

const ok = (raw: string, expected: string) => {
  const r = normalizePanelDimensions(raw);
  assert.equal(r.ok, true, `expected ok for "${raw}"`);
  if (r.ok) assert.equal(r.value, expected);
};
const bad = (raw: string | null | undefined) => assert.equal(normalizePanelDimensions(raw).ok, false, `expected reject for "${raw}"`);

test("accepts and normalizes the common separators", () => {
  ok("1722 x 1134", "1722 × 1134 mm");
  ok("1722×1134", "1722 × 1134 mm");
  ok("1722*1134", "1722 × 1134 mm");
  ok("1722 X 1134 mm", "1722 × 1134 mm");
  ok("1722 by 1134", "1722 × 1134 mm");
  ok("2100 x 1050", "2100 × 1050 mm");
});

test("handles decimals + extra spacing", () => {
  ok("  1480.5  ×  670 ", "1480.5 × 670 mm");
});

test("drops a 3rd number (thickness) — dimensions stay L × W", () => {
  ok("1722 x 1134 x 35", "1722 × 1134 mm");
});

test("rejects incomplete / single / non-numeric", () => {
  bad("");
  bad("   ");
  bad(null);
  bad("1722 x");
  bad("1722mm");
  bad("xxxxxxxx");
  bad("abc x def");
});
