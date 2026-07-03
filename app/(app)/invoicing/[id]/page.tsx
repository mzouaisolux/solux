// =====================================================================
// Invoice detail page — /invoicing/[id]. Every legal invoice created by
// the deposit & balance system (m141) is a FIRST-CLASS document here:
// header (commercial file + accounting number + type + links back to the
// quotation), PDF actions (Preview / Download / Send), management actions
// (Edit / Register Payment / Mark sent / Duplicate / Cancel), the single
// billing line, and the full lifecycle history + payment ledger.
// =====================================================================

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { fetchInvoiceDetail, toInvoicePdfData } from "@/lib/invoicing-server";
import {
  buildInvoiceHistory,
  formatInvoiceAmount,
  INVOICE_STATUS_LABELS,
  INVOICE_TYPE_LABELS,
  type InvoiceStatus,
} from "@/lib/invoicing";
import InvoicePdfActions from "@/components/invoicing/InvoicePdfActions";
import InvoiceDetailActions from "@/components/invoicing/InvoiceDetailActions";
import type { BankAccount } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: "bg-neutral-100 text-neutral-600",
  sent: "bg-sky-100 text-sky-800",
  partially_paid: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  overdue: "bg-rose-100 text-rose-800",
  cancelled: "bg-neutral-100 text-neutral-400 line-through",
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const detail = await fetchInvoiceDetail(supabase, params.id);
  if (!detail) notFound();
  const { invoice, family, payments } = detail;

  // Client extras + a default bank account, for the PDF (best-effort).
  let clientExtras: {
    company_name: string;
    contact_name: string | null;
    email: string | null;
    country: string | null;
    address: string | null;
    vat_number: string | null;
  } | null = null;
  if (family.client_id) {
    const { data } = await supabase
      .from("clients")
      .select("company_name, contact_name, email, country, address, vat_number")
      .eq("id", family.client_id)
      .maybeSingle();
    if (data) clientExtras = data as any;
  }
  let bank: BankAccount | null = null;
  {
    const { data } = await supabase
      .from("bank_accounts")
      .select(
        "id, account_name, business_account_name, currency, bank_name, bank_address, account_number, swift, is_default"
      )
      .eq("is_default", true)
      .maybeSingle();
    if (data) bank = data as any;
  }

  const creatorName = invoice.created_by
    ? (await resolveUserLabelStrings([invoice.created_by])).get(invoice.created_by) ?? null
    : null;

  const history = buildInvoiceHistory(
    {
      amount: invoice.amount,
      created_at: invoice.created_at,
      sent_at: invoice.sent_at,
      cancelled_at: invoice.cancelled_at,
    },
    payments.map((p) => ({ amount: p.amount, paid_at: p.paid_at })),
    { createdBy: creatorName, formatAmount: (n) => formatInvoiceAmount(n, family.currency) }
  );

  const pdfData = toInvoicePdfData(family, invoice, { client: clientExtras, bank });

  const fmt = (n: number) => formatInvoiceAmount(n, family.currency);

  return (
    <div className="mx-auto max-w-[860px] px-6 py-6">
      {/* Back to the commercial invoice (the source document owns the family). */}
      {family.source_document_id ? (
        <Link
          href={`/documents/${family.source_document_id}`}
          className="text-[12px] text-neutral-500 hover:text-neutral-800"
        >
          ← Back to Commercial Invoice {family.commercial_number}
        </Link>
      ) : (
        <span className="text-[12px] text-neutral-400">
          Commercial Invoice {family.commercial_number}
        </span>
      )}

      {/* HEADER */}
      <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          {/* Big, unambiguous invoice-type title (audit #8). */}
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold uppercase tracking-tight text-neutral-900">
              {INVOICE_TYPE_LABELS[invoice.invoice_type]}
            </h1>
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLES[invoice.status]}`}
            >
              {INVOICE_STATUS_LABELS[invoice.status]}
            </span>
          </div>
          <div className="mt-1 font-mono text-sm text-neutral-500">
            {invoice.accounting_number}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-neutral-500">
            <span>
              Commercial file{" "}
              <b className="font-mono text-neutral-700">{family.commercial_number}</b>
            </span>
            {family.source_number && (
              <>
                <span className="text-neutral-300">·</span>
                <span>
                  Quotation{" "}
                  <Link
                    href={
                      family.source_document_id
                        ? `/documents/${family.source_document_id}`
                        : "#"
                    }
                    className="font-mono text-neutral-700 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
                  >
                    {family.source_number}
                  </Link>
                </span>
              </>
            )}
            {family.client_name && (
              <>
                <span className="text-neutral-300">·</span>
                <span>{family.client_name}</span>
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider text-neutral-400">Amount</div>
          <div className="text-2xl font-bold tabular-nums text-neutral-900">
            {invoice.invoice_type === "credit_note" ? "−" : ""}
            {fmt(invoice.amount)}
          </div>
          {invoice.paid > 0 && invoice.status !== "paid" && (
            <div className="text-[11px] text-emerald-700">
              {fmt(invoice.paid)} paid · {fmt(Math.max(0, invoice.amount - invoice.paid))} left
            </div>
          )}
        </div>
      </div>

      {/* Payment terms · Due date · Remaining — so the customer/user always
          knows how much is due, what remains, and when (audit #7). */}
      {(pdfData.payment_terms_label ||
        invoice.due_date ||
        typeof pdfData.remaining_after === "number") && (
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 rounded-xl border border-neutral-200/80 bg-neutral-50/60 px-4 py-3 text-sm">
          {pdfData.payment_terms_label && (
            <div>
              <span className="text-neutral-500">Payment terms </span>
              <span className="font-medium">{pdfData.payment_terms_label}</span>
            </div>
          )}
          <div>
            <span className="text-neutral-500">Due date </span>
            <span className="font-medium">
              {invoice.due_date
                ? new Date(invoice.due_date).toLocaleDateString("en-GB")
                : "On receipt"}
            </span>
          </div>
          {typeof pdfData.remaining_after === "number" && (
            <div>
              <span className="text-neutral-500">Remaining balance </span>
              <span className="font-medium font-mono">{fmt(pdfData.remaining_after)}</span>
            </div>
          )}
        </div>
      )}

      {/* PDF actions */}
      <div className="mt-4 rounded-xl border border-neutral-200/80 bg-white p-4">
        <InvoicePdfActions
          data={pdfData}
          clientName={family.client_name}
          clientEmail={clientExtras?.email ?? null}
          storageKey={`invoices/${invoice.id}.pdf`}
          invoiceId={invoice.id}
          status={invoice.status}
        />
      </div>

      {/* Management actions */}
      <div className="mt-4">
        <InvoiceDetailActions
          invoiceId={invoice.id}
          status={invoice.status}
          amount={invoice.amount}
          paid={invoice.paid}
          dueDate={invoice.due_date}
          notes={invoice.notes}
          currency={family.currency}
        />
      </div>

      {/* Items + payment summary — mirrors the PDF (same product lines on
          every invoice; only the summary differs). */}
      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-[1.6fr_1fr]">
        <section className="rounded-xl border border-neutral-200/80 bg-white p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-3">
            Items
          </div>
          {pdfData.lines.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-[10px] uppercase tracking-wide text-neutral-400">
                  <th className="py-1.5 text-left font-semibold">Description</th>
                  <th className="py-1.5 text-center font-semibold">Qty</th>
                  <th className="py-1.5 text-right font-semibold">Unit</th>
                  <th className="py-1.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {pdfData.lines.map((l, i) => (
                  <tr key={i} className="border-b border-neutral-100 align-top">
                    <td className="py-2">
                      <div className="font-medium text-neutral-900">{l.product_name}</div>
                      {l.client_reference && (
                        <div className="text-[11px] text-neutral-500">
                          Ref: {l.client_reference}
                        </div>
                      )}
                      {l.spec && <div className="text-[11px] text-neutral-500">{l.spec}</div>}
                    </td>
                    <td className="py-2 text-center tabular-nums">{l.quantity}</td>
                    <td className="py-2 text-right font-mono">{fmt(l.unit_price)}</td>
                    <td className="py-2 text-right font-mono">{fmt(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-neutral-400">No product lines on the source quotation.</p>
          )}

          {/* Payment summary — varies by type. */}
          <dl className="mt-4 space-y-1 border-t border-neutral-200 pt-3 text-sm">
            {invoice.invoice_type === "deposit" && (
              <>
                <div className="flex justify-between text-neutral-500">
                  <dt>Subtotal</dt>
                  <dd className="font-mono">{fmt(family.total_amount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Deposit{invoice.percent ? ` (${invoice.percent}%)` : ""}</dt>
                  <dd className="font-mono">{fmt(invoice.amount)}</dd>
                </div>
              </>
            )}
            {invoice.invoice_type === "balance" && (
              <>
                <div className="flex justify-between text-neutral-500">
                  <dt>Quotation total</dt>
                  <dd className="font-mono">{fmt(family.total_amount)}</dd>
                </div>
                {(pdfData.deposits ?? []).map((d, i) => (
                  <div key={i} className="flex justify-between text-neutral-500">
                    <dt>Less deposit {d.accounting_number}</dt>
                    <dd className="font-mono">−{fmt(d.amount)}</dd>
                  </div>
                ))}
              </>
            )}
            <div className="flex justify-between border-t border-neutral-900 pt-2 mt-1 text-base font-bold text-neutral-900">
              <dt>
                {invoice.invoice_type === "credit_note"
                  ? "Credit total"
                  : invoice.invoice_type === "balance"
                    ? "Balance due"
                    : invoice.invoice_type === "deposit"
                      ? "Amount due"
                      : "Total due"}
              </dt>
              <dd className="font-mono">
                {invoice.invoice_type === "credit_note" ? "−" : ""}
                {fmt(invoice.amount)}
              </dd>
            </div>
            {typeof pdfData.remaining_after === "number" && (
              <div className="flex justify-between text-[12px] text-neutral-500">
                <dt>Remaining balance</dt>
                <dd className="font-mono">{fmt(pdfData.remaining_after)}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* Lifecycle history */}
        <section className="rounded-xl border border-neutral-200/80 bg-white p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-3">
            History
          </div>
          {history.length === 0 ? (
            <p className="text-[12px] text-neutral-400">No activity recorded yet.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-neutral-200 pl-4">
              {history.map((h, i) => (
                <li key={i} className="relative">
                  <span
                    className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white ${
                      h.key === "paid"
                        ? "bg-emerald-500"
                        : h.key === "cancelled"
                          ? "bg-rose-500"
                          : h.key === "payment"
                            ? "bg-emerald-300"
                            : "bg-neutral-400"
                    }`}
                  />
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-neutral-800">
                      {h.label}
                      {h.detail ? (
                        <span className="ml-1 font-normal text-neutral-500">{h.detail}</span>
                      ) : null}
                    </span>
                    <span className="text-[11px] tabular-nums text-neutral-400">
                      {new Date(h.date).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {payments.length > 0 && (
            <div className="mt-4 border-t border-neutral-100 pt-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                Payment history
              </div>
              <ul className="space-y-1">
                {payments.map((p, i) => (
                  <li key={i} className="flex justify-between text-[12px]">
                    <span className="text-neutral-500">
                      {new Date(p.paid_at).toLocaleDateString("en-GB")}
                      {p.method ? ` · ${p.method}` : ""}
                    </span>
                    <span className="font-mono text-emerald-700">{fmt(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
