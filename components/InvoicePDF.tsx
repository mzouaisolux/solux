"use client";

/**
 * InvoicePDF — the ONE legal invoice template for the deposit & balance
 * system (m141). Full / Deposit / Balance / Custom / Credit note all render
 * from this single component. What changes between them is ONLY:
 *   - the big title (FULL INVOICE / DEPOSIT INVOICE / BALANCE INVOICE …), and
 *   - the totals / payment-summary block at the bottom.
 * Everything else — masthead, party block, and the FULL product table
 * (name · reference · specs · qty · unit price · line total) — is identical
 * on every invoice, exactly like a normal commercial invoice. The customer
 * always sees precisely which products are being invoiced.
 *
 * Built on the shared SOLUX PDF design system (components/pdf/theme).
 */

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import {
  BrandHeader,
  COLORS,
  currencyMark,
  DocTitle,
  F,
  formatAmount,
  GAP_L,
  GAP_M,
  GAP_S,
  M_OUT,
  Rule,
  SectionHeader,
} from "@/components/pdf/theme";
import type { BankAccount, Currency } from "@/lib/types";
import type { InvoiceType } from "@/lib/invoicing";

export type InvoiceProductLine = {
  product_name: string;
  client_reference?: string | null;
  /** compact spec summary, e.g. "LiFePO4 Battery · TOPCon Panel · Philips LEDs" */
  spec?: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type InvoiceDepositRef = { accounting_number: string; amount: number };

export type InvoicePDFData = {
  commercial_number: string; // INV-1025
  accounting_number: string; // 2026-00458
  invoice_type: InvoiceType;
  /** big title, e.g. "DEPOSIT INVOICE" */
  type_title: string;
  /** legacy alias kept for older callers */
  type_label?: string;
  date: string;
  due_date?: string | null;
  source_number: string | null; // Q-2026-001
  order_number?: string | null;
  currency?: Currency | null;

  // The product table — ALWAYS shown, identical on every invoice type.
  lines: InvoiceProductLine[];
  freight?: number | null;
  /** sum of the product line totals (goods only) */
  items_subtotal: number;
  /** the deal ceiling (items + freight) — the reference for deposit/balance */
  quotation_total: number;

  // This invoice's figures.
  amount: number;
  percent?: number | null;

  // Balance deduction: the prior deposit invoices subtracted from the total.
  deposits?: InvoiceDepositRef[];

  // Terms shown on every invoice.
  payment_terms_label?: string | null;
  /** for a deposit: what stays owed after this invoice */
  remaining_after?: number | null;

  is_credit_note?: boolean;
  client: {
    company_name: string;
    contact_name?: string | null;
    email?: string | null;
    country?: string | null;
    address?: string | null;
    vat_number?: string | null;
  } | null;
  bank?: BankAccount | null;
};

const s = StyleSheet.create({
  page: {
    paddingTop: M_OUT,
    paddingBottom: M_OUT,
    paddingHorizontal: M_OUT,
    fontFamily: F.body,
    fontSize: 9,
    color: COLORS.body,
    lineHeight: 1.4,
  },
  parties: { flexDirection: "row", justifyContent: "space-between", marginTop: GAP_M },
  col: { width: "48%" },
  eyebrow: {
    fontSize: 7.5,
    fontWeight: 600,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: COLORS.muted,
    marginBottom: 3,
  },
  strong: { fontWeight: 600, color: COLORS.ink },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  metaKey: { color: COLORS.muted },
  metaVal: { color: COLORS.ink, fontWeight: 600 },

  tableHead: {
    flexDirection: "row",
    backgroundColor: COLORS.fill,
    paddingVertical: 5,
    paddingHorizontal: 6,
    marginTop: GAP_M,
  },
  th: {
    fontSize: 7.5,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: COLORS.muted,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hair,
  },
  cDesc: { width: "46%", paddingRight: 8 },
  cRef: { width: "18%", paddingRight: 6 },
  cQty: { width: "10%", textAlign: "center" },
  cUnit: { width: "13%", textAlign: "right" },
  cTot: { width: "13%", textAlign: "right" },
  specLine: { fontSize: 7.5, color: COLORS.muted, marginTop: 2 },

  totals: { marginTop: GAP_M, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", width: "48%", marginBottom: 3 },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "48%",
    borderTopWidth: 1,
    borderTopColor: COLORS.ink,
    paddingTop: 5,
    marginTop: 3,
  },
  grandLabel: { fontSize: 10, fontWeight: 600, color: COLORS.ink },
  grandVal: { fontSize: 11, fontWeight: 900, color: COLORS.ink },
  remainingNote: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "48%",
    marginTop: 4,
  },

  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: GAP_L },
  bankLine: { fontSize: 8, marginBottom: 1.5 },
  note: { marginTop: GAP_S, fontSize: 7.5, color: COLORS.muted },
});

