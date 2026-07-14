/**
 * Price-list resolution for the quote builder (pricing v5) — server-only,
 * with a PURE selection core (`selectCatalogueLists`) that is unit-tested.
 *
 * A price list is a single-category, PUBLISHED object. For a seller, the list
 * applied to a product is the published list for that product's category
 * assigned to the seller; otherwise the most recent published list for that
 * category (fallback). Only `published` lists are ever used in quotes.
 *
 * m170 — a published list ALSO has to be flagged `use_as_catalogue_pricing`
 * to feed catalogue prices. Categories that have a published list but none
 * catalogue-enabled are "blocked": their products get no auto price and the
 * builder tells sales to go through an approved Service Request.
 *
 * Returns the category→list map for pricing PLUS display context so the quote
 * UI can show which list is active, warn when a seller is assigned a list
 * that hasn't been published yet, and message the blocked categories.
 *
 * Soft-fails to empty when m087 isn't applied or on error.
 */

import { createClient } from "@/lib/supabase/server";
import {
  selectCatalogueLists,
  type PublishedList,
} from "@/lib/price-list-select";

export { selectCatalogueLists } from "@/lib/price-list-select";
export type { PublishedList, CatalogueSelection } from "@/lib/price-list-select";

export type QuotePricingContext = {
  /** categoryId → chosen published+catalogue price_list id (drives pricing). */
  categoryListMap: Map<string, string>;
  /** Lists actually applied for this seller (for the "Pricing from…" banner). */
  appliedLists: Array<{ id: string; name: string; categoryName: string | null }>;
  /** Lists the seller is ASSIGNED to but which are not published (warn). */
  assignedUnpublished: Array<{ id: string; name: string; status: string }>;
  /**
   * m170 — categories that HAVE a published list but none is catalogue-enabled.
   * Products in these families require an approved Service Request before a
   * price can be generated; the builder shows that message instead of a price.
   */
  blockedCategoryIds: Set<string>;
  /**
   * True once the catalogue-flag feature is live (m170 column readable). Lets
   * the page suppress the legacy all-prices fallback so a blocked category
   * never leaks a price. False on a pre-m170 env → today's behaviour.
   */
  catalogueFlagActive: boolean;
  /** Whether ANY price_lists exist at all (drives the pre-v5 legacy fallback). */
  hasAnyPriceList: boolean;
};

export async function getQuotePricingContext(userId: string | null): Promise<QuotePricingContext> {
  const ctx: QuotePricingContext = {
    categoryListMap: new Map(),
    appliedLists: [],
    assignedUnpublished: [],
    blockedCategoryIds: new Set(),
    catalogueFlagActive: false,
    hasAnyPriceList: false,
  };
  const supabase = createClient();
  try {
    // 1. The seller's assignments (any status).
    let assignedIds = new Set<string>();
    if (userId) {
      const { data: a } = await supabase
        .from("price_list_assignments")
        .select("price_list_id")
        .eq("assignee_type", "seller")
        .eq("assignee_id", userId);
      assignedIds = new Set((a ?? []).map((r) => r.price_list_id as string));
    }

    // 2. Warn about assigned-but-not-published lists.
    if (assignedIds.size) {
      const { data: assignedLists } = await supabase
        .from("price_lists")
        .select("id, name, status")
        .in("id", Array.from(assignedIds));
      for (const l of (assignedLists ?? []) as any[]) {
        if (l.status !== "published") ctx.assignedUnpublished.push({ id: l.id, name: l.name, status: l.status ?? "draft" });
      }
    }

    // 3. Published lists (+ the m170 catalogue flag) + category names. The flag
    //    column may not exist on an unmigrated env — probe it, and fall back to
    //    the pre-m170 select (all published lists treated as catalogue-enabled).
    let pubRows: PublishedList[] | null = null;
    {
      const withFlag = await supabase
        .from("price_lists")
        .select("id, name, category_id, created_at, use_as_catalogue_pricing")
        .eq("status", "published");
      if (!withFlag.error) {
        ctx.catalogueFlagActive = true;
        pubRows = (withFlag.data ?? []) as any as PublishedList[];
      } else {
        const legacy = await supabase
          .from("price_lists")
          .select("id, name, category_id, created_at")
          .eq("status", "published");
        pubRows = (legacy.data ?? []) as any as PublishedList[];
      }
    }
    // Does ANY price list exist? (drives the caller's pre-v5 legacy fallback.)
    {
      const { count } = await supabase
        .from("price_lists")
        .select("id", { count: "exact", head: true });
      ctx.hasAnyPriceList = (count ?? 0) > 0;
    }

    if (!pubRows || pubRows.length === 0) return ctx;

    const { data: cats } = await supabase.from("product_categories").select("id, name");
    const catName = new Map<string, string>();
    for (const c of cats ?? []) catName.set(c.id, c.name);

    // 4. PURE selection: catalogue-enabled list per category + blocked set.
    const sel = selectCatalogueLists(pubRows, assignedIds, ctx.catalogueFlagActive);
    ctx.blockedCategoryIds = sel.blockedCategoryIds;
    const applied = new Map<string, { id: string; name: string; categoryName: string | null }>();
    for (const [cat, pick] of sel.categoryListMap) {
      ctx.categoryListMap.set(cat, pick.id);
      applied.set(pick.id, { id: pick.id, name: pick.name, categoryName: catName.get(cat) ?? null });
    }
    ctx.appliedLists = Array.from(applied.values());
  } catch {
    /* m087 not applied → empty → caller uses legacy pricing */
  }
  return ctx;
}
