"use client";

// =====================================================================
// Smooth expand/collapse using the CSS grid-rows 0fr → 1fr technique:
// animates height without measuring, plus a light opacity fade (~200ms).
// Children stay mounted while collapsed (just clipped), so interactive
// children (status switchers, etc.) don't remount. Notion/Linear feel.
// =====================================================================

import type { ReactNode } from "react";

export function Collapse({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
