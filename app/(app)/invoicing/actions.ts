"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/permissions";
import type { PaymentMode, PaymentTerms } from "@/lib/types";
import {
  buildInvoiceLineDescription,
  buildMilestonesFromTerms,
  computeDepositAmount,
  computePaidForInvoice,
  computeRemainingToInvoice,
  deriveInvoiceStatus,
  roundMoney,
  validateNextInvoiceAmount,
  type InvoiceLite,
  type InvoiceStatus,
  type InvoiceType,
} from "@/lib/invoicing";

/**
 * Server actions for the Deposit & Balance invoicing island (m141).
 *
 * Every amount decision is delegated to lib/invoicing.ts (pure, tested):
 * these actions only fetch, gate, and persist. The commercial pipeline
 * (documents / lines / launchProduction) is NOT touched — invoices hang
 * off a won quotation (or its proforma command) via invoice_families.
 *
 * Capability gate: quotation.create — invoicing a deal is the same
 * commercial act as quoting it. Payments recording shares the gate for
 * now (finance is read-only per m119); revisit when a finance.write
 * capability exists.
 */

const MIGRATION_HINT =
  "Invoicing tables missing — apply migration m141 (141_invoice_families.sql) in the Supabase SQL editor.";

function rethrowIfMissingTables(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (
    error.code === "42P01" ||
    /invoice_families|invoice_payments|"invoices"/.test(error.message ?? "")
  ) {
    throw new Error(MIGRATION_HINT);
  }
  throw new Error(error.message ?? "Unexpected database error");
}

type SourceDoc = {
  id: string;
  number: string | null;
  type: string;
  status: string;
  total_price: number;
  currency: string | null;
  client_id: string | null;
  affair_id: string | null;
  payment_mode: PaymentMode | null;
  payment_terms: PaymentTerms | null;
  clients: { company_name: string | null } | null;
};

async function fetchSourceDocument(
  supabase: ReturnType<typeof createClient>,
  documentId: string
): Promise<SourceDoc> {
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, number, type, status, total_price, currency, client_id, affair_id, payment_mode, payment_terms, clients(company_name)"
    )
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Document not found");
  return data as unknown as SourceDoc;
}

/** A won quotation or a proforma command can be invoiced — nothing else. */
function assertInvoiceable(doc: SourceDoc): void {
  const ok =
    (doc.type === "quotation" && doc.status === "won") || doc.type === "proforma";
  if (!ok) {
    throw new Error(
      "Invoices can only be created from a WON quotation (or its proforma command)."
    );
  }
}

async function getOrCreateFamily(
  supabase: ReturnType<typeof createClient>,
  doc: SourceDoc,
  userId: string
): Promise<{ id: string; commercial_number: string; total_amount: number }> {
  const existing = await supabase
    .from("invoice_families")
    .select("id, commercial_number, total_amount")
    .eq("source_document_id", doc.id)
    .maybeSingle();
  if (existing.error) rethrowIfMissingTables(existing.error);
  if (existing.data) return existing.data as any;

  const num = await supabase.rpc("next_commercial_invoice_number");
  if (num.error) rethrowIfMissingTables(num.error);

  const inserted = await supabase
    .from("invoice_families")
    .insert({
      commercial_number: num.data as string,
      source_document_id: doc.id,
      source_number: doc.number,
      source_type: doc.type,
      client_id: doc.client_id,
      client_name: doc.clients?.company_name ?? null,
      affair_id: doc.affair_id,
      total_amount: roundMoney(Number(doc.total_price) || 0),
      currency: doc.currency,
      payment_mode: doc.payment_mode,
      payment_terms: doc.payment_terms,
      created_by: userId,
    })
    .select("id, commercial_number, total_amount")
    .single();
  if (inserted.error) {
    // Unique-source race (two tabs): the other insert won — reuse it.
    if (inserted.error.code === "23505") {
      const retry = await supabase
        .from("invoice_families")
        .select("id, commercial_number, total_amount")
        .eq("source_document_id", doc.id)
        .maybeSingle();
      if (retry.data) return retry.data as any;
    }
    rethrowIfMissingTables(inserted.error);
  }
  return inserted.data as any;
}

export type CreateInvoiceInput = {
  document_id: string;
  invoice_type: Exclude<InvoiceType, "credit_note"> | "credit_note";
  /** Required for custom / credit_note; ignored otherwise. */
  custom_amount?: number;
  due_date?: string | null;
  note?: string | null;
};

