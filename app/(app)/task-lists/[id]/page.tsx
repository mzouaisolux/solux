import "./tasklist.css";
// Render fresh: the factory-mapping "missing" count + Release-button state must
// reflect mappings saved in the autonomous zone immediately (#12). force-dynamic
// makes this route's reads no-store WITHOUT the app-wide cache penalty.
export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import TaskLineEditor from "./TaskLineEditor";
import { ProductSummaryCard } from "@/components/documents/ProductSummaryCard";
import { AttachmentsPanel } from "@/components/attachments/AttachmentsPanel";
import { StickerRequirementsEditor } from "@/components/documents/StickerRequirementsEditor";
import { RiskFlagsEditor } from "@/components/documents/RiskFlagsEditor";
import { IndustrialFileEditor } from "@/components/documents/IndustrialFileEditor";
import {
  PreValidationBoard,
  type BoardAiField,
} from "@/components/PreValidationBoard";
import { RevisionsPanel } from "@/components/RevisionsPanel";
import {
  diffSnapshots,
  isFrozenStatus,
  type RevisionFieldChange,
} from "@/lib/task-list-revisions";
import {
  buildTaskListSnapshot,
  fetchRevisions,
} from "@/lib/task-list-revisions-server";
import {
  normalizeActionItem,
  type TaskListActionItem,
} from "@/lib/task-list-action-items";
import { normalizeRiskFlags } from "@/lib/risks";
import { normalizeAiReview } from "@/lib/lighting/ai-review";
import { formatTiltAngle } from "@/lib/industrial-spec";
import {
  normalizeTiltProvenance,
  tiltConflictPending,
  type TiltProvenance,
} from "@/lib/tilt-provenance";
import {
  deriveOrderedFamilies,
  normalizeDictionaryItem,
  type DictionaryItem,
} from "@/lib/industrial-dictionary";
import ProductLightingSetupForm from "@/components/lighting/ProductLightingSetupForm";
import {
  normalizeFactoryExtras,
  type FactoryExtras,
} from "@/lib/factory-extras";
import { ValidationHistory } from "@/components/documents/ValidationHistory";
import { resolveUserLabelStrings } from "@/lib/user-display";
import ProductionDossierActions from "./ProductionDossierActions";
import ExportExcelButton from "./ExportExcelButton";
import TaskListWorkflowActions, {
  TaskListStatusBadge,
} from "@/components/TaskListWorkflow";
import { DirtyWrapper } from "./DirtyWrapper";
import { deleteTaskList, updateTaskListHeader } from "./actions";
import { hasUiCapability } from "@/lib/permissions";
import { DangerDeleteButton } from "@/components/DangerDeleteButton";
import { SubmitButton } from "@/components/SubmitButton";
import { Timeline } from "@/components/Timeline";
import { listEventsForEntity } from "@/lib/events";
import {
  EventDiscussionPanel,
  parseEventSearchParam,
} from "@/components/dashboard/EventDiscussionPanel";
import { formatPaymentTerms } from "@/lib/payment";
import { formatProductionTime, fromProductionColumns } from "@/lib/logistics";
import { countMissingMappings, countRequiredEmpty } from "@/lib/task-list-mapping-status";
import { isManualLine } from "@/lib/manual-items";
import {
  revisionCategoryLabel,
  type RevisionThreadInfo,
} from "@/lib/revision-shared";
import {
  TASK_LIST_LOCKED_FOR_SALES,
  isTechnicalRole,
  optionLookupKey,
  type ConfigField,
  type ConfigFieldOption,
  type FactoryMapping,
  type ProductionMode,
  type ProductionTaskListStatus,
} from "@/lib/types";

