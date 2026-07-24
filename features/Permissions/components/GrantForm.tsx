"use client";

import { useState } from "react";
import {
  ACCESS_TYPES,
  LENS_INFO,
  type AccessTypeKey,
  type LensKey,
} from "@/features/Permissions/lib/access-labels";

/**
 * Add-access form — one access rule at a time. Picking an access type
 * reveals ONLY the relevant control (team picker, region picker, or
 * department picker) and shows a live plain-English explanation of what
 * the rule will grant. This prevents the earlier confusion where three
 * always-visible dropdowns made it easy to create the wrong rule.
 *
 * Submits to the `addGrant` server action (passed in). The hidden field
 * for the irrelevant control isn't rendered, so the action receives only
 * what applies to the chosen type.
 */
export function GrantForm({
  userId,
  teams,
  action,
}: {
  userId: string;
  teams: { id: string; name: string; kind: string }[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [type, setType] = useState<AccessTypeKey>("team");
  const [lens, setLens] = useState<LensKey>("production");

  const info = ACCESS_TYPES[type];
  const pickList =
    type === "region" ? teams.filter((t) => t.kind === "region") : teams.filter((t) => t.kind !== "region");

  const inputCls =
    "rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:border-solux focus:outline-none focus:ring-1 focus:ring-solux/40";

  return (
    <form action={action} className="mt-3 rounded-md border border-neutral-200 bg-neutral-50/60 p-3 space-y-2">
      <input type="hidden" name="user_id" value={userId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Give this person access to…
          </span>
          <select
            name="scope_type"
            value={type}
            onChange={(e) => setType(e.target.value as AccessTypeKey)}
            className={`${inputCls} mt-1`}
          >
            {(Object.keys(ACCESS_TYPES) as AccessTypeKey[]).map((k) => (
              <option key={k} value={k}>
                {ACCESS_TYPES[k].label}
              </option>
            ))}
          </select>
        </label>

        {(type === "team" || type === "region") && (
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {type === "region" ? "Which region" : "Which team"}
            </span>
            <select name="team_id" required defaultValue="" className={`${inputCls} mt-1`}>
              <option value="" disabled>
                {type === "region" ? "Choose a region…" : "Choose a team…"}
              </option>
              {pickList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {type === "lens" && (
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Which department
            </span>
            <select
              name="lens_key"
              value={lens}
              onChange={(e) => setLens(e.target.value as LensKey)}
              className={`${inputCls} mt-1`}
            >
              {(Object.keys(LENS_INFO) as LensKey[]).map((k) => (
                <option key={k} value={k}>
                  {LENS_INFO[k].label}
                </option>
              ))}
            </select>
          </label>
        )}

        <button className="rounded-md bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-800">
          + Add access
        </button>
      </div>

      {/* Live explanation of the rule being added. */}
      <p className="text-[11px] text-neutral-500 leading-relaxed">
        {info.help}
        {type === "lens" && (
          <>
            {" "}
            <b className="text-neutral-700">{LENS_INFO[lens].label}</b> can view:{" "}
            {LENS_INFO[lens].sees.join(", ")}.
          </>
        )}
        {(type === "team" || type === "region") && pickList.length === 0 && (
          <>
            {" "}
            <span className="text-amber-700">
              No {type === "region" ? "regions" : "teams"} yet — create one above first.
            </span>
          </>
        )}
      </p>
    </form>
  );
}
