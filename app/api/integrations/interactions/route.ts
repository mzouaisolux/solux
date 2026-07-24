/**
 * POST /api/integrations/interactions — inbound interaction log (n8n → Solux).
 *
 * An automation (n8n listening to Zalo OA / WhatsApp Business / mailbox) posts
 * a received message here. We authenticate with an API key, resolve the sender
 * phone to a client, and append a source='auto', direction='inbound' row to
 * client_interactions — the same timeline the reps see on the client page.
 *
 * Auth:   Authorization: Bearer sk_live_…   (hashed + compared to api_keys)
 * Body:   { phone, channel, direction?, summary?, happened_at?, contact_id?, payload? }
 * Result: 201 { matched:true, interaction_id }  — logged against a client
 *         202 { matched:false }                 — no client owns that number
 *         400 / 401                              — bad body / bad key
 *
 * Runs with the SERVICE-ROLE client (no session): the API key IS the auth, and
 * client_interactions is otherwise owner/management-RLS.
 */

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sha256Hex } from "@/features/Intergration/lib/webhook-crypto";
import {
  isInteractionChannel,
  isInteractionDirection,
  phonesMatch,
  type InteractionChannel,
} from "@/features/Intergration/lib/integrations";
import { recordUnmatchedInbound } from "@/features/Intergration/lib/inbound-unmatched";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CANDIDATE_LIMIT = 5000;

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  return null;
}

export async function POST(req: Request) {
  const svc = createServiceClient();
  if (!svc) {
    return NextResponse.json({ error: "inbound API disabled: service role not configured" }, { status: 503 });
  }

  // 1) Authenticate the API key (hash + not revoked).
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "missing bearer token" }, { status: 401 });
  const { data: key } = await svc
    .from("api_keys")
    .select("id, created_by, revoked_at")
    .eq("key_hash", sha256Hex(token))
    .is("revoked_at", null)
    .maybeSingle();
  if (!key) return NextResponse.json({ error: "invalid or revoked API key" }, { status: 401 });

  // 2) Parse + validate the body.
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const phone = String(body?.phone ?? "").trim();
  const channel = String(body?.channel ?? "").trim();
  const direction = String(body?.direction ?? "inbound").trim();
  if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 400 });
  if (!isInteractionChannel(channel)) return NextResponse.json({ error: "invalid channel" }, { status: 400 });
  if (!isInteractionDirection(direction)) return NextResponse.json({ error: "invalid direction" }, { status: 400 });

  const summary = body?.summary != null ? String(body.summary).slice(0, 2000) : null;
  // Validate happened_at — fall back to now on a missing/invalid timestamp
  // (avoids a 500 at insert time from a bad string).
  let happenedAt = new Date().toISOString();
  if (typeof body?.happened_at === "string" && !Number.isNaN(Date.parse(body.happened_at))) {
    happenedAt = new Date(body.happened_at).toISOString();
  }
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

  // 3) Resolve sender phone → client (contacts first, then the client's own
  //    number). Normalized suffix compare, done in JS for reliability across
  //    stored formats.
  let clientId: string | null = null;
  let contactId: string | null = typeof body?.contact_id === "string" ? body.contact_id : null;

  const { data: contacts } = await svc
    .from("contacts")
    .select("id, client_id, phone")
    .not("phone", "is", null)
    .order("created_at", { ascending: false })
    .limit(CANDIDATE_LIMIT);
  const contactHit = (contacts ?? []).find((c: any) => phonesMatch(c.phone, phone));
  if (contactHit) {
    clientId = contactHit.client_id;
    contactId = contactId ?? contactHit.id;
  } else {
    const { data: clients } = await svc
      .from("clients")
      .select("id, phone_number")
      .not("phone_number", "is", null)
      .order("created_at", { ascending: false })
      .limit(CANDIDATE_LIMIT);
    const clientHit = (clients ?? []).find((c: any) => phonesMatch(c.phone_number, phone));
    if (clientHit) clientId = clientHit.id;
  }

  if (!clientId) {
    // No owner for this number — park it in the admin "Unmatched inbound"
    // review queue (m184) instead of dropping it. Resilient: a parking failure
    // must NOT break the live n8n flow, so we log and still return 202.
    let unmatchedId: string | null = null;
    try {
      unmatchedId = await recordUnmatchedInbound({
        channel: channel as InteractionChannel,
        fromIdentifier: phone,
        displayName: typeof body?.name === "string" ? body.name : null,
        text: summary,
        payload,
      });
    } catch (e: any) {
      console.error("[inbound interactions] could not park unmatched:", e?.message ?? e);
    }
    return NextResponse.json({ matched: false, unmatched_id: unmatchedId }, { status: 202 });
  }

  // 4) Attribute the row to the client's owner (created_by is NOT NULL); fall
  //    back to the key's creator so the insert always has an author.
  const { data: client } = await svc
    .from("clients")
    .select("sales_owner_id, created_by")
    .eq("id", clientId)
    .maybeSingle();
  const author = client?.sales_owner_id ?? client?.created_by ?? key.created_by ?? null;
  if (!author) {
    return NextResponse.json({ error: "cannot attribute interaction: no owner" }, { status: 500 });
  }

  const { data: inserted, error } = await svc
    .from("client_interactions")
    .insert({
      client_id: clientId,
      contact_id: contactId,
      channel,
      direction,
      source: "auto",
      summary,
      payload,
      happened_at: happenedAt,
      created_by: author,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[inbound interactions] insert failed:", error.message);
    return NextResponse.json({ error: "could not log interaction" }, { status: 500 });
  }

  return NextResponse.json({ matched: true, interaction_id: (inserted as { id: string }).id }, { status: 201 });
}
