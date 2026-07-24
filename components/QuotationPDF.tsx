"use client";

/**
 * Proforma / Quotation PDF — matches the designer's brand reference.
 *
 * Layout reference (per `SLX INVOICE.v3.pdf` annotations):
 *   Margins      : 1.2 cm all sides
 *   Header       : logo (5.181 × 1.2 cm) left + company contact right
 *                  1 cm gap below header
 *   Title        : 14 pt Akzidenz-Grotesk BQ Light Extended, centered
 *                  "PROFORMA INVOICE <NUMBER>" or "QUOTATION <NUMBER>"
 *   Meta rows    : Date / Invoice Number — right-aligned (0.5 cm gap)
 *   Party blocks : Attention/Company/… left  ·  Incoterm/Ports/… right
 *   Terms strip  : Estimated Production Date · Payment Terms (full width)
 *   Table        : Description · Client Reference · Qty · Unit Price · Total
 *                  (hair-line top + bottom borders, SLX gray #DCDDE1)
 *   Sub-totals   : Sub-Total FOB <port> · Transportation row · Total CFR <port>
 *   Footer       : CONDITIONS (left) · SALES CONDITIONS (right)
 *                  BANKING INFORMATION under CONDITIONS
 *
 * Type sizes
 *   Body          8 pt  Armin Grotesk (UltraLight for values, Regular for labels)
 *   Title        14 pt  Akzidenz-Grotesk BQ Light Extended
 *   Footer hdr   10 pt  Akzidenz-Grotesk BQ Light Extended
 *   Footer body   7 pt  Armin Grotesk UltraLight
 *
 * Fonts ship-state
 *   Armin Grotesk + Akzidenz-Grotesk BQ Light Extended are paid faces;
 *   user drops the .ttf files in `public/fonts/`. If absent,
 *   @react-pdf/renderer falls back to Helvetica silently — the PDF
 *   still generates, just looks plainer. See public/fonts/README.md.
 *
 * Multi-page behavior
 *   `<Page>` flows naturally. Each table row sets `wrap={false}` so a
 *   row never splits across page boundaries. The footer (conditions +
 *   banking) goes AFTER the table, so it pushes to a new page only if
 *   the table is long enough to overflow.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

import {
  containerLineTotal,
  formatOfferValidity,
  formatProductionTime,
  formatProductionTimeForPDF,
  formatWarrantyYears,
  totalFreight,
} from "@/lib/logistics";
import { formatPaymentTerms } from "@/lib/payment";
// Shared SOLUX document design system — grid, palette, fonts, masthead +
// money helpers. Single source of truth across every generated PDF.
import {
  CM,
  M_OUT,
  GAP_S,
  GAP_M,
  GAP_L,
  COLORS,
  F,
  formatAmount,
  currencyMark,
  BrandHeader,
} from "@/components/pdf/theme";
import type {
  BankAccount,
  ClientCustomField,
  Currency,
  DocumentContainer,
  PaymentMode,
  PaymentTerms,
  ProductionTime,
  SalesCondition,
} from "@/lib/types";

/* ===========================================================================
   Data contract — additive over the previous shape so callers can migrate
   incrementally. New optional fields: attention_to, client.address,
   client.vat_number.
   =========================================================================== */
