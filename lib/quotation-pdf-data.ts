/**
 * buildQuotationPdfData — the single source of truth for QuotationPDFData
 * (PRD-006 Phase 2, P2-1).
 *
 * Extracted verbatim from the inline builder in
 * app/(app)/documents/[id]/page.tsx so BOTH the page (client PDF) and the
 * server package assembler (PRD-006 Phase 2 server render) produce a
 * byte-identical document from ONE builder — no second copy to drift.
 *
 * Pure data assembly: no DB, no framework. The caller resolves the inputs
 * (document row, lines with their products join, client extras, freight,
 * currency, the config-visibility map, and the spec-label map) and this maps
 * them to the exact QuotationPDFData shape the PDF component consumes.
 */

// Relative imports (not "@/…") so this pure builder also loads under
// `node --test` (the type-stripping runner doesn't resolve the @/ alias).
// The QuotationPDFData import is type-only, so @react-pdf is never loaded here.
import type { QuotationPDFData } from "../components/QuotationPDF";
import { isCustomPoleConfig } from "./custom-pole.ts";

export type QuotationPdfDataInput = {
  /** The `documents` row. */
  doc: any;
  /** `document_lines` with the `products(name, category, category_id)` join. */
  lines: any[];
  containers: QuotationPDFData["containers"];
  client: QuotationPDFData["client"];
  clientCustomFields: QuotationPDFData["client_custom_fields"];
  /** Freight after the m149 container/legacy resolution. */
  effectiveFreight: number;
  productionTime: QuotationPDFData["production_time"];
  currency: QuotationPDFData["currency"];
  bankAccount: QuotationPDFData["bank_account"];
  /** Already resolved: `showSalesConditions ? salesCondition : null`. */
  salesConditions: QuotationPDFData["sales_conditions"];
  paymentLabel: QuotationPDFData["payment_label"];
  paymentMode: QuotationPDFData["payment_mode"];
  paymentTerms: QuotationPDFData["payment_terms"];
  /** field_name allow-list per category_id (config_fields.visible_in_quotation). */
  allowedFieldsByCategory: Map<string, Set<string>> | null;
  /** spec_version_id → sales label ("2604"), for the frozen-pin subline (m177). */
  specLabelById: Map<string, string>;
};

/** The visible-on-PDF config fields for a line (customer-facing specs only). */
function visibleConfigFor(
  categoryId: string | null,
  configValues: Record<string, unknown> | null,
  allowedFieldsByCategory: Map<string, Set<string>> | null
): Array<{ field_name: string; value: string }> {
  if (!configValues || typeof configValues !== "object") return [];
  // Custom pole lines carry a structured spec (line_type/pole_spec) that is NOT
  // customer config — the description already lives in the line name.
  if (isCustomPoleConfig(configValues)) return [];
  const allowed = categoryId ? allowedFieldsByCategory?.get(categoryId) : null;
  const out: Array<{ field_name: string; value: string }> = [];
  for (const [k, v] of Object.entries(configValues)) {
    if (v == null) continue;
    const str = String(v).trim();
    if (str === "") continue;
    // With a visibility map, skip fields not in it; without one (defensive
    // fallback), show everything so the subline isn't empty.
    if (allowed && !allowed.has(k)) continue;
    out.push({ field_name: k, value: str });
  }
  return out;
}

export function buildQuotationPdfData(
  input: QuotationPdfDataInput
): QuotationPDFData {
  const {
    doc,
    lines,
    containers,
    client,
    clientCustomFields,
    effectiveFreight,
    productionTime,
    currency,
    bankAccount,
    salesConditions,
    paymentLabel,
    paymentMode,
    paymentTerms,
    allowedFieldsByCategory,
    specLabelById,
  } = input;

  const specLabelForLine = (l: any): string | null =>
    l?.spec_version_id ? specLabelById.get(l.spec_version_id) ?? null : null;

  return {
    number: doc.number,
    type: doc.type as "quotation" | "proforma",
    date: doc.date,
    incoterm: doc.incoterm,
    freight_type: doc.freight_type,
    freight_cost: effectiveFreight,
    insurance_cost: Number(doc.insurance_cost || 0),
    additional_charges: Array.isArray(doc.additional_charges)
      ? doc.additional_charges
      : [],
    port_of_loading: doc.port_of_loading ?? null,
    port_of_destination: doc.port_of_destination ?? null,
    containers,
    production_time: productionTime,
    currency,
    bank_account: bankAccount,
    sales_conditions: salesConditions,
    total_price: Number(doc.total_price || 0),
    payment_label: paymentLabel,
    payment_mode: paymentMode,
    payment_terms: paymentTerms,
    attention_to: (doc as any).attention_to ?? null,
    // Sales Terms (m037) — defensive reads; older envs omit these rows.
    warranty_years: (doc as any).warranty_years ?? null,
    offer_validity_products_days:
      (doc as any).offer_validity_products_days ?? null,
    offer_validity_transport_days:
      (doc as any).offer_validity_transport_days ?? null,
    client,
    lines: (lines ?? []).map((l: any) => ({
      // Internal product name is always primary; falls back to the line's own
      // snapshot (m089), then to client_product_name for a free-text line.
      product_name:
        l.products?.name ??
        l.product_name ??
        (l.client_product_name && String(l.client_product_name).trim()) ??
        "—",
      // Client reference is the secondary alias — suppress it for free-text
      // lines where client_product_name is already the primary name.
      client_product_name:
        l.products?.name || l.product_name
          ? (l.client_product_name && String(l.client_product_name).trim()) ||
            null
          : null,
      category: l.products?.category ?? l.product_category ?? null,
      selected_options: (l.selected_options ?? {}) as Record<string, string>,
      visible_config_fields: visibleConfigFor(
        l.products?.category_id ?? null,
        (l.config_values ?? null) as Record<string, unknown> | null,
        allowedFieldsByCategory
      ),
      quantity: Number(l.quantity || 0),
      unit_price: Number(l.unit_price || 0),
      total_price: Number(l.total_price || 0),
      pricing_mode: l.pricing_mode,
      pricing_tier: l.pricing_tier ?? null,
      original_unit_price:
        l.original_unit_price == null ? null : Number(l.original_unit_price),
      discount_type: l.discount_type ?? null,
      discount_value: Number(l.discount_value || 0),
      // m177 — the frozen spec label, printed under the product on the PDF.
      spec_label: specLabelForLine(l),
    })),
    purchase_order_number: doc.purchase_order_number ?? null,
    commission_amount: doc.show_commission_in_pdf
      ? Number(doc.commission_amount || 0)
      : 0,
    commission_visible: !!doc.show_commission_in_pdf,
    commission_description: doc.commission_description ?? null,
    client_custom_fields: clientCustomFields,
  };
}
