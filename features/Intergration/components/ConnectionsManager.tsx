"use client";

// Integrations Phase 3 — connect business messaging accounts. Tokens are
// write-only: entered here, encrypted server-side, never shown back.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import {
  upsertConnection,
  setConnectionActive,
  disconnectConnection,
  type ConnectionRow,
} from "@/features/Intergration/actions/connections";
import {
  BUSINESS_CHANNELS,
  BUSINESS_CHANNEL_LABELS,
  BUSINESS_CHANNEL_CONFIG_FIELDS,
  type BusinessChannel,
} from "@/features/Intergration/lib/providers";

const btn =
  "inline-flex items-center rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm font-medium hover:border-neutral-900 disabled:opacity-40";

export function ConnectionsManager({ initial }: { initial: ConnectionRow[] }) {
  const byChannel = new Map(initial.map((c) => [c.channel, c]));
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {BUSINESS_CHANNELS.map((ch) => (
        <ChannelCard key={ch} channel={ch} conn={byChannel.get(ch) ?? null} />
      ))}
    </div>
  );
}

function ChannelCard({ channel, conn }: { channel: BusinessChannel; conn: ConnectionRow | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(conn?.label ?? "");
  const [secret, setSecret] = useState("");
  const fields = BUSINESS_CHANNEL_CONFIG_FIELDS[channel];
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const c: Record<string, string> = {};
    for (const f of fields) c[f.key] = (conn?.config?.[f.key] ?? "").toString();
    return c;
  });

  const connected = !!conn?.has_secret;

  function run(p: Promise<void>, ok: string) {
    startTransition(async () => {
      try {
        await p;
        toast.success(ok);
        setOpen(false);
        setSecret("");
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Action failed");
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{BUSINESS_CHANNEL_LABELS[channel]}</div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            connected && conn?.is_active
              ? "border-green-300 bg-green-50 text-green-800"
              : connected
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-neutral-200 bg-neutral-50 text-neutral-500"
          }`}
        >
          {connected ? (conn?.is_active ? "connected" : "paused") : "not connected"}
        </span>
      </div>

      {!open ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={pending} onClick={() => setOpen(true)}>
            {connected ? "Edit" : "Connect"}
          </button>
          {connected ? (
            <>
              <button
                type="button"
                className={btn}
                disabled={pending}
                onClick={() => run(setConnectionActive(channel, !conn!.is_active), conn!.is_active ? "Paused" : "Enabled")}
              >
                {conn!.is_active ? "Pause" : "Enable"}
              </button>
              <button
                type="button"
                className={btn}
                disabled={pending}
                onClick={() => run(disconnectConnection(channel), "Disconnected")}
              >
                Disconnect
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <input
            className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
            placeholder="Label (e.g. Solux VN OA)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {fields.map((f) => (
            <input
              key={f.key}
              className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
              placeholder={`${f.label}${f.required ? "" : " (optional)"}`}
              value={config[f.key] ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
            />
          ))}
          <input
            type="password"
            className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
            placeholder={connected ? "Access token (leave blank to keep)" : "Access token"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={pending}
              onClick={() => run(upsertConnection({ channel, label, config, secret: secret || null }), "Saved")}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" className={btn} disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-neutral-400">Tokens are encrypted and never shown again.</p>
        </div>
      )}
    </div>
  );
}

export default ConnectionsManager;
