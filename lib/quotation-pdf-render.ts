/**
 * Server-side quotation PDF — load + render (PRD-006 Phase 2, P2-2).
 *
 * SERVER-ONLY (imports @react-pdf). Resolves everything QuotationPDFData needs
 * straight from the DB and renders the quotation PDF with `renderToBuffer`, the
 * same engine `renderSpecSheet` uses. It feeds the package assembler when no
 * quote PDF has been generated yet, so a package can always be built.
 *
 * The PDF-data shape is produced by the SHARED `buildQuotationPdfData` (P2-1),
 * so this server render and the on-page/download PDF can never drift. This
 * module only re-implements the DATA LOADING (queries + freight/payment
 * resolution) that lived inline in the quotation page.
 */

import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import QuotationPDF, { type QuotationPDFData } from "@/components/QuotationPDF";
import { buildQuotationPdfData } from "@/lib/quotation-pdf-data";
import { totalFreight, fromProductionColumns } from "@/lib/logistics";
import { formatPaymentTerms } from "@/lib/payment";
import type { DocumentContainer } from "@/lib/types";
import { buildVersionLabelsForCategories } from "@/features/product-knowledge-hub/lib/versionLabel";

const DOC_SELECT =
  "id, number, type, date, incoterm, freight_type, freight_cost, total_price, pdf_url, payment_mode, payment_terms, port_of_loading, port_of_destination, production_mode, production_days, production_date, currency, include_sales_conditions, purchase_order_number, commission_amount, commission_description, show_commission_in_pdf, client_id, attention_to, warranty_years, offer_validity_products_days, offer_validity_transport_days, insurance_cost, additional_charges, clients(company_name, contact_name, email, phone_number, country, client_code, custom_fields), sales_conditions(id, title, content, is_default), bank_accounts(id, account_name, business_account_name, currency, bank_name, bank_address, account_number, swift, is_default)";
const DOC_SELECT_LEGACY =
  "id, number, type, date, incoterm, freight_type, freight_cost, total_price, pdf_url, payment_mode, payment_terms, port_of_loading, port_of_destination, production_mode, production_days, production_date, currency, include_sales_conditions, purchase_order_number, commission_amount, commission_description, show_commission_in_pdf, client_id, additional_charges, insurance_cost, clients(company_name, contact_name, email, phone_number, country, client_code, custom_fields), sales_conditions(id, title, content, is_default), bank_accounts(id, account_name, currency, bank_name, bank_address, account_number, swift, is_default)";
const LINE_SELECT =
  "id, quantity, selected_options, unit_price, total_price, pricing_mode, pricing_tier, original_unit_price, discount_type, discount_value, client_product_name, config_values, product_id, product_name, product_sku, product_category, spec_version_id, category_id, products(name, category, category_id)";

/** Newest-first families → id→label map, for the frozen-pin subline. */
async function resolveSpecLabels(
  supabase: any,
  lines: any[]
): Promise<Map<string, string>> {
  const cats = Array.from(
    new Set(lines.map((l) => l.category_id ?? l.products?.category_id).filter(Boolean))
  ) as string[];
  if (!cats.length) return new Map();
  const { data: vers } = await supabase
    .from("spec_versions")
    .select("id, category_id, version, published_at")
    .in("category_id", cats);
  return buildVersionLabelsForCategories((vers ?? []) as any[]);
}

/** config_fields allow-list bucketed per category_id (visible, non-internal). */
async function resolveVisibleFields(
  supabase: any
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  const { data } = await supabase
    .from("config_fields")
    .select("field_name, category_id, visible_in_quotation, internal_only, active")
    .eq("visible_in_quotation", true)
    .eq("internal_only", false)
    .eq("active", true);
  for (const f of (data ?? []) as any[]) {
    const cat = f.category_id as string | null;
    const name = f.field_name as string | null;
    if (!cat || !name) continue;
    if (!map.has(cat)) map.set(cat, new Set());
    map.get(cat)!.add(name);
  }
  return map;
}

/**
 * Resolve QuotationPDFData for a document straight from the DB, deferring the
 * shaping to the shared builder. Returns null if the document is gone.
 */
