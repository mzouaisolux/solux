"use client";

/**
 * Commercial Invoice PDF — an EXPORT SHIPPING DOCUMENT (m115).
 *
 * Owner decision (2026-06-12): the Commercial Invoice is NOT an
 * accounting object. It is generated when the shipment is prepared and
 * belongs to the order's shipping-documents package. Its audience is
 * customs, the importer, the freight forwarder and the bank (LC
 * negotiation) — which dictates the content: parties (shipper /
 * consignee / notify), shipment routing (incoterm, ports, vessel, B/L),
 * goods with values, weights/packages, origin, banking details and a
 * certification statement.
 *
 * Visual language: built entirely on the shared SOLUX PDF design system
 * (components/pdf/theme) so it is pixel-consistent with the quotation /
 * proforma and factory documents. No new styles beyond layout.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import {
  M_OUT,
  GAP_S,
  GAP_M,
  GAP_L,
  COLORS,
  F,
  formatAmount,
  currencyMark,
  BrandHeader,
  DocTitle,
  Rule,
  SectionHeader,
} from "@/components/pdf/theme";
import type { BankAccount, Currency } from "@/lib/types";

/* ===========================================================================
   Data contract — assembled server-side on the production-order page from
   the won proforma (lines, ports, PO number, bank), the client BL profile
   (parties) and the order's shipping details (vessel, B/L, weights).
   =========================================================================== */
export type CommercialInvoicePDFData = {
  ci_number: string;
  /** Issue date, YYYY-MM-DD. */
  date: string;
  /** Internal production-order reference (PO-…). */
  order_number: string | null;
  /** Source proforma reference. */
  proforma_number: string | null;
  /** The CLIENT's purchase-order number. */
  purchase_order_number: string | null;

  incoterm: string | null;
  port_of_loading: string | null;
  port_of_destination: string | null;
  country_of_origin: string;
  payment_label: string | null;
  currency?: Currency;

  shipper: {
    company_name: string | null;
    address: string | null;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
  };
  consignee: {
    company_name: string | null;
    address: string | null;
    country: string | null;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    tax_id: string | null;
  } | null;
  notify: {
    company_name: string | null;
    address: string | null;
    country: string | null;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
  } | null;

  shipping: {
    bl_number: string | null;
    vessel: string | null;
    voyage: string | null;
    forwarder: string | null;
    etd: string | null;
    hs_code: string | null;
    packages: string | null;
    gross_weight: string | null;
    net_weight: string | null;
    cbm: string | null;
  };

  lines: Array<{
    description: string;
    client_ref?: string | null;
    quantity: number;
    unit_price: number;
    total_price: number;
  }>;
  /** Freight & packing shown as its own value line when > 0 (CFR/CIF). */
  freight_amount: number;
  total_amount: number;

  bank?: BankAccount | null;
};

