"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelInvoice,
  duplicateInvoice,
  markInvoiceSent,
  recordInvoicePayment,
  updateInvoice,
} from "@/app/(app)/invoicing/actions";
import { formatInvoiceAmount, type InvoiceStatus } from "@/lib/invoicing";

/**
 * Management action bar for the invoice DETAIL page — the full set the spec
 * asks for (Edit · Register Payment · Send status · Duplicate · Cancel),
 * each wired to a server action, none navigating away. PDF/preview/email
 * live in InvoicePdfActions; this is the data side.
 */

export default function InvoiceDetailActions({
  invoiceId,
  status,
  amount,
  paid,
  dueDate,
  notes,
  currency,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  amount: number;
  paid: number;
  dueDate: string | null;
  notes: string | null;
  currency: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [panel, setPanel] = useState<null | "edit" | "pay">(null);
  const remainingOnInvoice = Math.max(0, Math.round((amount - paid) * 100) / 100);

  // edit form state
  const [editAmount, setEditAmount] = useState(amount.toFixed(2));
  const [editDue, setEditDue] = useState(dueDate ?? "");
  const [editNotes, setEditNotes] = useState(notes ?? "");
  // payment form state
  const [payAmount, setPayAmount] = useState(remainingOnInvoice.toFixed(2));
  const [payMethod, setPayMethod] = useState("");

  const terminal = status === "cancelled";
  const isDraft = status === "draft";
  const btn =
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50";

  function run(fn: () => Promise<unknown>, close = true) {
    startTransition(async () => {
      try {
        await fn();
        if (close) setPanel(null);
        router.refresh();
      } catch (err: any) {
        window.alert(err?.message || "Action failed.");
      }
    });
  }

  if (terminal) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
        This invoice is cancelled. Duplicate it to start a new draft.{" "}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const { id } = await duplicateInvoice(invoiceId);
              router.push(`/invoicing/${id}`);
            }, false)
          }
          className="ml-1 font-semibold text-neutral-700 underline hover:text-neutral-900"
        >
          Duplicate
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {isDraft && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => markInvoiceSent(invoiceId))}
            className={`${btn} bg-sky-600 text-white hover:bg-sky-700`}
          >
            ✉ Mark as sent
          </button>
        )}
        {status !== "paid" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setPanel(panel === "pay" ? null : "pay")}
            className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
          >
            💰 Register Payment
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => setPanel(panel === "edit" ? null : "edit")}
          className={`${btn} border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50`}
        >
          ✏ Edit
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const { id } = await duplicateInvoice(invoiceId);
              router.push(`/invoicing/${id}`);
            }, false)
          }
          className={`${btn} border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50`}
        >
          ⧉ Duplicate
        </button>
        {paid === 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  "Cancel this invoice? Its amount returns to the remaining balance. Invoices with recorded payments cannot be cancelled — issue a credit note instead."
                )
              ) {
                run(() => cancelInvoice(invoiceId));
              }
            }}
            className={`${btn} border border-transparent text-neutral-400 hover:text-rose-700`}
          >
            🗑 Cancel
          </button>
        )}
      </div>

      {panel === "pay" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800 mb-2">
            Register a payment · {formatInvoiceAmount(remainingOnInvoice, currency)} left
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <label className="text-xs text-neutral-600">
              Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="mt-1 block w-36 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm font-mono"
              />
            </label>
            <label className="text-xs text-neutral-600">
              Method (optional)
              <input
                type="text"
                value={payMethod}
                placeholder="Wire, L/C…"
                onChange={(e) => setPayMethod(e.target.value)}
                className="mt-1 block w-40 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() =>
                  recordInvoicePayment({
                    invoice_id: invoiceId,
                    amount: Number(payAmount),
                    method: payMethod || null,
                  })
                )
              }
              className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
            >
              {pending ? "Saving…" : "Record payment"}
            </button>
          </div>
        </div>
      )}

      {panel === "edit" && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
            Edit invoice
            {!isDraft && (
              <span className="ml-2 font-normal normal-case text-amber-700">
                Amount is frozen once sent — only due date &amp; notes are editable.
              </span>
            )}
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <label className="text-xs text-neutral-600">
              Amount
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={editAmount}
                disabled={!isDraft}
                onChange={(e) => setEditAmount(e.target.value)}
                className="mt-1 block w-36 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm font-mono disabled:bg-neutral-100 disabled:text-neutral-400"
              />
            </label>
            <label className="text-xs text-neutral-600">
              Due date
              <input
                type="date"
                value={editDue}
                onChange={(e) => setEditDue(e.target.value)}
                className="mt-1 block rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-neutral-600 flex-1 min-w-[180px]">
              Notes
              <input
                type="text"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="mt-1 block w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() =>
                  updateInvoice({
                    invoice_id: invoiceId,
                    amount: isDraft ? Number(editAmount) : undefined,
                    due_date: editDue || null,
                    notes: editNotes || null,
                  })
                )
              }
              className={`${btn} bg-neutral-900 text-white hover:bg-black`}
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
