"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  SNAPSHOT_FIELDS,
  UPDATE_REASONS,
  type ShippingSnapshot,
} from "@/lib/shipping-update";
import { pushToast } from "@/components/feedback/toast-store";
import { createShippingUpdateRequest } from "@/app/(app)/operations/shipping-updates/actions";
import { InlineIcon } from "@/components/NavIcons";

type Variant = "primary" | "secondary" | "link" | "chip";
/** For the `chip` variant: freight-freshness accent (status is the only color). */
type Tone = "neutral" | "warn" | "stale";

const VARIANT_CLASS: Record<Exclude<Variant, "chip">, string> = {
  primary: "btn-primary text-xs",
  secondary: "btn-secondary text-xs",
  link: "text-[11px] font-medium text-neutral-500 hover:text-neutral-900",
};

const CHIP_BASE =
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors";
const CHIP_TONE: Record<Tone, string> = {
  neutral: "border-neutral-300 text-neutral-800 hover:bg-neutral-50",
  warn: "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100",
  stale: "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100",
};

/**
 * Reusable "Request Shipping Update" trigger + prefilled modal (m149 Lot 2).
 * The SAME component powers every surface — the document card, the quotation
 * list, the client documents section — so the action looks and behaves
 * identically wherever a commercial document appears.
 *
 * Renders nothing when the feature is unavailable (pre-m149) or the user
 * lacks `shipping.request_update`. When a request is already open it shows a
 * quiet "requested" marker instead of a second button.
 */
export function RequestShippingUpdateButton({
  documentId,
  canRequest,
  available,
  prefill,
  previousCost,
  previousDate,
  hasOpenRequest,
  variant = "secondary",
  tone = "neutral",
  label = "↻ Request Shipping Update",
}: {
  documentId: string;
  canRequest: boolean;
  available: boolean;
  prefill: ShippingSnapshot;
  previousCost: number | null;
  previousDate: string | null;
  hasOpenRequest: boolean;
  variant?: Variant;
  tone?: Tone;
  label?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!available || !canRequest) return null;
  if (hasOpenRequest) {
    return (
      <span className="text-[11px] font-medium text-amber-700" title="Operations has this in their queue">
        <InlineIcon name="time" /> Update requested
      </span>
    );
  }

  const submit = (fd: FormData) => {
    startTransition(async () => {
      try {
        await createShippingUpdateRequest(fd);
        pushToast("✓ Shipping update requested — Operations notified");
        setOpen(false);
        router.refresh();
      } catch (e: any) {
        pushToast(e?.message ?? "Request failed", "error");
      }
    });
  };

  const inputCls =
    "w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[13px] placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none";

  return (
    <>
      <button
        type="button"
        className={variant === "chip" ? `${CHIP_BASE} ${CHIP_TONE[tone]}` : VARIANT_CLASS[variant]}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 md:p-10"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
        >
          <form action={submit} className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
            <input type="hidden" name="document_id" value={documentId} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-neutral-900">
                  Request Shipping Update
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  The shipping summary below is prefilled from this document —
                  adjust anything that changed (port, quantities…), Operations
                  will quote against what you send.
                </p>
              </div>
              <button
                type="button"
                className="text-neutral-400 hover:text-neutral-700"
                onClick={() => !pending && setOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {SNAPSHOT_FIELDS.map((f) => (
                <label key={f.key} className="block text-xs">
                  <span className="mb-1 block font-medium text-neutral-600">{f.label}</span>
                  <input
                    name={`snap_${f.key}`}
                    defaultValue={prefill[f.key] ?? ""}
                    className={inputCls}
                  />
                </label>
              ))}
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-neutral-600">Priority</span>
                <select name="priority" defaultValue="normal" className={inputCls}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>

            <p className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
              Previous shipping cost:{" "}
              <b className="tabular-nums">
                {previousCost == null ? "—" : previousCost.toFixed(2)}
              </b>
              {" · "}Previous quotation date: <b>{previousDate ?? "—"}</b>
              {" — "}both are attached to the request automatically.
            </p>

            <label className="mt-3 block text-xs">
              <span className="mb-1 block font-medium text-neutral-600">
                Why are you requesting an update?{" "}
                <span className="font-normal text-neutral-400">(optional)</span>
              </span>
              <input
                name="reason"
                list="shipping-update-reasons"
                placeholder="e.g. Port changed"
                className={inputCls}
              />
              <datalist id="shipping-update-reasons">
                {UPDATE_REASONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary text-xs" disabled={pending}>
                {pending ? "Sending…" : "Send to Operations"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
