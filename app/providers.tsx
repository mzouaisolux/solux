"use client";

/**
 * PostHog analytics provider (root, client).
 *
 * Initialization is STRICTLY gated on NEXT_PUBLIC_POSTHOG_KEY:
 *   - locally the variable is never set → posthog.init is never called, no
 *     network traffic, zero behavior change;
 *   - on Vercel the variable is set → PostHog initializes once on mount.
 *
 * `capture_pageview: false` on purpose: the default capture only fires on full
 * page loads, which misses App Router client-side navigations. Page views are
 * captured manually by <PostHogPageView/> (app/PostHogPageView.tsx) on every
 * pathname/search-params change instead.
 *
 * The key is read from the env at build time (NEXT_PUBLIC_*), never hardcoded.
 */

import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect } from "react";

export function PHProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return; // no key (local dev) → PostHog stays fully disabled
    if (posthog.__loaded) return; // guard against double-init (Fast Refresh)
    posthog.init(key, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
      // Manual page views — see PostHogPageView (App Router navigations).
      capture_pageview: false,
      // $pageleave makes bounce/duration metrics correct with manual pageviews.
      capture_pageleave: true,
    });
  }, []);

  // Rendering the provider even when uninitialized is safe: capture calls on a
  // non-initialized client are inert (no network), so child components can use
  // usePostHog() unconditionally.
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
