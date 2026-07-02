"use client";

// Human dedup queue (§4.3): each card shows two look-alike clients + the score;
// the user keeps one (absorbing the other) or keeps them separate. Never auto.

import { useState } from "react";
import { resolveMerge } from "./actions";

type Side = { id: string; code: string; name: string; orders: number; total: number };
export type Suggestion = { id: string; score: number | null; a: Side; b: Side };

function fmt(n: number) { return n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }); }

export default function MergeQueue({ initial }: { initial: Suggestion[] }) {
  const [items, setItems] = useState<Suggestion[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});

  async function act(s: Suggestion, decision: "merge" | "separate", winner?: Side, loser?: Side) {
    setBusy(s.id);
    setErr((e) => { const n = { ...e }; delete n[s.id]; return n; });
    const res = await resolveMerge({ suggestionId: s.id, decision, winnerId: winner?.id, loserId: loser?.id });
    setBusy(null);
    if (res.ok) setItems((its) => its.filter((x) => x.id !== s.id));
    else setErr((e) => ({ ...e, [s.id]: res.error }));
  }

  if (items.length === 0) {
    return <div className="rounded-xl border border-neutral-200 bg-white px-5 py-8 text-center text-sm text-neutral-400">Aucun doublon à valider. 🎉</div>;
  }

  const side = (s: Suggestion, x: Side, other: Side) => (
    <div className="flex-1 rounded-lg border border-neutral-200 bg-white p-3">
      <div className="text-sm font-semibold text-neutral-900">{x.name || "(sans nom)"}</div>
      <div className="text-[11px] text-neutral-400">{x.code} · {fmt(x.orders)} commande{x.orders > 1 ? "s" : ""} · {fmt(x.total)} USD</div>
      <button
        type="button"
        disabled={busy === s.id}
        onClick={() => act(s, "merge", x, other)}
        className="mt-2 w-full rounded-md bg-neutral-900 px-2 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-neutral-700 disabled:opacity-50"
      >
        Garder celui-ci
      </button>
    </div>
  );

  return (
    <div className="space-y-3">
      {items.map((s) => (
        <div key={s.id} className="rounded-xl border border-neutral-200 bg-neutral-50/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">Ressemblance {s.score != null ? `${Math.round(s.score)}%` : ""}</span>
            <button type="button" disabled={busy === s.id} onClick={() => act(s, "separate")} className="rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[12px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50">
              Garder séparés
            </button>
          </div>
          <div className="flex items-stretch gap-3">
            {side(s, s.a, s.b)}
            <div className="flex items-center text-neutral-300">↔</div>
            {side(s, s.b, s.a)}
          </div>
          {err[s.id] && <div className="mt-2 text-[11px] text-rose-600">{err[s.id]}</div>}
        </div>
      ))}
    </div>
  );
}
