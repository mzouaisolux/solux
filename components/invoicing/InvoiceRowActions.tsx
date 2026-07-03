"use client";

import { useState, useTransition } from "react";
import {
  cancelInvoice,
  markInvoiceSent,
  recordInvoicePayment,
} from "@/app/(app)/invoicing/actions";
import { formatInvoiceAmount, type InvoiceStatus } from "@/lib/invoicing";

/**
 * Per-invoice quick actions on the Payment Schedule card:
 *   draft            → Mark sent · Cancel
 *   sent / partial / overdue → + Payment (inline mini-form, prefilled with
 *                      what's left on THIS invoice) · Cancel (unpaid only)
 *   paid / cancelled → nothing (terminal)
 * The server action re-derives the invoice status after each payment, so
 * the card is always consistent without a manual refresh step.
 */

type Props = {
  invoiceId: string;
  status: InvoiceStatus;
  /** invoice amount − payments already recorded */
  remainingOnInvoice: number;
  currency: string | null;
  canCancel: boolean;
};

export default function InvoiceRowActions({
  invoiceId,
  status,
  remainingOnInvoice,
  currency,
  canCancel,
}: Props) {
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState(remainingOnInvoice.toFixed(2));
  const [pending, startTransition] = useTransition();

  if (status === "paid" || status === "cancelled") return null;

  const btn =
    "rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50";

  function run(fn: () => Promise<void>) {
    startTransition(async () => {
      try {
        await fn();
        setPayOpen(false);
      } catch (err: any) {
        window.alert(err?.message || "Action failed.");
      }
    });
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      {status === "draft" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => markInvoiceSent(invoiceId))}
          className={`${btn} border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50`}
        >
          Mark sent
        </button>
      )}

      {payOpen ? (
        <span className="inline-flex items-center gap-1">
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-[11px] font-mono"
            autoFocus
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                recordInvoicePayment({
                  invoice_id: invoiceId,
                  amount: Number(amount),
                })
              )
            }
            className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
          >
            {pending ? "Saving…" : "✓"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setPayOpen(false)}
            className={`${btn} border border-neutral-300 bg-white text-neutral-600`}
          >
            ✕
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => setPayOpen(true)}
          className={`${btn} border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
          title={`Record a payment (${formatInvoiceAmount(remainingOnInvoice, currency)} left on this invoice)`}
        >
          + Payment
        </button>
      )}

      {canCancel && (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (
              window.confirm(
                "Cancel this invoice? Its amount is freed back into the remaining balance. Invoices with recorded payments cannot be cancelled."
              )
            ) {
              run(() => cancelInvoice(invoiceId));
            }
          }}
          className={`${btn} text-neutral-400 hover:text-rose-700`}
        >
          Cancel
        </button>
      )}
    </div>
  );
}
