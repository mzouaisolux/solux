// Small monochrome line-icon set (Lucide-style) for the Event Registry —
// replaces emoji glyphs for a consistent, premium look. Pure SVG, no
// client hooks, so it renders in both server and client components.
import type { CSSProperties } from "react";

const BASE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function EvtIcon({
  name,
  size = 15,
  style,
}: {
  name: "bell" | "dashboard" | "kpi" | "audit" | "automation";
  size?: number;
  style?: CSSProperties;
}) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, style, ...BASE };
  switch (name) {
    case "bell":
      return (
        <svg {...common}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      );
    case "dashboard":
      return (
        <svg {...common}>
          <path d="M6 20v-4" />
          <path d="M12 20V8" />
          <path d="M18 20v-7" />
        </svg>
      );
    case "kpi":
      return (
        <svg {...common}>
          <path d="M22 7l-8.5 8.5-5-5L2 17" />
          <path d="M16 7h6v6" />
        </svg>
      );
    case "audit":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M9 13h6M9 17h6" />
        </svg>
      );
    case "automation":
      return (
        <svg {...common}>
          <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
        </svg>
      );
    default:
      return null;
  }
}
