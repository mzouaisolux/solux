"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateStickerRequirements } from "@/app/(app)/task-lists/[id]/actions";
import { InlineLogoUpload } from "@/components/attachments/InlineLogoUpload";
import {
  normalizeStickerRequirements,
  STICKER_METHODS,
  BRANDING_SOURCES,
  type StickerRequirements,
  type StickerRequirement,
} from "@/lib/stickers";

/**
 * StickerRequirementsEditor — the production sticker/label spec.
 *
 * A compact checklist: per sticker type, mark required + capture method
 * (sticker vs laser) + positioning + instructions. Branding leads, with
 * a Solux/customer choice and an inline logo upload (reuses affair
 * attachments). Custom rows + general notes supported. Saves the whole
 * spec as one JSON blob.
 */
export function StickerRequirementsEditor({
  taskListId,
  documentId,
  initial,
  editable,
}: {
  taskListId: string;
  /** Quotation id of the affair — lets the branding row upload a logo
   *  straight into the shared attachments. */
  documentId?: string | null;
  initial: unknown;
  editable: boolean;
}) {
  const router = useRouter();
  const [spec, setSpec] = useState<StickerRequirements>(() =>
    normalizeStickerRequirements(initial)
  );
  const [saving, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setItem = (idx: number, patch: Partial<StickerRequirement>) =>
    setSpec((s) => ({
      ...s,
      items: s.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    }));

  const addCustom = () =>
    setSpec((s) => ({
      ...s,
      items: [
        ...s.items,
        {
          kind: "other",
          label: "",
          required: true,
          method: null,
          positioning: null,
          note: null,
          custom: true,
        },
      ],
    }));

  const removeItem = (idx: number) =>
    setSpec((s) => ({ ...s, items: s.items.filter((_, i) => i !== idx) }));

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set("id", taskListId);
    fd.set("sticker_requirements", JSON.stringify(spec));
    startTransition(async () => {
      try {
        await updateStickerRequirements(fd);
        setSavedAt(Date.now());
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to save sticker requirements");
      }
    });
  };

  const requiredCount = spec.items.filter((i) => i.required).length;

  return (
    <section className="panel p-4">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="eyebrow">Stickers and branding requirements</div>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-2xl">
            Which stickers/labels this project needs, by which method
            (sticker vs laser), where they go, and any instructions.
            Upload artwork (logo / packaging PDF) in the Attachments
            section above.
          </p>
        </div>
        <span className="text-[11px] text-neutral-400 tabular-nums shrink-0">
          {requiredCount} required
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
        {spec.items.map((it, idx) => (
          <li key={idx} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={it.required}
                  disabled={!editable}
                  onChange={(e) => setItem(idx, { required: e.target.checked })}
                  className="h-4 w-4 rounded border-neutral-300 shrink-0"
                />
                {it.custom ? (
                  <input
                    value={it.label}
                    disabled={!editable}
                    placeholder="Sticker name"
                    onChange={(e) => setItem(idx, { label: e.target.value })}
                    className="flex-1 min-w-0 rounded border border-neutral-200 px-2 py-1 text-sm disabled:bg-neutral-50"
                  />
                ) : (
                  <span
                    className={`text-sm ${
                      it.required ? "font-medium text-neutral-900" : "text-neutral-600"
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
                  className="text-neutral-400 hover:text-rose-600 text-xs px-1 shrink-0"
                  aria-label="Remove sticker"
                >
                  ✕
                </button>
              )}
            </div>
            {it.required && (
              <div className="mt-2 space-y-2 pl-6">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Branding source — only for the branding row. */}
                  {it.kind === "branding" && (
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600">
                      <span className="text-neutral-400">Branding</span>
                      <select
                        value={it.branding_source ?? ""}
                        disabled={!editable}
                        onChange={(e) =>
                          setItem(idx, {
                            branding_source: (e.target.value || null) as any,
                          })
                        }
                        className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] disabled:bg-neutral-50"
                      >
                        <option value="">— choose —</option>
                        {BRANDING_SOURCES.map((b) => (
                          <option key={b.value} value={b.value}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {/* Method — sticker vs laser printing. */}
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-neutral-600">
                    <span className="text-neutral-400">Method</span>
                    <select
                      value={it.method ?? ""}
                      disabled={!editable}
                      onChange={(e) =>
                        setItem(idx, { method: (e.target.value || null) as any })
                      }
                      className="rounded border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] disabled:bg-neutral-50"
                    >
                      <option value="">— choose —</option>
                      {STICKER_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* Logo upload — for branding (+ custom branding rows).
                      Reuses the affair attachments store. */}
                  {editable && documentId && it.kind === "branding" && (
                    <InlineLogoUpload documentId={documentId} />
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={it.positioning ?? ""}
                    disabled={!editable}
                    placeholder="Positioning (e.g. rear panel, bottom-left)"
                    onChange={(e) =>
                      setItem(idx, { positioning: e.target.value || null })
                    }
                    className="rounded border border-neutral-200 px-2 py-1 text-xs disabled:bg-neutral-50"
                  />
                  <input
                    value={it.note ?? ""}
                    disabled={!editable}
                    placeholder="Instructions (e.g. use client logo rev 2)"
                    onChange={(e) =>
                      setItem(idx, { note: e.target.value || null })
                    }
                    className="rounded border border-neutral-200 px-2 py-1 text-xs disabled:bg-neutral-50"
                  />
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {editable && (
        <button
          type="button"
          onClick={addCustom}
          className="mt-2 text-[11px] text-neutral-600 hover:text-neutral-900 underline underline-offset-2"
        >
          + Add another sticker
        </button>
      )}

      <label className="block mt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          General sticker notes
        </span>
        <textarea
          value={spec.notes ?? ""}
          rows={2}
          disabled={!editable}
          placeholder="Anything else the factory needs to know about labelling…"
          onChange={(e) => setSpec((s) => ({ ...s, notes: e.target.value || null }))}
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
            className="rounded bg-solux px-4 py-2 text-white text-sm font-medium hover:bg-solux-dark disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save sticker requirements"}
          </button>
        </div>
      )}
    </section>
  );
}
