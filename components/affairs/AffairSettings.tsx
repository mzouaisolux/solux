"use client";

// =====================================================================
// Affair (Project) inline settings — rename / lifecycle status / owner /
// cleanup (lost · abandoned · archive-with-reason). P2b-1. Writes via the
// affairs server actions; no deletes. Rendered inside the expanded affair.
// =====================================================================

import { useState } from "react";
import {
  renameAffair,
  setAffairStatus,
  setAffairOwner,
  archiveAffair,
} from "@/app/(app)/affairs/actions";
import type { Option } from "@/components/affairs/NewProjectPanel";

const LIFECYCLE: { value: string; label: string }[] = [
  { value: "lead", label: "Lead" },
  { value: "opportunity", label: "Opportunity" },
  { value: "quotation", label: "Quotation" },
  { value: "negotiation", label: "Negotiation" },
  { value: "won", label: "Won" },
  { value: "in_production", label: "In production" },
  { value: "shipped", label: "Shipped" },
  { value: "completed", label: "Completed" },
  { value: "lost", label: "Lost" },
  { value: "abandoned", label: "Abandoned" },
];

const SEL = "rounded border border-neutral-200 px-1.5 py-0.5 text-[11px]";

export function AffairSettings({
  affairId,
  name,
  status,
  ownerId,
  ownerName,
  owners,
  canAssignOwner,
}: {
  affairId: string;
  name: string;
  status: string | null;
  ownerId: string | null;
  ownerName: string | null;
  owners: Option[];
  canAssignOwner: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <div className="space-y-2 rounded-lg bg-white p-2.5 ring-1 ring-neutral-200/70">
      <span className="text-[9.5px] font-semibold uppercase tracking-widerx text-neutral-400">
        Project settings
      </span>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* lifecycle status */}
        <form action={setAffairStatus} className="flex items-center gap-1">
          <input type="hidden" name="id" value={affairId} />
          <span className="text-[10px] text-neutral-400">Status</span>
          <select
            name="status"
            defaultValue={status ?? "lead"}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={SEL}
          >
            {LIFECYCLE.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </form>

        {/* owner */}
        {canAssignOwner ? (
          <form action={setAffairOwner} className="flex items-center gap-1">
            <input type="hidden" name="id" value={affairId} />
            <span className="text-[10px] text-neutral-400">Owner</span>
            <select
              name="owner_id"
              defaultValue={ownerId ?? "__unassign__"}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className={SEL}
            >
              <option value="__unassign__">— unassigned —</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </form>
        ) : (
          ownerName && (
            <span className="text-[11px] text-neutral-500">Owner: {ownerName}</span>
          )
        )}

        {/* rename */}
        {!renaming ? (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-500 hover:text-neutral-700"
          >
            Rename
          </button>
        ) : (
          <form
            action={async (fd) => {
              await renameAffair(fd);
              setRenaming(false);
            }}
            className="flex items-center gap-1"
          >
            <input type="hidden" name="id" value={affairId} />
            <input
              name="name"
              defaultValue={name}
              autoFocus
              className="rounded border border-neutral-200 px-1.5 py-0.5 text-[11px]"
            />
            <button
              type="submit"
              className="rounded bg-solux px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-solux-dark"
            >
              Save
            </button>
          </form>
        )}
      </div>

      {/* cleanup — secondary */}
      <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-neutral-200 pt-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-widerx text-neutral-400">
          Cleanup
        </span>
        <form action={setAffairStatus}>
          <input type="hidden" name="id" value={affairId} />
          <input type="hidden" name="status" value="lost" />
          <button
            type="submit"
            className="rounded-md border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-500 hover:border-rose-200 hover:text-rose-600"
          >
            Mark as lost
          </button>
        </form>
        <form action={setAffairStatus}>
          <input type="hidden" name="id" value={affairId} />
          <input type="hidden" name="status" value="abandoned" />
          <button
            type="submit"
            className="rounded-md border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-500 hover:border-amber-200 hover:text-amber-700"
          >
            Mark as abandoned
          </button>
        </form>
        <button
          type="button"
          onClick={() => setArchiveOpen((v) => !v)}
          className="rounded-md border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-500 hover:text-neutral-700"
        >
          Archive with reason…
        </button>
      </div>

      {archiveOpen && (
        <form
          action={async (fd) => {
            await archiveAffair(fd);
            setArchiveOpen(false);
          }}
          className="rounded-lg bg-neutral-50 p-2 ring-1 ring-neutral-200"
        >
          <input type="hidden" name="id" value={affairId} />
          <label className="block text-[9.5px] font-semibold uppercase tracking-widerx text-neutral-400">
            Archive reason (required)
          </label>
          <textarea
            name="reason"
            required
            rows={2}
            placeholder="e.g. client chose another supplier"
            className="mt-1 w-full rounded border border-neutral-200 px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-neutral-200"
          />
          <button
            type="submit"
            className="mt-1 rounded-md bg-neutral-700 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-neutral-800"
          >
            Archive project
          </button>
        </form>
      )}
    </div>
  );
}
