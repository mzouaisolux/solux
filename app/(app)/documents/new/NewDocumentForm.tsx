"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pdf } from "@react-pdf/renderer";
import ProductConfigurator from "@/components/ProductConfigurator";
import QuotationPDF, { type QuotationPDFData } from "@/components/QuotationPDF";
import { CountrySelect } from "@/components/forms/CountrySelect";
import { PhoneField } from "@/components/forms/PhoneField";
import { dialForCountry } from "@/lib/countries";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { saveDocument } from "./actions";
import { savePdfPath } from "../[id]/actions";
import { computeMargin } from "@/lib/pricing";
import {
  formatPaymentTerms,
  normalizePaymentTerms,
  validatePaymentTerms,
} from "@/lib/payment";
import {
  containerLineTotal,
  totalFreight,
  validateProductionTime,
  fromProductionColumns,
} from "@/lib/logistics";
import { commissionAmount } from "@/lib/commission";
import type {
  BalanceCondition,
  BankAccount,
  Client,
  ClientHistoryItem,
  ConfigField,
  ConfigFieldOption,
  ContainerType,
  CostMap,
  Currency,
  DocType,
  DocumentContainer,
  DocumentLine,
  Incoterm,
  LCType,
  Option,
  PaymentMode,
  PaymentTerms,
  PricingTier,
  ProductionMode,
  ProductionTime,
  Product,
  SalesCondition,
  TierPriceMap,
} from "@/lib/types";
import {
  CONTAINER_TYPES,
  CURRENCIES,
  LC_DAYS_OPTIONS,
  containerTypeLabel,
} from "@/lib/types";

const INCOTERMS: Incoterm[] = ["EXW", "FOB", "CFR", "CIF", "DDP", "DDU"];
const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: "deposit_balance", label: "Deposit + Balance" },
  { value: "lc", label: "Letter of Credit" },
  { value: "hybrid", label: "Mixed (Deposit + L/C)" },
];
const PRODUCTION_MODES: { value: ProductionMode; label: string }[] = [
  { value: "working_days", label: "Working days" },
  { value: "calendar_days", label: "Calendar days" },
  { value: "fixed_date", label: "Fixed date" },
];

function emptyContainer(): DocumentContainer {
  return {
    container_type: "40ft HC",
    quantity: 1,
    unit_price: 0,
    wooden_box_cost: 0,
  };
}

function emptyLine(): DocumentLine {
  // Start without a pre-picked product — forces the user through the category
  // picker, which matches the "Step 1: category, Step 2: product" flow.
  return {
    product_id: "",
    quantity: 1,
    selected_options: {},
    unit_price: 0,
    total_price: 0,
    pricing_mode: "auto",
    pricing_tier: "medium",
    original_unit_price: 0,
    discount_type: null,
    discount_value: 0,
    client_product_name: null,
    config_values: {},
  };
}

