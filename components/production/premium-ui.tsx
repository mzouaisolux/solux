import type { ReactNode } from "react";

/**
 * Premium status pill (brief §6). Three disciplined variants — no rainbow.
 *   pos  → positive / OK (green-tint fill, green dot)
 *   ink  → alert / hazard (ink fill, white text, green dot)
 *   line → neutral (white, hairline border, lavender dot)
 *
 * Pure presentation. Colors come from premium.css tokens; this only picks
 * the variant. Used ONLY on the Production Order page (.po-premium scope).
 */
export function PremiumPill({
  variant,
  dot = true,
  children,
  title,
}: {
  variant: "pos" | "ink" | "line";
  dot?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`po-pill po-pill--${variant}`} title={title}>
      {dot && <span className="pdot" />}
      {children}
    </span>
  );
}
