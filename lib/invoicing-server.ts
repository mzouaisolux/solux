import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankAccount, PaymentMode, PaymentTerms } from "./types";
import {
  computeInvoicedTotal,
  computePaidForInvoice,
  computeRemainingToInvoice,
  roundMoney,
  signedInvoiceAmount,
  INVOICE_TYPE_LABELS,
  type InvoiceLite,
  type InvoiceStatus,
  type InvoiceType,
} from "./invoicing";
import { formatPaymentTerms } from "./payment";
import type { InvoicePDFData, InvoiceProductLine } from "@/components/InvoicePDF";

/**
 * Server-side fetch + shaping for the invoicing island (m141). Kept apart
 * from lib/invoicing.ts (pure, client-safe) because these touch Supabase.
 * Every consumer (the /invoicing/[id] detail page, the document Payment
 * Schedule, the affair Invoices card) shapes data the SAME way here, so
 * the numbers can never diverge between surfaces.
 *
 * All reads are defensive: a missing m141/m142 column or table resolves to
 * empty rather than throwing, so a not-yet-migrated env degrades quietly.
 */

export type ShapedInvoice = {
  id: string;
  accounting_number: string;
  invoice_type: InvoiceType;
  label: string | null;
  percent: number | null;
  amount: number;
  status: InvoiceStatus;
  issue_date: string | null;
  due_date: string | null;
  line_description: string | null;
  notes: string | null;
  created_at: string | null;
  created_by: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  /** sum of recorded payments */
  paid: number;
};

export type ShapedFamily = {
  id: string;
  commercial_number: string;
  source_document_id: string | null;
  source_number: string | null;
  source_type: string | null;
  client_id: string | null;
  client_name: string | null;
  affair_id: string | null;
  total_amount: number;
  currency: string | null;
  payment_mode: PaymentMode | null;
  payment_terms: PaymentTerms | null;
  invoices: ShapedInvoice[];
  /** the source quotation's product lines — shown on EVERY invoice PDF */
  product_lines: InvoiceProductLine[];
  /** total freight/transport of the source document */
  freight: number;
  /** sum of the product line totals (goods only) */
  items_subtotal: number;
};

const FAMILY_COLS =
  "id, commercial_number, source_document_id, source_number, source_type, client_id, client_name, affair_id, total_amount, currency, payment_mode, payment_terms";
const INVOICE_COLS =
  "id, family_id, accounting_number, invoice_type, label, percent, amount, status, issue_date, due_date, line_description, notes, created_at, created_by, sent_at, cancelled_at";

type PaymentRow = { invoice_id: string; amount: number; paid_at: string; method: string | null; note: string | null };

function shapeInvoice(row: any, payments: PaymentRow[]): ShapedInvoice {
  return {
    id: row.id,
    accounting_number: row.accounting_number,
    invoice_type: row.invoice_type,
    label: row.label ?? null,
    percent: row.percent ?? null,
    amount: Number(row.amount) || 0,
    status: row.status,
    issue_date: row.issue_date ?? null,
    due_date: row.due_date ?? null,
    line_description: row.line_description ?? null,
    notes: row.notes ?? null,
    created_at: row.created_at ?? null,
    created_by: row.created_by ?? null,
    sent_at: row.sent_at ?? null,
    cancelled_at: row.cancelled_at ?? null,
    paid: computePaidForInvoice(row.id, payments),
  };
}

/** Retry the invoice select without sent_at (m143) if that column is absent. */
async function selectInvoices(
  supabase: SupabaseClient,
  filter: (q: any) => any
): Promise<any[]> {
  let res = await filter(supabase.from("invoices").select(INVOICE_COLS));
  if (res.error && /sent_at/.test(res.error.message ?? "")) {
    res = await filter(
      supabase.from("invoices").select(INVOICE_COLS.replace(", sent_at", ""))
    );
  }
  if (res.error) return [];
  return res.data ?? [];
}

