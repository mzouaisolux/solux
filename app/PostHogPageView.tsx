"use client";

/**
 * Manual $pageview capture for App Router navigations.
 *
 * Next's client-side route changes don't reload the document, so PostHog's
 * default pageview (disabled via capture_pageview:false in app/providers.tsx)
 * would only ever see the first load. This component watches
 * pathname + searchParams and captures a $pageview on every change.
 *
 * useSearchParams() requires a Suspense boundary during static generation —
 * hence the two-component split: the default export wraps the tracker in
 * <Suspense> so the root layout can render it directly.
 *
 * No-op when NEXT_PUBLIC_POSTHOG_KEY is absent (local dev): the guard below
 * skips capture entirely, matching the provider's disabled state.
 */

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import { usePostHog } from "posthog-js/react";

function PostHogPageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const posthog = usePostHog();

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return; // disabled locally
    if (!pathname || !posthog) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams, posthog]);

  return null;
}

export default function PostHogPageView() {
  return (
    <Suspense fallback={null}>
      <PostHogPageViewTracker />
    </Suspense>
  );
}
