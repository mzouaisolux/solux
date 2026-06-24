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
import {
  normalizeFactoryExtras,
  type FactoryExtras,
} from "@/lib/factory-extras";
import { ValidationHistory } from "@/components/documents/ValidationHistory";
import { resolveUserLabelStrings } from "@/lib/user-display";
import ExportPdfButton from "./ExportPdfButton";
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
import { countMissingMappings } from "@/lib/task-list-mapping-status";
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
  searchParams?: { event?: string | string[] };
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
        "id, number, status, date, shipping_method, production_notes, technical_notes, quotation_id, client_id, created_by, submitted_at, factory_sent_at, clients(company_name, country, contact_name, client_code), documents:quotation_id(number, type, date, affair_name, incoterm, freight_type, freight_cost, port_of_loading, port_of_destination, currency, payment_mode, payment_terms, production_mode, production_days, production_date, total_price)"
      )
      .eq("id", params.id)
      .maybeSingle(),
    supabase
      .from("production_task_list_lines")
      .select(
        "id, quantity, config_values, technical_values, factory_overrides, internal_notes, position, product_id, product_name, product_sku, product_category, products(name, sku, category, category_id, image_url)"
      )
      .eq("task_list_id", params.id)
      .order("position"),
  ]);

  if (!task) notFound();

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
      ((lines ?? []) as any[]).map((l) => l.products?.category_id).filter(Boolean)
    )
  ) as string[];

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
  const missingMappingCount = countMissingMappings({
    lines: ((lines ?? []) as any[]).map((l) => ({
      productId: l.product_id,
      categoryId: l.products?.category_id ?? null,
      config: (l.config_values ?? {}) as Record<string, string>,
      overrides: (l.factory_overrides ?? {}) as Record<string, string>,
    })),
    salesFieldsByCategory,
    mappingsByOption: mappingByOption,
    optionIdByFieldValue,
    clientOverridesByProduct: presetByProduct,
  });
  const clientName =
    (Array.isArray((task as any).clients)
      ? (task as any).clients[0]
      : (task as any).clients)?.company_name ?? null;

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
                <ExportPdfButton
                  taskListId={task.id}
                  client={client?.company_name ?? null}
                  affair={linkedQuote?.affair_name ?? null}
                />
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
              Factory PDF/Excel will be generated by the production team.
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
            revisionThread={revisionThread}
            missingMappingCount={missingMappingCount}
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
      <div className="prod-shell space-y-4">
        <div className="sec-head">
          <div className="lhs">
            <h2>Product configuration</h2>
          </div>
          <div className="rhs">
            {lines?.length ?? 0} line{(lines?.length ?? 0) === 1 ? "" : "s"} ·{" "}
            <TaskListStatusBadge status={status} />
          </div>
        </div>
        {(lines ?? []).map((l: any) => {
          const categoryId = l.products?.category_id ?? null;
          const salesFields = categoryId
            ? salesFieldsByCategory.get(categoryId) ?? []
            : [];
          const technicalFields = categoryId
            ? technicalFieldsByCategory.get(categoryId) ?? []
            : [];
          return (
            <div key={l.id}>
              <ProductSummaryCard
                productName={l.products?.name ?? l.product_name ?? "—"}
                sku={l.products?.sku ?? l.product_sku ?? null}
                imageUrl={l.products?.image_url ?? null}
                quantity={Number(l.quantity || 0)}
                config={(l.config_values ?? {}) as Record<string, string>}
                factoryOverrides={
                  (l.factory_overrides ?? {}) as Record<string, string>
                }
              />
              <TaskLineEditor
                lineId={l.id}
                taskListId={task.id}
                clientId={task.client_id ?? null}
                productId={l.product_id}
                categoryId={categoryId}
                productName={`${l.products?.name ?? l.product_name ?? "—"}${
                  (l.products?.sku ?? l.product_sku)
                    ? ` · ${l.products?.sku ?? l.product_sku}`
                    : ""
                }`}
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

      {/* ---------- KNOWN RISKS / WARNINGS ----------
          Sits between the configuration and attachments. Compact +
          collapsed by default; the active risk chips stay visible so a
          risky project is still obvious without taking much space. */}
      <div className="sec-head">
        <div className="lhs">
          <h2>Known risks &amp; warnings</h2>
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
          <h2>Production &amp; technical notes</h2>
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
              <h2>Logistics from quotation</h2>
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
          <h2>Activity</h2>
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
