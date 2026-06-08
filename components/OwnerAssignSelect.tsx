"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Reassign the sales owner (account manager / deal owner) of a record.
 *
 * Generic: the parent passes the server action (assignClientOwner /
 * assignDocumentOwner), the record id, the current owner id, and the list
 * of assignable users (resolved server-side via list_assignable_owners,
 * management-only). Selecting a name fires the action and refreshes; an
 * empty pick unassigns (the record falls back to its creator).
 */
export type OwnerOption = { id: string; name: string; role?: string | null };

export function OwnerAssignSelect({
  action,
  id,
  currentOwnerId,
  options,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  currentOwnerId: string | null;
  options: OwnerOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currentOwnerId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function onChange(next: string) {
    setValue(next);
    setError(null);
    const fd = new FormData();
    fd.set("id", id);
    fd.set("owner_id", next || "__unassign__");
    startTransition(async () => {
      try {
        await action(fd);
        setSavedAt(Date.now());
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? "Failed to reassign owner");
        setValue(currentOwnerId ?? ""); // roll back on failure
      }
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm disabled:bg-neutral-50 focus:border-solux focus:outline-none focus:ring-1 focus:ring-solux/40"
      >
        <option value="">— Unassigned (uses creator) —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.role ? ` · ${o.role}` : ""}
          </option>
        ))}
      </select>
      {pending && <span className="text-[11px] text-neutral-400">Saving…</span>}
      {!pending && savedAt && (
        <span className="text-[11px] text-emerald-700">Saved</span>
      )}
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </div>
  );
}