export async function loadQuotationPdfData(
  supabase: any,
  documentId: string
): Promise<QuotationPDFData | null> {
  let docRes = await supabase.from("documents").select(DOC_SELECT).eq("id", documentId).maybeSingle();
  if (docRes.error) {
    docRes = await supabase.from("documents").select(DOC_SELECT_LEGACY).eq("id", documentId).maybeSingle();
  }
  const doc: any = docRes.data
    ? { ...docRes.data, attention_to: (docRes.data as any).attention_to ?? null }
    : null;
  if (!doc) return null;

  // m036 client extras (separate fetch — a missing column only affects the PDF).
  let clientExtras = { address: null, vat_number: null, default_attention_to: null } as {
    address: string | null;
    vat_number: string | null;
    default_attention_to: string | null;
  };
  if (doc.client_id) {
    const ext = await supabase
      .from("clients")
      .select("address, vat_number, default_attention_to")
      .eq("id", doc.client_id)
      .maybeSingle();
    if (!ext.error && ext.data) {
      clientExtras = {
        address: ext.data.address ?? null,
        vat_number: ext.data.vat_number ?? null,
        default_attention_to: ext.data.default_attention_to ?? null,
      };
    }
  }

  const { data: lineRows } = await supabase
    .from("document_lines")
    .select(LINE_SELECT)
    .eq("document_id", documentId);
  const lines = (lineRows ?? []) as any[];

  // Containers (resilient: wooden_box_cost may be missing on older envs).
  let containerRows: any[] = [];
  const cfull = await supabase
    .from("document_containers")
    .select("id, container_type, quantity, unit_price, wooden_box_cost, position")
    .eq("document_id", documentId)
    .order("position", { ascending: true });
  if (cfull.error) {
    const cbase = await supabase
      .from("document_containers")
      .select("id, container_type, quantity, unit_price, position")
      .eq("document_id", documentId)
      .order("position", { ascending: true });
    containerRows = (cbase.data ?? []) as any[];
  } else {
    containerRows = (cfull.data ?? []) as any[];
  }
  const containers: DocumentContainer[] = containerRows.map((c: any) => ({
    id: c.id,
    container_type: c.container_type,
    quantity: Number(c.quantity),
    unit_price: Number(c.unit_price),
    wooden_box_cost: Number(c.wooden_box_cost ?? 0),
  }));

  const effectiveFreight = containers.length
    ? totalFreight(containers)
    : Number(doc.freight_cost || 0);

  const productionTime = fromProductionColumns({
    production_mode: doc.production_mode,
    production_days: doc.production_days,
    production_date: doc.production_date,
  });
  const paymentMode = doc.payment_mode ?? null;
  const paymentTerms = doc.payment_terms ?? null;
  const salesCondition = (doc as any).sales_conditions ?? null;
  const showSalesConditions = !!(doc.include_sales_conditions && salesCondition);

  const clientRow = (doc as any).clients ?? null;
  const client = clientRow
    ? {
        company_name: clientRow.company_name,
        contact_name: clientRow.contact_name ?? null,
        email: clientRow.email ?? null,
        phone_number: clientRow.phone_number ?? null,
        country: clientRow.country ?? null,
        address: clientExtras.address,
        vat_number: clientExtras.vat_number,
        default_attention_to: clientExtras.default_attention_to,
      }
    : null;
  const clientCustomFields = ((clientRow?.custom_fields ?? []) as any[]).filter(
    (f) => f.label && f.value
  );

  return buildQuotationPdfData({
    doc,
    lines,
    containers,
    client: client as QuotationPDFData["client"],
    clientCustomFields: clientCustomFields as QuotationPDFData["client_custom_fields"],
    effectiveFreight,
    productionTime: productionTime as QuotationPDFData["production_time"],
    currency: (doc.currency ?? "USD") as QuotationPDFData["currency"],
    bankAccount: ((doc as any).bank_accounts ?? null) as QuotationPDFData["bank_account"],
    salesConditions: (showSalesConditions ? salesCondition : null) as QuotationPDFData["sales_conditions"],
    paymentLabel: formatPaymentTerms(paymentMode, paymentTerms),
    paymentMode: paymentMode as QuotationPDFData["payment_mode"],
    paymentTerms: paymentTerms as QuotationPDFData["payment_terms"],
    allowedFieldsByCategory: await resolveVisibleFields(supabase),
    specLabelById: await resolveSpecLabels(supabase, lines),
  });
}

/**
 * Render the quotation PDF to bytes, or null if the document is gone. Uses the
 * standard-font path (QuotationPDF registers no custom fonts), same as the
 * client render.
 */
export async function renderQuotationPdfBytes(
  supabase: any,
  documentId: string
): Promise<Uint8Array | null> {
  const data = await loadQuotationPdfData(supabase, documentId);
  if (!data) return null;
  const buffer = await renderToBuffer(
    createElement(QuotationPDF, { data }) as any
  );
  return new Uint8Array(buffer);
}