export type QuotationPDFData = {
  number: string | null;
  type: "quotation" | "proforma";
  date: string;
  incoterm: string | null;
  currency?: Currency;
  freight_type: string | null;
  freight_cost: number;
  // m146 — logistics extras. Insurance = single amount; additional_charges =
  // repeatable {label, amount} rows (ECTN, BESC, FERI, inspection…).
  insurance_cost?: number | null;
  additional_charges?: { label: string; amount: number }[];
  port_of_loading?: string | null;
  port_of_destination?: string | null;
  containers?: DocumentContainer[];
  production_time?: ProductionTime | null;
  bank_account?: BankAccount | null;
  sales_conditions?: SalesCondition | null;
  purchase_order_number?: string | null;
  commission_amount?: number;
  commission_visible?: boolean;
  commission_description?: string | null;
  client_custom_fields?: ClientCustomField[];
  total_price: number;
  payment_label?: string | null;
  payment_mode?: PaymentMode | null;
  payment_terms?: PaymentTerms | null;
  /** Per-document override; falls back to client.default_attention_to. */
  attention_to?: string | null;
  /** Sales Terms — warranty years (3 / 5 / 10 / custom). */
  warranty_years?: number | null;
  /** Sales Terms — days the product pricing remains binding. */
  offer_validity_products_days?: number | null;
  /** Sales Terms — days the transport pricing remains binding. */
  offer_validity_transport_days?: number | null;
  client: {
    company_name: string;
    contact_name: string | null;
    email: string | null;
    phone_number?: string | null;
    country: string | null;
    /** Full multi-line address (free-form, may include several lines). */
    address?: string | null;
    /** Tax / VAT registration number. */
    vat_number?: string | null;
    /** Default attention-to (used when doc-level override is missing). */
    default_attention_to?: string | null;
  } | null;
  lines: Array<{
    /** Internal product name. */
    product_name: string;
    /** Optional client-facing alias / reference (e.g. SOL-UK-250518-001). */
    client_product_name?: string | null;
    category: string | null;
    selected_options: Record<string, string>;
    /**
     * Customer-facing configuration fields to render under the
     * product name (CCT, Optic, Bracket dimension, Solar panel,
     * etc.). The CALLER is responsible for filtering this list down
     * to fields where `config_fields.visible_in_quotation = true`
     * AND `internal_only = false`. The PDF just renders what it
     * receives — keeps presentation dumb and easy to test.
     *
     * Backwards-compat: if this is undefined or empty, the PDF falls
     * back to listing values from `selected_options` (legacy path).
     */
    visible_config_fields?: Array<{ field_name: string; value: string }>;
    /**
     * m177 — the frozen spec-version label for this line ("2604"), rendered
     * under the product name as "Spec 2604". Proves which spec revision the
     * client was quoted. Optional/back-compat: undefined prints nothing.
     */
    spec_label?: string | null;
    quantity: number;
    unit_price: number;
    total_price: number;
    pricing_mode: "auto" | "manual";
    pricing_tier?: "high" | "medium" | "low" | null;
    original_unit_price?: number | null;
    discount_type?: "percentage" | "fixed" | null;
    discount_value?: number;
  }>;
};

