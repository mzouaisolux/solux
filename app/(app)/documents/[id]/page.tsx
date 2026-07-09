import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import GeneratePdfButton from "./GeneratePdfButton";
import { SendButton } from "@/components/delivery/SendButton";
import { QuotationSendMenuActions } from "@/components/delivery/QuotationSendMenuActions";
import { buildPdfFilename } from "@/lib/pdf-filename";
import { StatusBadge } from "@/components/StatusBadge";
import { loadDocumentProfitability } from "@/lib/profitability-server";
import { ProfitabilityChip } from "@/components/profitability/ProfitabilityChip";
import { Timeline } from "@/components/Timeline";
import { ForecastPanel } from "@/components/forecast/ForecastPanel";
import { QuotationVersionsPanel } from "@/components/documents/QuotationVersionsPanel";
import { listEventsForEntity } from "@/lib/events";
import { computeFreightStatus, type FreightValidityStatus } from "@/lib/freight-validity";
import { requestFreightUpdate } from "@/app/(app)/projects/actions";
import { ShippingStatusCard, type ShippingUpdateLite } from "@/components/shipping/ShippingStatusCard";
import { loadShippingStatuses } from "@/lib/shipping-status-server";
import { getNumberSetting } from "@/lib/app-settings";
import {
  containerSummary,
  FRESHNESS_WARN_DAYS_KEY,
  FRESHNESS_CRITICAL_DAYS_KEY,
  FRESHNESS_DEFAULTS,
  type ShippingSnapshot,
  type FreshnessThresholds,
} from "@/lib/shipping-update";
import { ActionForm, SubmitButton } from "@/components/feedback/ActionForm";
import {
  DelayBadge,
  ProductionOrderStatusBadge,
} from "@/components/ProductionOrderBadges";
import WorkflowStepper, {
  buildLifecycleStages,
} from "@/components/WorkflowStepper";
import { computeProductionDelay } from "@/lib/types";
import {
  archiveQuotation,
  unarchiveQuotation,
  deleteQuotation,
  assignDocumentOwner,
  applyLatestCosting,
  keepCurrentCosting,
} from "./actions";
import { requestCostingRevisionForm } from "@/app/(app)/projects/actions";
import { loadCostingSettings } from "@/lib/pricing-settings";
import { computeCostingStatus } from "@/lib/costing-validity";
import { COST_REVISION_REASONS } from "@/lib/cost-revision";
import { OwnerAssignSelect } from "@/components/OwnerAssignSelect";
import { listAssignableOwners } from "@/lib/owner";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { ValidationPanel } from "@/components/validation/ValidationPanel";
import { isValidationStatus, type ValidationStatus } from "@/lib/validation";
import ContextMenu from "@/components/ContextMenu";
import { ContextMenuActionItem } from "@/components/ContextMenuActionItem";
import DocStatusActions from "@/components/DocStatusActions";
import { hasUiCapability } from "@/lib/permissions";
import { getEffectiveRole, getCurrentUserRole } from "@/lib/auth";
import {
  QuotationRemindersSection,
  getMyMostUrgentReminder,
} from "@/components/reminders/QuotationRemindersSection";
import { ReminderDueBadge } from "@/components/reminders/ReminderDueBadge";
import {
  EventDiscussionPanel,
  parseEventSearchParam,
} from "@/components/dashboard/EventDiscussionPanel";
import InvoicesPanel from "@/components/invoicing/InvoicesPanel";
import InvoiceCreateMenu from "@/components/invoicing/InvoiceCreateMenu";
import QuotationActionBar from "@/components/documents/QuotationActionBar";
import DocumentNextStep from "@/components/documents/DocumentNextStep";
import { documentKindLabel } from "@/lib/document-label";
import { fetchFamilyForDocument } from "@/lib/invoicing-server";
import { buildInvoiceCreateOptions, canInvoiceDocument } from "@/lib/invoicing";
import { isTechnicalRole, isAdminLike, canSupervise } from "@/lib/types";
import { computeMargin, formatDiscount } from "@/lib/pricing";
import { formatPaymentTerms } from "@/lib/payment";
import {
  containerBreakdown,
  formatProductionTime,
  fromProductionColumns,
  totalFreight,
} from "@/lib/logistics";
import type { QuotationPDFData } from "@/components/QuotationPDF";
import { isCustomPoleConfig } from "@/lib/custom-pole";
import {
  CUSTOM_OPTION_SENTINEL,
  customValueKey,
  isCustomValueKey,
  type BankAccount,
  type ClientCustomField,
  type ContainerType,
  type CostMap,
  type Currency,
  type DiscountType,
  type DocumentContainer,
  type PaymentMode,
  type PaymentTerms,
  type PricingTier,
  type ProductionMode,
  type SalesCondition,
} from "@/lib/types";

