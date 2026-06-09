"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Compact "⋯" (3-dot) menu button. Click to open, click outside to close.
 * Renders its children inside a panel — typically a list of buttons /
 * server-action forms / Links.
 *
 * The panel is rendered via a PORTAL to <body> and positioned `fixed`
 * under the trigger. This is deliberate: row menus live inside
 * containers with `overflow-hidden` (e.g. the clients list uses it for
 * the expand/collapse height animation), which would otherwise CLIP the
 * dropdown and make items like "Delete quotation" unreachable. A portal
 * escapes every ancestor's overflow + stacking context.
 *
 * Used to demote dangerous actions (Delete) out of the main row so they
 * stop being a one-click trap.
 */
export default function ContextMenu({
  children,
  ariaLabel = "Open actions menu",
}: {
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(
    null
  );
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Position the panel under the trigger, right-aligned to it.
  const reposition = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({
      top: r.bottom + 4,
      right: Math.max(8, window.innerWidth - r.right),
    });
  };

  useLayoutEffect(() => {
    if (open) reposition();
  }, [open]);

  // Close on outside click, escape; close on scroll/resize so the fixed
  // panel never floats detached from a scrolled trigger.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-neutral-500 hover:border-neutral-200 hover:bg-neutral-50 hover:text-neutral-900 transition-colors"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden
        >
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", top: coords.top, right: coords.right }}
            className="po-premium min-w-[200px] rounded-md border border-neutral-200 bg-white shadow-xl z-[100] overflow-hidden"
            // Auto-close after a click inside — children are usually forms
            // or Links that navigate away anyway.
            onClick={() => setOpen(false)}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
