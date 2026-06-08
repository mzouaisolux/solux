"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRiskFlags } from "@/app/(app)/task-lists/[id]/actions";
import {
  normalizeRiskFlags,
  type RiskFlags,
  type RiskFlag,
} from "@/lib/risks";

/**
 * RiskFlagsEditor — loud, lightweight risk awareness for a project.
 *
 * Risks are laid out in a responsive 2-column grid so the whole set is
 * visible at a glance — no accordion, no clicks to reveal. Active risks
 * tint rose and surface as bold chips at the top so factory/ops can't
 * miss them. Custom risks + a general note supported. Saves the whole
 * set as one JSON blob.
 */
export function RiskFlagsEditor({
  taskListId,
  initial,
  editable,
}: {
  taskListId: string;
  initial: unknown;
  editable: boolean;
}) {
  const router = useRouter();
  const [flags, setFlags] = useState<RiskFlags>(() =>
    normalizeRiskFlags(initial)
  );
  const [saving, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = flags.items.filter((f) => f.active);
  const hasActive = active.length > 0;

  const setItem = (idx: number, patch: Partial<RiskFlag>) =>
    setFlags((s) => ({
      ...s,
      items: s.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));

  const addCustom = () =>
    setFlags((s) => ({
      ...s,
      items: [
        ...s.items,
        { key: "other", label: "", active: true, note: null, custom: true },
      ],
    }));

  const removeItem = (idx: number) =>
    setFlags((s) => ({ ...s, items: s.items.filter((_, i) => i !== idx) }));

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("id", taskListId);
    fd.set("risk_flags", JSON.stringify(flags));
    startTransition(async () => {
      try {
        await updateRiskFlags(fd);
        setSavedAt(Date.now());
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to save risks");
      }
    });
  };

  return (
    <section
      className={`rounded-lg border px-4 py-3 ${
        hasActive
          ? "border-2 border-rose-400 bg-rose-50/60"
          : "border-neutral-200 bg-white"
      }`}
    >
      {/* Header — always visible, no collapse. Loud when risks are flagged. */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <span
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] ${
            hasActive
              ? "bg-rose-600 text-white"
              : "bg-neutral-100 text-neutral-400"
          }`}
          aria-hidden
        >
          ⚠
        </span>
        <span
          className={`text-sm font-semibold ${
            hasActive ? "text-rose-900" : "text-neutral-800"
          }`}
        >
          Known risks &amp; warnings
        </span>
        {hasActive ? (
          <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
            {active.length} active
          </span>
        ) : (
          <span className="text-[11px] text-neutral-400">
            None flagged — tick anything the factory should watch.
          </span>
        )}
      </div>

      {/* Active risk chips — quick scan summary for a risky project. */}
      {hasActive && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {active.map((r) => (
            <span
              key={r.key + r.label}
              className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-900"
              title={r.note ?? undefined}
            >
              ⚠ {r.label || "Risk"}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-2.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      {/* Full-width responsive grid — every risk visible at once, no clicks. */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {flags.items.map((it, idx) => {
          const on = it.active;
          return (
            <div
              key={idx}
              className={`rounded-md border px-2.5 py-2 transition-colors ${
                on
                  ? "border-rose-300 bg-rose-100/70"
                  : "border-neutral-200 bg-white hover:border-neutral-300"
              }`}
            >
              <div className="flex items-start gap-2">
                <label className="inline-flex items-start gap-2 flex-1 min-w-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!editable}
                    onChange={(e) => setItem(idx, { active: e.target.checked })}
                    className="h-4 w-4 mt-0.5 rounded border-neutral-300 shrink-0 accent-rose-600"
                  />
                  {it.custom ? (
                    <input
                      value={it.label}
                      disabled={!editable}
                      placeholder="Describe the risk"
                      onChange={(e) => setItem(idx, { label: e.target.value })}
                      className="flex-1 min-w-0 rounded border border-neutral-200 px-2 py-1 text-sm disabled:bg-neutral-50"
                    />
                  ) : (
                    <span
                      className={`text-[13px] leading-snug ${
                        on ? "font-medium text-rose-900" : "text-neutral-600"
                      }`}
                    >
                      {it.label}
                    </span>
                  )}
                </label>
                {it.custom && editable && (
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="text-neutral-400 hover:text-rose-600 text-xs px-0.5 shrink-0"
                    aria-label="Remove risk"
                  >
                    ✕
                  </button>
                )}
              </div>
              {on && (
                <input
                  value={it.note ?? ""}
                  disabled={!editable}
                  placeholder="Detail (optional) — e.g. panel 410×680"
                  onChange={(e) =>
                    setItem(idx, { note: e.target.value || null })
                  }
                  className="mt-1.5 ml-6 w-[calc(100%-1.5rem)] rounded border border-rose-200 bg-white px-2 py-1 text-xs disabled:bg-neutral-50"
                />
              )}
            </div>
          );
        })}
      </div>

      {editable && (
        <button
          type="button"
          onClick={addCustom}
          className="mt-2 text-[11px] text-neutral-600 hover:text-neutral-900 underline underline-offset-2"
        >
          + Add another risk
        </button>
      )}

      {/* General notes — full width below the grid. */}
      <label className="block mt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          General risk notes
        </span>
        <textarea
          value={flags.notes ?? ""}
          rows={2}
          disabled={!editable}
          placeholder="Anything else the factory should watch out for…"
          onChange={(e) =>
            setFlags((s) => ({ ...s, notes: e.target.value || null }))
          }
          className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 text-sm disabled:bg-neutral-50"
        />
      </label>

      {editable && (
        <div className="flex items-center justify-end gap-2 mt-3">
          {savedAt && !saving && (
            <span className="text-[11px] text-emerald-700">Saved</span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-solux px-3 py-1.5 text-white text-xs font-medium hover:bg-solux-dark disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save risks"}
          </button>
        </div>
      )}
    </section>
  );
}