/* ===========================================================================
   Layout constants (CM / margins / gaps), the SOLUX palette, the brand
   fonts (F) and the money helpers all come from the shared design system in
   `components/pdf/theme`. Re-using them here keeps the quotation, invoice and
   factory documents pixel-consistent.
   =========================================================================== */

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

  /* ----- HEADER: logo + company contact -----
     The masthead now lives in the shared `BrandHeader` (components/pdf/
     theme) so every SOLUX document uses an identical header. */

  /* ----- TITLE row -----
     Structure REVERTED to the original designer reference: a row
     View hosting TWO separate `<Text>` nodes, the number offset via
     `marginLeft` (NOT `gap` — gap proved unreliable in @react-pdf,
     and single-Text concatenation also failed to render the number
     in some cases). Two siblings with explicit margin is the most
     battle-tested combination for inline title + reference. */
  titleWrap: {
    marginTop: GAP_L,
    alignItems: "center",
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "baseline",
  },
  // Two-Text title — the original designer reference pattern.
  // Diagnostic confirmed the issue was NEVER rendering — it was data:
  // the preview path passed `number: null` because the doc isn't
  // saved yet. With the form now pre-fetching `next_client_document_number`,
  // both preview and saved-doc paths feed a real string in.
  //
  // Styling differentiation:
  //   docTitle  — Akzidenz BQ Light Extended, premium wide tracking
  //   docNumber — body face SemiBold for the data emphasis the user
  //               asked for, marginLeft to separate the two visually
  docTitle: {
    fontFamily: F.title,
    fontWeight: 300,
    fontSize: 14,
    letterSpacing: 1.5,
    color: COLORS.ink,
    textTransform: "uppercase",
  },
  // Number rendered in Armin Grotesk Black (weight 900) — punchier
  // than the previous SemiBold 600 so the reference truly anchors the
  // title visually. Letter-spacing trimmed to 0.4 because Black has
  // already heavier strokes; combined with wide tracking the number
  // would otherwise feel over-emphasized.
  docNumber: {
    fontFamily: F.body,
    fontWeight: 900,
    fontSize: 14,
    letterSpacing: 0.4,
    marginLeft: 14,
    color: COLORS.ink,
  },

  /* ----- META (Date / Invoice Number) ----- */
  metaWrap: { marginTop: GAP_S, alignItems: "flex-end" },
  metaLine: { flexDirection: "row", marginBottom: 1 },
  metaLabel: {
    fontSize: 8,
    fontWeight: 400,
    color: COLORS.ink,
    width: 95,
  },
  metaSep: { fontSize: 8, fontWeight: 400, color: COLORS.ink, width: 10 },
  metaValue: { fontSize: 8, fontWeight: 200, color: COLORS.body },

  /* ----- PARTY block (Company/Attention/… vs Date/Incoterm/Port/…) -----
     Since the MetaBlock was removed and Date moved into the right
     column here, the party row sits directly below the title. Bumped
     the top margin to GAP_M so the title gets enough breathing room
     and the page doesn't feel cramped. */
  partyRow: {
    flexDirection: "row",
    marginTop: GAP_M,
    gap: 24,
  },
  partyCol: { flex: 1 },
  fieldRow: { flexDirection: "row", marginBottom: 1.5 },
  fieldLabel: {
    fontSize: 8,
    fontWeight: 400,
    color: COLORS.ink,
    width: 90,
  },
  fieldSep: { fontSize: 8, fontWeight: 400, color: COLORS.ink, width: 10 },
  fieldValue: {
    fontSize: 8,
    fontWeight: 200,
    color: COLORS.body,
    flex: 1,
  },

  /* ----- Hair-line separators ----- */
  rule: {
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hair,
    marginTop: GAP_S,
    marginBottom: GAP_S,
  },

  /* ----- SALES TERMS section ----- */
  // Eyebrow header — same family + tracking as the footer headers
  // (Conditions / Sales Conditions / Banking) so the section reads
  // as a peer.
  //
  // Letter-spacing kept tight (0.4 instead of 1) because Akzidenz BQ
  // Light Extended is ALREADY a wide face — combining it with heavy
  // tracking caused react-pdf to mis-measure the text width and break
  // headers like "CONDITIONS" mid-word ("CONDITIO NS"). The narrow
  // tracking keeps the premium air without triggering the wrap bug.
  salesTermsHeader: {
    fontFamily: F.title,
    fontWeight: 300,
    fontSize: 10,
    color: COLORS.ink,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  termsRow: { flexDirection: "row", marginBottom: 2 },
  termsLabel: {
    fontSize: 8,
    fontWeight: 400,
    color: COLORS.ink,
    width: 180,
  },
  termsSep: { fontSize: 8, fontWeight: 400, color: COLORS.ink, width: 10 },
  termsValue: {
    fontSize: 8,
    fontWeight: 200,
    color: COLORS.body,
    flex: 1,
  },

  /* ----- TABLE -----
     Header row uses the SLX gray as a subtle backplate — premium look,
     anchors the column structure visually without becoming heavy. The
     same hair-line color is also used for the row separators so the
     palette stays disciplined. */
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
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  tableBodyCell: { fontSize: 8, fontWeight: 200, color: COLORS.body },

  /* Column widths — 5 cols, sums to 1.0 of available width.
     Description gets the lion's share because the line below it
     ("Battery 18Ah · 2800K · 76mm tube" etc.) needs room. */
  colDescription: { flex: 2.6, paddingRight: 8 },
  colClientRef: { flex: 1.3, paddingRight: 8 },
  colQty: { flex: 0.55, paddingRight: 8, textAlign: "right" },
  colUnit: { flex: 1.1, paddingRight: 4 },
  colTotal: { flex: 1.2 },

  /* Two-text Unit Price / Total cells: "US$  XXX.XX" with currency
     hugging the left edge and the amount right-aligned in the cell. */
  moneyCell: { flexDirection: "row", justifyContent: "flex-end" },
  moneyCurrency: {
    fontSize: 8,
    fontWeight: 200,
    color: COLORS.body,
    marginRight: 10,
  },
  moneyAmount: { fontSize: 8, fontWeight: 200, color: COLORS.body },

  /* Description sub-line (compact second line under the primary product
     name — used for spec strings like "Battery 18Ah · 2800K · 76mm…"). */
  descPrimary: { fontSize: 8, fontWeight: 400, color: COLORS.ink },
  descSecondary: {
    fontSize: 8,
    fontWeight: 200,
    color: COLORS.body,
    marginTop: 1,
  },

  /* Sub-total rows (Sub-Total FOB / Total CFR) */
  subtotalRow: {
    flexDirection: "row",
    borderTopWidth: 0.5,
    borderTopColor: COLORS.hair,
    paddingTop: 6,
    paddingBottom: 4,
    marginTop: 4,
  },
  subtotalLabel: {
    fontSize: 8,
    fontWeight: 600,
    color: COLORS.ink,
  },
  totalRow: {
    flexDirection: "row",
    paddingTop: 6,
    paddingBottom: 4,
  },
  totalLabel: { fontSize: 8, fontWeight: 600, color: COLORS.ink },

  /* ----- FOOTER (Conditions / Sales Conditions / Banking) ----- */
  footerWrap: {
    marginTop: GAP_L,
    paddingTop: GAP_S,
  },
  footerRow: {
    flexDirection: "row",
    gap: 24,
  },
  footerCol: { flex: 1 },
  // Same rationale as salesTermsHeader: tight tracking on Akzidenz
  // Light Extended to avoid mid-word break on "CONDITIONS" /
  // "SALES CONDITIONS" / "BANKING INFORMATION".
  footerHeader: {
    fontFamily: F.title,
    fontWeight: 300,
    fontSize: 10,
    color: COLORS.ink,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  footerListItem: {
    flexDirection: "row",
    marginBottom: 2,
  },
  footerListIndex: {
    fontSize: 7,
    fontWeight: 200,
    color: COLORS.body,
    width: 12,
  },
  footerListText: {
    fontSize: 7,
    fontWeight: 200,
    color: COLORS.body,
    flex: 1,
    lineHeight: 1.45,
  },
  bankBlock: { marginTop: GAP_M },
  // Used when Banking sits below Sales Terms in the left footer
  // column — gives a clear breathing room between the two blocks so
  // their headers don't visually merge.
  bankBlockSpacer: { marginTop: GAP_M },
  bankLine: { flexDirection: "row", marginBottom: 1 },
  bankLabel: {
    fontSize: 7,
    fontWeight: 400,
    color: COLORS.ink,
  },
  bankSep: { fontSize: 7, fontWeight: 400, color: COLORS.ink, width: 6 },
  bankValue: {
    fontSize: 7,
    fontWeight: 200,
    color: COLORS.body,
    flex: 1,
  },
});

