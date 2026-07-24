"use server";

/**
 * Integrations Phase 3 — send a message from a company business channel.
 *
 * Gated by integration.send_business. Reads the (admin-RLS) connection with the
 * service-role client — the capability gate is the authorization, the service
 * client just reads the workspace connection — decrypts the token, POSTs to the
 * platform, then logs the outbound touch on the client timeline and emits
 * business.message.sent. Throws with the platform error on failure.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { requireCapability } from "@/lib/permissions";
import { getCurrentUserRole } from "@/lib/auth";
import { decryptSecret } from "@/features/Intergration/lib/connection-crypto";
import {
  buildSendRequest,
  buildWhatsAppTemplateRequest,
  isBusinessChannel,
  type BusinessChannel,
} from "@/features/Intergration/lib/providers";
import { emitEvent } from "@/lib/events";

const TIMEOUT_MS = 10_000;

export async function sendBusinessMessage(input: {
  channel: string;
  to: string;
  text: string;
  clientId?: string | null;
  contactId?: string | null;
  /** WhatsApp only — send an approved template (outside the 24h window). */
  template?: { name: string; language?: string; params?: string[] } | null;
}): Promise<{ ok: boolean; code: number | null }> {
  await requireCapability("integration.send_business");
  if (!isBusinessChannel(input.channel)) throw new Error("Unknown channel.");
  const to = (input.to ?? "").trim();
  const text = (input.text ?? "").trim();
  const useTemplate = input.channel === "whatsapp_business" && !!input.template?.name;
  if (!to) throw new Error("Recipient is required.");
  if (!text && !useTemplate) throw new Error("Message text is required.");

  const svc = createServiceClient();
  if (!svc) throw new Error("Sending isn't configured on the server (service role missing).");

  const { data: conn } = await svc
    .from("integration_connections")
    .select("channel, config, is_active, secret_ciphertext, secret_iv, secret_tag")
    .eq("channel", input.channel)
    .maybeSingle();
  if (!conn) throw new Error(`${input.channel} is not connected.`);
  if (!conn.is_active) throw new Error(`${input.channel} is connected but turned off.`);
  if (!conn.secret_ciphertext) throw new Error(`${input.channel} has no stored access token.`);

  const secret = decryptSecret({
    ciphertext: conn.secret_ciphertext,
    iv: conn.secret_iv,
    tag: conn.secret_tag,
  });
  const req = useTemplate
    ? buildWhatsAppTemplateRequest(conn.config ?? {}, secret, {
        to,
        templateName: input.template!.name,
        languageCode: input.template!.language,
        params: input.template!.params,
      })
    : buildSendRequest(input.channel as BusinessChannel, conn.config ?? {}, secret, { to, text });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let ok = false;
  let code: number | null = null;
  let errText = "";
  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
      cache: "no-store",
    });
    ok = res.ok;
    code = res.status;
    if (!ok) errText = (await res.text().catch(() => "")).slice(0, 300);
  } catch (e: any) {
    errText = e?.message ?? "network error";
  } finally {
    clearTimeout(timer);
  }

  if (!ok) throw new Error(`Send failed (${code ?? "network"})${errText ? `: ${errText}` : ""}`);

  // Timeline + audit — best-effort, never undo a message that already went out.
  // Use the service client so the log is recorded even when the sending rep
  // isn't the client owner (the capability gate above is the authorization);
  // created_by is set explicitly since the service client has no auth.uid().
  if (input.clientId) {
    const { userId } = await getCurrentUserRole();
    const { error } = await svc.from("client_interactions").insert({
      client_id: input.clientId,
      contact_id: input.contactId ?? null,
      channel: input.channel,
      direction: "outbound",
      source: "manual",
      summary: useTemplate ? `Template: ${input.template!.name}` : text.slice(0, 500),
      payload: { to, response_code: code, template: useTemplate ? input.template!.name : null },
      created_by: userId,
    });
    if (error) console.warn("[sendBusinessMessage] interaction log skipped:", error.message);

    await emitEvent({
      entity_type: "client",
      entity_id: input.clientId,
      event_type: "business.message.sent",
      message: `Message sent via ${input.channel}`,
      payload: { channel: input.channel, to, response_code: code },
      bestEffort: true,
    });
  }

  return { ok, code };
}
