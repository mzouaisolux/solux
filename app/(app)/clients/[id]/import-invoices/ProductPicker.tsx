"use client";

import { useState } from "react";
import type { ProductOption } from "@/lib/import/dto";

/** Lightweight searchable product picker for the "match existing product"
 *  resolver. Filters by name or SKU; shows the first matches. */
export function ProductPicker({
  products,
  onPick,
  placeholder,
}: {
  products: ProductOption[];
  onPick: (p: ProductOption) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const ql = q.trim().toLowerCase();
  const results = (
    ql
      ? products.filter(
          (p) =>
            p.name.toLowerCase().includes(ql) ||
            (p.sku ?? "").toLowerCase().includes(ql)
        )
      : products
  ).slice(0, 8);

  return (
    <div className="relative">
      <input
        className="input-sm"
        placeholder={placeholder ?? "Search a product…"}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-md border border-neutral-200 bg-white shadow-pop">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(p);
                setQ(p.name);
                setOpen(false);
              }}
              className="flex w-full items-baseline justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-neutral-50"
            >
              <span className="truncate text-[12px] font-medium text-neutral-800">
                {p.name}
              </span>
              {p.sku && (
                <span className="flex-none font-mono text-[10px] text-neutral-400">
                  {p.sku}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