/* ===========================================================================
   Helpers
   =========================================================================== */

/** Resolve the "Attention to" line per the documented fallback chain. */
function resolveAttentionTo(data: QuotationPDFData): string {
  const docOverride = (data.attention_to ?? "").trim();
  if (docOverride) return docOverride;
  const clientDefault = (data.client?.default_attention_to ?? "").trim();
  if (clientDefault) return clientDefault;
  return "Purchasing Department";
}

/** Build the "CONDITIONS" footer column as a numbered list automatically
 *  derived from the document's fields. Each entry returns null when there
 *  is no data — we filter them out so the column doesn't show stub rows. */
function composeConditions(data: QuotationPDFData): string[] {
  const lines: string[] = [];

  // 1. Payment terms — render via the canonical formatter so the wording
  // matches what the rest of the app shows.
  const paymentLabel =
    formatPaymentTerms(
      data.payment_mode ?? null,
      data.payment_terms ?? null
    ) ||
    data.payment_label ||
    null;
  if (paymentLabel) {
    lines.push(`Conditions de paiement : ${paymentLabel}.`);
  }

  // 2. Production time.
  const prodTime = formatProductionTime(data.production_time ?? null);
  if (prodTime) {
    lines.push(`Délai de production : ${prodTime}.`);
  }

  // 3-5. Static lines we'll later wire to a settings table; keep them here
  // so the footer reads like the designer's reference even on day one.
  // Sales can override via the document's sales_conditions if needed.
  lines.push("Validité de l'offre : 30 jours à compter de la date d'émission.");
  lines.push(
    "Le prix du transport sera ajusté en fonction du prix du marché au moment de l'expédition."
  );

  return lines;
}

/** Split the sales_conditions content (a single text blob) into individual
 *  numbered items. We detect leading "1. " markers; if the text isn't
 *  numbered we return it as a single block. */
function splitNumberedConditions(content: string | null | undefined): string[] {
  if (!content) return [];
  const trimmed = content.trim();
  // Match "1. blah\n2. blah" patterns.
  const items = trimmed
    .split(/\n(?=\s*\d+[.)]\s)/g)
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
  return items.length > 0 ? items : [trimmed];
}

/* ===========================================================================
   Sub-components — keep the main render tidy
   =========================================================================== */

function TitleBlock({ data }: { data: QuotationPDFData }) {
  const docLabel = data.type === "proforma" ? "PROFORMA INVOICE" : "QUOTATION";
  const numberRaw = data.number ?? "";
  const number = typeof numberRaw === "string" ? numberRaw.trim() : "";
  // Original designer reference structure: two sibling <Text> nodes in
  // a centred row. The number Text carries its own marginLeft so it
  // sits next to the label with a fixed gap. No `gap`, no nested
  // Text, no conditional inside text run — those approaches all kept
  // hiding the number, until we discovered the actual cause was the
  // FORM PREVIEW passing `number: null` because the doc wasn't saved.
  return (
    <View style={s.titleWrap} wrap={false}>
      <View style={s.titleRow}>
        <Text style={s.docTitle}>{docLabel}</Text>
        {number ? <Text style={s.docNumber}>{number}</Text> : null}
      </View>
    </View>
  );
}

// MetaBlock (Date + Customer PO standalone strip) intentionally
// deleted — those fields are now rendered inside the right column of
// PartyBlock so they share the exact alignment grid as Incoterm /
// Ports / Currency. Removing the function entirely (vs leaving it
// dormant) guarantees a future edit can't accidentally render it
// again from cached layout knowledge.

