"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyDiscount,
  computeMargin,
  resolveStandardUnitPrice,
} from "@/lib/pricing";
import {
  CUSTOM_OPTION_SENTINEL,
  customValueKey,
  type ConfigField,
  type CostMap,
  type DiscountType,
  type DocumentLine,
  type Option,
  type PricingMode,
  type PricingTier,
  type Product,
  type TierPriceMap,
} from "@/lib/types";

const TIERS: PricingTier[] = ["high", "medium", "low"];
const FAV_KEY = "solux:favorite_products";
const UNCATEGORIZED = "Uncategorized";

function loadFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAV_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // localStorage full / disabled — silently ignore
  }
}

/**
 * Free-text / manual line card (no catalogue product).
 *
 * Used for lines that carry a `client_product_name` but no `product_id` —
 * e.g. a Project Product generated from a Project Request. These must NEVER
 * show the catalogue picker; the user edits the description / qty / unit price
 * directly. Catalogue lines (product_id set) and fresh empty lines
 * (client_product_name null) are unaffected — they keep the normal flow.
 */
function FreeTextLineCard({
  value,
  onChange,
  onRemove,
}: {
  value: DocumentLine;
  onChange: (line: DocumentLine) => void;
  onRemove?: () => void;
}) {
  function commit(patch: Partial<DocumentLine>) {
    const next = { ...value, ...patch };
    const unit = Math.max(0, Number(next.unit_price || 0));
    const qty = Math.max(0, Number(next.quantity || 0));
    onChange({
      ...next,
      pricing_mode: "manual",
      original_unit_price: unit,
      unit_price: unit,
      total_price: unit * qty,
    });
  }

  const unit = Math.max(0, Number(value.unit_price || 0));
  const qty = Math.max(0, Number(value.quantity || 0));
  const lineTotal = unit * qty;

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
            Project product
          </span>
          <span className="text-xs text-neutral-500">
            Generated from a project request — not from the catalogue
          </span>
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded border border-neutral-200 px-2.5 py-1 text-sm text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
        )}
      </div>

      <div>
        <div className="eyebrow mb-1">Description</div>
        <textarea
          value={value.client_product_name ?? ""}
          onChange={(e) => commit({ client_product_name: e.target.value })}
          rows={2}
          className="w-full rounded border px-3 py-2 text-sm"
          placeholder="Product description shown on the quotation"
        />
      </div>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div>
          <div className="eyebrow mb-1">Unit price</div>
          <input
            type="number"
            min={0}
            step="0.01"
            value={value.unit_price ?? 0}
            onChange={(e) => commit({ unit_price: Number(e.target.value) })}
            className="w-32 rounded border px-3 py-2 text-sm text-right"
          />
        </div>
        <div>
          <div className="eyebrow mb-1">Quantity</div>
          <input
            type="number"
            min={0}
            step="1"
            value={value.quantity ?? 0}
            onChange={(e) => commit({ quantity: Number(e.target.value) })}
            className="w-24 rounded border px-3 py-2 text-sm text-right"
          />
        </div>
        <div className="ml-auto text-right">
          <div className="eyebrow mb-1">Line total</div>
          <div className="text-lg font-bold text-neutral-900">
            {lineTotal.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}

type Props = {
  products: Product[];
  options: Option[];
  tierPrices: TierPriceMap;
  costs?: CostMap | null; // admin-only; null/undefined = hidden
  isAdmin?: boolean;
  /** Dynamic configuration fields grouped by product category. */
  fieldsByCategory?: Map<string, ConfigField[]>;
  value: DocumentLine;
  onChange: (line: DocumentLine) => void;
  onRemove?: () => void;
  onClearSuggestion?: () => void; // hides the "previous" comparison
};

