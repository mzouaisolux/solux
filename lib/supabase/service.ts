/**
 * Service-role Supabase client — bypasses RLS. SERVER-ONLY, NO cookies.
 *
 * Use ONLY from trusted server contexts that have no user session and must
 * therefore act above RLS:
 *   • the webhook dispatcher (cron, /api/hooks/dispatch)
 *   • the webhook fan-out enqueue (emitEvent side effect — webhook_deliveries
 *     is admin-RLS, but every acting user must be able to enqueue)
 *   • the inbound API (/api/integrations/interactions — authenticated by an
 *     API key, not a Supabase session)
 *
 * NEVER import this from a client component or a user-facing server action that
 * already has a session — those must stay within RLS via lib/supabase/server.
 *
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is absent (local dev without the
 * secret, build time) so callers can degrade gracefully instead of throwing.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function createServiceClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn(
      "[supabase/service] SUPABASE_SERVICE_ROLE_KEY (or URL) missing — service-role features (webhook dispatch, inbound API) are disabled."
    );
    cached = null;
    return cached;
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return cached;
}
