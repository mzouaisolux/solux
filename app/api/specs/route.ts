/**
 * GET /api/specs?range=<code>&since=<version> — specs feed for the Figma
 * datasheet integration (endpoint A).
 *
 * Generic across EVERY family: a family is resolved by its `range_code`
 * (m172), and the response emits the Hub's own spec keys + formatted values for
 * every model in that range. The Figma plugin maps Hub keys → its per-range
 * design fields (its "one-time field-mapping per range"), so the Hub stays
 * family-agnostic — onboarding a new range is just setting its range_code.
 *
 * Auth: Authorization: Bearer <api key>  — hashed + compared to api_keys
 * (same mechanism as /api/integrations/interactions). No cookies, so it works
 * from the plugin's null origin; CORS is permissive because the key is the auth.
 *
 * `since` (optional): a version the plugin last synced (e.g. v1.1). When given,
 * each model's `changed` lists the Hub keys whose value changed in versions
 * published after it — so the plugin can pre-select only those in its diff.
 *
 * Read-only. Runs with the service-role client (no session).
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sha256Hex } from "@/features/Intergration/lib/webhook-crypto";
import { resolveFamilySpecs } from "@/features/product-knowledge-hub/lib/resolveFamilySpecs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}

export async function GET(req: Request): Promise<Response> {
  const svc = createServiceClient();
  if (!svc) return json({ error: "specs API disabled: service role not configured" }, 503);

  // 1) Authenticate the API key (hashed, not revoked).
  const token = bearer(req);
  if (!token) return json({ error: "missing bearer token" }, 401);
  const { data: key } = await svc
    .from("api_keys")
    .select("id, revoked_at")
    .eq("key_hash", sha256Hex(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (!key) return json({ error: "invalid or revoked API key" }, 401);

  // 2) Resolve the range → family (by range_code; fall back to a name match).
  const url = new URL(req.url);
  const range = (url.searchParams.get("range") ?? "").trim();
  const since = (url.searchParams.get("since") ?? "").trim() || null;
  if (!range) return json({ error: "range is required" }, 400);

  let cat: { id: string; name: string } | null = null;
  const byCode = await svc
    .from("product_categories")
    .select("id, name")
    .eq("range_code", range)
    .maybeSingle();
  cat = (byCode.data as { id: string; name: string } | null) ?? null;
  if (!cat) {
    const byName = await svc
      .from("product_categories")
      .select("id, name")
      .ilike("name", range)
      .maybeSingle();
    cat = (byName.data as { id: string; name: string } | null) ?? null;
  }
  if (!cat) return json({ error: `no family for range "${range}"` }, 404);

  // 3) Resolve + format this family's spec feed (shared with /api/specs/all).
  const r = await resolveFamilySpecs(svc, cat, since);

  return json({
    range,
    category: cat.name,
    version: r.version,
    since,
    updatedAt: r.updatedAt,
    fields: r.fields,
    common: r.common,
    models: r.models,
  });
}
