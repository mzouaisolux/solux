/**
 * Product Dictionary (m160) — pure types + compatibility logic.
 *
 * The factory works with OFFICIAL references, not translations:
 *   Commercial (EN/FR)  "Battery"
 *   Factory reference   "LFP25-65AH-V6"   (internal_reference)
 *   Chinese terminology "25.6V 65Ah 磷酸铁锂电池" (factory_name_cn)
 *   ERP code            (erp_code)
 *
 * The dictionary IS the existing `component_mappings` table (m012),
 * promoted by m160 with FR/CN names, ERP code and product/category
 * compatibility arrays. Every module reads the same rows — first
 * consumer: the task list's product-aware FREE SPARE PARTS, whose
 * selector only offers items compatible with the ordered families and
 * auto-fills the factory naming (always overridable).
 *
 * Client + server safe (no DB access). Pure functions → unit-testable.
 */

export type DictionaryItem = {
  id: string;
  /** Commercial name (EN) — the historical commercial_name column. */
  commercial_name: string;
  commercial_name_fr: string | null;
  /** Official factory reference (e.g. "LFP25-65AH-V6"). */
  internal_reference: string;
  /** Official Chinese factory terminology (e.g. "25.6V 65Ah 磷酸铁锂电池"). */
  factory_name_cn: string | null;
  erp_code: string | null;
  /** Part type — free text kept from m012 ("battery", "controller", …). */
  category: string | null;
  notes: string | null;
  active: boolean;
  /** Product FAMILIES this item fits (product_categories ids). Empty = generic. */
  compatible_category_ids: string[];
  /** Optional per-product narrowing (products ids). */
  compatible_product_ids: string[];
};

/** A product family present on the order (derived from the task list lines). */
export type OrderedFamily = {
  /** product_categories id — null for manual/uncategorised lines. */
  categoryId: string | null;
  /** Display label ("AOS PRO 100" family name). */
  label: string;
  /** The ordered catalog products belonging to this family. */
  productIds: string[];
};

/** Normalize a raw component_mappings row (m160 columns may be absent pre-migration). */
export function normalizeDictionaryItem(raw: any): DictionaryItem | null {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const s = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v : null;
  return {
    id: String(raw.id),
    commercial_name: String(raw.commercial_name ?? ""),
    commercial_name_fr: s(raw.commercial_name_fr),
    internal_reference: String(raw.internal_reference ?? ""),
    factory_name_cn: s(raw.factory_name_cn),
    erp_code: s(raw.erp_code),
    category: s(raw.category),
    notes: s(raw.notes),
    active: raw.active !== false,
    compatible_category_ids: arr(raw.compatible_category_ids),
    compatible_product_ids: arr(raw.compatible_product_ids),
  };
}

/**
 * Derive the ordered product families from task-list lines. Lines without a
 * family (manual poles, custom items) fold into one "Other / manual items"
 * bucket so their spare parts remain expressible.
 */
export function deriveOrderedFamilies(
  lines: Array<{
    categoryId: string | null;
    productId: string | null;
    familyLabel: string | null;
  }>
): OrderedFamily[] {
  const byCat = new Map<string, OrderedFamily>();
  const manual: OrderedFamily = {
    categoryId: null,
    label: "Other / manual items",
    productIds: [],
  };
  let hasManual = false;
  for (const l of lines) {
    if (l.categoryId) {
      let fam = byCat.get(l.categoryId);
      if (!fam) {
        fam = {
          categoryId: l.categoryId,
          label: l.familyLabel ?? "Family",
          productIds: [],
        };
        byCat.set(l.categoryId, fam);
      }
      if (l.familyLabel && fam.label === "Family") fam.label = l.familyLabel;
      if (l.productId && !fam.productIds.includes(l.productId)) {
        fam.productIds.push(l.productId);
      }
    } else {
      hasManual = true;
      if (l.productId && !manual.productIds.includes(l.productId)) {
        manual.productIds.push(l.productId);
      }
    }
  }
  const out = Array.from(byCat.values());
  if (hasManual) out.push(manual);
  return out;
}

/**
 * The dictionary items offered for ONE ordered family. Compatibility rule:
 *   • item scopes some products  → offered when it fits an ORDERED product
 *     of this family;
 *   • else item scopes families  → offered when it lists this family;
 *   • else (no scoping at all)   → GENERIC: offered everywhere.
 * An item scoped to OTHER families/products is NEVER offered here — that's
 * the whole point (owner: "It should NEVER display unrelated product
 * families").
 */
export function itemsForFamily(
  items: DictionaryItem[],
  family: OrderedFamily
): DictionaryItem[] {
  return items.filter((it) => {
    if (!it.active) return false;
    if (it.compatible_product_ids.length > 0) {
      if (it.compatible_product_ids.some((p) => family.productIds.includes(p))) {
        return true;
      }
      // Product-scoped but none ordered in this family — fall through to the
      // category scoping if it also declares families.
      if (it.compatible_category_ids.length === 0) return false;
    }
    if (it.compatible_category_ids.length > 0) {
      return family.categoryId != null &&
        it.compatible_category_ids.includes(family.categoryId);
    }
    return true; // generic
  });
}

/** What a dictionary pick auto-fills on a spare-part row (all overridable). */
export function factoryFillFromItem(it: DictionaryItem): {
  part: string;
  model: string;
  factory_name: string;
  factory_name_cn: string | null;
  erp_code: string | null;
} {
  return {
    part: it.commercial_name,
    model: it.internal_reference,
    factory_name: it.internal_reference,
    factory_name_cn: it.factory_name_cn,
    erp_code: it.erp_code,
  };
}

/** Group a family's items by part type (category) for the selector. */
export function groupItemsByType(
  items: DictionaryItem[]
): Array<{ type: string; items: DictionaryItem[] }> {
  const byType = new Map<string, DictionaryItem[]>();
  for (const it of items) {
    const t = it.category?.trim() || "Other";
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(it);
  }
  return Array.from(byType.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, list]) => ({
      type,
      items: list.sort((a, b) => a.commercial_name.localeCompare(b.commercial_name)),
    }));
}
