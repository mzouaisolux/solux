import { createClient } from "@/lib/supabase/server";
import NewDocumentForm from "./NewDocumentForm";
import { loadCostingSettings } from "@/lib/pricing-settings";
import { computeCostingStatus } from "@/lib/costing-validity";
import { getEffectiveRole } from "@/lib/auth";
import { buildTierPriceMap, buildTierPriceMapByCategory } from "@/lib/pricing";
import { getCataloguePriceVisibility } from "@/lib/pricing-visibility";
import { getQuotePricingContext } from "@/lib/price-lists";
import type { CostMap } from "@/lib/types";

export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams?: { revise?: string; edit?: string; affair?: string; client?: string; product?: string };
}) {
  const supabase = createClient();

  const { effectiveRole: role, userId } = await getEffectiveRole();
  const isAdmin = role === "admin";

  // m142 — TEMPORARY test-phase flag: hide catalogue prices from sales.
  // Decided HERE on the server so a hidden user's browser never receives the
  // tier prices at all (not just visually hidden). Exempt users (admin floor /
  // pricing.view_catalogue_prices) keep prices + get the "admin only" badge.
  const priceVisibility = await getCataloguePriceVisibility(supabase);

  // Pricing v4: which seller's price list applies to this quote? The deal
  // owner when editing/revising an existing doc, else the current user.
  let sourceOwnerId: string | null = null;

  // ---- Revision (m059) + edit-in-place --------------------------------
  // ?revise=<docId> → pre-fill a copy that saves as the next version of
  //                   the affair (the source stays untouched).
  // ?edit=<docId>   → pre-fill the SAME draft; saving updates it in place
  //                   (same number/status). Used by "Continue editing".
  // Both load identical initial state — only the save target differs, so
  // the heavy fetch below is shared. RLS scopes the read to owner / tech.
  const reviseOfId = searchParams?.revise || null;
  const editOfId = searchParams?.edit || null;
  const sourceId = reviseOfId || editOfId;

  // m076 — create a quotation INSIDE a project (?affair=<id>): pre-fill the
  // project's client and link the new document to the affair on save.
  const affairParamId = searchParams?.affair || null;
  let projectCtx:
    | { id: string; name: string | null; client_id: string | null }
    | null = null;
  if (affairParamId) {
    const { data } = await supabase
      .from("affairs")
      .select("id, name, client_id")
      .eq("id", affairParamId)
      .maybeSingle();
    projectCtx = (data as any) ?? null;
  }
  // CRM refactor: launched from a Client Workspace (?client=<id>) — pre-fill
  // and LOCK the client so it is never re-selected.
  const clientParamId = searchParams?.client || null;
  // W4 — when launched from a client, load that client's live affairs so the
  // quote can be attached to one (a quotation must belong to an affaire).
  let clientAffairs: { id: string; name: string }[] = [];
  if (clientParamId) {
    const { data: aff } = await supabase
      .from("affairs")
      .select("id, name")
      .eq("client_id", clientParamId)
      .is("archived_at", null)
      .not("status", "in", "(lost,abandoned)")
      .order("created_at", { ascending: false });
    clientAffairs = (aff ?? []) as { id: string; name: string }[];
  }
  let initialDoc: any = null;
  if (sourceId) {
    // Full select first; fall back to a legacy shape if a newer column
    // (m037 sales terms / m056 affair) is missing in this env.
    const fullCols =
      "id, number, type, status, client_id, incoterm, currency, freight_cost, freight_type, purchase_order_number, affair_name, commission_enabled, commission_percentage, commission_description, show_commission_in_pdf, port_of_loading, port_of_destination, payment_mode, payment_terms, production_mode, production_days, production_date, include_sales_conditions, sales_conditions_id, bank_account_id, warranty_years, offer_validity_products_days, offer_validity_transport_days, version, root_document_id, created_by, sales_owner_id, original_sales_request, insurance_cost, additional_charges";
    const legacyCols =
      "id, number, type, status, client_id, incoterm, currency, freight_cost, freight_type, purchase_order_number, commission_enabled, commission_percentage, commission_description, show_commission_in_pdf, port_of_loading, port_of_destination, payment_mode, payment_terms, production_mode, production_days, production_date, include_sales_conditions, sales_conditions_id, bank_account_id, created_by, original_sales_request";
    let srcRes = await supabase
      .from("documents")
      .select(fullCols)
      .eq("id", sourceId)
      .maybeSingle();
    if (srcRes.error) {
      srcRes = await supabase
        .from("documents")
        .select(legacyCols)
        .eq("id", sourceId)
        .maybeSingle();
    }
    const src: any = srcRes.data;
    if (src) {
      sourceOwnerId = src.sales_owner_id ?? src.created_by ?? null;
      const [{ data: srcLines }, { data: srcContainers }] = await Promise.all([
        // Resilient to a not-yet-applied m139 (pricing_source & friends): fall
        // back to the pre-m139 column list so edit/revise still loads its lines.
        (async () => {
          // THREE-stage fallback: m140 (source_component) → m139 (lock cols)
          // → base, so any partially-migrated env still loads its lines.
          const base =
            "product_id, category_id, quantity, selected_options, unit_price, total_price, pricing_mode, pricing_tier, original_unit_price, discount_type, discount_value, client_product_name, config_values";
          const m139 = `${base}, pricing_source, source_project_request_id, approved_by, approved_at`;
          const m140 = `${m139}, source_component`;
          for (const cols of [m140, m139, base]) {
            const res = await supabase
              .from("document_lines")
              .select(cols)
              .eq("document_id", sourceId);
            if (!res.error) return res;
          }
          return { data: [] } as any;
        })(),
        // Resilient to a missing wooden_box_cost column (migration 007).
        (async () => {
          const full = await supabase
            .from("document_containers")
            .select("container_type, quantity, unit_price, wooden_box_cost, position")
            .eq("document_id", sourceId)
            .order("position", { ascending: true });
          if (!full.error) return full;
          return await supabase
            .from("document_containers")
            .select("container_type, quantity, unit_price, position")
            .eq("document_id", sourceId)
            .order("position", { ascending: true });
        })(),
      ]);
      initialDoc = {
        ...src,
        source_number: src.number ?? null,
        source_version: src.version ?? 1,
        lines: (srcLines ?? []).map((l: any) => ({
          product_id: l.product_id,
          category_id: l.category_id ?? null, // m133 — preserve family across revise/edit
          quantity: Number(l.quantity ?? 1),
          selected_options: l.selected_options ?? {},
          unit_price: Number(l.unit_price ?? 0),
          total_price: Number(l.total_price ?? 0),
          pricing_mode: l.pricing_mode ?? "auto",
          pricing_tier: l.pricing_tier ?? "medium",
          original_unit_price: Number(l.original_unit_price ?? 0),
          discount_type: l.discount_type ?? null,
          discount_value: Number(l.discount_value ?? 0),
          client_product_name: l.client_product_name ?? null,
          config_values: l.config_values ?? {},
          // m139 — preserve the price lock across edit/revise (same commercial
          // lineage). The approved SR price stays protected from catalogue
          // re-reads even after re-opening the builder.
          pricing_source: l.pricing_source ?? null,
          source_project_request_id: l.source_project_request_id ?? null,
          approved_by: l.approved_by ?? null,
          approved_at: l.approved_at ?? null,
          source_component: l.source_component ?? null, // m140
        })),
        containers: (() => {
          const mapped = (srcContainers ?? []).map((c: any) => ({
            container_type: c.container_type,
            quantity: Number(c.quantity ?? 1),
            unit_price: Number(c.unit_price ?? 0),
            wooden_box_cost: Number(c.wooden_box_cost ?? 0),
          }));
          // Legacy / scalar freight: a doc can carry freight as the
          // `freight_cost` scalar (+ optional `freight_type`) without any
          // document_containers rows (e.g. older quotations, or freight saved
          // before the per-container model). The view falls back to that
          // scalar, so the editor must too — seed one editable container so the
          // freight isn't silently dropped on edit.
          if (mapped.length === 0 && Number(src.freight_cost ?? 0) > 0) {
            const KINDS = ["LCL", "20ft", "40ft", "40ft HC"];
            return [
              {
                container_type: KINDS.includes(src.freight_type) ? src.freight_type : "40ft HC",
                quantity: 1,
                unit_price: Number(src.freight_cost ?? 0),
                wooden_box_cost: 0,
              },
            ];
          }
          return mapped;
        })(),
      };
    }
  }

  // m140/m153 — costing-validity notice for SR-derived quotes being edited/
  // revised. Server-computed (RSC data flow), fallback-guarded, non-blocking:
  // the builder banner only informs; requesting a revision lives on the
  // locked line card. "Duplicate" = ?revise= — covered by the same path.
  let costingNotice: { status: "aging" | "expired"; label: string } | null = null;
  try {
    const srIds = Array.from(
      new Set(
        ((initialDoc?.lines ?? []) as any[])
          .filter((l) => l.pricing_source === "approved_service_request")
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
      const oldest = ((snaps.data ?? []) as any[])
        .map((s) => s.priced_at as string | null)
        .filter(Boolean)
        .sort()[0] as string | undefined;
      const v = computeCostingStatus(
        oldest ?? null,
        new Date().toISOString().slice(0, 10),
        settings
      );
      if (v.status === "aging" || v.status === "expired") {
        costingNotice = { status: v.status, label: v.label };
      }
    }
  } catch {
    /* unmigrated env — dormant */
  }

  // Resolve which published price list applies to the deal's seller per
  // product category (pricing v5) + display/diagnostic context.
  const sellerId = sourceOwnerId ?? userId;
  const pricingCtx = await getQuotePricingContext(sellerId);
  const categoryListMap = pricingCtx.categoryListMap;

  const [
    { data: products },
    { data: options },
    { data: clients },
    { data: salesConditions },
    { data: bankAccounts },
    { data: configFields },
    { data: configFieldOptions },
  ] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, sku, category, category_id, base_price, image_url, active")
      .eq("active", true)
      .order("name"),
    supabase
      .from("options")
      .select("id, product_id, option_type, option_value, price_modifier"),
    supabase
      .from("clients")
      .select("id, company_name, contact_name, email, phone_number, country, client_code, starting_sequence_number, custom_fields")
      .order("company_name"),
    supabase
      .from("sales_conditions")
      .select("id, title, content, is_default")
      .order("is_default", { ascending: false })
      .order("title"),
    supabase
      .from("bank_accounts")
      .select(
        "id, account_name, business_account_name, currency, bank_name, bank_address, account_number, swift, is_default"
      )
      .order("currency")
      .order("is_default", { ascending: false })
      .order("account_name"),
    supabase
      .from("config_fields")
      .select(
        "id, category_id, field_name, field_type, required, default_value, placeholder, field_order, visible_in_quotation, visible_in_task_list, internal_only, allow_custom_value, active"
      )
      .eq("active", true)
      .eq("visible_in_quotation", true)
      .order("field_order")
      .order("field_name"),
    supabase
      .from("config_field_options")
      .select("id, field_id, option_value, option_order")
      .order("option_order"),
  ]);

  // Price each product from the published list chosen for its category. If
  // no published lists resolve (v5 not applied / nothing published), fall back
  // to the legacy newest-price-per-(product,tier) so quoting never breaks.
  let tierPrices;
  const chosenListIds = Array.from(new Set(categoryListMap.values()));
  if (chosenListIds.length > 0) {
    const productCategory = new Map<string, string | null>();
    for (const p of products ?? []) productCategory.set(p.id, (p as any).category_id ?? null);
    const { data: listPrices, error: listErr } = await supabase
      .from("prices_version")
      .select("product_id, price, valid_from, pricing_tier, price_list_id")
      .in("price_list_id", chosenListIds)
      .order("valid_from", { ascending: false });
    if (!listErr) {
      tierPrices = buildTierPriceMapByCategory((listPrices ?? []) as any, productCategory, categoryListMap);
    }
  }
  // Legacy all-prices fallback: ONLY for a genuinely pre-v5 env (no price
  // lists exist at all). Once price lists are in use (m087+), a category with
  // no catalogue-enabled published list (m170) must stay unpriced — falling
  // back to every price here would leak a price the admin chose NOT to sell
  // from the catalogue. So we gate the fallback on hasAnyPriceList.
  if (!tierPrices && !pricingCtx.hasAnyPriceList) {
    const { data: legacyPrices } = await supabase
      .from("prices_version")
      .select("product_id, price, valid_from, pricing_tier")
      .order("valid_from", { ascending: false });
    tierPrices = buildTierPriceMap((legacyPrices ?? []) as any);
  }
  if (!tierPrices) tierPrices = {};

  // Stale-link guard — a ?client= / ?affair= id can outlive its row (deleting
  // a client SET NULLs its affairs, m076 FK). Locking the builder onto a
  // phantom id renders a working-looking form whose first write dies on the
  // FK (quickCreateAffair → 23503 → 500), so degrade to the normal unlocked
  // flow with a notice. Validated against the clients list fetched above —
  // the same list the form renders from — no extra query.
  let staleLinkNotice: string | null = null;
  let liveClientParamId = clientParamId;
  if (clientParamId && !(clients ?? []).some((c: any) => c.id === clientParamId)) {
    liveClientParamId = null;
    staleLinkNotice =
      "The client this link pointed to no longer exists — it may have been deleted. Select a client below.";
  }
  if (affairParamId && projectCtx && !projectCtx.client_id) {
    staleLinkNotice = `Project “${projectCtx.name ?? "(unnamed)"}” is no longer attached to a client (its client was deleted). Select a client and project below.`;
    projectCtx = null;
  } else if (affairParamId && !projectCtx) {
    staleLinkNotice =
      "The project this link pointed to no longer exists. Select a client and project below.";
  }

  // Knowledge Hub "Add to quote" (?product=<sku>): seed a FRESH quote with one
  // catalogue line for that product (same line shape the revise path uses).
  // Ignored when revising/editing an existing document.
  let presetLine: any = null;
  const productSku = searchParams?.product || null;
  if (productSku && !sourceId) {
    const p = (products ?? []).find((x: any) => x.sku === productSku);
    if (p) {
      presetLine = {
        product_id: p.id,
        category_id: (p as any).category_id ?? null,
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
  }

  // Admin-only: cost prices. Sales users literally can't read this (RLS).
  let costs: CostMap | null = null;
  if (isAdmin) {
    const { data: costRows } = await supabase
      .from("product_costs")
      .select("product_id, cost_price");
    costs = {};
    for (const row of costRows ?? []) {
      costs[row.product_id] = Number(row.cost_price);
    }
  }

  return (
    <div className="solux-pro mx-auto max-w-screen-2xl px-6 py-8">
      {/* Pricing source — shows which published price list(s) feed this quote,
          and warns when an assigned list hasn't been published yet.
          m142 — hidden entirely for a price-hidden user (it's catalogue-pricing
          chrome that makes no sense when no catalogue price is shown), and
          replaced by the "admin only" reminder for exempt users. */}
      {priceVisibility.hidden ? null : priceVisibility.adminOverride ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50/70 px-4 py-2 text-sm text-amber-900">
          <span className="font-medium">Catalogue prices are hidden for sales</span>{" "}
          (test phase) — you see them because of your permissions. Sales reps price
          via approved Service Requests or manual entry only.
        </div>
      ) : pricingCtx.appliedLists.length > 0 ? (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50/70 px-4 py-2 text-sm text-emerald-900">
          <span className="font-medium">Pricing from your price list{pricingCtx.appliedLists.length > 1 ? "s" : ""}:</span>{" "}
          {pricingCtx.appliedLists.map((l, i) => (
            <span key={l.id}>
              {i > 0 ? " · " : ""}
              {l.name}
              {l.categoryName ? ` (${l.categoryName})` : ""}
            </span>
          ))}
          {pricingCtx.assignedUnpublished.length > 0 && (
            <span className="ml-2 text-amber-700">
              — note: {pricingCtx.assignedUnpublished.map((l) => `“${l.name}” (${l.status})`).join(", ")} not published yet.
            </span>
          )}
        </div>
      ) : pricingCtx.assignedUnpublished.length > 0 ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50/70 px-4 py-2 text-sm text-amber-900">
          <span className="font-medium">Your assigned price list isn&apos;t live yet:</span>{" "}
          {pricingCtx.assignedUnpublished.map((l) => `“${l.name}” (${l.status})`).join(", ")}. Ask an admin to{" "}
          <b>Publish</b> it in Pricing — until then standard prices are used.
        </div>
      ) : (
        <div className="mb-4 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-2 text-sm text-neutral-600">
          Using standard pricing — no published price list is assigned to you.
        </div>
      )}
      {/* m140 — non-blocking costing-validity notice (aging/expired). The
          request action lives on the locked line card below. */}
      {costingNotice && (
        <div
          className={`mx-auto mb-4 max-w-5xl rounded-lg border px-4 py-3 text-sm ${
            costingNotice.status === "expired"
              ? "border-rose-300 bg-rose-50 text-rose-800"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          <span className="font-semibold">
            {costingNotice.status === "expired"
              ? "✗ Costing status: Expired. "
              : "⚠ Costing status: Aging. "}
          </span>
          {costingNotice.label}. Component prices, freight costs and exchange
          rates may have changed — you can continue with the current pricing,
          or request a costing revision from the product card below.
        </div>
      )}
      <NewDocumentForm
        key={sourceId ?? affairParamId ?? clientParamId ?? (presetLine ? `product:${productSku}` : "new")}
        presetLine={presetLine}
        products={products ?? []}
        options={options ?? []}
        clients={clients ?? []}
        tierPrices={priceVisibility.hidden ? {} : tierPrices}
        hideCataloguePrices={priceVisibility.hidden}
        adminPriceOverride={priceVisibility.adminOverride}
        costs={costs}
        isAdmin={isAdmin}
        salesConditions={(salesConditions ?? []) as any}
        bankAccounts={(bankAccounts ?? []) as any}
        configFields={(configFields ?? []) as any}
        configFieldOptions={(configFieldOptions ?? []) as any}
        catalogueBlockedCategoryIds={Array.from(pricingCtx.blockedCategoryIds)}
        initialDoc={initialDoc}
        {...(() => {
          // Auto-versioning (owner 2026-07-06): "Edit" on a document that is
          // no longer a draft silently becomes "create the next version" —
          // the form opens in revision mode (clear banner, save = V{n+1});
          // the sent original stays untouched. Sales never think about it.
          const editTargetLocked =
            !!editOfId && initialDoc && initialDoc.status !== "draft";
          return {
            reviseOfId: reviseOfId ?? (editTargetLocked ? editOfId : null),
            editOfId: editTargetLocked ? null : editOfId,
          };
        })()}
        affairId={projectCtx?.id ?? null}
        projectName={projectCtx?.name ?? null}
        presetClientId={projectCtx?.client_id ?? liveClientParamId}
        lockClient={!!liveClientParamId}
        clientAffairs={clientAffairs}
        staleLinkNotice={staleLinkNotice}
      />
    </div>
  );
}
