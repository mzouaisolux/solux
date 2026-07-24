/**
 * WhatsApp Business Cloud API — inbound receiver (area A).
 *
 * Meta delivers customer messages here directly (NOT via n8n). Two verbs:
 *
 *   GET   — one-time verification handshake when the webhook is registered.
 *           Echo `hub.challenge` iff `hub.verify_token` === WHATSAPP_VERIFY_TOKEN.
 *   POST  — a message (or status) event. We verify X-Hub-Signature-256 over the
 *           RAW body with WHATSAPP_APP_SECRET, parse customer messages (status
 *           callbacks are ignored), resolve each sender phone to a client, and
 *           either append client_interactions (matched) or park it in
 *           inbound_unmatched (no match) for admin review.
 *
 * Auth is the HMAC signature — the URL is public. Runs with the SERVICE-ROLE
 * client (no user session); the signature is what proves the call came from Meta.
 * Always answers 200 on a validly-signed POST (even with 0 handled messages) so
 * Meta doesn't enter a retry storm; failures are logged server-side.
 *
 * Env: WHATSAPP_VERIFY_TOKEN (GET handshake), WHATSAPP_APP_SECRET (POST HMAC).
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyMetaSignature } from "@/features/Intergration/lib/webhook-crypto";
import { parseWhatsAppInbound } from "@/features/Intergration/lib/integrations";
import { logInboundMessage } from "@/features/Intergration/lib/inbound-receive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — Meta webhook verification handshake. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected && challenge) {
    // Meta expects the raw challenge string echoed back with 200.
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/** POST — inbound message/status event. */
export async function POST(req: Request) {
  const svc = createServiceClient();
  if (!svc) {
    return NextResponse.json({ error: "inbound disabled: service role not configured" }, { status: 503 });
  }

  // Read the RAW body FIRST — the signature is over these exact bytes.
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(process.env.WHATSAPP_APP_SECRET, raw, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const messages = parseWhatsAppInbound(body);
  let matched = 0;
  let unmatched = 0;
  let skipped = 0;

  for (const m of messages) {
    try {
      const res = await logInboundMessage(svc, {
        channel: "whatsapp_business",
        from: m.from,
        name: m.name,
        text: m.text,
        messageId: m.messageId,
        timestamp: m.timestamp,
        payload: { platform: "whatsapp", message_type: m.type },
      });
      if ("matched" in res && res.matched) matched++;
      else if ("matched" in res) unmatched++;
      else skipped++;
    } catch (e: any) {
      // Never fail the whole webhook on one bad message — Meta would retry the
      // batch and re-deliver the good ones. Log and continue.
      console.error("[inbound whatsapp] message failed:", e?.message ?? e);
      skipped++;
    }
  }

  // 200 so Meta marks the batch delivered; counts help debugging.
  return NextResponse.json({ ok: true, received: messages.length, matched, unmatched, skipped });
}