/**
 * Create Invoice — the four options of the spec (+ credit notes).
 * All math (deposit % from payment terms, remaining balance, the
 * never-above-total ceiling) is computed here server-side; the UI only
 * previews the same numbers.
 */
export async function createInvoiceFromDocument(input: CreateInvoiceInput): Promise<{
  id: string;
  accounting_number: string;
  commercial_number: string;
}> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const doc = await fetchSourceDocument(supabase, input.document_id);
  assertInvoiceable(doc);

  const family = await getOrCreateFamily(supabase, doc, user.id);

  const existing = await supabase
    .from("invoices")
    .select("id, invoice_type, amount, status")
    .eq("family_id", family.id);
  if (existing.error) rethrowIfMissingTables(existing.error);
  const invoices = (existing.data ?? []) as InvoiceLite[];

  const total = roundMoney(Number(family.total_amount) || 0);
  const remaining = computeRemainingToInvoice(total, invoices);

  // Resolve amount / % / label per invoice type — spec's creation rules.
  let amount: number;
  let percent: number | null = null;
  let label: string;
  const type = input.invoice_type;
  if (type === "deposit") {
    const pct = doc.payment_terms?.deposit_percent;
    if (typeof pct !== "number" || pct <= 0 || pct >= 100) {
      throw new Error(
        "This document's payment terms have no deposit % — use a Custom invoice instead."
      );
    }
    percent = pct;
    amount = computeDepositAmount(total, pct);
    label = `${pct}% Deposit`;
  } else if (type === "balance") {
    amount = remaining;
    const ms = buildMilestonesFromTerms(doc.payment_mode, doc.payment_terms, total);
    label = ms.find((m) => m.key === "balance")?.label ?? "Balance";
    percent = total > 0 ? roundMoney((remaining / total) * 100) : null;
  } else if (type === "full") {
    amount = total;
    percent = 100;
    label = "100% Full amount";
  } else {
    // custom / credit_note
    amount = roundMoney(Number(input.custom_amount) || 0);
    label = type === "credit_note" ? "Credit note" : "Custom amount";
  }

  // The ceiling — never allow invoicing above the quotation total.
  // (Credit notes free up the ceiling; they don't consume it.)
  if (type !== "credit_note") {
    const err = validateNextInvoiceAmount(amount, remaining);
    if (err) throw new Error(err);
  } else if (!(amount > 0)) {
    throw new Error("Credit note amount must be greater than 0");
  }

  const num = await supabase.rpc("next_accounting_invoice_number");
  if (num.error) rethrowIfMissingTables(num.error);

  const inserted = await supabase
    .from("invoices")
    .insert({
      family_id: family.id,
      accounting_number: num.data as string,
      invoice_type: type,
      label,
      percent,
      amount,
      line_description: buildInvoiceLineDescription(type, doc.number, percent),
      status: "draft",
      due_date: input.due_date ?? null,
      notes: input.note ?? null,
      created_by: user.id,
    })
    .select("id, accounting_number")
    .single();
  if (inserted.error) rethrowIfMissingTables(inserted.error);

  revalidatePath(`/documents/${doc.id}`);
  return {
    id: (inserted.data as any).id,
    accounting_number: (inserted.data as any).accounting_number,
    commercial_number: family.commercial_number,
  };
}

