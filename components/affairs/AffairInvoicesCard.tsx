"use client";

// =====================================================================
// Invoices section of the affair (project) workspace — every commercial
// invoice (INV-xxxx) of the deal and its legal invoices (deposit / balance
// / credit note …), each a link to its detail page with PDF / Send quick
// actions. Read hub: Sales, Finance and Management see the whole billing
// picture of the dossier in one place. (m141)
// =====================================================================

import Link from "next/link";
import InvoicePdfActions from "@/components/invoicing/InvoicePdfActions";
import {
  formatInvoiceAmount,
  INVOICE_STATUS_LABELS,
  INVOICE_TYPE_LABELS,
  type InvoiceStatus,
  type InvoiceType,
} from "@/lib/invoicing";
import type { InvoicePDFData } from "@/components/InvoicePDF";

export type AffairInvoiceRow = {
  id: string;
  accounting_number: string;
  invoice_type: InvoiceType;
  label: string | null;
  status: InvoiceStatus;
  amount: number;
  paid: number;
  pdfData: InvoicePDFData;
};

export type AffairInvoiceFamily = {
  id: string;
  commercial_number: string;
  source_document_id: string | null;
  source_number: string | null;
  total_amount: number;
  currency: string | null;
  client_name: string | null;
  client_email: string | null;
  invoiced: number;
  paid: number;
  remaining: number;
  invoices: AffairInvoiceRow[];
};

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: "bg-neutral-100 text-neutral-600",
  sent: "bg-sky-100 text-sky-800",
  partially_paid: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  overdue: "bg-rose-100 text-rose-800",
  cancelled: "bg-neutral-100 text-neutral-400 line-through",
};

export function AffairInvoicesCard({ families }: { families: AffairInvoiceFamily[] }) {
  const count = families.reduce((n, f) => n + f.invoices.length, 0);

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Invoices
          <span className="ml-1.5 font-normal text-neutral-400">{count}</span>
        </h3>
      </div>

      {families.length === 0 ? (
        <p className="mt-2 text-[12px] text-neutral-400">
          No invoices yet — create one from a won quotation&apos;s Payment Schedule.
        </p>
      ) : (
        <div className="mt-1 space-y-4">
          {families.map((fam) => {
            const fmt = (n: number) => formatInvoiceAmount(n, fam.currency);
            return (
              <div
                key={fam.id}
                className="rounded-lg border border-neutral-200/80 bg-white"
              >
                <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-2.5 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {fam.source_document_id ? (
                      <Link
                        href={`/documents/${fam.source_document_id}`}
                        className="text-[13px] font-semibold text-neutral-900 hover:text-solux"
                      >
                        Commercial Invoice{" "}
                        <span className="font-mono">{fam.commercial_number}</span>
                      </Link>
                    ) : (
                      <span className="text-[13px] font-semibold text-neutral-900">
                        Commercial Invoice{" "}
                        <span className="font-mono">{fam.commercial_number}</span>
                      </span>
                    )}
                    {fam.source_number && (
                      <span className="text-[11px] text-neutral-400">
                        · {fam.source_number}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    Paid <b className="text-emerald-700">{fmt(fam.paid)}</b> · Remaining{" "}
                    <b>{fmt(fam.remaining)}</b> of {fmt(fam.total_amount)}
                  </div>
                </div>

                <ul className="divide-y divide-neutral-50">
                  {fam.invoices.map((inv) => {
                    const left = Math.max(0, Math.round((inv.amount - inv.paid) * 100) / 100);
                    return (
                      <li
                        key={inv.id}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 flex-wrap"
                      >
                        <Link
                          href={`/invoicing/${inv.id}`}
                          className="group min-w-0 flex-1 rounded-md -mx-1 px-1 hover:bg-neutral-50"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-medium text-neutral-900 group-hover:text-solux">
                              {inv.label ?? INVOICE_TYPE_LABELS[inv.invoice_type]}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[inv.status]}`}
                            >
                              {INVOICE_STATUS_LABELS[inv.status]}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-neutral-400">
                            <span className="font-mono group-hover:underline">
                              {inv.accounting_number}
                            </span>
                            {inv.paid > 0 && inv.status !== "paid" && (
                              <span className="ml-2 text-emerald-700">
                                {fmt(inv.paid)} paid · {fmt(left)} left
                              </span>
                            )}
                          </div>
                        </Link>
                        <div className="flex items-center gap-3">
                          <span
                            className={`font-mono text-[13px] ${
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
                          <InvoicePdfActions
                            data={inv.pdfData}
                            clientName={fam.client_name}
                            clientEmail={fam.client_email}
                            storageKey={`invoices/${inv.id}.pdf`}
                            invoiceId={inv.id}
                            status={inv.status}
                            variant="compact"
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