async function fetchPaymentsFor(
  supabase: SupabaseClient,
  invoiceIds: string[]
): Promise<PaymentRow[]> {
  if (!invoiceIds.length) return [];
  const res = await supabase
    .from("invoice_payments")
    .select("invoice_id, amount, paid_at, method, note")
    .in("invoice_id", invoiceIds);
  if (res.error) return [];
  return (res.data ?? []) as PaymentRow[];
}

/**
 * The source quotation's product lines, shaped for the invoice PDF — the
 * SAME lines the quotation PDF shows (name · client ref · spec · qty · unit ·
 * total), so every invoice itemises exactly what is being billed. Replicates
 * the document page's line-building (m089 snapshots + visible config fields).
 * Best-effort: missing tables/columns resolve to an empty list.
 */
export async function fetchDocumentProductLines(
  supabase: SupabaseClient,
  documentId: string
): Promise<{ lines: InvoiceProductLine[]; itemsSubtotal: number; freight: number }> {
  const linesRes = await supabase
    .from("document_lines")
    .select(
      "quantity, selected_options, unit_price, total_price, client_product_name, config_values, product_name, product_category, products(name, category, category_id)"
    )
    .eq("document_id", documentId);
  const rows = linesRes.error ? [] : (linesRes.data ?? []);

  // Which config fields are customer-visible, per category (same rule as the
  // quotation PDF). One extra read; harmless if the table is absent.
  const allowedByCat = new Map<string, Set<string>>();
  const cf = await supabase
    .from("config_fields")
    .select("field_name, category_id, visible_in_quotation, internal_only, active")
    .eq("visible_in_quotation", true)
    .eq("internal_only", false)
    .eq("active", true);
  if (!cf.error) {
    for (const f of cf.data ?? []) {
      const cat = (f as any).category_id as string | null;
      const name = (f as any).field_name as string | null;
      if (!cat || !name) continue;
      if (!allowedByCat.has(cat)) allowedByCat.set(cat, new Set());
      allowedByCat.get(cat)!.add(name);
    }
  }

  function specFor(row: any): string {
    const catId = row.products?.category_id ?? null;
    const cfg = (row.config_values ?? null) as Record<string, unknown> | null;
    if (cfg && typeof cfg === "object") {
      const allowed = catId ? allowedByCat.get(catId) : null;
      const parts: string[] = [];
      for (const [k, v] of Object.entries(cfg)) {
        if (v == null || String(v).trim() === "") continue;
        if (allowed && !allowed.has(k)) continue;
        parts.push(`${k} ${String(v).trim()}`);
      }
      if (parts.length) return parts.join(" · ");
    }
    // Fallback: legacy selected_options values.
    const opts = (row.selected_options ?? {}) as Record<string, unknown>;
    const vals = Object.values(opts)
      .filter((v) => v != null && String(v).trim() !== "")
      .map((v) => String(v));
    return vals.join(" · ");
  }

  const lines: InvoiceProductLine[] = rows.map((row: any) => {
    const name =
      row.products?.name ??
      row.product_name ??
      (row.client_product_name && String(row.client_product_name).trim()) ??
      "—";
    const clientRef =
      row.products?.name || row.product_name
        ? (row.client_product_name && String(row.client_product_name).trim()) || null
        : null;
    return {
      product_name: name,
      client_reference: clientRef,
      spec: specFor(row) || null,
      quantity: Number(row.quantity || 0),
      unit_price: Number(row.unit_price || 0),
      line_total: Number(row.total_price || 0),
    };
  });

  const itemsSubtotal = roundMoney(lines.reduce((s, l) => s + (Number(l.line_total) || 0), 0));

  // Freight from the document row (kept simple: read freight_cost).
  let freight = 0;
  const doc = await supabase
    .from("documents")
    .select("freight_cost")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc.error && doc.data) freight = Number((doc.data as any).freight_cost) || 0;

  return { lines, itemsSubtotal, freight };
}