export default async function DocumentViewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { event?: string | string[] };
}) {
  const supabase = createClient();
  const { effectiveRole: role } = await getEffectiveRole();
  // ?event=<uuid> auto-opens the conversation drawer overlaid on this
  // doc — drives the notification "land on context + thread" flow.
  const eventDiscussionId = parseEventSearchParam(searchParams?.event);
  const isAdmin = role === "admin";

  // Attempt the doc fetch with all the m036 + m037 columns. If any are
  // missing, fall back to the legacy shape so the page keeps rendering.
  // New fields:
  //   - attention_to (m036)
  //   - warranty_years (m037)
  //   - offer_validity_products_days (m037)
  //   - offer_validity_transport_days (m037)
  let docWithAttention = await supabase
    .from("documents")
    .select(
      "id, number, type, date, status, incoterm, freight_type, freight_cost, total_price, manual_pricing, pdf_url, payment_mode, payment_terms, port_of_loading, port_of_destination, production_mode, production_days, production_date, currency, include_sales_conditions, sales_conditions_id, bank_account_id, purchase_order_number, commission_enabled, commission_percentage, commission_amount, commission_description, show_commission_in_pdf, client_id, affair_id, attention_to, warranty_years, offer_validity_products_days, offer_validity_transport_days, forecast_probability, forecast_expected_close_date, forecast_updated_at, archived_at, affair_name, version, root_document_id, insurance_cost, additional_charges, clients(company_name, contact_name, email, phone_number, country, client_code, custom_fields), sales_conditions(id, title, content, is_default), bank_accounts(id, account_name, business_account_name, currency, bank_name, bank_address, account_number, swift, is_default)"
    )
    .eq("id", params.id)
    .maybeSingle();
  if (docWithAttention.error) {
    // Legacy fallback — drop EVERY column that came in via a recent
    // migration (m036 attention_to, m037 warranty/validity, m038
    // business_account_name) so a freshly-cloned env without any of
    // those migrations still loads the doc.
    docWithAttention = await supabase
      .from("documents")
      .select(
        "id, number, type, date, status, incoterm, freight_type, freight_cost, total_price, manual_pricing, pdf_url, payment_mode, payment_terms, port_of_loading, port_of_destination, production_mode, production_days, production_date, currency, include_sales_conditions, sales_conditions_id, bank_account_id, purchase_order_number, commission_enabled, commission_percentage, commission_amount, commission_description, show_commission_in_pdf, client_id, affair_id, clients(company_name, contact_name, email, phone_number, country, client_code, custom_fields), sales_conditions(id, title, content, is_default), bank_accounts(id, account_name, currency, bank_name, bank_address, account_number, swift, is_default)"
      )
      .eq("id", params.id)
      .maybeSingle();
  }
  // Spread the row, then default attention_to to null when the column
  // was missing from the legacy fallback. (Order matters: row first,
  // then the fallback default — `??` reads from the row if present.)
  const doc: any = docWithAttention.data
    ? {
        ...docWithAttention.data,
        attention_to: (docWithAttention.data as any).attention_to ?? null,
      }
    : null;

  if (!doc) notFound();

  // Side query: the PDF needs the new client fields (address /
  // vat_number / default_attention_to) added in m036. Kept as a
  // separate fetch so a missing column on `clients` only affects the
  // PDF data, not the whole page.
  let pdfClientExtras: {
    address: string | null;
    vat_number: string | null;
    default_attention_to: string | null;
  } = { address: null, vat_number: null, default_attention_to: null };
  if (doc.client_id) {
    const ext = await supabase
      .from("clients")
      .select("address, vat_number, default_attention_to")
      .eq("id", doc.client_id)
      .maybeSingle();
    if (!ext.error && ext.data) {
      pdfClientExtras = {
        address: ext.data.address ?? null,
        vat_number: ext.data.vat_number ?? null,
        default_attention_to: ext.data.default_attention_to ?? null,
      };
    }
  }

  const [
    { data: lines },
    { data: containerRows },
    { data: existingTaskList },
    { data: existingProductionOrder },
  ] = await Promise.all([
    supabase
      .from("document_lines")
      .select(
        "id, quantity, selected_options, unit_price, total_price, pricing_mode, pricing_tier, original_unit_price, discount_type, discount_value, client_product_name, config_values, product_id, product_name, product_sku, product_category, products(name, category, category_id)"
      )
      .eq("document_id", params.id),
    // Resilient: the wooden_box_cost column may be missing (migration 007 not
    // applied). Try with it, fall back to the base columns so freight
    // containers still load (wooden_box_cost defaults to 0 in the mapping).
    (async () => {
      const full = await supabase
        .from("document_containers")
        .select("id, container_type, quantity, unit_price, wooden_box_cost, position")
        .eq("document_id", params.id)
        .order("position", { ascending: true });
      if (!full.error) return full;
      return await supabase
        .from("document_containers")
        .select("id, container_type, quantity, unit_price, position")
        .eq("document_id", params.id)
        .order("position", { ascending: true });
    })(),
    supabase
      .from("production_task_lists")
      .select("id, number, status")
      .eq("quotation_id", params.id)
      .maybeSingle(),
    // Production order is auto-created when the task list is validated.
    // Surfacing it here gives sales a read-only window into the operational
    // state (current deadline, delay, shipment) without giving them write
    // access — which lives behind the /production/orders/[id] page.
    supabase
      .from("production_orders")
      .select(
        "id, number, status, initial_production_deadline, current_production_deadline, etd, eta, shipment_booked"
      )
      .eq("quotation_id", params.id)
      .maybeSingle(),
  ]);

  // For a WON quotation, resolve the proforma "command" launched from its
  // affair (if any) — drives DocQuickActions ("Launch Production" vs "→ View
  // command") and the "command launched" indicator. One command per affair.
  let commandDoc: { id: string; number: string | null } | null = null;
  if (
    (doc as any).type === "quotation" &&
    doc.status === "won" &&
    (doc as any).affair_id
  ) {
    // NB: order by `date` — the live `documents` table has no `created_at`
    // column (ordering by it throws and silently nulls the command link).
    const { data: cmd } = await supabase
      .from("documents")
      .select("id, number")
      .eq("affair_id", (doc as any).affair_id)
      .eq("type", "proforma")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    commandDoc = (cmd as any) ?? null;
  }

  const client = (doc as any).clients as
    | {
        company_name: string;
        contact_name: string | null;
        email: string | null;
        phone_number: string | null;
        country: string | null;
        client_code?: string | null;
        custom_fields?: ClientCustomField[];
      }
    | null;
  const clientCustomFields: ClientCustomField[] =
    (client?.custom_fields ?? []).filter((f) => f.label && f.value);

  const containers: DocumentContainer[] = (containerRows ?? []).map((c: any) => ({
    id: c.id,
    container_type: c.container_type as ContainerType,
    quantity: Number(c.quantity),
    unit_price: Number(c.unit_price),
    wooden_box_cost: Number(c.wooden_box_cost ?? 0),
  }));

  const freightFromContainers = totalFreight(containers);
  const effectiveFreight = containers.length
    ? freightFromContainers
    : Number(doc.freight_cost || 0);
  const breakdown = containerBreakdown(containers);

  // Freight validity banner (m098) — only for quotations generated from a
  // Project Request. Reverse-link via generated_document_id, read the freight
  // validity, and warn when expired/expiring so Sales refreshes before sending.
  let freightValidity: {
    status: FreightValidityStatus;
    label: string;
    projectId: string;
    requested: boolean;
  } | null = null;
  {
    const { data: prj } = await supabase
      .from("project_requests")
      .select("id")
      .eq("generated_document_id", params.id)
      .maybeSingle();
    const projectId = (prj as any)?.id as string | undefined;
    if (projectId) {
      const { data: frRows } = await supabase
        .from("freight_cost_requests")
        .select("valid_until, update_requested_at, containers")
        .eq("project_request_id", projectId)
        .order("created_at", { ascending: true });
      const frow: any =
        (frRows ?? []).find((x: any) => Array.isArray(x?.containers) && x.containers.length) ?? (frRows ?? [])[0] ?? null;
      if (frow?.valid_until) {
        const s = computeFreightStatus(frow.valid_until, new Date().toISOString().slice(0, 10));
        if (s.status === "expired" || s.status === "expiring_soon") {
          freightValidity = { status: s.status, label: s.label, projectId, requested: !!frow.update_requested_at };
        }
      }
    }
  }
  const productionTime = fromProductionColumns({
    production_mode: doc.production_mode as ProductionMode | null,
    production_days: doc.production_days,
    production_date: doc.production_date,
  });
  const productionLabel = formatProductionTime(productionTime);
  const currency = (doc.currency ?? "USD") as Currency;
  const salesCondition = ((doc as any).sales_conditions ?? null) as
    | SalesCondition
    | null;
  const bankAccount = ((doc as any).bank_accounts ?? null) as
    | BankAccount
    | null;
  const showSalesConditions = !!(doc.include_sales_conditions && salesCondition);

  const itemsTotal = (lines ?? []).reduce(
    (s, l: any) => s + Number(l.total_price || 0),
    0
  );

  // Admin: load costs for the products on this document for margin display.
  let costs: CostMap = {};
  if (isAdmin && lines?.length) {
    const productIds = Array.from(new Set(lines.map((l: any) => l.product_id)));
    const { data: costRows } = await supabase
      .from("product_costs")
      .select("product_id, cost_price")
      .in("product_id", productIds);
    for (const row of costRows ?? []) {
      costs[row.product_id] = Number(row.cost_price);
    }
  }

  const itemsMargin = isAdmin
    ? (lines ?? []).reduce((sum: number, l: any) => {
        const m = computeMargin(Number(l.unit_price || 0), costs[l.product_id]);
        return sum + (m ? m.margin * Number(l.quantity || 0) : 0);
      }, 0)
    : null;
  // Commission reduces the seller's margin.
  const totalMargin =
    itemsMargin === null
      ? null
      : itemsMargin - Number(doc.commission_amount || 0);

  const paymentMode = (doc.payment_mode ?? null) as PaymentMode | null;
  const paymentTerms = (doc.payment_terms ?? null) as PaymentTerms | null;
  const paymentLabel = formatPaymentTerms(paymentMode, paymentTerms);

  // Visible config fields — the customer-facing technical specs that
  // should appear under each product name on the PDF (CCT, Optic,
  // Bracket dimension, Solar panel, …). We pull the metadata once,
  // bucket the allowed field_names per category_id, then filter each
  // line's `config_values` blob against the bucket. Internal-only
  // fields and quotation-hidden fields stay out of the PDF.
  //
  // Defensive: if `config_fields` columns are missing on this env, the
  // fetch errors and we fall back to leaving `visible_config_fields`
  // empty per line — the PDF then uses its legacy `selected_options`
  // fallback so the layout still has a spec subline.
  const { data: visibleFieldsRaw } = await supabase
    .from("config_fields")
    .select("field_name, category_id, visible_in_quotation, internal_only, active")
    .eq("visible_in_quotation", true)
    .eq("internal_only", false)
    .eq("active", true);
  const allowedFieldsByCategory = new Map<string, Set<string>>();
  for (const f of visibleFieldsRaw ?? []) {
    const cat = (f as any).category_id as string | null;
    const name = (f as any).field_name as string | null;
    if (!cat || !name) continue;
    if (!allowedFieldsByCategory.has(cat)) {
      allowedFieldsByCategory.set(cat, new Set());
    }
    allowedFieldsByCategory.get(cat)!.add(name);
  }

  /** Build the visible-on-PDF config fields for a given line. */
  function buildVisibleConfig(
    categoryId: string | null,
    configValues: Record<string, unknown> | null
  ): Array<{ field_name: string; value: string }> {
    if (!configValues || typeof configValues !== "object") return [];
    // Custom pole lines carry a structured spec (line_type/pole_spec) that is
    // NOT customer config — the description already lives in the line name.
    if (isCustomPoleConfig(configValues)) return [];
    const allowed = categoryId
      ? allowedFieldsByCategory.get(categoryId)
      : null;
    const out: Array<{ field_name: string; value: string }> = [];
    for (const [k, v] of Object.entries(configValues)) {
      if (v == null) continue;
      const str = String(v).trim();
      if (str === "") continue;
      // If we have a visibility map and the field isn't in it, skip.
      // If we don't (defensive fallback), show everything so the user
      // sees SOMETHING rather than an empty subline.
      if (allowed && !allowed.has(k)) continue;
      out.push({ field_name: k, value: str });
    }
    return out;
  }

  // PDF client shape — merge the embedded client (used elsewhere on the
  // page) with the side-fetched extras (address / vat / default attn)
  // from m036.
  const pdfClient = client
    ? {
        company_name: (client as any).company_name,
        contact_name: (client as any).contact_name ?? null,
        email: (client as any).email ?? null,
        phone_number: (client as any).phone_number ?? null,
        country: (client as any).country ?? null,
        address: pdfClientExtras.address,
        vat_number: pdfClientExtras.vat_number,
        default_attention_to: pdfClientExtras.default_attention_to,
      }
    : null;

  const pdfData: QuotationPDFData = {
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
    sales_conditions: showSalesConditions ? salesCondition : null,
    total_price: Number(doc.total_price || 0),
    payment_label: paymentLabel,
    payment_mode: paymentMode,
    payment_terms: paymentTerms,
    attention_to: (doc as any).attention_to ?? null,
    // Sales Terms (m037) — defensive reads; the column may not exist
    // in older envs, in which case the PDF section gracefully omits
    // those rows.
    warranty_years: (doc as any).warranty_years ?? null,
    offer_validity_products_days:
      (doc as any).offer_validity_products_days ?? null,
    offer_validity_transport_days:
      (doc as any).offer_validity_transport_days ?? null,
    client: pdfClient,
    lines: (lines ?? []).map((l: any) => ({
      // Internal product name is always the primary display. Falls back to
      // the line's own SNAPSHOT (product_name) when the catalog product has
      // been deleted (m089), then to client_product_name for a free-text /
      // Project Product line (no catalogue product at all) — so the quotation
      // stays readable instead of showing "—".
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
      // Customer-visible config (CCT, Optic, Bracket, Solar panel, …),
      // pre-filtered against config_fields.visible_in_quotation.
      visible_config_fields: buildVisibleConfig(
        l.products?.category_id ?? null,
        (l.config_values ?? null) as Record<string, unknown> | null
      ),
      quantity: Number(l.quantity || 0),
      unit_price: Number(l.unit_price || 0),
      total_price: Number(l.total_price || 0),
      pricing_mode: l.pricing_mode,
      pricing_tier: (l.pricing_tier ?? null) as PricingTier | null,
      original_unit_price:
        l.original_unit_price == null ? null : Number(l.original_unit_price),
      discount_type: (l.discount_type ?? null) as DiscountType | null,
      discount_value: Number(l.discount_value || 0),
    })),
    purchase_order_number: doc.purchase_order_number ?? null,
    commission_amount: doc.show_commission_in_pdf
      ? Number(doc.commission_amount || 0)
      : 0,
    commission_visible: !!doc.show_commission_in_pdf,
    commission_description: doc.commission_description ?? null,
    client_custom_fields: clientCustomFields,
  };

  let signedPdfUrl: string | null = null;
  if (doc.pdf_url) {
    const { data: signed } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.pdf_url, 60 * 60);
    signedPdfUrl = signed?.signedUrl ?? null;
  }

  // Canonical PDF filename — shared by the Send action (header + "…" menu).
  const pdfFilename = buildPdfFilename({
    kind: pdfData.type,
    number: doc.number,
    client: (client as any)?.company_name ?? null,
    affair: (doc as any).affair_name ?? null,
    version: Number((doc as any).version ?? 1),
  });
  const quotationKindLabel = doc.type === "proforma" ? "Proforma" : "Quotation";

  // Current user — needed to drive the reminders UI (the panel + badge
  // are scoped to "my" reminders since reminders are personal per
  // Dashboard Phase 3 spec).
  const { userId: currentUserId } = await getCurrentUserRole();
  // Most-urgent open reminder for the current user on this doc — drives
  // the header `Reminder due` badge. Soft-fails to null if m043 isn't
  // applied (table missing), so the page keeps rendering on legacy DBs.
  const myUrgentReminder = await getMyMostUrgentReminder(
    params.id,
    currentUserId
  ).catch(() => null);

  // Shipping Rate Refresh (m149) — soft-fails to "unavailable" until the
  // migration is applied (table missing), so the page keeps rendering.
  let shippingUpdatesAvailable = false;
  let shippingOpenRequest: ShippingUpdateLite | null = null;
  let shippingHistory: ShippingUpdateLite[] = [];
  {
    const { data: surRows, error: surErr } = await supabase
      .from("shipping_update_requests")
      .select(
        "id, status, priority, reason, requested_at, requested_by, completed_at, previous_freight_cost, previous_insurance_cost, new_freight_cost, new_insurance_cost"
      )
      .eq("document_id", params.id)
      .order("requested_at", { ascending: false });
    if (!surErr) {
      shippingUpdatesAvailable = true;
      const lite = (surRows ?? []).map((r: any): ShippingUpdateLite => ({
        id: r.id,
        status: r.status,
        priority: r.priority,
        reason: r.reason,
        requested_at: r.requested_at,
        completed_at: r.completed_at,
        previous_freight_cost: r.previous_freight_cost,
        previous_insurance_cost: r.previous_insurance_cost,
        new_freight_cost: r.new_freight_cost,
        new_insurance_cost: r.new_insurance_cost,
        mine: r.requested_by === currentUserId,
      }));
      shippingOpenRequest =
        lite.find((r) => r.status === "waiting" || r.status === "in_progress") ??
        null;
      shippingHistory = lite.filter((r) => r.status === "completed").slice(0, 6);
    }
  }
  const canRequestShippingUpdate = await hasUiCapability("shipping.request_update");
  // Freight-freshness signal + context for the permanent Shipping Status card.
  // Freshness works regardless of m149; the loader soft-fails the request bits.
  const [warnDays, criticalDays] = await Promise.all([
    getNumberSetting(supabase, FRESHNESS_WARN_DAYS_KEY, FRESHNESS_DEFAULTS.warnDays),
    getNumberSetting(supabase, FRESHNESS_CRITICAL_DAYS_KEY, FRESHNESS_DEFAULTS.criticalDays),
  ]);
  const freshnessThresholds: FreshnessThresholds = { warnDays, criticalDays };
  // m152 — management profitability chip (capability-gated inside; null for
  // non-managers and for legacy documents without an affair).
  const profitability = await loadDocumentProfitability(supabase, params.id);
  const shippingStatus =
    (await loadShippingStatuses(supabase, [params.id])).get(params.id) ?? {
      documentId: params.id,
      available: shippingUpdatesAvailable,
      currentFreight: effectiveFreight,
      currentInsurance: (doc as any).insurance_cost ?? null,
      destination: doc.port_of_destination ?? null,
      incoterm: doc.incoterm ?? null,
      portOfLoading: doc.port_of_loading ?? null,
      quoteDate: doc.date ?? null,
      lastUpdateDate: doc.date ?? null,
      previousUpdateDate: null,
      ageDays: null,
      hasOpenRequest: Boolean(shippingOpenRequest),
      updateCount: shippingHistory.length,
    };
  // Prefill of the modal's editable "Shipping Summary" — best data we hold.
  const shippingPrefill: ShippingSnapshot = {
    customer: client?.company_name ?? "",
    project: (doc as any).affair_name ?? "",
    destination_country: client?.country ?? "",
    destination_port: doc.port_of_destination ?? "",
    port_of_loading: doc.port_of_loading ?? "",
    incoterm: doc.incoterm ?? "",
    shipping_method: "Sea freight",
    ...containerSummary(containers),
    product_family:
      (lines ?? [])
        .map((l: any) => l.products?.category ?? l.product_category)
        .find((c: any) => typeof c === "string" && c.trim()) ?? "",
  };

  // Audit timeline — read events for this document. 100 is the same cap
  // used on /production/orders/[id]; plenty for any realistic history
  // and keeps the page predictable in size.
  const docEvents = await listEventsForEntity("document", params.id, 100);
  const docActorIds = Array.from(
    new Set(docEvents.map((e) => e.actor_id).filter(Boolean))
  ) as string[];
  const docActorLabels = new Map<string, string>();
  if (docActorIds.length > 0) {
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", docActorIds);
    for (const r of roles ?? []) {
      docActorLabels.set(
        r.user_id,
        `${r.role} · ${String(r.user_id).slice(0, 8)}`
      );
    }
  }

  // Destructive quotation actions — gated + View-As faithful. Archive
  // is the safe fallback; Delete is permanent (super-admin only per the
  // matrix). Cancel stays available via the "Other status" row below.
  const canArchiveQuotation = await hasUiCapability("quotation.archive");
  const canDeleteQuotation = await hasUiCapability("quotation.delete");
  // Invoicing a won deal is the same commercial act as quoting it (m141).
  const canInvoice = await hasUiCapability("quotation.create");
  const isArchived = !!(doc as any).archived_at;

  // ---- Versioning: is this the LATEST version of its affair? ----------
  // A forecast belongs on the latest version only — when V2 exists, V1's
  // forecast is superseded (and the pipeline de-dupes to V2). We resolve
  // the affair's max version + its id so the forecast section can either
  // render the editor (latest) or a "managed on latest version" notice.
  const affairRootId = (doc as any).root_document_id ?? doc.id;
  let latestVersionId = doc.id;
  let latestVersionNum = Number((doc as any).version ?? 1);
  let affairVersionCount = 1;
  {
    const { data: affairRows } = await supabase
      .from("documents")
      .select("id, version")
      .or(`id.eq.${affairRootId},root_document_id.eq.${affairRootId}`);
    if (affairRows && affairRows.length > 0) {
      affairVersionCount = affairRows.length;
      for (const r of affairRows as Array<{ id: string; version: number | null }>) {
        const v = Number(r.version ?? 1);
        if (v >= latestVersionNum) {
          latestVersionNum = v;
          latestVersionId = r.id;
        }
      }
    }
  }
  const isLatestVersion = latestVersionId === doc.id;
  const hasMultipleVersions = affairVersionCount > 1;

  // ---- Sales owner (deal owner) — management-only reassignment (m066).
  // The deal owner flows down to the task list + production order, so this
  // one control attributes the whole affair. Defensive read for the column.
  const canAssignOwner = canSupervise(role);
  let docSalesOwnerId: string | null = null;
  let ownerOptions: { id: string; name: string; role?: string | null }[] = [];
  if (canAssignOwner) {
    const { data: ownerRow } = await supabase
      .from("documents")
      .select("sales_owner_id")
      .eq("id", params.id)
      .maybeSingle();
    docSalesOwnerId = (ownerRow as any)?.sales_owner_id ?? null;
    ownerOptions = await listAssignableOwners();
  }

  // ---- Advisory validation loop (m068) ----
  // Separate, defensive read so a missing m068 column never breaks the page.
  // canReview = management (Approve / Request changes); canRequest = sales
  // (the deal owner asks for a second opinion). Never blocks sending.
  let validation: {
    status: ValidationStatus | null;
    requested_by: string | null;
    requested_at: string | null;
    note: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
  } = {
    status: null,
    requested_by: null,
    requested_at: null,
    note: null,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
  };
  {
    const { data: v } = await supabase
      .from("documents")
      .select(
        "validation_status, validation_requested_by, validation_requested_at, validation_note, validation_reviewed_by, validation_reviewed_at, validation_review_note"
      )
      .eq("id", params.id)
      .maybeSingle();
    if (v) {
      validation = {
        status: isValidationStatus((v as any).validation_status)
          ? ((v as any).validation_status as ValidationStatus)
          : null,
        requested_by: (v as any).validation_requested_by ?? null,
        requested_at: (v as any).validation_requested_at ?? null,
        note: (v as any).validation_note ?? null,
        reviewed_by: (v as any).validation_reviewed_by ?? null,
        reviewed_at: (v as any).validation_reviewed_at ?? null,
        review_note: (v as any).validation_review_note ?? null,
      };
    }
  }
  const valUserIds = [validation.requested_by, validation.reviewed_by].filter(
    (x): x is string => !!x
  );
  const valLabels = valUserIds.length
    ? await resolveUserLabelStrings(valUserIds)
    : new Map<string, string>();
  // Anyone who can open this quote may REQUEST validation (RLS already
  // limits who sees it); only management can REVIEW (approve / request
  // changes). Managers can request too — handy for a director sign-off.
  // Price/quote validation review is Admin / Super Admin only.
  const canReviewValidation = canSupervise(role);
  const canRequestValidation = true;
  // Relevant while the quote is in play, or whenever a trail already exists.
  const showValidation =
    !doc.archived_at &&
    (validation.status !== null ||
      ["draft", "sent", "negotiating"].includes(doc.status));

  // ---- Invoicing (m141) — one fetch, shared by the header + Invoices panel ----
  const invoiceFamily = await fetchFamilyForDocument(supabase, doc.id);
  const invoiceDepositPercent =
    typeof paymentTerms?.deposit_percent === "number" &&
    paymentTerms.deposit_percent > 0 &&
    paymentTerms.deposit_percent < 100
      ? paymentTerms.deposit_percent
      : null;
  const invoiceTotal = invoiceFamily
    ? invoiceFamily.total_amount
    : Number(doc.total_price) || 0;
  const invoiceLites = (invoiceFamily?.invoices ?? []).map((i) => ({
    id: i.id,
    invoice_type: i.invoice_type,
    amount: i.amount,
    status: i.status,
  }));
  const invoiceOptions = buildInvoiceCreateOptions(
    invoiceTotal,
    invoiceLites,
    invoiceDepositPercent
  );
  const hasActiveInvoices = invoiceLites.some((i) => i.status !== "cancelled");
  const docCurrency = (doc.currency ?? null) as string | null;

  // Proforma-first "Next step" cockpit (owner 2026-07-03) — behind a runtime
  // flag so it can be toggled off instantly during the live commercial test
  // (`DOC_COCKPIT=off`). The guided cockpit replaces the scattered header
  // actions for the commercial document; the internal order-confirmation
  // proforma keeps the classic layout.
  const proformaFirst = process.env.DOC_COCKPIT !== "off";
  const useCockpit = proformaFirst && (doc as any).type === "quotation";

  // ---- m140/m153 — costing validity + newer-costing decision --------------
  // Self-contained, fallback-guarded compute: unmigrated envs stay silent.
  // Sales never receives a cost here — only validity metadata and the
  // approved SELLING prices (owner-readable by design, m095/m140 RLS).
  let costingNotice: {
    status: "aging" | "expired";
    label: string;
    srId: string;
    pendingExists: boolean;
  } | null = null;
  let newerCosting: {
    versionId: string;
    versionNo: number;
    approvedAt: string | null;
    hasProduct: boolean;
    hasPole: boolean;
    hasFreight: boolean;
    hasTransport: boolean;
  } | null = null;
  if (["draft", "sent", "negotiating"].includes(doc.status)) {
    try {
      const lineRes = await supabase
        .from("document_lines")
        .select("source_project_request_id, approved_at, pricing_source")
        .eq("document_id", params.id)
        .eq("pricing_source", "approved_service_request");
      const srIds = Array.from(
        new Set(
          ((lineRes.data ?? []) as any[])
            .map((l) => l.source_project_request_id)
            .filter(Boolean)
        )
      ) as string[];
      if (srIds.length) {
        const [settings, snaps] = await Promise.all([
          loadCostingSettings(supabase),
          supabase
            .from("project_products")
            .select("project_request_id, priced_at")
            .in("project_request_id", srIds),
        ]);
        const snapRows = ((snaps.data ?? []) as any[]).filter((s) => s.priced_at);
        const oldest = snapRows.map((s) => s.priced_at as string).sort()[0] as
          | string
          | undefined;
        const validity = computeCostingStatus(
          oldest ?? null,
          new Date().toISOString().slice(0, 10),
          settings
        );
        // m140 extras (versions + the doc's ack) — separately guarded.
        let pendingExists = false;
        let latestApproved: any = null;
        let ackId: string | null = null;
        try {
          const [{ data: vRows }, ackRes] = await Promise.all([
            supabase
              .from("project_costing_versions")
              .select(
                "id, project_request_id, version_no, status, approved_at, product_unit_price, pole_unit_price, containers, incoterm, port_of_destination"
              )
              .in("project_request_id", srIds),
            supabase
              .from("documents")
              .select("costing_version_ack")
              .eq("id", params.id)
              .maybeSingle(),
          ]);
          ackId = (ackRes.data as any)?.costing_version_ack ?? null;
          const rows = (vRows ?? []) as any[];
          pendingExists = rows.some((v) => v.status === "pending");
          latestApproved =
            rows
              .filter((v) => v.status === "approved")
              .sort((a, b) =>
                String(b.approved_at ?? "").localeCompare(String(a.approved_at ?? ""))
              )[0] ?? null;
        } catch {
          /* pre-m140 */
        }
        if (validity.status === "aging" || validity.status === "expired") {
          costingNotice = {
            status: validity.status,
            label: validity.label,
            srId: srIds[0],
            pendingExists,
          };
        }
        if (latestApproved) {
          const lineApprovedMax = ((lineRes.data ?? []) as any[])
            .map((l) => l.approved_at as string | null)
            .filter(Boolean)
            .sort()
            .pop() as string | undefined;
          const newer =
            latestApproved.approved_at &&
            (!lineApprovedMax || latestApproved.approved_at > lineApprovedMax) &&
            latestApproved.id !== ackId;
          if (newer) {
            newerCosting = {
              versionId: latestApproved.id,
              versionNo: latestApproved.version_no ?? 1,
              approvedAt: latestApproved.approved_at ?? null,
              hasProduct: latestApproved.product_unit_price != null,
              hasPole: latestApproved.pole_unit_price != null,
              hasFreight:
                Array.isArray(latestApproved.containers) &&
                latestApproved.containers.length > 0,
              hasTransport:
                !!latestApproved.incoterm || !!latestApproved.port_of_destination,
            };
          }
        }
      }
    } catch {
      /* unmigrated env — features dormant */
    }
  }

  // One-line "what's next?" so a first-timer never has to search (redesign #5).
  const nextAction = (() => {
    if (doc.archived_at) return null;
    switch (doc.status) {
      case "draft":
        return "finish it, then Mark as sent to the client";
      case "sent":
      case "negotiating":
        return "Mark Won once the client accepts, or revise it";
      case "won":
        if (existingTaskList || commandDoc) return "invoice the deal and track production";
        return hasActiveInvoices
          ? "send your invoices, or Launch Production"
          : "Create an invoice, or Launch Production";
      case "lost":
      case "cancelled":
        return "this deal is closed";
      default:
        return null;
    }
  })();

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-8">
      {/* Freight validity warning (m098) — quotation generated from a project. */}
      {freightValidity && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            freightValidity.status === "expired"
              ? "border-rose-300 bg-rose-50 text-rose-800"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          <div>
            <span className="font-semibold">
              {freightValidity.status === "expired" ? "✗ Freight pricing has expired. " : "⚠ Freight pricing is expiring. "}
            </span>
            {freightValidity.status === "expired"
              ? `${freightValidity.label}. Request an updated freight cost before sending this quotation.`
              : `${freightValidity.label}. Consider refreshing freight before sending.`}
          </div>
          {freightValidity.requested ? (
            <span className="shrink-0 text-xs font-medium">⏳ Update requested — waiting on Operations</span>
          ) : (
            <ActionForm action={requestFreightUpdate} success="✓ Freight update requested" className="shrink-0">
              <input type="hidden" name="project_id" value={freightValidity.projectId} />
              <SubmitButton className="btn-secondary text-xs" pendingLabel="Requesting…">
                ↻ Request freight update
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      )}

      {/* m140/m153 — costing validity warning (aging/expired; company
          thresholds). Never blocks here — Policy 2's block lives in the
          send action so drafts stay editable/printable. */}
      {costingNotice && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            costingNotice.status === "expired"
              ? "border-rose-300 bg-rose-50 text-rose-800"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          <div className="min-w-0">
            <span className="font-semibold">
              {costingNotice.status === "expired"
                ? "✗ Costing status: Expired. "
                : "⚠ Costing status: Aging. "}
            </span>
            {costingNotice.label}. Component prices, freight costs and exchange
            rates may have changed —{" "}
            {costingNotice.status === "expired"
              ? "a costing revision is strongly recommended before issuing this quotation."
              : "we recommend requesting a costing revision before sending this quotation."}
          </div>
          {costingNotice.pendingExists ? (
            <span className="shrink-0 text-xs font-medium">
              ⏳ Revision requested — waiting on the Director
            </span>
          ) : (
            <ActionForm
              action={requestCostingRevisionForm}
              success="✓ Costing revision requested"
              className="flex shrink-0 flex-wrap items-center gap-2"
            >
              <input type="hidden" name="project_id" value={costingNotice.srId} />
              <input
                name="reason"
                required
                list="cost-revision-reasons-doc"
                placeholder="Reason (required)"
                className="rounded border border-current/30 bg-white/70 px-2 py-1 text-xs"
              />
              <datalist id="cost-revision-reasons-doc">
                {COST_REVISION_REASONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <SubmitButton className="btn-secondary text-xs" pendingLabel="Requesting…">
                Request Costing Revision
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      )}

      {/* m140 — A NEWER COSTING WAS APPROVED: the user decides, nothing is
          automatic. Draft → selective apply (owner's checklist); sent →
          Keep or revise-to-apply (a sent doc is the record of what the
          client received). */}
      {newerCosting && (
        <div className="rounded-lg border border-indigo-300 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-950">
          <div className="font-semibold">
            A newer costing has been approved for this project
            {newerCosting.approvedAt
              ? ` (V${newerCosting.versionNo} · ${newerCosting.approvedAt.slice(0, 10)})`
              : ` (V${newerCosting.versionNo})`}
            .
          </div>
          {doc.status === "draft" ? (
            <ActionForm
              action={applyLatestCosting}
              success="✓ Latest costing applied"
              className="mt-2 flex flex-wrap items-center gap-3"
            >
              <input type="hidden" name="id" value={doc.id} />
              <span className="text-xs text-indigo-900">Update:</span>
              {newerCosting.hasProduct && (
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" name="sel_product" defaultChecked /> Product pricing
                </label>
              )}
              {newerCosting.hasPole && (
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" name="sel_pole" defaultChecked /> Pole pricing
                </label>
              )}
              {newerCosting.hasFreight && (
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" name="sel_freight" /> Freight / Shipping
                </label>
              )}
              {newerCosting.hasTransport && (
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" name="sel_transport" /> Transport assumptions
                </label>
              )}
              <SubmitButton className="btn-secondary text-xs" pendingLabel="Applying…">
                Update selected items
              </SubmitButton>
            </ActionForm>
          ) : (
            <p className="mt-1 text-xs text-indigo-900">
              This quotation was already sent — the record of what the client
              received never changes in place. Create a new version to apply
              the new costing:{" "}
              <Link href={`/documents/new?revise=${doc.id}`} className="font-semibold underline">
                Edit → new version (revise)
              </Link>
            </p>
          )}
          <ActionForm
            action={keepCurrentCosting}
            success="✓ Existing costing kept"
            className="mt-2"
          >
            <input type="hidden" name="id" value={doc.id} />
            <input type="hidden" name="version_id" value={newerCosting.versionId} />
            <SubmitButton
              className="text-xs text-indigo-800 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-950"
              pendingLabel="Keeping…"
            >
              Keep current quotation
            </SubmitButton>
          </ActionForm>
        </div>
      )}
      <div className="flex items-start justify-between pb-4 border-b border-neutral-200">
        <div>
          <div className="eyebrow-brand">
            {proformaFirst ? documentKindLabel((doc as any).type) : doc.type}
          </div>
          {doc.affair_name && (
            <div className="text-lg font-semibold text-neutral-900 mt-1 leading-tight">
              {doc.affair_name}
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <h1
              className={
                doc.affair_name ? "font-mono text-sm text-neutral-500" : "doc-title"
              }
            >
              {doc.number ?? "—"}
            </h1>
            {Number(doc.version ?? 1) > 1 && (
              <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">
                Version {doc.version}
              </span>
            )}
            <StatusBadge status={doc.status} size="md" />
            {/* m152 — Overall margin chip (management only; renders nothing
                without the capability). Click → financial breakdown drawer. */}
            <ProfitabilityChip
              data={profitability}
              affairId={(doc as any).affair_id ?? null}
            />
            {/* Personal reminder badge — only renders when the current
                user has an OPEN reminder due today or overdue on this
                doc. Hidden for upcoming reminders to keep the header
                tight; users see those in the panel below. */}
            <ReminderDueBadge reminder={myUrgentReminder} />
          </div>
          <p className="doc-number mt-2">
            <span className="eyebrow-brand mr-2">Date</span>
            {new Date(doc.date).toLocaleDateString("en-GB")}
            {doc.purchase_order_number && (
              <>
                <span className="eyebrow-brand mx-2">PO</span>
                <span>{doc.purchase_order_number}</span>
              </>
            )}
          </p>
          {/* Classic scattered header actions — kept for the flag-off path
              and the internal order-confirmation proforma. The cockpit
              (below the header) supersedes these for the commercial doc. */}
          {!useCockpit && (
            <>
              {/* Compact "what's next?" — replaces the yellow work-in-progress
                  card; the actions themselves are grouped right below. */}
              {nextAction && (
                <p className="mt-3 text-[13px] text-neutral-500">
                  Next: <span className="text-neutral-800">{nextAction}</span>
                </p>
              )}

              {/* PRIMARY workflow actions — all grouped in the header. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <QuotationActionBar
                  doc={{ id: doc.id, status: doc.status, type: (doc as any).type }}
                  taskList={
                    existingTaskList
                      ? { id: existingTaskList.id, number: existingTaskList.number }
                      : null
                  }
                  command={commandDoc}
                />
                {canInvoice &&
                  canInvoiceDocument((doc as any).type, doc.status) && (
                    <InvoiceCreateMenu
                      documentId={doc.id}
                      currency={docCurrency}
                      options={invoiceOptions}
                      variant="primary"
                      label="Create invoice"
                    />
                  )}
              </div>
            </>
          )}

          {/* Sales owner (deal owner) — management-only. Attributes the
              whole affair (flows to task list + production order). */}
          {canAssignOwner && ownerOptions.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Sales owner
              </span>
              <OwnerAssignSelect
                action={assignDocumentOwner}
                id={doc.id}
                currentOwnerId={docSalesOwnerId}
                options={ownerOptions}
              />
            </div>
          )}

          {/*
            Read-only production status — surfaces the operational state
            for sales. Auto-appears once the task list has been validated
            (which auto-creates the production_order). Sales clicks through
            to /production/orders/[id] for the full read-only view; only
            TLM/admin can actually change anything there.
          */}
          {existingProductionOrder && (
            <Link
              href={`/production/orders/${existingProductionOrder.id}`}
              className="block mt-3 rounded-xl border border-neutral-200/80 bg-neutral-50 hover:bg-white hover:shadow-card-hover transition-all duration-150 p-3"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widerx font-semibold text-neutral-500">
                    Production order ·{" "}
                    <span className="font-mono">
                      {existingProductionOrder.number ?? "—"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <ProductionOrderStatusBadge
                      status={existingProductionOrder.status}
                    />
                    <DelayBadge
                      delayDays={computeProductionDelay({
                        initial_production_deadline:
                          existingProductionOrder.initial_production_deadline,
                        current_production_deadline:
                          existingProductionOrder.current_production_deadline,
                      })}
                    />
                  </div>
                  <div className="text-[11px] text-neutral-600 mt-1.5 flex flex-wrap gap-x-3">
                    {existingProductionOrder.current_production_deadline && (
                      <span>
                        <span className="text-neutral-500">
                          Production due
                        </span>{" "}
                        <b className="font-mono">
                          {new Date(
                            existingProductionOrder.current_production_deadline
                          ).toLocaleDateString("en-GB")}
                        </b>
                      </span>
                    )}
                    {existingProductionOrder.etd && (
                      <span>
                        <span className="text-neutral-500">ETD</span>{" "}
                        <b className="font-mono">
                          {new Date(
                            existingProductionOrder.etd
                          ).toLocaleDateString("en-GB")}
                        </b>
                      </span>
                    )}
                    {existingProductionOrder.eta && (
                      <span>
                        <span className="text-neutral-500">ETA</span>{" "}
                        <b className="font-mono">
                          {new Date(
                            existingProductionOrder.eta
                          ).toLocaleDateString("en-GB")}
                        </b>
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-neutral-500 group-hover:text-neutral-900 shrink-0">
                  Open →
                </span>
              </div>
            </Link>
          )}
          {/* Secondary status transitions — compact, for less-common moves.
              Guards live in updateDocumentStatus + DocStatusActions (audit
              H1/H3): a won quote only offers Cancelled/Lost (no editable
              revert), and the cancel/lost cascade is confirmed first. The
              cockpit renders its own copy of these in-context. */}
          {!useCockpit && (
            <DocStatusActions docId={doc.id} current={doc.status} />
          )}
        </div>
        <div className="flex flex-col items-end gap-3">
          <Link
            href="/clients"
            className="text-[13px] text-neutral-500 hover:text-neutral-900"
          >
            ← Back to clients
          </Link>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {signedPdfUrl ? (
              <>
                <a
                  href={signedPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  Download PDF
                </a>
                <GeneratePdfButton
                  documentId={doc.id}
                  data={pdfData}
                  label="Regenerate"
                  affair={(doc as any).affair_name ?? null}
                  version={Number((doc as any).version ?? 1)}
                />
              </>
            ) : (
              <GeneratePdfButton
                documentId={doc.id}
                data={pdfData}
                affair={(doc as any).affair_name ?? null}
                version={Number((doc as any).version ?? 1)}
              />
            )}
            {/* Send by email — the normal step after generating a quotation.
                Opens a compose modal (CRM recipient + PDF attached). Hidden for
                a cancelled quote, which must never be sent. */}
            {doc.status !== "cancelled" && (
              <SendButton
                quotation={{
                  pdfData,
                  filename: pdfFilename,
                  quotationId: doc.id,
                  status: doc.status,
                  kindLabel: quotationKindLabel,
                }}
                clientId={(doc as any).client_id ?? null}
                clientEmail={(client as any)?.email ?? null}
                affairName={(doc as any).affair_name ?? null}
              />
            )}
          </div>

          {/* Destructive actions — discreet 3-dot menu. Archive is the
              safe fallback (reversible); Delete is permanent and only
              shows for roles that hold quotation.delete. Hidden entirely
              when the user can do neither. */}
          <ContextMenu>
            {/* Create the next version of this affair — opens the
                builder pre-filled; saves as a new draft V{n}. */}
            <Link
              href={`/documents/new?revise=${doc.id}`}
              className="block px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              Edit → new version (revise)
            </Link>
            {/* Document delivery actions — grouped with the rest. Send opens
                the global modal (survives this menu closing). */}
            {doc.status !== "cancelled" && (
              <QuotationSendMenuActions
                pdfData={pdfData}
                filename={pdfFilename}
                quotationId={doc.id}
                status={doc.status}
                kindLabel={quotationKindLabel}
                clientId={(doc as any).client_id ?? null}
                clientEmail={(client as any)?.email ?? null}
                affairName={(doc as any).affair_name ?? null}
                downloadUrl={signedPdfUrl}
              />
            )}
            {canArchiveQuotation &&
                (isArchived ? (
                  <ContextMenuActionItem
                    action={unarchiveQuotation}
                    id={doc.id}
                    label="Restore from archive"
                    pendingLabel="Restoring…"
                    variant="success"
                  />
                ) : (
                  <ContextMenuActionItem
                    action={archiveQuotation}
                    id={doc.id}
                    label="Archive quotation"
                    pendingLabel="Archiving…"
                    variant="neutral"
                  />
                ))}
              {/* Decision F: non-committed statuses (any role), or a WON quote
                  only for admins; the server action also blocks deleting anything
                  that has a task list / production order. */}
              {canDeleteQuotation &&
                (["draft", "sent", "negotiating"].includes(doc.status) ||
                  (doc.status === "won" && isAdminLike(role))) && (
                  <ContextMenuActionItem
                    action={deleteQuotation}
                    id={doc.id}
                    label="Delete quotation"
                    pendingLabel="Deleting…"
                    variant="danger"
                    confirmMessage={`Permanently delete quotation ${
                      doc.number ?? ""
                    }? This cannot be undone. Use Archive instead to keep the record.`}
                  />
                )}
            </ContextMenu>
        </div>
      </div>

      {/* ---------- NEXT STEP cockpit (proforma-first, guided) ----------
          One panel that answers "what do I do next?" — one primary action per
          status, explicit deposit/balance (decoupled from Won), coaching copy.
          Supersedes the scattered header actions for the commercial doc. */}
      {useCockpit && (
        <DocumentNextStep
          doc={{
            id: doc.id,
            status: doc.status,
            type: (doc as any).type,
            number: doc.number,
          }}
          taskList={
            existingTaskList
              ? { id: existingTaskList.id, number: existingTaskList.number }
              : null
          }
          command={commandDoc}
          hasProductionOrder={!!existingProductionOrder}
          canInvoice={canInvoice}
          invoiceOptions={invoiceOptions}
          currency={docCurrency}
          hasActiveInvoices={hasActiveInvoices}
        />
      )}

      {/* ---------- INVOICES (m141) — redesigned, workflow-first ----------
          One obvious place to create + find invoices, tied to THIS
          commercial document (a proforma is never a prerequisite). */}
      <InvoicesPanel
        doc={{
          id: doc.id,
          number: doc.number ?? null,
          type: (doc as any).type,
          status: doc.status,
          total_price: Number(doc.total_price) || 0,
          currency: docCurrency,
          payment_mode: paymentMode,
          payment_terms: paymentTerms,
        }}
        canInvoice={canInvoice}
        family={invoiceFamily}
      />

      {/* ---------- LIFECYCLE STEPPER (sent and beyond) ----------
          A draft isn't in the order lifecycle yet — the header's action bar
          covers "Continue editing / Mark as sent", so no card is needed. */}
      {doc.status !== "draft" && (
        <section className="panel p-4">
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div>
              <div className="eyebrow">Order lifecycle</div>
              <p className="text-xs text-neutral-500 mt-0.5">
                From quotation to delivery — jump to any stage.
              </p>
            </div>
          </div>
          <WorkflowStepper
            stages={buildLifecycleStages({
              quotationStatus: doc.status,
              quotationId: doc.id,
              hasTaskList: !!existingTaskList,
              taskListStatus: existingTaskList?.status ?? null,
              taskListId: existingTaskList?.id ?? null,
              productionOrderStatus: existingProductionOrder?.status ?? null,
              productionOrderId: existingProductionOrder?.id ?? null,
            })}
          />
        </section>
      )}

      {/* ---------- VERSIONS (V1 / V2 / V3 of this affair) ---------- */}
      <QuotationVersionsPanel
        docId={doc.id}
        rootId={(doc as any).root_document_id ?? null}
        number={doc.number ?? null}
        currentVersion={(doc as any).version ?? 1}
      />

      {/* Project attachments are intentionally NOT shown on the quotation
          page — they belong to the production/task-list workflow. The
          AttachmentsPanel lives on /task-lists/[id] (same affair, so the
          files are shared across every quotation version + the task list). */}

      {/* ---------- VALIDATION (advisory review loop, m068) ---------- */}
      {showValidation && (
        <ValidationPanel
          docId={doc.id}
          status={validation.status}
          requestedByName={
            validation.requested_by
              ? valLabels.get(validation.requested_by) ?? null
              : null
          }
          requestedAt={validation.requested_at}
          note={validation.note}
          reviewedByName={
            validation.reviewed_by
              ? valLabels.get(validation.reviewed_by) ?? null
              : null
          }
          reviewedAt={validation.reviewed_at}
          reviewNote={validation.review_note}
          canReview={canReviewValidation}
          canRequest={canRequestValidation}
        />
      )}

      {/* ---------- FORECAST (active, pre-win deals only) ---------- */}
      {/* The forecast dial only makes sense while the deal is still
          live and being pursued — sent or negotiating. Drafts aren't
          in play yet; won/lost/cancelled are terminal.

          A forecast belongs to the LATEST version of an affair: on a
          superseded version we hide the editor and point to the latest
          version; on the latest version we show the editor (prominent
          when a forecast still has to be (re)done after a revision). */}
      {(doc.status === "sent" || doc.status === "negotiating") &&
        (isLatestVersion ? (
          <ForecastPanel
            documentId={doc.id}
            total={Number(doc.total_price || 0)}
            currency={(doc.currency ?? "USD") as string}
            initialProbability={doc.forecast_probability ?? null}
            initialExpectedCloseDate={doc.forecast_expected_close_date ?? null}
            initialUpdatedAt={doc.forecast_updated_at ?? null}
            prominent={hasMultipleVersions}
          />
        ) : (
          <section className="panel p-4 border-2 border-amber-300 bg-amber-50/60">
            <div className="eyebrow text-amber-800">Forecast</div>
            <p className="text-sm text-amber-900 mt-1">
              This is an earlier version (V{Number((doc as any).version ?? 1)}).
              The forecast is managed on the latest version
              {" "}
              <b>V{latestVersionNum}</b> of this affair.
            </p>
            <Link
              href={`/documents/${latestVersionId}`}
              className="inline-flex items-center gap-1 mt-2 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Go to latest version (V{latestVersionNum}) →
            </Link>
          </section>
        ))}

      <section className="panel p-5">
        <div className="eyebrow mb-2">Bill to</div>
        {client ? (
          <div className="text-sm space-y-0.5">
            <div className="flex items-baseline gap-2">
              <div className="font-semibold text-base">
                {client.company_name}
              </div>
              {client.client_code && (
                <span className="rounded bg-solux-accent px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-widerx text-neutral-700">
                  {client.client_code}
                </span>
              )}
            </div>
            {client.contact_name && <div>{client.contact_name}</div>}
            {client.email && (
              <div className="text-neutral-500">{client.email}</div>
            )}
            {client.phone_number && (
              <div className="text-neutral-500">{client.phone_number}</div>
            )}
            {client.country && (
              <div className="text-neutral-500">{client.country}</div>
            )}
            {clientCustomFields.length > 0 && (
              <dl className="mt-2 pt-2 border-t border-neutral-100 text-xs space-y-0.5">
                {clientCustomFields.map((f, i) => (
                  <div key={i} className="flex gap-2">
                    <dt className="text-neutral-500 min-w-[110px]">
                      {f.label}
                    </dt>
                    <dd className="font-mono">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">—</p>
        )}
      </section>

      <section className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-solux-accent text-left">
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                Product
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                Configuration
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                Tier
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                Qty
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                Original
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                Discount
              </th>
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                Unit
              </th>
              {isAdmin && (
                <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                  Margin
                </th>
              )}
              <th className="px-4 py-2.5 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l: any) => {
              const margin = isAdmin
                ? computeMargin(Number(l.unit_price || 0), costs[l.product_id])
                : null;
              return (
                <tr key={l.id} className="border-t border-neutral-100 align-top">
                  <td className="px-4 py-3 font-medium">
                    <div>
                      {l.products?.name ??
                        l.product_name ??
                        l.client_product_name ??
                        "—"}
                    </div>
                    {(l.products?.name || l.product_name) &&
                      l.client_product_name &&
                      String(l.client_product_name).trim() !== "" && (
                        <div className="text-[11px] text-neutral-600 mt-0.5 font-normal italic">
                          (Client reference: {l.client_product_name})
                        </div>
                      )}
                    {(l.products?.category ?? l.product_category) && (
                      <div className="text-xs text-neutral-500 mt-0.5">
                        {l.products?.category ?? l.product_category}
                      </div>
                    )}
                    {/* Configuration summary moved to the Configuration column. */}
                  </td>
                  <td className="px-4 py-3 text-xs align-top">
                    {(() => {
                      const cfg = (l.config_values ?? {}) as Record<
                        string,
                        string
                      >;
                      // Custom pole spec is shown in the line name, not here.
                      if (isCustomPoleConfig(cfg)) return null;
                      // Skip side-channel keys, resolve "Custom…" sentinels,
                      // render true/false as Yes/No.
                      const rows = Object.entries(cfg)
                        .filter(([k, v]) => {
                          if (isCustomValueKey(k)) return false;
                          if (v == null || v === "" || v === "false") return false;
                          return true;
                        })
                        .map(([k, v]) => {
                          let display: string =
                            v === CUSTOM_OPTION_SENTINEL
                              ? cfg[customValueKey(k)] ?? ""
                              : String(v);
                          if (display === "true") display = "Yes";
                          return [k, display] as const;
                        })
                        .filter(([, v]) => v !== "");
                      const opts = Object.entries(l.selected_options ?? {});
                      if (rows.length === 0 && opts.length === 0)
                        return <span className="text-neutral-400">—</span>;
                      return (
                        <div className="space-y-0.5">
                          {rows.map(([k, display]) => (
                            <div key={k} className="text-neutral-600">
                              <span className="text-neutral-500">{k}:</span>{" "}
                              {display}
                            </div>
                          ))}
                          {opts.map(([k, v]) => (
                            <div key={k} className="text-neutral-600">
                              <span className="text-neutral-500">{k}:</span>{" "}
                              {String(v)}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 capitalize text-neutral-700">
                    {l.pricing_tier ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">{l.quantity}</td>
                  <td className="px-4 py-3 text-right">
                    {l.original_unit_price != null
                      ? Number(l.original_unit_price).toFixed(2)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-neutral-700">
                    {formatDiscount(l.discount_type, Number(l.discount_value))}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {Number(l.unit_price).toFixed(2)}
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right text-xs">
                      {margin ? (
                        <span
                          className={
                            margin.margin >= 0
                              ? "text-emerald-700"
                              : "text-red-700"
                          }
                        >
                          {margin.margin.toFixed(2)} (
                          {margin.marginPct.toFixed(1)}%)
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right font-semibold">
                    {Number(l.total_price).toFixed(2)}
                  </td>
                </tr>
              );
            })}
            {(!lines || lines.length === 0) && (
              <tr>
                <td
                  colSpan={isAdmin ? 9 : 8}
                  className="px-4 py-8 text-center text-neutral-500"
                >
                  No lines.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel p-5 grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-5">
          <div>
            <div className="eyebrow mb-2">Shipping</div>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between">
                <dt className="text-neutral-500">Incoterm</dt>
                <dd>{doc.incoterm ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Port of loading</dt>
                <dd>{doc.port_of_loading ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-neutral-500">Port of destination</dt>
                <dd>{doc.port_of_destination ?? "—"}</dd>
              </div>
              {breakdown.length === 0 ? (
                <div className="flex justify-between">
                  <dt className="text-neutral-500">Freight</dt>
                  <dd>{Number(doc.freight_cost).toFixed(2)}</dd>
                </div>
              ) : (
                <>
                  {breakdown.map((b, i) => (
                    <div className="flex justify-between" key={i}>
                      <dt
                        className={`text-neutral-500 ${
                          b.indented ? "pl-3 italic" : ""
                        }`}
                      >
                        {b.line}
                      </dt>
                      <dd>{b.total.toFixed(2)}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-neutral-200 pt-1 mt-1">
                    <dt className="text-neutral-500">Freight total</dt>
                    <dd className="font-medium">{effectiveFreight.toFixed(2)}</dd>
                  </div>
                </>
              )}
            </dl>
            <ShippingStatusCard
              documentId={doc.id}
              canRequest={canRequestShippingUpdate}
              status={shippingStatus}
              thresholds={freshnessThresholds}
              prefill={shippingPrefill}
              openRequest={shippingOpenRequest}
              history={shippingHistory}
            />
          </div>
          {productionLabel && (
            <div>
              <div className="eyebrow mb-2">Production</div>
              <p className="text-sm">{productionLabel}</p>
            </div>
          )}
          <div>
            <div className="eyebrow mb-2">Payment terms</div>
            <p className="text-sm">{paymentLabel}</p>
          </div>
        </div>
        <div>
          <div className="eyebrow mb-2">Totals</div>
          <dl className="text-sm space-y-1">
            <div className="flex justify-between">
              <dt className="text-neutral-500">Items</dt>
              <dd>{itemsTotal.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-500">Freight</dt>
              <dd>{Number(doc.freight_cost).toFixed(2)}</dd>
            </div>
            {doc.commission_enabled && Number(doc.commission_amount || 0) > 0 && (
              <div className="flex justify-between">
                <dt
                  className={
                    doc.show_commission_in_pdf
                      ? "text-neutral-500"
                      : "text-amber-700"
                  }
                  title={
                    doc.show_commission_in_pdf
                      ? ""
                      : "Internal only — not shown on the customer PDF"
                  }
                >
                  Commission
                  {Number(doc.commission_percentage) > 0 &&
                    ` (${Number(doc.commission_percentage).toFixed(2)}%)`}
                  {!doc.show_commission_in_pdf && (
                    <span className="ml-1 text-[10px] uppercase">internal</span>
                  )}
                </dt>
                <dd>{Number(doc.commission_amount).toFixed(2)}</dd>
              </div>
            )}
            {Number(doc.insurance_cost || 0) > 0 && (
              <div className="flex justify-between">
                <dt className="text-neutral-500">Insurance</dt>
                <dd>{Number(doc.insurance_cost).toFixed(2)}</dd>
              </div>
            )}
            {Array.isArray(doc.additional_charges) &&
              doc.additional_charges
                .filter((c: any) => Number(c?.amount) > 0)
                .map((c: any, i: number) => (
                  <div className="flex justify-between" key={`ac-${i}`}>
                    <dt className="text-neutral-500">
                      {c.label || "Additional charge"}
                    </dt>
                    <dd>{Number(c.amount).toFixed(2)}</dd>
                  </div>
                ))}
            <div className="flex justify-between text-lg font-semibold border-t border-neutral-900 pt-2 mt-2">
              <dt>Grand total</dt>
              <dd>{Number(doc.total_price).toFixed(2)}</dd>
            </div>
            {isAdmin && totalMargin !== null && (
              <div className="flex justify-between text-sm border-t border-neutral-200 pt-2 mt-2">
                <dt className="text-neutral-500">
                  Estimated margin
                  {doc.commission_enabled &&
                    Number(doc.commission_amount || 0) > 0 &&
                    " (after commission)"}
                </dt>
                <dd
                  className={
                    totalMargin >= 0 ? "text-emerald-700" : "text-red-700"
                  }
                >
                  {totalMargin.toFixed(2)}
                </dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      {bankAccount && (
        <section className="panel p-5">
          <div className="eyebrow mb-2">Banking information</div>
          <div className="text-sm space-y-0.5">
            <div className="font-semibold">
              {bankAccount.account_name}{" "}
              <span className="text-xs font-normal text-neutral-500">
                ({bankAccount.currency})
              </span>
            </div>
            {bankAccount.bank_name && <div>{bankAccount.bank_name}</div>}
            {bankAccount.bank_address && (
              <div className="text-neutral-500">{bankAccount.bank_address}</div>
            )}
            <div className="font-mono text-xs space-x-3 pt-1">
              {bankAccount.account_number && (
                <span>A/C {bankAccount.account_number}</span>
              )}
              {bankAccount.swift && <span>SWIFT {bankAccount.swift}</span>}
            </div>
          </div>
        </section>
      )}

      {showSalesConditions && salesCondition && (
        <section className="panel p-5 space-y-2">
          <div className="eyebrow">Sales conditions</div>
          <h3 className="font-semibold">{salesCondition.title}</h3>
          <pre className="whitespace-pre-wrap text-sm text-neutral-700 font-sans leading-relaxed">
            {salesCondition.content}
          </pre>
        </section>
      )}

      {/* Personal reminders — sales tickler for this specific quotation.
          See `components/reminders/` for the full data flow. RLS keeps
          this list scoped to the current user (admins additionally see
          others' reminders via the collapsed "Team reminders" group). */}
      <QuotationRemindersSection
        documentId={doc.id}
        currentUserId={currentUserId}
      />

      {/* Audit timeline — every meaningful change to this quotation lands
          here. Useful both as a "who did what when" log for sales/admin
          and as forensic evidence when a customer disputes a number.
          Placed at the bottom so it doesn't compete with the main doc
          summary; people scroll to it when they have a question. */}
      <section className="panel p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="eyebrow">Activity</div>
            <h3 className="text-sm font-semibold text-neutral-900 mt-0.5">
              Document timeline
            </h3>
          </div>
          <span className="text-[11px] text-neutral-400 tabular-nums">
            {docEvents.length} event{docEvents.length === 1 ? "" : "s"}
          </span>
        </div>
        <Timeline
          events={docEvents}
          actorLabelByUser={docActorLabels}
          emptyMessage="No activity recorded for this quotation yet."
        />
      </section>

      {/* Conversation drawer overlay — opens when ?event=<id> is in
          the URL (notification bell entry point). Doc context stays
          visible behind the drawer. */}
      <EventDiscussionPanel
        eventId={eventDiscussionId}
        expectedEntityId={doc.id}
        currentUserId={currentUserId ?? null}
      />
    </div>
  );
}
