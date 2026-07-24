"use server";

/**
 * Knowledge Hub — "Bulk import": hand a batch of spec-sheet PDFs off to n8n for
 * background extraction, instead of extracting + importing synchronously in the
 * request (which forces the user to keep the page open and risks serverless
 * timeouts on the PDF text-extraction).
 *
 * Emits `import.requested`, which the webhook fan-out (Step 4b) turns into an
 * import.requested delivery for any subscribed endpoint. n8n fetches each
 * `signed_url`, extracts + matches by SKU, and POSTs the per-file result back to
 * /api/hooks/import-callback (which commits via the service-role client). This
 * action does NOT wait on any of that — it records the request and returns.
 *
 * Gated by spec.import (same floor as dryRunImport / importBaseline). Status is
 * observable in the events feed: import.requested here, then spec.published /
 * import.file_reviewed per file from the callback.
 */

import { requireCapabilityOrAdmin } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { createClient } from "@/lib/supabase/server";

/** A PDF already uploaded to the `documents` bucket, awaiting extraction. */
export type BulkImportFile = { storagePath: string; filename: string };

/**
 * How long n8n has to fetch each signed URL before it expires.
 *
 * SECURITY: this URL is an unauthenticated bearer capability to the PDF, and it
 * is persisted in the import.requested event payload AND delivered to every
 * endpoint subscribed to import.requested. Keep the TTL as short as n8n needs so
 * a leaked/stale event row can't be replayed to read the file. Only subscribe
 * TRUSTED endpoints to import.requested. (A stronger fix — storing only the
 * storage_path and minting the URL at delivery time — is tracked as a follow-up
 * in Import_Baseline_n8n_Handoff_Plan.md §5.)
 */
const SIGNED_URL_TTL_SECONDS = 60 * 15; // 15 minutes

export async function requestBulkImport(
  files: BulkImportFile[]
): Promise<{ batchId: string; count: number }> {
  await requireCapabilityOrAdmin("spec.import");
  const supabase = createClient();

  const clean = (files ?? []).filter(
    (f) => f && typeof f.storagePath === "string" && f.storagePath.trim() && f.filename
  );
  if (clean.length === 0) throw new Error("No files to import.");

  // Sign each PDF so n8n can fetch it without any Supabase credential. Short TTL
  // keeps the URL from being a durable secret. Fail loudly if signing fails —
  // an unsigned batch would silently import nothing.
  const items: { filename: string; storage_path: string; signed_url: string }[] = [];
  for (const f of clean) {
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(f.storagePath.trim(), SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error(`Could not sign "${f.filename}": ${error?.message ?? "no URL returned"}`);
    }
    items.push({ filename: f.filename, storage_path: f.storagePath.trim(), signed_url: data.signedUrl });
  }

  const batchId = crypto.randomUUID();

  // Best-effort: the fan-out must never break the request. If no endpoint is
  // subscribed, this simply records the intent in the events feed.
  await emitEvent({
    entity_type: "spec_change_request",
    entity_id: batchId,
    event_type: "import.requested",
    message: `Bulk baseline import requested — ${items.length} file(s)`,
    payload: { batch_id: batchId, ttl_seconds: SIGNED_URL_TTL_SECONDS, files: items },
    bestEffort: true,
  });

  return { batchId, count: items.length };
}
