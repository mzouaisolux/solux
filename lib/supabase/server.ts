import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function build(noStore: boolean) {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Freshness is OPT-IN, not global. A global `cache:'no-store'` made every
      // server read bypass Next's Data Cache app-wide → every page re-ran its
      // (fetch-all) queries against the remote DB on every load → severe
      // slowdown. So the default client keeps the Data Cache (perf); only the
      // few reads that truly can't be stale use createFreshClient() below.
      ...(noStore
        ? {
            global: {
              fetch: (input: RequestInfo | URL, init?: RequestInit) =>
                fetch(input, { ...init, cache: "no-store" }),
            },
          }
        : {}),
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — middleware refreshes instead.
          }
        },
      },
    }
  );
}

/**
 * Default server client — benefits from Next's Data Cache (performance).
 * Pages that must render fresh already opt in via `export const dynamic =
 * "force-dynamic"` (which forces their fetches no-store at the route level).
 */
export function createClient() {
  return build(false);
}

/**
 * Always-fresh client (`cache:'no-store'`). Use ONLY where a stale read would
 * be wrong AND the caller is NOT a page that can use force-dynamic — i.e. the
 * factory-mapping release gate (`lib/task-list-mapping-server.ts`), a server
 * action: it must see a just-saved global mapping immediately (#12). Scoped so
 * the app-wide Data Cache stays intact everywhere else.
 */
export function createFreshClient() {
  return build(true);
}