const s = StyleSheet.create({
  page: {
    paddingTop: M_OUT,
    paddingBottom: M_OUT,
    paddingHorizontal: M_OUT,
    fontFamily: F.body,
    fontWeight: 200,
    fontSize: 8,
    color: COLORS.body,
    lineHeight: 1.45,
  },

  /* Meta (Date / references) — right aligned, mirrors the proforma. */
  metaWrap: { marginTop: GAP_S, alignItems: "flex-end" },
  metaLine: { flexDirection: "row", marginBottom: 1 },
  metaLabel: { fontSize: 8, fontWeight: 400, color: COLORS.ink, width: 95 },
  metaSep: { fontSize: 8, fontWeight: 400, color: COLORS.ink, width: 10 },
  metaValue: { fontSize: 8, fontWeight: 200, color: COLORS.body },

  /* Parties — three columns: shipper / consignee / notify. */
  partyRow: { flexDirection: "row", marginTop: GAP_M, gap: 18 },
  partyCol: { flex: 1 },
  partyName: { fontSize: 8, fontWeight: 600, color: COLORS.ink, marginBottom: 1 },
  partyLine: { fontSize: 8, fontWeight: 200, color: COLORS.body },

  /* Shipment field grid — two columns of label:value rows. */
  fieldsRow: { flexDirection: "row", gap: 24, marginTop: 2 },
  fieldsCol: { flex: 1 },
  fieldRow: { flexDirection: "row", marginBottom: 1.5 },
  fieldLabel: { fontSize: 8, fontWeight: 400, color: COLORS.ink, width: 90 },
  fieldSep: { fontSize: 8, fontWeight: 400, color: COLORS.ink, width: 10 },
  fieldValue: { fontSize: 8, fontWeight: 200, color: COLORS.body, flex: 1 },

  /* Goods table — same skeleton as the proforma table. */
  table: { marginTop: GAP_S },
  tableHead: {
    flexDirection: "row",
    backgroundColor: COLORS.hair,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  tableHeadCell: {
    fontSize: 8,
    fontWeight: 600,
    color: COLORS.ink,
    textTransform: "uppercase",
    letterSpacing: 0.2,
  },
  tableRow: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 4 },
  rowDivider: { borderTopWidth: 0.5, borderTopColor: COLORS.hair },
  colDescription: { flex: 2.8, paddingRight: 8 },
  colClientRef: { flex: 1.2, paddingRight: 8 },
  colQty: { flex: 0.55, paddingRight: 8, textAlign: "right" },
  colUnit: { flex: 1.1, paddingRight: 4 },
  colTotal: { flex: 1.2 },
  descPrimary: { fontSize: 8, fontWeight: 400, color: COLORS.ink },
  cellText: { fontSize: 8, fontWeight: 200, color: COLORS.body },
  moneyCell: { flexDirection: "row", justifyContent: "flex-end" },
  moneyCurrency: { fontSize: 8, fontWeight: 200, color: COLORS.body, marginRight: 10 },
  moneyAmount: { fontSize: 8, fontWeight: 200, color: COLORS.body },

  subtotalRow: {
    flexDirection: "row",
    borderTopWidth: 0.5,
    borderTopColor: COLORS.hair,
    paddingTop: 6,
    paddingBottom: 4,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  totalLabel: { fontSize: 8, fontWeight: 600, color: COLORS.ink },
  totalMoneyCurrency: { fontSize: 8, fontWeight: 600, color: COLORS.ink, marginRight: 10 },
  totalMoneyAmount: { fontSize: 8, fontWeight: 600, color: COLORS.ink },

  /* Footer: banking + declaration / signature. */
  footerRow: { flexDirection: "row", gap: 24, marginTop: GAP_L },
  footerCol: { flex: 1 },
  bankLine: { flexDirection: "row", marginBottom: 1.5 },
  declarationText: {
    fontSize: 7,
    fontWeight: 200,
    color: COLORS.body,
    lineHeight: 1.5,
  },
  signatureBlock: { marginTop: GAP_M },
  signatureCompany: { fontSize: 8, fontWeight: 600, color: COLORS.ink },
  signatureLine: {
    marginTop: 26,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.ink,
    width: 170,
    paddingTop: 3,
    fontSize: 7,
    fontWeight: 200,
    color: COLORS.body,
  },
});

const dash = (v: string | null | undefined) =>
  v && String(v).trim() ? String(v).trim() : "—";

function Meta({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={s.metaLine}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaSep}>:</Text>
      <Text style={s.metaValue}>{value}</Text>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldSep}>:</Text>
      <Text style={s.fieldValue}>{dash(value)}</Text>
    </View>
  );
}

function Party({
  title,
  name,
  lines,
}: {
  title: string;
  name: string | null | undefined;
  lines: Array<string | null | undefined>;
}) {
  return (
    <View style={s.partyCol}>
      <SectionHeader>{title}</SectionHeader>
      <Text style={s.partyName}>{dash(name)}</Text>
      {lines
        .filter((l): l is string => !!l && !!String(l).trim())
        .map((l, i) => (
          <Text key={i} style={s.partyLine}>
            {l}
          </Text>
        ))}
    </View>
  );
}

