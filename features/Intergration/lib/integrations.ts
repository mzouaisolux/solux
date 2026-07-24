/**
 * Integrations — shared pure constants + type guards + click-to-chat helpers.
 *
 * No server / Next imports on purpose, so these are usable from server actions,
 * client components, AND unit tests. Enum values mirror the CHECK constraints in
 * migrations m164 (client_interactions) and m165 (user_channels) — keep in sync.
 */

export type InteractionChannel =
  | "zalo"
  | "zalo_oa"
  | "whatsapp"
  | "whatsapp_business"
  | "telegram"
  | "email"
  | "call"
  | "meeting"
  | "note";
export type InteractionDirection = "outbound" | "inbound";
export type InteractionSource = "manual" | "auto";
export type UserChannel = "zalo" | "whatsapp" | "telegram";

export const INTERACTION_CHANNELS: readonly InteractionChannel[] = [
  "zalo",
  "zalo_oa",
  "whatsapp",
  "whatsapp_business",
  "telegram",
  "email",
  "call",
  "meeting",
  "note",
];
export const INTERACTION_DIRECTIONS: readonly InteractionDirection[] = ["outbound", "inbound"];
export const INTERACTION_SOURCES: readonly InteractionSource[] = ["manual", "auto"];
export const USER_CHANNELS: readonly UserChannel[] = ["zalo", "whatsapp", "telegram"];

export const isInteractionChannel = (v: string): v is InteractionChannel =>
  (INTERACTION_CHANNELS as readonly string[]).includes(v);
export const isInteractionDirection = (v: string): v is InteractionDirection =>
  (INTERACTION_DIRECTIONS as readonly string[]).includes(v);
export const isInteractionSource = (v: string): v is InteractionSource =>
  (INTERACTION_SOURCES as readonly string[]).includes(v);
export const isUserChannel = (v: string): v is UserChannel =>
  (USER_CHANNELS as readonly string[]).includes(v);

/** Logical webhook event names an endpoint can subscribe to. Mapped from the
 *  app's real EventTypes by webhookEventForEmit() below (Step 4b fan-out). */
export const WEBHOOK_EVENTS = [
  "quotation.created",
  "quotation.sent",
  "quotation.won",
  "quotation.lost",
  "quotation.cancelled",
  "order.confirmed",
  "shipment.updated",
  "spec.published",
  "spec_sheet.sent",
  "import.requested",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Human labels for the checkbox list / guide — keeps the UI copy in one place. */
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  "quotation.created": "Quotation created",
  "quotation.sent": "Quotation sent to customer",
  "quotation.won": "Quotation won (deal closed)",
  "quotation.lost": "Quotation lost",
  "quotation.cancelled": "Quotation cancelled",
  "order.confirmed": "Order confirmed (production order created)",
  "shipment.updated": "Shipment info updated",
  "spec.published": "Spec sheet published",
  "spec_sheet.sent": "Spec sheet sent to customer",
  "import.requested": "Baseline import requested (bulk PDF)",
};

/**
 * Map a real emitted event to the logical webhook event an endpoint subscribes
 * to — or null when the event isn't externally interesting. Pure + payload-aware
 * so the fan-out (webhook-dispatch.ts) and its unit tests share one rule:
 *
 *   • doc.created                             → quotation.created
 *   • doc.status_changed  (payload.to='sent') → quotation.sent
 *   • doc.won                                 → quotation.won
 *   • doc.lost                                → quotation.lost
 *   • doc.cancelled                           → quotation.cancelled
 *   • po.created                              → order.confirmed
 *   • po.shipment_updated                     → shipment.updated
 *   • spec.published                          → spec.published
 *   • spec_sheet.sent                         → spec_sheet.sent (dedicated action)
 *   • import.requested                        → import.requested (bulk import fan-out)
 *
 * Kept as string keys (not the EventType union) so this file stays free of any
 * server/Next import and remains usable from client + tests.
 */
export function webhookEventForEmit(
  eventType: string,
  payload?: Record<string, any> | null
): WebhookEvent | null {
  switch (eventType) {
    case "doc.created":
      return "quotation.created";
    case "doc.status_changed":
      return payload?.to === "sent" ? "quotation.sent" : null;
    case "doc.won":
      return "quotation.won";
    case "doc.lost":
      return "quotation.lost";
    case "doc.cancelled":
      return "quotation.cancelled";
    case "po.created":
      return "order.confirmed";
    case "po.shipment_updated":
      return "shipment.updated";
    case "spec.published":
      return "spec.published";
    case "spec_sheet.sent":
      return "spec_sheet.sent";
    case "import.requested":
      return "import.requested";
    default:
      return null;
  }
}

/**
 * Do two phone numbers refer to the same line? Compares the last `minDigits`
 * (default 8) significant digits, so a stored local number and an inbound
 * E.164 number (with country code) still match. Both must have at least
 * `minDigits` digits, else it's a non-match (too little to be confident).
 */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined, minDigits = 8): boolean {
  const da = (a ?? "").replace(/\D/g, "");
  const db = (b ?? "").replace(/\D/g, "");
  if (da.length < minDigits || db.length < minDigits) return false;
  return da.slice(-minDigits) === db.slice(-minDigits);
}

/**
 * Unmatched-inbound lifecycle (m184). A row starts `pending`; a reviewer either
 * `resolved` it (reconciled to a client → a client_interactions row appended) or
 * `ignored` it (spam / wrong number → no timeline write). Pure — mirrors the
 * m184 CHECK set; shared by the action, the panel, and unit tests.
 */
export type UnmatchedStatus = "pending" | "resolved" | "ignored";
export const UNMATCHED_STATUSES: readonly UnmatchedStatus[] = ["pending", "resolved", "ignored"];
export const isUnmatchedStatus = (v: string): v is UnmatchedStatus =>
  (UNMATCHED_STATUSES as readonly string[]).includes(v);

