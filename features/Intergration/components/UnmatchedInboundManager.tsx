"use client";

// Integrations — unmatched-inbound review (admin). Each row is an inbound
// message whose sender phone matched no client. Reviewer either reconciles it
// onto a client (appends the client timeline) or ignores it. Mirrors the
// WebhooksManager pattern: useTransition + toast + router.refresh.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import {
  reconcileUnmatchedInbound,
  ignoreUnmatchedInbound,
  searchClientsForReconcile,
  type UnmatchedInboundRow,
  type ClientMatchOption,
} from "@/features/Intergration/actions/unmatched-inbound";

const btn =
  "inline-flex items-center rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm font-medium hover:border-neutral-900 disabled:opacity-40";

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp_business: "WhatsApp",
  zalo_oa: "Zalo OA",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  zalo: "Zalo",
  email: "Email",
};

function clientLabel(c: ClientMatchOption): string {
  return [c.company_name || "(no name)", c.client_code].filter(Boolean).join(" · ");
}

/** Per-row client typeahead + reconcile / ignore. */
function ReviewRow({ row }: { row: UnmatchedInboundRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientMatchOption[]>([]);
  const [picked, setPicked] = useState<ClientMatchOption | null>(null);

  function search(q: string) {
    setQuery(q);
    setPicked(null);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    startTransition(async () => {
      try {
        setResults(await searchClientsForReconcile(q));
      } catch {
        setResults([]);
      }
    });
  }

  function reconcile() {
    if (!picked) return;
    startTransition(async () => {
      try {
        await reconcileUnmatchedInbound({ id: row.id, clientId: picked.id });
        toast.success(`Reconciled to ${clientLabel(picked)}`);
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not reconcile");
      }
    });
  }

  function ignore() {
    startTransition(async () => {
      try {
        await ignoreUnmatchedInbound(row.id);
        toast.success("Message dismissed");
        router.refresh();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not dismiss");
      }
    });
  }

  const received = row.received_at ? new Date(row.received_at).toLocaleString() : "";

  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-3 text-xs text-neutral-500">
        <span className="font-semibold uppercase tracking-wide">
          {CHANNEL_LABEL[row.channel] ?? row.channel} · inbound
        </span>
        <span>{received}</span>
      </div>
      <div className="mt-1 text-sm">
        <span className="font-mono text-xs text-neutral-600">{row.display_name || row.from_identifier}</span>
        {row.summary ? <p className="mt-0.5 text-neutral-800">“{row.summary}”</p> : null}
      </div>

      <div className="mt-2.5">
        <label className="mb-1 block text-xs font-medium text-neutral-500">Match to client</label>
        <input
          className="w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
          placeholder="Search company name or client code…"
          value={picked ? clientLabel(picked) : query}
          onChange={(e) => search(e.target.value)}
        />
        {!picked && results.length > 0 ? (
          <div className="mt-1 max-h-44 overflow-auto rounded-md border border-neutral-200">
            {results.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-sm hover:bg-neutral-50"
                onClick={() => {
                  setPicked(c);
                  setResults([]);
                }}
              >
                <span>{clientLabel(c)}</span>
                {c.phone_number ? <span className="font-mono text-xs text-neutral-400">{c.phone_number}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          disabled={pending || !picked}
          onClick={reconcile}
        >
          {pending ? "Working…" : "Reconcile"}
        </button>
        <button type="button" className={btn} disabled={pending} onClick={ignore}>
          Ignore
        </button>
      </div>
    </div>
  );
}

export function UnmatchedInboundManager({ initial }: { initial: UnmatchedInboundRow[] }) {
  if (initial.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500">
        No unmatched messages.
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {initial.map((row) => (
        <ReviewRow key={row.id} row={row} />
      ))}
    </div>
  );
}

export default UnmatchedInboundManager;
