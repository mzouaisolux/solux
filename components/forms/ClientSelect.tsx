"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Client } from "@/lib/types";

/**
 * ClientSelect — searchable client combobox.
 *
 * Replaces the native <select> on the quotation builder: the #1 most
 * frequent gesture in the flow, previously a scroll-and-hunt on the full
 * client list. Type-to-filter (name / 3-letter code / country), recently
 * used clients surfaced first, and an inline "Create …" row so a new
 * prospect starts the new-client form pre-filled — without leaving the page.
 *
 * Styled to match CountrySelect (neutral hairline + solux accent) so it
 * feels native to the existing SOLUX form language — no visual redesign.
 *
 * Recents live in localStorage (there is no server-side "last used"
 * signal); same lightweight approach as the product-favourites star.
 */
const RECENTS_KEY = "solux:recent_clients";
const RENDER_CAP = 50;

function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((x) => typeof x === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  if (typeof window === "undefined") return;
  try {
    const next = [id, ...loadRecents().filter((x) => x !== id)].slice(0, 8);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / privacy-mode failures — recents are a nicety, not core.
  }
}

function labelOf(c: Client): string {
  return `${c.company_name}${c.country ? ` (${c.country})` : ""}`;
}

export function ClientSelect({
  clients,
  value,
  onSelect,
  onCreateNew,
  placeholder = "Search a client by name, code or country…",
}: {
  clients: Client[];
  /** Selected client id (controlled). */
  value: string;
  onSelect: (clientId: string) => void;
  /** Opens the inline new-client form, pre-filled with the typed name. */
  onCreateNew?: (query: string) => void;
  placeholder?: string;
}) {
  const selected = useMemo(
    () => clients.find((c) => c.id === value) ?? null,
    [clients, value]
  );
  const [query, setQuery] = useState(selected ? labelOf(selected) : "");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const typingRef = useRef(false);

  useEffect(() => {
    setRecentIds(loadRecents());
  }, []);

  // Reflect an externally-set value (preset client, or the client just
  // created inline) into the field — but never overwrite what the user is
  // actively typing.
  useEffect(() => {
    if (typingRef.current) return;
    setQuery(selected ? labelOf(selected) : "");
  }, [selected]);

  const byId = useMemo(() => {
    const m = new Map<string, Client>();
    for (const c of clients) m.set(c.id, c);
    return m;
  }, [clients]);

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return clients;
    return clients.filter((c) =>
      `${c.company_name} ${c.client_code ?? ""} ${c.country ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [clients, q]);

  const recents = useMemo(() => {
    if (q) return [];
    return recentIds
      .map((id) => byId.get(id))
      .filter((c): c is Client => !!c);
  }, [q, recentIds, byId]);

  // Flat navigable order: recents first (when browsing), then the rest.
  const list = useMemo(() => {
    if (q) return filtered;
    const seen = new Set(recents.map((c) => c.id));
    return [...recents, ...clients.filter((c) => !seen.has(c.id))];
  }, [q, filtered, recents, clients]);

  const capped = list.slice(0, RENDER_CAP);
  const overflow = list.length - capped.length;
  const showCreate = !!onCreateNew && query.trim().length > 0;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        typingRef.current = false;
        setQuery(selected ? labelOf(selected) : "");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, selected]);

  const commit = (c: Client) => {
    onSelect(c.id);
    pushRecent(c.id);
    setRecentIds(loadRecents());
    setQuery(labelOf(c));
    setOpen(false);
    typingRef.current = false;
  };

  const create = () => {
    onCreateNew?.(query.trim());
    setOpen(false);
    typingRef.current = false;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, capped.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && capped[activeIdx]) {
        e.preventDefault();
        commit(capped[activeIdx]);
      } else if (open && showCreate && capped.length === 0) {
        e.preventDefault();
        create();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      typingRef.current = false;
      setQuery(selected ? labelOf(selected) : "");
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setActiveIdx(0);
        }}
        onChange={(e) => {
          typingRef.current = true;
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(0);
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg">
          <div className="max-h-64 overflow-y-auto py-1">
            {!q && recents.length > 0 && (
              <div className="px-3 pb-1 pt-1 text-[10px] uppercase tracking-wider text-neutral-400">
                Recent
              </div>
            )}
            {capped.map((c, i) => (
              <div key={c.id}>
                {!q && recents.length > 0 && i === recents.length && (
                  <div className="mt-1 border-t border-neutral-100 px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-neutral-400">
                    All clients
                  </div>
                )}
                <button
                  type="button"
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => commit(c)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${
                    i === activeIdx
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-700 hover:bg-neutral-50"
                  }`}
                >
                  <span className="truncate">
                    {c.company_name}
                    {c.country ? (
                      <span
                        className={
                          i === activeIdx ? "text-white/70" : "text-neutral-400"
                        }
                      >
                        {" · "}
                        {c.country}
                      </span>
                    ) : null}
                  </span>
                  {c.client_code ? (
                    <span
                      className={`shrink-0 font-mono text-[11px] ${
                        i === activeIdx ? "text-white/70" : "text-neutral-400"
                      }`}
                    >
                      {c.client_code}
                    </span>
                  ) : null}
                </button>
              </div>
            ))}
            {capped.length === 0 && !showCreate && (
              <div className="px-3 py-2 text-xs text-neutral-400">
                No client matches.
              </div>
            )}
            {overflow > 0 && (
              <div className="px-3 py-1.5 text-[11px] text-neutral-400">
                +{overflow} more — keep typing to narrow.
              </div>
            )}
          </div>
          {showCreate && (
            <button
              type="button"
              onClick={create}
              className="flex w-full items-center gap-2 border-t border-neutral-100 px-3 py-2 text-left text-sm text-solux-dark hover:bg-neutral-50"
            >
              <span aria-hidden="true">+</span>
              <span>
                Create “<span className="font-medium">{query.trim()}</span>”
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