function PartyBlock({ data }: { data: QuotationPDFData }) {
  const c = data.client;
  // VAT is OPTIONAL by design — many B2B clients (especially outside
  // the EU) don't have one. The PDF reads cleaner when the row is
  // omitted entirely instead of showing an empty value or a dash, so
  // we render the row only when the field is filled. Same idea applies
  // to the address block below (already conditional).
  const vatNumber = c?.vat_number?.trim() || null;
  return (
    <View style={s.partyRow}>
      {/* Left: customer identity.
          Order: Company → Attention to → Contact Person → Email →
          Country → VAT Number (optional) → Address (optional).
          Company comes first because it's the primary identifier on
          export documents; "Attention to" is the recipient role. */}
      <View style={s.partyCol}>
        <PartyField label="Company" value={c?.company_name ?? "—"} />
        <PartyField label="Attention to" value={resolveAttentionTo(data)} />
        <PartyField label="Contact Person" value={c?.contact_name ?? null} />
        <PartyField label="Email" value={c?.email ?? null} />
        <PartyField label="Country" value={c?.country ?? null} />
        {vatNumber && <PartyField label="VAT Number" value={vatNumber} />}
        {c?.address && (
          <View style={[s.fieldRow, { marginTop: 4 }]}>
            <Text style={s.fieldLabel}>Address</Text>
            <Text style={s.fieldSep}>:</Text>
            <Text style={s.fieldValue}>{c.address}</Text>
          </View>
        )}
      </View>
      {/* Right: shipping / commercial terms */}
      <View style={s.partyCol}>
        {/* Date + Customer PO now live INSIDE the right party column
            so they share the exact same label / colon / value column
            system as Incoterm and the ports below — the previous
            stand-alone MetaBlock used a slightly different geometry
            (label width 95 vs 90 here) and ended up looking floaty.
            One PartyField geometry rules the whole right block. */}
        <PartyField
          label="Date"
          value={new Date(data.date).toLocaleDateString("en-GB")}
        />
        {data.purchase_order_number && (
          <PartyField
            label="Customer PO"
            value={data.purchase_order_number}
          />
        )}
        <PartyField
          label="Incoterm"
          value={
            data.incoterm
              ? `${data.incoterm}${
                  data.port_of_loading ? " " + data.port_of_loading : ""
                }`
              : null
          }
        />
        <PartyField label="Port of Loading" value={data.port_of_loading} />
        <PartyField
          label="Port of Destination"
          value={data.port_of_destination}
        />
        <PartyField label="Currency" value={data.currency ?? null} />
      </View>
    </View>
  );
}

function PartyField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldSep}>:</Text>
      <Text style={s.fieldValue}>
        {value && String(value).trim() !== "" ? value : "—"}
      </Text>
    </View>
  );
}

/**
 * SALES TERMS — commercial envelope block, rendered inside the footer
 * directly above Banking Information.
 *
 * History
 * -------
 * Previously sat between the party block and the line items, in a
 * larger typographic register. The user requested moving it to the
 * footer (peer of Banking Information) and matching that section's
 * exact typography rhythm so the footer reads as a single coherent
 * "back-matter" zone:
 *
 *   - 10 pt Akzidenz uppercase header (same as Banking)
 *   - 7 pt body rows via the shared `<BankLine>` component
 *   - rows with no value SKIP RENDERING (no "—" filler)
 *
 * Rows (in order — read top-down by a buyer reviewing the offer):
 *   1. Payment Terms
 *   2. Estimated Production Lead Time / Completion (label is dynamic)
 *   3. Warranty
 *   4. Product Offer Validity
 *   5. Freight Offer Validity
 *
 * Using `<BankLine>` directly means missing values collapse the row
 * gracefully — same behaviour as the bank fields and aligned with the
 * user's "no dashes / no placeholders" rule.
 */
function SalesTermsBlock({ data }: { data: QuotationPDFData }) {
  const paymentLabel =
    formatPaymentTerms(
      data.payment_mode ?? null,
      data.payment_terms ?? null
    ) ||
    data.payment_label ||
    null;
  // production: label switches between "Lead Time" (duration) and
  // "Completion" (fixed date) — see formatProductionTimeForPDF.
  const production = formatProductionTimeForPDF(data.production_time ?? null);
  const warrantyLine = formatWarrantyYears(data.warranty_years ?? null);
  const validityProducts = formatOfferValidity(
    data.offer_validity_products_days ?? null,
    "products"
  );
  const validityTransport = formatOfferValidity(
    data.offer_validity_transport_days ?? null,
    "transport"
  );

  return (
    <View wrap={false}>
      <Text style={s.footerHeader} wrap={false}>
        Sales Terms
      </Text>
      <BankLine label="Payment Terms" value={paymentLabel} />
      {production && (
        <BankLine label={production.label} value={production.value} />
      )}
      <BankLine label="Warranty" value={warrantyLine} />
      <BankLine label="Product Offer Validity" value={validityProducts} />
      <BankLine label="Freight Offer Validity" value={validityTransport} />
    </View>
  );
}

