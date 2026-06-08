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
import {
  TASK_LIST_LOCKED_FOR_SALES,
  isTechnicalRole,
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

  const [
    { data: task },
    { data: lines },
    { data: fields },
    { data: opts },
    { data: mappings },
  ] = await Promise.all([
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
    supabase
      .from("config_fields")
      .select(
        "id, category_id, field_name, field_type, required, required_for_production, default_value, placeholder, field_order, visible_in_quotation, visible_in_task_list, visible_in_factory, internal_only, access_level, allow_custom_value, field_scope, active"
      )
      .eq("active", true)
      .eq("visible_in_task_list", true)
      .order("field_order"),
    supabase
      .from("config_field_options")
      .select("id, field_id, option_value, option_order")
      .order("option_order"),
    supabase
      .from("factory_mappings")
      .select(
        "id, field_id, option_id, factory_instruction, factory_code, notes, active"
      ),
  ]);

  if (!task) notFound();

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
  //   - optionIdByFieldValue: "${field_name}|${value-lowercased}" → option_id
  // We key by field_name (not field_id) because that's what the line's
  // `config_values` JSONB uses. Field names are unique within a category.
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
        `${f.field_name}|${String(o.option_value).toLowerCase()}`,
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

  return (
    <DirtyWrapper>
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="eyebrow">Production task list</div>
            <TaskListStatusBadge status={status} />
          </div>
          {/* Lead with the affair name + client — that's how the team
              recognises a project. The PTL/quote codes are the
              technical reference, shown as a sub-line. */}
          {linkedQuote?.affair_name ? (
            <>
              <h1 className="doc-title mt-1 leading-tight">
                {linkedQuote.affair_name}
              </h1>
              <p className="text-sm font-medium text-neutral-700 mt-0.5">
                {client?.company_name ?? "—"}
                {client?.client_code && (
                  <span className="text-neutral-400 font-normal">
                    {" "}
                    ({client.client_code})
                  </span>
                )}
              </p>
            </>
          ) : (
            <>
              <h1 className="doc-title mt-1 font-mono">{task.number}</h1>
              <p className="text-sm font-medium text-neutral-700 mt-0.5">
                {client?.company_name ?? "—"}
                {client?.client_code && (
                  <span className="text-neutral-400 font-normal">
                    {" "}
                    ({client.client_code})
                  </span>
                )}
              </p>
            </>
          )}
          <p className="text-xs text-neutral-500 mt-1.5 font-mono">
            {task.number} · quote{" "}
            <Link
              href={`/documents/${task.quotation_id}`}
              className="text-neutral-700 hover:underline"
            >
              {linkedQuote?.number ?? "—"}
            </Link>{" "}
            <span className="font-sans">
              · {new Date(task.date).toLocaleDateString("en-GB")}
            </span>
          </p>
          {/* Inherited commercial terms — compact chip strip. The PTL
              focus stays technical; these are read-only reminders of
              what the customer was sold so the production team doesn't
              re-enter anything. Full breakdown lives in the section
              "Logistics from quotation" lower on the page. */}
          {inheritedChips.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <span className="text-[10px] uppercase tracking-widerx text-neutral-400 font-semibold">
                From quote:
              </span>
              {inheritedChips.map((c) => (
                <span
                  key={c.label}
                  className="inline-flex items-center rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[11px]"
                >
                  <span className="text-neutral-500 mr-1">{c.label}:</span>
                  <span className="font-medium text-neutral-800">
                    {c.value}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <Link href="/task-lists" className="btn-secondary">
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
              <div className="flex items-center gap-2">
                <ExportPdfButton taskListId={task.id} />
                <ExportExcelButton taskListId={task.id} />
              </div>
            )}
          {technical &&
            status !== "validated" &&
            status !== "production_ready" && (
              <p className="text-[11px] text-neutral-500 text-right max-w-[220px]">
                Exports unlock once the task list is validated by the
                production team.
              </p>
            )}
          {!technical && status === "production_ready" && (
            <p className="text-[11px] text-neutral-500 text-right max-w-[220px]">
              Factory PDF/Excel will be generated by the production team.
            </p>
          )}
        </div>
      </div>

      {/* Production-started banner — surfaces when the linked PO has
          moved past awaiting_deposit. The PTL editor is no longer the
          right surface for Sales at that stage; they need ETA /
          payments / shipment tracking on the PO page. Banner offers
          a one-click jump. Visible to everyone (TLM/admin still see
          it as a navigation hint; they can ignore it if they actually
          came here for revisions). */}
      {showTrackingBanner && linkedPo && (
        <section className="rounded-lg border border-sky-300 bg-sky-50/60 px-4 py-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widerx text-sky-900">
                Production has started
              </div>
              <p className="text-xs text-sky-900 mt-1 max-w-2xl">
                For order tracking — ETA, payments, shipment, timeline —
                use the production order page. This task list page is
                still available for reference, but live operational
                updates now live on{" "}
                <span className="font-mono">{linkedPo.number ?? "the PO"}</span>.
              </p>
            </div>
            <Link
              href={`/production/orders/${linkedPo.id}`}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-sky-600 bg-sky-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-sky-700 transition-colors"
            >
              Open tracking page →
            </Link>
          </div>
        </section>
      )}

      {/* Workflow next-action bar */}
      <section className="panel p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="eyebrow mb-1">Next step</div>
            <TaskListWorkflowActions
              taskListId={task.id}
              status={status}
              isTechnical={technical}
            />
          </div>
          <div className="text-[11px] text-neutral-500 text-right space-y-0.5">
            {task.submitted_at && (
              <div>
                Submitted for validation{" "}
                <b className="text-neutral-700">
                  {new Date(task.submitted_at).toLocaleString()}
                </b>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------- PRODUCT CONFIGURATION (the real purpose) ----------
          The page now LEADS with product config: a compact visual
          summary per line (for fast ops/factory scanning) on top of the
          full sales/technical/factory editor. Logistics + notes follow
          below. */}
      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Product configuration</h2>
          <span className="text-[11px] text-neutral-400 tabular-nums">
            {lines?.length ?? 0} line{(lines?.length ?? 0) === 1 ? "" : "s"} ·{" "}
            <TaskListStatusBadge status={status} />
          </span>
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
          <div className="panel p-8 text-center text-sm text-neutral-500">
            No line items. The quotation may have had no products.
          </div>
        )}
      </div>

      {/* ---------- KNOWN RISKS / WARNINGS ----------
          Sits between the configuration and attachments. Compact +
          collapsed by default; the active risk chips stay visible so a
          risky project is still obvious without taking much space. */}
      <RiskFlagsEditor
        taskListId={task.id}
        initial={riskFlags}
        editable={salesCanEdit}
      />

      {/* ---------- PROJECT ATTACHMENTS ----------
          Drawings, dimensions, tender docs, artwork — the project-
          specific detail the product code alone can't carry. Shown high
          on the page so factory/ops see it during validation. Keyed to
          the affair, shared across versions + the quotation. */}
      {task.quotation_id && (
        <AttachmentsPanel documentId={task.quotation_id} />
      )}

      {/* Header form — production notes (sales) + technical notes (TLM).
          The old shipping-method / lines / workflow-stage grid was
          removed: shipping lives in "Logistics from quotation" below,
          the line count + status are already shown elsewhere, and the
          page now leads with product configuration instead. */}
      <form action={updateTaskListHeader} className="panel p-4 space-y-4">
        <input type="hidden" name="id" value={task.id} />
        {/* Preserve the shipping_method value (editable elsewhere) so
            saving the notes header doesn't wipe it. */}
        <input
          type="hidden"
          name="shipping_method"
          value={task.shipping_method ?? ""}
        />
        <label className="block">
          <span className="eyebrow mb-1 block">
            Production notes
            <span className="ml-1 text-[10px] text-sky-700 normal-case tracking-normal font-medium">
              (sales)
            </span>
          </span>
          <textarea
            name="production_notes"
            defaultValue={task.production_notes ?? ""}
            placeholder="Top-level production instructions from sales — context for the factory team."
            disabled={!salesCanEdit}
            rows={3}
            className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm disabled:bg-neutral-50"
          />
        </label>
        {technical && (
          <label className="block">
            <span className="eyebrow mb-1 block">
              Technical notes
              <span className="ml-1 text-[10px] text-amber-700 normal-case tracking-normal font-medium">
                (technical · internal)
              </span>
            </span>
            <textarea
              name="technical_notes"
              defaultValue={task.technical_notes ?? ""}
              placeholder="Internal references, drawing codes, packaging, BOM notes. Only visible to task list manager + admin."
              rows={3}
              className="w-full rounded-md border border-amber-200 bg-amber-50/30 px-3 py-2 text-sm"
            />
          </label>
        )}
        <div className="flex items-center justify-end">
          {/* Delete is now in the top-right header (DangerDeleteButton) */}
          <SubmitButton variant="primary" pendingLabel="Saving…">
            Save header
          </SubmitButton>
        </div>
      </form>

      {/* ---------- STICKER REQUIREMENTS ----------
          Often-forgotten labelling spec: which stickers, where, with
          what artwork/instructions. Artwork files live in Attachments. */}
      <StickerRequirementsEditor
        taskListId={task.id}
        documentId={task.quotation_id ?? null}
        initial={stickerReq}
        editable={salesCanEdit}
      />

      {/* Logistics inherited from the linked quotation. Read-only view
          of the commercial terms agreed with the customer. Placed BELOW
          the technical content (lines + config editors) so the PTL
          focus stays "technical configuration / mapping / production
          validation" at the top. */}
      {linkedQuote && (
        <section className="panel p-5 space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <div className="eyebrow">Logistics from quotation</div>
              <h3 className="text-sm font-semibold text-neutral-900 mt-0.5">
                Commercial terms agreed with the client
              </h3>
            </div>
            <Link
              href={`/documents/${task.quotation_id}`}
              className="text-[11px] text-neutral-500 hover:text-neutral-700 hover:underline"
            >
              Open quotation →
            </Link>
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 text-xs">
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
            <LogisticsCell
              label="Payment terms"
              value={inheritedPayment}
            />
            <LogisticsCell
              label="Production time"
              value={inheritedProduction}
            />
          </dl>
          <p className="text-[11px] text-neutral-400 italic">
            Single source of truth. To change commercial terms, edit the
            linked quotation — these values follow.
          </p>
        </section>
      )}

      {/* ---------- FACTORY VALIDATION HISTORY ----------
          Focused, timeline-oriented view of just the validation flow
          (submit → review → validate → revise → approve). The full
          activity log follows below. */}
      <ValidationHistory events={tlEvents} actorLabelByUser={tlActorLabels} />

      {/* Audit timeline — workflow transitions (submit / validate /
          revise / cancel / delete) + header edits land here. Critical
          for the production team to understand why a list is in its
          current state and who pushed it there. */}
      <section className="panel p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="eyebrow">Activity</div>
            <h3 className="text-sm font-semibold text-neutral-900 mt-0.5">
              Task list timeline
            </h3>
          </div>
          <span className="text-[11px] text-neutral-400 tabular-nums">
            {tlEvents.length} event{tlEvents.length === 1 ? "" : "s"}
          </span>
        </div>
        <Timeline
          events={tlEvents}
          actorLabelByUser={tlActorLabels}
          emptyMessage="No activity recorded for this task list yet."
        />
      </section>

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
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-widerx text-neutral-400 font-semibold">
        {label}
      </dt>
      <dd className="mt-0.5 text-neutral-800 font-medium truncate">
        {value && String(value).trim() !== "" ? value : (
          <span className="text-neutral-300 font-normal">—</span>
        )}
      </dd>
    </div>
  );
}
