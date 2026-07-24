/**
 * Integrations Phase 2 (Step 4b) — outbound webhook fan-out + delivery.
 *
 * SERVER-ONLY. Two halves, both using the SERVICE-ROLE client because
 * webhook_deliveries / webhook_endpoints are admin-RLS and neither the acting
 * user (fan-out) nor the cron (dispatch) has an admin session:
 *
 *   • enqueueWebhookDeliveries — called from emitEvent as a best-effort side
 *     effect. Maps the emitted event → a logical webhook event and inserts one
 *     `pending` outbox row per active subscribed endpoint. Never throws.
 *
 *   • dispatchPendingDeliveries — called from the signed cron route
 *     (/api/hooks/dispatch). Drains due `pending` rows, POSTs each to its
 *     endpoint with an HMAC-SHA256 signature, and records the outcome with
 *     exponential-backoff retry until MAX_DELIVERY_ATTEMPTS.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { webhookEventForEmit, type WebhookEvent } from "@/features/Intergration/lib/integrations";
import {
  signPayload,
  nextDeliveryStatus,
  isDeliveryDue,
  backoffDelayMs,
  deliveryIdempotencyKey,
} from "@/features/Intergration/lib/webhook-crypto";

/* ------------------------------------------------------------------ */
/*  Fan-out: emitEvent → webhook_deliveries outbox                    */
/* ------------------------------------------------------------------ */

export type WebhookSourceEvent = {
  event_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  message: string;
  payload?: Record<string, any> | null;
};

/**
 * Best-effort: enqueue a delivery row for every active endpoint subscribed to
 * the logical event this emit maps to. Swallows all errors — webhook fan-out
 * must never break the business action that emitted the event.
 */
export async function enqueueWebhookDeliveries(evt: WebhookSourceEvent): Promise<void> {
  try {
    const logical = webhookEventForEmit(evt.event_type, evt.payload ?? undefined);
    if (!logical) return;

    const svc = createServiceClient();
    if (!svc) return;

    const { data: endpoints, error } = await svc
      .from("webhook_endpoints")
      .select("id")
      .eq("is_active", true)
      .contains("event_types", [logical]);
    if (error || !endpoints || endpoints.length === 0) return;

    const envelope = buildEnvelope(logical, evt);
    const rows = endpoints.map((e: { id: string }) => ({
      endpoint_id: e.id,
      event_id: evt.event_id,
      event_type: logical,
      payload: envelope,
      status: "pending" as const,
    }));

    // Idempotent insert: the (endpoint_id, event_id) partial unique index (m180)
    // makes a re-emit of the SAME event a no-op instead of a duplicate outbox
    // row (→ no double-email / double-tracker-row downstream). ignoreDuplicates
    // turns the conflicting rows into a silent skip rather than an error.
    const { error: insErr } = await svc
      .from("webhook_deliveries")
      .upsert(rows, { onConflict: "endpoint_id,event_id", ignoreDuplicates: true });
    if (insErr) console.warn("[enqueueWebhookDeliveries] insert failed:", insErr.message);
  } catch (e: any) {
    console.warn("[enqueueWebhookDeliveries] uncaught:", e?.message);
  }
}

