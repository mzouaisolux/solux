"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTerm, deleteTerm } from "./actions";
import {
  TERM_CATEGORIES,
  TERM_CATEGORY_LABELS,
  TERM_STATUSES,
  type TermCategory,
  type TermStatus,
} from "@/lib/terminology";

export type TermAdminRow = {
  key: string;
  category: TermCategory;
  en: string;
  zh: string | null;
  fr: string | null;
  status: TermStatus;
  notes: string | null;
  updated_at: string | null;
  updated_by_label: string | null;
  builtin: boolean;
  overridden: boolean;
};

const STATUS_STYLE: Record<TermStatus, string> = {
  validated: "border-emerald-200 bg-emerald-50 text-emerald-800",
  draft: "border-amber-300 bg-amber-50 text-amber-900",
  deprecated: "border-neutral-200 bg-neutral-100 text-neutral-500",
};

/**
 * The terminology table (m177) — one editable row per fixed term.
 *
 * Rows expand into a form; saving upserts. A term with no stored row yet
 * shows as "built-in" — the value shipped in the code, which is what the
 * documents render until someone edits it here.
 */
export function TerminologyEditor({
  rows,
  live,
}: {
  rows: TermAdminRow[];
  live: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"" | TermCategory>("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (cat && r.category !== cat) return false;
      if (onlyPending && r.status === "validated" && r.zh) return false;
      if (!needle) return true;
      return (
        r.key.toLowerCase().includes(needle) ||
        r.en.toLowerCase().includes(needle) ||
        (r.zh ?? "").includes(needle) ||
        (r.fr ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, cat, onlyPending]);

  const submit = (fd: FormData) => {
    setError(null);
    startSaving(async () => {
      try {
        await saveTerm(fd);
        setOpen(null);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to save the term.");
      }
    });
  };

  const remove = (key: string) => {
    setError(null);
    const fd = new FormData();
    fd.set("key", key);
    startSaving(async () => {
      try {
        await deleteTerm(fd);
        setOpen(null);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to delete the term.");
      }
    });
  };

  const input = "w-full rounded-md border border-neutral-200 px-3 py-2 text-sm";

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="panel p-3 flex flex-wrap items-end gap-3">
        <label className="block grow min-w-[220px]">
          <span className="eyebrow mb-1 block">Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="key, English, 中文, français…"
            className={input}
          />
        </label>
        <label className="block">
          <span className="eyebrow mb-1 block">Category</span>
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value as "" | TermCategory)}
            className={input}
          >
            <option value="">All categories</option>
            {TERM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TERM_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 pb-2 text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={onlyPending}
            onChange={(e) => setOnlyPending(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300"
          />
          Needs validation only
        </label>
        <span className="pb-2 text-xs text-neutral-500">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {/* Rows */}
      <div className="panel divide-y divide-neutral-100">
        {filtered.length === 0 && (
          <p className="px-4 py-6 text-sm text-neutral-500">
            No term matches these filters.
          </p>
        )}
        {filtered.map((r) => {
          const isOpen = open === r.key;
          return (
            <div key={r.key}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : r.key)}
                className="w-full px-4 py-2.5 text-left hover:bg-neutral-50"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <code className="text-[11px] text-neutral-500">{r.key}</code>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${STATUS_STYLE[r.status]}`}
                  >
                    {r.status}
                  </span>
                  {r.builtin && (
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] text-neutral-500">
                      built-in
                    </span>
                  )}
                  {r.overridden && (
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] text-sky-800">
                      overridden
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                  <span className="text-sm text-neutral-900">{r.en}</span>
                  <span className="text-sm text-neutral-700">{r.zh ?? "—"}</span>
                  {r.fr && <span className="text-xs text-neutral-500">{r.fr}</span>}
                </div>
              </button>

              {isOpen && (
                <form
                  action={submit}
                  className="border-t border-neutral-100 bg-neutral-50/60 px-4 py-3 grid grid-cols-1 md:grid-cols-12 gap-3"
                >
                  <input type="hidden" name="key" value={r.key} />
                  <label className="block md:col-span-4">
                    <span className="eyebrow mb-1 block">English *</span>
                    <input
                      name="en"
                      defaultValue={r.en}
                      required
                      className={input}
                    />
                    <span className="mt-1 block text-[11px] text-neutral-500">
                      The fallback for every locale — never left empty.
                    </span>
                  </label>
                  <label className="block md:col-span-4">
                    <span className="eyebrow mb-1 block">中文 (Chinese)</span>
                    <input name="zh" defaultValue={r.zh ?? ""} className={input} />
                    <span className="mt-1 block text-[11px] text-neutral-500">
                      Required to mark the term validated.
                    </span>
                  </label>
                  <label className="block md:col-span-4">
                    <span className="eyebrow mb-1 block">Français</span>
                    <input name="fr" defaultValue={r.fr ?? ""} className={input} />
                  </label>

                  <label className="block md:col-span-3">
                    <span className="eyebrow mb-1 block">Category</span>
                    <select
                      name="category"
                      defaultValue={r.category}
                      className={input}
                    >
                      {TERM_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {TERM_CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block md:col-span-3">
                    <span className="eyebrow mb-1 block">Status</span>
                    <select name="status" defaultValue={r.status} className={input}>
                      {TERM_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block md:col-span-6">
                    <span className="eyebrow mb-1 block">Notes</span>
                    <input
                      name="notes"
                      defaultValue={r.notes ?? ""}
                      placeholder="Context for whoever validates this term"
                      className={input}
                    />
                  </label>

                  <div className="md:col-span-12 flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={saving || !live}
                      className="rounded-md border border-solux bg-solux px-3 py-1.5 text-xs font-medium text-white hover:bg-solux/90 disabled:opacity-60"
                    >
                      {saving ? "Saving…" : "Save term"}
                    </button>
                    {!r.builtin && (
                      <button
                        type="button"
                        onClick={() => remove(r.key)}
                        disabled={saving || !live}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                      >
                        Reset to built-in
                      </button>
                    )}
                    <span className="text-[11px] text-neutral-500">
                      {r.updated_at
                        ? `Last modified ${r.updated_at.slice(0, 10)}${
                            r.updated_by_label ? ` by ${r.updated_by_label}` : ""
                          }`
                        : "Never modified — built-in value"}
                    </span>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
