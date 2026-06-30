"use client";

// =====================================================================
// "New Project" — create an affair FIRST, before any quotation (P2b-1).
// =====================================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAffair } from "@/app/(app)/affairs/actions";
import { AFFAIR_SOURCE_OPTIONS } from "@/components/affairs/affair-sources";

export type Option = { id: string; name: string };

export function NewProjectPanel({
  clients = [],
  owners,
  lockedClient,
}: {
  clients?: Option[];
  owners: Option[];
  /** When set, the client is fixed (Client Workspace): the Client field is
   *  hidden and injected, and Source defaults to "Direct Request". */
  lockedClient?: Option;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md bg-solux px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-solux-dark"
      >
        + New project
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl bg-white p-3 shadow-pop ring-1 ring-neutral-200">
          <h3 className="text-[12px] font-semibold text-solux-ink">New project</h3>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            Create a project first — quotations are added to it later.
          </p>
          <form
            action={async (fd) => {
              const res = await createAffair(fd);
              setOpen(false);
              // #2 — land on the created affair instead of staying put.
              if (res?.id) router.push(`/affairs/${res.id}`);
            }}
            className="mt-2 space-y-2"
          >
            <label className="block">
              <span className="text-[10px] text-neutral-500">Project name</span>
              <input
                name="name"
                required
                autoFocus
                placeholder="e.g. Benin Highway Phase 2"
                className="mt-0.5 w-full rounded border border-neutral-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-200"
              />
            </label>
            {lockedClient ? (
              <input type="hidden" name="client_id" value={lockedClient.id} />
            ) : (
              <label className="block">
                <span className="text-[10px] text-neutral-500">Client</span>
                <select
                  name="client_id"
                  className="mt-0.5 w-full rounded border border-neutral-200 px-2 py-1 text-sm"
                >
                  <option value="">— none —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="text-[10px] text-neutral-500">Source — where did this deal come from?</span>
              <select
                name="source"
                defaultValue={lockedClient ? "direct_request" : ""}
                className="mt-0.5 w-full rounded border border-neutral-200 px-2 py-1 text-sm"
              >
                <option value="">— not set —</option>
                {AFFAIR_SOURCE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            {owners.length > 0 && (
              <label className="block">
                <span className="text-[10px] text-neutral-500">Owner</span>
                <select
                  name="owner_id"
                  className="mt-0.5 w-full rounded border border-neutral-200 px-2 py-1 text-sm"
                >
                  <option value="">Me (default)</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-neutral-200 px-2.5 py-1 text-[11px] text-neutral-600 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
