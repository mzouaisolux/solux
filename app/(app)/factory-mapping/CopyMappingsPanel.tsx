"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  copyFactoryMappingsFromFamily,
  type CopyMappingsResult,
} from "./actions";

/**
 * Standalone "copy factory mappings between families" control.
 *
 * Picks a SOURCE family and a TARGET family (with the same option values, e.g.
 * one created by duplicating the other) and clones the source's factory
 * mappings onto the target — matched by option value, idempotent. Useful when
 * the target family already exists (the duplicateCategory checkbox covers the
 * copy-at-creation case).
 */
export default function CopyMappingsPanel({
  categories,
}: {
  categories: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CopyMappingsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sameFamily = !!source && source === target;
  const canCopy = !!source && !!target && !sameFamily && !pending;

  function handleCopy() {
    if (!canCopy) return;
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await copyFactoryMappingsFromFamily(source, target);
        setResult(r);
        router.refresh(); // refresh coverage numbers + mapping rows
      } catch (e: any) {
        setError(e?.message ?? "Copy failed.");
      }
    });
  }

  return (
    <div className="panel p-4 space-y-3">
      <div>
        <div className="eyebrow">Copy factory mappings between families</div>
        <p className="text-xs text-neutral-500 mt-1 max-w-2xl">
          Clone every factory instruction from one family onto another whose
          dropdown options share the same values (e.g. a family you duplicated).
          Matched by option value — options with no match in the source are left
          as-is. Safe to re-run.
        </p>
      </div>

      <div className="flex flex-col md:flex-row md:items-end gap-3">
        <label className="block flex-1">
          <span className="eyebrow mb-1 block">From (source)</span>
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setResult(null);
              setError(null);
            }}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Select a family…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="hidden md:block pb-2 text-neutral-400">→</div>

        <label className="block flex-1">
          <span className="eyebrow mb-1 block">To (target)</span>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setResult(null);
              setError(null);
            }}
            className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Select a family…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handleCopy}
          disabled={!canCopy}
          className="btn-primary text-sm shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? "Copying…" : "Copy mappings"}
        </button>
      </div>

      {sameFamily && (
        <p className="text-xs text-amber-700">
          Pick two different families.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {result && (
        <p className="text-xs text-emerald-700">
          Copied {result.copied} mapping{result.copied === 1 ? "" : "s"}
          {result.skipped > 0 && (
            <>
              {" "}
              · {result.skipped} target option
              {result.skipped === 1 ? "" : "s"} had no match in the source
            </>
          )}
          {result.copied === 0 && result.skipped === 0 && (
            <> · the source family has no factory mappings to copy</>
          )}
          .
        </p>
      )}
    </div>
  );
}
