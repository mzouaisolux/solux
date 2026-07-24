/**
 * POST /api/datasheets/upload-url — mint a short-lived signed URL so the Figma
 * plugin can upload a large datasheet PDF STRAIGHT to Supabase Storage, bypassing
 * Vercel's ~4.5 MB serverless request-body cap (glossy multi-page datasheets
 * exceed it, which surfaced in the plugin as "Failed to fetch").
 *
 * Flow:
 *   1. plugin → POST here → gets { staged_path, token, signed_url }
 *   2. plugin → PUT the PDF bytes to signed_url (direct to Storage, no size cap)
 *   3. plugin → POST /api/datasheets  (JSON { range, code, version, staged_path })
 *      → the Hub reads the staged bytes back, does the revision/archive/record,
 *        and deletes the staged file.
 *
 * Auth: Authorization: Bearer <api key> (same api_keys as /api/datasheets). CORS
 * open (the key is the auth). The staging key is a random uuid under a fixed
 * prefix the finalize step validates.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { sha256Hex } from "@/features/Intergration/lib/webhook-crypto";
import { rateOk } from "@/features/product-knowledge-hub/lib/datasheetGuards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOCS_BUCKET = "documents";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: Request): Promise<Response> {
  const svc = createServiceClient();
  if (!svc) return json({ error: "datasheets API disabled: service role not configured" }, 503);

  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
  if (!token) return json({ error: "missing bearer token" }, 401);
  const { data: key } = await svc
    .from("api_keys")
    .select("id, revoked_at")
    .eq("key_hash", sha256Hex(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (!key) return json({ error: "invalid or revoked API key" }, 401);
  if (!rateOk(key.id)) return json({ error: "rate limit exceeded, retry shortly" }, 429);

  const stagedPath = `spec-sheets/_staging/${randomUUID()}.pdf`;
  const { data, error } = await svc.storage.from(DOCS_BUCKET).createSignedUploadUrl(stagedPath);
  if (error || !data) return json({ error: `could not create upload url: ${error?.message ?? "unknown"}` }, 500);

  return json({ ok: true, staged_path: stagedPath, token: data.token, signed_url: data.signedUrl });
}
