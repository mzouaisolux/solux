import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { PaymentMode, PaymentTerms } from "@/lib/types";
import {
  buildMilestonesFromTerms,
  canInvoiceDocument,
  computeDepositAmount,
  computePaymentProgress,
  formatInvoiceAmount,
  roundMoney,
  INVOICE_STATUS_LABELS,
  INVOICE_TYPE_LABELS,
  type InvoiceLite,
  type InvoiceStatus,
} from "@/lib/invoicing";
import {
  fetchFamilyForDocument,
  fetchPdfContext,
  toInvoicePdfData,
  type InvoicePdfContext,
  type ShapedFamily,
  type ShapedInvoice,
} from "@/lib/invoicing-server";
import CreateInvoiceButton from "./CreateInvoiceButton";
import InvoiceRowActions from "./InvoiceRowActions";
import InvoicePdfActions from "./InvoicePdfActions";

/**
 * Payment Schedule card (m141) — THE single place where Sales, Finance and
 * Management read a deal's invoicing & payment state, and now a real
 * NAVIGATION hub: every invoice row links to its detail page and carries
 * quick actions (View · PDF · Send · Register Payment · Cancel). Two shapes:
 *   variant="full"    — near the top: milestones, Create Invoice, progress bar
 *   variant="summary" — below Grand Total: condensed rows + remaining, no
 *                       create button (avoids two primary actions on a page)
 */

