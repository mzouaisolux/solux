"use client";

import { useEffect } from "react";

/**
 * Reliable deep-link helper. Reads `?focus=<elementId>` from the URL and, on
 * mount, smooth-scrolls to that element and gives it a brief highlight ring —
 * so an Action Center "Open" (or any deep link) lands the user exactly on the
 * right section instead of the top of a long page (App Router hash scrolling
 * is unreliable below the fold).
 *
 * Drop <FocusOnLoad /> anywhere on a page and give the target an `id`.
 */
export function FocusOnLoad() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("focus");
    if (!id) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-amber-400", "ring-offset-2");
      window.setTimeout(
        () => el.classList.remove("ring-2", "ring-amber-400", "ring-offset-2"),
        2400
      );
    }, 350);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
