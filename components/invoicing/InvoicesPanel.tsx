import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { PaymentMode, PaymentTerms } from "@/lib/types";
import {
  buildInvoiceCreateOptions,
  buildMilestonesFromTerms,
  canInvoiceDocument,
  computePaymentProgress,
  formatInvoiceAmount,
  roundMoney,
  INVOICE_STATUS_LABELS,
  INVOICE_TYPE_LABELS,
  type InvoiceLite,
  type InvoiceStatus,
} from "@/lib/invoicing";
import {
  fetchPdfContext,
  toInvoicePdfData,
  type InvoicePdfContext,
  type ShapedFamily,
  type ShapedInvoice,
} from "@/lib/invoicing-server";
import InvoiceCreateMenu from "./InvoiceCreateMenu";
import InvoicePdfActions from "./InvoicePdfActions";
import InvoiceRowActions from "./InvoiceRowActions";

/**
 * Invoices section of the quotation page (redesign #2/#6). Dead simple:
 *   Invoices                                    [+ Create ▾]
 *   ─────────────────────────────────────────────────────────
 *   Deposit Invoice · 2026-00007 · Draft   1,500   [Preview][PDF][Send]…
 *   Balance Invoice · Not created                  [Create]
 *   ─────────────────────────────────────────────────────────
 *   Invoiced 1,500 · Paid 0 · Remaining 3,500
 *
 * Invoices are tied to THIS commercial document (the quotation) — a proforma
 * is never a prerequisite. Shown once the deal is invoiceable (won quotation
 * or proforma command) or as soon as a family exists.
 */

type DocForInvoices = {
  id: string;
  number: string | null;
  type: string;
  status: string;
  total_price: number;
  currency: string | null;
  payment_mode: PaymentMode | null;
  payment_terms: PaymentTerms | null;
};

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: "bg-neutral-100 text-neutral-600",
  sent: "bg-sky-100 text-sky-800",
  partially_paid: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  overdue: "bg-rose-100 text-rose-800",
  cancelled: "bg-neutral-100 text-neutral-400 line-through",
};

