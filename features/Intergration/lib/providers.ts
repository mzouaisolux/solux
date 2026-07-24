/**
 * Integrations Phase 3 — business messaging providers (pure request builders).
 *
 * Each channel maps a (config + secret + recipient + text) into the concrete
 * HTTP request to the platform API. Pure + no fetch / no Next import, so the
 * send action and unit tests share one definition. The send action performs
 * the actual fetch with the returned {url, headers, body}.
 *
 * Config (non-secret) and secret (the access token) come from
 * integration_connections. Recipient `to` is the platform-specific id:
 *   • whatsapp_business — the customer's phone in E.164 (digits)
 *   • zalo_oa           — the customer's Zalo user_id
 *   • telegram          — the chat_id
 */

export type BusinessChannel = "zalo_oa" | "whatsapp_business" | "telegram";

export const BUSINESS_CHANNELS: readonly BusinessChannel[] = [
  "zalo_oa",
  "whatsapp_business",
  "telegram",
];

export const isBusinessChannel = (v: string): v is BusinessChannel =>
  (BUSINESS_CHANNELS as readonly string[]).includes(v);

export const BUSINESS_CHANNEL_LABELS: Record<BusinessChannel, string> = {
  zalo_oa: "Zalo OA",
  whatsapp_business: "WhatsApp Business",
  telegram: "Telegram bot",
};

/** Non-secret config field each channel needs (for the connect form + help). */
export const BUSINESS_CHANNEL_CONFIG_FIELDS: Record<
  BusinessChannel,
  { key: string; label: string; required: boolean }[]
> = {
  whatsapp_business: [{ key: "phone_number_id", label: "Phone number ID", required: true }],
  zalo_oa: [{ key: "oa_id", label: "Official Account ID", required: false }],
  telegram: [{ key: "bot_username", label: "Bot username", required: false }],
};

export type SendRequestSpec = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
};

/**
 * Meta Graph API version for WhatsApp Cloud API. Kept in one place so it's easy
 * to bump. WhatsApp free-form text requires an open 24h session; outside it a
 * template message is required (not modelled here — Phase 3 sends free-form).
 */
export const WHATSAPP_GRAPH_VERSION = "v21.0";

/** Build the platform request for a plain text message. Throws on bad input. */
export function buildSendRequest(
  channel: BusinessChannel,
  config: Record<string, any>,
  secret: string,
  msg: { to: string; text: string }
): SendRequestSpec {
  const to = (msg.to ?? "").trim();
  const text = msg.text ?? "";
  if (!to) throw new Error("Recipient is required.");
  if (!text.trim()) throw new Error("Message text is required.");
  if (!secret) throw new Error("This channel has no stored access token — connect it first.");

  switch (channel) {
    case "whatsapp_business": {
      const phoneNumberId = (config?.phone_number_id ?? "").toString().trim();
      if (!phoneNumberId) throw new Error("WhatsApp connection is missing phone_number_id.");
      return {
        url: `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId}/messages`,
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: to.replace(/[^\d]/g, ""),
          type: "text",
          text: { body: text },
        }),
      };
    }
    case "zalo_oa": {
      return {
        url: "https://openapi.zalo.me/v3.0/oa/message/cs",
        method: "POST",
        headers: { access_token: secret, "content-type": "application/json" },
        body: JSON.stringify({
          recipient: { user_id: to },
          message: { text },
        }),
      };
    }
    case "telegram": {
      return {
        url: `https://api.telegram.org/bot${secret}/sendMessage`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: to, text }),
      };
    }
    default:
      throw new Error(`Unsupported channel: ${channel}`);
  }
}

/**
 * WhatsApp *template* message (Meta Cloud API) — required to initiate contact
 * outside the 24-hour customer service window. The template must already be
 * approved in Meta; here we only reference it by name + language and fill the
 * body {{1}}, {{2}}… placeholders from `params` in order. Pure.
 */
export function buildWhatsAppTemplateRequest(
  config: Record<string, any>,
  secret: string,
  msg: { to: string; templateName: string; languageCode?: string; params?: string[] }
): SendRequestSpec {
  const to = (msg.to ?? "").trim();
  const name = (msg.templateName ?? "").trim();
  if (!to) throw new Error("Recipient is required.");
  if (!name) throw new Error("Template name is required.");
  if (!secret) throw new Error("This channel has no stored access token — connect it first.");
  const phoneNumberId = (config?.phone_number_id ?? "").toString().trim();
  if (!phoneNumberId) throw new Error("WhatsApp connection is missing phone_number_id.");

  const params = (msg.params ?? []).map((p) => String(p ?? ""));
  const template: Record<string, any> = {
    name,
    language: { code: (msg.languageCode ?? "en").trim() || "en" },
  };
  if (params.length > 0) {
    template.components = [
      { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
    ];
  }

  return {
    url: `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId}/messages`,
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/[^\d]/g, ""),
      type: "template",
      template,
    }),
  };
}
