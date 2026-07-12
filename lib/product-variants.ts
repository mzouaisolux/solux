/**
 * Product option groups — UX-ONLY variant collapsing (owner 2026-07-12).
 *
 * Finance models every IoT version as a fully independent `products` row
 * (own SKU, own cost, own price history) — e.g. "AOSPRO+40" and
 * "AOSPRO+40 IoT version". That database structure is INTENTIONAL and must
 * never change. But a salesperson picking a product is making two separate
 * decisions ("which luminaire?" then "with IoT or not?"), so showing both
 * rows as near-identical catalogue cards doubles the catalogue for nothing.
 *
 * This module is a pure, presentation-layer registry that:
 *   1. detects standard↔IoT twin pairs by naming convention
 *      ("<base name> IoT version", same category — the convention already
 *      relied on by lib/product-sort.ts),
 *   2. tells pickers which products to HIDE (the IoT twin of a visible
 *      standard model),
 *   3. describes the option group ("Connectivity: Standard / IoT Version")
 *      to render once a member of the pair is selected, mapping each choice
 *      back to the real product id.
 *
 * Scope is deliberately limited to the families the owner approved:
 * AOSPRO+, SSLX Performance, SSLX Pro. Other families keep the flat
 * catalogue. The group shape is generic (key/label/choices) so future
 * option groups — accessories, finishes — can reuse the same UX pattern
 * by adding another detector here, without touching the pickers again.
 *
 * Safety rules:
 *   - An IoT product with NO standard twin in the list stays visible
 *     (e.g. AOSPRO+20 exists only as IoT today — hiding it would make it
 *     unreachable).
 *   - Lookups are keyed by EVERY member id, so a line that already carries
 *     the IoT product (existing quotations, imports) still finds its group
 *     and shows "IoT Version" selected.
 *   - Zero I/O, zero migration: build the index from whatever product list
 *     the picker already received.
 */

export type VariantProduct = {
  id: string;
  name: string;
  category?: string | null;
  category_id?: string | null;
};

export type ProductOptionChoice = {
  key: string;
  label: string;
  productId: string;
};

export type ProductOptionGroup = {
  /** Option identity, e.g. "connectivity". */
  key: string;
  /** Panel label, e.g. "Connectivity". */
  label: string;
  /** The visible catalogue product (the standard model). */
  baseProductId: string;
  /** Ordered choices — the default/standard choice first. */
  choices: ProductOptionChoice[];
};

export type VariantIndex = {
  /** Products to hide from catalogue pickers (IoT twins of a visible base). */
  hiddenIds: Set<string>;
  /** Group lookup keyed by every member product id (base AND variants). */
  groupsByProductId: Map<string, ProductOptionGroup>;
};

/** "<base> IoT version" (case-insensitive, tolerant of extra spaces). */
const IOT_SUFFIX_RE = /\s+iot\s+version\s*$/i;

/**
 * Families where collapsing is enabled, as normalized category names.
 * Normalization strips everything but letters/digits/'+' and lowercases, so
 * "AOSPRO +", "AOSPRO+", "SSLXPRO", "SSLX Pro" all match their key.
 */
const ELIGIBLE_FAMILY_KEYS = new Set(["aospro+", "sslxperformance", "sslxpro"]);

export function familyKey(category: string | null | undefined): string {
  return (category ?? "").toLowerCase().replace(/[^a-z0-9+]/g, "");
}

export function isVariantEligibleFamily(
  category: string | null | undefined
): boolean {
  return ELIGIBLE_FAMILY_KEYS.has(familyKey(category));
}

function normName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Build the collapse/option index for a product list. Pure — call it in a
 * useMemo over the same `products` array the picker already renders.
 */
export function buildVariantIndex(
  products: readonly VariantProduct[]
): VariantIndex {
  const hiddenIds = new Set<string>();
  const groupsByProductId = new Map<string, ProductOptionGroup>();

  // Standard models of eligible families, addressable by category+name.
  const baseByKey = new Map<string, VariantProduct>();
  for (const p of products) {
    if (!isVariantEligibleFamily(p.category)) continue;
    if (IOT_SUFFIX_RE.test(p.name)) continue;
    baseByKey.set(`${p.category_id ?? ""}::${normName(p.name)}`, p);
  }

  for (const p of products) {
    if (!isVariantEligibleFamily(p.category)) continue;
    const m = p.name.match(IOT_SUFFIX_RE);
    if (!m) continue;
    const baseName = p.name.slice(0, p.name.length - m[0].length);
    const base = baseByKey.get(`${p.category_id ?? ""}::${normName(baseName)}`);
    // No standard twin in this list → the IoT row must stay visible.
    if (!base || base.id === p.id) continue;

    const group: ProductOptionGroup = {
      key: "connectivity",
      label: "Connectivity",
      baseProductId: base.id,
      choices: [
        { key: "standard", label: "Standard", productId: base.id },
        { key: "iot", label: "IoT Version", productId: p.id },
      ],
    };
    hiddenIds.add(p.id);
    for (const c of group.choices) groupsByProductId.set(c.productId, group);
  }

  return { hiddenIds, groupsByProductId };
}

/** Convenience: the list a catalogue picker should display. */
export function collapseVariantProducts<T extends VariantProduct>(
  products: readonly T[],
  index: VariantIndex = buildVariantIndex(products)
): T[] {
  return products.filter((p) => !index.hiddenIds.has(p.id));
}
