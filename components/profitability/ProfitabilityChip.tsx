"use client";

// =====================================================================
// Overall-only profitability pill (m152) — for dense surfaces (affair row
// header, document header, overview table). Tinted by health, clickable →
// the same breakdown drawer (lazy-loaded via the REAL-role-gated server
// action when only the affair id is at hand). Renders NOTHING without data.
// =====================================================================

import { useState } from "react";
import { ProfitabilityDrawer } from "./ProfitabilityDrawer";
import type {
  ProfitabilityResult,
  ProfitHealth,
} from "@/lib/profitability";

const TINT: Record<ProfitHealth, string> = {
  green: "border-green-300 bg-green-50 text-green-800",
  yellow: "border-amber-300 bg-amber-50 text-amber-900",
  red: "border-red-300 bg-red-50 text-red-800",
};

export function ProfitabilityChip({
  data,
  affairId,
}: {
  data?: ProfitabilityResult | null;
  /** Lets the drawer lazy-load the full breakdown on dense surfaces. */
  affairId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!data || !data.ok || data.overallPct == null || !data.overallHealth) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Overall margin — open the financial breakdown"
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
          TINT[data.overallHealth]
        }`}
      >
        {data.overallPct.toFixed(0)}%{data.partial ? "*" : ""}
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