export default function NewDocumentForm({
  products,
  options,
  clients: initialClients,
  tierPrices,
  costs,
  isAdmin,
  salesConditions,
  bankAccounts,
  configFields,
  configFieldOptions,
  initialDoc = null,
  reviseOfId = null,
  editOfId = null,
  affairId = null,
  projectName = null,
  presetClientId = null,
}: {
  products: Product[];
  options: Option[];
  clients: Client[];
  tierPrices: TierPriceMap;
  costs: CostMap | null;
  isAdmin: boolean;
  salesConditions: SalesCondition[];
  bankAccounts: BankAccount[];
  configFields: ConfigField[];
  configFieldOptions: ConfigFieldOption[];
  /** When set (revision mode, m059), pre-fills the whole builder from a
   *  source quotation; saving creates the next version of that affair. */
  initialDoc?: any | null;
  reviseOfId?: string | null;
  /** When set, the builder EDITS an existing draft in place (same number,
   *  same status); saving updates the document instead of inserting. */
  editOfId?: string | null;
  /** When set (m076), link the new quotation to this project on save and
   *  pre-fill its client. */
  affairId?: string | null;
  projectName?: string | null;
  presetClientId?: string | null;
}) {
  // Revision mode: are we creating a new version of an existing quote?
  const isRevision = !!reviseOfId && !!initialDoc;
  // Edit mode: are we continuing/finishing an existing draft in place?
  const isEdit = !!editOfId && !!initialDoc;
  // Group field options by field_id for fast lookup.
  const optionsByField = new Map<string, ConfigFieldOption[]>();
  for (const o of configFieldOptions) {
    if (!optionsByField.has(o.field_id))
      optionsByField.set(o.field_id, []);
    optionsByField.get(o.field_id)!.push(o);
  }

  // Group config fields by category_id — drives which fields a product shows.
  const fieldsByCategory = new Map<string, ConfigField[]>();
  for (const f of configFields) {
    if (!fieldsByCategory.has(f.category_id))
      fieldsByCategory.set(f.category_id, []);
    fieldsByCategory
      .get(f.category_id)!
      .push({ ...f, options: optionsByField.get(f.id) ?? [] });
  }
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [clientId, setClientId] = useState<string>(
    initialDoc?.client_id ?? presetClientId ?? ""
  );
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClient, setNewClient] = useState({
    company_name: "",
    client_code: "",
    starting_sequence_number: 0,
    contact_name: "",
    email: "",
    phone_number: "",
    phone_country_code: "",
    country: "",
    vat_number: "",
    address: "",
    default_attention_to: "",
  });
  const [newClientCustomFields, setNewClientCustomFields] = useState<
    { label: string; value: string }[]
  >([]);
  const [showNewClientAdvanced, setShowNewClientAdvanced] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);

  const [docType, setDocType] = useState<DocType>(
    (initialDoc?.type as DocType) ?? "quotation"
  );
  const [incoterm, setIncoterm] = useState<Incoterm>(
    (initialDoc?.incoterm as Incoterm) ?? "FOB"
  );
  const [currency, setCurrency] = useState<Currency>(
    (initialDoc?.currency as Currency) ?? "USD"
  );
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState<string>(
    initialDoc?.purchase_order_number ?? ""
  );
  const [affairName, setAffairName] = useState<string>(
    initialDoc?.affair_name ?? projectName ?? ""
  );
  // Advisory validation (m068) — flag the quote for a manager's review as
  // part of saving. Always defaults off: it's a "(re)request on this save"
  // action, not a state mirror. Managing an existing request (withdraw,
  // approve) lives on the quotation's detail page.
  const [requestValidation, setRequestValidation] = useState<boolean>(false);
  const [validationRequestNote, setValidationRequestNote] =
    useState<string>("");

  // Action Center deep-link (?focus=…): scroll to the relevant section, give
  // it a brief highlight, and autofocus the missing field — so clicking "Open"
  // on an action lands the user exactly where the work is (one-click-to-resolve).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (!focus) return;
    const targets: Record<string, { section: string; input?: string }> = {
      shipping: { section: "shipping-section", input: "port_of_destination" },
    };
    const t = targets[focus];
    if (!t) return;
    const timer = window.setTimeout(() => {
      const sec = document.getElementById(t.section);
      if (sec) {
        sec.scrollIntoView({ behavior: "smooth", block: "center" });
        sec.classList.add("ring-2", "ring-amber-400", "ring-offset-2");
        window.setTimeout(
          () => sec.classList.remove("ring-2", "ring-amber-400", "ring-offset-2"),
          2400
        );
      }
      if (t.input) (document.getElementById(t.input) as HTMLInputElement | null)?.focus();
    }, 350);
    return () => window.clearTimeout(timer);
  }, []);
  const [commissionEnabled, setCommissionEnabled] = useState(
    !!initialDoc?.commission_enabled
  );
  const [commissionPercentage, setCommissionPercentage] = useState<number>(
    Number(initialDoc?.commission_percentage ?? 0)
  );
  const [commissionDescription, setCommissionDescription] = useState<string>(
    initialDoc?.commission_description ?? ""
  );
  const [showCommissionInPdf, setShowCommissionInPdf] = useState(
    !!initialDoc?.show_commission_in_pdf
  );
  const [portOfLoading, setPortOfLoading] = useState<string>(
    initialDoc?.port_of_loading ?? "Shanghai"
  );
  const [portOfDestination, setPortOfDestination] = useState<string>(
    initialDoc?.port_of_destination ?? ""
  );
  const [containers, setContainers] = useState<DocumentContainer[]>(
    initialDoc?.containers ?? []
  );
  const [productionTime, setProductionTime] = useState<ProductionTime | null>(
    initialDoc
      ? fromProductionColumns({
          production_mode: initialDoc.production_mode ?? null,
          production_days: initialDoc.production_days ?? null,
          production_date: initialDoc.production_date ?? null,
        })
      : null
  );

  // ---- Sales conditions ----
  const defaultSalesConditionId =
    salesConditions.find((s) => s.is_default)?.id ??
    salesConditions[0]?.id ??
    null;
  const [includeSalesConditions, setIncludeSalesConditions] = useState(
    initialDoc ? !!initialDoc.include_sales_conditions : false
  );
  const [salesConditionsId, setSalesConditionsId] = useState<string | null>(
    initialDoc?.sales_conditions_id ?? defaultSalesConditionId
  );

  // ---- Bank account: auto-select default for the chosen currency ----
  const defaultBankForCurrency = (cur: Currency) =>
    bankAccounts.find((b) => b.currency === cur && b.is_default)?.id ??
    bankAccounts.find((b) => b.currency === cur)?.id ??
    null;
  const [bankAccountId, setBankAccountId] = useState<string | null>(
    initialDoc?.bank_account_id ??
      defaultBankForCurrency((initialDoc?.currency as Currency) ?? "USD")
  );
  // Skip the first run so a revision's seeded bank isn't clobbered on
  // mount; only re-pick the default when the user actually switches
  // currency afterwards.
  const currencyEffectMounted = useRef(false);
  useEffect(() => {
    if (!currencyEffectMounted.current) {
      currencyEffectMounted.current = true;
      return;
    }
    setBankAccountId(defaultBankForCurrency(currency));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  const [paymentMode, setPaymentMode] = useState<PaymentMode>(
    (initialDoc?.payment_mode as PaymentMode) ?? "deposit_balance"
  );
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>(
    (initialDoc?.payment_terms as PaymentTerms) ?? {
      deposit_percent: 30,
      balance_condition: "before_shipment",
    }
  );

  // ---- SALES TERMS ----
  // Warranty: nullable int (years). User picks 3/5/10 (or custom later).
  // Offer validity: two separate windows because product pricing is
  // stable while freight is volatile — defaults match what the user
  // explicitly asked for in the spec (30 days / 7 days).
  const [warrantyYears, setWarrantyYears] = useState<number | null>(
    initialDoc?.warranty_years ?? null
  );
  const [offerValidityProductsDays, setOfferValidityProductsDays] =
    useState<number>(initialDoc?.offer_validity_products_days ?? 30);
  const [offerValidityTransportDays, setOfferValidityTransportDays] =
    useState<number>(initialDoc?.offer_validity_transport_days ?? 7);

  const [lines, setLines] = useState<DocumentLine[]>(
    initialDoc?.lines?.length
      ? (initialDoc.lines as DocumentLine[])
      : products.length
      ? [emptyLine()]
      : []
  );

  const [history, setHistory] = useState<ClientHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const router = useRouter();
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBuilding, setPreviewBuilding] = useState(false);
  const [savingFromPreview, setSavingFromPreview] = useState(false);

  const anyManual = lines.some((l) => l.pricing_mode === "manual");
  const itemsTotal = lines.reduce((s, l) => s + Number(l.total_price || 0), 0);
  const freightTotal = totalFreight(containers);
  const subtotal = itemsTotal + freightTotal;
  const commission = commissionAmount(subtotal, {
    enabled: commissionEnabled,
    percentage: commissionPercentage,
  });
  const grandTotal = subtotal + commission;

  const itemsMargin = isAdmin && costs
    ? lines.reduce((sum, l) => {
        const m = computeMargin(Number(l.unit_price || 0), costs[l.product_id]);
        return sum + (m ? m.margin * Number(l.quantity || 0) : 0);
      }, 0)
    : null;
  // Commission is paid out of the seller's margin.
  const totalMargin =
    itemsMargin === null ? null : itemsMargin - commission;

  // ----- Client history fetch -----
  useEffect(() => {
    if (!clientId) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingHistory(true);
      const supabase = createBrowserSupabase();
      const { data, error: err } = await supabase
        .from("document_lines")
        .select(
          "product_id, selected_options, unit_price, pricing_tier, products(name, category), documents!inner(client_id, date)"
        )
        .eq("documents.client_id", clientId)
        .order("date", { referencedTable: "documents", ascending: false })
        .limit(5);
      if (cancelled) return;
      setLoadingHistory(false);
      if (err) {
        setHistory([]);
        return;
      }
      const mapped: ClientHistoryItem[] = (data ?? []).map((row: any) => ({
        product_id: row.product_id,
        product_name: row.products?.name ?? "—",
        category: row.products?.category ?? null,
        selected_options: (row.selected_options ?? {}) as Record<string, string>,
        unit_price: Number(row.unit_price || 0),
        pricing_tier: (row.pricing_tier ?? null) as PricingTier | null,
        date: row.documents?.date ?? "",
      }));
      setHistory(mapped);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // ----- Handlers -----

  async function handleCreateClient() {
    if (!newClient.company_name.trim()) {
      setError("Company name is required");
      return;
    }
    const code = newClient.client_code.trim().toUpperCase();
    if (!code) {
      setError("Client code is required (3 letters, used in document numbers)");
      return;
    }
    if (!/^[A-Z]{3}$/.test(code)) {
      setError("Client code must be exactly 3 letters (e.g. ARL)");
      return;
    }

    // Validate custom fields: any with a value must have a label.
    const cleanFields = newClientCustomFields
      .map((f) => ({ label: f.label.trim(), value: f.value.trim() }))
      .filter((f) => f.label || f.value);
    for (const f of cleanFields) {
      if (!f.label) {
        setError("Each custom field needs a label.");
        return;
      }
    }

    setError(null);
    setCreatingClient(true);
    const supabase = createBrowserSupabase();
    // m058 RLS requires created_by = auth.uid() on insert — resolve the
    // current user so the new client is owned by its creator.
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    const basePayload = {
      company_name: newClient.company_name.trim(),
      client_code: code,
      starting_sequence_number:
        Number(newClient.starting_sequence_number) || 0,
      contact_name: newClient.contact_name.trim() || null,
      email: newClient.email.trim() || null,
      phone_number: newClient.phone_number.trim() || null,
      country: newClient.country.trim() || null,
      custom_fields: cleanFields,
    };
    // m036 export fields + m051 phone code + m058 owner. Retry without
    // if a column is missing (partial migration history).
    const extraPayload = {
      phone_country_code: newClient.phone_country_code.trim() || null,
      vat_number: newClient.vat_number.trim() || null,
      address: newClient.address.trim() || null,
      default_attention_to: newClient.default_attention_to.trim() || null,
      created_by: authUser?.id ?? null,
    };
    const selectCols =
      "id, company_name, contact_name, email, phone_number, country, client_code, starting_sequence_number, custom_fields";
    let { data, error: err } = await supabase
      .from("clients")
      .insert({ ...basePayload, ...extraPayload })
      .select(selectCols)
      .single();
    if (
      err &&
      /(address|vat_number|default_attention_to|phone_country_code|created_by)/.test(
        err.message ?? ""
      )
    ) {
      ({ data, error: err } = await supabase
        .from("clients")
        .insert(basePayload)
        .select(selectCols)
        .single());
    }
    setCreatingClient(false);

    if (err || !data) {
      setError(err?.message ?? "Failed to create client");
      return;
    }
    setClients((cs) => [data as Client, ...cs]);
    setClientId(data.id);
    setShowNewClient(false);
    setShowNewClientAdvanced(false);
    setNewClient({
      company_name: "",
      client_code: "",
      starting_sequence_number: 0,
      contact_name: "",
      email: "",
      phone_number: "",
      phone_country_code: "",
      country: "",
      vat_number: "",
      address: "",
      default_attention_to: "",
    });
    setNewClientCustomFields([]);
  }

  function applySuggestion(item: ClientHistoryItem) {
    const product = products.find((p) => p.id === item.product_id);
    if (!product) {
      setError("That product is no longer active");
      return;
    }
    setError(null);
    const tier: PricingTier = item.pricing_tier ?? "medium";
    const line: DocumentLine = {
      product_id: item.product_id,
      quantity: 1,
      selected_options: item.selected_options,
      pricing_mode: "manual",
      pricing_tier: tier,
      original_unit_price: item.unit_price,
      unit_price: item.unit_price,
      total_price: item.unit_price,
      discount_type: null,
      discount_value: 0,
      previous_unit_price: item.unit_price,
    };
    setLines((ls) => [...ls, line]);
  }

  function clearSuggestion(index: number) {
    setLines((ls) =>
      ls.map((l, i) => {
        if (i !== index) return l;
        const { previous_unit_price: _omit, ...rest } = l;
        return rest as DocumentLine;
      })
    );
  }

  function handlePaymentModeChange(mode: PaymentMode) {
    setPaymentMode(mode);
    // Seed sensible defaults for the new mode.
    if (mode === "deposit_balance") {
      setPaymentTerms({
        deposit_percent: 30,
        balance_condition: "before_shipment",
      });
    } else if (mode === "lc") {
      setPaymentTerms({ lc_type: "at_sight" });
    } else {
      setPaymentTerms({ deposit_percent: 30, lc_days: 60 });
    }
  }

  function buildPayload() {
    if (!clientId) {
      setError("Please select a client");
      return null;
    }
    if (!lines.length) {
      setError("Add at least one product line");
      return null;
    }
    const normalized = normalizePaymentTerms(paymentMode, paymentTerms);
    const paymentErr = validatePaymentTerms(paymentMode, normalized);
    if (paymentErr) {
      setError(paymentErr);
      return null;
    }
    const productionErr = validateProductionTime(productionTime);
    if (productionErr) {
      setError(productionErr);
      return null;
    }
    const selectedClient = clients.find((c) => c.id === clientId);
    if (!selectedClient?.client_code) {
      setError(
        "The selected client has no 3-letter code. Set one via Clients → Edit before saving."
      );
      return null;
    }
    return {
      type: docType,
      client_id: clientId,
      incoterm,
      currency,
      port_of_loading: portOfLoading.trim() || null,
      port_of_destination: portOfDestination.trim() || null,
      containers: containers.filter((c) => c.quantity > 0),
      manual_pricing: anyManual,
      payment_mode: paymentMode,
      payment_terms: normalized,
      production_time: productionTime,
      // Sales-terms additions (m037). Defaults are mirrored in the form
      // state initialiser so a new draft already carries 30/7.
      warranty_years: warrantyYears,
      offer_validity_products_days: offerValidityProductsDays,
      offer_validity_transport_days: offerValidityTransportDays,
      affair_name: affairName.trim() || null,
      // m076 — link to the real project when creating inside one.
      affair_id: affairId ?? null,
      // m059 — when revising, this save becomes the next version of the
      // source's affair instead of a brand-new quotation.
      revise_of: reviseOfId ?? null,
      // Edit-in-place: when continuing a draft, update it rather than
      // creating a new document (mutually exclusive with revise_of).
      edit_of: editOfId ?? null,
      include_sales_conditions: includeSalesConditions,
      sales_conditions_id: includeSalesConditions ? salesConditionsId : null,
      bank_account_id: bankAccountId,
      purchase_order_number: purchaseOrderNumber.trim() || null,
      commission_enabled: commissionEnabled,
      commission_percentage: Number(commissionPercentage) || 0,
      commission_amount: commission,
      commission_description: commissionDescription.trim() || null,
      show_commission_in_pdf: showCommissionInPdf,
      // Advisory validation (m068) — flag the saved quote for a manager's
      // review. Never blocks the save.
      request_validation: requestValidation,
      validation_request_note: validationRequestNote.trim() || null,
      lines: lines.map(({ previous_unit_price, ...rest }) => rest),
    };
  }

  /**
   * Build the in-memory PDF data for the preview render.
   *
   * `previewNumber` is the document number that will be assigned by
   * `next_client_document_number()` on save. Passing it in here lets
   * the preview render the FINAL document title ("QUOTATION
   * SLX-TST-26-007") instead of an empty placeholder. When omitted,
   * the number falls back to null and the title shows just the doc
   * type — used for very early-stage previews when no client is
   * selected yet.
   */
  function buildPdfData(previewNumber?: string | null): QuotationPDFData {
    const selectedClient = clients.find((c) => c.id === clientId) ?? null;
    const paymentLabel = formatPaymentTerms(paymentMode, paymentTerms);
    const selectedBank =
      bankAccounts.find((b) => b.id === bankAccountId) ?? null;
    const selectedSalesConditions = includeSalesConditions
      ? salesConditions.find((s) => s.id === salesConditionsId) ?? null
      : null;
    const clientForPdf = clients.find((c) => c.id === clientId) ?? null;
    return {
      number: previewNumber ?? null,
      type: docType,
      date: new Date().toISOString(),
      incoterm,
      currency,
      freight_type: null, // legacy field no longer surfaced
      freight_cost: freightTotal,
      port_of_loading: portOfLoading.trim() || null,
      port_of_destination: portOfDestination.trim() || null,
      containers: containers.filter((c) => c.quantity > 0),
      production_time: productionTime,
      bank_account: selectedBank,
      sales_conditions: selectedSalesConditions,
      purchase_order_number: purchaseOrderNumber.trim() || null,
      commission_amount: showCommissionInPdf ? commission : 0,
      commission_visible: showCommissionInPdf,
      commission_description: commissionDescription.trim() || null,
      client_custom_fields:
        clientForPdf?.custom_fields?.filter((f) => f.label && f.value) ?? [],
      total_price: grandTotal,
      payment_label: paymentLabel,
      payment_mode: paymentMode,
      payment_terms: paymentTerms,
      warranty_years: warrantyYears,
      offer_validity_products_days: offerValidityProductsDays,
      offer_validity_transport_days: offerValidityTransportDays,
      client: selectedClient
        ? {
            company_name: selectedClient.company_name,
            contact_name: selectedClient.contact_name,
            email: selectedClient.email,
            phone_number: selectedClient.phone_number,
            country: selectedClient.country,
            address: (selectedClient as any).address ?? null,
            vat_number: (selectedClient as any).vat_number ?? null,
            default_attention_to:
              (selectedClient as any).default_attention_to ?? null,
          }
        : null,
      lines: lines.map((l) => {
        const product = products.find((p) => p.id === l.product_id);
        // Same visibility rule as the doc page: keep only config
        // fields where visible_in_quotation = true AND
        // internal_only = false AND active = true, filtered to the
        // product's category. Lets the live PDF preview match what
        // the server-rendered PDF produces.
        const categoryId = product?.category_id ?? null;
        const allowedFieldNames = new Set<string>(
          (configFields ?? [])
            .filter(
              (f) =>
                f.active &&
                f.visible_in_quotation &&
                !f.internal_only &&
                (categoryId ? f.category_id === categoryId : true)
            )
            .map((f) => f.field_name)
        );
        const visible_config_fields: Array<{
          field_name: string;
          value: string;
        }> = [];
        const cv = (l.config_values ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(cv)) {
          if (v == null) continue;
          const str = String(v).trim();
          if (str === "") continue;
          if (!allowedFieldNames.has(k)) continue;
          visible_config_fields.push({ field_name: k, value: str });
        }
        return {
          // Internal product name is always the primary display. For a
          // free-text line (no catalogue product — e.g. a Project Product),
          // its own name lives in client_product_name, so promote that to the
          // primary description instead of showing "—".
          product_name: product?.name ?? l.client_product_name?.trim() ?? "—",
          // Optional client-facing alias — shown as "(Client reference: ...)".
          // Suppressed for free-text lines (it's already the primary name).
          client_product_name: product
            ? l.client_product_name?.trim() || null
            : null,
          category: product?.category ?? null,
          selected_options: l.selected_options,
          visible_config_fields,
          quantity: Number(l.quantity || 0),
          unit_price: Number(l.unit_price || 0),
          total_price: Number(l.total_price || 0),
          pricing_mode: l.pricing_mode,
          pricing_tier: l.pricing_tier,
          original_unit_price: l.original_unit_price,
          discount_type: l.discount_type,
          discount_value: l.discount_value,
        };
      }),
    };
  }

  async function handlePreview() {
    setError(null);
    if (!buildPayload()) return; // reuse validation; payload not needed yet
    setPreviewBuilding(true);
    try {
      // Peek at the document number that next_client_document_number()
      // WILL return when the doc is saved, so the preview renders the
      // canonical reference ("QUOTATION SLX-TST-26-007") instead of a
      // bare "QUOTATION". The RPC is pure — it doesn't allocate, just
      // looks at the existing rows for this client and computes the
      // next sequence — so calling it here is safe and idempotent.
      let previewNumber: string | null = null;
      if (clientId) {
        const supabase = createBrowserSupabase();
        const { data: nextNum, error: nextErr } = await supabase.rpc(
          "next_client_document_number",
          { client_id_in: clientId }
        );
        if (!nextErr && typeof nextNum === "string") {
          previewNumber = nextNum;
        }
      }
      const blob = await pdf(
        <QuotationPDF data={buildPdfData(previewNumber)} />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      setPreviewBlob(blob);
      setPreviewUrl(url);
    } catch (e: any) {
      setError(e?.message ?? "Failed to build preview");
    } finally {
      setPreviewBuilding(false);
    }
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewBlob(null);
  }

  function handleDownloadFromPreview() {
    if (!previewBlob || !previewUrl) return;
    const selectedClient = clients.find((c) => c.id === clientId);
    const filename = `${docType}-${(selectedClient?.company_name ?? "draft")
      .replace(/[^\w\-]+/g, "_")
      .toLowerCase()}.pdf`;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function persist(blob: Blob | null) {
    const payload = buildPayload();
    if (!payload) return;

    setError(null);
    try {
      const { id } = await saveDocument(payload);
      if (blob) {
        const supabase = createBrowserSupabase();
        const path = `${id}.pdf`;
        const { error: upErr } = await supabase.storage
          .from("documents")
          .upload(path, blob, {
            contentType: "application/pdf",
            upsert: true,
          });
        if (upErr) throw new Error(upErr.message);
        await savePdfPath(id, path);
      }
      router.push(`/documents/${id}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    }
  }

  function handleSaveFromPreview() {
    if (!previewBlob) return;
    setSavingFromPreview(true);
    startTransition(async () => {
      await persist(previewBlob);
      setSavingFromPreview(false);
    });
  }

  async function handleSaveAndGenerate() {
    setError(null);
    if (!buildPayload()) return;
    startTransition(async () => {
      try {
        const blob = await pdf(<QuotationPDF data={buildPdfData()} />).toBlob();
        await persist(blob);
      } catch (e: any) {
        setError(e?.message ?? "Failed to save");
      }
    });
  }

  async function handleSaveDraft() {
    setError(null);
    if (!buildPayload()) return;
    // Save as draft = save the document without generating a PDF. The status
    // defaults to "draft" on the server, the user can return to the doc page
    // to keep editing, mark it as sent, or generate the PDF later.
    startTransition(async () => {
      await persist(null);
    });
  }

  if (!products.length) {
    return (
      <div className="rounded-lg border bg-white p-6">
        <p>
          No active products. Ask an admin to add products before creating a
          quotation.
        </p>
      </div>
    );
  }

  // ---- Summary data (consumed by the sticky right sidebar) ----
  const selectedClientObj = clients.find((c) => c.id === clientId) ?? null;
  const linesWithProducts = lines
    .map((l) => ({
      line: l,
      product: products.find((p) => p.id === l.product_id) ?? null,
    }))
    .filter((x) => x.product);
  const itemsCount = linesWithProducts.reduce(
    (s, x) => s + Number(x.line.quantity || 0),
    0
  );
  const containerCount = containers
    .filter((c) => c.quantity > 0)
    .reduce((s, c) => s + Number(c.quantity), 0);
  const marginPct =
    isAdmin && totalMargin !== null && grandTotal > 0
      ? (totalMargin / grandTotal) * 100
      : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
      <div className="space-y-5 min-w-0 overflow-hidden">
      {isEdit && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-widerx text-sky-800">
            Continuing a draft
          </div>
          <p className="text-sm text-sky-900 mt-1">
            You&apos;re editing draft{" "}
            <span className="font-mono font-semibold">
              {initialDoc?.source_number ?? "—"}
            </span>
            {initialDoc?.affair_name ? <> · {initialDoc.affair_name}</> : null}.
            Saving updates this same quotation — the number stays the same. It
            only enters the order lifecycle once you mark it as sent.
          </p>
        </div>
      )}
      {isRevision && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-widerx text-amber-800">
            New version of an existing quotation
          </div>
          <p className="text-sm text-amber-900 mt-1">
            You&apos;re creating the next version of{" "}
            <span className="font-mono font-semibold">
              {initialDoc?.source_number ?? "—"}
            </span>
            {initialDoc?.affair_name ? (
              <> · {initialDoc.affair_name}</>
            ) : null}
            . The original stays untouched — this saves as a new draft in the
            same affair, with the next version number.
          </p>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {isEdit
            ? `Edit draft · ${docType}`
            : isRevision
            ? `New version · ${docType}`
            : `New ${docType}`}
        </h1>
        <div className="flex flex-col items-end gap-2">
          <div className="inline-flex rounded border overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setDocType("quotation")}
              className={`px-3 py-1 ${
                docType === "quotation" ? "bg-black text-white" : "bg-white"
              }`}
            >
              Quotation
            </button>
            <button
              type="button"
              onClick={() => setDocType("proforma")}
              className={`px-3 py-1 ${
                docType === "proforma" ? "bg-black text-white" : "bg-white"
              }`}
            >
              Proforma
            </button>
          </div>
          <label className="text-sm flex items-center gap-2">
            <span className="text-neutral-500 text-xs uppercase tracking-widerx">
              PO #
            </span>
            <input
              type="text"
              value={purchaseOrderNumber}
              onChange={(e) => setPurchaseOrderNumber(e.target.value)}
              placeholder="optional"
              className="rounded border border-neutral-200 px-2 py-1 text-sm w-40 font-mono"
            />
          </label>
        </div>
      </div>

      {/* ---------- CLIENT ---------- */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Client</h2>
          <button
            type="button"
            onClick={() => setShowNewClient((v) => !v)}
            className="text-sm text-solux-dark hover:underline"
          >
            {showNewClient ? "Cancel" : "+ New client"}
          </button>
        </div>

        {affairId && (
          <div className="rounded-md bg-solux/10 px-3 py-2 text-[13px] text-solux-dark ring-1 ring-inset ring-solux/30">
            Creating a quotation in project:{" "}
            <strong>{projectName ?? "this project"}</strong>
          </div>
        )}

        {!showNewClient ? (
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full rounded border px-3 py-2"
          >
            <option value="">— select a client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
                {c.country ? ` (${c.country})` : ""}
              </option>
            ))}
          </select>
        ) : (
          <div className="rounded border border-neutral-200 bg-neutral-50/40 p-4 space-y-4">
            {/* Required: identity + code */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="block md:col-span-2">
                <span className="text-xs text-neutral-500 uppercase tracking-widerx">
                  Company name *
                </span>
                <input
                  value={newClient.company_name}
                  onChange={(e) =>
                    setNewClient({
                      ...newClient,
                      company_name: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-xs text-neutral-500 uppercase tracking-widerx">
                  Client code * (3 letters)
                </span>
                <input
                  value={newClient.client_code}
                  maxLength={3}
                  placeholder="e.g. ARL"
                  onChange={(e) =>
                    setNewClient({
                      ...newClient,
                      client_code: e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z]/g, ""),
                    })
                  }
                  className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 font-mono uppercase"
                />
              </label>
            </div>

            {/* Contact info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                placeholder="Contact person"
                value={newClient.contact_name}
                onChange={(e) =>
                  setNewClient({ ...newClient, contact_name: e.target.value })
                }
                className="rounded border border-neutral-200 px-3 py-2"
              />
              <div>
                <CountrySelect
                  name="__new_client_country"
                  defaultValue={newClient.country}
                  placeholder="Country"
                  onSelect={(country) =>
                    setNewClient((c) => ({
                      ...c,
                      country,
                      // Prefill the dial code from the country when empty.
                      phone_country_code:
                        c.phone_country_code ||
                        dialForCountry(country) ||
                        "",
                    }))
                  }
                />
              </div>
              <input
                placeholder="Email"
                type="email"
                value={newClient.email}
                onChange={(e) =>
                  setNewClient({ ...newClient, email: e.target.value })
                }
                className="rounded border border-neutral-200 px-3 py-2"
              />
              <PhoneField
                phoneCodeName="__new_client_phone_code"
                phoneNumberName="__new_client_phone_number"
                defaultCode={newClient.phone_country_code}
                defaultNumber={newClient.phone_number}
                key={newClient.phone_country_code || "nophone"}
                onChange={({ code, number }) =>
                  setNewClient((c) => ({
                    ...c,
                    phone_country_code: code,
                    phone_number: number,
                  }))
                }
              />
            </div>

            {/* Advanced (collapsible): starting sequence + custom fields */}
            <div className="border-t border-neutral-200 pt-3">
              <button
                type="button"
                onClick={() => setShowNewClientAdvanced((v) => !v)}
                className="text-sm text-neutral-600 hover:text-neutral-900"
              >
                {showNewClientAdvanced ? "▾" : "▸"} Advanced — starting sequence &amp; tax/registration fields
              </button>

              {showNewClientAdvanced && (
                <div className="mt-3 space-y-4">
                  <label className="block">
                    <span className="text-xs text-neutral-500 uppercase tracking-widerx">
                      Starting sequence number
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={newClient.starting_sequence_number}
                      onChange={(e) =>
                        setNewClient({
                          ...newClient,
                          starting_sequence_number:
                            parseInt(e.target.value) || 0,
                        })
                      }
                      className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
                    />
                    <span className="block text-xs text-neutral-500 mt-1">
                      How many quotations this client had before this app.
                      Their first quotation here will be{" "}
                      <code>
                        SLX-{newClient.client_code || "XXX"}-
                        {new Date().toLocaleDateString("en-US", {
                          year: "2-digit",
                        })}
                        -
                        {String(
                          (Number(newClient.starting_sequence_number) || 0) + 1
                        ).padStart(3, "0")}
                      </code>
                      .
                    </span>
                  </label>

                  {/* Structured export-document fields — same set as the
                      standalone client form + edit form, so the three
                      creation paths stay unified. */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs text-neutral-500 uppercase tracking-widerx">
                        Default attention to
                      </span>
                      <input
                        value={newClient.default_attention_to}
                        placeholder="Purchasing Department"
                        onChange={(e) =>
                          setNewClient({
                            ...newClient,
                            default_attention_to: e.target.value,
                          })
                        }
                        className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-neutral-500 uppercase tracking-widerx">
                        VAT / Tax number
                      </span>
                      <input
                        value={newClient.vat_number}
                        placeholder="GB287451982"
                        onChange={(e) =>
                          setNewClient({
                            ...newClient,
                            vat_number: e.target.value,
                          })
                        }
                        className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 font-mono"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-xs text-neutral-500 uppercase tracking-widerx">
                      Full address (appears on the PDF)
                    </span>
                    <textarea
                      value={newClient.address}
                      rows={3}
                      placeholder={"123 Industrial Way\nLondon, EC1A 1BB\nUnited Kingdom"}
                      onChange={(e) =>
                        setNewClient({
                          ...newClient,
                          address: e.target.value,
                        })
                      }
                      className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
                    />
                  </label>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs text-neutral-500 uppercase tracking-widerx">
                          Tax / registration fields
                        </span>
                        <p className="text-xs text-neutral-500">
                          Optional. Examples: VAT, SIRET, SRU, Tax ID. Only
                          filled rows appear on the PDF.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setNewClientCustomFields((f) => [
                            ...f,
                            { label: "", value: "" },
                          ])
                        }
                        className="text-sm text-solux-dark hover:underline"
                      >
                        + Add field
                      </button>
                    </div>

                    {newClientCustomFields.length === 0 ? (
                      <p className="text-xs text-neutral-500 italic">
                        No custom fields yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {newClientCustomFields.map((f, i) => (
                          <div
                            key={i}
                            className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center"
                          >
                            <input
                              value={f.label}
                              placeholder="Label (e.g. VAT)"
                              onChange={(e) =>
                                setNewClientCustomFields((prev) =>
                                  prev.map((x, idx) =>
                                    idx === i
                                      ? { ...x, label: e.target.value }
                                      : x
                                  )
                                )
                              }
                              className="rounded border border-neutral-200 px-3 py-1.5 text-sm"
                            />
                            <input
                              value={f.value}
                              placeholder="Value (e.g. FR123456)"
                              onChange={(e) =>
                                setNewClientCustomFields((prev) =>
                                  prev.map((x, idx) =>
                                    idx === i
                                      ? { ...x, value: e.target.value }
                                      : x
                                  )
                                )
                              }
                              className="rounded border border-neutral-200 px-3 py-1.5 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setNewClientCustomFields((prev) =>
                                  prev.filter((_, idx) => idx !== i)
                                )
                              }
                              className="rounded border border-neutral-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleCreateClient}
                disabled={creatingClient}
                className="rounded bg-solux px-4 py-2 text-white font-medium hover:bg-solux-dark disabled:opacity-50"
              >
                {creatingClient ? "Creating…" : "Save client"}
              </button>
            </div>
          </div>
        )}

        {/* ---------- CLIENT HISTORY ---------- */}
        {clientId && (
          <div className="mt-2 rounded border bg-neutral-50 p-3">
            <div className="text-sm font-medium mb-2">
              Previously used for this client
              {loadingHistory && (
                <span className="ml-2 text-xs text-neutral-500">loading…</span>
              )}
            </div>
            {history.length === 0 && !loadingHistory ? (
              <p className="text-xs text-neutral-500">
                No prior purchases from this client.
              </p>
            ) : (
              <ul className="divide-y">
                {history.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start justify-between gap-3 py-2 text-sm"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{item.product_name}</div>
                      <div className="text-xs text-neutral-600">
                        {Object.entries(item.selected_options).length === 0
                          ? "No options"
                          : Object.entries(item.selected_options)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(" · ")}
                        {item.pricing_tier && (
                          <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] uppercase">
                            {item.pricing_tier}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-neutral-500 mt-0.5">
                        Last unit price: <b>{item.unit_price.toFixed(2)}</b> ·{" "}
                        {item.date
                          ? new Date(item.date).toLocaleDateString("en-GB")
                          : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => applySuggestion(item)}
                      className="shrink-0 rounded border bg-white px-2 py-1 text-xs hover:bg-neutral-50"
                    >
                      Use as suggestion
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ---------- AFFAIR / PROJECT NAME ----------
          Sits between Client and Products. Prominent because we work
          by project — this internal label shows next to the code in
          every list. */}
      <section className="rounded-lg border border-solux/30 bg-solux/5 p-4">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-widerx text-solux-dark">
            Affair / project name
          </span>
          <input
            type="text"
            value={affairName}
            onChange={(e) => setAffairName(e.target.value)}
            placeholder="e.g. Benin Highway Solar Upgrade"
            className="mt-1.5 w-full rounded-md border border-neutral-300 px-3 py-2.5 text-base font-medium focus:border-solux focus:outline-none focus:ring-1 focus:ring-solux"
          />
          <span className="block text-[11px] text-neutral-500 mt-1.5">
            Internal only — appears beside the quotation code in lists.
            Easier to recognise than <code>SLX-…</code>.
          </span>
        </label>
      </section>

      {/* ---------- VALIDATION REQUEST (advisory, m068) ----------
          Optional: flag the quote for a manager's review on save. Never
          blocks saving or sending — it sets the quote "Awaiting review"
          and notifies management. You can also do this later from the
          quotation's page. */}
      <section className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={requestValidation}
            onChange={(e) => setRequestValidation(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-solux focus:ring-solux/40"
          />
          <span>
            <span className="block text-sm font-medium text-neutral-900">
              Request management validation
            </span>
            <span className="block text-[11px] text-neutral-500 mt-0.5">
              Flags this quote for a manager to review (e.g. an unusual
              discount or payment terms). Advisory only — it never blocks
              saving or sending.
            </span>
          </span>
        </label>
        {requestValidation && (
          <textarea
            value={validationRequestNote}
            onChange={(e) => setValidationRequestNote(e.target.value)}
            rows={2}
            placeholder="Why does this need a second opinion? (optional)"
            className="mt-2.5 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-solux focus:outline-none focus:ring-1 focus:ring-solux"
          />
        )}
      </section>

      {/* ---------- LINES ---------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Products</h2>
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, emptyLine()])}
            className="text-sm text-solux-dark hover:underline"
            title="Add a standard product from the catalogue (spare parts, accessories, extra luminaires…)"
          >
            + Add catalogue product
          </button>
        </div>

        {lines.map((line, i) => (
          <ProductConfigurator
            key={i}
            products={products}
            options={options}
            tierPrices={tierPrices}
            costs={costs}
            isAdmin={isAdmin}
            fieldsByCategory={fieldsByCategory}
            value={line}
            onChange={(next) =>
              setLines((ls) => ls.map((l, idx) => (idx === i ? next : l)))
            }
            onRemove={
              lines.length > 1
                ? () => setLines((ls) => ls.filter((_, idx) => idx !== i))
                : undefined
            }
            onClearSuggestion={
              line.previous_unit_price !== undefined
                ? () => clearSuggestion(i)
                : undefined
            }
          />
        ))}
      </section>

      {/* ---------- SHIPPING ---------- */}
      <section
        id="shipping-section"
        className="rounded-lg border bg-white p-4 space-y-4 scroll-mt-24 transition-shadow rounded-lg"
      >
        <h2 className="text-lg font-semibold">Shipping</h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-sm font-medium">Currency</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="mt-1 w-full rounded border px-3 py-2"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Incoterm</span>
            <select
              value={incoterm}
              onChange={(e) => setIncoterm(e.target.value as Incoterm)}
              className="mt-1 w-full rounded border px-3 py-2"
            >
              {INCOTERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Port of loading</span>
            <input
              type="text"
              value={portOfLoading}
              onChange={(e) => setPortOfLoading(e.target.value)}
              placeholder="e.g. Shanghai"
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Port of destination</span>
            <input
              id="port_of_destination"
              type="text"
              value={portOfDestination}
              onChange={(e) => setPortOfDestination(e.target.value)}
              placeholder="e.g. Cotonou"
              className="mt-1 w-full rounded border px-3 py-2 scroll-mt-24"
            />
          </label>
        </div>

        {/* Containers */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Freight rows</div>
              <div className="text-xs text-neutral-500">
                Add LCL / Groupage or container rows. For LCL, you can also
                add a <b>wooden box packaging</b> cost. Line total ={" "}
                <code>quantity × unit price + wooden box</code>.
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                setContainers((cs) => [...cs, emptyContainer()])
              }
              className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
            >
              + Add freight row
            </button>
          </div>

          <div className="rounded-lg border border-neutral-200 overflow-hidden">
            <table className="w-full text-sm">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[10%]" />
                <col className="w-[16%]" />
                <col className="w-[28%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead>
                <tr className="bg-solux-accent text-left">
                  <th className="px-3 py-2 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                    Type
                  </th>
                  <th className="px-3 py-2 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                    Qty
                  </th>
                  <th className="px-3 py-2 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                    Unit price
                  </th>
                  <th className="px-3 py-2 font-semibold text-xs uppercase tracking-widerx text-neutral-700">
                    Wooden box (LCL only)
                  </th>
                  <th className="px-3 py-2 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                    Line total
                  </th>
                  <th className="px-3 py-2 font-semibold text-xs uppercase tracking-widerx text-neutral-700 text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {containers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-neutral-500 text-sm bg-white"
                    >
                      No freight rows yet. Click{" "}
                      <b className="text-neutral-700">+ Add freight row</b> if
                      this quotation includes shipping.
                    </td>
                  </tr>
                ) : (
                  containers.map((c, i) => {
                    const isLCL = c.container_type === "LCL";
                    const hasWoodenBox =
                      isLCL && Number(c.wooden_box_cost || 0) > 0;
                    const lineTotal = containerLineTotal(c);
                    return (
                      <tr
                        key={i}
                        className="border-t border-neutral-100 bg-white align-top"
                      >
                        <td className="px-3 py-2">
                          <select
                            value={c.container_type}
                            onChange={(e) => {
                              const nextType = e.target.value as ContainerType;
                              setContainers((cs) =>
                                cs.map((x, idx) =>
                                  idx === i
                                    ? {
                                        ...x,
                                        container_type: nextType,
                                        // Reset wooden box when leaving LCL
                                        wooden_box_cost:
                                          nextType === "LCL"
                                            ? x.wooden_box_cost ?? 0
                                            : 0,
                                      }
                                    : x
                                )
                              );
                            }}
                            className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm"
                          >
                            {CONTAINER_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {containerTypeLabel(t)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={c.quantity}
                            onChange={(e) =>
                              setContainers((cs) =>
                                cs.map((x, idx) =>
                                  idx === i
                                    ? {
                                        ...x,
                                        quantity:
                                          parseInt(e.target.value) || 0,
                                      }
                                    : x
                                )
                              )
                            }
                            className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm text-right tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={c.unit_price}
                            onChange={(e) =>
                              setContainers((cs) =>
                                cs.map((x, idx) =>
                                  idx === i
                                    ? {
                                        ...x,
                                        unit_price:
                                          parseFloat(e.target.value) || 0,
                                      }
                                    : x
                                )
                              )
                            }
                            className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm text-right tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2">
                          {isLCL ? (
                            <div className="space-y-1.5">
                              <label className="flex items-center gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={hasWoodenBox}
                                  onChange={(e) =>
                                    setContainers((cs) =>
                                      cs.map((x, idx) =>
                                        idx === i
                                          ? {
                                              ...x,
                                              wooden_box_cost: e.target.checked
                                                ? Number(x.wooden_box_cost) > 0
                                                  ? x.wooden_box_cost
                                                  : 0.01
                                                : 0,
                                            }
                                          : x
                                      )
                                    )
                                  }
                                />
                                Wooden box packaging
                              </label>
                              {hasWoodenBox && (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={c.wooden_box_cost ?? 0}
                                  onChange={(e) =>
                                    setContainers((cs) =>
                                      cs.map((x, idx) =>
                                        idx === i
                                          ? {
                                              ...x,
                                              wooden_box_cost:
                                                parseFloat(e.target.value) || 0,
                                            }
                                          : x
                                      )
                                    )
                                  }
                                  placeholder="Box cost"
                                  className="w-full rounded border border-neutral-200 px-2 py-1 text-xs text-right tabular-nums"
                                />
                              )}
                            </div>
                          ) : (
                            <span className="text-neutral-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">
                          {lineTotal.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setContainers((cs) =>
                                cs.filter((_, idx) => idx !== i)
                              )
                            }
                            className="rounded border border-neutral-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {containers.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-neutral-800 bg-white">
                    <td
                      colSpan={4}
                      className="px-3 py-2.5 text-right font-semibold uppercase tracking-widerx text-xs text-neutral-700"
                    >
                      Freight total
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-base">
                      {freightTotal.toFixed(2)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </section>

      {/* ---------- PRODUCTION TIME ---------- */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">Production time</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-sm font-medium">Type</span>
            <select
              value={productionTime?.mode ?? ""}
              onChange={(e) => {
                const mode = e.target.value as ProductionMode | "";
                if (!mode) {
                  setProductionTime(null);
                } else if (mode === "fixed_date") {
                  setProductionTime({ mode, date: "" });
                } else {
                  setProductionTime({ mode, days: 25 });
                }
              }}
              className="mt-1 w-full rounded border px-3 py-2"
            >
              <option value="">— Not specified —</option>
              {PRODUCTION_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          {productionTime &&
            (productionTime.mode === "working_days" ||
              productionTime.mode === "calendar_days") && (
              <label className="block">
                <span className="text-sm font-medium">Number of days</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={productionTime.days ?? ""}
                  onChange={(e) =>
                    setProductionTime({
                      ...productionTime,
                      days: parseInt(e.target.value) || 0,
                    })
                  }
                  className="mt-1 w-full rounded border px-3 py-2"
                />
              </label>
            )}

          {productionTime && productionTime.mode === "fixed_date" && (
            <label className="block">
              <span className="text-sm font-medium">Completion date</span>
              <input
                type="date"
                value={productionTime.date ?? ""}
                onChange={(e) =>
                  setProductionTime({
                    ...productionTime,
                    date: e.target.value || null,
                  })
                }
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
          )}
        </div>
      </section>

      {/* ---------- PAYMENT & SALES TERMS ----------
          One commercial-envelope section. Sales sees them together
          because the PDF renders them as a single SALES TERMS block.
          Internally split into two sub-blocks (Payment / Sales terms)
          so the form doesn't read as a wall of inputs. */}
      <section className="rounded-lg border bg-white p-4 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Payment &amp; Sales Terms</h2>
          <p className="text-xs text-neutral-500">
            All five fields render together in the SALES TERMS section of
            the proforma / quotation PDF.
          </p>
        </div>

        {/* ---- PAYMENT sub-block ---- */}
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-500">
            Payment
          </div>

          <div className="inline-flex rounded border overflow-hidden text-sm">
            {PAYMENT_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => handlePaymentModeChange(m.value)}
                className={`px-3 py-1 ${
                  paymentMode === m.value ? "bg-black text-white" : "bg-white"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

        {paymentMode === "deposit_balance" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Deposit %</span>
              <input
                type="number"
                min={0}
                max={100}
                step="1"
                value={paymentTerms.deposit_percent ?? ""}
                onChange={(e) =>
                  setPaymentTerms({
                    ...paymentTerms,
                    deposit_percent: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Balance condition</span>
              <select
                value={paymentTerms.balance_condition ?? ""}
                onChange={(e) =>
                  setPaymentTerms({
                    ...paymentTerms,
                    balance_condition: (e.target.value || undefined) as
                      | BalanceCondition
                      | undefined,
                  })
                }
                className="mt-1 w-full rounded border px-3 py-2"
              >
                <option value="before_shipment">Before shipment</option>
                <option value="against_documents">Against documents</option>
              </select>
            </label>
          </div>
        )}

        {paymentMode === "lc" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">LC type</span>
              <select
                value={paymentTerms.lc_type ?? ""}
                onChange={(e) =>
                  setPaymentTerms({
                    ...paymentTerms,
                    lc_type: (e.target.value || undefined) as LCType | undefined,
                    lc_days:
                      e.target.value === "at_sight" ? undefined : paymentTerms.lc_days,
                  })
                }
                className="mt-1 w-full rounded border px-3 py-2"
              >
                <option value="at_sight">At sight</option>
                <option value="usance">Usance</option>
              </select>
            </label>
            {paymentTerms.lc_type === "usance" && (
              <label className="block">
                <span className="text-sm font-medium">Tenor (days)</span>
                <select
                  value={paymentTerms.lc_days ?? ""}
                  onChange={(e) =>
                    setPaymentTerms({
                      ...paymentTerms,
                      lc_days: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  <option value="">— select —</option>
                  {LC_DAYS_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {paymentMode === "hybrid" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Deposit %</span>
              <input
                type="number"
                min={0}
                max={100}
                step="1"
                value={paymentTerms.deposit_percent ?? ""}
                onChange={(e) =>
                  setPaymentTerms({
                    ...paymentTerms,
                    deposit_percent: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">L/C tenor (days)</span>
              <select
                value={paymentTerms.lc_days ?? ""}
                onChange={(e) =>
                  setPaymentTerms({
                    ...paymentTerms,
                    lc_days: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                className="mt-1 w-full rounded border px-3 py-2"
              >
                <option value="">— select —</option>
                {LC_DAYS_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

          <p className="text-xs text-neutral-600">
            Preview:{" "}
            <b>{formatPaymentTerms(paymentMode, paymentTerms)}</b>
          </p>
        </div>
        {/* close PAYMENT sub-block */}

        {/* ---- Visual divider between the two sub-blocks ---- */}
        <div className="border-t border-neutral-100" />

        {/* ---- SALES TERMS sub-block ---- */}
        <div className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-500">
            Sales terms
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-sm font-medium">
                Warranty{" "}
                <span className="text-xs text-neutral-500">(years)</span>
              </span>
              <select
                value={warrantyYears ?? ""}
                onChange={(e) =>
                  setWarrantyYears(
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                className="mt-1 w-full rounded border px-3 py-2"
              >
                <option value="">— select —</option>
                <option value="3">3 years</option>
                <option value="5">5 years</option>
                <option value="10">10 years</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium">
                Product offer validity{" "}
                <span className="text-xs text-neutral-500">(days)</span>
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={offerValidityProductsDays}
                onChange={(e) =>
                  setOfferValidityProductsDays(
                    e.target.value === ""
                      ? 30
                      : Math.max(1, Number(e.target.value))
                  )
                }
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">
                Freight offer validity{" "}
                <span className="text-xs text-neutral-500">(days)</span>
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={offerValidityTransportDays}
                onChange={(e) =>
                  setOfferValidityTransportDays(
                    e.target.value === ""
                      ? 7
                      : Math.max(1, Number(e.target.value))
                  )
                }
                className="mt-1 w-full rounded border px-3 py-2"
              />
            </label>
          </div>

          <p className="text-[11px] text-neutral-500 leading-relaxed">
            PDF preview:{" "}
            <b className="text-neutral-700">
              {warrantyYears
                ? `Warranty: ${warrantyYears} years · `
                : "Warranty: — · "}
              Product offer validity: {offerValidityProductsDays} days ·
              Freight offer validity: {offerValidityTransportDays} days
            </b>
          </p>
        </div>
      </section>

      {/* ---------- BANK ACCOUNT ---------- */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Banking information</h2>
            <p className="text-xs text-neutral-500">
              Auto-selects the default account for the quotation currency (
              <b>{currency}</b>). Override below if needed.
            </p>
          </div>
          {bankAccounts.length === 0 && (
            <a
              href="/admin/banks"
              className="text-sm text-solux-dark hover:underline"
            >
              Add an account →
            </a>
          )}
        </div>

        {bankAccounts.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No bank accounts configured yet. An admin can add them in{" "}
            <b>Admin → Bank accounts</b>.
          </p>
        ) : (
          <>
            <select
              value={bankAccountId ?? ""}
              onChange={(e) => setBankAccountId(e.target.value || null)}
              className="w-full rounded border border-neutral-200 px-3 py-2"
            >
              <option value="">— No bank account —</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  [{b.currency}] {b.account_name}
                  {b.is_default ? " (default)" : ""}
                </option>
              ))}
            </select>
            {bankAccountId && (
              <div className="rounded border border-neutral-100 bg-neutral-50 p-3 text-xs space-y-0.5">
                {(() => {
                  const b = bankAccounts.find((x) => x.id === bankAccountId);
                  if (!b) return null;
                  return (
                    <>
                      <div className="font-semibold">{b.account_name}</div>
                      {b.bank_name && <div>{b.bank_name}</div>}
                      {b.bank_address && (
                        <div className="text-neutral-500">{b.bank_address}</div>
                      )}
                      <div className="font-mono">
                        {b.account_number && `A/C ${b.account_number}`}
                        {b.account_number && b.swift && " · "}
                        {b.swift && `SWIFT ${b.swift}`}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </section>

      {/* ---------- SALES CONDITIONS ---------- */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Sales conditions</h2>
            <p className="text-xs text-neutral-500">
              Append a standard conditions block to the PDF. Optional.
            </p>
          </div>
          {salesConditions.length === 0 && (
            <a
              href="/admin/sales-conditions"
              className="text-sm text-solux-dark hover:underline"
            >
              Add a template →
            </a>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeSalesConditions}
            onChange={(e) => setIncludeSalesConditions(e.target.checked)}
            disabled={salesConditions.length === 0}
          />
          Include sales conditions
        </label>

        {includeSalesConditions && salesConditions.length > 0 && (
          <>
            {salesConditions.length > 1 && (
              <select
                value={salesConditionsId ?? ""}
                onChange={(e) => setSalesConditionsId(e.target.value || null)}
                className="w-full rounded border border-neutral-200 px-3 py-2"
              >
                {salesConditions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                    {s.is_default ? " (default)" : ""}
                  </option>
                ))}
              </select>
            )}
            {salesConditionsId && (
              <pre className="whitespace-pre-wrap text-xs text-neutral-700 font-sans rounded border border-neutral-100 bg-neutral-50 p-3 max-h-48 overflow-y-auto">
                {salesConditions.find((s) => s.id === salesConditionsId)?.content}
              </pre>
            )}
          </>
        )}
      </section>

      {/* ---------- COMMISSION ---------- */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Commission</h2>
            <p className="text-xs text-neutral-500">
              Track payments to facilitators or intermediaries. Applied on top
              of (items + freight) and {isAdmin && "reduces margin internally"}
              {isAdmin && " — "}
              optionally visible to the client on the PDF.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={commissionEnabled}
            onChange={(e) => setCommissionEnabled(e.target.checked)}
          />
          Enable commission
        </label>

        {commissionEnabled && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium">Percentage (%)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={commissionPercentage}
                  onChange={(e) =>
                    setCommissionPercentage(parseFloat(e.target.value) || 0)
                  }
                  className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">
                  Description{" "}
                  <span className="text-xs text-neutral-500">(internal)</span>
                </span>
                <input
                  type="text"
                  value={commissionDescription}
                  onChange={(e) => setCommissionDescription(e.target.value)}
                  placeholder="Commission for local facilitator in Senegal"
                  className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showCommissionInPdf}
                onChange={(e) => setShowCommissionInPdf(e.target.checked)}
              />
              Show commission line on the customer PDF
            </label>

            <div className="rounded border border-neutral-100 bg-neutral-50 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-neutral-500">Subtotal (items + freight)</span>
                <span className="tabular-nums">{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">
                  Commission ({Number(commissionPercentage || 0).toFixed(2)}%)
                </span>
                <span className="tabular-nums font-medium">
                  {commission.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ---------- TOTALS + SUBMIT ---------- */}
      <section className="rounded-lg border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span>Items total</span>
          <span>{itemsTotal.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span>
            Freight
            {containers.filter((c) => c.quantity > 0).length > 0 &&
              ` (${containers
                .filter((c) => c.quantity > 0)
                .reduce((s, c) => s + Number(c.quantity), 0)} container${
                containers
                  .filter((c) => c.quantity > 0)
                  .reduce((s, c) => s + Number(c.quantity), 0) === 1
                  ? ""
                  : "s"
              })`}
          </span>
          <span>{freightTotal.toFixed(2)}</span>
        </div>
        {commissionEnabled && commission > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span>
              Commission ({Number(commissionPercentage || 0).toFixed(2)}%)
            </span>
            <span>{commission.toFixed(2)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-lg font-semibold border-t pt-2">
          <span>Grand total</span>
          <span>{grandTotal.toFixed(2)}</span>
        </div>

        {isAdmin && totalMargin !== null && (
          <div className="flex items-center justify-between text-sm border-t pt-2">
            <span className="text-neutral-600">Estimated margin (admin)</span>
            <span
              className={
                totalMargin >= 0 ? "text-emerald-700" : "text-red-700"
              }
            >
              {totalMargin.toFixed(2)}
            </span>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isPending || previewBuilding}
            className="btn-secondary"
            title={
              isEdit
                ? "Save your changes to this draft — no PDF generated."
                : "Save as draft — no PDF generated. You can come back and finalize later."
            }
          >
            {isPending
              ? "Saving…"
              : isEdit
              ? "Save changes"
              : "Save draft"}
          </button>
          <button
            type="button"
            onClick={handleSaveAndGenerate}
            disabled={isPending || previewBuilding}
            className="btn-secondary"
            title="Save document + generate PDF in one click"
          >
            {isPending ? "Working…" : "Finalize & generate"}
          </button>
          <button
            type="button"
            onClick={handlePreview}
            disabled={isPending || previewBuilding}
            className="btn-primary"
          >
            {previewBuilding ? "Preparing…" : "Preview PDF"}
          </button>
        </div>
      </section>
      </div>

      {/* ---------- STICKY SIDEBAR — compact summary ---------- */}
      <aside className="lg:sticky lg:top-20 h-fit space-y-2.5 text-sm">
        {/* Header: status + number */}
        <div className="panel px-3 py-2.5 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widerx text-neutral-500 leading-none">
              {docType}
            </div>
            <div className="font-mono text-[11px] text-neutral-700 mt-1 truncate">
              {selectedClientObj?.client_code
                ? `SLX-${selectedClientObj.client_code}-${new Date()
                    .getFullYear()
                    .toString()
                    .slice(2)}-…`
                : "New draft"}
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-solux px-2 py-0.5 text-[10px] font-semibold text-white shrink-0">
            <span className="h-1 w-1 rounded-full bg-white" />
            DRAFT
          </span>
        </div>

        {/* Products — compact list, name · qty · line subtotal */}
        {linesWithProducts.length > 0 && (
          <div className="panel px-3 py-2.5 text-xs">
            <div className="text-[10px] uppercase tracking-widerx text-neutral-500 mb-1.5">
              Products ({linesWithProducts.length})
            </div>
            <ul className="divide-y divide-neutral-100">
              {linesWithProducts.map((x, i) => (
                <li key={i} className="py-1.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-neutral-800 truncate leading-tight">
                      {x.product?.name}
                    </span>
                    <span className="tabular-nums shrink-0 text-neutral-700">
                      {currency} {Number(x.line.total_price || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="text-[11px] text-neutral-500 leading-tight">
                    Qty: {x.line.quantity}
                    {x.line.client_product_name && (
                      <span className="italic">
                        {" "}
                        · {x.line.client_product_name}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Totals — only freight + grand total */}
        <div className="panel px-3 py-2.5 space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-neutral-500">Freight</span>
            <span className="tabular-nums">
              {currency} {freightTotal.toFixed(2)}
            </span>
          </div>
          {commissionEnabled && commission > 0 && (
            <div className="flex justify-between">
              <span className="text-neutral-500">Commission</span>
              <span className="tabular-nums">
                {currency} {commission.toFixed(2)}
              </span>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-neutral-200 pt-1.5 mt-1">
            <span className="text-xs font-semibold uppercase tracking-widerx text-neutral-600">
              Grand total
            </span>
            <span className="font-semibold text-sm tabular-nums">
              {currency} {grandTotal.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Payment — single line */}
        <div className="panel px-3 py-2.5 text-xs">
          <div className="text-[10px] uppercase tracking-widerx text-neutral-500 mb-1">
            Payment
          </div>
          <p className="text-neutral-700 leading-snug">
            {formatPaymentTerms(paymentMode, paymentTerms)}
          </p>
        </div>

        {/* Margin (admin only) */}
        {isAdmin && totalMargin !== null && (
          <div className="panel bg-neutral-50 px-3 py-2.5 text-xs space-y-1">
            <div className="text-[10px] uppercase tracking-widerx text-neutral-500">
              Internal · not on PDF
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Est. margin</span>
              <span
                className={`tabular-nums font-medium ${
                  totalMargin >= 0 ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {currency} {totalMargin.toFixed(2)}
              </span>
            </div>
            {marginPct !== null && (
              <div className="flex justify-between">
                <span className="text-neutral-500">Margin %</span>
                <span
                  className={`tabular-nums ${
                    marginPct >= 0 ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  {marginPct.toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* ---------- PREVIEW MODAL ---------- */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/50 p-4 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[95vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="text-lg font-semibold">Preview</h3>
                <p className="text-xs text-neutral-500">
                  Nothing is saved yet. Choose Save to store this document, or
                  Download to keep it locally.
                </p>
              </div>
              <button
                type="button"
                onClick={closePreview}
                disabled={savingFromPreview}
                className="text-2xl leading-none text-neutral-500 hover:text-neutral-900 disabled:opacity-50"
                aria-label="Close preview"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-hidden bg-neutral-100">
              <iframe
                src={previewUrl}
                className="w-full h-[75vh]"
                title="Quotation preview"
              />
            </div>
            <div className="flex items-center justify-end gap-3 p-4 border-t bg-neutral-50">
              <button
                type="button"
                onClick={closePreview}
                disabled={savingFromPreview}
                className="rounded border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleDownloadFromPreview}
                disabled={savingFromPreview}
                className="rounded border px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                Download
              </button>
              <button
                type="button"
                onClick={handleSaveFromPreview}
                disabled={savingFromPreview}
                className="rounded bg-solux px-3 py-2 text-sm text-white font-medium hover:bg-solux-dark disabled:opacity-50"
              >
                {savingFromPreview ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