function LinesTable({ data }: { data: QuotationPDFData }) {
  const cur = currencyMark(data.currency);
  // Client Reference is a per-line, optional field. Only surface the column
  // header when at least one line actually carries a reference — otherwise the
  // label (and any "—" placeholders) must not appear at all. The column slot
  // itself stays (it doubles as the Sub-Total / Total label slot below), so
  // alignment is unaffected.
  const anyClientRef = data.lines.some(
    (l) => l.client_product_name != null && String(l.client_product_name).trim() !== ""
  );

  /**
   * Description secondary line — surfaces customer-visible product
   * configuration ("CCT 3000K · Optic T2 · Bracket 76mm · Solar
   * panel 80W"). Pre-filtered by the caller to the fields where
   * `visible_in_quotation = true AND internal_only = false`.
   *
   * Fallback: when the caller hasn't built the visible_config_fields
   * array (older code paths, or migrations not yet applied), we fall
   * back to listing values from the legacy `selected_options` blob —
   * unfiltered, just to avoid an empty subline.
   *
   * Format choice: `"<Field> <Value>"` joined by " · " — premium
   * minimalist while still readable. The label provides context so
   * the customer doesn't have to guess that "3000K" means CCT.
   */
  function specSubline(line: QuotationPDFData["lines"][number]): string {
    const visible = line.visible_config_fields;
    if (visible && visible.length > 0) {
      return visible
        .filter((f) => f.value != null && String(f.value).trim() !== "")
        .map((f) => `${f.field_name} ${f.value}`)
        .join(" · ");
    }
    const parts: string[] = [];
    for (const [k, v] of Object.entries(line.selected_options ?? {})) {
      if (v == null || v === "") continue;
      parts.push(`${v}`);
    }
    return parts.join(" · ");
  }

  return (
    <View style={s.table}>
      {/* Header — fixed so it repeats on every page if the table wraps.
          Money column headers right-align so they sit OVER the amount
          column, not over the currency prefix. */}
      <View style={s.tableHead} fixed>
        <Text style={[s.tableHeadCell, s.colDescription]}>Description</Text>
        <Text style={[s.tableHeadCell, s.colClientRef]}>{anyClientRef ? "Client Reference" : ""}</Text>
        <Text style={[s.tableHeadCell, s.colQty]}>Qty</Text>
        <Text style={[s.tableHeadCell, s.colUnit, { textAlign: "right" }]}>
          Unit Price
        </Text>
        <Text style={[s.tableHeadCell, s.colTotal, { textAlign: "right" }]}>
          Total {cur}
        </Text>
      </View>

      {/* Body — each row keeps together (wrap={false}) so multi-line
          descriptions never split mid-row. */}
      {data.lines.map((line, idx) => {
        const sub = specSubline(line);
        return (
          <View key={idx} style={s.tableRow} wrap={false}>
            <View style={s.colDescription}>
              <Text style={s.descPrimary}>{line.product_name}</Text>
              {sub && <Text style={s.descSecondary}>{sub}</Text>}
              {line.spec_label != null &&
                String(line.spec_label).trim() !== "" && (
                  <Text style={s.descSecondary}>Spec {line.spec_label}</Text>
                )}
            </View>
            <View style={s.colClientRef}>
              <Text style={s.tableBodyCell}>
                {line.client_product_name != null &&
                String(line.client_product_name).trim() !== ""
                  ? line.client_product_name
                  : ""}
              </Text>
            </View>
            <View style={s.colQty}>
              <Text style={s.tableBodyCell}>{line.quantity}</Text>
            </View>
            <View style={[s.colUnit, s.moneyCell]}>
              <Text style={s.moneyCurrency}>{cur}</Text>
              <Text style={s.moneyAmount}>{formatAmount(line.unit_price)}</Text>
            </View>
            <View style={[s.colTotal, s.moneyCell]}>
              <Text style={s.moneyCurrency}>{cur}</Text>
              <Text style={s.moneyAmount}>{formatAmount(line.total_price)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function TotalsBlock({ data }: { data: QuotationPDFData }) {
  const cur = currencyMark(data.currency);
  const itemsSubtotal = data.lines.reduce(
    (sum, l) => sum + Number(l.total_price || 0),
    0
  );
  const containers = (data.containers ?? []).filter(
    (c) => Number(c.quantity || 0) > 0
  );
  // Each container row in the data carries qty + unit_price + type, so the
  // transportation rows can render as "Transportation 40HQ · 4 · US$ 4,600 ·
  // US$ 18,400" — matching the reference. We use the per-row line total
  // helper from lib/logistics so the wooden-box surcharge on LCL stays
  // consistent with the rest of the app.
  const freightTotal =
    containers.length > 0
      ? totalFreight(containers)
      : Number(data.freight_cost || 0);
  // m146 — insurance + additional charges are real costs the customer pays,
  // so they DO belong in the CFR/CIF total (unlike the internal commission).
  const insurance = Number(data.insurance_cost || 0);
  const charges = (data.additional_charges ?? []).filter(
    (c) => Number(c.amount) > 0
  );
  const chargesTotal = charges.reduce((s, c) => s + Number(c.amount || 0), 0);
  const grand = itemsSubtotal + freightTotal + insurance + chargesTotal;

  // Port of destination is still used for the grand-total label
  // (e.g. "Total CFR COTONOU"), but the items sub-total now reads
  // simply "Sub-Total" per user direction — the incoterm + port live
  // on the Incoterm row in the party block already, so repeating them
  // here was redundant and noisy.
  const cfrPort = data.port_of_destination
    ? data.port_of_destination.toUpperCase()
    : "";

  return (
    <View wrap={false}>
      {/* Sub-Total — clean label, no port repetition */}
      <View style={s.subtotalRow}>
        <Text style={[s.subtotalLabel, s.colDescription]}> </Text>
        <Text style={[s.subtotalLabel, s.colClientRef]}>Sub-Total</Text>
        <View style={s.colQty} />
        <View style={[s.colUnit, s.moneyCell]}>
          <Text style={s.moneyCurrency}>{cur}</Text>
        </View>
        <View style={[s.colTotal, s.moneyCell]}>
          <Text style={[s.moneyAmount, { fontWeight: 600 }]}>
            {formatAmount(itemsSubtotal)}
          </Text>
        </View>
      </View>

      {/* Transportation rows — one per container booked. We render
          `Transportation <type>` · qty · unit price · total per row so
          the breakdown matches the designer's reference. Fallback to a
          single "Transportation <freight_type>" row when only the
          aggregate freight_cost is known (legacy quotes pre-containers). */}
      {containers.length > 0
        ? containers.map((c, i) => (
            <View key={i} style={s.tableRow}>
              <Text style={[s.tableBodyCell, s.colDescription]}>
                Transportation {c.container_type}
              </Text>
              <View style={s.colClientRef} />
              <Text style={[s.tableBodyCell, s.colQty]}>{c.quantity}</Text>
              <View style={[s.colUnit, s.moneyCell]}>
                <Text style={s.moneyCurrency}>{cur}</Text>
                <Text style={s.moneyAmount}>
                  {formatAmount(Number(c.unit_price ?? 0))}
                </Text>
              </View>
              <View style={[s.colTotal, s.moneyCell]}>
                <Text style={s.moneyCurrency}>{cur}</Text>
                <Text style={s.moneyAmount}>
                  {formatAmount(containerLineTotal(c))}
                </Text>
              </View>
            </View>
          ))
        : freightTotal > 0 && (
            <View style={s.tableRow}>
              <Text style={[s.tableBodyCell, s.colDescription]}>
                Transportation {data.freight_type ?? ""}
              </Text>
              <View style={s.colClientRef} />
              <Text style={[s.tableBodyCell, s.colQty]} />
              <View style={[s.colUnit, s.moneyCell]}>
                <Text style={s.moneyCurrency}>{cur}</Text>
              </View>
              <View style={[s.colTotal, s.moneyCell]}>
                <Text style={s.moneyCurrency}>{cur}</Text>
                <Text style={s.moneyAmount}>{formatAmount(freightTotal)}</Text>
              </View>
            </View>
          )}

      {/* Insurance (m146) */}
      {insurance > 0 && (
        <View style={s.tableRow}>
          <Text style={[s.tableBodyCell, s.colDescription]}>Insurance</Text>
          <View style={s.colClientRef} />
          <Text style={[s.tableBodyCell, s.colQty]} />
          <View style={[s.colUnit, s.moneyCell]}>
            <Text style={s.moneyCurrency}>{cur}</Text>
          </View>
          <View style={[s.colTotal, s.moneyCell]}>
            <Text style={s.moneyCurrency}>{cur}</Text>
            <Text style={s.moneyAmount}>{formatAmount(insurance)}</Text>
          </View>
        </View>
      )}

      {/* Additional charges — one row each (ECTN, BESC, FERI, inspection…) */}
      {charges.map((c, i) => (
        <View key={`ac-${i}`} style={s.tableRow}>
          <Text style={[s.tableBodyCell, s.colDescription]}>
            {c.label || "Additional charge"}
          </Text>
          <View style={s.colClientRef} />
          <Text style={[s.tableBodyCell, s.colQty]} />
          <View style={[s.colUnit, s.moneyCell]}>
            <Text style={s.moneyCurrency}>{cur}</Text>
          </View>
          <View style={[s.colTotal, s.moneyCell]}>
            <Text style={s.moneyCurrency}>{cur}</Text>
            <Text style={s.moneyAmount}>{formatAmount(Number(c.amount))}</Text>
          </View>
        </View>
      ))}

      {/* Total CFR <port> */}
      <View style={s.totalRow}>
        <Text style={[s.totalLabel, s.colDescription]}> </Text>
        <Text style={[s.totalLabel, s.colClientRef]}>
          {cfrPort
            ? `Total ${data.incoterm ?? "CFR"} ${cfrPort}`
            : `Total ${data.incoterm ?? ""}`}
        </Text>
        <View style={s.colQty} />
        <View style={[s.colUnit, s.moneyCell]}>
          <Text style={s.moneyCurrency}>{cur}</Text>
        </View>
        <View style={[s.colTotal, s.moneyCell]}>
          <Text style={[s.moneyAmount, { fontWeight: 600 }]}>
            {formatAmount(grand)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function FooterBlock({ data }: { data: QuotationPDFData }) {
  // The previous auto-composed "Conditions" column duplicated the
  // information now displayed in the SALES TERMS section near the top
  // (payment / production lead time / validity etc.). Removed per user
  // direction — the footer is now a clean two-column split:
  //
  //   Left  : Banking Information (was nested under Conditions)
  //   Right : Sales Conditions (legal / trade terms blurb)
  //
  // This matches the original designer reference where Banking sits
  // on its own as the left column. `composeConditions()` is kept as a
  // helper in the codebase in case a future legal/regulatory layout
  // wants it back.
  const sales = splitNumberedConditions(data.sales_conditions?.content ?? null);
  const bank = data.bank_account;

  return (
    <View style={s.footerWrap} wrap={false}>
      <View style={s.footerRow}>
        {/* LEFT COLUMN — Sales Terms (commercial envelope) above
            Banking Information (wire details). Stacked vertically
            inside a single column so they share the same typographic
            register (10 pt Akzidenz header, 7 pt body rows). */}
        <View style={s.footerCol}>
          <SalesTermsBlock data={data} />

          {bank && (
            <View style={s.bankBlockSpacer}>
              <Text style={s.footerHeader} wrap={false}>
                Banking Information
              </Text>
              {/* `business_account_name` is the legal entity printed on
                  the wire transfer (added in m038). Fall back to the
                  internal `account_name` for legacy bank rows that
                  haven't been edited yet — never expose an empty line. */}
              <BankLine
                label="Business Account Name"
                value={bank.business_account_name ?? bank.account_name}
              />
              <BankLine
                label="Business Account Number"
                value={bank.account_number}
              />
              <BankLine
                label="Beneficiary Bank Name"
                value={bank.bank_name}
              />
              <BankLine
                label="Beneficiary Bank Address"
                value={bank.bank_address}
              />
              <BankLine label="SWIFT" value={bank.swift} />
            </View>
          )}
        </View>

        {/* SALES CONDITIONS (right) */}
        <View style={s.footerCol}>
          <Text style={s.footerHeader} wrap={false}>
            Sales Conditions
          </Text>
          {sales.length === 0 ? (
            <Text style={s.footerListText}>—</Text>
          ) : (
            sales.map((line, i) => (
              <View key={i} style={s.footerListItem}>
                <Text style={s.footerListIndex}>{i + 1}.</Text>
                <Text style={s.footerListText}>{line}</Text>
              </View>
            ))
          )}
        </View>
      </View>
    </View>
  );
}

function BankLine({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <View style={s.bankLine}>
      <Text style={s.bankLabel}>{label}</Text>
      <Text style={s.bankSep}> : </Text>
      <Text style={s.bankValue}>{value}</Text>
    </View>
  );
}

/* ===========================================================================
   Root document
   =========================================================================== */
export default function QuotationPDF({ data }: { data: QuotationPDFData }) {
  return (
    <Document>
      <Page size="A4" style={s.page} wrap>
        <BrandHeader />
        <TitleBlock data={data} />
        {/* Date + Customer PO live INSIDE PartyBlock's right column
            (alignment grid match with Incoterm / Ports / Currency).
            No standalone meta strip here. */}
        <PartyBlock data={data} />
        <View style={s.rule} />
        {/* SalesTermsBlock used to sit here — moved into FooterBlock
            (left column, above Banking) so it reads as a peer of the
            other back-matter sections. The line items table now
            follows the party block directly. */}
        <LinesTable data={data} />
        <TotalsBlock data={data} />
        <FooterBlock data={data} />
      </Page>
    </Document>
  );
}
