"use client";

import { useEffect, useRef, useState } from "react";
import {
  PRODUCTION_ORDER_STATUSES,
  PRODUCTION_ORDER_STATUS_LABEL,
  type ProductionOrderStatus,
} from "@/lib/types";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * StatusSelect — single status control for the Production Order page.
 *
 * Replaces the old row of 9 one-click <form> buttons (which mutated the order
 * on a single misclick — a real data-integrity risk on the most-used, most-
 * updated page). Instead:
 *
 *   • ONE chip shows the current status,
 *   • opening it lists the *logical next* states first, other statuses below,
 *   • picking one opens a CONFIRM step before anything is written,
 *   • terminal moves (cancel / delivered) get stronger, danger-styled copy.
 *
 * The server action (updateProductionOrderStatus) is unchanged — it is passed
 * in as a prop and still enforces the capability + audit trail server-side.
 * The menu renders IN FLOW (not absolutely positioned) so the section's
 * `overflow-hidden` can't clip it.
 */

const NEXT_STATES: Record<ProductionOrderStatus, ProductionOrderStatus[]> = {
  awaiting_deposit: ["in_production", "deposit_received"],
  deposit_received: ["in_production", "production_scheduled"],
  production_scheduled: ["in_production"],
  in_production: ["production_completed", "production_delayed"],
  production_delayed: ["in_production", "production_completed"],
  production_completed: ["shipment_booked"],
  shipment_booked: ["shipped"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

function confirmCopy(
  current: ProductionOrderStatus,
  target: ProductionOrderStatus
): { danger: boolean; title: string; body: string; confirmLabel: string } {
  const label = PRODUCTION_ORDER_STATUS_LABEL[target];
  if (target === "cancelled") {
    return {
      danger: true,
      title: "Cancel this production order?",
      body: "Production stops here. This is logged as a critical event and notifies the team.",
      confirmLabel: "Yes, cancel order",
    };
  }
  if (target === "delivered") {
    return {
      danger: false,
      title: "Mark as delivered?",
      body: "This closes the order's workflow and stamps the completion date if it isn't set yet.",
      confirmLabel: "Confirm delivery",
    };
  }
  const ci = PRODUCTION_ORDER_STATUSES.indexOf(current);
  const ti = PRODUCTION_ORDER_STATUSES.indexOf(target);
  if (ti < ci) {
    return {
      danger: false,
      title: `Move back to “${label}”?`,
      body: "This sends the order backward in the workflow — only do this to correct a mistake.",
      confirmLabel: "Move back",
    };
  }
  return {
    danger: false,
    title: `Change status to “${label}”?`,
    body: "The order moves to this stage and the change is recorded in the activity timeline.",
    confirmLabel: "Confirm",
  };
}

export function StatusSelect({
  orderId,
  current,
  action,
}: {
  orderId: string;
  current: ProductionOrderStatus;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ProductionOrderStatus | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Once the status actually changes (server action landed + revalidated),
  // close the menu and clear the pending choice.
  useEffect(() => {
    setOpen(false);
    setTarget(null);
  }, [current]);

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setTarget(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setTarget(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const suggested = NEXT_STATES[current] ?? [];
  const others = PRODUCTION_ORDER_STATUSES.filter(
    (s) => s !== current && !suggested.includes(s)
  );

  return (
    <div ref={ref} className="w-fit">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setTarget(null);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[13px] font-medium text-neutral-900 transition-colors hover:border-neutral-900"
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            current === "cancelled" ? "bg-neutral-400" : "bg-emerald-500"
          }`}
        />
        {PRODUCTION_ORDER_STATUS_LABEL[current]}
        <svg
          className={`h-3.5 w-3.5 text-neutral-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="mt-2 w-[300px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
          {target ? (
            <ConfirmPanel
              current={current}
              target={target}
              orderId={orderId}
              action={action}
              onCancel={() => setTarget(null)}
            />
          ) : (
            <div className="max-h-[340px] overflow-auto p-1.5">
              {suggested.length > 0 && (
                <>
                  <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    Suggested next
                  </div>
                  {suggested.map((s) => (
                    <StatusRow
                      key={s}
                      label={PRODUCTION_ORDER_STATUS_LABEL[s]}
                      suggested
                      onClick={() => setTarget(s)}
                    />
                  ))}
                </>
              )}
              <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                {suggested.length > 0 ? "Other statuses" : "Move to"}
              </div>
              {others.map((s) => (
                <StatusRow
                  key={s}
                  label={PRODUCTION_ORDER_STATUS_LABEL[s]}
                  danger={s === "cancelled"}
                  onClick={() => setTarget(s)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  onClick,
  suggested = false,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  suggested?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-neutral-50 ${
        danger ? "text-rose-700" : "text-neutral-800"
      }`}
    >
      <span className="flex items-center gap-2">
        {suggested && (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        )}
        {label}
      </span>
      <span className="text-neutral-300" aria-hidden>
        →
      </span>
    </button>
  );
}

function ConfirmPanel({
  current,
  target,
  orderId,
  action,
  onCancel,
}: {
  current: ProductionOrderStatus;
  target: ProductionOrderStatus;
  orderId: string;
  action: (formData: FormData) => void | Promise<void>;
  onCancel: () => void;
}) {
  const copy = confirmCopy(current, target);
  return (
    <div className="p-3">
      <div
        className={`text-[13px] font-semibold ${
          copy.danger ? "text-rose-800" : "text-neutral-900"
        }`}
      >
        {copy.title}
      </div>
      <p className="mt-1 text-[12px] leading-snug text-neutral-500">{copy.body}</p>
      <form action={action} className="mt-3 flex items-center justify-end gap-2">
        <input type="hidden" name="id" value={orderId} />
        <input type="hidden" name="status" value={target} />
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 transition-colors hover:border-neutral-400"
        >
          Cancel
        </button>
        <SubmitButton
          variant={copy.danger ? "danger" : "primary"}
          size="sm"
          pendingLabel="Applying…"
        >
          {copy.confirmLabel}
        </SubmitButton>
      </form>
    </div>
  );
}
