"use client";

// Integrations Phase 3 — send a message to this customer from a company
// business channel (Zalo OA / WhatsApp Business / Telegram). Only renders when
// at least one channel is connected + active and the rep holds send_business.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import { sendBusinessMessage } from "@/features/Intergration/actions/business-send";
import { BUSINESS_CHANNEL_LABELS, type BusinessChannel } from "@/features/Intergration/lib/providers";
import { applyTemplate } from "@/features/Intergration/lib/integrations";
import type { TemplateRow } from "@/features/Intergration/actions/templates";

const RECIPIENT_HINT: Record<BusinessChannel, string> = {
  whatsapp_business: "Customer phone in international format",
  zalo_oa: "Customer Zalo user_id",
  telegram: "Telegram chat_id",
};

export function SendBusinessMessage({
  clientId,
  channels,
  defaultPhone,
  templates = [],
  company = null,
  contact = null,
}: {
  clientId: string;
  channels: BusinessChannel[];
  defaultPhone?: string | null;
  templates?: TemplateRow[];
  company?: string | null;
  contact?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [channel, setChannel] = useState<BusinessChannel>(channels[0]);
  const [to, setTo] = useState(defaultPhone ?? "");
  const [text, setText] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplLang, setTplLang] = useState("en");
  const [tplParams, setTplParams] = useState("");

  const isWhatsApp = channel === "whatsapp_business";
  const templateMode = isWhatsApp && useTemplate;

  function applyTpl(id: string) {
    const t = templates.find((x) => x.id === id);
    if (t) setText(applyTemplate(t.body, { company, contact }));
  }

  if (channels.length === 0) return null;

  function send() {
    startTransition(async () => {
      try {
        await sendBusinessMessage({
          channel,
          to,
          text,
          clientId,
          template: templateMode
            ? {
                name: tplName.trim(),
                language: tplLang.trim() || "en",
                params: tplParams.split("|").map((p) => p.trim()).filter(Boolean),
              }
            : null,
        });
        toast.success("Message sent");
        setText("");
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not send");
      }
    });
  }

  return (
    <section className="panel p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="eyebrow">Message from company channel</div>
        <span className="text-xs text-neutral-400">gated by integration.send_business</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {channels.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={`rounded-md border px-2.5 py-1.5 text-sm ${
              channel === c ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 hover:border-neutral-900"
            }`}
          >
            {BUSINESS_CHANNEL_LABELS[c]}
          </button>
        ))}
      </div>
      <input
        className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
        placeholder={RECIPIENT_HINT[channel]}
        value={to}
        onChange={(e) => setTo(e.target.value)}
      />

      {isWhatsApp ? (
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <input type="checkbox" checked={useTemplate} onChange={(e) => setUseTemplate(e.target.checked)} />
          Use an approved template (required outside the 24-hour window)
        </label>
      ) : null}

      {templateMode ? (
        <div className="space-y-2 rounded-md border border-neutral-200 p-3">
          <input
            className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
            placeholder="Approved template name (e.g. quote_followup)"
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
          />
          <div className="flex gap-2">
            <input
              className="w-24 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
              placeholder="Lang (en)"
              value={tplLang}
              onChange={(e) => setTplLang(e.target.value)}
            />
            <input
              className="flex-1 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
              placeholder="Body params, pipe-separated: Mai | SSLXPRO 60"
              value={tplParams}
              onChange={(e) => setTplParams(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-neutral-400">The template must already be approved in Meta. Params fill {"{{1}}, {{2}}…"} in order.</p>
        </div>
      ) : (
        <>
          {templates.length > 0 ? (
            <select
              className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
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
            className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
            rows={3}
            placeholder="Message to the customer…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={pending || !to.trim() || (templateMode ? !tplName.trim() : !text.trim())}
          className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send"}
        </button>
        <span className="text-xs text-neutral-400">Logged on the timeline as an outbound touch.</span>
      </div>
    </section>
  );
}

export default SendBusinessMessage;
