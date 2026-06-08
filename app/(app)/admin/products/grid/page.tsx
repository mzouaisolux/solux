import { redirect } from "next/navigation";

/**
 * The product grid is now the primary Product Catalog interface at
 * /admin/products. This route is kept so old links/bookmarks keep working —
 * it redirects to the catalog, preserving the ?cat deep link.
 */
export default function ProductGridRedirect({
  searchParams,
}: {
  searchParams?: { cat?: string };
}) {
  redirect(searchParams?.cat ? `/admin/products?cat=${searchParams.cat}` : "/admin/products");
}
