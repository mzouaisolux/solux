/**
 * Tests for the m160 Product Dictionary logic (lib/industrial-dictionary.ts).
 *
 * Run with:  npm test
 *
 * Pure (no DB). Proves the compatibility rules the task-list product-aware
 * spare-parts selector relies on:
 *   - deriveOrderedFamilies: families from task-list lines, manual bucket;
 *   - itemsForFamily: product-scoped > category-scoped > generic — an item
 *     scoped to ANOTHER family is NEVER offered (the owner's core rule);
 *   - factoryFillFromItem: the dictionary pick snapshots the official
 *     factory reference / Chinese terminology / ERP code;
 *   - normalizeDictionaryItem: m160 columns absent (pre-migration) → safe
 *     generic item.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveOrderedFamilies,
  itemsForFamily,
  factoryFillFromItem,
  groupItemsByType,
  normalizeDictionaryItem,
  type DictionaryItem,
} from "../lib/industrial-dictionary.ts";

const item = (over: Partial<DictionaryItem>): DictionaryItem => ({
  id: "id-x",
  commercial_name: "Part",
  commercial_name_fr: null,
  internal_reference: "REF-X",
  factory_name_cn: null,
  erp_code: null,
  category: null,
  notes: null,
  active: true,
  compatible_category_ids: [],
  compatible_product_ids: [],
  ...over,
});

const CAT_AOS = "cat-aospro";
const CAT_SSLX = "cat-sslx";

test("deriveOrderedFamilies: groups lines by family, manual lines fold into one bucket", () => {
  const fams = deriveOrderedFamilies([
    { categoryId: CAT_AOS, productId: "p1", familyLabel: "AOS PRO" },
    { categoryId: CAT_AOS, productId: "p2", familyLabel: "AOS PRO" },
    { categoryId: CAT_SSLX, productId: "p3", familyLabel: "SSLX PRO" },
    { categoryId: null, productId: null, familyLabel: null }, // manual pole
  ]);
  assert.equal(fams.length, 3);
  const aos = fams.find((f) => f.categoryId === CAT_AOS)!;
  assert.deepEqual(aos.productIds, ["p1", "p2"]);
  assert.equal(aos.label, "AOS PRO");
  assert.equal(fams[2].categoryId, null);
  assert.match(fams[2].label, /Other \/ manual/);
});

test("itemsForFamily: category-scoped items appear ONLY for their family (never unrelated)", () => {
  const battAos = item({ id: "b-aos", commercial_name: "Battery AOS", compatible_category_ids: [CAT_AOS] });
  const battSslx = item({ id: "b-sslx", commercial_name: "Battery SSLX", compatible_category_ids: [CAT_SSLX] });
  const generic = item({ id: "screws", commercial_name: "Screws" });
  const all = [battAos, battSslx, generic];

  const aosFam = { categoryId: CAT_AOS, label: "AOS PRO", productIds: ["p1"] };
  const offered = itemsForFamily(all, aosFam).map((i) => i.id);
  assert.deepEqual(offered.sort(), ["b-aos", "screws"]); // JAMAIS b-sslx
});

test("itemsForFamily: product-scoped narrowing wins; inactive items excluded", () => {
  const forP1 = item({ id: "lens-p1", compatible_product_ids: ["p1"] });
  const forP9 = item({ id: "lens-p9", compatible_product_ids: ["p9"] });
  const dead = item({ id: "dead", active: false });
  const fam = { categoryId: CAT_AOS, label: "AOS PRO", productIds: ["p1", "p2"] };
  const offered = itemsForFamily([forP1, forP9, dead], fam).map((i) => i.id);
  assert.deepEqual(offered, ["lens-p1"]);
});

test("itemsForFamily: product-scoped item ALSO category-scoped falls back to the family", () => {
  // Scoped to a product not ordered here, but also declares the family →
  // still offered (the family declaration is the wider truth).
  const both = item({
    id: "ctrl",
    compatible_product_ids: ["p-not-ordered"],
    compatible_category_ids: [CAT_AOS],
  });
  const fam = { categoryId: CAT_AOS, label: "AOS PRO", productIds: ["p1"] };
  assert.deepEqual(itemsForFamily([both], fam).map((i) => i.id), ["ctrl"]);
});

test("itemsForFamily: the manual bucket (no category) gets generic items only", () => {
  const scoped = item({ id: "scoped", compatible_category_ids: [CAT_AOS] });
  const generic = item({ id: "generic" });
  const manualFam = { categoryId: null, label: "Other / manual items", productIds: [] };
  assert.deepEqual(itemsForFamily([scoped, generic], manualFam).map((i) => i.id), ["generic"]);
});

test("factoryFillFromItem: snapshots the official references (never a translation)", () => {
  const it = item({
    commercial_name: "Battery",
    internal_reference: "LFP25-65AH-V6",
    factory_name_cn: "25.6V 65Ah 磷酸铁锂电池",
    erp_code: "ERP-0042",
  });
  assert.deepEqual(factoryFillFromItem(it), {
    part: "Battery",
    model: "LFP25-65AH-V6",
    factory_name: "LFP25-65AH-V6",
    factory_name_cn: "25.6V 65Ah 磷酸铁锂电池",
    erp_code: "ERP-0042",
  });
});

test("groupItemsByType: grouped + sorted; missing type lands in Other", () => {
  const groups = groupItemsByType([
    item({ id: "1", category: "battery", commercial_name: "B2" }),
    item({ id: "2", category: "battery", commercial_name: "B1" }),
    item({ id: "3", category: null, commercial_name: "Misc" }),
  ]);
  // localeCompare: case is secondary → "battery" sorts before "Other".
  assert.deepEqual(groups.map((g) => g.type), ["battery", "Other"]);
  assert.deepEqual(groups[0].items.map((i) => i.commercial_name), ["B1", "B2"]);
  assert.deepEqual(groups[1].items.map((i) => i.commercial_name), ["Misc"]);
});

test("normalizeDictionaryItem: pre-m160 row (base columns only) → safe generic item", () => {
  const it = normalizeDictionaryItem({
    id: "x",
    commercial_name: "18RH battery",
    internal_reference: "LFP-18RH-32700-G2W",
    category: "battery",
    notes: null,
    active: true,
    // m160 columns absent entirely
  })!;
  assert.equal(it.commercial_name_fr, null);
  assert.equal(it.erp_code, null);
  assert.deepEqual(it.compatible_category_ids, []);
  assert.deepEqual(it.compatible_product_ids, []);
  // → offered everywhere until m160 scoping lands
  const fam = { categoryId: CAT_AOS, label: "AOS", productIds: [] };
  assert.equal(itemsForFamily([it], fam).length, 1);
  assert.equal(normalizeDictionaryItem(null), null);
  assert.equal(normalizeDictionaryItem({}), null);
});
