/**
 * Price-list resolution for the quote builder (pricing v5) — server-only.
 *
 * A price list is a single-category, PUBLISHED object. For a seller, the list
 * applied to a product is the published list for that product's category
 * assigned to the seller; otherwise the most recent published list for that
 * category (fallback). Only `published` lists are ever used in quotes.
 *
 * Returns the category→list map for pricing PLUS display context so the quote
 * UI can show which list is active and warn when a seller is assigned a list
 * that hasn't been published yet (a common "why aren't my prices showing?").
 *
 * Soft-fails to empty when m087 isn't applied or on error.
 */

import { createClient } from "@/lib/supabase/server";

export type QuotePricingContext = {
  /** categoryId → chosen published price_list id (drives pricing). */
  categoryListMap: Map<string, string>;
  /** Lists actually applied for this seller (for the "Pricing from…" banner). */
  appliedLists: Array<{ id: string; name: string; categoryName: string | null }>;
  /** Lists the seller is ASSIGNED to but which are not published (warn). */
  assignedUnpublished: Array<{ id: string; name: string; status: string }>;
};

export async function getQuotePricingContext(userId: string | null): Promise<QuotePricingContext> {
  const ctx: QuotePricingContext = { categoryListMap: new Map(), appliedLists: [], assignedUnpublished: [] };
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

    // 3. Published lists + category names.
    const [{ data: pub, error }, { data: cats }] = await Promise.all([
      supabase.from("price_lists").select("id, name, category_id, created_at").eq("status", "published"),
      supabase.from("product_categories").select("id, name"),
    ]);
    if (error || !pub || pub.length === 0) return ctx;
    const catName = new Map<string, string>();
    for (const c of cats ?? []) catName.set(c.id, c.name);

    // 4. Per category, pick the seller's assigned published list, else newest published.
    const byCat = new Map<string, Array<{ id: string; name: string; created_at: string | null }>>();
    for (const l of pub as any[]) {
      if (!l.category_id) continue;
      const arr = byCat.get(l.category_id);
      const item = { id: l.id, name: l.name, created_at: l.created_at ?? null };
      if (arr) arr.push(item);
      else byCat.set(l.category_id, [item]);
    }
    const newest = (a: { created_at: string | null }, b: { created_at: string | null }) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));

    const applied = new Map<string, { id: string; name: string; categoryName: string | null }>();
    for (const [cat, cands] of byCat) {
      const mine = cands.filter((c) => assignedIds.has(c.id)).sort(newest);
      const pick = mine[0] ?? [...cands].sort(newest)[0];
      if (pick) {
        ctx.categoryListMap.set(cat, pick.id);
        applied.set(pick.id, { id: pick.id, name: pick.name, categoryName: catName.get(cat) ?? null });
      }
    }
    ctx.appliedLists = Array.from(applied.values());
  } catch {
    /* m087 not applied → empty → caller uses legacy pricing */
  }
  return ctx;
}
