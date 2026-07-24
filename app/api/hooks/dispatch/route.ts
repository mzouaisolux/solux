/**
 * POST|GET /api/hooks/dispatch — the webhook delivery cron.
 *
 * Drains due `pending` rows from the webhook_deliveries outbox and POSTs each
 * to its endpoint with an HMAC-SHA256 signature, retrying with exponential
 * backoff (see webhook-dispatch.ts). Runs with the service-role client, so it
 * has NO user session — access is gated by a shared secret instead:
 *
 *   Authorization: Bearer <CRON_SECRET>   (Vercel Cron sends this)
 *   or  x-cron-secret: <CRON_SECRET>
 *
 * Call this on a schedule from n8n (Schedule Trigger → HTTP Request with the
 * bearer secret) — plan-independent and as frequent as you like. (A Vercel Cron
 * also works on Pro, but every-minute crons aren't allowed on Hobby, so the
 * schedule lives in n8n by default.) When CRON_SECRET is unset the route is
 * disabled (503) rather than open.
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispatchPendingDeliveries } from "@/features/Intergration/lib/webhook-dispatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function presentedSecret(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  const header = req.headers.get("x-cron-secret");
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

async function handle(req: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "dispatcher disabled: CRON_SECRET not set" }, { status: 503 });
  }
  if (!secretMatches(presentedSecret(req), expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : undefined;

  const summary = await dispatchPendingDeliveries({ limit });
  return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
}

export async function POST(req: Request) {
  return handle(req);
}

export async function GET(req: Request) {
  return handle(req);
}