/**
 * Resolve an inbound sender to a client/contact from a candidate set, by phone.
 * Pure so the future inbound route (area A) and its tests share one rule. A
 * candidate is any (client_id, contact_id?, phone) pair the caller pre-fetched
 * from contacts/clients. Returns the first phone-match (via `phonesMatch`) or
 * null — the null case is exactly what lands a message in `inbound_unmatched`.
 */
export type InboundMatchCandidate = { clientId: string; contactId?: string | null; phone?: string | null };
export function resolveInboundMatch(
  fromIdentifier: string | null | undefined,
  candidates: readonly InboundMatchCandidate[]
): InboundMatchCandidate | null {
  for (const c of candidates) {
    if (phonesMatch(fromIdentifier, c.phone)) return c;
  }
  return null;
}

/**
 * A single inbound message extracted from a platform webhook, normalized to the
 * fields the receiver needs. `from` is the platform sender id (WhatsApp: the
 * wa_id, i.e. phone digits without '+'); `text` is the human-readable body (or a
 * placeholder like "[image]" for non-text messages).
 */
export type ParsedInboundMessage = {
  from: string;
  name: string | null;
  text: string | null;
  messageId: string | null;
  /** Unix seconds as sent by the platform, or null. */
  timestamp: number | null;
  type: string;
};

/**
 * Parse a WhatsApp Cloud API webhook body into inbound messages. Pure so the
 * receiver route and its tests share one rule. Returns [] for anything that
 * isn't a customer message — in particular STATUS callbacks (delivered/read
 * under `value.statuses`) must be ignored, not logged. Tolerant of shape drift:
 * anything missing is skipped rather than throwing.
 */
export function parseWhatsAppInbound(body: any): ParsedInboundMessage[] {
  const out: ParsedInboundMessage[] = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      if (messages.length === 0) continue; // statuses / other events → skip
      // Map wa_id → profile name from the contacts array (best effort).
      const names = new Map<string, string>();
      for (const c of Array.isArray(value?.contacts) ? value.contacts : []) {
        const waId = String(c?.wa_id ?? "").trim();
        const name = c?.profile?.name;
        if (waId && typeof name === "string" && name.trim()) names.set(waId, name.trim());
      }
      for (const msg of messages) {
        const from = String(msg?.from ?? "").trim();
        if (!from) continue;
        const type = String(msg?.type ?? "").trim() || "unknown";
        let text: string | null = null;
        if (type === "text") text = typeof msg?.text?.body === "string" ? msg.text.body : null;
        else if (type === "button") text = typeof msg?.button?.text === "string" ? msg.button.text : null;
        else if (type === "interactive") {
          text =
            msg?.interactive?.button_reply?.title ??
            msg?.interactive?.list_reply?.title ??
            null;
        } else text = `[${type}]`; // image / document / audio / location …
        const tsRaw = msg?.timestamp;
        const ts = typeof tsRaw === "string" || typeof tsRaw === "number" ? Number(tsRaw) : NaN;
        out.push({
          from,
          name: names.get(from) ?? null,
          text,
          messageId: typeof msg?.id === "string" ? msg.id : null,
          timestamp: Number.isFinite(ts) ? ts : null,
          type,
        });
      }
    }
  }
  return out;
}

/** Review-list summary of an inbound message — first ~`max` chars, single line. */
export function inboundSummary(text: string | null | undefined, max = 80): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

/** Message-template kinds + labels. Pure — kept out of the server-action file,
 *  which may only export async functions. */
export type TemplateKind = "general" | "greeting" | "quote_follow_up" | "spec_cover";
export const TEMPLATE_KINDS: readonly TemplateKind[] = [
  "general",
  "greeting",
  "quote_follow_up",
  "spec_cover",
];
export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  general: "General",
  greeting: "Greeting",
  quote_follow_up: "Quote follow-up",
  spec_cover: "Spec cover note",
};

/**
 * Fill a template body's {{tokens}} from a context map. Unknown tokens are left
 * intact so the rep can edit them; matching is case-insensitive on the token
 * name and tolerant of inner whitespace ({{ company }} == {{company}}). Pure.
 */
export function applyTemplate(body: string, vars: Record<string, string | null | undefined>): string {
  const lookup = new Map(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  return (body ?? "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) => {
    const v = lookup.get(String(key).toLowerCase());
    return v == null || v === "" ? whole : String(v);
  });
}

/** Digits only (keeps a leading +), for wa.me / zalo.me deep links. */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const t = raw.trim().replace(/[^\d+]/g, "");
  return t.startsWith("+") ? "+" + t.slice(1).replace(/\D/g, "") : t.replace(/\D/g, "");
}

/**
 * Click-to-chat deep link for a personal channel (Phase 1). Opens the native
 * app; the conversation happens outside Solux. Returns null when the target
 * (phone/handle/email) is missing.
 */
export function chatUrl(
  channel: UserChannel | "email",
  target: { phone?: string | null; handle?: string | null; email?: string | null }
): string | null {
  switch (channel) {
    case "zalo": {
      const p = normalizePhone(target.phone).replace(/^\+/, "");
      return p ? `https://zalo.me/${p}` : null;
    }
    case "whatsapp": {
      const p = normalizePhone(target.phone).replace(/^\+/, "");
      return p ? `https://wa.me/${p}` : null;
    }
    case "telegram": {
      const h = (target.handle ?? "").trim().replace(/^@/, "");
      return h ? `https://t.me/${h}` : null;
    }
    case "email": {
      const e = (target.email ?? "").trim();
      return e ? `mailto:${e}` : null;
    }
    default:
      return null;
  }
}
