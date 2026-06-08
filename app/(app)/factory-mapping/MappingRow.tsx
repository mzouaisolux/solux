"use client";

import { useState, useTransition } from "react";
import type { FactoryMapping } from "@/lib/types";
import { deleteFactoryMapping, upsertFactoryMapping } from "./actions";

/**
 * One editable row in the Factory Mapping admin: a single option from a
 * dropdown field, plus its factory instruction / code / notes / active flag.
 *
 * The row is collapsed by default (compact summary), expanding into a
 * fuller editor when the admin clicks Edit.
 */
export default function MappingRow({
  fieldId,
  optionId,
  optionValue,
  mapping,
}: {
  fieldId: string;
  optionId: string;
  optionValue: string;
  mapping: FactoryMapping | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const hasMapping = !!mapping;

  function handleSave(formData: FormData) {
    startTransition(async () => {
      await upsertFactoryMapping(formData);
      setSavedAt(Date.now());
      setOpen(false);
    });
  }

  function handleDelete() {
    if (!hasMapping) return;
    const fd = new FormData();
    fd.set("option_id", optionId);
    startTransition(async () => {
      await deleteFactoryMapping(fd);
    });
  }

  // ----- Collapsed summary view -----
  if (!open) {
    return (
      <div className="flex items-start gap-3 px-3 py-2.5 border-t border-neutral-100">
        <div className="w-40 shrink-0">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-900">
            {optionValue}
          </div>
          {mapping?.factory_code && (
            <div className="mt-1 text-[10px] font-mono text-neutral-500">
              {mapping.factory_code}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {hasMapping ? (
            <p
              className={`text-xs leading-relaxed ${
                mapping?.active
                  ? "text-neutral-700"
                  : "text-neutral-400 line-through"
              }`}
            >
              {mapping?.factory_instruction}
            </p>
          ) : (
            <p className="text-xs text-amber-700 italic">
              ⚠ No factory instruction configured for this option.
            </p>
          )}
          {savedAt && (
            <p className="mt-1 text-[10px] text-emerald-700">
              Saved · {new Date(savedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 text-xs text-neutral-600 hover:text-neutral-900 hover:underline"
        >
          {hasMapping ? "Edit" : "Configure"}
        </button>
      </div>
    );
  }

  // ----- Expanded editor view -----
  return (
    <form
      action={handleSave}
      className="border-t border-neutral-100 bg-neutral-50/60 px-3 py-3 space-y-2"
    >
      <input type="hidden" name="field_id" value={fieldId} />
      <input type="hidden" name="option_id" value={optionId} />
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-900">
          {optionValue}
        </span>
        <span className="text-[10px] uppercase tracking-widerx text-neutral-500">
          Sales value
        </span>
      </div>

      <label className="block">
        <span className="eyebrow mb-1 block">Factory instruction *</span>
        <textarea
          name="factory_instruction"
          required
          rows={3}
          defaultValue={mapping?.factory_instruction ?? ""}
          placeholder="Use LiFePO4 battery pack 12.8V 30Ah, 384Wh, cell type 32700, BMS reference XXX, minimum tested capacity XXX Wh."
          className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm leading-relaxed"
        />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="eyebrow mb-1 block">Factory code (optional)</span>
          <input
            name="factory_code"
            defaultValue={mapping?.factory_code ?? ""}
            placeholder="e.g. LFP-30Ah-A"
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="eyebrow mb-1 block">Notes (optional)</span>
          <input
            name="notes"
            defaultValue={mapping?.notes ?? ""}
            placeholder="Internal admin notes"
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="flex items-center justify-between">
        <label className="inline-flex items-center gap-2 text-xs text-neutral-700">
          <input
            type="checkbox"
            name="active"
            defaultChecked={mapping?.active ?? true}
            className="h-3.5 w-3.5"
          />
          Active
        </label>
        <div className="flex items-center gap-2">
          {hasMapping && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="text-xs text-red-600 hover:underline"
            >
              Delete mapping
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={pending}
            className="btn-secondary text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="btn-primary text-sm"
          >
            {pending ? "Saving…" : "Save mapping"}
          </button>
        </div>
      </div>
    </form>
  );
}