export default function ProductConfigurator({
  products,
  options,
  tierPrices,
  costs,
  isAdmin = false,
  fieldsByCategory,
  value,
  onChange,
  onRemove,
  onClearSuggestion,
}: Props) {
  const product = useMemo(
    () => products.find((p) => p.id === value.product_id) ?? null,
    [products, value.product_id]
  );

  const productOptions = useMemo(
    () => (product ? options.filter((o) => o.product_id === product.id) : []),
    [options, product]
  );

  // ----- picker state -----
  const [pickerOpen, setPickerOpen] = useState(!product);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  // Configuration is collapsed by default (most sales price first, configure
  // later) — but auto-expanded when the line already carries config/options
  // so existing/revised quotes don't hide their setup.
  const [configOpen, setConfigOpen] = useState(() => {
    const hasOpts = Object.values(value.selected_options ?? {}).some(
      (v) => v != null && v !== ""
    );
    const hasCfg = Object.values(value.config_values ?? {}).some(
      (v) => v != null && v !== ""
    );
    return hasOpts || hasCfg;
  });

  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  function toggleFavorite(id: string) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavorites(next);
      return next;
    });
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) set.add(p.category?.trim() || UNCATEGORIZED);
    return Array.from(set).sort();
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const cat = p.category?.trim() || UNCATEGORIZED;
      if (categoryFilter && cat !== categoryFilter) return false;
      if (showFavoritesOnly && !favorites.has(p.id)) return false;
      if (q) {
        const hay = `${p.name} ${p.sku ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, categoryFilter, showFavoritesOnly, favorites, search]);

  const groups = useMemo(() => {
    const g: Record<string, Option[]> = {};
    for (const o of productOptions) (g[o.option_type] ||= []).push(o);
    return g;
  }, [productOptions]);

  // Project-generated / free-text line: no catalogue product, but the line
  // carries its own name (e.g. a Project Product from a Project Request). Edit
  // it inline — NEVER force the catalogue picker. We key off client_product_name
  // being non-null (a string, even if emptied) rather than non-empty, so a
  // fresh blank line — emptyLine() sets it to null — still opens the picker,
  // while a project line stays a free-text card even if its text is cleared.
  // (All hooks above run unconditionally, so this early return is safe.)
  if (!value.product_id && value.client_product_name != null) {
    return (
      <FreeTextLineCard value={value} onChange={onChange} onRemove={onRemove} />
    );
  }

  function pickProduct(id: string) {
    commit({ product_id: id, selected_options: {} });
    setPickerOpen(false);
  }

  // Shared picker UI (rendered in two places: empty state + "change product").
  function Picker() {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCategoryFilter(null)}
            className={`rounded-full border px-3 py-1 text-xs ${
              categoryFilter === null ? "bg-black text-white" : "bg-white"
            }`}
          >
            All
          </button>
          {favorites.size > 0 && (
            <button
              type="button"
              onClick={() => setShowFavoritesOnly((v) => !v)}
              className={`rounded-full border px-3 py-1 text-xs ${
                showFavoritesOnly ? "bg-amber-500 text-white border-amber-500" : "bg-white"
              }`}
            >
              ★ Favorites ({favorites.size})
            </button>
          )}
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() =>
                setCategoryFilter(categoryFilter === c ? null : c)
              }
              className={`rounded-full border px-3 py-1 text-xs ${
                categoryFilter === c ? "bg-black text-white" : "bg-white"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <input
          type="search"
          placeholder="Search by name or SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded border px-3 py-2 text-sm"
        />

        {filteredProducts.length === 0 ? (
          <p className="text-sm text-neutral-500 py-4 text-center">
            No products match.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[420px] overflow-y-auto pr-1">
            {filteredProducts.map((p) => {
              const isSelected = product?.id === p.id;
              const isFav = favorites.has(p.id);
              return (
                <div
                  key={p.id}
                  className={`relative rounded-lg border bg-white p-2 text-left hover:border-solux hover:shadow-sm transition ${
                    isSelected ? "border-solux ring-1 ring-solux" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(p.id);
                    }}
                    className={`absolute top-1 right-1 text-lg leading-none ${
                      isFav ? "text-amber-500" : "text-neutral-300 hover:text-amber-500"
                    }`}
                    aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                    title={isFav ? "Remove from favorites" : "Add to favorites"}
                  >
                    {isFav ? "★" : "☆"}
                  </button>
                  <button
                    type="button"
                    onClick={() => pickProduct(p.id)}
                    className="block w-full text-left"
                  >
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.image_url}
                        alt={p.name}
                        loading="lazy"
                        className="w-full aspect-square object-cover rounded border bg-white"
                      />
                    ) : (
                      <div className="w-full aspect-square rounded border bg-neutral-50 flex items-center justify-center text-neutral-400 text-xs">
                        No image
                      </div>
                    )}
                    <div className="mt-2 text-sm font-medium leading-tight line-clamp-2">
                      {p.name}
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5 truncate">
                      {p.sku ? (
                        <span className="font-mono">{p.sku}</span>
                      ) : (
                        "—"
                      )}
                      {p.category ? ` · ${p.category}` : ""}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---- empty state: no product picked yet ----
  if (!product) {
    return (
      <div className="rounded-lg border bg-white p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Pick a product</h3>
            <p className="text-xs text-neutral-500">
              Choose a category (or search) to find the product, then click a
              card to configure.
            </p>
          </div>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded border px-2 py-1 text-sm text-red-600 hover:bg-red-50"
            >
              Remove line
            </button>
          )}
        </div>
        <Picker />
      </div>
    );
  }

  const standardPrice = resolveStandardUnitPrice(
    product,
    value.pricing_tier,
    value.selected_options,
    productOptions,
    tierPrices
  );
  // When no tier price exists, auto-mode shows 0 and a warning is rendered.
  const priceMissing = standardPrice === null;
  const effectiveStandard = standardPrice ?? 0;

  const originalPrice =
    value.pricing_mode === "auto"
      ? effectiveStandard
      : value.original_unit_price;
  const finalUnit = applyDiscount(
    originalPrice,
    value.discount_type,
    value.discount_value
  );
  const lineTotal = finalUnit * Math.max(value.quantity, 0);
  const discountAmount = originalPrice - finalUnit;

  const margin = isAdmin && costs
    ? computeMargin(finalUnit, costs[product.id])
    : null;

  // Single commit on any state change: merge derived prices so save payload is correct.
  function commit(patch: Partial<DocumentLine>) {
    const next = { ...value, ...patch };

    // Re-resolve derived values based on the new state.
    const nextProduct =
      products.find((p) => p.id === next.product_id) ?? product;
    if (!nextProduct) {
      onChange(next);
      return;
    }
    const nextProductOptions = options.filter(
      (o) => o.product_id === nextProduct.id
    );
    const nextStandard = resolveStandardUnitPrice(
      nextProduct,
      next.pricing_tier,
      next.selected_options,
      nextProductOptions,
      tierPrices
    );
    const nextEffectiveStandard = nextStandard ?? 0;
    const nextOriginal =
      next.pricing_mode === "auto"
        ? nextEffectiveStandard
        : next.original_unit_price;
    const nextFinal = applyDiscount(
      nextOriginal,
      next.discount_type,
      next.discount_value
    );
    const nextTotal = nextFinal * Math.max(next.quantity, 0);

    onChange({
      ...next,
      original_unit_price: nextOriginal,
      unit_price: nextFinal,
      total_price: nextTotal,
    });
  }

  function setTier(t: PricingTier) {
    commit({ pricing_tier: t });
  }

  function setPricingMode(mode: PricingMode) {
    // Seed manual mode with the current standard so the number stays sensible.
    const patch: Partial<DocumentLine> = { pricing_mode: mode };
    if (mode === "manual") patch.original_unit_price = effectiveStandard;
    commit(patch);
  }

  function setDiscountType(dt: DiscountType | "") {
    commit({
      discount_type: dt === "" ? null : dt,
      discount_value: dt === "" ? 0 : value.discount_value,
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3.5 shadow-sm">
      {/* Suggestion banner */}
      {value.previous_unit_price !== undefined && (
        <div className="flex items-start justify-between gap-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs">
          <div>
            <span className="font-medium text-amber-800">
              Price pre-filled from previous quotation (editable)
            </span>
            <div className="mt-1 text-amber-900">
              Standard ({value.pricing_tier}):{" "}
              <b>{standardPrice != null ? standardPrice.toFixed(2) : "—"}</b>{" "}
              · Previous: <b>{value.previous_unit_price.toFixed(2)}</b>
            </div>
          </div>
          {onClearSuggestion && (
            <button
              type="button"
              onClick={onClearSuggestion}
              className="text-amber-800 hover:underline"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* ---------- HEADER: thumbnail + prominent product name + actions ---------- */}
      <div className="flex items-start gap-3">
        {/* Small thumbnail keeps the card recognizable + unified without
            spending a whole column on the product image. */}
        <div className="h-12 w-12 shrink-0 rounded-md border border-neutral-200 bg-neutral-50 overflow-hidden">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold leading-tight truncate text-neutral-900">
              {product.name}
            </h3>
            <button
              type="button"
              onClick={() => toggleFavorite(product.id)}
              className={`text-lg leading-none ${
                favorites.has(product.id)
                  ? "text-amber-500"
                  : "text-neutral-300 hover:text-amber-500"
              }`}
              title={
                favorites.has(product.id)
                  ? "Remove from favorites"
                  : "Add to favorites"
              }
            >
              {favorites.has(product.id) ? "★" : "☆"}
            </button>
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            {product.sku && (
              <span className="font-mono mr-2">{product.sku}</span>
            )}
            {product.category && (
              <span className="uppercase tracking-widerx">{product.category}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="rounded border border-neutral-200 px-2.5 py-1 text-sm hover:bg-neutral-50"
          >
            {pickerOpen ? "Cancel" : "Change product"}
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded border border-neutral-200 px-2.5 py-1 text-sm text-red-600 hover:bg-red-50"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {pickerOpen && (
        <div className="border-t border-neutral-100 pt-3">
          <Picker />
        </div>
      )}

      {/* ---------- PRICING (primary business action) ----------
          This is a quotation workflow first, so pricing LEADS the card
          and visually dominates. Reads as one horizontal sentence:
          Tier → Unit price → Qty → Discount → Line total, with the
          Automatic / Manual source demoted to a small toggle far right. */}
      <div className="border-t border-neutral-100 pt-3.5">
        <div className="flex items-start gap-x-5 gap-y-3 flex-wrap">
          {/* TIER — loud active state so the chosen tier is unmistakable */}
          <div>
            <div className="eyebrow mb-1.5">Tier</div>
            <div className="inline-flex rounded-lg bg-white border border-neutral-200 p-0.5">
              {TIERS.map((t) => {
                const has = tierPrices[product.id]?.[t] !== undefined;
                const active = value.pricing_tier === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTier(t)}
                    className={`px-3.5 py-1.5 rounded-md text-sm font-semibold capitalize transition-all ${
                      active
                        ? "bg-solux text-white shadow-sm"
                        : `bg-transparent hover:text-neutral-900 ${
                            !has ? "text-red-500" : "text-neutral-500"
                          }`
                    }`}
                    title={has ? "" : `No price recorded for ${t} tier`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* UNIT PRICE — hero number; updates the instant a tier is clicked */}
          <div>
            <div className="eyebrow mb-1.5">Unit price</div>
            {value.pricing_mode === "manual" ? (
              <input
                type="number"
                min={0}
                step="0.01"
                value={value.original_unit_price}
                onChange={(e) =>
                  commit({
                    original_unit_price: parseFloat(e.target.value) || 0,
                  })
                }
                style={{
                  width: `${Math.max(
                    120,
                    String(value.original_unit_price).length * 17 + 28
                  )}px`,
                }}
                className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-2xl font-semibold tabular-nums focus:outline-none focus:ring-1 focus:ring-solux/40"
              />
            ) : (
              <div
                className={`text-2xl font-semibold tabular-nums leading-none py-1 ${
                  priceMissing ? "text-red-600" : "text-neutral-900"
                }`}
              >
                {standardPrice != null ? standardPrice.toFixed(2) : "—"}
              </div>
            )}
            <div className="text-[11px] text-neutral-400 mt-1 tabular-nums">
              {value.discount_type && Number(value.discount_value) > 0
                ? `−${discountAmount.toFixed(2)} → ${finalUnit.toFixed(2)}/u`
                : value.pricing_mode === "manual"
                ? "manual price"
                : `standard · ${value.pricing_tier}`}
              {isAdmin && margin
                ? ` · margin ${margin.marginPct.toFixed(0)}%`
                : ""}
            </div>
          </div>

          {/* QTY — plain numeric text input (no +/- stepper), grows with
              content so large runs stay fully readable + fast to type. */}
          <div>
            <div className="eyebrow mb-1.5">Qty</div>
            <input
              type="text"
              inputMode="numeric"
              value={value.quantity ? String(value.quantity) : ""}
              placeholder="0"
              onChange={(e) => {
                const digits = e.target.value.replace(/[^\d]/g, "");
                commit({ quantity: digits === "" ? 0 : parseInt(digits, 10) });
              }}
              style={{
                width: `${Math.max(
                  84,
                  String(value.quantity || "").length * 18 + 28
                )}px`,
              }}
              className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xl font-medium tabular-nums text-center focus:outline-none focus:ring-1 focus:ring-solux/40"
            />
          </div>

          {/* DISCOUNT — small + secondary */}
          <div>
            <div className="eyebrow mb-1.5">Discount</div>
            <div className="flex items-center gap-1 pt-1.5">
              <select
                value={value.discount_type ?? ""}
                onChange={(e) =>
                  setDiscountType(e.target.value as DiscountType | "")
                }
                className="rounded-md border border-neutral-200 bg-white px-1.5 py-1.5 text-sm focus:outline-none"
              >
                <option value="">None</option>
                <option value="percentage">%</option>
                <option value="fixed">Fixed</option>
              </select>
              {value.discount_type && (
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={value.discount_value}
                  onChange={(e) =>
                    commit({ discount_value: parseFloat(e.target.value) || 0 })
                  }
                  className="w-16 rounded-md border border-neutral-200 bg-white px-1.5 py-1.5 text-sm text-right tabular-nums focus:outline-none"
                />
              )}
            </div>
          </div>

          {/* LINE TOTAL (most prominent) + source toggle (far right) */}
          <div className="ml-auto flex items-start gap-6">
            <div className="text-right">
              <div className="eyebrow mb-1.5">Line total</div>
              <div className="text-2xl font-bold tabular-nums leading-none text-neutral-900">
                {lineTotal.toFixed(2)}
              </div>
              <div className="text-[11px] text-neutral-400 mt-1 tabular-nums">
                {value.quantity} × {finalUnit.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="eyebrow mb-1.5">Source</div>
              <div className="inline-flex rounded-md border border-neutral-200 overflow-hidden text-[11px]">
                <button
                  type="button"
                  onClick={() => setPricingMode("auto")}
                  className={`px-2.5 py-1.5 ${
                    value.pricing_mode === "auto"
                      ? "bg-neutral-900 text-white"
                      : "bg-white hover:bg-neutral-50 text-neutral-500"
                  }`}
                >
                  Auto
                </button>
                <button
                  type="button"
                  onClick={() => setPricingMode("manual")}
                  className={`px-2.5 py-1.5 ${
                    value.pricing_mode === "manual"
                      ? "bg-neutral-900 text-white"
                      : "bg-white hover:bg-neutral-50 text-neutral-500"
                  }`}
                >
                  Manual
                </button>
              </div>
            </div>
          </div>
        </div>

        {priceMissing && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <b>No price found for this product and pricing tier.</b> Pick a
            different tier, add a price row in{" "}
            <i>Admin → Products → Price history</i>, or switch to{" "}
            <b>Manual</b> pricing.
          </div>
        )}
      </div>

      {/* ---------- REFERENCES (kept INSIDE the card so everything for one
          product — pricing, config, references — stays one clear block) ---------- */}
      <div className="border-t border-neutral-100 pt-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <span className="eyebrow sm:w-52 shrink-0">
          Client reference{" "}
          <span className="normal-case tracking-normal text-neutral-400">
            (optional)
          </span>
        </span>
        <input
          type="text"
          value={value.client_product_name ?? ""}
          placeholder="e.g. SolarMax 40 — shown next to the internal name on the PDF"
          onChange={(e) =>
            commit({ client_product_name: e.target.value || null })
          }
          className="flex-1 min-w-0 rounded-md border border-neutral-200 px-3 py-1.5 text-sm"
        />
        <span className="text-[11px] text-neutral-500 sm:ml-1 shrink-0">
          Internal: <b className="font-mono">{product.name}</b>
        </span>
      </div>

      {/* ---------- CONFIGURATION — collapsed by default (Now / Later) ----------
          Most sales price first and configure later, so this stays minimized
          until "Configure now" is clicked — saving a lot of vertical space
          when a quote has many products. Auto-expanded when values exist. */}
      {(() => {
        const categoryFields = product.category_id
          ? fieldsByCategory?.get(product.category_id) ?? []
          : [];
        const optionTypes = Object.entries(groups);
        const totalCfg = optionTypes.length + categoryFields.length;
        if (totalCfg === 0) return null;

        const configValues = value.config_values ?? {};
        const setConfig = (patch: Record<string, string>) =>
          commit({ config_values: { ...configValues, ...patch } });
        const setOpts = Object.values(value.selected_options ?? {}).filter(
          (v) => v != null && v !== ""
        ).length;
        const setFields = categoryFields.filter((f) => {
          const v = configValues[f.field_name];
          return v != null && v !== "";
        }).length;
        const setCount = setOpts + setFields;

        return (
          <div className="border-t border-neutral-100 pt-3">
            {!configOpen ? (
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-medium text-neutral-700">
                    Configuration
                  </span>
                  <span className="ml-2 text-xs text-neutral-400">
                    {totalCfg} field{totalCfg === 1 ? "" : "s"}
                    {setCount > 0
                      ? ` · ${setCount} set`
                      : " · not configured yet"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setConfigOpen(true)}
                  className="rounded-md bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-800"
                >
                  Configure now
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="eyebrow">Configuration</div>
                  <button
                    type="button"
                    onClick={() => setConfigOpen(false)}
                    className="text-xs text-neutral-500 hover:text-neutral-900"
                  >
                    Configure later ▲
                  </button>
                </div>
                {optionTypes.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {optionTypes.map(([type, opts]) => (
                      <label key={type} className="block">
                        <div className="eyebrow mb-1.5">{type}</div>
                        <select
                          value={value.selected_options[type] ?? ""}
                          onChange={(e) =>
                            commit({
                              selected_options: {
                                ...value.selected_options,
                                [type]: e.target.value,
                              },
                            })
                          }
                          className="w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm"
                        >
                          <option value="">— select —</option>
                          {opts.map((o) => (
                            <option key={o.id} value={o.option_value}>
                              {o.option_value}
                              {Number(o.price_modifier) > 0
                                ? ` (+${o.price_modifier})`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                )}
                {categoryFields.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {categoryFields.map((f) => (
                      <ConfigFieldInput
                        key={f.id}
                        field={f}
                        values={configValues}
                        onChange={setConfig}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

    </div>
  );
}

/**
 * Single field input — switches on `field_type`. Dropdowns with
 * `allow_custom_value` get a "Custom…" choice that reveals a free-text input.
 * Custom text is stored under a `${field_name}__custom` key so we can keep
 * the original dropdown selection separate.
 */
export function ConfigFieldInput({
  field: f,
  values,
  onChange,
}: {
  field: ConfigField;
  values: Record<string, string>;
  onChange: (patch: Record<string, string>) => void;
}) {
  const current = values[f.field_name] ?? f.default_value ?? "";
  const customKey = customValueKey(f.field_name);
  const customText = values[customKey] ?? "";
  const isCustom = current === CUSTOM_OPTION_SENTINEL;

  const labelHeader = (
    <div className="eyebrow mb-1.5">
      {f.field_name}
      {f.required && <span className="text-red-600"> *</span>}
      {f.internal_only && (
        <span className="ml-1 normal-case tracking-normal text-[10px] text-amber-700">
          (internal)
        </span>
      )}
    </div>
  );

  if (f.field_type === "dropdown") {
    return (
      <label className="block">
        {labelHeader}
        <select
          value={current}
          onChange={(e) => {
            const v = e.target.value;
            if (v !== CUSTOM_OPTION_SENTINEL) {
              // Leaving custom mode — clear the side-channel value too.
              onChange({ [f.field_name]: v, [customKey]: "" });
            } else {
              onChange({ [f.field_name]: v });
            }
          }}
          className="w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm"
        >
          <option value="">{f.placeholder ?? "— select —"}</option>
          {(f.options ?? []).map((o) => (
            <option key={o.id} value={o.option_value}>
              {o.option_value}
            </option>
          ))}
          {f.allow_custom_value && (
            <option value={CUSTOM_OPTION_SENTINEL}>Custom…</option>
          )}
        </select>
        {isCustom && (
          <>
            <input
              type="text"
              value={customText}
              placeholder="Type your custom value"
              autoFocus
              onChange={(e) => onChange({ [customKey]: e.target.value })}
              className="mt-1.5 w-full rounded-md border border-solux px-3 py-1.5 text-sm"
            />
            {customText.trim() === "" && (
              <p className="mt-1 text-[11px] text-amber-700">
                Type a value or switch back to one of the listed options —
                empty custom values won't appear on the task list or PDF.
              </p>
            )}
          </>
        )}
      </label>
    );
  }

  if (f.field_type === "text") {
    return (
      <label className="block">
        {labelHeader}
        <input
          type="text"
          value={current}
          placeholder={f.placeholder ?? ""}
          onChange={(e) => onChange({ [f.field_name]: e.target.value })}
          className="w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm"
        />
      </label>
    );
  }

  if (f.field_type === "number") {
    return (
      <label className="block">
        {labelHeader}
        <input
          type="number"
          value={current}
          placeholder={f.placeholder ?? ""}
          onChange={(e) => onChange({ [f.field_name]: e.target.value })}
          className="w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm tabular-nums"
        />
      </label>
    );
  }

  if (f.field_type === "checkbox") {
    // Boolean field rendered as a Yes/No segmented control. Exactly one
    // option is always selected — anything other than the literal "true"
    // counts as "No" (covers undefined, empty string, and legacy "false").
    const choice: "yes" | "no" = current === "true" ? "yes" : "no";
    return (
      <div className="block">
        {labelHeader}
        <div
          role="radiogroup"
          aria-label={f.field_name}
          className="inline-flex rounded-md border border-neutral-200 overflow-hidden text-sm"
        >
          <button
            type="button"
            role="radio"
            aria-checked={choice === "yes"}
            onClick={() => onChange({ [f.field_name]: "true" })}
            className={`px-4 py-1.5 font-medium transition ${
              choice === "yes"
                ? "bg-solux text-white"
                : "bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            Yes
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={choice === "no"}
            onClick={() => onChange({ [f.field_name]: "false" })}
            className={`px-4 py-1.5 font-medium border-l border-neutral-200 transition ${
              choice === "no"
                ? "bg-neutral-900 text-white"
                : "bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            No
          </button>
        </div>
        {f.placeholder && (
          <p className="text-[11px] text-neutral-500 mt-1">{f.placeholder}</p>
        )}
      </div>
    );
  }

  if (f.field_type === "textarea") {
    return (
      <label className="block sm:col-span-2">
        {labelHeader}
        <textarea
          value={current}
          placeholder={f.placeholder ?? ""}
          onChange={(e) => onChange({ [f.field_name]: e.target.value })}
          rows={2}
          className="w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm"
        />
      </label>
    );
  }

  if (f.field_type === "checkbox_group") {
    // Value is stored as JSON-stringified string[].
    // "" / missing → empty array. Parse defensively.
    let selected: string[] = [];
    try {
      const parsed = current ? JSON.parse(current) : [];
      if (Array.isArray(parsed)) selected = parsed.map(String);
    } catch {
      // Legacy or corrupted value — treat as empty.
    }

    function toggle(opt: string) {
      const next = selected.includes(opt)
        ? selected.filter((v) => v !== opt)
        : [...selected, opt];
      onChange({ [f.field_name]: next.length ? JSON.stringify(next) : "" });
    }

    return (
      <div className="block sm:col-span-2">
        {labelHeader}
        {(f.options ?? []).length === 0 ? (
          <p className="text-xs text-neutral-400 italic">
            No options defined yet — add them in Admin → Categories.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5 mt-1">
            {(f.options ?? []).map((o) => {
              const checked = selected.includes(o.option_value);
              return (
                <label
                  key={o.id}
                  className="inline-flex items-center gap-2.5 cursor-pointer select-none"
                >
                  <span
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggle(o.option_value)}
                    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition cursor-pointer ${
                      checked
                        ? "border-solux bg-solux text-white"
                        : "border-neutral-300 bg-white"
                    }`}
                  >
                    {checked && (
                      <svg
                        viewBox="0 0 10 10"
                        className="h-2.5 w-2.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden
                      >
                        <path d="M1.5 5l2.5 2.5 4.5-4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span
                    onClick={() => toggle(o.option_value)}
                    className="text-sm text-neutral-800"
                  >
                    {o.option_value}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {f.placeholder && (
          <p className="text-[11px] text-neutral-500 mt-1">{f.placeholder}</p>
        )}
      </div>
    );
  }

  return null;
}
