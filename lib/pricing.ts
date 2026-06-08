import type {
  DiscountType,
  Option,
  PricingTier,
  Product,
  TierPriceMap,
} from "./types";

/**
 * Resolve the unit price for a line before discount.
 * Returns null when no price_version entry exists for (product, tier).
 * Never falls back to product.base_price — tier pricing is authoritative.
 */
export function resolveStandardUnitPrice(
  product: Product,
  tier: PricingTier,
  selectedOptions: Record<string, string>,
  productOptions: Option[],
  tierPrices: TierPriceMap
): number | null {
  const tierPrice = tierPrices?.[product.id]?.[tier];
  if (tierPrice === undefined) return null;

  const modifiers = Object.entries(selectedOptions).reduce(
    (sum, [type, val]) => {
      const opt = productOptions.find(
        (o) => o.option_type === type && o.option_value === val
      );
      return sum + Number(opt?.price_modifier ?? 0);
    },
    0
  );
  return Number(tierPrice) + modifiers;
}

export function applyDiscount(
  original: number,
  type: DiscountType | null,
  value: number
): number {
  if (!type || !value || value <= 0) return original;
  if (type === "percentage") {
    return Math.max(0, original * (1 - value / 100));
  }
  return Math.max(0, original - value);
}

export function computeMargin(
  finalUnitPrice: number,
  costPrice: number | null | undefined
): { margin: number; marginPct: number } | null {
  if (costPrice == null) return null;
  const margin = finalUnitPrice - costPrice;
  const marginPct = finalUnitPrice > 0 ? (margin / finalUnitPrice) * 100 : 0;
  return { margin, marginPct };
}

export function buildTierPriceMap(
  rows: Array<{ product_id: string; price: number; pricing_tier: PricingTier }>
): TierPriceMap {
  const map: TierPriceMap = {};
  for (const row of rows) {
    const bucket = (map[row.product_id] ||= {});
    if (bucket[row.pricing_tier] === undefined) {
      bucket[row.pricing_tier] = Number(row.price);
    }
  }
  return map;
}

/**
 * Price-list-aware builder (pricing v5). Each product is priced from the
 * published price list chosen for ITS category (`categoryList`: categoryId →
 * listId). Rows whose price_list_id matches the product's chosen list win.
 * Caller passes rows ordered by valid_from DESC so the newest wins per key.
 */
export function buildTierPriceMapByCategory(
  rows: Array<{
    product_id: string;
    price: number;
    pricing_tier: PricingTier;
    price_list_id: string | null;
  }>,
  productCategory: Map<string, string | null>,
  categoryList: Map<string, string>
): TierPriceMap {
  const map: TierPriceMap = {};
  for (const r of rows) {
    const cat = productCategory.get(r.product_id) ?? null;
    const chosen = cat ? categoryList.get(cat) : undefined;
    if (!chosen || r.price_list_id !== chosen) continue;
    const bucket = (map[r.product_id] ||= {});
    if (bucket[r.pricing_tier] === undefined) bucket[r.pricing_tier] = Number(r.price);
  }
  return map;
}

export function formatDiscount(
  type: DiscountType | null,
  value: number
): string {
  if (!type || !value) return "—";
  return type === "percentage"
    ? `${Number(value).toFixed(2)}%`
    : Number(value).toFixed(2);
}