/** One shaped family for a source document, or null if none exists yet. */
export async function fetchFamilyForDocument(
  supabase: SupabaseClient,
  documentId: string
): Promise<ShapedFamily | null> {
  const fam = await supabase
    .from("invoice_families")
    .select(FAMILY_COLS)
    .eq("source_document_id", documentId)
    .maybeSingle();
  if (fam.error || !fam.data) return null;
  return shapeFamilyWithInvoices(supabase, fam.data);
}

/** All shaped families under an affair (newest first). */
export async function fetchFamiliesForAffair(
  supabase: SupabaseClient,
  affairId: string
): Promise<ShapedFamily[]> {
  const fams = await supabase
    .from("invoice_families")
    .select(FAMILY_COLS)
    .eq("affair_id", affairId)
    .order("created_at", { ascending: false });
  if (fams.error || !fams.data?.length) return [];
  return Promise.all(fams.data.map((f) => shapeFamilyWithInvoices(supabase, f)));
}

async function shapeFamilyWithInvoices(
  supabase: SupabaseClient,
  famRow: any
): Promise<ShapedFamily> {
  const invRows = await selectInvoices(supabase, (q) =>
    q.eq("family_id", famRow.id).order("created_at", { ascending: true })
  );
  const payments = await fetchPaymentsFor(
    supabase,
    invRows.map((r) => r.id)
  );
  const productData = famRow.source_document_id
    ? await fetchDocumentProductLines(supabase, famRow.source_document_id)
    : { lines: [] as InvoiceProductLine[], itemsSubtotal: 0, freight: 0 };
  return {
    id: famRow.id,
    commercial_number: famRow.commercial_number,
    source_document_id: famRow.source_document_id ?? null,
    source_number: famRow.source_number ?? null,
    source_type: famRow.source_type ?? null,
    client_id: famRow.client_id ?? null,
    client_name: famRow.client_name ?? null,
    affair_id: famRow.affair_id ?? null,
    total_amount: roundMoney(Number(famRow.total_amount) || 0),
    currency: famRow.currency ?? null,
    payment_mode: (famRow.payment_mode ?? null) as PaymentMode | null,
    payment_terms: (famRow.payment_terms ?? null) as PaymentTerms | null,
    invoices: invRows.map((r) => shapeInvoice(r, payments)),
    product_lines: productData.lines,
    freight: productData.freight,
    items_subtotal: productData.itemsSubtotal,
  };
}

/** Client + bank details a rendered invoice PDF needs (best-effort). */
export type InvoicePdfContext = {
  client: InvoicePDFData["client"];
  bank: BankAccount | null;
};

