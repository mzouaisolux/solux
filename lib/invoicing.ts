import type { PaymentMode, PaymentTerms } from "./types";

/**
 * lib/invoicing — PURE computation core for the Deposit & Balance
 * invoicing system (m141). No Supabase, no I/O: every business rule the
 * spec cares about (auto deposit %, remaining balance, the "never invoice
 * above the quotation total" ceiling, payment progress) lives here so it
 * can be unit-tested against the spec's own numbers.
 *
 * Conventions (must match m141):
 *  - `amount` on an invoice is ALWAYS positive; `credit_note` rows
 *    SUBTRACT when aggregating (signedInvoiceAmount is the single place
 *    that encodes this).
 *  - `cancelled` invoices never count toward anything.
 *  - Money is rounded to 2 decimals at every boundary to avoid float
 *    drift accumulating across a multi-deposit schedule.
 */

export type InvoiceType =
  | "deposit"
  | "balance"
  | "full"
  | "custom"
  | "credit_note";

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "cancelled";

/** The minimal invoice shape every computation needs. */
export type InvoiceLite = {
  id?: string;
  invoice_type: InvoiceType;
  amount: number;
  status: InvoiceStatus;
};

export type PaymentLite = { invoice_id?: string; amount: number };

/** A planned payment milestone derived from the quotation's payment terms. */
export type PaymentMilestone = {
  key: "deposit" | "balance" | "full";
  label: string;
  percent: number; // 0–100
  amount: number;
};

/** Float-safe money rounding (2 decimals). */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Tolerance for "equals" comparisons on money (half a cent). */
const EPSILON = 0.005;

/** credit_note subtracts; everything else adds. Cancelled = 0. */
export function signedInvoiceAmount(inv: InvoiceLite): number {
  if (inv.status === "cancelled") return 0;
  const a = Number(inv.amount) || 0;
  return inv.invoice_type === "credit_note" ? -a : a;
}

/** Total already invoiced (deposits + balance + custom − credit notes). */
export function computeInvoicedTotal(invoices: InvoiceLite[]): number {
  return roundMoney(invoices.reduce((s, i) => s + signedInvoiceAmount(i), 0));
}

/**
 * Remaining amount that can still be invoiced — the CEILING for the next
 * invoice. Never negative (a credit-note-heavy family clamps to the
 * ceiling, not above it).
 */
export function computeRemainingToInvoice(
  totalAmount: number,
  invoices: InvoiceLite[]
): number {
  const remaining = roundMoney(totalAmount - computeInvoicedTotal(invoices));
  return Math.max(0, Math.min(roundMoney(totalAmount), remaining));
}

/** 30% of 100,000 → 30,000. */
export function computeDepositAmount(
  totalAmount: number,
  percent: number
): number {
  return roundMoney((totalAmount * percent) / 100);
}

/**
 * The planned schedule from the quotation's payment terms.
 *  - deposit_balance / hybrid with deposit% → [deposit, balance]
 *  - deposit% of 0 or 100, LC-only, or no terms → single 100% milestone
 * The balance amount is computed as total − deposit (not balance% × total)
 * so the two milestones always sum EXACTLY to the total after rounding.
 */
export function buildMilestonesFromTerms(
  mode: PaymentMode | null | undefined,
  terms: PaymentTerms | null | undefined,
  totalAmount: number
): PaymentMilestone[] {
  const total = roundMoney(totalAmount);
  const pct =
    (mode === "deposit_balance" || mode === "hybrid") &&
    typeof terms?.deposit_percent === "number"
      ? terms.deposit_percent
      : null;

  if (pct === null || pct <= 0 || pct >= 100) {
    return [{ key: "full", label: "100% Full amount", percent: 100, amount: total }];
  }

  const deposit = computeDepositAmount(total, pct);
  const balancePct = roundMoney(100 - pct);
  const balanceLabel =
    mode === "hybrid"
      ? `${balancePct}% Balance via L/C`
      : terms?.balance_condition === "against_documents"
        ? `${balancePct}% Balance against documents`
        : `${balancePct}% Balance before shipment`;

  return [
    { key: "deposit", label: `${pct}% Deposit`, percent: pct, amount: deposit },
    {
      key: "balance",
      label: balanceLabel,
      percent: balancePct,
      amount: roundMoney(total - deposit),
    },
  ];
}

/**
 * The automatic-validation rule from the spec: never allow invoicing
 * above the quotation total. Returns an error string, or null when OK.
 */
export function validateNextInvoiceAmount(
  amount: number,
  remainingToInvoice: number
): string | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Invoice amount must be greater than 0";
  }
  if (amount > remainingToInvoice + EPSILON) {
    return `Amount exceeds the remaining balance — maximum allowed is ${remainingToInvoice.toFixed(2)}`;
  }
  return null;
}

/**
 * The single billing line of a legal invoice ("Deposit payment according
 * to Quotation Q-2026-001 — 30% of quotation amount").
 */
export function buildInvoiceLineDescription(
  type: InvoiceType,
  sourceNumber: string | null | undefined,
  percent?: number | null
): string {
  const ref = sourceNumber ? ` according to Quotation ${sourceNumber}` : "";
  const pctPart =
    typeof percent === "number" && percent > 0 && percent < 100
      ? ` — ${percent}% of quotation amount`
      : "";
  switch (type) {
    case "deposit":
      return `Deposit payment${ref}${pctPart}`;
    case "balance":
      return `Balance payment${ref}`;
    case "full":
      return `Payment in full${ref}`;
    case "credit_note":
      return `Credit note${ref}`;
    default:
      return `Payment${ref}`;
  }
}

