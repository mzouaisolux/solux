import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { isAdminLike } from "@/lib/types";
import { sortProductsByName } from "@/lib/product-sort";
import AccessDenied from "@/components/AccessDenied";
import ProductWorkspace from "./ProductWorkspace";

export const dynamic = "force-dynamic";

/**
 * Product Catalog — a single unified workspace for BOTH categories and
 * products (categories used to live on a separate /admin/categories page).
 * Top: a selectable categories table + inline "Add Category". Bottom: the
 * product grid filtered to the selected category. A product always belongs to
 * a category, so they're managed together: create a category → add products,
 * all on one screen with no navigation.
 */
export default async function ProductCatalogPage() {
  const { effectiveRole } = await getEffectiveRole();
  if (!isAdminLike(effectiveRole)) {
    return (
      <AccessDenied
        title="Administrators only"
        message="The product catalog is restricted to administrators."
      />
    );
  }

  const supabase = createClient();
  const [{ data: products }, { data: categories }, { data: fields }] =
    await Promise.all([
      supabase
        .from("products")
        .select("id, name, sku, category_id, image_url, active")
        .order("name"),
      supabase
        .from("product_categories")
        .select("id, name, position")
        .eq("is_template", false)
        .order("position")
        .order("name"),
      supabase.from("config_fields").select("category_id").eq("active", true),
    ]);

  const productList = sortProductsByName(
    (products ?? []) as Array<{
      id: string;
      name: string;
      sku: string | null;
      category_id: string | null;
      image_url: string | null;
      active: boolean | null;
    }>
  );

  // Counts derived from the SAME products array the grid renders, so the
  // categories table and the grid never disagree.
  const productCountByCat = new Map<string, number>();
  let uncategorizedCount = 0;
  for (const p of productList) {
    if (p.category_id) productCountByCat.set(p.category_id, (productCountByCat.get(p.category_id) ?? 0) + 1);
    else uncategorizedCount++;
  }
  const fieldCountByCat = new Map<string, number>();
  for (const f of fields ?? []) {
    if (f.category_id) fieldCountByCat.set(f.category_id, (fieldCountByCat.get(f.category_id) ?? 0) + 1);
  }

  const cats = ((categories ?? []) as Array<{ id: string; name: string; position: number }>).map(
    (c) => ({
      id: c.id,
      name: c.name,
      position: c.position ?? 0,
      productCount: productCountByCat.get(c.id) ?? 0,
      fieldCount: fieldCountByCat.get(c.id) ?? 0,
    })
  );

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-5">
      <div>
        <div className="eyebrow">Admin · Pricing</div>
        <h1 className="doc-title mt-1">Product Catalog</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Manage categories and products from a single workspace. Costs and prices live under
          Cost Entry / Price Lists.
        </p>
      </div>
      <ProductWorkspace
        categories={cats}
        products={productList}
        uncategorizedCount={uncategorizedCount}
      />
    </div>
  );
}
