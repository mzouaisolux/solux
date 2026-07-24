/**
 * GET /api/specs/all?since=<version> — every range's models in one call.
 *
 * Powers the Figma plugin's RANGE AUTO-DETECT: instead of the operator picking a
 * range, the plugin loads all models (each tagged with its own `range` +
 * `version`) and infers the range from the SKUs already on the open datasheet.
 *
 * Same feed shape as /api/specs (endpoint A), merged across families — every
 * family with a `range_code` (m172). Auth, CORS, and the resolver are shared with
 * /api/specs. Read-only, service-role, no session.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sha256Hex } from "@/features/Intergration/lib/webhook-crypto";
import {
  resolveFamilySpecs,
  type FamilyModel,
} from "@/features/product-knowledge-hub/lib/resolveFamilySpecs";

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

// A model in the merged feed carries which range + version it came from, so the
// plugin can upload to the right range without the operator choosing one.
type MergedModel = FamilyModel & { range: string; version: string | null };

export async function GET(req: Request): Promise<Response> {
  const svc = createServiceClient();
  if (!svc) return json({ error: "specs API disabled: service role not configured" }, 503);

  // 1) Authenticate the API key (hashed, not revoked) — same as /api/specs.
  const token = bearer(req);
  if (!token) return json({ error: "missing bearer token" }, 401);
  const { data: key } = await svc
    .from("api_keys")
    .select("id, revoked_at")
    .eq("key_hash", sha256Hex(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (!key) return json({ error: "invalid or revoked API key" }, 401);

  const url = new URL(req.url);
  const since = (url.searchParams.get("since") ?? "").trim() || null;

  // 2) Every onboarded family (has a range_code).
  const { data: cats } = await svc
    .from("product_categories")
    .select("id, name, range_code")
    .not("range_code", "is", null)
    .order("range_code", { ascending: true });
  const families = (cats ?? []) as { id: string; name: string; range_code: string }[];

  // 3) Resolve each family in parallel, then merge models keyed by SKU/code.
  const resolved = await Promise.all(
    families.map(async (fam) => ({ fam, r: await resolveFamilySpecs(svc, { id: fam.id, name: fam.name }, since) })),
  );

  const models: Record<string, MergedModel> = {};
  const ranges: { range: string; category: string; version: string | null; models: number }[] = [];
  for (const { fam, r } of resolved) {
    let count = 0;
    for (const [code, m] of Object.entries(r.models)) {
      // If two families share a code, the later range wins; note it in `ranges`.
      models[code] = { ...m, range: fam.range_code, version: r.version };
      count++;
    }
    ranges.push({ range: fam.range_code, category: fam.name, version: r.version, models: count });
  }

  return json({
    count: Object.keys(models).length,
    ranges,
    since,
    models,
  });
}
