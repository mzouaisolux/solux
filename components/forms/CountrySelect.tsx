"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { COUNTRIES, findCountry } from "@/lib/countries";

/**
 * CountrySelect — searchable country combobox.
 *
 * Stores the canonical country `name` in a hidden input (`name` prop)
 * so plain <form> submissions + server actions pick it up unchanged.
 * Typing filters the list; selecting commits the canonical value. This
 * is what kills "Benin" / "Bénin" / "benin" drift.
 *
 * Controlled-optional: pass `defaultValue` for edit forms, or wire
 * `onSelect` to mirror into a parent's own state (the quotation form
 * keeps its newClient object in React state).
 *
 * No external dependency — plain input + filtered list + keyboard nav.
 */
export function CountrySelect({
  name,
  defaultValue,
  onSelect,
  placeholder = "Search country…",
  required = false,
  className = "",
}: {
  /** Hidden input name for form submission. */
  name: string;
  defaultValue?: string | null;
  /** Fires with the canonical country name (or "" when cleared). */
  onSelect?: (countryName: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  // Display text starts from the canonical match of defaultValue, but
  // falls back to the raw legacy value so old free-text data still shows.
  const initial = defaultValue ?? "";
  const [value, setValue] = useState(initial); // committed canonical value
  const [query, setQuery] = useState(
    findCountry(initial)?.name ?? initial
  );
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q
    );
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const commit = (countryName: string) => {
    setValue(countryName);
    setQuery(countryName);
    setOpen(false);
    onSelect?.(countryName);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[activeIdx]) {
        e.preventDefault();
        commit(filtered[activeIdx].name);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input type="hidden" name={name} value={value} />
      <input
        type="text"
        value={query}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(0);
          // If the typed text exactly matches a country, commit it so a
          // blur without explicit selection still stores canonical data.
          const match = findCountry(e.target.value);
          setValue(match ? match.name : "");
          if (match) onSelect?.(match.name);
          else onSelect?.("");
        }}
        onKeyDown={onKeyDown}
        className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg">
          {filtered.map((c, i) => (
            <li key={c.code}>
              <button
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => commit(c.name)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${
                  i === activeIdx
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                <span>{c.name}</span>
                <span
                  className={`text-[11px] tabular-nums ${
                    i === activeIdx ? "text-white/70" : "text-neutral-400"
                  }`}
                >
                  {c.dial}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-400 shadow-lg">
          No match. Country must be in the standard list.
        </div>
      )}
    </div>
  );
}
