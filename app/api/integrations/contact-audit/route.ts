/**
 * GET /api/integrations/contact-audit — the weekly contact-data audit.
 *
 * Read-only. Returns the clients whose quote-package recipient would NOT
 * cleanly deliver (see the contact_recipient_audit view, m181) so the weekly
 * n8n check can email an alert only when something is flagged. Package go-live
 * hardening (status doc, open item #4).
 *
 * Runs with the service-role client (no user session) — access is gated by the
 * same shared secret as the dispatcher cron:
 *
 *   Authorization: Bearer <CRON_SECRET>
 *   or  x-cron-secret: <CRON_SECRET>
 *
 * When CRON_SECRET is unset the route is disabled (503) rather than open.
 * Optional ?include=all returns every client (incl. OK); default is flagged only.
 */

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

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
    return NextResponse.json({ error: "audit disabled: CRON_SECRET not set" }, { status: 503 });
  }
  if (!secretMatches(presentedSecret(req), expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  if (!svc) {
    return NextResponse.json({ ok: false, error: "service-role client unavailable" }, { status: 500 });
  }

  const includeAll = new URL(req.url).searchParams.get("include") === "all";

  let query = svc
    .from("contact_recipient_audit")
    .select(
      "client_id, client_name, recipient_email, recipient_source, contact_count, has_primary_flag, has_quote, has_nondraft_quote, audit_status"
    );
  if (!includeAll) query = query.neq("audit_status", "OK");

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const clients = data ?? [];
  return NextResponse.json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      flagged_count: includeAll ? clients.filter((c: any) => c.audit_status !== "OK").length : clients.length,
      returned: clients.length,
      clients,
    },
    { status: 200 }
  );
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
