"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoiceFromDocument } from "@/app/(app)/invoicing/actions";
import { formatInvoiceAmount, INVOICE_TYPE_LABELS } from "@/lib/invoicing";

/**
 * "Create Invoice" — the one commercial entry point of the deposit &
 * balance system. Opens a chooser with the four options of the spec
 * (Deposit / Balance / Full / Custom); every amount is precomputed by the
 * parent server component from lib/invoicing.ts, and the server action
 * recomputes + enforces the ceiling on submit, so the user NEVER types a
 * percentage or does mental math (Custom is the only free field, capped
 * at the remaining balance).
 */

type Props = {
  documentId: string;
  currency: string | null;
  totalAmount: number;
  remaining: number;
  /** null = the document's payment terms carry no deposit % */
  depositPercent: number | null;
  depositAmount: number | null;
  /** at least one non-cancelled invoice already exists */
  hasActiveInvoices: boolean;
};

type Choice = "deposit" | "balance" | "full" | "custom";

export default function CreateInvoiceButton({
  documentId,
  currency,
  totalAmount,
  remaining,
  depositPercent,
  depositAmount,
  hasActiveInvoices,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState<null | {
    id: string;
    accounting_number: string;
    commercial_number: string;
    amount: number;
    typeLabel: string;
  }>(null);

  const fmt = (n: number) => formatInvoiceAmount(n, currency);

  /** The amount the chosen option will produce (mirrors the server). */
  function amountFor(c: Choice, parsed: number): number {
    if (c === "deposit") return depositAmount ?? 0;
    if (c === "balance") return remaining;
    if (c === "full") return totalAmount;
    return parsed;
  }

  const depositPossible =
    depositPercent !== null &&
    depositAmount !== null &&
    depositAmount <= remaining + 0.005;

  const options: Array<{
    key: Choice;
    title: string;
    detail: string;
    enabled: boolean;
  }> = [
    {
      key: "deposit",
      title: "Deposit Invoice",
      detail:
        depositPercent === null
          ? "No deposit % in this document's payment terms"
          : depositPossible
            ? `${depositPercent}% of quotation — ${fmt(depositAmount!)}`
            : `${depositPercent}% deposit exceeds the remaining balance`,
      enabled: depositPossible,
    },
    {
      key: "balance",
      title: "Balance Invoice",
      detail:
        remaining > 0
          ? `Remaining balance — ${fmt(remaining)}`
          : "Nothing left to invoice",
      enabled: remaining > 0 && hasActiveInvoices,
    },
    {
      key: "full",
      title: "Full Invoice (100%)",
      detail: hasActiveInvoices
        ? "Unavailable — this deal already has invoices"
        : `Whole amount — ${fmt(totalAmount)}`,
      enabled: !hasActiveInvoices && remaining > 0,
    },
    {
      key: "custom",
      title: "Custom Invoice",
      detail: `Any amount up to ${fmt(remaining)}`,
      enabled: remaining > 0,
    },
  ];

  function submit() {
    if (!choice) return;
    const parsed = Number(customAmount);
    if (choice === "custom" && (!Number.isFinite(parsed) || parsed <= 0)) {
      window.alert("Enter a custom amount greater than 0.");
      return;
    }
    const chosen = choice;
    startTransition(async () => {
      try {
        const res = await createInvoiceFromDocument({
          document_id: documentId,
          invoice_type: chosen,
          custom_amount: chosen === "custom" ? parsed : undefined,
        });
        setOpen(false);
        setChoice(null);
        setCustomAmount("");
        setSuccess({
          id: res.id,
          accounting_number: res.accounting_number,
          commercial_number: res.commercial_number,
          amount: amountFor(chosen, parsed),
          typeLabel:
            chosen === "custom"
              ? INVOICE_TYPE_LABELS.custom
              : INVOICE_TYPE_LABELS[chosen],
        });
        // Refresh the schedule behind the success dialog.
        router.refresh();
      } catch (err: any) {
        window.alert(err?.message || "Could not create the invoice.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={remaining <= 0}
        className="inline-flex items-center gap-1.5 rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-solux-dark disabled:opacity-50"
        title={
          remaining <= 0
            ? "The full quotation amount has been invoiced"
            : "Create a deposit, balance, full or custom invoice"
        }
      >
        + Create Invoice
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="eyebrow mb-1">Create Invoice</div>
            <p className="text-xs text-neutral-500 mb-4">
              Remaining to invoice:{" "}
              <b className="font-mono text-neutral-800">{fmt(remaining)}</b> of{" "}
              {fmt(totalAmount)}
            </p>

            <div className="space-y-2">
              {options.map((o) => (
                <label
                  key={o.key}
                  className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                    !o.enabled
                      ? "cursor-not-allowed border-neutral-100 bg-neutral-50 opacity-60"
                      : choice === o.key
                        ? "cursor-pointer border-solux bg-solux/5"
                        : "cursor-pointer border-neutral-200 hover:bg-neutral-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="invoice_type"
                    className="mt-1"
                    disabled={!o.enabled}
                    checked={choice === o.key}
                    onChange={() => setChoice(o.key)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-neutral-900">
                      {o.title}
                    </span>
                    <span className="block text-xs text-neutral-500">
                      {o.detail}
                    </span>
                    {o.key === "custom" && choice === "custom" && (
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        max={remaining}
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        placeholder={`Amount (max ${remaining.toFixed(2)})`}
                        className="mt-2 w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm font-mono"
                        autoFocus
                      />
                    )}
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || !choice}
                className="rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white hover:bg-solux-dark disabled:opacity-50"
              >
                {pending ? "Creating…" : "Create invoice"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success — removes all uncertainty: the invoice is a real object with
          a clear next step (open it → all PDF / send / payment actions). */}
      {success && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
          onClick={() => setSuccess(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-emerald-700">
              ✅ {success.typeLabel} created successfully
            </div>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-neutral-500">Commercial Invoice</dt>
                <dd className="font-mono font-medium">{success.commercial_number}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Accounting Invoice</dt>
                <dd className="font-mono font-medium">{success.accounting_number}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Amount</dt>
                <dd className="font-mono font-semibold">{fmt(success.amount)}</dd>
              </div>
            </dl>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setSuccess(null)}
                className="rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => router.push(`/invoicing/${success.id}`)}
                className="rounded-md bg-solux px-3.5 py-2 text-sm font-semibold text-white hover:bg-solux-dark"
              >
                Open Invoice →
              </button>
            </div>
            <p className="mt-3 text-[11px] text-neutral-400">
              Preview PDF, download, send by email and register payments are all
              on the invoice page.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
