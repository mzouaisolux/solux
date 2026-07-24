/**
 * POST /api/hooks/import-callback — inbound result sink for the n8n baseline
 * import handoff.
 *
 * Flow (see features/product-knowledge-hub/docs/Import_Baseline_n8n_Handoff_Plan.md):
 *   requestBulkImport emits import.requested → fan-out → n8n fetches each signed
 *   PDF URL, extracts text, matches by SKU → n8n POSTs the per-file result HERE.
 * This route commits the matched rows (idempotently) via the SERVICE-ROLE client
 * and records unmatched files in the events feed. One POST per file.
 *
 * Auth: this route has NO user session — n8n is not a logged-in user. It is
 * gated by a shared secret exactly like /api/hooks/dispatch, but with its OWN
 * secret (IMPORT_CALLBACK_SECRET) so import-write access can be rotated/revoked
 * independently of webhook dispatch:
 *
 *   Authorization: Bearer <IMPORT_CALLBACK_SECRET>
 *   or  x-import-secret: <IMPORT_CALLBACK_SECRET>
 *
 * When IMPORT_CALLBACK_SECRET is unset the route is disabled (503), never open.
 *
 * Idempotent: commitImportPlan upserts spec_fields, check-then-updates
 * spec_values, and seeds v1.0 only when a family has none — so an n8n retry of
 * the same file is safe.
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { commitImportPlan } from "@/features/product-knowledge-hub/lib/importCore";
import { emitEventWith } from "@/lib/events";
import type { ImportRow } from "@/features/product-knowledge-hub/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hard cap on rows per file. commitImportPlan does sequential per-row DB
 * round-trips, so an unbounded batch is a DoS / cost-amplification vector on the
 * service-role connection. A real spec sheet is dozens of rows; thousands means
 * a malformed or hostile payload. Reject early. (Mirrors the CANDIDATE_LIMIT
 * guard on the sibling inbound route /api/integrations/interactions.)
 */
const MAX_ROWS_PER_FILE = 2000;

type CallbackStatus = "matched" | "needs_review" | "error";

type CallbackBody = {
  batch_id?: unknown;
  filename?: unknown;
  sku?: unknown;
  status?: unknown;
  rows?: unknown;
  warnings?: unknown;
};

function presentedSecret(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  const header = req.headers.get("x-import-secret");
  return header ? header.trim() : null;
}

/** Constant-time compare that also resists length leakage. */
function secretMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.IMPORT_CALLBACK_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "import callback disabled: IMPORT_CALLBACK_SECRET not set" },
      { status: 503 }
    );
  }
  if (!secretMatches(presentedSecret(req), expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  if (!svc) {
    return NextResponse.json(
      { error: "service client unavailable: SUPABASE_SERVICE_ROLE_KEY not set" },
      { status: 503 }
    );
  }

  let body: CallbackBody;
  try {
    body = (await req.json()) as CallbackBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const batchId = typeof body.batch_id === "string" ? body.batch_id.trim() : "";
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const sku = typeof body.sku === "string" ? body.sku.trim() || null : null;
  const status = body.status as CallbackStatus;

  if (!batchId) return NextResponse.json({ error: "batch_id is required" }, { status: 400 });
  if (!filename) return NextResponse.json({ error: "filename is required" }, { status: 400 });
  if (status !== "matched" && status !== "needs_review" && status !== "error") {
    return NextResponse.json(
      { error: 'status must be "matched", "needs_review", or "error"' },
      { status: 400 }
    );
  }

  const warnings = Array.isArray(body.warnings)
    ? (body.warnings.filter((w) => typeof w === "string") as string[])
    : [];

  // Unmatched / failed files: never write specs — just record for review so the
  // file surfaces in the events feed ("come back and see status"). This record
  // is the ONLY output for these files, so it is NOT best-effort: if the write
  // fails we return 5xx and let n8n retry, rather than silently losing it.
  if (status !== "matched") {
    try {
      await emitEventWith(svc, null, {
        entity_type: "spec_change_request",
        entity_id: batchId,
        event_type: "import.file_reviewed",
        message: `Import needs review — ${filename}${sku ? ` (SKU ${sku})` : ""}`,
        payload: { batch_id: batchId, filename, sku, status, warnings },
        bestEffort: false,
      });
    } catch (e: any) {
      console.error("[import-callback] failed to record review for", filename, "—", e?.message);
      return NextResponse.json({ ok: false, error: "could not record review" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, status, committed: null }, { status: 200 });
  }

  // Matched: commit the extracted rows idempotently via the service client.
  const rows = Array.isArray(body.rows) ? (body.rows as ImportRow[]) : [];
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'status "matched" requires a non-empty rows array' },
      { status: 400 }
    );
  }
  if (rows.length > MAX_ROWS_PER_FILE) {
    return NextResponse.json(
      { error: `too many rows (${rows.length}); max ${MAX_ROWS_PER_FILE} per file` },
      { status: 400 }
    );
  }

  try {
    const result = await commitImportPlan(svc, rows, { authorId: null });
    return NextResponse.json({ ok: true, status, committed: result }, { status: 200 });
  } catch (e: any) {
    // Log + record the failure in the feed (server-side detail), but return a
    // GENERIC message to the caller — don't leak DB/schema internals over HTTP.
    console.error("[import-callback] commit failed for", filename, "—", e?.message);
    await emitEventWith(svc, null, {
      entity_type: "spec_change_request",
      entity_id: batchId,
      event_type: "import.file_reviewed",
      message: `Import failed — ${filename}`,
      payload: { batch_id: batchId, filename, sku, status: "error", error: e?.message ?? null },
      bestEffort: true,
    });
    return NextResponse.json({ ok: false, error: "import commit failed" }, { status: 500 });
  }
}
