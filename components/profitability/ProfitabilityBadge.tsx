"use client";

// =====================================================================
// Compact profitability widget (m152) — the management heartbeat:
//   Product   32%  🟢
//   Pole      18%  🟡
//   Overall   27%  🟢
// Whole card clickable → full breakdown drawer. Renders NOTHING without
// data (the capability-gated loader simply never hands data to a browser
// that must not see margins — no greyed placeholder, m142 rule).
// Calm SOLUX styling: neutral card, color only on the health dots.
// =====================================================================

import { useState } from "react";
import { ProfitabilityDrawer } from "./ProfitabilityDrawer";
import type {
  ProfitabilityResult,
  ProfitHealth,
} from "@/lib/profitability";

const DOT: Record<ProfitHealth, string> = {
  green: "bg-green-600",
  yellow: "bg-amber-500",
  red: "bg-red-600",
};

function line(pctValue: number | null, health: ProfitHealth | null) {
  return (
    <span className="flex items-center justify-end gap-1.5 tabular-nums">
      <span className="text-sm font-semibold text-neutral-900">
        {pctValue == null ? "—" : `${pctValue.toFixed(0)}%`}
      </span>
      {health ? (
        <span className={`h-2 w-2 rounded-full ${DOT[health]}`} />
      ) : (
        <span className="h-2 w-2" />
      )}
    </span>
  );
}

export function ProfitabilityBadge({
  data,
  affairId,
}: {
  data?: ProfitabilityResult | null;
  /** Enables the drawer's margin-history section (lazy-loaded). */
  affairId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  // Silent absence: no capability → the page never passes data; no doc /
  // non-USD → nothing useful to show on the compact surface.
  if (!data || !data.ok) return null;

  const product = data.components.find((c) => c.key === "product");
  const pole = data.components.find((c) => c.key === "pole");
  const showPole = !!pole?.available;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open the financial breakdown"
        className="w-full max-w-[240px] rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-left shadow-sm transition hover:border-neutral-300 hover:shadow"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Profitability
          </span>
          {data.partial && (
            <span
              className="text-[11px] font-semibold text-amber-600"
              title="Some costs are unknown — open for details"
            >
              *
            </span>
          )}
        </div>
        <div className="space-y-0.5">
          {product?.available && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-neutral-500">Product</span>
              {line(product.marginPct, product.health)}
            </div>
          )}
          {showPole && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-neutral-500">Pole</span>
              {line(pole!.marginPct, pole!.health)}
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3 border-t border-neutral-100 pt-0.5">
            <span className="text-sm font-medium text-neutral-700">
              Overall
            </span>
            {line(data.overallPct, data.overallHealth)}
          </div>
        </div>
      </button>
      <ProfitabilityDrawer
        open={open}
        onClose={() => setOpen(false)}
        data={data}
        affairId={affairId}
      />
    </>
  );
}
