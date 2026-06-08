import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { listEventsForEntity, eventTypeLabel } from "@/lib/events";
import { loadPricingSettings } from "@/lib/pricing-settings";
import {
  PROJECT_REQUEST_STATUS_LABEL,
  PROJECT_FILE_CATEGORY_LABEL,
  transportModeLabel,
  type ProjectRequestStatus,
} from "@/lib/types";
import { ATTACHMENTS_BUCKET, formatFileSize } from "@/lib/attachments";
import { ProjectStatusBadge } from "@/components/projects/ProjectStatusBadge";
import { ProjectFilesUploader } from "../ProjectFilesUploader";
import ProjectPricingCard from "./ProjectPricingCard";
import PackingEntryForm from "./PackingEntryForm";
import FreightEntryForm from "./FreightEntryForm";
import { ActionForm, SubmitButton } from "@/components/feedback/ActionForm";
import {
  submitProjectRequest,
  approveProjectRequest,
  rejectProjectRequest,
  requestMoreInfo,
  enterFactoryCost,
  overrideFactoryCost,
  enterPacking,
  enterFreight,
  generateQuotationFromProject,
  setProjectOutcome,
  setProjectClient,
  deleteProjectFile,
} from "../actions";

export const dynamic = "force-dynamic";

const STEPPER: ProjectRequestStatus[] = [
  "draft",
  "waiting_director_approval",
  "waiting_factory_cost",
  "ready_for_pricing",
  "priced",
  "quotation_generated",
];
const STEP_INDEX: Record<string, number> = {
  draft: 0,
  submitted: 1,
  waiting_director_approval: 1,
  waiting_factory_cost: 2,
  waiting_logistics: 2,
  ready_for_pricing: 3,
  priced: 4,
  quotation_generated: 5,
  won: 5,
  lost: 5,
  cancelled: 5,
};

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  await getEffectiveRole();

  const { data: project } = await supabase
    .from("project_requests")
    .select("*, clients:client_id(company_name, country), product_categories:product_category_id(name)")
    .eq("id", params.id)
    .maybeSingle();
  if (!project) notFound();
  const p = project as any;

  const [
    { data: costReqs },
    { data: packReqs },
    { data: freightReqs },
    { data: audits },
    { data: files },
    { data: projectProduct },
    events,
    settings,
    canApprove,
    canCost,
    canLogistics,
    canPrice,
    canGenerate,
    canCreate,
    canViewCost,
    canOverride,
  ] = await Promise.all([
    supabase.from("factory_cost_requests").select("*").eq("project_request_id", params.id).order("created_at"),
    supabase.from("packing_list_requests").select("*").eq("project_request_id", params.id).order("created_at"),
    supabase.from("freight_cost_requests").select("*").eq("project_request_id", params.id).order("created_at"),
    supabase.from("factory_cost_audit").select("*").eq("project_request_id", params.id).order("changed_at", { ascending: false }),
    supabase.from("project_request_files").select("*").eq("project_request_id", params.id).order("created_at", { ascending: false }),
    supabase.from("project_products").select("*").eq("project_request_id", params.id).maybeSingle(),
    listEventsForEntity("project_request", params.id, 50),
    loadPricingSettings(supabase),
    hasUiCapability("project.approve"),
    hasUiCapability("project.enter_cost"),
    hasUiCapability("project.enter_logistics"),
    hasUiCapability("project.set_pricing"),
    hasUiCapability("project.generate_quotation"),
    hasUiCapability("project.create"),
    hasUiCapability("project.view_cost"),
    hasUiCapability("project.override_cost"),
  ]);

  const cost = (costReqs ?? [])[0] as any | undefined;
  const pack = (packReqs ?? [])[0] as any | undefined;
  const freight = (freightReqs ?? [])[0] as any | undefined;
  const pp = projectProduct as any | null;
  // Freight is generated from the packing list — its container types/qty.
  const packingContainers: Array<{ type: string; quantity: number }> = Array.isArray(pack?.containers) ? pack.containers : [];
  const auditRows = (audits ?? []) as any[];
  const fileRows = (files ?? []) as any[];

  const signed = new Map<string, string>();
  await Promise.all(
    fileRows.map(async (f) => {
      const { data } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(f.storage_path, 3600);
      if (data?.signedUrl) signed.set(f.id, data.signedUrl);
    })
  );

  const ownerLabels = await resolveUserLabelStrings(
    [p.owner_id, p.created_by, ...auditRows.map((a) => a.changed_by)].filter(Boolean) as string[]
  );

  // Legacy clientless project (client is mandatory at creation now) — let an
  // owner/director assign one so pricing/quotation never dead-ends (P9).
  let clientOptions: Array<{ id: string; name: string }> = [];
  if (!p.client_id && canCreate) {
    const { data } = await supabase.from("clients").select("id, company_name").order("company_name", { ascending: true });
    clientOptions = ((data ?? []) as any[]).map((c) => ({ id: c.id, name: c.company_name }));
  }

  const status = p.status as ProjectRequestStatus;
  const stepIdx = STEP_INDEX[status] ?? 0;
  const terminal = status === "won" || status === "lost" || status === "cancelled";
  const money = (n: number | null | undefined) =>
    n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const usd = (rmb: number | null | undefined) =>
    rmb == null ? "—" : `≈ ${money(Number(rmb) / (settings.exchangeRate || 6.85))}`;

  const Meta = ({ label, value }: { label: string; value: string }) => (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="truncate text-sm text-neutral-800">{value}</div>
    </div>
  );

  const solarRows: Array<[string, string | null]> = [
    ["LED power", p.led_power],
    ["Solar panel", p.solar_panel_size],
    ["Battery", p.battery_spec],
    ["Controller", p.controller],
    ["IoT", p.iot_required ? "Required" : "No"],
  ];
  const poleRows: Array<[string, string | null]> = [
    ["Pole quantity", p.pole_quantity != null ? String(p.pole_quantity) : null],
    ["Pole height", p.pole_height],
    ["Arm length", p.arm_length],
    ["Pole notes", p.pole_notes],
  ];

  const showPricing =
    status === "ready_for_pricing" || status === "priced" || status === "quotation_generated" || status === "won" || status === "lost";

  // P11 — workflow summary (only requested steps gate the project).
  const STEP_TEXT: Record<string, { text: string; cls: string }> = {
    complete: { text: "✓ Complete", cls: "text-emerald-700" },
    pending: { text: "Pending", cls: "text-amber-600" },
    ready: { text: "Ready", cls: "text-violet-700" },
    na: { text: "Not requested", cls: "text-neutral-400" },
  };
  const stepOf = (requested: boolean, done: boolean) => (!requested ? "na" : done ? "complete" : "pending");
  const pricingDone = ["priced", "quotation_generated", "won", "lost"].includes(status);
  const workflowSteps: Array<{ label: string; state: keyof typeof STEP_TEXT }> = [
    { label: "Factory Cost", state: stepOf(!!p.req_product_pricing, cost?.status === "completed") },
    { label: "Packing List", state: stepOf(!!p.req_packing_list, pack?.status === "completed") },
    { label: "Freight Cost", state: stepOf(!!p.req_freight, freight?.status === "completed") },
    { label: "Pricing", state: pricingDone ? "complete" : status === "ready_for_pricing" ? "ready" : "pending" },
    { label: "Quotation", state: p.generated_document_id ? "complete" : "pending" },
  ];

  return (
    <div className="mx-auto max-w-screen-xl px-6 py-8 space-y-6">
      <Link href="/projects" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Project Requests
      </Link>

      {/* HEADER */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="doc-title">{p.name}</h1>
          <ProjectStatusBadge status={status} archived={!!p.archived_at} />
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Client" value={p.clients?.company_name ?? "—"} />
          <Meta label="Product category" value={p.product_categories?.name ?? "—"} />
          <Meta label="Country" value={p.country ?? "—"} />
          <Meta label="Quantity" value={p.quantity != null ? String(p.quantity) : "—"} />
          <Meta label="Opportunity" value={money(p.opportunity_value)} />
          <Meta label="Owner" value={p.owner_id ? ownerLabels.get(p.owner_id) ?? "—" : "—"} />
          <Meta label="Created" value={p.created_at ? String(p.created_at).slice(0, 10) : "—"} />
          <Meta
            label="Requested"
            value={[p.req_product_pricing && "Cost", p.req_packing_list && "Packing", p.req_freight && "Freight"].filter(Boolean).join(" · ") || "—"}
          />
        </div>
        {/* Legacy clientless project — must set a client before pricing (P9). */}
        {!p.client_id && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {canCreate ? (
              <form action={setProjectClient} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">No client set — required before pricing.</span>
                <input type="hidden" name="id" value={p.id} />
                <select name="client_id" required className="rounded border px-2 py-1 text-sm">
                  <option value="">Select a client…</option>
                  {clientOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button className="btn-secondary text-sm">Set client</button>
              </form>
            ) : (
              <span className="font-medium">No client set — a client is required before this project can be priced.</span>
            )}
          </div>
        )}
      </div>

      {/* STEPPER */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-[12px]">
        {STEPPER.map((s, i) => {
          const done = i < stepIdx;
          const active = i === stepIdx && !terminal;
          return (
            <div key={s} className="flex items-center gap-2">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${done ? "bg-emerald-500 text-white" : active ? "bg-solux text-white" : "bg-neutral-100 text-neutral-400"}`}>
                {done ? "✓" : i + 1}
              </span>
              <span className={active ? "font-semibold text-neutral-900" : "text-neutral-500"}>{PROJECT_REQUEST_STATUS_LABEL[s]}</span>
              {i < STEPPER.length - 1 && <span className="text-neutral-300">→</span>}
            </div>
          );
        })}
        {terminal && <ProjectStatusBadge status={status} className="ml-2" />}
      </div>

      {/* ACTION BAR */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
        <div className="eyebrow">Next step</div>
        <div className="flex flex-wrap items-start gap-3">
          {status === "draft" && canCreate && (
            <ActionForm action={submitProjectRequest} success="✓ Submitted for director review">
              <input type="hidden" name="id" value={p.id} />
              <SubmitButton pendingLabel="Submitting…">Submit for review →</SubmitButton>
            </ActionForm>
          )}

          {status === "waiting_director_approval" && canApprove && (
            <>
              <ActionForm action={approveProjectRequest} success="✓ Sent to Operations" className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 p-3">
                <input type="hidden" name="id" value={p.id} />
                <span className="text-[12px] font-medium text-neutral-600">Request from Operations:</span>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="req_product_pricing" defaultChecked={p.req_product_pricing} className="h-4 w-4" /> Factory Cost
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="req_packing_list" defaultChecked={p.req_packing_list} className="h-4 w-4" /> Packing List
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name="req_freight" defaultChecked={p.req_freight} className="h-4 w-4" /> Freight Cost
                </label>
                <SubmitButton className="btn-primary" pendingLabel="Sending…">Send to Operations →</SubmitButton>
              </ActionForm>
              <ActionForm action={requestMoreInfo} success="✓ Information requested" className="flex items-end gap-2">
                <input type="hidden" name="id" value={p.id} />
                <input name="note" placeholder="What's missing?" className="rounded border px-2 py-1.5 text-sm" />
                <SubmitButton className="btn-secondary text-sm" pendingLabel="…">Request info</SubmitButton>
              </ActionForm>
              <ActionForm action={rejectProjectRequest} success="✓ Project rejected" className="flex items-end gap-2">
                <input type="hidden" name="id" value={p.id} />
                <input name="note" placeholder="Reason" className="rounded border px-2 py-1.5 text-sm" />
                <SubmitButton className="text-sm text-rose-600 hover:underline" pendingLabel="…">Reject</SubmitButton>
              </ActionForm>
            </>
          )}
          {status === "waiting_director_approval" && !canApprove && (
            <p className="text-sm text-neutral-500">Waiting for the Sales Director to review.</p>
          )}

          {(status === "waiting_factory_cost" || status === "waiting_logistics") && (
            <p className="text-sm text-neutral-500">
              <b>Operations in progress.</b> Fill the cards below — the project moves to{" "}
              <b>Ready for pricing</b> automatically once every requested item is completed.
            </p>
          )}

          {status === "ready_for_pricing" && canPrice && (
            <a href="#pricing" className="btn-primary">Start pricing →</a>
          )}
          {status === "ready_for_pricing" && !canPrice && (
            <p className="text-sm text-neutral-500">Waiting for the Sales Director to set pricing.</p>
          )}

          {(status === "priced" || status === "quotation_generated") && canGenerate && (
            <ActionForm
              action={generateQuotationFromProject}
              success={status === "quotation_generated" ? "✓ Quotation regenerated" : "✓ Quotation generated"}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 p-3"
            >
              <input type="hidden" name="id" value={p.id} />
              <span className="text-[12px] font-medium text-neutral-600">Include:</span>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="include_product" defaultChecked={status === "quotation_generated" ? p.quote_include_product !== false : true} className="h-4 w-4" /> Product
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="include_pole" defaultChecked={status === "quotation_generated" ? !!p.quote_include_pole : !!p.pole_final_price} className="h-4 w-4" /> Pole
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="include_freight" defaultChecked={status === "quotation_generated" ? !!p.quote_include_freight : p.req_freight} className="h-4 w-4" /> Freight
              </label>
              <SubmitButton className="btn-primary" pendingLabel={status === "quotation_generated" ? "Regenerating…" : "Generating…"}>
                {status === "quotation_generated" ? "↻ Regenerate quotation" : "⚡ Generate quotation"}
              </SubmitButton>
            </ActionForm>
          )}

          {status === "quotation_generated" && p.generated_document_id && (
            <Link href={`/documents/${p.generated_document_id}`} className="btn-primary">
              Open generated quotation →
            </Link>
          )}
          {status === "quotation_generated" && canGenerate && (
            <p className="text-xs text-neutral-500">
              Freight now appears in the quotation&apos;s Shipping section (not as a product line). If your existing
              quotation still shows freight as a line, click <b>Regenerate quotation</b> to rebuild it.
            </p>
          )}

          {(status === "priced" || status === "quotation_generated") && canPrice && (
            <>
              <ActionForm action={setProjectOutcome} success="✓ Marked won">
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="outcome" value="won" />
                <SubmitButton className="text-sm text-emerald-700 hover:underline" pendingLabel="…">Mark won</SubmitButton>
              </ActionForm>
              <ActionForm action={setProjectOutcome} success="✓ Marked lost">
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="outcome" value="lost" />
                <SubmitButton className="text-sm text-neutral-500 hover:underline" pendingLabel="…">Mark lost</SubmitButton>
              </ActionForm>
            </>
          )}
          {!terminal && canCreate && (
            <ActionForm action={setProjectOutcome} success="✓ Project cancelled">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="outcome" value="cancelled" />
              <SubmitButton className="text-sm text-neutral-400 hover:text-rose-600 hover:underline" pendingLabel="…">Cancel</SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>

      {/* WORKFLOW SUMMARY (P11) — understand status at a glance */}
      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="eyebrow mb-3">Workflow</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          {workflowSteps.map((s) => (
            <div key={s.label}>
              <div className="text-[10px] uppercase tracking-wide text-neutral-400">{s.label}</div>
              <div className={`text-sm font-medium ${STEP_TEXT[s.state].cls}`}>{STEP_TEXT[s.state].text}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* TECHNICAL — Solar product + Pole, visually separated */}
          <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-4">
            <div>
              <div className="eyebrow mb-3">Solar product configuration</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                {solarRows.map(([k, v]) => (
                  <Meta key={k} label={k} value={v || "—"} />
                ))}
              </div>
            </div>
            <div className="border-t border-neutral-100 pt-4">
              <div className="eyebrow mb-3">Pole configuration · {p.pole_required === false ? "No poles" : "Poles included"}</div>
              {p.pole_required === false ? (
                <p className="text-sm text-neutral-400">This project does not include poles.</p>
              ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                  {poleRows.map(([k, v]) => (
                    <Meta key={k} label={k} value={v || "—"} />
                  ))}
                </div>
              )}
            </div>
            {(p.freight_transport_mode || p.freight_destination) && (
              <div className="border-t border-neutral-100 pt-4">
                <div className="eyebrow mb-3">Freight brief (requested)</div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                  <Meta label="Transport mode" value={transportModeLabel(p.freight_transport_mode)} />
                  <Meta label="Destination" value={p.freight_destination ?? "—"} />
                  {p.freight_notes && <Meta label="Notes" value={p.freight_notes} />}
                </div>
              </div>
            )}
            {p.additional_notes && <p className="border-t border-neutral-100 pt-3 text-sm text-neutral-600">{p.additional_notes}</p>}
          </section>

          {/* FACTORY COST — view_cost only (hidden from Sales) */}
          {canViewCost && p.req_product_pricing && (
            <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="eyebrow">Factory cost (RMB)</div>
                <span className="text-[10px] uppercase text-neutral-400">{cost?.status ?? "not requested"}</span>
              </div>
              {cost && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    Product: <b className="tabular-nums">{cost.product_cost_rmb != null ? `${Number(cost.product_cost_rmb).toLocaleString()} RMB` : "—"}</b>{" "}
                    <span className="text-neutral-400">{usd(cost.product_cost_rmb)}</span>
                  </div>
                  <div>
                    Pole: <b className="tabular-nums">{cost.pole_cost_rmb != null ? `${Number(cost.pole_cost_rmb).toLocaleString()} RMB` : "—"}</b>{" "}
                    <span className="text-neutral-400">{usd(cost.pole_cost_rmb)}</span>
                  </div>
                  {cost.cost_notes && <div className="col-span-2 text-neutral-500">{cost.cost_notes}</div>}
                </div>
              )}
              {canCost && cost && (
                <ActionForm action={enterFactoryCost} success="✓ Factory cost updated" className="grid grid-cols-2 gap-2 border-t border-neutral-100 pt-3">
                  <input type="hidden" name="project_id" value={p.id} />
                  <label className="block">
                    <span className="text-[11px] text-neutral-500">Product cost RMB</span>
                    <input name="product_cost_rmb" type="number" min={0} step="0.01" defaultValue={cost.product_cost_rmb ?? ""} className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-neutral-500">Pole cost RMB</span>
                    <input name="pole_cost_rmb" type="number" min={0} step="0.01" defaultValue={cost.pole_cost_rmb ?? ""} className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm" />
                  </label>
                  <label className="block col-span-2">
                    <span className="text-[11px] text-neutral-500">Cost notes (e.g. MOQ)</span>
                    <input name="cost_notes" defaultValue={cost.cost_notes ?? ""} placeholder="e.g. MOQ 500 pcs" className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm" />
                  </label>
                  <SubmitButton className="btn-secondary text-sm" pendingLabel="Saving…">{cost.status === "completed" ? "Update cost" : "Save cost"}</SubmitButton>
                </ActionForm>
              )}
              {/* Director override (audited) */}
              {canOverride && cost && (
                <details className="border-t border-neutral-100 pt-3">
                  <summary className="cursor-pointer text-xs font-medium text-amber-700">Override cost (audited)</summary>
                  <ActionForm action={overrideFactoryCost} success="✓ Factory cost overridden (logged)" className="mt-2 grid grid-cols-2 gap-2">
                    <input type="hidden" name="project_id" value={p.id} />
                    <label className="block">
                      <span className="text-[11px] text-neutral-500">New product RMB</span>
                      <input name="product_cost_rmb" type="number" min={0} step="0.01" defaultValue={cost.product_cost_rmb ?? ""} className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-neutral-500">New pole RMB</span>
                      <input name="pole_cost_rmb" type="number" min={0} step="0.01" defaultValue={cost.pole_cost_rmb ?? ""} className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm" />
                    </label>
                    <label className="block col-span-2">
                      <span className="text-[11px] text-neutral-500">Reason * (required, audited)</span>
                      <input name="reason" required placeholder="e.g. Factory verbally updated cost" className="mt-0.5 w-full rounded border px-2 py-1.5 text-sm" />
                    </label>
                    <SubmitButton className="text-sm text-amber-700 hover:underline" pendingLabel="Saving…">Override &amp; log</SubmitButton>
                  </ActionForm>
                </details>
              )}
              {/* Audit trail */}
              {auditRows.length > 0 && (
                <div className="border-t border-neutral-100 pt-3">
                  <div className="text-[10px] uppercase text-neutral-400">Cost audit trail</div>
                  <ul className="mt-1 space-y-1 text-[12px] text-neutral-600">
                    {auditRows.map((a) => (
                      <li key={a.id}>
                        <span className="font-medium">{a.field === "pole_cost_rmb" ? "Pole" : "Product"}</span>: {a.old_value ?? "—"} → {a.new_value ?? "—"} RMB
                        {a.reason ? ` · ${a.reason}` : ""} · {a.changed_by ? ownerLabels.get(a.changed_by) ?? "—" : "—"} · {a.changed_at ? String(a.changed_at).slice(0, 10) : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* PACKING + FREIGHT */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {p.req_packing_list && (
              <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="eyebrow">Packing list</div>
                  <span className="text-[10px] uppercase text-neutral-400">{pack?.status ?? "not requested"}</span>
                </div>
                {pack?.status === "completed" && (
                  <div className="space-y-1 text-sm">
                    <div>
                      {Array.isArray(pack.containers) && pack.containers.length > 0
                        ? pack.containers.map((c: any) => `${c.quantity} × ${c.type}`).join(", ")
                        : "—"}
                      {pack.total_cbm != null ? ` · ${pack.total_cbm} CBM` : ""}
                    </div>
                    {pack.loading_notes && <div className="text-neutral-500">{pack.loading_notes}</div>}
                  </div>
                )}
                {canLogistics && pack && (
                  <PackingEntryForm
                    projectId={p.id}
                    defaultContainers={Array.isArray(pack.containers) ? pack.containers : []}
                    defaultCbm={pack.total_cbm ?? null}
                    defaultNotes={pack.loading_notes ?? null}
                    completed={pack.status === "completed"}
                  />
                )}
                {/* Optional Packing List document (PDF/Excel) — P4 */}
                {pack && (
                  <div className="border-t border-neutral-100 pt-3">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-400">Attach packing list document (optional)</div>
                    {canLogistics && <ProjectFilesUploader projectId={p.id} fixedCategory="packing" label="Packing list PDF / Excel." />}
                    {fileRows.filter((f) => f.category === "packing").length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {fileRows
                          .filter((f) => f.category === "packing")
                          .map((f) => (
                            <li key={f.id} className="truncate text-[12px]">
                              <a href={signed.get(f.id) ?? "#"} target="_blank" rel="noreferrer" className="text-neutral-700 hover:underline">
                                {f.file_name}
                              </a>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            )}

            {p.req_freight && (
              <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="eyebrow">Freight cost</div>
                  <span className="text-[10px] uppercase text-neutral-400">{freight?.status ?? "not requested"}</span>
                </div>
                {freight?.status === "completed" && (
                  <div className="space-y-1 text-sm">
                    <div>
                      {freight.transport_mode ? `${transportModeLabel(freight.transport_mode)} · ` : ""}
                      {freight.incoterm ? `${freight.incoterm} · ` : ""}
                      {freight.port_of_destination ?? freight.destination_country ?? "—"}
                    </div>
                    {Array.isArray(freight.containers) && freight.containers.length > 0 && (
                      <ul className="text-neutral-600">
                        {freight.containers.map((c: any, i: number) => (
                          <li key={i} className="tabular-nums">
                            {c.quantity} × {c.type} @ {money(c.freight_per_unit)} = <b>{money((c.quantity ?? 0) * (c.freight_per_unit ?? 0))}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div>Total freight: <b className="tabular-nums">{money(freight.estimated_total_freight)}</b></div>
                    {freight.notes && <div className="text-neutral-500">{freight.notes}</div>}
                  </div>
                )}
                {canLogistics && freight && (
                  packingContainers.length > 0 ? (
                    <FreightEntryForm
                      projectId={p.id}
                      packingContainers={packingContainers}
                      freightContainers={Array.isArray(freight.containers) ? freight.containers : []}
                      defaults={{
                        transport_mode: freight.transport_mode ?? null,
                        incoterm: freight.incoterm ?? null,
                        port_of_destination: freight.port_of_destination ?? null,
                        destination_country: freight.destination_country ?? null,
                        notes: freight.notes ?? null,
                      }}
                      countryFallback={p.country ?? null}
                      completed={freight.status === "completed"}
                    />
                  ) : (
                    <p className="border-t border-neutral-100 pt-3 text-sm text-amber-700">
                      Freight is generated from the Packing List. Complete the packing
                      containers {p.req_packing_list ? "in the card to the left" : "first"} — then price each container here.
                    </p>
                  )
                )}
              </section>
            )}
          </div>

          {/* PRICING */}
          {/* Pricing is the Sales Director's job — gated on project.set_pricing,
              NOT view_cost. Operations / TLM / Finance never see it. */}
          {showPricing && canPrice && (
            <section id="pricing" className="scroll-mt-6 rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
              <div className="eyebrow">Pricing — Product &amp; Pole</div>
              <ProjectPricingCard
                projectId={p.id}
                projectName={p.name}
                clientName={p.clients?.company_name ?? null}
                country={p.country ?? null}
                categoryName={p.product_categories?.name ?? null}
                freightType={transportModeLabel(freight?.transport_mode ?? p.freight_transport_mode)}
                exchangeRate={settings.exchangeRate}
                taxRebate={settings.taxRebate}
                poleRequired={p.pole_required !== false}
                productCostRmb={cost?.product_cost_rmb ?? null}
                poleCostRmb={cost?.pole_cost_rmb ?? null}
                quantity={p.quantity ?? null}
                poleQuantity={p.pole_quantity ?? null}
                freightTotal={freight?.estimated_total_freight ?? null}
                defaults={{
                  productMargin: p.product_margin_pct,
                  productCommission: p.product_commission_pct,
                  poleMargin: p.pole_margin_pct,
                  poleCommission: p.pole_commission_pct,
                }}
                defaultNotes={p.margin_notes}
                canEdit={canPrice && (status === "ready_for_pricing" || status === "priced")}
              />
            </section>
          )}
          {/* Read-only selling prices for Sales who will quote (no cost/margin,
              no pricing controls). Operations / TLM / Finance see nothing here. */}
          {showPricing && !canPrice && canGenerate && (p.product_final_price || p.pole_final_price) && (
            <section className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="eyebrow mb-3">Selling prices</div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Meta label="Product / unit" value={money(p.product_final_price)} />
                <Meta label="Pole / unit" value={money(p.pole_final_price)} />
                <Meta label="Freight (est.)" value={money(freight?.estimated_total_freight ?? null)} />
                <Meta
                  label="Total project value"
                  value={money(
                    (Number(p.product_final_price ?? 0) + Number(p.pole_final_price ?? 0)) * Number(p.quantity ?? 0) +
                      Number(freight?.estimated_total_freight ?? 0)
                  )}
                />
              </div>
            </section>
          )}

          {/* PROJECT PRODUCT — the sellable snapshot the quotation is built from (m095) */}
          {pp && (
            <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="eyebrow">Project product</div>
                <span className="text-[10px] uppercase tracking-wide text-neutral-400">Generated · not in catalog</span>
              </div>
              <div className="text-sm font-medium text-neutral-900">{pp.commercial_description ?? p.name}</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Meta label="Category" value={p.product_categories?.name ?? "—"} />
                <Meta label="Product / unit" value={money(pp.product_unit_price)} />
                <Meta label="Pole / unit" value={money(pp.pole_unit_price)} />
                <Meta label="Freight" value={money(pp.freight_total)} />
              </div>
              <p className="text-[11px] text-neutral-400">
                Generated when pricing was approved. The quotation is created directly from this — no catalog product needed.
              </p>
            </section>
          )}

          {/* FILES */}
          <section className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
            <div className="eyebrow">Documents</div>
            {canCreate && <ProjectFilesUploader projectId={p.id} />}
            {fileRows.length === 0 ? (
              <p className="text-sm text-neutral-400">No documents yet.</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {fileRows.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <a href={signed.get(f.id) ?? "#"} target="_blank" rel="noreferrer" className="font-medium text-neutral-900 hover:underline">
                        {f.file_name}
                      </a>
                      <span className="ml-2 text-[11px] text-neutral-400">
                        {PROJECT_FILE_CATEGORY_LABEL[f.category as keyof typeof PROJECT_FILE_CATEGORY_LABEL] ?? f.category}
                        {f.file_size ? ` · ${formatFileSize(f.file_size)}` : ""}
                      </span>
                    </div>
                    {canCreate && (
                      <ActionForm action={deleteProjectFile} success="✓ File removed">
                        <input type="hidden" name="id" value={f.id} />
                        <input type="hidden" name="project_id" value={p.id} />
                        <SubmitButton className="text-neutral-400 hover:text-rose-600" pendingLabel="…">×</SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* RIGHT: activity timeline */}
        <div className="space-y-6">
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="eyebrow mb-3">Activity</div>
            {events.length === 0 ? (
              <p className="text-sm text-neutral-400">No activity yet.</p>
            ) : (
              <ol className="space-y-3">
                {events.map((e: any) => (
                  <li key={e.id} className="flex gap-2.5">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-neutral-800">{eventTypeLabel(e.event_type)}</div>
                      {e.message && <div className="text-[12px] text-neutral-500">{e.message}</div>}
                      <div className="text-[11px] text-neutral-400">{e.created_at ? new Date(e.created_at).toLocaleString() : ""}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