export default async function InvoicesPanel({
  doc,
  canInvoice,
  family,
}: {
  doc: DocForInvoices;
  canInvoice: boolean;
  /** Preloaded by the page (single fetch) — null = no family yet. */
  family: ShapedFamily | null;
}) {
  // Invoicing is decoupled from "Won" AND from "Send" (owner 2026-07-03): a
  // deposit invoice can be issued as soon as the customer agrees — even on a
  // draft. Single source of truth = canInvoiceDocument (draft/sent/negotiating/
  // won; never lost/cancelled or the internal proforma).
  const eligible = canInvoiceDocument(doc.type, doc.status);

  const supabase = createClient();
  if (!family && !eligible) return null;

  const total = family ? family.total_amount : roundMoney(Number(doc.total_price) || 0);
  const currency = family?.currency ?? doc.currency;
  const invoices = family?.invoices ?? [];
  const lites: InvoiceLite[] = invoices.map((i) => ({
    id: i.id,
    invoice_type: i.invoice_type,
    amount: i.amount,
    status: i.status,
  }));
  const payLites = invoices.map((i) => ({ invoice_id: i.id, amount: i.paid }));
  const progress = computePaymentProgress(total, lites, payLites);

  const depositPercent =
    typeof doc.payment_terms?.deposit_percent === "number" &&
    doc.payment_terms.deposit_percent > 0 &&
    doc.payment_terms.deposit_percent < 100
      ? doc.payment_terms.deposit_percent
      : null;
  const options = buildInvoiceCreateOptions(total, lites, depositPercent);

  // Expected milestones from the payment terms (deposit+balance, or full).
  const milestoneKeys = buildMilestonesFromTerms(
    doc.payment_mode,
    doc.payment_terms,
    total
  ).map((m) => m.key);
  const activeByType = new Set(
    invoices.filter((i) => i.status !== "cancelled").map((i) => i.invoice_type)
  );
  const missingMilestones = eligible && canInvoice
    ? milestoneKeys.filter((k) => !activeByType.has(k as any))
    : [];

  const fmt = (n: number) => formatInvoiceAmount(n, currency);

  // Client + bank for the per-invoice PDF actions (only when needed).
  let pdfCtx: InvoicePdfContext = { client: null, bank: null };
  if (invoices.length > 0 && family?.client_id) {
    pdfCtx = await fetchPdfContext(supabase, family.client_id);
  }
  const clientEmail = pdfCtx.client?.email ?? null;

  function InvoiceCard({ inv }: { inv: ShapedInvoice }) {
    const left = Math.max(0, roundMoney(inv.amount - inv.paid));
    const pdfData = toInvoicePdfData(family!, inv, pdfCtx);
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200/80 bg-white px-4 py-3 flex-wrap">
        <Link
          href={`/invoicing/${inv.id}`}
          className="group min-w-0 flex-1 rounded-md -mx-1 px-1 hover:bg-neutral-50"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-neutral-900 group-hover:text-solux">
              {inv.label ?? INVOICE_TYPE_LABELS[inv.invoice_type]}
            </span>
            <span className="font-mono text-[11px] text-neutral-500 group-hover:underline">
              {inv.accounting_number}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[inv.status]}`}
            >
              {INVOICE_STATUS_LABELS[inv.status]}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-500">
            {inv.issue_date
              ? new Date(inv.issue_date).toLocaleDateString("en-GB")
              : inv.created_at
                ? new Date(inv.created_at).toLocaleDateString("en-GB")
                : ""}
            {inv.paid > 0 && inv.status !== "paid" && (
              <span className="ml-2 text-emerald-700">
                {fmt(inv.paid)} paid · {fmt(left)} left
              </span>
            )}
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <span
            className={`font-mono text-sm font-semibold ${
              inv.status === "cancelled"
                ? "text-neutral-400 line-through"
                : inv.invoice_type === "credit_note"
                  ? "text-rose-700"
                  : "text-neutral-900"
            }`}
          >
            {inv.invoice_type === "credit_note" ? "−" : ""}
            {fmt(inv.amount)}
          </span>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Link
              href={`/invoicing/${inv.id}`}
              className="rounded-md px-2 py-1 text-[11px] font-medium border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
            >
              Open
            </Link>
            <InvoicePdfActions
              data={pdfData}
              clientName={family!.client_name}
              clientEmail={clientEmail}
              storageKey={`invoices/${inv.id}.pdf`}
              invoiceId={inv.id}
              status={inv.status}
              variant="compact"
            />
            {canInvoice && (
              <InvoiceRowActions
                invoiceId={inv.id}
                status={inv.status}
                remainingOnInvoice={left}
                currency={currency}
                canCancel={inv.paid === 0}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <section id="invoices" className="panel p-5 scroll-mt-24">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">Invoices</div>
          {family && (
            <div className="text-[11px] text-neutral-500">
              Commercial invoice{" "}
              <span className="font-mono">{family.commercial_number}</span> · Total{" "}
              <span className="font-mono">{fmt(total)}</span>
            </div>
          )}
        </div>
        {canInvoice && eligible && (
          <InvoiceCreateMenu
            documentId={doc.id}
            currency={currency}
            options={options}
            variant="light"
          />
        )}
      </div>

      <div className="mt-4 space-y-2">
        {invoices.length === 0 && missingMilestones.length === 0 && (
          <p className="text-sm text-neutral-400">
            {eligible ? (
              <>
                No invoices yet. Use <b>+ Create invoice</b> to generate a deposit,
                balance, full or custom invoice — the amount is computed for you.
              </>
            ) : (
              <>This document can no longer be invoiced.</>
            )}
          </p>
        )}

        {invoices.map((inv) => (
          <InvoiceCard key={inv.id} inv={inv} />
        ))}

        {/* Expected milestones not yet created — one-click to create. */}
        {missingMilestones.map((key) => {
          const opt = options.find((o) => o.key === key);
          const label = INVOICE_TYPE_LABELS[key as keyof typeof INVOICE_TYPE_LABELS];
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-neutral-200 bg-neutral-50/50 px-4 py-3 flex-wrap"
            >
              <div>
                <span className="text-sm font-medium text-neutral-700">{label}</span>
                <span className="ml-2 text-[11px] uppercase tracking-wide text-neutral-400">
                  Not created
                </span>
                {opt?.amount != null && (
                  <span className="ml-2 font-mono text-[11px] text-neutral-500">
                    ≈ {fmt(opt.amount)}
                  </span>
                )}
              </div>
              {opt?.enabled ? (
                <InvoiceCreateMenu
                  documentId={doc.id}
                  currency={currency}
                  options={options}
                  variant="light"
                  only={key}
                  label="Create"
                />
              ) : (
                <span className="text-[11px] text-neutral-400">{opt?.reason}</span>
              )}
            </div>
          );
        })}
      </div>

      {invoices.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-neutral-200 pt-3 text-sm">
          <span>
            <span className="text-neutral-500">Invoiced </span>
            <b className="font-mono">{fmt(progress.invoicedTotal)}</b>
          </span>
          <span>
            <span className="text-neutral-500">Paid </span>
            <b className="font-mono text-emerald-700">{fmt(progress.paidTotal)}</b>
          </span>
          <span>
            <span className="text-neutral-500">Remaining to invoice </span>
            <b className="font-mono">{fmt(progress.remainingToInvoice)}</b>
          </span>
          <span className="ml-auto text-xs font-semibold text-neutral-500">
            {progress.paidPercent}% paid
          </span>
        </div>
      )}
    </section>
  );
}