/** Fetch invoice + its family (for gates and revalidation). */
async function fetchInvoiceWithFamily(
  supabase: ReturnType<typeof createClient>,
  invoiceId: string
): Promise<{
  id: string;
  amount: number;
  status: InvoiceStatus;
  due_date: string | null;
  family_id: string;
  source_document_id: string | null;
}> {
  const { data, error } = await supabase
    .from("invoices")
    .select("id, amount, status, due_date, family_id, invoice_families(source_document_id)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) rethrowIfMissingTables(error);
  if (!data) throw new Error("Invoice not found");
  const fam = (data as any).invoice_families;
  return {
    id: (data as any).id,
    amount: Number((data as any).amount) || 0,
    status: (data as any).status as InvoiceStatus,
    due_date: (data as any).due_date ?? null,
    family_id: (data as any).family_id,
    source_document_id: fam?.source_document_id ?? null,
  };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function refreshInvoiceStatus(
  supabase: ReturnType<typeof createClient>,
  invoice: { id: string; amount: number; status: InvoiceStatus; due_date: string | null }
): Promise<InvoiceStatus> {
  const payments = await supabase
    .from("invoice_payments")
    .select("invoice_id, amount")
    .eq("invoice_id", invoice.id);
  if (payments.error) rethrowIfMissingTables(payments.error);
  const paid = computePaidForInvoice(invoice.id, (payments.data ?? []) as any);
  const next = deriveInvoiceStatus(invoice, paid, todayISO());
  if (next !== invoice.status) {
    const upd = await supabase.from("invoices").update({ status: next }).eq("id", invoice.id);
    if (upd.error) rethrowIfMissingTables(upd.error);
  }
  return next;
}

export type RecordPaymentInput = {
  invoice_id: string;
  amount: number;
  paid_at?: string | null; // ISO date, defaults to today
  method?: string | null;
  note?: string | null;
};

/**
 * Record a payment receipt against a legal invoice. Status is re-derived
 * automatically (partially_paid / paid) so the Payment Schedule card is
 * always current with zero manual reconciliation.
 */
export async function recordInvoicePayment(input: RecordPaymentInput): Promise<void> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const invoice = await fetchInvoiceWithFamily(supabase, input.invoice_id);
  if (invoice.status === "cancelled") {
    throw new Error("Cannot record a payment on a cancelled invoice.");
  }
  const amount = roundMoney(Number(input.amount) || 0);
  if (!(amount > 0)) throw new Error("Payment amount must be greater than 0");

  const payments = await supabase
    .from("invoice_payments")
    .select("invoice_id, amount")
    .eq("invoice_id", invoice.id);
  if (payments.error) rethrowIfMissingTables(payments.error);
  const alreadyPaid = computePaidForInvoice(invoice.id, (payments.data ?? []) as any);
  if (alreadyPaid + amount > invoice.amount + 0.005) {
    throw new Error(
      `Payment exceeds this invoice — maximum is ${(invoice.amount - alreadyPaid).toFixed(2)}`
    );
  }

  const ins = await supabase.from("invoice_payments").insert({
    invoice_id: invoice.id,
    amount,
    paid_at: input.paid_at || todayISO(),
    method: input.method ?? null,
    note: input.note ?? null,
    created_by: user.id,
  });
  if (ins.error) rethrowIfMissingTables(ins.error);

  await refreshInvoiceStatus(supabase, invoice);
  revalidatePath(`/invoicing/${invoice.id}`);
  if (invoice.source_document_id) {
    revalidatePath(`/documents/${invoice.source_document_id}`);
  }
}

/** Draft → Sent (locks the "was it communicated" ambiguity out). */
export async function markInvoiceSent(invoiceId: string): Promise<void> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const invoice = await fetchInvoiceWithFamily(supabase, invoiceId);
  if (invoice.status !== "draft") {
    throw new Error("Only a draft invoice can be marked as sent.");
  }
  // sent_at is m143 — retry without it so a pre-m143 env still works.
  let upd = await supabase
    .from("invoices")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", invoiceId);
  if (upd.error && /sent_at/.test(upd.error.message ?? "")) {
    upd = await supabase.from("invoices").update({ status: "sent" }).eq("id", invoiceId);
  }
  if (upd.error) rethrowIfMissingTables(upd.error);
  revalidatePath(`/invoicing/${invoiceId}`);
  if (invoice.source_document_id) {
    revalidatePath(`/documents/${invoice.source_document_id}`);
  }
}

export type UpdateInvoiceInput = {
  invoice_id: string;
  /** Draft only — re-validated against the family ceiling. */
  amount?: number;
  due_date?: string | null;
  notes?: string | null;
};

/**
 * Edit a legal invoice. A DRAFT is fully editable (amount included, the
 * ceiling is re-checked excluding the invoice itself); once sent, the
 * amount is legally frozen — only due date and notes stay editable.
 */