type DocForInvoicing = {
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

export default async function PaymentScheduleSection({
  doc,
  canInvoice,
  variant = "full",
}: {
  doc: DocForInvoicing;
  canInvoice: boolean;
  variant?: "full" | "summary";
}) {
  // Invoicing decoupled from "Won" (owner 2026-07-03) — available from "sent"
  // onward via canInvoiceDocument; the proforma command stays eligible too.
  const eligible =
    canInvoiceDocument(doc.type, doc.status) || doc.type === "proforma";

  const supabase = createClient();
  let family: ShapedFamily | null = null;
  let tablesMissing = false;
  try {
    family = await fetchFamilyForDocument(supabase, doc.id);
  } catch {
    tablesMissing = true;
  }

  // Not-yet-migrated env: hint once (full variant only), never crash.
  if (tablesMissing) {
    if (variant === "summary" || !eligible || !canInvoice) return null;
    return (
      <section className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Invoicing is not enabled yet — apply migration m141
        (141_invoice_families.sql) to activate Deposit &amp; Balance invoices.
      </section>
    );
  }

  if (!family && !eligible) return null;
  // Summary variant is a mirror — nothing to mirror until invoices exist.
  if (variant === "summary" && (!family || family.invoices.length === 0)) return null;

  const total = family
    ? family.total_amount
    : roundMoney(Number(doc.total_price) || 0);
  const currency = family?.currency ?? doc.currency;
  const invoices = family?.invoices ?? [];
  const invoiceLites: InvoiceLite[] = invoices.map((i) => ({
    id: i.id,
    invoice_type: i.invoice_type,
    amount: i.amount,
    status: i.status,
  }));
  const payLites = invoices.map((i) => ({ invoice_id: i.id, amount: i.paid }));
  const progress = computePaymentProgress(total, invoiceLites, payLites);
  const milestones = buildMilestonesFromTerms(doc.payment_mode, doc.payment_terms, total);

  const depositPercent =
    typeof doc.payment_terms?.deposit_percent === "number" &&
    doc.payment_terms.deposit_percent > 0 &&
    doc.payment_terms.deposit_percent < 100
      ? doc.payment_terms.deposit_percent
      : null;
  const hasActiveInvoices = invoices.some((i) => i.status !== "cancelled");
  const fmt = (n: number) => formatInvoiceAmount(n, currency);

  // Client extras + default bank — only needed when we render PDF buttons.
  let pdfCtx: InvoicePdfContext = { client: null, bank: null };
  if (invoices.length > 0 && family?.client_id) {
    pdfCtx = await fetchPdfContext(supabase, family.client_id);
  }
  const clientEmail = pdfCtx.client?.email ?? null;

  function InvoiceRow({ inv }: { inv: ShapedInvoice }) {
    const left = Math.max(0, roundMoney(inv.amount - inv.paid));
    const pdfData = toInvoicePdfData(family!, inv, pdfCtx);
    return (
      <div className="flex items-center justify-between gap-3 py-2.5 flex-wrap">
        {/* Clickable text block → the invoice detail page. */}
        <Link
          href={`/invoicing/${inv.id}`}
          className="group min-w-0 flex-1 rounded-md -mx-1 px-1 hover:bg-neutral-50"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-neutral-900 group-hover:text-solux">
              {inv.label ?? INVOICE_TYPE_LABELS[inv.invoice_type]}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[inv.status]}`}
            >
              {INVOICE_STATUS_LABELS[inv.status]}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-500 flex flex-wrap gap-x-3">
            <span>
              Accounting no.{" "}
              <b className="font-mono text-neutral-700 group-hover:underline">
                {inv.accounting_number}
              </b>
            </span>
            <span>{INVOICE_TYPE_LABELS[inv.invoice_type]}</span>
            {inv.due_date && (
              <span>Due {new Date(inv.due_date).toLocaleDateString("en-GB")}</span>
            )}
            {inv.paid > 0 && inv.status !== "paid" && (
              <span className="text-emerald-700">
                Paid {fmt(inv.paid)} · {fmt(left)} left
              </span>
            )}
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <span
            className={`font-mono text-sm ${
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
              title="Open the invoice"
            >
              👁 View
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
            {canInvoice && variant === "full" && (
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

  // ---------------- SUMMARY variant (below Grand Total) ----------------
  if (variant === "summary") {
    return (
      <section className="rounded-xl border border-neutral-200/80 bg-neutral-50/40 p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-semibold text-neutral-900">
            Commercial Invoice{" "}
            <span className="font-mono">{family!.commercial_number}</span>
          </span>
          <span className="text-xs text-neutral-500">
            Quotation Total <b className="font-mono">{fmt(total)}</b>
          </span>
        </div>
        <div className="mt-3 divide-y divide-neutral-100">
          {invoices.map((inv) => (
            <InvoiceRow key={inv.id} inv={inv} />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-neutral-200 pt-3 text-sm">
          <span className="text-neutral-500">Remaining to invoice</span>
          <span className="font-mono font-semibold">{fmt(progress.remainingToInvoice)}</span>
        </div>
      </section>
    );
  }

  // ---------------- FULL variant (near the top) ----------------
  return (
    <section className="rounded-xl border border-neutral-200/80 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow mb-1">Payment Schedule</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-neutral-900">
              Commercial Invoice{" "}
              <span className="font-mono">
                {family?.commercial_number ?? "— assigned with the first invoice"}
              </span>
            </span>
            <span className="text-xs text-neutral-500">
              · Quotation Total <b className="font-mono">{fmt(total)}</b>
            </span>
          </div>
        </div>
        {canInvoice && eligible && (
          <CreateInvoiceButton
            documentId={doc.id}
            currency={currency}
            totalAmount={total}
            remaining={progress.remainingToInvoice}
            depositPercent={depositPercent}
            depositAmount={
              depositPercent !== null ? computeDepositAmount(total, depositPercent) : null
            }
            hasActiveInvoices={hasActiveInvoices}
          />
        )}
      </div>

      {invoices.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-neutral-200 bg-neutral-50/60 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
            Planned from payment terms
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {milestones.map((m) => (
              <span key={m.key} className="text-neutral-600">
                {m.label} — <b className="font-mono">{fmt(m.amount)}</b>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-neutral-500">
            No invoice yet. <b>Create Invoice</b> computes each amount
            automatically — no manual calculation.
          </p>
        </div>
      )}

      {invoices.length > 0 && (
        <div className="mt-4 divide-y divide-neutral-100">
          {invoices.map((inv) => (
            <InvoiceRow key={inv.id} inv={inv} />
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-neutral-200 pt-3">
        <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <div>
            <dt className="inline text-neutral-500">Already invoiced </dt>
            <dd className="inline font-mono font-medium">{fmt(progress.invoicedTotal)}</dd>
          </div>
          <div>
            <dt className="inline text-neutral-500">Total paid </dt>
            <dd className="inline font-mono font-medium text-emerald-700">
              {fmt(progress.paidTotal)}
            </dd>
          </div>
          <div>
            <dt className="inline text-neutral-500">Outstanding </dt>
            <dd className="inline font-mono font-medium text-amber-700">
              {fmt(progress.outstanding)}
            </dd>
          </div>
          <div>
            <dt className="inline text-neutral-500">Remaining to invoice </dt>
            <dd className="inline font-mono font-medium">{fmt(progress.remainingToInvoice)}</dd>
          </div>
        </dl>
        <div className="mt-2.5 flex items-center gap-3">
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100"
            title={`Invoiced ${progress.invoicedPercent}% · Paid ${progress.paidPercent}%`}
          >
            <div className="relative h-full">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-emerald-200"
                style={{ width: `${progress.invoicedPercent}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-emerald-600"
                style={{ width: `${progress.paidPercent}%` }}
              />
            </div>
          </div>
          <span className="text-xs font-semibold text-neutral-600 tabular-nums">
            {progress.paidPercent}% paid
          </span>
        </div>
      </div>
    </section>
  );
}