/** The JSON body delivered to n8n (and signed). Stable, versioned shape. */
export function buildEnvelope(logical: WebhookEvent, evt: WebhookSourceEvent) {
  return {
    v: 1,
    event: logical,
    source_event_type: evt.event_type,
    entity: { type: evt.entity_type, id: evt.entity_id },
    message: evt.message,
    payload: evt.payload ?? {},
    event_id: evt.event_id,
    // Stable key for receivers to dedupe on (same across a re-emit and a
    // dispatcher retry of this event). Mirrors the x-solux-idempotency-key
    // header set at delivery time.
    idempotency_key: evt.event_id ?? undefined,
    emitted_at: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  Dispatch: drain the outbox (cron)                                 */
/* ------------------------------------------------------------------ */

export type DispatchSummary = {
  ok: boolean;
  reason?: string;
  picked: number;
  delivered: number;
  requeued: number;
  failed: number;
  skipped: number;
};

const REQUEST_TIMEOUT_MS = 10_000;

type DeliveryRow = {
  id: string;
  endpoint_id: string;
  event_type: string;
  payload: Record<string, any>;
  attempts: number;
  last_attempt_at: string | null;
  endpoint: { url: string; secret: string; is_active: boolean } | null;
};

/**
 * Drain up to `limit` due pending deliveries. Each POST is signed with the
 * endpoint's secret; the outcome updates status/attempts/response_code with
 * backoff (pending→retry) until exhausted (→failed).
 */
export async function dispatchPendingDeliveries(opts?: { limit?: number }): Promise<DispatchSummary> {
  const limit = opts?.limit ?? 50;
  const summary: DispatchSummary = { ok: true, picked: 0, delivered: 0, requeued: 0, failed: 0, skipped: 0 };

  const svc = createServiceClient();
  if (!svc) return { ...summary, ok: false, reason: "service-role client unavailable" };

  const { data, error } = await svc
    .from("webhook_deliveries")
    .select(
      "id, endpoint_id, event_type, payload, attempts, last_attempt_at, endpoint:webhook_endpoints(url, secret, is_active)"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) return { ...summary, ok: false, reason: error.message };

  const rows = (data ?? []) as unknown as DeliveryRow[];
  summary.picked = rows.length;
  const now = Date.now();

  for (const row of rows) {
    // Endpoint gone → terminal fail (no target to deliver to).
    if (!row.endpoint) {
      await svc
        .from("webhook_deliveries")
        .update({ status: "failed", last_attempt_at: new Date().toISOString() })
        .eq("id", row.id);
      summary.skipped++;
      continue;
    }
    // Endpoint paused → leave pending so it resumes when re-enabled (a pause is
    // temporary; don't burn the queued events).
    if (!row.endpoint.is_active) {
      summary.skipped++;
      continue;
    }

    // Not yet due under backoff — leave it pending for a later run.
    const lastMs = row.last_attempt_at ? new Date(row.last_attempt_at).getTime() : null;
    if (!isDeliveryDue(now, lastMs, row.attempts)) {
      summary.skipped++;
      continue;
    }

    const body = JSON.stringify(row.payload ?? {});
    const signature = signPayload(row.endpoint.secret, body);
    const { ok, code } = await postWebhook(row.endpoint.url, body, {
      event: row.event_type,
      signature,
      deliveryId: row.id,
      idempotencyKey: deliveryIdempotencyKey(
        (row.payload as { event_id?: string | null } | null)?.event_id,
        row.id
      ),
    });

    const attempts = row.attempts + 1;
    const status = nextDeliveryStatus(ok, attempts);
    await svc
      .from("webhook_deliveries")
      .update({
        status,
        attempts,
        response_code: code,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (status === "delivered") summary.delivered++;
    else if (status === "pending") summary.requeued++;
    else summary.failed++;
  }

  return summary;
}

async function postWebhook(
  url: string,
  body: string,
  meta: { event: string; signature: string; deliveryId: string; idempotencyKey: string }
): Promise<{ ok: boolean; code: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "solux-webhooks/1",
        "x-solux-event": meta.event,
        "x-solux-signature": `sha256=${meta.signature}`,
        "x-solux-delivery": meta.deliveryId,
        "x-solux-idempotency-key": meta.idempotencyKey,
      },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    return { ok: res.ok, code: res.status };
  } catch (e: any) {
    console.warn("[dispatchPendingDeliveries] POST failed:", url, e?.message);
    return { ok: false, code: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Exposed for observability/tests — the delay before a row's next retry. */
export function retryDelayMs(attempts: number): number {
  return backoffDelayMs(attempts);
}
