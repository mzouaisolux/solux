"use client";

import { useState } from "react";
import {
  FORWARDERS,
  buildForwarderEmail,
  type ForwarderBrief,
} from "@/lib/forwarder-email";

/**
 * Feature #3 — "Generate Forwarder Email". Turns a packing/freight brief into
 * ready-to-copy freight-quotation text for a forwarder. No address book / no
 * auto-send yet: the user picks a forwarder, the text appears, they copy/paste.
 * Extensible: forwarders come from FORWARDERS (lib/forwarder-email).
 */
export default function ForwarderEmailButton({
  brief,
  compact = false,
}: {
  brief: ForwarderBrief;
  compact?: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [copied, setCopied] = useState<"" | "subject" | "body">("");

  const generated = active ? buildForwarderEmail(brief, active) : null;

  const copy = async (what: "subject" | "body", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked — the textarea is selectable as a fallback */
    }
  };

  return (
    <div style={{ marginTop: compact ? 8 : 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <span className="sx-micro" style={{ fontWeight: 600 }}>Generate Forwarder Email:</span>
        {FORWARDERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => { setActive(f.key); setCopied(""); }}
            className={`sx-btn sx-btn-sm${active === f.key ? " sx-btn-ink" : ""}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {generated && (
        <div
          style={{
            marginTop: 10,
            border: "1px solid var(--sx-line)",
            borderRadius: 8,
            padding: 12,
            background: "var(--sx-surface-2, #fafafa)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div className="sx-micro" style={{ fontWeight: 600 }}>Subject</div>
            <button type="button" className="sx-btn sx-btn-sm" onClick={() => copy("subject", generated.subject)}>
              {copied === "subject" ? "✓ Copied" : "Copy subject"}
            </button>
          </div>
          <input readOnly value={generated.subject} onFocus={(e) => e.currentTarget.select()} style={{ width: "100%", marginTop: 4, fontSize: 13 }} />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
            <div className="sx-micro" style={{ fontWeight: 600 }}>Body</div>
            <button type="button" className="sx-btn sx-btn-sm sx-btn-go" onClick={() => copy("body", generated.body)}>
              {copied === "body" ? "✓ Copied" : "Copy body"}
            </button>
          </div>
          <textarea
            readOnly
            value={generated.body}
            onFocus={(e) => e.currentTarget.select()}
            rows={13}
            style={{ width: "100%", marginTop: 4, fontFamily: "var(--mono, ui-monospace, monospace)", fontSize: 12.5, lineHeight: 1.5, resize: "vertical" }}
          />
          <p className="sx-micro" style={{ color: "var(--sx-mute-2)", marginTop: 6 }}>
            Copy into your email client and send to {generated.forwarder?.label}. No email is sent automatically.
          </p>
        </div>
      )}
    </div>
  );
}
