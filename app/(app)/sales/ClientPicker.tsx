"use client";

// Client autocomplete for the register (§4.4): pick from the master list —
// never free text. Creating a new client goes through the fuzzy dedup guard.
// The dropdown is PORTALED (fixed position) so it is never clipped by the
// grid's frozen columns / horizontal-scroll container.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchSalesClients, createSalesClient } from "./actions";

export type PickedClient = { id: string; code: string; name: string };

export default function ClientPicker({
  value,
  onPicked,
}: {
  value: PickedClient | null;
  onPicked: (c: PickedClient) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedClient[]>([]);
  const [busy, setBusy] = useState(false);
  const [suggest, setSuggest] = useState<{ candidate: PickedClient; score: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function place() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 260) });
  }

  function openMenu() {
    place();
    setOpen(true);
    setSuggest(null);
    setErr(null);
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false); // avoid a detached, misaligned popover
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setBusy(true);
      try { setResults(await searchSalesClients(q)); } finally { setBusy(false); }
    }, 200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, open]);

  function pick(c: PickedClient) {
    onPicked(c);
    setOpen(false);
    setQ("");
    setSuggest(null);
    setErr(null);
  }

  async function create(force: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const res = await createSalesClient(q.trim(), force ? { force: true } : undefined);
      if (res.mode === "suggest") setSuggest({ candidate: res.candidate, score: res.score });
      else if (res.mode === "error") setErr(res.error);
      else pick(res.client);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="w-full truncate text-left text-neutral-900 hover:text-neutral-500"
        title={value?.name ?? "Choisir un client"}
      >
        {value ? value.name : <span className="text-neutral-300">— choisir —</span>}
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
          className="z-[100] max-h-80 overflow-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-xl"
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setSuggest(null); setErr(null); }}
            placeholder="Rechercher un client…"
            className="mb-1 w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm outline-none focus:border-neutral-400"
          />
          {busy && <div className="px-2 py-1 text-[11px] text-neutral-400">…</div>}

          {suggest ? (
            <div className="space-y-1 px-2 py-1.5 text-[12px]">
              <div className="text-neutral-600">Ressemble à <strong>{suggest.candidate.name}</strong> ({suggest.score}%).</div>
              <div className="flex gap-1">
                <button type="button" onClick={() => pick(suggest.candidate)} className="rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-white">Utiliser {suggest.candidate.code}</button>
                <button type="button" onClick={() => create(true)} className="rounded-md border border-neutral-200 px-2 py-1 text-[11px]">Créer quand même</button>
              </div>
            </div>
          ) : (
            <>
              {results.map((c) => (
                <button key={c.id} type="button" onClick={() => pick(c)} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-50">
                  <span className="text-neutral-900">{c.name || "(sans nom)"}</span>
                  <span className="ml-1 text-[11px] text-neutral-400">{c.code}</span>
                </button>
              ))}
              {q.trim() && !results.some((r) => r.name.toLowerCase() === q.trim().toLowerCase()) && (
                <button type="button" onClick={() => create(false)} disabled={busy} className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-emerald-700 hover:bg-emerald-50">＋ Créer « {q.trim()} »</button>
              )}
              {!busy && results.length === 0 && !q.trim() && <div className="px-2 py-1 text-[11px] text-neutral-400">Tape pour rechercher…</div>}
            </>
          )}
          {err && <div className="px-2 py-1 text-[11px] text-rose-600">{err}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
