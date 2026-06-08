"use client";

// =====================================================================
// Assign an existing quotation (its whole version family) to this project.
// P2b-2. Writes documents.affair_id via assignDocumentToAffair. Reversible.
// =====================================================================

import { assignDocumentToAffair } from "@/app/(app)/affairs/actions";

export type AssignableDoc = {
  id: string;
  number: string | null;
  type: string;
  status: string;
};

export function AssignDocumentPanel({
  affairId,
  docs,
}: {
  affairId: string;
  docs: AssignableDoc[];
}) {
  if (docs.length === 0) {
    return (
      <p className="text-[11px] text-neutral-400">
        No other quotations are available for this client to assign.
      </p>
    );
  }
  return (
    <form action={assignDocumentToAffair} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="affair_id" value={affairId} />
      <select
        name="document_id"
        required
        defaultValue=""
        className="rounded border border-neutral-200 px-2 py-1 text-[12px]"
      >
        <option value="" disabled>
          Select a quotation…
        </option>
        {docs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.number ?? d.id.slice(0, 8)} · {d.type} · {d.status}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-solux-dark"
      >
        Assign to project
      </button>
    </form>
  );
}
