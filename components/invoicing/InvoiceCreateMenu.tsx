"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoiceFromDocument } from "@/app/(app)/invoicing/actions";
import {
  formatInvoiceAmount,
  INVOICE_TYPE_LABELS,
  type InvoiceCreateOption,
} from "@/lib/invoicing";

/**
 * "+ Create invoice" dropdown — the ONE obvious way to make an invoice from
 * a quotation (audit redesign #2/#3). Deposit / Balance / Full / Custom with
 * amounts precomputed server-side (via buildInvoiceCreateOptions); the user
 * never calculates anything. Rendered both as the header primary action
 * (variant="primary") and inside the Invoices section (variant="light").
 *
 * On create it shows a compact success confirmation with a direct "Open
 * invoice" link, then refreshes the list — no navigation guesswork.
 */

type Props = {
  documentId: string;
  currency: string | null;
  options: InvoiceCreateOption[];
  variant?: "primary" | "light";
  /** preselect + auto-open the menu on one option (used by "Create" rows) */
  only?: InvoiceCreateOption["key"];
  /** With `only` (deposit/balance/full): render a direct button that creates
   *  the invoice in one click — no dropdown. Used by the Next-step cockpit. */
  oneClick?: boolean;
  label?: string;
};

export default function InvoiceCreateMenu({
  documentId,
  currency,
  options,
  variant = "primary",
  only,
  oneClick = false,
  label,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customFor, setCustomFor] = useState<null | string>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [pending, startTransition] = useTransition();
  // A non-blocking toast — the quotation stays the workspace. After creating,
  // we DON'T navigate: the Invoices list refreshes in place and the new
  // invoice appears with its own actions; "Open" here is optional.
  const [toast, setToast] = useState<null | {
    id: string;
    accounting_number: string;
    label: string;
  }>(null);

  const shown = only ? options.filter((o) => o.key === only) : options;
  const anyEnabled = options.some((o) => o.enabled);
  const fmt = (n: number) => formatInvoiceAmount(n, currency);

  function create(key: InvoiceCreateOption["key"], amount: number | null) {
    startTransition(async () => {
      try {
        const res = await createInvoiceFromDocument({
          document_id: documentId,
          invoice_type: key,
          custom_amount: key === "custom" ? Number(amount) : undefined,
        });
        setOpen(false);
        setCustomFor(null);
        setCustomAmount("");
        setToast({
          id: res.id,
          accounting_number: res.accounting_number,
          label: INVOICE_TYPE_LABELS[key === "custom" ? "custom" : key],
        });
        // Refresh the Invoices section in place — no navigation.
        router.refresh();
        setTimeout(() => setToast(null), 6000);
      } catch (err: any) {
        window.alert(err?.message || "Could not create the invoice.");
      }
    });
  }

  const triggerCls =
    variant === "primary"
      ? "inline-flex items-center gap-1.5 rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-solux-dark disabled:opacity-50"
      : "inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";

  // Shared success toast — reused by both the dropdown and the one-click button.
  const toastEl = toast ? (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-white px-4 py-3 shadow-xl">
      <span className="text-sm text-neutral-800">
        ✓ <b>{toast.label}</b>{" "}
        <span className="font-mono text-neutral-500">{toast.accounting_number}</span>{" "}
        created — added below
      </span>
      <button
        type="button"
        onClick={() => router.push(`/invoicing/${toast.id}`)}
        className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
      >
        Open →
      </button>
      <button
        type="button"
        onClick={() => setToast(null)}
        aria-label="Dismiss"
        className="text-neutral-400 hover:text-neutral-700"
      >
        ✕
      </button>
    </div>
  ) : null;

  // One-click mode (Next-step cockpit): a direct button that creates the
  // deposit/balance/full invoice immediately — no dropdown. When the target
  // option is disabled (e.g. "Create a deposit first"), the button is disabled
  // and its reason surfaces on hover.
  const target = only ? options.find((o) => o.key === only) ?? null : null;
  if (oneClick && target && target.key !== "custom") {
    return (
      <>
        <button
          type="button"
          disabled={!target.enabled || pending}
          onClick={() => create(target.key, target.amount)}
          className={triggerCls}
          title={target.reason}
        >
          {pending ? "Creating…" : label ?? target.label}
          {target.amount != null && target.enabled && (
            <span className="font-mono opacity-90">{fmt(target.amount)}</span>
          )}
        </button>
        {toastEl}
      </>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        disabled={!anyEnabled}
        onClick={() => setOpen((v) => !v)}
        className={triggerCls}
        title={anyEnabled ? "Create an invoice" : "The full amount has been invoiced"}
      >
        {label ?? "+ Create invoice"} <span className="text-[10px] opacity-70">▼</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-1.5 shadow-xl">
            {shown.map((o) => (
              <div key={o.key}>
                <button
                  type="button"
                  disabled={!o.enabled || pending}
                  onClick={() => {
                    if (o.key === "custom") setCustomFor(o.key);
                    else create(o.key, o.amount);
                  }}
                  className={`flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                    o.enabled
                      ? "hover:bg-neutral-50"
                      : "cursor-not-allowed opacity-50"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-neutral-900">
                      {o.label}
                    </span>
                    <span className="block text-[11px] text-neutral-500">{o.reason}</span>
                  </span>
                  {o.amount != null && o.enabled && (
                    <span className="shrink-0 font-mono text-sm text-neutral-800">
                      {fmt(o.amount)}
                    </span>
                  )}
                </button>
                {customFor === o.key && (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      autoFocus
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      placeholder="Amount"
                      className="w-32 rounded-md border border-neutral-300 px-2 py-1 text-sm font-mono"
                    />
                    <button
                      type="button"
                      disabled={pending || !(Number(customAmount) > 0)}
                      onClick={() => create("custom", Number(customAmount))}
                      className="rounded-md bg-solux px-2.5 py-1 text-xs font-semibold text-white hover:bg-solux-dark disabled:opacity-50"
                    >
                      {pending ? "…" : "Create"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Non-blocking confirmation — you stay on the document; the new
          invoice is already in the list below. "Open" is optional. */}
      {toastEl}
    </div>
  );
}