export default async function TaskListDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { event?: string | string[]; validated?: string };
}) {
  const supabase = createClient();
  const { userId: currentUserId, effectiveRole: role } = await getEffectiveRole();
  // ?event=<uuid> auto-opens the conversation drawer overlaid on this
  // task list — drives the notification "land on context + thread" flow.
  const eventDiscussionId = parseEventSearchParam(searchParams?.event);
  const technical = isTechnicalRole(role);
  // Capability-gated destructive action — hide the "Delete task list"
  // button entirely for roles without the capability so they can't
  // even attempt it. Backend still enforces via requireCapability().
  const canDeleteTaskList = await hasUiCapability("task_list.delete");
  // Capability-gated workflow actions (UI only — backend re-checks via
  // requireCapability). A technical role WITHOUT these (e.g. Operations once
  // the matrix removes them) sees the task list read-only instead of active
  // Validate/Reject buttons that error on click.
  const canValidateTaskList = await hasUiCapability("task_list.validate");
  const canRejectTaskList = await hasUiCapability("task_list.reject");

  const [{ data: task }, { data: lines }] = await Promise.all([
    supabase
      .from("production_task_lists")
      .select(
        // PTL columns + the linked document's logistics/commercial fields
        // (incoterm, ports, payment, currency, freight). We surface
        // those as read-only context on the PTL page so the production
        // team doesn't have to bounce back to the quotation. Single
        // source of truth stays on the document — PTL only stores
        // overrides (shipping_method) on its own row.
        "id, number, status, date, shipping_method, production_notes, technical_notes, quotation_id, affair_id, client_id, created_by, submitted_at, factory_sent_at, original_sales_request, clients(company_name, country, contact_name, client_code), documents:quotation_id(number, type, date, affair_name, incoterm, freight_type, freight_cost, port_of_loading, port_of_destination, currency, payment_mode, payment_terms, production_mode, production_days, production_date, total_price)"
      )
      .eq("id", params.id)
      .maybeSingle(),
    supabase
      .from("production_task_list_lines")
      .select(
        // NB: the m135 manual-item columns (is_manual, unit_price, manual_specs)
        // are fetched SEPARATELY + defensively below so this page renders even
        // before the migration is applied (same pattern as sticker/risk flags).
        "id, quantity, config_values, technical_values, factory_overrides, internal_notes, position, product_id, category_id, product_name, product_sku, product_category, products(name, sku, category, category_id, image_url)"
      )
      .eq("task_list_id", params.id)
      .order("position"),
  ]);

  if (!task) notFound();

  // Product Lighting Setup (m144) — the approved lighting config for this
  // command, anchored on the proforma (document_id = quotation_id). Fetched
  // defensively so a missing m144 just leaves the Lighting tab empty/editable.
  let lightingRow: any = null;
  if ((task as any).quotation_id) {
    const { data } = await supabase
      .from("product_lighting_setups")
      .select(
        "id, document_id, lighting_power, operating_hours, lighting_program, approved_optics, energy_study_path, energy_study_name, dialux_path, dialux_name, ai_extracted, created_at"
      )
      .eq("document_id", (task as any).quotation_id)
      .maybeSingle();
    lightingRow = data ?? null;
  }

  // m135 — manual-item columns, fetched defensively so a missing migration
  // just leaves the map empty (the page falls back to the product/category
  // rule + an empty price/specs; saves soft-fail until m135 is applied). Same
  // resilience pattern as the sticker/risk-flags fetches below.
  const manualByLine = new Map<
    string,
    { is_manual: boolean | null; unit_price: number | null; manual_specs: string | null }
  >();
  {
    const { data, error } = await supabase
      .from("production_task_list_lines")
      .select("id, is_manual, unit_price, manual_specs")
      .eq("task_list_id", params.id);
    if (!error) {
      for (const r of (data ?? []) as any[]) {
        manualByLine.set(r.id, {
          is_manual: r.is_manual ?? null,
          unit_price: r.unit_price ?? null,
          manual_specs: r.manual_specs ?? null,
        });
      }
    }
  }

  // m159 — INDUSTRIAL PRODUCTION FILE (tilt angle + checkpoint + spec blob),
  // fetched defensively: pre-migration the select 42703s and the section
  // renders its dormant hint instead (same resilience pattern as m135 above).
  // A successful read IS the migration gate — no extra ledger query.
  let industrial: {
    tilt: number | null;
    verified: boolean;
    verifiedAt: string | null;
    spec: unknown;
    /** m176 — where the AI read the tilt; null when never extracted. */
    provenance: TiltProvenance | null;
  } | null = null;
  {
    const { data, error } = await supabase
      .from("production_task_lists")
      .select(
        "solar_panel_tilt_angle, pole_drawing_tilt_verified, pole_drawing_tilt_verified_at, industrial_spec"
      )
      .eq("id", params.id)
      .maybeSingle();
    if (!error && data) {
      // m176 — read separately so a pre-m176 database keeps the whole section
      // working (it just has no provenance to show).
      const { data: prov } = await supabase
        .from("production_task_lists")
        .select("tilt_ai_provenance")
        .eq("id", params.id)
        .maybeSingle();
      industrial = {
        tilt: (data as any).solar_panel_tilt_angle ?? null,
        verified: (data as any).pole_drawing_tilt_verified === true,
        verifiedAt: (data as any).pole_drawing_tilt_verified_at ?? null,
        spec: (data as any).industrial_spec ?? null,
        provenance: normalizeTiltProvenance((prov as any)?.tilt_ai_provenance),
      };
    }
  }
  // Blocks Release to Production (evaluateRelease) — mirrored in the modal.
  const tiltCheckpointPending =
    industrial != null && industrial.tilt != null && !industrial.verified;
  // m176 — an unsettled AI/production disagreement blocks the release too.
  const tiltConflict = tiltConflictPending(industrial?.provenance ?? null);

  // m160 — PRODUCT DICTIONARY for the product-aware spare parts. Try the
  // full m160 shape first; pre-migration (42703) fall back to the m012 base
  // columns — the dictionary still assists, just without compatibility
  // scoping (every item counts as generic until m160 lands).
  let dictionary: DictionaryItem[] = [];
  if (industrial) {
    const M160_COLS =
      "id, commercial_name, commercial_name_fr, internal_reference, factory_name_cn, erp_code, category, notes, active, compatible_category_ids, compatible_product_ids";
    const BASE_COLS = "id, commercial_name, internal_reference, category, notes, active";
    let dict: any[] | null = null;
    const full = await supabase
      .from("component_mappings")
      .select(M160_COLS)
      .eq("active", true)
      .order("commercial_name");
    if (!full.error) {
      dict = full.data as any[] | null;
    } else {
      const base = await supabase
        .from("component_mappings")
        .select(BASE_COLS)
        .eq("active", true)
        .order("commercial_name");
      dict = base.data as any[] | null;
    }
    dictionary = ((dict ?? []) as any[])
      .map(normalizeDictionaryItem)
      .filter((d): d is DictionaryItem => d != null);
  }

  // ---- Config fetch MUST be scoped to this task list's categories ----------
  // config_field_options and factory_mappings are app-wide tables. An UNSCOPED
  // select(...) hits the PostgREST row cap and returns a NON-DETERMINISTIC
  // subset (no stable total order), so a saved + active mapping intermittently
  // fails to resolve → the "missing mappings" count oscillates (5→3→5) across
  // reloads of identical data (the 2026-06-19 E2E bug). Scoping by the
  // categories on the lines makes every result set tiny, deterministic and
  // cap-proof. countMissingTaskListMappings (the server gate) applies the SAME
  // scoping so the page count and the release gate can never diverge.
  const lineCategoryIds = Array.from(
    new Set(
      // m133 — prefer the line's own category; fall back to the live product
      // join for legacy catalog lines created before the backfill.
      ((lines ?? []) as any[])
        .map((l) => l.category_id ?? l.products?.category_id)
        .filter(Boolean)
    )
  ) as string[];

  // m134 — category names, so a line WITHOUT a chosen model still shows its
  // family ("AOSPRO +") on the task list instead of "—" (modèle optionnel).
  const categoryNameById = new Map<string, string>();
  if (lineCategoryIds.length > 0) {
    const { data: cats } = await supabase
      .from("product_categories")
      .select("id, name")
      .in("id", lineCategoryIds);
    for (const c of (cats ?? []) as any[]) categoryNameById.set(c.id, c.name);
  }

  // m160 — product families present on THIS order (drive the product-aware
  // spare-parts selector: only compatible dictionary items are offered).
  const orderedFamilies = deriveOrderedFamilies(
    ((lines ?? []) as any[]).map((l) => {
      const catId = l.category_id ?? l.products?.category_id ?? null;
      return {
        categoryId: catId,
        productId: l.product_id ?? null,
        familyLabel: catId ? categoryNameById.get(catId) ?? null : null,
      };
    })
  );

  let fields: any[] | null = [];
  let opts: any[] | null = [];
  let mappings: any[] | null = [];
  if (lineCategoryIds.length > 0) {
    const fieldsRes = await supabase
      .from("config_fields")
      .select(
        "id, category_id, field_name, field_type, required, required_for_production, default_value, placeholder, field_order, visible_in_quotation, visible_in_task_list, visible_in_factory, internal_only, access_level, allow_custom_value, field_scope, active"
      )
      .in("category_id", lineCategoryIds)
      .eq("active", true)
      .eq("visible_in_task_list", true)
      .order("field_order");
    fields = fieldsRes.data;
    const configFieldIds = ((fields ?? []) as any[]).map((f) => f.id);
    if (configFieldIds.length > 0) {
      // factory_mappings.field_id is always populated, so scope both queries by
      // it and run them in parallel. Explicit ordering keeps results stable.
      const [optsRes, mappingsRes] = await Promise.all([
        supabase
          .from("config_field_options")
          .select("id, field_id, option_value, option_order")
          .in("field_id", configFieldIds)
          .order("field_id")
          .order("option_order"),
        supabase
          .from("factory_mappings")
          .select(
            "id, field_id, option_id, factory_instruction, factory_code, notes, active"
          )
          .in("field_id", configFieldIds),
      ]);
      opts = optsRes.data;
      mappings = mappingsRes.data;
    }
  }

  const status = task.status as ProductionTaskListStatus;
  const lockedForSales = TASK_LIST_LOCKED_FOR_SALES.includes(status);
  const salesCanEdit = technical || !lockedForSales;

  // ---- Client technical preset + additional factory attributes (m071) —
  // technical roles only. The CLIENT layer of the existing factory-mapping
  // flow (global mapping → client preset → per-line order override):
  //   - presetByProduct: Record<fieldName, instruction> (sales-field overrides)
  //   - clientExtrasByProduct: FactoryExtras (factory-only attributes)
  //   - extrasByLine: this line's order-layer extras (overrides + tombstones)
  // All fetched defensively so a missing migration just empties the layer
  // (the page never crashes; saves soft-fail until m071 is applied). ----
  const presetByProduct = new Map<string, Record<string, string>>();
  const clientExtrasByProduct = new Map<string, FactoryExtras>();
  const extrasByLine = new Map<string, FactoryExtras>();
  if (technical && (lines ?? []).length > 0) {
    const lineIds = (lines as any[]).map((l) => l.id);
    const productIds = Array.from(
      new Set((lines as any[]).map((l) => l.product_id).filter(Boolean))
    ) as string[];

    // Client preset (mapping + extras). Tries the extras column first, falls
    // back to mapping-only if the column isn't migrated yet.
    if (task.client_id && productIds.length) {
      let presetRows: any[] = [];
      const withExtras = await supabase
        .from("client_technical_presets")
        .select("product_id, mapping, extras")
        .eq("client_id", task.client_id)
        .in("product_id", productIds);
      if (!withExtras.error) {
        presetRows = withExtras.data ?? [];
      } else {
        const mappingOnly = await supabase
          .from("client_technical_presets")
          .select("product_id, mapping")
          .eq("client_id", task.client_id)
          .in("product_id", productIds);
        if (!mappingOnly.error) presetRows = mappingOnly.data ?? [];
      }
      for (const r of presetRows) {
        const m = r.mapping;
        if (m && typeof m === "object" && !Array.isArray(m)) {
          const clean: Record<string, string> = {};
          for (const [k, v] of Object.entries(m)) {
            if (typeof v === "string" && v.trim() !== "") clean[k] = v;
          }
          presetByProduct.set(r.product_id, clean);
        }
        clientExtrasByProduct.set(
          r.product_id,
          normalizeFactoryExtras(r.extras)
        );
      }
    }

    // Per-line order-layer extras (keepEmpty: tombstones survive).
    const lineExtras = await supabase
      .from("production_task_list_lines")
      .select("id, factory_extras")
      .in("id", lineIds);
    if (!lineExtras.error) {
      for (const r of (lineExtras.data ?? []) as any[]) {
        extrasByLine.set(
          r.id,
          normalizeFactoryExtras(r.factory_extras, { keepEmpty: true })
        );
      }
    }
  }

  /* ---- Linked production order (for the "production started" banner) ----
     Once the PO is past awaiting_deposit, this page stops being the
     primary surface for Sales — they should be on the PO tracking
     page (ETA, payments, shipment, timeline) instead of the
     configuration editor. We surface a banner with a direct link.
     Soft-fails to null if no PO exists yet (early PTL state).        */
  const { data: linkedPo } = await supabase
    .from("production_orders")
    .select(
      "id, number, status, current_production_deadline, etd, eta, shipment_booked"
    )
    .eq("task_list_id", params.id)
    .maybeSingle();
  const productionStartedStatuses = new Set([
    "deposit_received",
    "in_production",
    "production_completed",
    "delivered",
  ]);
  const showTrackingBanner =
    !!linkedPo &&
    productionStartedStatuses.has(linkedPo.status as string);

  // Sticker requirements (m061) + risk flags (m062) — fetched
  // defensively so a missing column (migration not applied) never
  // breaks the page.
  let stickerReq: unknown = null;
  let riskFlags: unknown = null;
  {
    const { data } = await supabase
      .from("production_task_lists")
      .select("sticker_requirements")
      .eq("id", params.id)
      .maybeSingle();
    stickerReq = (data as any)?.sticker_requirements ?? null;
  }
  {
    const { data } = await supabase
      .from("production_task_lists")
      .select("risk_flags")
      .eq("id", params.id)
      .maybeSingle();
    riskFlags = (data as any)?.risk_flags ?? null;
  }

  // Index fields per category + options per field — split into sales vs
  // technical buckets so the editor can render two separate sections.
  const optionsByField = new Map<string, ConfigFieldOption[]>();
  for (const o of opts ?? []) {
    if (!optionsByField.has(o.field_id))
      optionsByField.set(o.field_id, []);
    optionsByField.get(o.field_id)!.push(o as any);
  }
  const salesFieldsByCategory = new Map<string, ConfigField[]>();
  const technicalFieldsByCategory = new Map<string, ConfigField[]>();
  for (const f of fields ?? []) {
    const scoped = { ...(f as any), options: optionsByField.get(f.id) ?? [] };
    const scope = (f as any).field_scope ?? "sales";
    // 'both' → appears in the sales section (visible to all) AND the technical
    // section (editable during TL review). 'sales' → sales only. 'technical'
    // → technical review only.
    const buckets =
      scope === "both"
        ? [salesFieldsByCategory, technicalFieldsByCategory]
        : [scope === "technical" ? technicalFieldsByCategory : salesFieldsByCategory];
    for (const bucket of buckets) {
      if (!bucket.has(f.category_id)) bucket.set(f.category_id, []);
      bucket.get(f.category_id)!.push(scoped);
    }
  }

  // Build the factory-mapping lookup maps used by the resolver:
  //   - mappingByOption: option_id → FactoryMapping row
  //   - optionIdByFieldValue: optionLookupKey(category_id, field_name, value) → option_id
  // We key by field_name (not field_id) because that's what the line's
  // `config_values` JSONB uses — but field names are only unique WITHIN a
  // category, and `fields`/`opts` here span ALL categories, so the key MUST be
  // category-scoped or a duplicated family (identical field names + values)
  // collides and resolves to "missing". optionLookupKey() does that scoping.
  const mappingByOption = new Map<string, FactoryMapping>();
  for (const m of (mappings ?? []) as FactoryMapping[]) {
    mappingByOption.set(m.option_id, m);
  }
  const optionIdByFieldValue = new Map<string, string>();
  for (const f of (fields ?? []) as any[]) {
    if (f.field_type !== "dropdown") continue;
    const fieldOpts = optionsByField.get(f.id) ?? [];
    for (const o of fieldOpts as any[]) {
      optionIdByFieldValue.set(
        optionLookupKey(f.category_id, f.field_name, o.option_value),
        o.id
      );
    }
  }

  // Linked quotation — read with logistics/commercial context so the
  // PTL page can surface "what was sold" without bouncing to /documents.
  const linkedQuote = (task as any).documents as
    | {
        number: string | null;
        type: string;
        date: string;
        affair_name: string | null;
        incoterm: string | null;
        freight_type: string | null;
        freight_cost: number | null;
        port_of_loading: string | null;
        port_of_destination: string | null;
        currency: string | null;
        payment_mode: string | null;
        payment_terms: any | null;
        production_mode: string | null;
        production_days: number | null;
        production_date: string | null;
        total_price: number | null;
      }
    | null;
  const client = (task as any).clients as
    | {
        company_name: string;
        country: string | null;
        contact_name: string | null;
        client_code?: string | null;
      }
    | null;

  // Compose human-readable summaries from the linked quotation for
  // both the compact bandeau (top) and the detailed section (bottom).
  // These all gracefully handle missing fields so the PTL still
  // renders if the quote was created before the column existed.
  const inheritedPayment = linkedQuote
    ? formatPaymentTerms(
        linkedQuote.payment_mode as any,
        linkedQuote.payment_terms as any
      )
    : null;
  const inheritedProduction = linkedQuote
    ? formatProductionTime(
        fromProductionColumns({
          // production_mode comes from the documents row as `string |
          // null` (Supabase types are loose); cast to the strict enum
          // shape `fromProductionColumns` expects. fromProductionColumns
          // returns null when production_mode is null, so unknown
          // values are handled safely upstream by the formatter.
          production_mode: linkedQuote.production_mode as ProductionMode | null,
          production_days: linkedQuote.production_days,
          production_date: linkedQuote.production_date,
        })
      )
    : null;
  // Compact list of "key: value" chips for the top bandeau. Order is
  // chosen to mirror what factories ask first when they receive a
  // production hand-off: incoterm, ports, freight, payment.
  const inheritedChips: { label: string; value: string }[] = [];
  if (linkedQuote?.incoterm)
    inheritedChips.push({ label: "Incoterm", value: linkedQuote.incoterm });
  if (linkedQuote?.port_of_destination)
    inheritedChips.push({
      label: "Destination",
      value: linkedQuote.port_of_destination,
    });
  if (linkedQuote?.freight_type)
    inheritedChips.push({ label: "Freight", value: linkedQuote.freight_type });
  if (linkedQuote?.currency)
    inheritedChips.push({ label: "Currency", value: linkedQuote.currency });
  if (inheritedPayment)
    inheritedChips.push({ label: "Payment", value: inheritedPayment });

  // Audit timeline — same pattern as documents/[id] and production
  // orders. Reads tl.* events emitted by every workflow action +
  // header edits. 100 row cap.
  const tlEvents = await listEventsForEntity("task_list", params.id, 100);
  const tlActorIds = Array.from(
    new Set(tlEvents.map((e) => e.actor_id).filter(Boolean))
  ) as string[];
  // Prefer human display names (m052) over "role · uuid" — used by the
  // Timeline AND the validation history.
  const tlActorLabels = await resolveUserLabelStrings(tlActorIds);

  // ---- D1: revision-loop thread (latest request + response) ----------
  // Surfaced on both NEXT-STEP banners so neither role ever sees a blind
  // "Needs revision". Read from the entity_messages conversation (m049).
  const labelOf = (uid: string | null | undefined): string | null =>
    uid ? (tlActorLabels as Map<string, string>).get(uid) ?? null : null;
  const cleanBody = (raw: string | null): string => {
    const s = raw ?? "";
    const i = s.indexOf("\n\n");
    return i >= 0 ? s.slice(i + 2) : s;
  };
  const { data: revMsgs } = await supabase
    .from("entity_messages")
    .select(
      "message, message_kind, structured_payload, user_id, created_at, resolved_at"
    )
    .eq("entity_type", "task_list")
    .eq("entity_id", params.id)
    .in("message_kind", ["request", "reply"])
    .order("created_at", { ascending: false });
  const reqRow = (revMsgs ?? []).find(
    (m: any) =>
      m.message_kind === "request" &&
      m.structured_payload?.kind === "revision_request"
  ) as any;
  const respRow = (revMsgs ?? []).find(
    (m: any) =>
      m.message_kind === "reply" &&
      m.structured_payload?.kind === "revision_response"
  ) as any;
  const revisionThread: RevisionThreadInfo = {
    request: reqRow
      ? {
          category: reqRow.structured_payload?.category ?? null,
          categoryLabel: revisionCategoryLabel(
            reqRow.structured_payload?.category
          ),
          field: reqRow.structured_payload?.field ?? null,
          message: cleanBody(reqRow.message),
          authorName: labelOf(reqRow.user_id),
          createdAt: reqRow.created_at,
          resolved: !!reqRow.resolved_at,
        }
      : null,
    response: respRow
      ? {
          message: cleanBody(respRow.message),
          authorName: labelOf(respRow.user_id),
          createdAt: respRow.created_at,
        }
      : null,
  };

  // ---- D1/E3: required-mapping completeness (drives the Release guard) ----
  // SAME pure helper the server-side release gate uses → no logic divergence.
  const mappingLines = ((lines ?? []) as any[]).map((l) => ({
    productId: l.product_id,
    categoryId: l.category_id ?? l.products?.category_id ?? null, // m133
    config: (l.config_values ?? {}) as Record<string, string>,
    overrides: (l.factory_overrides ?? {}) as Record<string, string>,
  }));
  const missingMappingCount = countMissingMappings({
    lines: mappingLines,
    salesFieldsByCategory,
    mappingsByOption: mappingByOption,
    optionIdByFieldValue,
    clientOverridesByProduct: presetByProduct,
  });
  // #7 — required-for-production fields left blank (complements the mapping
  // count, which ignores empty fields). Surfaced at the top, not only the gate.
  const requiredEmptyCount = countRequiredEmpty({
    lines: mappingLines,
    salesFieldsByCategory,
  });
  const clientName =
    (Array.isArray((task as any).clients)
      ? (task as any).clients[0]
      : (task as any).clients)?.company_name ?? null;

  // ---- m178 — PRE-VALIDATION BOARD data -----------------------------------
  // The board renders during the collaborative phase (Pre-Validation +
  // needs_revision). Action items are fetched DEFENSIVELY: pre-m178 the table
  // is absent and the board runs without them (its other signals all exist).
  const showPreValidationBoard =
    status === "under_validation" || status === "needs_revision";
  let actionItems: TaskListActionItem[] = [];
  let m178Live = false;
  let boardUsers: { id: string; label: string }[] = [];
  if (showPreValidationBoard) {
    const { data: itemRows, error: itemsErr } = await supabase
      .from("task_list_action_items")
      .select(
        "id, task_list_id, title, details, department, assignee, status, blocking, due_date, created_by, created_at, resolved_at, resolved_by"
      )
      .eq("task_list_id", params.id)
      .order("created_at");
    if (!itemsErr) {
      m178Live = true;
      actionItems = ((itemRows ?? []) as unknown[])
        .map(normalizeActionItem)
        .filter((i): i is TaskListActionItem => i != null);
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name");
      boardUsers = ((profs ?? []) as any[]).map((u) => ({
        id: u.id as string,
        label: (u.full_name || u.email || "—") as string,
      }));
      const byId = new Map(boardUsers.map((u) => [u.id, u.label]));
      for (const it of actionItems) {
        it.assignee_label = it.assignee ? (byId.get(it.assignee) ?? null) : null;
      }
    }
  }
  // AI review list — every AI-extracted value with its review state. Tilt has
  // the full m176 state machine; the lighting fields carry provenance +
  // confidence (their explicit ack states are the next phase).
  const boardAiFields: BoardAiField[] = [];
  if (showPreValidationBoard) {
    const prov = industrial?.provenance ?? null;
    if (prov) {
      boardAiFields.push({
        label: "Solar panel tilt (Energy Study)",
        value: formatTiltAngle(prov.value),
        confidence: prov.confidence,
        state: prov.resolution === "applied" ? "accepted_ai" : prov.resolution,
        manuallyModified: prov.manually_modified_after,
      });
    }
    const ai = (lightingRow?.ai_extracted ?? null) as any;
    const aiFieldRows: Array<[string, unknown, string]> = ai?.fields
      ? [
          ["Lighting power", ai.fields.lighting_power, "lighting_power"],
          ["Operating hours / night", ai.fields.operating_hours, "operating_hours"],
          [
            "Lighting program",
            Array.isArray(ai.fields.lighting_program) && ai.fields.lighting_program.length
              ? `${ai.fields.lighting_program.length} periods`
              : null,
            "lighting_program",
          ],
        ]
      : [];
    const aiReview = normalizeAiReview(ai?.review);
    for (const [label, value, key] of aiFieldRows) {
      if (value == null) continue;
      const conf = Number(ai?.confidence?.[key]);
      boardAiFields.push({
        label: `${label} (Energy Study)`,
        value: String(value),
        confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
        fieldKey: key as "lighting_power" | "operating_hours" | "lighting_program",
        ack: (aiReview as any)[key]?.state ?? null,
      });
    }
  }
  // Warnings — the manually-flagged risks (m062): non-blocking by design.
  const boardWarnings: string[] = showPreValidationBoard
    ? normalizeRiskFlags(riskFlags)
        .items.filter((r) => r.active)
        .map((r) => r.label)
    : [];

  // ---- m179 — FINAL VALIDATION freeze + revision lineage ------------------
  // Defensive: pre-m179 fetchRevisions returns [] and the panel stays hidden
  // (unless frozen, where it renders the freeze banner without lineage).
  const frozen = isFrozenStatus(status);
  const revisions = await fetchRevisions(supabase, params.id);
  let revisionDiff: RevisionFieldChange[] = [];
  let revisionDiffLabel: string | null = null;
  const validatedRevs = revisions.filter(
    (r) => r.status !== "in_progress" && r.snapshot
  );
  const inProgressRev = revisions.find((r) => r.status === "in_progress");
  try {
    if (inProgressRev && !frozen && validatedRevs[0]) {
      // Live: the current working state vs the last validated version.
      const live = await buildTaskListSnapshot(supabase, params.id);
      if (live) {
        revisionDiff = diffSnapshots(validatedRevs[0].snapshot!, live);
        revisionDiffLabel = `Rev ${inProgressRev.rev} (in progress) vs Rev ${validatedRevs[0].rev}`;
      }
    } else if (validatedRevs.length >= 2) {
      revisionDiff = diffSnapshots(validatedRevs[1].snapshot!, validatedRevs[0].snapshot!);
      revisionDiffLabel = `Rev ${validatedRevs[0].rev} vs Rev ${validatedRevs[1].rev}`;
    }
  } catch {
    revisionDiff = []; // a malformed legacy snapshot must never sink the page
  }
  const currentRev =
    ((task as any).current_rev as string | null | undefined) ??
    validatedRevs[0]?.rev ??
    null;

  const flowSteps = deriveFlowSteps(
    status,
    (linkedPo?.status as string | null) ?? null
  );

  return (
    <DirtyWrapper>
    <div className="tl-detail wrap">
      {/* Breadcrumb */}
      <div className="crumb">
        <Link href="/task-lists">Task lists</Link>
        <span className="sep">/</span>
        <span>{task.number}</span>
      </div>

      {/* Header */}
      <div className="head">
        <div>
          <div className="label-row">
            <span className="micro">Production task list</span>
            <TaskListStatusBadge status={status} />
          </div>
          {/* Lead with the affair name + client — that's how the team
              recognises a project. The PTL/quote codes are the
              technical reference, shown as id-meta below. */}
          {linkedQuote?.affair_name ? (
            <h1>{linkedQuote.affair_name}</h1>
          ) : (
            <h1 className="font-mono">{task.number}</h1>
          )}
          <div className="id-meta">
            <span className="m">
              <span className="k">Client</span>
              <span className="v">
                {client?.company_name ?? "—"}
                {client?.client_code && (
                  <span className="muted"> ({client.client_code})</span>
                )}
              </span>
            </span>
            {client?.country && (
              <span className="m">
                <span className="k">Country</span>
                <span className="v">{client.country}</span>
              </span>
            )}
            <span className="m">
              <span className="k">From quote</span>
              <span className="v tnum">
                <Link href={`/documents/${task.quotation_id}`}>
                  {linkedQuote?.number ?? "—"}
                </Link>
              </span>
            </span>
            <span className="m">
              <span className="k">Created</span>
              <span className="v">
                {new Date(task.date).toLocaleDateString("en-GB")}
              </span>
            </span>
            <span className="m">
              <span className="k">Ref</span>
              <span className="v tnum">{task.number}</span>
            </span>
          </div>
          {/* Inherited commercial terms — compact chip strip. The PTL
              focus stays technical; these are read-only reminders of
              what the customer was sold so the production team doesn't
              re-enter anything. Full breakdown lives in the section
              "Logistics from quotation" lower on the page. */}
          {inheritedChips.length > 0 && (
            <div className="fromquote">
              <span className="fq-label">From quote</span>
              {inheritedChips.map((c) => (
                <span key={c.label} className="fq-chip">
                  <span className="k">{c.label}</span>
                  <span className="v">{c.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="head-actions">
          <div className="row">
            <Link href="/task-lists" className="btn">
              ← All task lists
            </Link>
            {/* Destructive action — placed at the top, red, with
                confirm dialog. Hidden entirely if the user lacks the
                capability. Backend still gates via requireCapability. */}
            {canDeleteTaskList && (
              <DangerDeleteButton
                action={deleteTaskList}
                id={task.id}
                label="Delete"
                confirmMessage={`Permanently delete task list ${task.number}? This cannot be undone. The linked production order (if any) will also be deleted.`}
              />
            )}
          </div>
          {/*
            Exports are TLM/admin-only. Sales never exports — the workflow
            handoff (Submit for production validation) hands the production
            team the data; they validate, enrich, and release via these
            export buttons. Available once status >= validated so the data
            is at least review-approved.
          */}
          {technical &&
            (status === "validated" || status === "production_ready") && (
              <div className="row">
                <ProductionDossierActions taskListId={task.id} compact />
                <ExportExcelButton taskListId={task.id} />
              </div>
            )}
          {technical &&
            status !== "validated" &&
            status !== "production_ready" && (
              <p className="hint">
                Exports unlock once the task list is validated by the
                production team.
              </p>
            )}
          {!technical && status === "production_ready" && (
            <p className="hint">
              The production dossier PDF/Excel will be generated by the
              production team.
            </p>
          )}
        </div>
      </div>

      {/* WORKFLOW STEPPER — visual lifecycle progress, derived from the
          existing status + linked PO status. */}
      <div className="flow">
        <div className="flow-head">
          <span className="micro">Validation workflow</span>
          <span className="flow-sub">
            Sales drafts → production validates &amp; enriches → factory
            release.
          </span>
        </div>
        <div className="steps">
          {flowSteps.map((s) => (
            <div
              key={s.name}
              className={`step${
                s.state === "done" ? " done" : s.state === "now" ? " now" : ""
              }`}
            >
              <div className="dot">{s.state === "done" && <StepCheck />}</div>
              <div className="sname">{s.name}</div>
              <div className="sdate">{s.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* m178 — PRE-VALIDATION BOARD: the dashboard of the collaborative
          phase. Aggregates the SAME signals the server-side release gate
          enforces (no second source of truth) + the departments' own pending
          items. Visible to every role; edit affordances follow the role. */}
      {showPreValidationBoard && (
        <PreValidationBoard
          taskListId={task.id}
          items={actionItems}
          users={boardUsers}
          signals={{
            requiredEmptyCount,
            missingMappingCount,
            tiltCheckpointPending,
            tiltConflictPending: tiltConflict,
            hasOpenRevision: !!revisionThread.request && !revisionThread.request.resolved,
            lineCount: (lines ?? []).length,
          }}
          aiFields={boardAiFields}
          warnings={boardWarnings}
          canCreate={m178Live && (technical || salesCanEdit || status === "under_validation")}
          canBlock={technical}
          isTechnical={technical}
          userId={currentUserId ?? null}
          m178Live={m178Live}
          documentId={task.quotation_id ?? null}
          canReviewAi={technical || salesCanEdit}
        />
      )}

      {/* m179 — FINAL VALIDATION: freeze banner, controlled revisions, and
          the field-level diff between revisions. */}
      {(frozen || revisions.length > 0) && (
        <RevisionsPanel
          taskListId={task.id}
          frozen={frozen}
          currentRev={currentRev}
          revisions={revisions.map((r) => ({ ...r, snapshot: null }))}
          diff={revisionDiff.slice(0, 200)}
          diffLabel={revisionDiffLabel}
          canManage={technical && canValidateTaskList}
        />
      )}

      {/* RELEASE READINESS (#7/#8) — kept for the Final Validation stage; the
          Pre-Validation board above covers the collaborative phase. */}
      {technical &&
        status === "validated" &&
        (missingMappingCount > 0 ||
          requiredEmptyCount > 0 ||
          tiltCheckpointPending ||
          tiltConflict) && (
          <div className="tl-readiness" role="status">
            <span className="tl-readiness-ico" aria-hidden>
              ⚠
            </span>
            <div className="tl-readiness-body">
              {(() => {
                const total =
                  requiredEmptyCount +
                  missingMappingCount +
                  (tiltCheckpointPending ? 1 : 0) +
                  (tiltConflict ? 1 : 0);
                return (
                  <div className="tl-readiness-title">
                    Not ready to release — {total} item{total === 1 ? "" : "s"} to
                    resolve before validation
                  </div>
                );
              })()}
              <ul className="tl-readiness-list">
                {requiredEmptyCount > 0 && (
                  <li>
                    <b>{requiredEmptyCount}</b> required field
                    {requiredEmptyCount === 1 ? "" : "s"} still empty —{" "}
                    <a href="#tl-product">fill in Product configuration ↓</a>
                  </li>
                )}
                {missingMappingCount > 0 && (
                  <li>
                    <b>{missingMappingCount}</b> factory mapping
                    {missingMappingCount === 1 ? "" : "s"} missing — resolve on the
                    lines below or in{" "}
                    <Link href="/factory-mapping">Admin → Factory mapping</Link>
                  </li>
                )}
                {tiltConflict && (
                  <li>
                    The Energy Study states{" "}
                    <b>{industrial?.provenance?.value}°</b> but this task list
                    says <b>{industrial?.tilt}°</b> —{" "}
                    <a href="#tl-industrial">resolve the tilt conflict ↓</a>
                  </li>
                )}
                {tiltCheckpointPending && (
                  <li>
                    Pole drawing not yet verified against the{" "}
                    <b>{industrial?.tilt}°</b> tilt angle —{" "}
                    <a href="#tl-industrial">confirm the checkpoint ↓</a>
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}

      {/* Workflow next-action bar — INK bar wrapping the existing
          TaskListWorkflowActions buttons (Mark production ready / Request
          revision / Reject) + the submitted-for-validation stamp. */}
      <div className="nextstep">
        <div className="lead">
          <span className="micro">Next step</span>
          <span className="big">Move this task list to its next stage</span>
        </div>
        <div className="acts">
          <TaskListWorkflowActions
            taskListId={task.id}
            status={status}
            isTechnical={technical}
            canValidate={canValidateTaskList}
            canReject={canRejectTaskList}
            revisionThread={revisionThread}
            missingMappingCount={missingMappingCount}
            tiltCheckpointPending={tiltCheckpointPending}
            clientName={clientName}
            taskNumber={task.number ?? null}
          />
        </div>
        {task.submitted_at && (
          <div className="stamp">
            Submitted for validation{" "}
            <b>{new Date(task.submitted_at).toLocaleString()}</b>
          </div>
        )}
      </div>

      {/* POST-VALIDATION COCKPIT — the natural END of the TLM workflow.
          As soon as the task list is validated the manager generates the
          complete Production Dossier PDF / sends it by email RIGHT HERE,
          without leaving the page (owner spec 2026-07-07). ?validated=1
          (set by the validate action's redirect) adds the success flash. */}
      {technical &&
        (status === "validated" || status === "production_ready") && (
          <div
            className={`card pad ${
              searchParams?.validated === "1"
                ? "border-emerald-300 bg-emerald-50/50"
                : ""
            }`}
            role={searchParams?.validated === "1" ? "status" : undefined}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="label-row">
                  <span className="micro">
                    {searchParams?.validated === "1"
                      ? "✓ Task list validated"
                      : "Production package"}
                  </span>
                </div>
                <p className="text-sm font-semibold text-neutral-900 mt-1">
                  {searchParams?.validated === "1"
                    ? "Validation complete — generate the production dossier to finish."
                    : "Generate the complete production dossier for the factory."}
                </p>
                {linkedPo && (
                  <p className="text-xs text-neutral-500 mt-1">
                    Production order{" "}
                    <Link
                      href={`/production/orders/${linkedPo.id}`}
                      className="font-medium underline"
                    >
                      {linkedPo.number ?? "created"}
                    </Link>{" "}
                    was created automatically — deposits, delays and shipping
                    are tracked there.
                  </p>
                )}
              </div>
              <ProductionDossierActions taskListId={task.id} />
            </div>
          </div>
        )}

      {/* Production-started banner */}
      {showTrackingBanner && linkedPo && (
        <div className="banner">
          <div>
            <span className="micro" style={{ color: "var(--ink)" }}>
              ● Production has started
            </span>
            <p>
              For order tracking — ETA, payments, shipment, timeline — use the
              production order page. This task list page is still available for
              reference, but live operational updates now live on{" "}
              <b>{linkedPo.number ?? "the PO"}</b>.
            </p>
          </div>
          <Link
            href={`/production/orders/${linkedPo.id}`}
            className="btn primary"
          >
            Open tracking page <span className="ar">→</span>
          </Link>
        </div>
      )}

      {/* ---------- PRODUCT CONFIGURATION (the real purpose) ----------
          The page now LEADS with product config: a compact visual
          summary per line (for fast ops/factory scanning) on top of the
          full sales/technical/factory editor. Logistics + notes follow
          below. */}
      {/* S1-6 — section quick-nav: the long task list reads as navigable
          sections (jump links) instead of one wall. Anchors target the
          section <h2> ids below. (Poles are manual line-items inside Product
          configuration — no separate section to anchor.) */}
      <nav className="tl-secnav" style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0 16px" }}>
        {[
          { href: "#tl-request", label: "Sales request" },
          { href: "#tl-product", label: "Product" },
          { href: "#tl-lighting", label: "Lighting" },
          { href: "#tl-industrial", label: "Industrial file" },
          { href: "#tl-production", label: "Production" },
          { href: "#tl-risks", label: "Risks" },
          { href: "#tl-logistics", label: "Logistics" },
          { href: "#tl-activity", label: "Activity" },
        ].map((s) => (
          <a
            key={s.href}
            href={s.href}
            style={{ fontSize: 12, fontWeight: 600, color: "var(--sx-ink-soft, #444)", padding: "4px 11px", borderRadius: 999, border: "1px solid var(--sx-line, #e5e7eb)", background: "#fff", textDecoration: "none" }}
          >
            {s.label}
          </a>
        ))}
      </nav>

      {/* Original Sales Request — read-only reminder of the client's original
          free-text need (m134), carried from the Service Request. Sits above the
          configuration so the floor always sees what the client asked for. It is
          NEVER the source of config — purely informational. */}
      {(task as any).original_sales_request?.trim() && (
        <div className="prod-shell" style={{ marginBottom: "1rem" }}>
          <div className="sec-head">
            <div className="lhs">
              <h2 id="tl-request" style={{ scrollMarginTop: 16 }}>Original sales request</h2>
            </div>
            <div className="rhs">
              <span className="micro">from the service request · read-only</span>
            </div>
          </div>
          <p style={{ whiteSpace: "pre-wrap", margin: "0.25rem 0 0", fontSize: "0.875rem" }}>
            {(task as any).original_sales_request}
          </p>
        </div>
      )}

      <div className="prod-shell space-y-4">
        <div className="sec-head">
          <div className="lhs">
            <h2 id="tl-product" style={{ scrollMarginTop: 16 }}>Product configuration</h2>
          </div>
          <div className="rhs">
            {lines?.length ?? 0} line{(lines?.length ?? 0) === 1 ? "" : "s"} ·{" "}
            <TaskListStatusBadge status={status} />
          </div>
        </div>
        {(lines ?? []).map((l: any) => {
          const categoryId = l.category_id ?? l.products?.category_id ?? null; // m133
          // m135 — a manual item has neither a catalog product nor a category.
          // Prefer the explicit flag (defensive fetch); fall back to the shared
          // rule for rows created before the is_manual column existed.
          const manual = manualByLine.get(l.id);
          const isManual =
            manual?.is_manual ?? isManualLine(l.product_id, categoryId);
          const salesFields = categoryId
            ? salesFieldsByCategory.get(categoryId) ?? []
            : [];
          const technicalFields = categoryId
            ? technicalFieldsByCategory.get(categoryId) ?? []
            : [];
          // Display name: catalog product → category family → manual snapshot.
          const displayName =
            l.products?.name ??
            l.product_name ??
            categoryNameById.get(categoryId) ??
            (isManual ? "Manual item" : "—");
          return (
            <div key={l.id}>
              <ProductSummaryCard
                productName={displayName}
                sku={l.products?.sku ?? l.product_sku ?? null}
                imageUrl={l.products?.image_url ?? null}
                quantity={Number(l.quantity || 0)}
                config={(l.config_values ?? {}) as Record<string, string>}
                factoryOverrides={
                  (l.factory_overrides ?? {}) as Record<string, string>
                }
                isManual={isManual}
              />
              <TaskLineEditor
                lineId={l.id}
                taskListId={task.id}
                clientId={task.client_id ?? null}
                productId={l.product_id}
                categoryId={categoryId}
                isManual={isManual}
                productName={`${displayName}${
                  !isManual && (l.products?.sku ?? l.product_sku)
                    ? ` · ${l.products?.sku ?? l.product_sku}`
                    : ""
                }`}
                initialName={isManual ? (l.product_name ?? "") : ""}
                initialSpecs={isManual ? (manual?.manual_specs ?? null) : null}
                salesSpec={(task as any).original_sales_request ?? null}
                unitPrice={
                  isManual && manual?.unit_price != null
                    ? Number(manual.unit_price)
                    : null
                }
                currency={linkedQuote?.currency ?? null}
                initialQty={Number(l.quantity || 0)}
                initialConfig={(l.config_values ?? {}) as Record<string, string>}
                initialTechnical={
                  (l.technical_values ?? {}) as Record<string, string>
                }
                initialFactoryOverrides={
                  (l.factory_overrides ?? {}) as Record<string, string>
                }
                initialNotes={l.internal_notes ?? null}
                salesFields={salesFields}
                technicalFields={technicalFields}
                salesEditable={salesCanEdit}
                technicalEditable={technical}
                mappingByOption={Object.fromEntries(mappingByOption)}
                optionIdByFieldValue={Object.fromEntries(optionIdByFieldValue)}
                clientOverrides={presetByProduct.get(l.product_id) ?? null}
                clientExtras={clientExtrasByProduct.get(l.product_id) ?? []}
                initialFactoryExtras={extrasByLine.get(l.id) ?? []}
              />
            </div>
          );
        })}
        {(!lines || lines.length === 0) && (
          <div className="card pad" style={{ textAlign: "center" }}>
            <span className="micro">
              No line items. The quotation may have had no products.
            </span>
          </div>
        )}
      </div>

      {/* ---------- PRODUCT LIGHTING SETUP (m144) ----------
          Sales completes the APPROVED lighting config here (Energy Study +
          power + dimming program + optics + operating hours), with optional AI
          Auto-fill. Non-blocking; transferred to the production order via the
          command (quotation_id). Editable while the task list is sales-editable. */}
      {task.quotation_id && (
        <>
          <div className="sec-head">
            <div className="lhs">
              <h2 id="tl-lighting" style={{ scrollMarginTop: 16 }}>
                Product Lighting Setup
              </h2>
              <p className="micro">
                Lighting parameters + technical studies for production,
                controller programming and quality control.
              </p>
            </div>
          </div>
          <div className="prod-shell">
            <ProductLightingSetupForm
              documentId={task.quotation_id}
              affairId={(task as any).affair_id ?? null}
              clientId={task.client_id ?? null}
              initial={lightingRow ?? null}
              editable={salesCanEdit}
            />
          </div>
        </>
      )}

      {/* ---------- INDUSTRIAL PRODUCTION FILE (m159) ----------
          The task list is the complete industrial production file (owner spec
          2026-07-08): solar-panel tilt angle + pole-drawing checkpoint, pole
          accessories, packaging version, user manuals, spare parts. Dormant
          with a hint until m159 is applied. */}
      <div className="sec-head">
        <div className="lhs">
          <h2 id="tl-industrial" style={{ scrollMarginTop: 16 }}>
            Industrial production file
          </h2>
          <p className="micro">
            Production parameters shared by Sales, Engineering, Purchasing,
            Factory and After-Sales — tilt angle, pole accessories, packaging,
            manuals and free spare parts.
          </p>
        </div>
      </div>
      {industrial ? (
        <div className="prod-shell">
          <IndustrialFileEditor
            taskListId={task.id}
            documentId={task.quotation_id ?? null}
            initialTilt={industrial.tilt}
            tiltVerified={industrial.verified}
            tiltVerifiedAt={industrial.verifiedAt}
            tiltProvenance={industrial.provenance}
            initialSpec={industrial.spec}
            editable={salesCanEdit && !frozen}
            canVerify={technical && canValidateTaskList && !frozen}
            families={orderedFamilies}
            dictionary={dictionary}
          />
        </div>
      ) : (
        <div className="card pad" style={{ textAlign: "center" }}>
          <span className="micro">
            The Industrial production file (tilt angle, accessories, packaging,
            manuals, spare parts) activates once migration m159
            (159_task_list_industrial_file.sql) is applied in Supabase.
          </span>
        </div>
      )}

      {/* ---------- KNOWN RISKS / WARNINGS ----------
          Sits between the configuration and attachments. Compact +
          collapsed by default; the active risk chips stay visible so a
          risky project is still obvious without taking much space. */}
      <div className="sec-head">
        <div className="lhs">
          <h2 id="tl-risks" style={{ scrollMarginTop: 16 }}>Known risks &amp; warnings</h2>
          <p className="micro">
            These notes help transfer commercial knowledge and project-specific
            requirements — client commitments, sensitive points, negotiated
            trade-offs, logistics constraints and anything agreed verbally — to
            the operations &amp; production teams.
          </p>
        </div>
      </div>
      <div className="risk-shell">
        <RiskFlagsEditor
          taskListId={task.id}
          initial={riskFlags}
          editable={salesCanEdit}
        />
      </div>

      {/* ---------- PROJECT ATTACHMENTS ----------
          Drawings, dimensions, tender docs, artwork — the project-
          specific detail the product code alone can't carry. Shown high
          on the page so factory/ops see it during validation. Keyed to
          the affair, shared across versions + the quotation. */}
      {task.quotation_id && (
        <div className="att-shell">
          <AttachmentsPanel documentId={task.quotation_id} />
        </div>
      )}

      {/* Header form — production notes (sales) + technical notes (TLM).
          The old shipping-method / lines / workflow-stage grid was
          removed: shipping lives in "Logistics from quotation" below,
          the line count + status are already shown elsewhere, and the
          page now leads with product configuration instead. */}
      <div className="sec-head">
        <div className="lhs">
          <h2 id="tl-production" style={{ scrollMarginTop: 16 }}>Production &amp; technical notes</h2>
        </div>
      </div>
      <form action={updateTaskListHeader} className="card pad">
        <input type="hidden" name="id" value={task.id} />
        {/* Preserve the shipping_method value (editable elsewhere) so
            saving the notes header doesn't wipe it. */}
        <input
          type="hidden"
          name="shipping_method"
          value={task.shipping_method ?? ""}
        />
        <label className="notes-label micro">
          Production notes <span className="tagint">Sales</span>
        </label>
        <textarea
          name="production_notes"
          defaultValue={task.production_notes ?? ""}
          placeholder="Top-level production instructions from sales — context for the factory team."
          disabled={!salesCanEdit}
          rows={3}
          style={{ marginTop: 10, minHeight: 74 }}
        />
        {technical && (
          <>
            <label
              className="notes-label micro"
              style={{ marginTop: 18 }}
            >
              Technical notes <span className="tagint">Internal</span>
            </label>
            <textarea
              name="technical_notes"
              defaultValue={task.technical_notes ?? ""}
              placeholder="Internal references, drawing codes, packaging, BOM notes. Only visible to task list manager + admin."
              rows={3}
              style={{ marginTop: 10, minHeight: 74, background: "#FCFCF7" }}
            />
          </>
        )}
        <div className="savebar">
          {/* Delete is now in the top-right header (DangerDeleteButton) */}
          <SubmitButton variant="primary" pendingLabel="Saving…">
            Save header
          </SubmitButton>
        </div>
      </form>

      {/* ---------- STICKER REQUIREMENTS ----------
          Often-forgotten labelling spec: which stickers, where, with
          what artwork/instructions. Artwork files live in Attachments. */}
      <div className="stk-shell">
        <StickerRequirementsEditor
          taskListId={task.id}
          documentId={task.quotation_id ?? null}
          initial={stickerReq}
          editable={salesCanEdit}
        />
      </div>

      {/* Logistics inherited from the linked quotation. Read-only view
          of the commercial terms agreed with the customer. Placed BELOW
          the technical content (lines + config editors) so the PTL
          focus stays "technical configuration / mapping / production
          validation" at the top. */}
      {linkedQuote && (
        <>
          <div className="sec-head">
            <div className="lhs">
              <h2 id="tl-logistics" style={{ scrollMarginTop: 16 }}>Logistics from quotation</h2>
              <div className="lead">
                Commercial terms agreed with the client — single source of
                truth.
              </div>
            </div>
            <div className="rhs">
              <Link
                href={`/documents/${task.quotation_id}`}
                className="btn sm"
              >
                Open quotation →
              </Link>
            </div>
          </div>
          <div className="card pad">
            <div className="logi-grid">
              <LogisticsCell label="Incoterm" value={linkedQuote.incoterm} />
              <LogisticsCell
                label="Port of loading"
                value={linkedQuote.port_of_loading}
              />
              <LogisticsCell
                label="Port of destination"
                value={linkedQuote.port_of_destination}
              />
              <LogisticsCell
                label="Freight type"
                value={linkedQuote.freight_type}
              />
              <LogisticsCell
                label="Freight cost"
                value={
                  linkedQuote.freight_cost != null
                    ? `${linkedQuote.currency ?? ""} ${Number(
                        linkedQuote.freight_cost
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}`.trim()
                    : null
                }
              />
              <LogisticsCell label="Currency" value={linkedQuote.currency} />
              <LogisticsCell label="Payment terms" value={inheritedPayment} />
              <LogisticsCell
                label="Production time"
                value={inheritedProduction}
              />
            </div>
            <div className="logi-note">
              To change commercial terms, edit the linked quotation — these
              values follow automatically.
            </div>
          </div>
        </>
      )}

      {/* ---------- FACTORY VALIDATION HISTORY ----------
          Focused, timeline-oriented view of just the validation flow
          (submit → review → validate → revise → approve). The full
          activity log follows below. */}
      <div className="vh-shell">
        <ValidationHistory events={tlEvents} actorLabelByUser={tlActorLabels} />
      </div>

      {/* Audit timeline — workflow transitions (submit / validate /
          revise / cancel / delete) + header edits land here. Critical
          for the production team to understand why a list is in its
          current state and who pushed it there. */}
      <div className="sec-head">
        <div className="lhs">
          <h2 id="tl-activity" style={{ scrollMarginTop: 16 }}>Activity</h2>
          <div className="lead">Task list timeline.</div>
        </div>
        <div className="rhs tnum">
          {tlEvents.length} event{tlEvents.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="act-shell card pad">
        <Timeline
          events={tlEvents}
          actorLabelByUser={tlActorLabels}
          emptyMessage="No activity recorded for this task list yet."
        />
      </div>

      {/* Conversation drawer overlay — opens when ?event=<id> is in
          the URL. Task list context stays visible behind the drawer. */}
      <EventDiscussionPanel
        eventId={eventDiscussionId}
        expectedEntityId={task.id}
        currentUserId={currentUserId ?? null}
      />
    </div>
    </DirtyWrapper>
  );
}

/* ---------------------------------------------------------------------
   Workflow stepper — purely visual. Derives the done / now / upcoming
   state of the six lifecycle steps (Quote → Task list → Payment →
   Production → Shipping → Delivery) from the existing task-list status +
   the linked production order status. No logic change: the source of
   truth is still `status` / `linkedPo.status`; this only chooses a
   className for each rendered dot.
   --------------------------------------------------------------------- */
type FlowStepState = "done" | "now" | "todo";

function deriveFlowSteps(
  status: ProductionTaskListStatus,
  poStatus: string | null
): { name: string; sub: string; state: FlowStepState }[] {
  // Quote is always done by the time a task list exists.
  // Task-list step is "now" until the list is validated/ready, then done.
  // Payment / Production / Shipping / Delivery are driven by the linked PO.
  const taskDone =
    status === "validated" || status === "production_ready";
  const paymentDone = poStatus
    ? ["deposit_received", "in_production", "production_completed", "delivered"].includes(
        poStatus
      )
    : false;
  const productionStarted = poStatus
    ? ["in_production", "production_completed", "delivered"].includes(poStatus)
    : false;
  const productionDone = poStatus
    ? ["production_completed", "delivered"].includes(poStatus)
    : false;
  const shippingDone = poStatus ? poStatus === "delivered" : false;
  const deliveryDone = shippingDone;

  // The "now" step is the first not-yet-done step in the chain.
  const dones = [
    true, // quote
    taskDone,
    paymentDone,
    productionDone,
    shippingDone,
    deliveryDone,
  ];
  const names = [
    { name: "Quote", sub: "Accepted" },
    {
      name: "Task list",
      sub:
        status === "cancelled"
          ? "Rejected"
          : taskDone
          ? "Validated"
          : "In review",
    },
    { name: "Payment", sub: paymentDone ? "Received" : "Awaiting" },
    {
      name: "Production",
      sub: productionDone
        ? "Complete"
        : productionStarted
        ? "In progress"
        : "Not started",
    },
    { name: "Shipping", sub: shippingDone ? "Shipped" : "Pending" },
    { name: "Delivery", sub: deliveryDone ? "Delivered" : "Pending" },
  ];

  const firstNotDone = dones.findIndex((d) => !d);
  return names.map((n, i) => ({
    name: n.name,
    sub: n.sub,
    state: dones[i]
      ? "done"
      : i === firstNotDone && status !== "cancelled"
      ? "now"
      : "todo",
  }));
}

/** Tiny check-mark used in the workflow stepper's "done" dots. */
function StepCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Compact key/value cell for the "Logistics from quotation" panel.
 * Gracefully handles missing values so older quotations (created before
 * a given column existed) still render cleanly.
 */
function LogisticsCell({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const hasValue = value && String(value).trim() !== "";
  return (
    <div className="logi min-w-0">
      <div className="lk">{label}</div>
      <div className={`lv truncate${hasValue ? "" : " muted"}`}>
        {hasValue ? value : "—"}
      </div>
    </div>
  );
}