/** Fetch the client extras + default bank account for a family's PDFs. */
export async function fetchPdfContext(
  supabase: SupabaseClient,
  clientId: string | null
): Promise<InvoicePdfContext> {
  const [cli, bk] = await Promise.all([
    clientId
      ? supabase
          .from("clients")
          .select("company_name, contact_name, email, country, address, vat_number")
          .eq("id", clientId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("bank_accounts")
      .select(
        "id, account_name, business_account_name, currency, bank_name, bank_address, account_number, swift, is_default"
      )
      .eq("is_default", true)
      .maybeSingle(),
  ]);
  return {
    client: (cli.data ?? null) as InvoicePDFData["client"],
    bank: (bk.data ?? null) as BankAccount | null,
  };
}

/** Invoiced total (signed, cancelled excluded) up to & including one invoice. */
function invoicedUpTo(family: ShapedFamily, inv: ShapedInvoice): number {
  return roundMoney(
    family.invoices
      .filter(
        (i) =>
          i.status !== "cancelled" &&
          (i.created_at ?? "") <= (inv.created_at ?? "")
      )
      .reduce((s, i) => s + signedInvoiceAmount(i), 0)
  );
}

/**
 * Build the InvoicePDFData for one legal invoice (single source of shaping).
 * Full / Deposit / Balance all get the SAME itemised product lines; only the
 * payment-summary fields (deposits deducted, remaining, percent) differ.
 */
export function toInvoicePdfData(
  family: ShapedFamily,
  inv: ShapedInvoice,
  ctx: InvoicePdfContext
): InvoicePDFData {
  const total = family.total_amount;
  // For a BALANCE invoice: the prior deposits to deduct (non-cancelled, before
  // or excluding this invoice).
  const deposits =
    inv.invoice_type === "balance"
      ? family.invoices
          .filter(
            (i) =>
              i.id !== inv.id &&
              i.status !== "cancelled" &&
              (i.invoice_type === "deposit" || i.invoice_type === "custom") &&
              (i.created_at ?? "") <= (inv.created_at ?? "")
          )
          .map((i) => ({ accounting_number: i.accounting_number, amount: i.amount }))
      : undefined;
  // For a DEPOSIT / CUSTOM invoice: what's still owed after this one.
  const remainingAfter =
    inv.invoice_type === "deposit" || inv.invoice_type === "custom"
      ? Math.max(0, roundMoney(total - invoicedUpTo(family, inv)))
      : null;

  return {
    commercial_number: family.commercial_number,
    accounting_number: inv.accounting_number,
    invoice_type: inv.invoice_type,
    type_title: INVOICE_TYPE_LABELS[inv.invoice_type].toUpperCase(),
    type_label: INVOICE_TYPE_LABELS[inv.invoice_type],
    date: inv.issue_date ?? inv.created_at ?? new Date().toISOString(),
    due_date: inv.due_date,
    source_number: family.source_number,
    currency: (family.currency ?? undefined) as InvoicePDFData["currency"],
    lines: family.product_lines,
    freight: family.freight,
    items_subtotal: family.items_subtotal || roundMoney(total - family.freight),
    quotation_total: total,
    amount: inv.amount,
    percent: inv.percent,
    deposits,
    payment_terms_label: (() => {
      const t = formatPaymentTerms(family.payment_mode, family.payment_terms);
      return t && t !== "—" ? t : null;
    })(),
    remaining_after: remainingAfter,
    is_credit_note: inv.invoice_type === "credit_note",
    client: ctx.client,
    bank: ctx.bank,
  };
}

/** Family-level rollup (invoiced / paid / remaining) for a card header. */
export function familyRollup(family: ShapedFamily): {
  invoiced: number;
  paid: number;
  remaining: number;
} {
  const lites: InvoiceLite[] = family.invoices.map((i) => ({
    id: i.id,
    invoice_type: i.invoice_type,
    amount: i.amount,
    status: i.status,
  }));
  const paid = roundMoney(
    family.invoices
      .filter((i) => i.status !== "cancelled")
      .reduce((s, i) => s + i.paid, 0)
  );
  return {
    invoiced: computeInvoicedTotal(lites),
    paid,
    remaining: computeRemainingToInvoice(family.total_amount, lites),
  };
}

export type InvoiceDetail = {
  invoice: ShapedInvoice;
  family: ShapedFamily;
  payments: PaymentRow[];
};

/** Everything the /invoicing/[id] detail page needs, in one shot. */
export async function fetchInvoiceDetail(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<InvoiceDetail | null> {
  const invRows = await selectInvoices(supabase, (q) => q.eq("id", invoiceId));
  if (!invRows.length) return null;
  const row = invRows[0];
  const fam = await supabase
    .from("invoice_families")
    .select(FAMILY_COLS)
    .eq("id", row.family_id)
    .maybeSingle();
  if (fam.error || !fam.data) return null;
  const family = await shapeFamilyWithInvoices(supabase, fam.data);
  const payments = await fetchPaymentsFor(supabase, [invoiceId]);
  return {
    invoice: shapeInvoice(row, payments),
    family,
    payments: payments.sort((a, b) => a.paid_at.localeCompare(b.paid_at)),
  };
}
