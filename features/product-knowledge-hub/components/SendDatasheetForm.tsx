"use client";

/**
 * Knowledge Hub — "Send to customer" on the model page, framed as TO + FROM:
 *
 *   • TO   — a smart field: search the rep's clients (auto-fills the primary
 *            contact's email / phone for the chosen channel) or paste an email
 *            / phone to send directly.
 *   • FROM — pick a channel (Email / WhatsApp), then a sender:
 *              Me      → opens the rep's OWN app via a mailto: / wa.me deep
 *                        link (mode "open"); the rep sends from their account.
 *              Solux   → sends automatically from the company channel through
 *                        n8n (mode "send").
 *
 * Both paths emit spec_sheet.sent for audit; gated by integration.send_business.
 * Solux + WhatsApp uses a Meta-approved template, so the message box is locked.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import { sendModelSpecSheet } from "../actions/send-datasheet";
import { listSendableClients, type SendableClient } from "../actions/recipients";
import {
  buildMailto,
  buildWhatsAppLink,
  recipientForChannel,
  detectRecipientKind,
  type DatasheetChannel,
} from "../lib/datasheetHandoff";
import { applyTemplate } from "@/features/Intergration/lib/integrations";
import type { TemplateRow } from "@/features/Intergration/actions/templates";

type Sender = "me" | "solux";
const CHANNEL_LABEL: Record<DatasheetChannel, string> = { email: "Email", whatsapp: "WhatsApp" };

export function SendDatasheetForm({
  productId,
  sku,
  version,
  productName,
  templates = [],
}: {
  productId: string;
  sku: string | null;
  version: string | null;
  productName: string;
  templates?: TemplateRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<DatasheetChannel>("email");
  const [sender, setSender] = useState<Sender>("me");
  const [clients, setClients] = useState<SendableClient[] | null>(null);
  const [loadingClients, setLoadingClients] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SendableClient | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState(
    `Hi — attached is the ${productName} spec sheet${version ? ` (${version})` : ""}. Let me know if you need anything else.`
  );

  const mode: "open" | "send" = sender === "me" ? "open" : "send";
  const subject = `${productName} datasheet${version ? ` (${version})` : ""}`;
  const datasheetFilename = `${sku ?? productName}-${version ?? "current"}.pdf`;
  // Solux + WhatsApp sends a Meta-approved template; free text is ignored.
  const messageLocked = sender === "solux" && channel === "whatsapp";

  const kind = detectRecipientKind(query);
  const manualRecipient = kind === "email" || kind === "phone" ? query.trim() : "";
  const recipient = selected ? recipientForChannel(channel, selected) : manualRecipient;
  const missingField = !!selected && !recipient;

  const matches = useMemo(() => {
    if (selected || kind !== "search" || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    return (clients ?? [])
      .filter((c) => c.company.toLowerCase().includes(q) || (c.contactName ?? "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [clients, query, selected, kind]);

  useEffect(() => {
    if (!open || clients !== null || loadingClients) return;
    setLoadingClients(true);
    listSendableClients()
      .then(setClients)
      .catch(() => setClients([]))
      .finally(() => setLoadingClients(false));
  }, [open, clients, loadingClients]);

  function onQuery(v: string) {
    setQuery(v);
    setSelected(null);
    setMenuOpen(true);
  }
  function selectClient(c: SendableClient) {
    setSelected(c);
    setQuery(`${c.company}${c.contactName ? ` · ${c.contactName}` : ""}`);
    setMenuOpen(false);
  }
  function applyTpl(id: string) {
    const t = templates.find((x) => x.id === id);
    if (t) setMessage(applyTemplate(t.body, { product: productName, version, sku }));
  }

  function submit() {
    const holder = mode === "open" && channel === "whatsapp" ? window.open("", "_blank") : null;
    startTransition(async () => {
      try {
        const { datasheetUrl } = await sendModelSpecSheet({
          productId, sku, version, productName, channel, recipient, message,
          clientId: selected?.id ?? null,
          mode,
        });
        if (mode === "open") {
          const url =
            channel === "email"
              ? buildMailto({ recipient, subject, message, datasheetUrl })
              : buildWhatsAppLink({ recipient, message, datasheetUrl });
          if (channel === "whatsapp") {
            if (holder) holder.location.href = url;
            else window.open(url, "_blank");
          } else {
            window.location.href = url;
          }
          toast.success(`Opening ${CHANNEL_LABEL[channel]}…`);
        } else {
          toast.success("Datasheet queued for delivery");
        }
        router.refresh();
      } catch (e: any) {
        holder?.close();
        toast.error(e?.message ?? "Could not send datasheet");
      }
    });
  }

  const senderDesc = (s: Sender): string => {
    if (s === "me") return channel === "email" ? "Opens your mail app" : "Opens WhatsApp on your device";
    return channel === "email" ? "From contact@solux-light.com" : "Solux WhatsApp number";
  };

  const chip = (c: DatasheetChannel) => (
    <button
      key={c}
      type="button"
      onClick={() => setChannel(c)}
      className={channel === c ? "sx-btn sx-btn-go" : "sx-btn"}
    >
      {CHANNEL_LABEL[c]}
    </button>
  );

  const senderBtn = (s: Sender, label: string) => {
    const active = sender === s;
    return (
      <button
        key={s}
        type="button"
        onClick={() => setSender(s)}
        style={{
          flex: 1,
          textAlign: "left",
          background: "var(--sx-surface, #fff)",
          border: active ? "2px solid var(--sx-green, #22c55e)" : "1px solid var(--sx-line, #e7e7ea)",
          borderRadius: 8,
          padding: "9px 11px",
          cursor: "pointer",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div className="sx-micro" style={{ marginTop: 1 }}>{senderDesc(s)}</div>
      </button>
    );
  };

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button type="button" className="sx-btn sx-btn-go" onClick={() => setOpen((o) => !o)}>
        Send to customer
      </button>
      {!open ? null : (
        <div
          id="send-datasheet"
          className="card sec"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: "min(440px, 88vw)",
            zIndex: 40,
            borderColor: "var(--sx-green, #22c55e)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            textAlign: "left",
          }}
        >
          <div className="sx-sectitle">
            <h2>Send to customer</h2>
          </div>
          <p className="sx-sub" style={{ marginTop: -4 }}>
            Sends the branded <strong>{productName}</strong> datasheet{version ? ` (${version})` : ""}.
          </p>

          {/* TO — smart recipient field */}
          <div style={{ marginTop: 12, position: "relative" }}>
            <label className="sx-micro">To</label>
            <input
              className="sx-input"
              style={{ width: "100%", marginTop: 4 }}
              placeholder="Search a client, or paste an email / phone"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onFocus={() => setMenuOpen(true)}
              onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
            />
            {menuOpen && matches.length > 0 ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: "calc(100% + 2px)",
                  background: "var(--sx-surface, #fff)",
                  border: "1px solid var(--sx-line, #e7e7ea)",
                  borderRadius: 8,
                  zIndex: 50,
                  overflow: "hidden",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
                }}
              >
                {matches.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectClient(c);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      borderTop: i > 0 ? "1px solid var(--sx-line, #e7e7ea)" : "none",
                      padding: "8px 11px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 13 }}>{c.company}</div>
                    <div className="sx-micro">
                      {c.contactName ? `${c.contactName} · ` : ""}
                      {channel === "email" ? c.email ?? "no email" : c.phone ?? "no phone"}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="sx-micro" style={{ marginTop: 4 }}>
              {loadingClients ? (
                "Loading your clients…"
              ) : missingField ? (
                <span style={{ color: "var(--sx-danger, #dc2626)" }}>
                  No {channel === "email" ? "email" : "phone"} on file for this client — switch channel or paste one.
                </span>
              ) : recipient ? (
                `Sending to ${recipient}`
              ) : (
                "Type a name to search, or paste an address to send directly."
              )}
            </div>
          </div>

          {/* FROM — channel, then sender */}
          <div style={{ marginTop: 12 }}>
            <label className="sx-micro">From</label>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>{(["email", "whatsapp"] as const).map(chip)}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {senderBtn("me", "Me")}
              {senderBtn("solux", "Solux (Business)")}
            </div>
          </div>

          {/* Message */}
          <div style={{ marginTop: 12 }}>
            <label className="sx-micro">Message</label>
            {messageLocked ? (
              <div
                style={{
                  marginTop: 4,
                  border: "1px solid var(--sx-line, #e7e7ea)",
                  borderRadius: 8,
                  background: "var(--sx-muted-bg, #f4f4f5)",
                  color: "var(--sx-muted, #71717a)",
                  padding: "9px 11px",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                Set by the approved WhatsApp template — the customer gets the approved wording with the product
                name filled in.
              </div>
            ) : (
              <>
                {templates.length > 0 ? (
                  <select
                    className="sx-input"
                    style={{ width: "100%", marginTop: 4 }}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) applyTpl(e.target.value);
                      e.target.value = "";
                    }}
                  >
                    <option value="">Insert a template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <textarea
                  className="sx-input"
                  style={{ width: "100%", marginTop: 4 }}
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </>
            )}
            <div
              style={{
                marginTop: 6,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--sx-muted, #71717a)",
                border: "1px solid var(--sx-line, #e7e7ea)",
                borderRadius: 6,
                padding: "3px 8px",
              }}
            >
              {datasheetFilename} · {mode === "open" ? "sent as a link" : "attached"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
            <button
              type="button"
              className="sx-btn sx-btn-go"
              disabled={pending || !recipient.trim() || missingField}
              onClick={submit}
            >
              {pending ? "Sending…" : "Send"}
            </button>
            <button type="button" className="sx-btn" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <span className="sx-micro" style={{ display: "block", marginTop: 8 }}>
            Logged + audited via spec_sheet.sent.
          </span>
        </div>
      )}
    </div>
  );
}

export default SendDatasheetForm;
