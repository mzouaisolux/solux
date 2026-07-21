"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  DELAY_TYPES,
  DELAY_TYPE_LABEL,
  DELAY_TYPE_CONTEXT,
  type DelayType,
} from "@/lib/delays";
import { updateProductionOrderDeadline } from "@/app/(app)/production/orders/actions";

/**
 * "Add delay event" form (m073).
 *
 * Each submission is an immutable, additive event with:
 *   - days_added : signed integer (negative = recovery)
 *   - delay_type : factory or one of the external causes
 *   - reason     : free-text detail
 *
 * Operationally this is simpler than the old date-picker workflow: the
 * TLM enters the delay they actually know ("+5 days, battery shortage"),
 * not a target date they had to compute mentally. The component shows a
 * live preview of the resulting production due date before they submit.
 *
 * Mixed causes are logged as multiple events ("+5d production" then
 * "+7d payment"), keeping per-cause attribution honest for the KPI.
 */
export function DelayEventForm({
  orderId,
  productionDue,
}: {
  orderId: string;
  /** Production Due (`current_production_deadline`) as ISO YYYY-MM-DD, or null. */
  productionDue: string | null;
}) {
  const [newDate, setNewDate] = useState("");
  const [type, setType] = useState<DelayType | "">("");

  // The TLM picks the NEW production due date; the immutable event still
  // records the signed day delta (days_added) the action expects.
  const daysNum =
    productionDue && newDate
      ? Math.round(
          (Date.parse(newDate + "T00:00:00Z") -
            Date.parse(productionDue + "T00:00:00Z")) /
            86_400_000
        )
      : NaN;
  const daysValid = Number.isFinite(daysNum) && daysNum !== 0;
  const previewDue = daysValid ? newDate : null;

  return (
    <form
      action={updateProductionOrderDeadline}
      className="border-t border-neutral-100 pt-4 space-y-3"
    >
      <input type="hidden" name="id" value={orderId} />
      {/* The action contract stays days_added (signed int); we derive it from
          the picked date so the immutable audit event is identical. */}
      <input
        type="hidden"
        name="days_added"
        value={daysValid ? String(daysNum) : ""}
      />
      <div>
        <div className="text-[11px] uppercase tracking-widerx text-neutral-500 font-semibold">
          Add a delay event
        </div>
        <p className="text-[11px] text-neutral-500 mt-0.5 max-w-xl">
          Independent, additive events — log each cause separately so
          attribution stays honest. Pick an <b>earlier date</b> to record a
          recovery (the factory caught up). Only <b>Production</b> events count
          toward the factory KPI; all others push the due date without
          affecting factory metrics.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <span className="label">New completion due date *</span>
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            required
            className="input"
          />
          <span className="text-[10px] text-neutral-500 mt-1 block">
            Earlier than current due = recovery.
          </span>
        </label>
        <label className="block">
          <span className="label">Delay type *</span>
          <select
            name="delay_type"
            value={type}
            onChange={(e) => setType(e.target.value as DelayType)}
            required
            className="input"
          >
            <option value="" disabled>
              — pick the responsibility —
            </option>
            {DELAY_TYPES.map((t) => (
              <option key={t} value={t}>
                {DELAY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          {type && (
            <span className="text-[10px] text-neutral-500 mt-1 block max-w-[28ch] leading-tight">
              {DELAY_TYPE_CONTEXT[type]}
            </span>
          )}
        </label>
        <label className="block">
          <span className="label">Reason details</span>
          <input
            name="reason"
            placeholder="e.g. vessel cancelled by carrier"
            className="input"
          />
        </label>
      </div>

      <PreviewAndSubmit
        productionDue={productionDue}
        previewDue={previewDue}
        daysNum={daysNum}
        daysValid={daysValid}
      />
    </form>
  );
}

/** Live preview row + submit. Split into its own component so the submit
 *  button can subscribe to `useFormStatus()` for the pending state. */
function PreviewAndSubmit({
  productionDue,
  previewDue,
  daysNum,
  daysValid,
}: {
  productionDue: string | null;
  previewDue: string | null;
  daysNum: number;
  daysValid: boolean;
}) {
  const { pending } = useFormStatus();
  const fmt = (iso: string) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-[11px] text-neutral-500">
      <span>
        {productionDue && previewDue && daysValid ? (
          <>
            Production Due{" "}
            <b className="text-neutral-700 tabular-nums">{fmt(productionDue)}</b>{" "}
            → after this event{" "}
            <b
              className={`tabular-nums ${
                daysNum > 0 ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {fmt(previewDue)}
            </b>{" "}
            <span className="text-neutral-400">
              ({daysNum > 0 ? `+${daysNum}d` : `${daysNum}d`})
            </span>
          </>
        ) : productionDue ? (
          <>
            Production Due:{" "}
            <b className="text-neutral-700 tabular-nums">{fmt(productionDue)}</b>
          </>
        ) : (
          <span className="italic text-neutral-400">
            No baseline yet — set the working days first.
          </span>
        )}
      </span>
      <button
        type="submit"
        disabled={pending || !daysValid}
        className="btn-secondary disabled:opacity-50"
      >
        {pending ? "Saving…" : "Add delay event"}
      </button>
    </div>
  );
}