export async function updateInvoice(input: UpdateInvoiceInput): Promise<void> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const invoice = await fetchInvoiceWithFamily(supabase, input.invoice_id);
  if (invoice.status === "cancelled") {
    throw new Error("A cancelled invoice cannot be edited.");
  }

  const patch: Record<string, unknown> = {};
  if (input.due_date !== undefined) patch.due_date = input.due_date || null;
  if (input.notes !== undefined) patch.notes = input.notes || null;

  if (input.amount !== undefined) {
    if (invoice.status !== "draft") {
      throw new Error(
        "The amount of a sent invoice is frozen — cancel it or issue a credit note instead."
      );
    }
    const amount = roundMoney(Number(input.amount) || 0);
    // Ceiling check EXCLUDING this invoice (it's being replaced).
    const fam = await supabase
      .from("invoice_families")
      .select("id, total_amount")
      .eq("id", invoice.family_id)
      .maybeSingle();
    if (fam.error) rethrowIfMissingTables(fam.error);
    const siblings = await supabase
      .from("invoices")
      .select("id, invoice_type, amount, status")
      .eq("family_id", invoice.family_id)
      .neq("id", invoice.id);
    if (siblings.error) rethrowIfMissingTables(siblings.error);
    const remaining = computeRemainingToInvoice(
      roundMoney(Number(fam.data?.total_amount) || 0),
      (siblings.data ?? []) as InvoiceLite[]
    );
    const err = validateNextInvoiceAmount(amount, remaining);
    if (err) throw new Error(err);
    patch.amount = amount;
  }

  if (Object.keys(patch).length === 0) return;
  const upd = await supabase.from("invoices").update(patch).eq("id", input.invoice_id);
  if (upd.error) rethrowIfMissingTables(upd.error);
  revalidatePath(`/invoicing/${input.invoice_id}`);
  if (invoice.source_document_id) {
    revalidatePath(`/documents/${invoice.source_document_id}`);
  }
}

/**
 * Duplicate an invoice — a NEW draft custom invoice with the same amount
 * and a fresh accounting number (accounting numbers are never reused),
 * still subject to the family ceiling.
 */
export async function duplicateInvoice(invoiceId: string): Promise<{ id: string }> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const src = await supabase
    .from("invoices")
    .select("id, family_id, invoice_type, label, amount, due_date, notes, line_description")
    .eq("id", invoiceId)
    .maybeSingle();
  if (src.error) rethrowIfMissingTables(src.error);
  if (!src.data) throw new Error("Invoice not found");

  const fam = await supabase
    .from("invoice_families")
    .select("id, total_amount, source_document_id")
    .eq("id", (src.data as any).family_id)
    .maybeSingle();
  if (fam.error) rethrowIfMissingTables(fam.error);

  const siblings = await supabase
    .from("invoices")
    .select("id, invoice_type, amount, status")
    .eq("family_id", (src.data as any).family_id);
  if (siblings.error) rethrowIfMissingTables(siblings.error);

  const amount = roundMoney(Number((src.data as any).amount) || 0);
  const remaining = computeRemainingToInvoice(
    roundMoney(Number(fam.data?.total_amount) || 0),
    (siblings.data ?? []) as InvoiceLite[]
  );
  const err = validateNextInvoiceAmount(amount, remaining);
  if (err) throw new Error(`Cannot duplicate — ${err}`);

  const num = await supabase.rpc("next_accounting_invoice_number");
  if (num.error) rethrowIfMissingTables(num.error);

  const inserted = await supabase
    .from("invoices")
    .insert({
      family_id: (src.data as any).family_id,
      accounting_number: num.data as string,
      invoice_type: "custom",
      label: `${(src.data as any).label ?? "Invoice"} (copy)`,
      percent: null,
      amount,
      line_description: (src.data as any).line_description,
      status: "draft",
      due_date: (src.data as any).due_date ?? null,
      notes: (src.data as any).notes ?? null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (inserted.error) rethrowIfMissingTables(inserted.error);

  const docId = (fam.data as any)?.source_document_id;
  if (docId) revalidatePath(`/documents/${docId}`);
  return { id: (inserted.data as any).id };
}

/**
 * Cancel a legal invoice — frees its amount back into the family ceiling.
 * Blocked when payments were recorded (issue a credit note instead: the
 * paid money is a real accounting fact that must not silently vanish).
 */
export async function cancelInvoice(invoiceId: string): Promise<void> {
  await requireCapability("quotation.create");
  const supabase = createClient();
  const invoice = await fetchInvoiceWithFamily(supabase, invoiceId);
  if (invoice.status === "cancelled") return;

  const payments = await supabase
    .from("invoice_payments")
    .select("invoice_id, amount")
    .eq("invoice_id", invoiceId);
  if (payments.error) rethrowIfMissingTables(payments.error);
  if (computePaidForInvoice(invoiceId, (payments.data ?? []) as any) > 0) {
    throw new Error(
      "This invoice has recorded payments — create a Credit Note instead of cancelling."
    );
  }

  const upd = await supabase
    .from("invoices")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", invoiceId);
  if (upd.error) rethrowIfMissingTables(upd.error);
  revalidatePath(`/invoicing/${invoiceId}`);
  if (invoice.source_document_id) {
    revalidatePath(`/documents/${invoice.source_document_id}`);
  }
}
