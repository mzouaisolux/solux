"use client";

// =====================================================================
// Affairs (Projects) workspace — shell. Branded header + "New project"
// (create-affair-first) + one ClientCard per client. P2b-1.
// =====================================================================

import type { ClientAffairs } from "@/lib/affairs-prototype";
import { ClientCard } from "@/components/affairs/ClientCard";
import { NewProjectPanel, type Option } from "@/components/affairs/NewProjectPanel";

export function AffairsExperimentalView({
  clients,
  totals,
  loadError,
  clientOptions = [],
  owners = [],
  canAssignOwner = false,
}: {
  clients: ClientAffairs[];
  totals: { clients: number; affairs: number; documents: number };
  loadError: string | null;
  clientOptions?: Option[];
  owners?: Option[];
  canAssignOwner?: boolean;
}) {
  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tightish text-solux-ink">Affairs</h1>
            <span className="rounded-md bg-solux-ink/[0.06] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widerx text-neutral-500 ring-1 ring-inset ring-neutral-200">
              Beta
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-neutral-500">
            Projects · Client → Affair → Documents ·{" "}
            <span className="font-medium text-neutral-600">{totals.affairs}</span> affairs ·{" "}
            <span className="font-medium text-neutral-600">{totals.documents}</span> docs
          </p>
        </div>
        <NewProjectPanel clients={clientOptions} owners={owners} />
      </div>

      {loadError && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700 ring-1 ring-inset ring-rose-200">
          Read error (non-fatal): {loadError}
        </p>
      )}

      {clients.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-neutral-500 shadow-card ring-1 ring-neutral-200/70">
          No projects visible yet — create one with <strong>New project</strong>.
        </p>
      ) : (
        <div className="space-y-4">
          {clients.map((c) => (
            <ClientCard
              key={c.clientId ?? "unlinked"}
              client={c}
              owners={owners}
              canAssignOwner={canAssignOwner}
            />
          ))}
        </div>
      )}
    </div>
  );
}