/** Sum of a single invoice's recorded payments. */
export function computePaidForInvoice(
  invoiceId: string,
  payments: PaymentLite[]
): number {
  return roundMoney(
    payments
      .filter((p) => p.invoice_id === invoiceId)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
  );
}

/**
 * Derive an invoice's payment status from its recorded payments.
 * `cancelled` and `draft` are sticky (a draft was never sent — payments
 * against it still promote it, since receiving money IS the signal).
 * `overdue` only applies to a sent, unpaid invoice past its due date.
 */
export function deriveInvoiceStatus(
  inv: { status: InvoiceStatus; amount: number; due_date?: string | null },
  paidAmount: number,
  today: string
): InvoiceStatus {
  if (inv.status === "cancelled") return "cancelled";
  if (paidAmount >= Number(inv.amount) - EPSILON && paidAmount > 0) return "paid";
  if (paidAmount > 0) return "partially_paid";
  if (
    inv.status !== "draft" &&
    inv.due_date &&
    inv.due_date < today
  ) {
    return "overdue";
  }
  return inv.status;
}

export type PaymentProgress = {
  totalAmount: number;
  invoicedTotal: number;
  remainingToInvoice: number;
  paidTotal: number;
  /** invoiced but not yet paid */
  outstanding: number;
  /** total − paid (what the client still owes overall) */
  remainingToPay: number;
  /** 0–100, share of the TOTAL already paid (drives the progress bar) */
  paidPercent: number;
  invoicedPercent: number;
};

/** The always-up-to-date numbers the Payment Schedule card displays. */
export function computePaymentProgress(
  totalAmount: number,
  invoices: InvoiceLite[],
  payments: PaymentLite[]
): PaymentProgress {
  const total = roundMoney(totalAmount);
  const invoicedTotal = computeInvoicedTotal(invoices);
  const active = invoices.filter((i) => i.status !== "cancelled");
  const activeIds = new Set(active.map((i) => i.id));
  const paidTotal = roundMoney(
    payments
      .filter((p) => !p.invoice_id || activeIds.has(p.invoice_id))
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
  );
  const pctOf = (n: number) =>
    total > 0 ? Math.max(0, Math.min(100, Math.round((n / total) * 100))) : 0;
  return {
    totalAmount: total,
    invoicedTotal,
    remainingToInvoice: computeRemainingToInvoice(total, invoices),
    paidTotal,
    outstanding: Math.max(0, roundMoney(invoicedTotal - paidTotal)),
    remainingToPay: Math.max(0, roundMoney(total - paidTotal)),
    paidPercent: pctOf(paidTotal),
    invoicedPercent: pctOf(invoicedTotal),
  };
}

/** "30,000.00 USD" — display helper shared by the card and the modal. */
export function formatInvoiceAmount(
  n: number,
  currency?: string | null
): string {
  const num = (Number(n) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${num} ${currency}` : num;
}

export type InvoiceHistoryEntry = {
  key: "created" | "sent" | "payment" | "paid" | "cancelled";
  label: string;
  /** ISO timestamp or date */
  date: string;
  detail?: string;
};

/**
 * The lifecycle history of a legal invoice, oldest first:
 *   Created → Sent → Payment received (×n) → Paid → / Cancelled.
 * "Paid" is stamped on the payment that completes the amount — no extra
 * column needed, the ledger IS the source of truth.
 */
export function buildInvoiceHistory(
  inv: {
    amount: number;
    created_at?: string | null;
    sent_at?: string | null;
    cancelled_at?: string | null;
  },
  payments: { amount: number; paid_at: string }[],
  opts?: { createdBy?: string | null; formatAmount?: (n: number) => string }
): InvoiceHistoryEntry[] {
  const fmt = opts?.formatAmount ?? ((n: number) => n.toFixed(2));
  const out: InvoiceHistoryEntry[] = [];
  if (inv.created_at) {
    out.push({
      key: "created",
      label: "Created",
      date: inv.created_at,
      detail: opts?.createdBy ? `by ${opts.createdBy}` : undefined,
    });
  }
  if (inv.sent_at) {
    out.push({ key: "sent", label: "Sent", date: inv.sent_at });
  }
  const sorted = [...payments].sort((a, b) => a.paid_at.localeCompare(b.paid_at));
  let cumulative = 0;
  for (const p of sorted) {
    cumulative = roundMoney(cumulative + (Number(p.amount) || 0));
    out.push({
      key: "payment",
      label: "Payment received",
      date: p.paid_at,
      detail: fmt(Number(p.amount) || 0),
    });
    if (cumulative >= Number(inv.amount) - 0.005 && Number(inv.amount) > 0) {
      out.push({ key: "paid", label: "Paid in full", date: p.paid_at });
    }
  }
  if (inv.cancelled_at) {
    out.push({ key: "cancelled", label: "Cancelled", date: inv.cancelled_at });
  }
  return out;
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  deposit: "Deposit Invoice",
  balance: "Balance Invoice",
  full: "Full Invoice",
  custom: "Custom Invoice",
  credit_note: "Credit Note",
};
