"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { enterPacking } from "../actions";
import { toast } from "@/components/feedback/toast-store";
import { SubmitButton } from "@/components/feedback/ActionForm";
import { PROJECT_CONTAINER_TYPES, type PackingContainer } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  "20GP": "20GP",
  "40GP": "40GP",
  "40HQ": "40HQ",
  LCL: "LCL / Groupage",
};

/**
 * Packing list entry — multiple container rows (type + quantity), total CBM,
 * loading notes. Rows are managed client-side and serialized into a hidden
 * `containers_json` field consumed by the enterPacking server action.
 */
export default function PackingEntryForm({
  projectId,
  defaultContainers,
  defaultCbm,
  defaultNotes,
  completed,
}: {
  projectId: string;
  defaultContainers: PackingContainer[];
  defaultCbm: number | null;
  defaultNotes: string | null;
  completed: boolean;
}) {
  const [rows, setRows] = useState<PackingContainer[]>(
    defaultContainers.length ? defaultContainers : [{ type: "40HQ", quantity: 1 }]
  );

  const setRow = (i: number, patch: Partial<PackingContainer>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, { type: "20GP", quantity: 1 }]);
  const removeRow = (i: number) => setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const cleaned = rows.filter((r) => r.type && r.quantity > 0);
  const router = useRouter();

  return (
    <form
      action={async (fd) => {
        try {
          await enterPacking(fd);
          toast.success("✓ Packing list saved");
          router.refresh();
        } catch (e: any) {
          toast.error(e?.message ?? "Could not save packing list.");
        }
      }}
      className="space-y-2 border-t border-neutral-100 pt-3"
    >
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="containers_json" value={JSON.stringify(cleaned)} />

      <span className="text-[11px] text-neutral-500">Containers</span>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={r.type}
              onChange={(e) => setRow(i, { type: e.target.value })}
              className="rounded border border-neutral-200 px-2 py-1.5 text-sm"
            >
              {PROJECT_CONTAINER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t] ?? t}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              value={r.quantity}
              onChange={(e) => setRow(i, { quantity: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              className="w-20 rounded border border-neutral-200 px-2 py-1.5 text-sm tabular-nums"
              aria-label="Quantity"
            />
            <span className="text-[11px] text-neutral-400">× units</span>
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={rows.length <= 1}
              className="ml-auto text-neutral-400 hover:text-rose-600 disabled:opacity-30"
              title="Remove row"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addRow} className="text-[12px] font-medium text-solux-dark hover:underline">
        + Add container
      </button>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <label className="block">
          <span className="text-[11px] text-neutral-500">Total CBM</span>
          <input name="total_cbm" type="number" min={0} step="0.01" defaultValue={defaultCbm ?? ""} className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="text-[11px] text-neutral-500">Loading notes</span>
          <input name="loading_notes" defaultValue={defaultNotes ?? ""} placeholder="e.g. product & poles packed separately" className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm" />
        </label>
      </div>
      <SubmitButton className="btn-secondary text-sm" pendingLabel="Saving…">
        {completed ? "Update packing" : "Save packing"}
      </SubmitButton>
    </form>
  );
}
