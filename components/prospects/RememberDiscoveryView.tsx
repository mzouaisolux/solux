"use client";

import { useEffect } from "react";

/**
 * Remembers the last-used view of /prospects (universe + tenders tab) in
 * a cookie, so a BARE navigation back to /prospects (nav menu click,
 * browser back, bookmark) reopens WHERE THE USER LEFT OFF instead of
 * silently falling back to the default universe — the "my Discovery view
 * reverted to the companies list" bug (2026-06-13).
 *
 * The URL stays the single source of truth when params are present; the
 * cookie only fills the gap when they're absent. Server-side: the page
 * reads it via cookies() — a server component cannot SET cookies during
 * render, hence this tiny client writer.
 */
export const DISCOVERY_VIEW_COOKIE = "solux_disco_view";

export function RememberDiscoveryView({
  universe,
  tendersTab,
  prospectsTab,
}: {
  universe: "prospects" | "tenders";
  tendersTab: "inbox" | "pipeline";
  prospectsTab: "projects" | "companies";
}) {
  useEffect(() => {
    document.cookie = `${DISCOVERY_VIEW_COOKIE}=${universe}:${tendersTab}:${prospectsTab}; path=/; max-age=${
      60 * 60 * 24 * 90
    }; SameSite=Lax`;
  }, [universe, tendersTab, prospectsTab]);
  return null;
}
