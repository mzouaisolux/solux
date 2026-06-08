"use client";

import { useState } from "react";
import { addAssignment } from "./actions";

type Seller = { id: string; name: string };

/**
 * Assign a price list to a team / group / seller. For "seller" we pick a
 * real user (so the quote builder can resolve live prices by user id);
 * team / group are free-text labels for now.
 */
export default function AssignmentForm({
  priceListId,
  sellers,
}: {
  priceListId: string;
  sellers: Seller[];
}) {
  const [type, setType] = useState<"seller" | "team" | "group">("seller");

  return (
    <form action={addAssignment} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="priceListId" value={priceListId} />
      <label className="block">
        <span className="text-[11px] text-neutral-500">Assign to</span>
        <select
          name="assigneeType"
          value={type}
          onChange={(e) => setType(e.target.value as any)}
          className="mt-0.5 block rounded border px-2 py-1 text-sm"
        >
          <option value="seller">Seller</option>
          <option value="team">Team</option>
          <option value="group">Group</option>
        </select>
      </label>

      {type === "seller" ? (
        <label className="block">
          <span className="text-[11px] text-neutral-500">Seller</span>
          <select
            name="assigneeId"
            required
            defaultValue=""
            className="mt-0.5 block rounded border px-2 py-1 text-sm min-w-[12rem]"
            onChange={(e) => {
              const name = e.target.selectedOptions[0]?.dataset.name ?? "";
              const hidden = e.target.form?.elements.namedItem("assigneeName") as HTMLInputElement | null;
              if (hidden) hidden.value = name;
            }}
          >
            <option value="" disabled>
              Pick a seller…
            </option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id} data-name={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          <input type="hidden" name="assigneeName" />
        </label>
      ) : (
        <label className="block">
          <span className="text-[11px] text-neutral-500">{type === "team" ? "Team" : "Group"} name</span>
          <input
            name="assigneeName"
            required
            placeholder={type === "team" ? "e.g. Africa" : "e.g. Distributors"}
            className="mt-0.5 block rounded border px-2 py-1 text-sm"
          />
        </label>
      )}

      <button className="btn-secondary text-sm">+ Assign</button>
    </form>
  );
}
