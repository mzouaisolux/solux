import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  updateProduct,
  deleteProduct,
  addOption,
  deleteOption,
  addPriceVersion,
  deletePriceVersion,
} from "../actions";

export default async function AdminProductEditPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  const [
    { data: product },
    { data: options },
    { data: prices },
    { data: cost },
    { data: categories },
  ] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, sku, category, category_id, base_price, image_url, active")
      .eq("id", params.id)
      .maybeSingle(),
    supabase
      .from("options")
      .select("id, option_type, option_value, price_modifier")
      .eq("product_id", params.id)
      .order("option_type", { ascending: true })
      .order("option_value", { ascending: true }),
    supabase
      .from("prices_version")
      .select("id, price, valid_from, pricing_tier")
      .eq("product_id", params.id)
      .order("valid_from", { ascending: false }),
    supabase
      .from("product_costs")
      .select("cost_price")
      .eq("product_id", params.id)
      .maybeSingle(),
    supabase
      .from("product_categories")
      .select("id, name")
      .eq("is_template", false)   // templates are structural only, not assignable
      .order("position")
      .order("name"),
  ]);

  if (!product) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const currentCost = cost?.cost_price ?? 0;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{product.name}</h1>
        <Link href="/admin/products" className="text-sm hover:underline">
          ← Back to products
        </Link>
      </div>

      {/* ---------- PRODUCT FIELDS ---------- */}
      <section className="rounded-lg border bg-white p-5 space-y-3">
        <h2 className="text-lg font-semibold">Details</h2>
        <form action={updateProduct} className="space-y-3">
          <input type="hidden" name="id" value={product.id} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Name</span>
              <input
                name="name"
                defaultValue={product.name ?? ""}
                className="mt-1 w-full rounded border px-3 py-2"
              />
              <p className="text-xs text-neutral-500 mt-1">
                Set a <b>Variant</b> below to auto-name as{" "}
                <b>Category + Variant</b>. Edit here only to override.
              </p>
            </label>
            <label className="block">
              <span className="text-sm font-medium">
                Variant{" "}
                <span className="text-xs text-neutral-500">
                  (e.g. B-80, 120 — blank for single-model families)
                </span>
              </span>
              <input
                name="variant"
                placeholder="B-80"
                className="mt-1 w-full rounded border px-3 py-2"
              />
              <p className="text-xs text-neutral-500 mt-1">
                Name becomes <b>Category + Variant</b> (e.g. &ldquo;Vandal
                B-80&rdquo;). Leave blank to keep the Name above.
              </p>
            </label>
            <label className="block">
              <span className="text-sm font-medium">
                SKU{" "}
                <span className="text-xs text-neutral-500">
                  (unique identifier used for image matching)
                </span>
              </span>
              <input
                name="sku"
                defaultValue={product.sku ?? ""}
                className="mt-1 w-full rounded border px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium">
                Category *{" "}
                <span className="text-xs text-neutral-500">
                  (drives the configuration fields shown to sales users)
                </span>
              </span>
              <select
                name="category_id"
                required
                defaultValue={product.category_id ?? ""}
                className="mt-1 w-full rounded border px-3 py-2"
              >
                <option value="" disabled>
                  Select a category
                </option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-neutral-500 mt-1">
                Manage categories &amp; their configuration fields under{" "}
                <a
                  href="/admin/categories"
                  className="underline hover:text-neutral-900"
                >
                  Admin → Categories
                </a>
                .
              </p>
            </label>
            <label className="block">
              <span className="text-sm font-medium">
                Cost price{" "}
                <span className="text-xs text-neutral-500">(admin only)</span>
              </span>
              <input
                name="cost_price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={currentCost}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Image URL</span>
              <input
                name="image_url"
                defaultValue={product.image_url ?? ""}
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            Tier prices (High / Medium / Low) are managed in the{" "}
            <b>Price history</b> section below.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={product.active}
            />
            Active
          </label>
          <div className="flex items-center justify-between pt-2">
            <button className="rounded bg-solux px-3 py-2 text-white font-medium hover:bg-solux-dark">
              Save
            </button>
          </div>
        </form>
        <form action={deleteProduct}>
          <input type="hidden" name="id" value={product.id} />
          <button className="text-sm text-red-600 hover:underline">
            Delete product
          </button>
        </form>
      </section>

      {/* ---------- OPTIONS ---------- */}
      <section className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-lg font-semibold">Options</h2>

        <form
          action={addOption}
          className="grid grid-cols-1 md:grid-cols-4 gap-3"
        >
          <input type="hidden" name="product_id" value={product.id} />
          <input
            name="option_type"
            placeholder="Type (e.g. CCT)"
            required
            className="rounded border px-3 py-2"
          />
          <input
            name="option_value"
            placeholder="Value (e.g. 4000K)"
            required
            className="rounded border px-3 py-2"
          />
          <input
            name="price_modifier"
            type="number"
            step="0.01"
            placeholder="Price modifier"
            className="rounded border px-3 py-2"
          />
          <button className="rounded bg-neutral-900 px-3 py-2 text-white font-medium hover:bg-neutral-700">
            Add option
          </button>
        </form>

        <table className="w-full text-sm">
          <thead className="bg-neutral-100 text-left">
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2 text-right">Modifier</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(options ?? []).map((o) => (
              <tr key={o.id} className="border-t">
                <td className="px-3 py-2">{o.option_type}</td>
                <td className="px-3 py-2">{o.option_value}</td>
                <td className="px-3 py-2 text-right">
                  {Number(o.price_modifier).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right">
                  <form action={deleteOption} className="inline">
                    <input type="hidden" name="id" value={o.id} />
                    <input type="hidden" name="product_id" value={product.id} />
                    <button className="text-red-600 hover:underline">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {(!options || options.length === 0) && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-neutral-500">
                  No options yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ---------- PRICE VERSIONS ---------- */}
      <section className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-lg font-semibold">Price history</h2>
        <p className="text-sm text-neutral-500">
          Auto-pricing picks the latest entry for the chosen{" "}
          <b>pricing tier</b> whose <code>valid_from</code> is on or before
          today. If no tier-specific price exists, the product&apos;s base
          price is used.
        </p>

        <form
          action={addPriceVersion}
          className="grid grid-cols-1 md:grid-cols-4 gap-3"
        >
          <input type="hidden" name="product_id" value={product.id} />
          <select
            name="pricing_tier"
            defaultValue="medium"
            className="rounded border px-3 py-2"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <input
            name="price"
            type="number"
            step="0.01"
            min="0"
            placeholder="Price"
            required
            className="rounded border px-3 py-2"
          />
          <input
            name="valid_from"
            type="date"
            defaultValue={today}
            className="rounded border px-3 py-2"
          />
          <button className="rounded bg-neutral-900 px-3 py-2 text-white font-medium hover:bg-neutral-700">
            Add price
          </button>
        </form>

        <table className="w-full text-sm">
          <thead className="bg-neutral-100 text-left">
            <tr>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Valid from</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(prices ?? []).map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2 capitalize">{p.pricing_tier}</td>
                <td className="px-3 py-2">{p.valid_from}</td>
                <td className="px-3 py-2 text-right">
                  {Number(p.price).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right">
                  <form action={deletePriceVersion} className="inline">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="product_id" value={product.id} />
                    <button className="text-red-600 hover:underline">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {(!prices || prices.length === 0) && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-neutral-500">
                  No price history yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