export default function CommercialInvoicePDF({
  data,
}: {
  data: CommercialInvoicePDFData;
}) {
  const cur = currencyMark(data.currency);
  // Client Reference column is optional — only show the header when a line
  // actually has one (no label, no "—" when empty).
  const anyClientRef = data.lines.some(
    (l) => l.client_ref != null && String(l.client_ref).trim() !== ""
  );
  const consignee = data.consignee;
  const notify = data.notify;
  const sameNotify =
    !!notify &&
    !!consignee &&
    (notify.company_name ?? "") === (consignee.company_name ?? "");

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <BrandHeader />
        <DocTitle
          title="COMMERCIAL INVOICE"
          reference={data.ci_number}
          caption="EXPORT SHIPPING DOCUMENT"
        />

        <View style={s.metaWrap}>
          <Meta label="Date" value={data.date} />
          <Meta label="Invoice Number" value={data.ci_number} />
          <Meta label="Proforma Ref" value={data.proforma_number} />
          <Meta label="Client PO" value={data.purchase_order_number} />
          <Meta label="Order Ref" value={data.order_number} />
        </View>

        <Rule />

        {/* ----- Parties ----- */}
        <View style={s.partyRow} wrap={false}>
          <Party
            title="Shipper / Exporter"
            name={data.shipper.company_name}
            lines={[
              data.shipper.address,
              data.shipper.contact_person,
              data.shipper.phone,
              data.shipper.email,
            ]}
          />
          <Party
            title="Consignee"
            name={consignee?.company_name}
            lines={[
              consignee?.address,
              consignee?.country,
              consignee?.contact_person,
              consignee?.phone,
              consignee?.tax_id ? `Tax ID: ${consignee.tax_id}` : null,
            ]}
          />
          {sameNotify ? (
            <View style={s.partyCol}>
              <SectionHeader>Notify Party</SectionHeader>
              <Text style={s.partyLine}>Same as consignee</Text>
            </View>
          ) : (
            <Party
              title="Notify Party"
              name={notify?.company_name}
              lines={[
                notify?.address,
                notify?.country,
                notify?.contact_person,
                notify?.phone,
              ]}
            />
          )}
        </View>

        <Rule />

        {/* ----- Shipment details ----- */}
        <SectionHeader>Shipment Details</SectionHeader>
        <View style={s.fieldsRow} wrap={false}>
          <View style={s.fieldsCol}>
            <Field label="Incoterm" value={data.incoterm} />
            <Field label="Port of Loading" value={data.port_of_loading} />
            <Field label="Port of Discharge" value={data.port_of_destination} />
            <Field label="Country of Origin" value={data.country_of_origin} />
            <Field label="Payment" value={data.payment_label} />
          </View>
          <View style={s.fieldsCol}>
            <Field
              label="Vessel / Voyage"
              value={
                data.shipping.vessel
                  ? `${data.shipping.vessel}${
                      data.shipping.voyage ? ` / ${data.shipping.voyage}` : ""
                    }`
                  : null
              }
            />
            <Field label="B/L Number" value={data.shipping.bl_number} />
            <Field label="ETD" value={data.shipping.etd} />
            <Field label="HS Code" value={data.shipping.hs_code} />
            <Field label="Forwarder" value={data.shipping.forwarder} />
          </View>
        </View>

        {/* ----- Goods ----- */}
        <View style={s.table}>
          <View style={s.tableHead}>
            <Text style={[s.tableHeadCell, s.colDescription]}>Description of Goods</Text>
            <Text style={[s.tableHeadCell, s.colClientRef]}>{anyClientRef ? "Client Reference" : ""}</Text>
            <Text style={[s.tableHeadCell, s.colQty]}>Qty</Text>
            <Text style={[s.tableHeadCell, s.colUnit]}>Unit Price</Text>
            <Text style={[s.tableHeadCell, s.colTotal]}>Amount</Text>
          </View>
          {data.lines.map((l, i) => (
            <View key={i} style={[s.tableRow, ...(i > 0 ? [s.rowDivider] : [])]} wrap={false}>
              <View style={s.colDescription}>
                <Text style={s.descPrimary}>{l.description}</Text>
              </View>
              <View style={s.colClientRef}>
                <Text style={s.cellText}>
                  {l.client_ref != null && String(l.client_ref).trim() !== ""
                    ? String(l.client_ref).trim()
                    : ""}
                </Text>
              </View>
              <Text style={[s.cellText, s.colQty]}>{l.quantity}</Text>
              <View style={[s.colUnit, s.moneyCell]}>
                <Text style={s.moneyCurrency}>{cur}</Text>
                <Text style={s.moneyAmount}>{formatAmount(l.unit_price)}</Text>
              </View>
              <View style={[s.colTotal, s.moneyCell]}>
                <Text style={s.moneyCurrency}>{cur}</Text>
                <Text style={s.moneyAmount}>{formatAmount(l.total_price)}</Text>
              </View>
            </View>
          ))}

          {data.freight_amount > 0.005 && (
            <View style={s.subtotalRow} wrap={false}>
              <Text style={[s.cellText, { flex: 1 }]}>Freight &amp; packing</Text>
              <View style={s.moneyCell}>
                <Text style={s.moneyCurrency}>{cur}</Text>
                <Text style={s.moneyAmount}>{formatAmount(data.freight_amount)}</Text>
              </View>
            </View>
          )}
          <View style={s.subtotalRow} wrap={false}>
            <Text style={[s.totalLabel, { flex: 1 }]}>
              TOTAL{data.incoterm ? ` ${data.incoterm}` : ""}
              {data.port_of_destination ? ` ${data.port_of_destination}` : ""}
            </Text>
            <View style={s.moneyCell}>
              <Text style={s.totalMoneyCurrency}>{cur}</Text>
              <Text style={s.totalMoneyAmount}>{formatAmount(data.total_amount)}</Text>
            </View>
          </View>
        </View>

        {/* ----- Packing summary ----- */}
        <View style={{ marginTop: GAP_S }} wrap={false}>
          <View style={s.fieldsRow}>
            <View style={s.fieldsCol}>
              <Field label="Packages" value={data.shipping.packages} />
              <Field label="Gross Weight" value={data.shipping.gross_weight} />
            </View>
            <View style={s.fieldsCol}>
              <Field label="Net Weight" value={data.shipping.net_weight} />
              <Field label="Volume (CBM)" value={data.shipping.cbm} />
            </View>
          </View>
        </View>

        {/* ----- Banking + declaration / signature ----- */}
        <View style={s.footerRow} wrap={false}>
          <View style={s.footerCol}>
            {data.bank && (
              <>
                <SectionHeader>Banking Information</SectionHeader>
                <Field
                  label="Beneficiary"
                  value={data.bank.business_account_name ?? data.bank.account_name}
                />
                <Field label="Bank" value={data.bank.bank_name} />
                <Field label="Bank Address" value={data.bank.bank_address} />
                <Field label="Account No" value={data.bank.account_number} />
                <Field label="SWIFT" value={data.bank.swift} />
              </>
            )}
          </View>
          <View style={s.footerCol}>
            <SectionHeader>Declaration</SectionHeader>
            <Text style={s.declarationText}>
              We hereby certify that this commercial invoice is true and
              correct, that it shows the actual price of the goods described,
              and that no other invoice has been or will be issued for the
              same goods. Country of origin: {data.country_of_origin}.
            </Text>
            <View style={s.signatureBlock}>
              <Text style={s.signatureCompany}>
                {dash(data.shipper.company_name)}
              </Text>
              <Text style={s.signatureLine}>Authorized signature &amp; stamp</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
