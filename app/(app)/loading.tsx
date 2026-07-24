/**
 * Route-group loading UI for every page under `app/(app)/`.
 *
 * Next.js renders this instantly (from the client, no server round-trip) the
 * moment a navigation starts, then streams in the real page once its server
 * component has finished fetching. Without it, clicking a link showed nothing
 * until all server queries resolved, so even a fast page *felt* frozen.
 *
 * Purely presentational skeleton — no data, no client JS. It lives inside the
 * layout's `<main className="po-premium">`, so it inherits the design language
 * (sharp corners, ink palette) automatically.
 */
export default function AppLoading() {
  return (
    <div className="p-6 animate-pulse" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* Page title + primary action */}
      <div className="flex items-center justify-between mb-6">
        <div className="h-7 w-56 bg-neutral-200" />
        <div className="h-9 w-32 bg-neutral-200" />
      </div>

      {/* Summary / metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-neutral-200" />
        ))}
      </div>

      {/* Content block (table / list placeholder) */}
      <div className="border border-neutral-200">
        <div className="h-10 bg-neutral-200" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-12 border-t border-neutral-100 bg-neutral-50"
          />
        ))}
      </div>
    </div>
  );
}
