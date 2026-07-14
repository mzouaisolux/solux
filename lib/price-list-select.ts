/**
 * PURE price-list selection core (m170) — NO DB, NO `@/` imports, so it is
 * unit-testable under plain `node --test`. The server wrapper
 * (lib/price-lists.ts `getQuotePricingContext`) fetches the rows and delegates
 * the decision here.
 *
 * Rule: per category, price only from a PUBLISHED list that is ALSO flagged
 * `use_as_catalogue_pricing`. The seller's assigned catalogue list wins over
 * the newest catalogue list. A category that has published lists but none
 * catalogue-enabled is "blocked" — its products require an approved Service
 * Request. When `catalogueFlagActive` is false (pre-m170 env), every published
 * list is treated as catalogue-enabled so behaviour is unchanged.
 */

/** One published price list, as needed by the pure selector. */
export type PublishedList = {
  id: string;
  name: string;
  category_id: string | null;
  created_at: string | null;
  /** m170 — undefined on a pre-m170 env (treated as "enabled" for BC). */
  use_as_catalogue_pricing?: boolean | null;
};

export type CatalogueSelection = {
  /** categoryId → chosen catalogue-enabled published list. */
  categoryListMap: Map<string, { id: string; name: string }>;
  /** categoryId set: has a published list, but none catalogue-enabled. */
  blockedCategoryIds: Set<string>;
};

export function selectCatalogueLists(
  published: PublishedList[],
  assignedIds: Set<string>,
  catalogueFlagActive: boolean
): CatalogueSelection {
  const newest = (a: { created_at: string | null }, b: { created_at: string | null }) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  const isCatalogue = (l: PublishedList) =>
    !catalogueFlagActive || l.use_as_catalogue_pricing === true;

  // Group published lists by category (skip legacy null-category lists).
  const byCat = new Map<string, PublishedList[]>();
  for (const l of published) {
    if (!l.category_id) continue;
    const arr = byCat.get(l.category_id);
    if (arr) arr.push(l);
    else byCat.set(l.category_id, [l]);
  }

  const categoryListMap = new Map<string, { id: string; name: string }>();
  const blockedCategoryIds = new Set<string>();
  for (const [cat, cands] of byCat) {
    const catalogue = cands.filter(isCatalogue);
    if (catalogue.length === 0) {
      // Published lists exist for this family, but none may be sold from the
      // catalogue → require a Service Request.
      blockedCategoryIds.add(cat);
      continue;
    }
    const mine = catalogue.filter((c) => assignedIds.has(c.id)).sort(newest);
    const pick = mine[0] ?? [...catalogue].sort(newest)[0];
    categoryListMap.set(cat, { id: pick.id, name: pick.name });
  }
  return { categoryListMap, blockedCategoryIds };
}