function MetaRow({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <View style={s.metaRow}>
      <Text style={s.metaKey}>{k}</Text>
      <Text style={s.metaVal}>{v}</Text>
    </View>
  );
}

function TotalRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <View style={s.totalRow}>
      <Text style={muted ? s.metaKey : s.strong}>{label}</Text>
      <Text style={muted ? s.metaKey : s.strong}>{value}</Text>
    </View>
  );
}

export default function InvoicePDF({ data }: { data: InvoicePDFData }) {
  const mark = currencyMark(data.currency ?? null);
  const money = (n: number) => `${mark}${formatAmount(Math.abs(Number(n) || 0))}`;
  const isCredit = data.is_credit_note || data.invoice_type === "credit_note";
  const title = data.type_title || data.type_label || "INVOICE";
  const total = Number(data.quotation_total) || 0;
  const amount = Number(data.amount) || 0;
  const freight = Number(data.freight) || 0;
  const deposits = data.deposits ?? [];

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <BrandHeader />
        {/* Big, unambiguous invoice-type title. */}
        <DocTitle
          title={title}
          reference={data.accounting_number}
          caption={`Commercial file ${data.commercial_number}`}
        />
        <Rule />

        {/* PARTIES + META */}
        <View style={s.parties}>
          <View style={s.col}>
            <Text style={s.eyebrow}>Bill to</Text>
            {data.client ? (
              <>
                <Text style={s.strong}>{data.client.company_name}</Text>
                {data.client.contact_name ? <Text>{data.client.contact_name}</Text> : null}
                {data.client.address ? <Text>{data.client.address}</Text> : null}
                {data.client.country ? <Text>{data.client.country}</Text> : null}
                {data.client.email ? <Text>{data.client.email}</Text> : null}
                {data.client.vat_number ? <Text>VAT: {data.client.vat_number}</Text> : null}
              </>
            ) : (
              <Text style={{ color: COLORS.muted }}>—</Text>
            )}
          </View>
          <View style={s.col}>
            <MetaRow k="Invoice date" v={new Date(data.date).toLocaleDateString("en-GB")} />
            <MetaRow
              k="Due date"
              v={data.due_date ? new Date(data.due_date).toLocaleDateString("en-GB") : null}
            />
            <MetaRow k="Accounting no." v={data.accounting_number} />
            <MetaRow k="Commercial file" v={data.commercial_number} />
            <MetaRow k="Quotation" v={data.source_number} />
            <MetaRow k="Order" v={data.order_number} />
            <MetaRow k="Currency" v={data.currency ?? null} />
          </View>
        </View>

        {/* PRODUCT TABLE — always the full quotation lines. */}
        <View style={s.tableHead}>
          <Text style={[s.th, s.cDesc]}>Description</Text>
          <Text style={[s.th, s.cRef]}>Reference</Text>
          <Text style={[s.th, s.cQty]}>Qty</Text>
          <Text style={[s.th, s.cUnit]}>Unit price</Text>
          <Text style={[s.th, s.cTot]}>Line total</Text>
        </View>
        {data.lines.length === 0 ? (
          <View style={s.row}>
            <Text style={[s.cDesc, { color: COLORS.muted }]}>No product lines.</Text>
          </View>
        ) : (
          data.lines.map((l, i) => (
            <View key={i} style={s.row} wrap={false}>
              <View style={s.cDesc}>
                <Text style={s.strong}>{l.product_name}</Text>
                {l.spec ? <Text style={s.specLine}>{l.spec}</Text> : null}
              </View>
              <Text style={s.cRef}>{l.client_reference ?? ""}</Text>
              <Text style={s.cQty}>{l.quantity}</Text>
              <Text style={s.cUnit}>{money(l.unit_price)}</Text>
              <Text style={s.cTot}>{money(l.line_total)}</Text>
            </View>
          ))
        )}

        {/* PAYMENT SUMMARY — the ONLY part that differs by invoice type. */}
        <View style={s.totals}>
          {data.invoice_type === "deposit" && (
            <>
              <TotalRow label="Subtotal" value={money(total)} muted />
              <TotalRow
                label={`Deposit${data.percent ? ` (${data.percent}%)` : ""}`}
                value={money(amount)}
              />
              <View style={s.grand}>
                <Text style={s.grandLabel}>Amount Due</Text>
                <Text style={s.grandVal}>{money(amount)}</Text>
              </View>
              {typeof data.remaining_after === "number" && (
                <View style={s.remainingNote}>
                  <Text style={s.metaKey}>Remaining balance</Text>
                  <Text style={s.metaKey}>{money(data.remaining_after)}</Text>
                </View>
              )}
            </>
          )}

          {data.invoice_type === "balance" && (
            <>
              <TotalRow label="Quotation Total" value={money(total)} muted />
              {deposits.length > 0 ? (
                deposits.map((d, i) => (
                  <TotalRow
                    key={i}
                    label={`Less Deposit Invoice ${d.accounting_number}`}
                    value={`-${money(d.amount)}`}
                    muted
                  />
                ))
              ) : (
                <TotalRow label="Less deposits invoiced" value={`-${money(total - amount)}`} muted />
              )}
              <View style={s.grand}>
                <Text style={s.grandLabel}>Balance Due</Text>
                <Text style={s.grandVal}>{money(amount)}</Text>
              </View>
            </>
          )}

          {(data.invoice_type === "full" || data.invoice_type === "custom") && (
            <>
              <TotalRow label="Subtotal" value={money(data.items_subtotal)} muted />
              {freight > 0 && <TotalRow label="Freight" value={money(freight)} muted />}
              {data.invoice_type === "custom" && Math.abs(amount - total) > 0.005 && (
                <TotalRow label="This invoice" value={money(amount)} />
              )}
              <View style={s.grand}>
                <Text style={s.grandLabel}>{data.invoice_type === "custom" ? "Amount Due" : "Total Due"}</Text>
                <Text style={s.grandVal}>{money(amount)}</Text>
              </View>
              {data.invoice_type === "custom" && typeof data.remaining_after === "number" && (
                <View style={s.remainingNote}>
                  <Text style={s.metaKey}>Remaining balance</Text>
                  <Text style={s.metaKey}>{money(data.remaining_after)}</Text>
                </View>
              )}
            </>
          )}

          {isCredit && (
            <>
              <TotalRow label="Subtotal" value={money(amount)} muted />
              <View style={s.grand}>
                <Text style={s.grandLabel}>Credit Total</Text>
                <Text style={s.grandVal}>-{money(amount)}</Text>
              </View>
            </>
          )}
        </View>

        {/* FOOTER — payment terms + bank. */}
        <View style={s.footer}>
          <View style={s.col}>
            {data.payment_terms_label ? (
              <>
                <SectionHeader>Payment terms</SectionHeader>
                <Text style={{ fontSize: 8 }}>{data.payment_terms_label}</Text>
                {data.due_date ? (
                  <Text style={{ fontSize: 8, marginTop: 2 }}>
                    Payment due by {new Date(data.due_date).toLocaleDateString("en-GB")}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
          <View style={s.col}>
            {data.bank ? (
              <>
                <SectionHeader>Banking information</SectionHeader>
                {data.bank.business_account_name || data.bank.account_name ? (
                  <Text style={[s.bankLine, s.strong]}>
                    {data.bank.business_account_name || data.bank.account_name}
                  </Text>
                ) : null}
                {data.bank.bank_name ? <Text style={s.bankLine}>{data.bank.bank_name}</Text> : null}
                {data.bank.account_number ? (
                  <Text style={s.bankLine}>Account: {data.bank.account_number}</Text>
                ) : null}
                {data.bank.swift ? <Text style={s.bankLine}>SWIFT: {data.bank.swift}</Text> : null}
              </>
            ) : null}
          </View>
        </View>

        <Text style={s.note}>
          This invoice is part of commercial file {data.commercial_number}. Accounting number{" "}
          {data.accounting_number} is unique and legally binding.
        </Text>
      </Page>
    </Document>
  );
}
