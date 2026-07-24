"use client";

// =====================================================================
// Integrations Phase 1 — client interaction panel.
//   • Channels: click-to-chat deep links (Zalo / WhatsApp / Telegram / Email),
//     each enabled only when the rep has that handle (except Email) and the
//     customer has a target. Opening one arms the "log it?" nudge.
//   • Nudge: after a chat, offer one-tap logging within a 10-minute window.
//   • Manual: log a call / meeting / note directly.
//   • Timeline: the append-only interaction history (LOGGED vs AUTO).
// Consumes logInteraction (m164). Read visibility is RLS-enforced.
// =====================================================================

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import { logInteraction, type ClientInteraction } from "@/features/Intergration/actions/interactions";
import { chatUrl, type InteractionChannel } from "@/features/Intergration/lib/integrations";

const NUDGE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const DEEP_LINKS = [
  { id: "zalo", label: "Zalo" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "email", label: "Email" },
] as const;

const MANUAL_CHANNELS: InteractionChannel[] = ["call", "meeting", "note", "email"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  const days = Math.round(diff / 86_400_000);
  if (days < 14) return `${days}d ago`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const btn =
  "inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm font-medium hover:border-neutral-900 disabled:opacity-40 disabled:hover:border-neutral-200";

export function ClientInteractions({
  clientId,
  customer,
  myChannels,
  interactions,
  canLog,
}: {
  clientId: string;
  customer: { phone: string | null; email: string | null };
  myChannels: { zalo: boolean; whatsapp: boolean; telegram: boolean };
  interactions: ClientInteraction[];
  canLog: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nudge, setNudge] = useState<{ channel: InteractionChannel; at: number } | null>(null);
  const [note, setNote] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualChannel, setManualChannel] = useState<InteractionChannel>("call");
  const [manualNote, setManualNote] = useState("");

  // Nudge auto-expires after the freshness window.
  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudge(null), NUDGE_WINDOW_MS);
    return () => clearTimeout(t);
  }, [nudge]);

  function openChat(channel: (typeof DEEP_LINKS)[number]["id"], url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
    if (canLog && channel !== "email") setNudge({ channel: channel as InteractionChannel, at: Date.now() });
  }

  function commitLog(channel: InteractionChannel, summary: string, after: () => void) {
    startTransition(async () => {
      try {
        await logInteraction({ clientId, channel, direction: "outbound", summary: summary || null });
        toast.success("Interaction logged");
        after();
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not log interaction");
      }
    });
  }

  return (
    <section className="panel p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="eyebrow">Channels — opens the chat in your app, then offers to log</div>
      </div>

      {/* deep-link channel buttons */}
      <div className="flex flex-wrap gap-2">
        {DEEP_LINKS.map(({ id, label }) => {
          const hasHandle = id === "email" ? true : myChannels[id as "zalo" | "whatsapp" | "telegram"];
          const url = chatUrl(id, { phone: customer.phone, email: customer.email, handle: null });
          const disabled = !url || !hasHandle;
          const title = !hasHandle
            ? "Add your handle under Settings · Integrations → My channels"
            : !url
            ? "No customer target for this channel"
            : "";
          return (
            <button
              key={id}
              type="button"
              className={btn}
              disabled={disabled}
              title={title}
              onClick={() => url && openChat(id, url)}
            >
              {label}
            </button>
          );
        })}
        {canLog ? (
          <button type="button" className={btn} onClick={() => setManualOpen((v) => !v)}>
            + Log a call / note
          </button>
        ) : null}
      </div>

      {/* nudge */}
      {nudge ? (
        <div className="flex flex-wrap items-center gap-2 border-l-2 border-amber-500 bg-amber-50 px-3 py-2.5">
          <span className="flex-1 min-w-[200px] text-sm font-medium text-amber-800">
            Chatted on {nudge.channel} just now — log it?
          </span>
          <input
            className="min-w-[210px] flex-[2] rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
            placeholder="optional note, e.g. discussed delivery date"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={pending}
            onClick={() => commitLog(nudge.channel, note, () => { setNudge(null); setNote(""); })}
          >
            {pending ? "Logging…" : "Log"}
          </button>
          <button type="button" className={btn} onClick={() => setNudge(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/* manual logger */}
      {manualOpen && canLog ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5">
          <select
            className="rounded-md border border-neutral-200 px-2 py-1.5 text-sm"
            value={manualChannel}
            onChange={(e) => setManualChannel(e.target.value as InteractionChannel)}
          >
            {MANUAL_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="min-w-[210px] flex-[2] rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
            placeholder="what happened…"
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
          />
          <button
            type="button"
            className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={pending}
            onClick={() => commitLog(manualChannel, manualNote, () => { setManualOpen(false); setManualNote(""); })}
          >
            {pending ? "Logging…" : "Log"}
          </button>
        </div>
      ) : null}

      {/* timeline */}
      <div>
        <div className="eyebrow mb-2">Recent interactions</div>
        {interactions.length === 0 ? (
          <div className="rounded-md border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500">
            No interactions logged yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-neutral-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2">Channel</th>
                  <th className="px-3 py-2">Summary</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {interactions.map((it) => (
                  <tr key={it.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2 font-medium capitalize">{it.channel.replace("_", " ")}</td>
                    <td className="px-3 py-2">{it.summary ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase " +
                          (it.source === "auto"
                            ? "border-neutral-200 text-neutral-500"
                            : "border-amber-300 bg-amber-50 text-amber-800")
                        }
                      >
                        {it.source === "auto" ? "AUTO" : "LOGGED"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{fmtWhen(it.happened_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

export default ClientInteractions;
