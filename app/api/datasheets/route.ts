/**
 * POST /api/datasheets — inbound glossy-datasheet upload (endpoint B).
 *
 * The Figma "Solux Datasheet Updater" plugin, after applying the specs and
 * exporting each frame to PDF, POSTs one PDF per model here. The Hub files it as
 * the current `figma_override` for that model + spec version, archiving the
 * previous revision first (Option B history, migration 173) so nothing is lost
 * and a bad upload can be rolled back.
 *
 * Where it writes:
 *   • PDF bytes  → Supabase Storage `documents` bucket, revision-versioned path
 *                  spec-sheets/{productId}/{version}/r{n}.pdf (never overwrites).
 *   • pointer    → spec_documents (kind=figma_override, is_current, revision=n)
 *                  — the row the model page / Preview / Download / Send read.
 *   • history    → spec_document_archives (the superseded revision).
 *
 * Generic across every family: the family is resolved by range_code, the model
 * by SKU/code. Auth: Authorization: Bearer <api key> (hashed vs api_keys), no
 * cookies; runs with the service-role client. CORS open (the key is the auth).
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sha256Hex } from "@/features/Intergration/lib/webhook-crypto";
import {
  isSafeVersion,
  escapeLike,
  isPdfBytes,
  rateOk,
} from "@/features/product-knowledge-hub/lib/datasheetGuards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOCS_BUCKET = "documents";
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB guard

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

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}

export async function POST(req: Request): Promise<Response> {
  const svc = createServiceClient();
  if (!svc) return json({ error: "datasheets API disabled: service role not configured" }, 503);

  // 1) Authenticate the API key.
  const token = bearer(req);
  if (!token) return json({ error: "missing bearer token" }, 401);
  const { data: key } = await svc
    .from("api_keys")
    .select("id, created_by, revoked_at")
    .eq("key_hash", sha256Hex(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (!key) return json({ error: "invalid or revoked API key" }, 401);

  // 1b) Best-effort per-key rate guard (leaked keys have full read+write).
  if (!rateOk(key.id)) return json({ error: "rate limit exceeded, retry shortly" }, 429);

  // 2) Parse — EITHER multipart (small files) OR JSON with `staged_path`, a file
  //    the client already uploaded straight to Storage via a signed URL. The
  //    staged path lets a >4.5 MB datasheet bypass Vercel's function body limit:
  //    the bytes never pass through here, we just read them back from Storage.
  const ct = req.headers.get("content-type") || "";
  let range = "", code = "";
  let lang: string | null = null;
  let sourceVersion: string | null = null;
  let version: string | null = null;
  let stagedPath: string | null = null;
  let bytes = new Uint8Array();

  if (ct.includes("application/json")) {
    let b: any;
    try { b = await req.json(); } catch { return json({ error: "expected a JSON body" }, 400); }
    range = String(b.range ?? "").trim();
    code = String(b.code ?? "").trim();
    lang = String(b.lang ?? "").trim() || null;
    sourceVersion = String(b.source_version ?? "").trim() || null;
    version = String(b.version ?? "").trim() || null;
    stagedPath = String(b.staged_path ?? "").trim() || null;
    if (!stagedPath) return json({ error: "staged_path is required for a JSON upload" }, 400);
    // Only our staging prefix — never an arbitrary storage key.
    if (!/^spec-sheets\/_staging\/[A-Za-z0-9._-]+\.pdf$/.test(stagedPath)) {
      return json({ error: "invalid staged_path" }, 400);
    }
    const dl = await svc.storage.from(DOCS_BUCKET).download(stagedPath);
    if (dl.error || !dl.data) return json({ error: "staged file not found — re-upload it" }, 400);
    bytes = new Uint8Array(await dl.data.arrayBuffer());
  } else {
    let form: FormData;
    try { form = await req.formData(); } catch { return json({ error: "expected multipart/form-data or JSON" }, 400); }
    range = String(form.get("range") ?? "").trim();
    code = String(form.get("code") ?? "").trim();
    lang = String(form.get("lang") ?? "").trim() || null;
    sourceVersion = String(form.get("source_version") ?? "").trim() || null;
    version = String(form.get("version") ?? "").trim() || null;
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "file is required (multipart 'file')" }, 400);
    if (file.size === 0) return json({ error: "file is empty" }, 400);
    if (file.size > MAX_PDF_BYTES) return json({ error: `file too large (max ${MAX_PDF_BYTES} bytes)` }, 400);
    bytes = new Uint8Array(await file.arrayBuffer());
  }

  if (!range) return json({ error: "range is required" }, 400);
  if (!code) return json({ error: "code (SKU) is required" }, 400);
  // Reject a traversal-shaped version before it can reach the storage key.
  if (version && !isSafeVersion(version)) {
    return json({ error: "version must be a dotted numeric like v1.0 or 2.3" }, 400);
  }
  if (bytes.byteLength === 0) return json({ error: "file is empty" }, 400);
  if (bytes.byteLength > MAX_PDF_BYTES) return json({ error: `file too large (max ${MAX_PDF_BYTES} bytes)` }, 400);

  // 3) Resolve family (range_code, name fallback) + model (by SKU/code).
  let cat: { id: string } | null = null;
  const byCode = await svc.from("product_categories").select("id").eq("range_code", range).maybeSingle();
  cat = (byCode.data as { id: string } | null) ?? null;
  if (!cat) {
    const byName = await svc
      .from("product_categories")
      .select("id")
      .ilike("name", escapeLike(range))
      .maybeSingle();
    cat = (byName.data as { id: string } | null) ?? null;
  }
  if (!cat) return json({ error: `no family for range "${range}"` }, 404);

  const { data: product } = await svc
    .from("products")
    .select("id, sku, name")
    .eq("category_id", cat.id)
    .eq("sku", code)
    .maybeSingle();
  if (!product) return json({ error: `no model with code "${code}" in range "${range}"` }, 404);
  const productId = (product as { id: string }).id;

  // 4) Version: use the provided Hub version, else the family's current version.
  if (!version) {
    const { data: v } = await svc
      .from("spec_versions")
      .select("version")
      .eq("category_id", cat.id)
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    version = (v as { version: string } | null)?.version ?? "v1.0";
  }

  // 5) Current figma_override → next revision.
  const { data: cur } = await svc
    .from("spec_documents")
    .select("*")
    .eq("product_id", productId)
    .eq("spec_version", version)
    .eq("kind", "figma_override")
    .maybeSingle();
  const nextRev = cur ? ((cur as { revision: number | null }).revision ?? 1) + 1 : 1;

  // 6) Upload the PDF to a revision-versioned path (never overwrites prior).
  const path = `spec-sheets/${productId}/${version}/r${nextRev}.pdf`;
  const storageName = `${(product as { sku: string | null }).sku ?? code}${lang ? "_" + lang : ""}_${version}_r${nextRev}.pdf`;
  if (!isPdfBytes(bytes)) return json({ error: "file is not a PDF (missing %PDF- header)" }, 400);
  const { error: upErr } = await svc.storage
    .from(DOCS_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (upErr) return json({ error: `upload failed: ${upErr.message}` }, 500);

  // 7) Archive the superseded revision (if any), then make this the current row.
  if (cur) {
    const c = cur as Record<string, any>;
    await svc.from("spec_document_archives").insert({
      product_id: c.product_id,
      spec_version: c.spec_version,
      kind: c.kind,
      revision: c.revision ?? 1,
      storage_path: c.storage_path,
      storage_name: c.storage_name,
      template_version: c.template_version ?? null,
      source_version: c.source_version ?? null,
      created_by: c.created_by ?? null,
    });
  }
  const { error: docErr } = await svc.from("spec_documents").upsert(
    {
      product_id: productId,
      spec_version: version,
      kind: "figma_override",
      status: "ready",
      is_current: true,
      revision: nextRev,
      storage_path: path,
      storage_name: storageName,
      source_version: sourceVersion,
      created_by: key.created_by ?? null,
      rendered_at: new Date().toISOString(),
    },
    { onConflict: "product_id,spec_version,kind" }
  );
  if (docErr) return json({ error: `could not record datasheet: ${docErr.message}` }, 500);

  // Clean up the staged upload now that it's filed under the real revision path.
  if (stagedPath) { try { await svc.storage.from(DOCS_BUCKET).remove([stagedPath]); } catch { /* best-effort */ } }

  return json({ ok: true, range, model: code, version, revision: nextRev, path });
}
