"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A whole-row click target that navigates to `href`, bound to THIS row's id
 * (no CSS overlay). Replaces the fragile "stretched link" (`::after inset-0`
 * on a relative <tr>) — a <tr> is not a reliable containing block, so those
 * overlays escaped/overlapped and opened the wrong project.
 *
 * Clicks on real interactive elements (links, buttons, inputs) are left to
 * those elements, so inner controls and the name's <Link> (keyboard / open in
 * new tab) keep working.
 */
export function ClickableRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      className={className}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest("a, button, input, select, textarea, label, [role='button']")) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
