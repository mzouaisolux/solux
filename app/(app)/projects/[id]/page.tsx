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
import { FreightStatusBadge } from "@/components/projects/FreightStatusBadge";
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
  requestFreightUpdate,
  generateQuotationFromProject,
  setProjectOutcome,
  setProjectClient,
  setProjectAffair,
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

/** Short, scannable activity labels — the timeline is support data, so each
 *  row is a terse event verb rather than a full sentence. Falls back to the
 *  generic eventTypeLabel for anything not listed. */
const PR_EVENT_SHORT: Record<string, string> = {
  "pr.created": "Service request created",
  "pr.submitted": "Submitted for approval",
  "pr.approved": "Sent to operations",
  "pr.rejected": "Rejected",
  "pr.info_requested": "Info requested",
  "pr.cost_entered": "Cost updated",
  "pr.cost_overridden": "Cost overridden",
  "pr.logistics_entered": "Logistics updated",
  "pr.packing_entered": "Packing updated",
  "pr.freight_entered": "Freight updated",
  "pr.ready_for_pricing": "Ready for pricing",
  "pr.priced": "Priced",
  "pr.quotation_generated": "Quote created",
  "pr.won": "Marked won",
  "pr.lost": "Marked lost",
  "pr.cancelled": "Cancelled",
};
const ACTIVITY_PREVIEW = 6;

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  await getEffectiveRole();

  const { data: project } = await supabase
    .from("project_requests")
    .select("*, clients:client_id(company_name, country), product_categories:product_category_id(name), affairs:affair_id(name, status)")
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
  // Freight validity + update audit (m098).
  const today = new Date().toISOString().slice(0, 10);
  const { data: freightAudits } = await supabase
    .from("freight_cost_audit")
    .select("*")
    .eq("project_request_id", params.id)
    .order("changed_at", { ascending: false });
  const freightAuditRows = (freightAudits ?? []) as any[];
  const fileRows = (files ?? []) as any[];

  const signed = new Map<string, string>();
  await Promise.all(
    fileRows.map(async (f) => {
      const { data } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(f.storage_path, 3600);
      if (data?.signedUrl) signed.set(f.id, data.signedUrl);
    })
  );

  const ownerLabels = await resolveUserLabelStrings(
    [
      p.owner_id,
      p.created_by,
      ...auditRows.map((a) => a.changed_by),
      ...events.map((e: any) => e.actor_id),
    ].filter(Boolean) as string[]
  );

  // Legacy clientless project (client is mandatory at creation now) — let an
  // owner/director assign one so pricing/quotation never dead-ends (P9).
  let clientOptions: Array<{ id: string; name: string }> = [];
  if (!p.client_id && canCreate) {
    const { data } = await supabase.from("clients").select("id, company_name").order("company_name", { ascending: true });
    clientOptions = ((data ?? []) as any[]).map((c) => ({ id: c.id, name: c.company_name }));
  }

  // CRM step 1 (m100): unlinked project — offer the client's live affairs so it
  // can be filed under its deal. Optional; legacy rows may stay unlinked.
  let affairOptions: Array<{ id: string; name: string }> = [];
  if (!p.affair_id && p.client_id && canCreate) {
    const { data } = await supabase
      .from("affairs")
      .select("id, name")
      .eq("client_id", p.client_id)
      .is("archived_at", null)
      .not("status", "in", "(lost,abandoned)")
      .order("created_at", { ascending: false });
    affairOptions = ((data ?? []) as any[]).map((a) => ({ id: a.id, name: a.name }));
  }

  const status = p.status as ProjectRequestStatus;
  const stepIdx = STEP_INDEX[status] ?? 0;
  const terminal = status === "won" || status === "lost" || status === "cancelled";

  // BUG-3 — surface the Sales Director's modification message. "Request info"
  // stores the note on a pr.info_requested event; the activity row alone
  // ("Info requested") was far too easy to miss. When the request is sitting
  // back in draft because the latest workflow action was an info request, show
  // the note as a prominent banner so Sales knows exactly WHAT to change.
  const lastFlowEvent = [...(events as any[])]
    .filter((e) => ["pr.info_requested", "pr.submitted", "pr.created"].includes(e.event_type))
    .sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1))[0];
  const changesRequested =
    status === "draft" && lastFlowEvent?.event_type === "pr.info_requested";
  const changesNote: string | null = changesRequested
    ? ((lastFlowEvent.payload?.note ?? "").trim() || null)
    : null;
  const changesBy: string | null =
    changesRequested && lastFlowEvent.actor_id
      ? ownerLabels.get(lastFlowEvent.actor_id) ?? null
      : null;
  const money = (n: number | null | undefined) =>
    n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const usd = (rmb: number | null | undefined) =>
    rmb == null ? "—" : `≈ ${money(Number(rmb) / (settings.exchangeRate || 6.85))}`;

  // Activity helpers — terse label + short "date · author" meta.
  const shortEvent = (t: string) => PR_EVENT_SHORT[t] ?? eventTypeLabel(t as any);
  const actDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "";
  const actMeta = (e: any) =>
    [actDate(e.created_at), e.actor_id ? ownerLabels.get(e.actor_id) ?? "—" : null].filter(Boolean).join(" · ");

  // Inline key → value row (mockup .spec-row), used in the header + config blocks.
  const SpecRow = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="spec-row">
      <span className="sk">{k}</span>
      <span className="sv">{v}</span>
    </div>
  );
  // Label-over-value tile (mockup .meta), used in selling-price / project-product grids.
  const MetaTile = ({ label, value }: { label: string; value: string }) => (
    <div className="meta">
      <div className="mk">{label}</div>
      <div className="mv">{value}</div>
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

  // #17 — the redundant "Workflow summary" tracker was removed. Per-deliverable
  // status now lives ONLY on each Cost/Packing/Freight card (single source, in
  // context with its actions); the stepper shows the lifecycle and the
  // "Next step" panel shows what to do. This also removes the old mixed signal
  // (tracker "Pending" vs a card reading "not requested").

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <Link href="/projects" className="sx-backlink">
          ← Service requests
        </Link>
        <div className="sx-detail" style={{ marginTop: 12 }}>
          {/* HEADER */}
          <div className="card" style={{ padding: "18px 20px" }}>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="sx-detail-title">{p.name}</h1>
              <ProjectStatusBadge status={status} archived={!!p.archived_at} />
            </div>
            <div className="spec-list" style={{ marginTop: 16 }}>
              <SpecRow k="Client" v={p.clients?.company_name ?? "—"} />
              <SpecRow
                k="Affair"
                v={
                  p.affair_id ? (
                    <Link href={`/affairs/${p.affair_id}`} style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
                      {p.affairs?.name ?? "View affair"}
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
              <SpecRow k="Product category" v={p.product_categories?.name ?? "—"} />
              <SpecRow k="Country" v={p.country ?? "—"} />
              <SpecRow k="Quantity" v={p.quantity != null ? String(p.quantity) : "—"} />
              <SpecRow k="Opportunity" v={money(p.opportunity_value)} />
              <SpecRow k="Owner" v={p.owner_id ? ownerLabels.get(p.owner_id) ?? "—" : "—"} />
              <SpecRow k="Created" v={p.created_at ? String(p.created_at).slice(0, 10) : "—"} />
              <SpecRow
                k="Requested"
                v={[p.req_product_pricing && "Cost", p.req_packing_list && "Packing", p.req_freight && "Freight"].filter(Boolean).join(" · ") || "—"}
              />
            </div>
            {/* Legacy clientless project — must set a client before pricing (P9). */}
            {!p.client_id && (
              <div className="note-amber" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 16 }}>
                {canCreate ? (
                  <form action={setProjectClient} className="flex flex-wrap items-center gap-2">
                    <b>No client set — required before pricing.</b>
                    <input type="hidden" name="id" value={p.id} />
                    <select name="client_id" required style={{ maxWidth: 230 }}>
                      <option value="">Select a client…</option>
                      {clientOptions.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <button className="sx-btn sx-btn-sm">Set client</button>
                  </form>
                ) : (
                  <b>No client set — a client is required before this project can be priced.</b>
                )}
              </div>
            )}
            {/* CRM step 1 (m100): unlinked project — optional, quiet link form. */}
            {!p.affair_id && p.client_id && canCreate && affairOptions.length > 0 && (
              <form action={setProjectAffair} className="flex flex-wrap items-center gap-2" style={{ marginTop: 14 }}>
                <span style={{ fontSize: 12, color: "var(--sx-mute-2)" }}>
                  Not filed under an affair yet —
                </span>
                <input type="hidden" name="id" value={p.id} />
                <select name="affair_id" required style={{ maxWidth: 260 }}>
                  <option value="">Select an affair…</option>
                  {affairOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <button className="sx-btn sx-btn-sm">Link affair</button>
              </form>
            )}
          </div>

          {/* STEPPER */}
          <div className="card stepper">
            {STEPPER.map((s, i) => {
              const done = i < stepIdx;
              const active = i === stepIdx && !terminal;
              return (
                <div key={s} className={`step ${done ? "done" : active ? "active" : ""}`}>
                  <span className="scir">
                    {done ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="sl">{PROJECT_REQUEST_STATUS_LABEL[s]}</span>
                  {i < STEPPER.length - 1 && <span className="arr">→</span>}
                </div>
              );
            })}
            {terminal && <ProjectStatusBadge status={status} />}
          </div>

          {/* NEXT STEP — gated by status & role */}
          <div className="card sec">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Next step — gated by status &amp; role</div>

            {status === "draft" && canCreate && (
              <div className="cta-block">
                {changesNote && (
                  <div className="note-amber" style={{ marginBottom: 12, lineHeight: 1.5 }}>
                    <b>Changes requested{changesBy ? ` by ${changesBy}` : ""}:</b> {changesNote}
                    <div style={{ fontSize: 12, color: "var(--sx-mute)", marginTop: 4 }}>
                      Update the request (Edit request), then re-submit for review.
                    </div>
                  </div>
                )}
                <div className="ctitle">Draft — <span className="role">owner action</span></div>
                <div className="cta-row">
                  <ActionForm action={submitProjectRequest} success="✓ Submitted for director review">
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton className="sx-btn sx-btn-go" pendingLabel="Submitting…">Submit for review →</SubmitButton>
                  </ActionForm>
                  {/* BUG-2 — Sales can now edit a draft / returned request. */}
                  <Link href={`/projects/new?edit=${p.id}`} className="sx-btn sx-btn-sm">Edit request</Link>
                </div>
              </div>
            )}

            {status === "waiting_director_approval" && canApprove && (
              <div className="cta-block">
                <div className="ctitle">Waiting director review — <span className="role">director action</span></div>
                <ActionForm action={approveProjectRequest} success="✓ Sent to Operations" className="cta-row">
                  <input type="hidden" name="id" value={p.id} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sx-mute)" }}>Request from Operations:</span>
                  <label className="cta-check"><input type="checkbox" name="req_product_pricing" defaultChecked={p.req_product_pricing} /> Factory Cost</label>
                  <label className="cta-check"><input type="checkbox" name="req_packing_list" defaultChecked={p.req_packing_list} /> Packing List</label>
                  <label className="cta-check"><input type="checkbox" name="req_freight" defaultChecked={p.req_freight} /> Freight Cost</label>
                  <SubmitButton className="sx-btn sx-btn-go" pendingLabel="Sending…">Send to Operations →</SubmitButton>
                </ActionForm>
                <div className="cta-row" style={{ marginTop: 12 }}>
                  <ActionForm action={requestMoreInfo} success="✓ Information requested" className="cta-row">
                    <input type="hidden" name="id" value={p.id} />
                    <input name="note" placeholder="What's missing?" style={{ width: 200 }} />
                    <SubmitButton className="sx-btn sx-btn-sm" pendingLabel="…">Request info</SubmitButton>
                  </ActionForm>
                  <ActionForm action={rejectProjectRequest} success="✓ Service request rejected" className="cta-row">
                    <input type="hidden" name="id" value={p.id} />
                    <input name="note" placeholder="Reason" style={{ width: 160 }} />
                    <SubmitButton className="sx-btn sx-btn-sm sx-btn-danger" pendingLabel="…">Reject</SubmitButton>
                  </ActionForm>
                </div>
              </div>
            )}
            {status === "waiting_director_approval" && !canApprove && (
              <div className="cta-block">
                <div className="ctitle">Waiting director review</div>
                <p style={{ fontSize: 13, color: "var(--sx-mute)" }}>Waiting for the Sales Director to review.</p>
              </div>
            )}

            {(status === "waiting_factory_cost" || status === "waiting_logistics") && (
              <div className="cta-block">
                <div className="ctitle">Operations in progress</div>
                <p style={{ fontSize: 13, color: "var(--sx-mute)", lineHeight: 1.5 }}>
                  <b style={{ color: "var(--sx-ink)" }}>In progress.</b> Fill the cards below — the project moves to{" "}
                  <b style={{ color: "var(--sx-ink)" }}>Ready for pricing</b> automatically once every requested item is completed.
                </p>
              </div>
            )}

            {status === "ready_for_pricing" && canPrice && (
              <div className="cta-block">
                <div className="ctitle">Ready for pricing — <span className="role">director action</span></div>
                <a href="#pricing" className="sx-btn sx-btn-go">Start pricing →</a>
              </div>
            )}
            {status === "ready_for_pricing" && !canPrice && (
              <div className="cta-block">
                <div className="ctitle">Ready for pricing</div>
                <p style={{ fontSize: 13, color: "var(--sx-mute)" }}>Waiting for the Sales Director to set pricing.</p>
              </div>
            )}

            {(status === "priced" || status === "quotation_generated") &&
              (canGenerate || canPrice || (status === "quotation_generated" && p.generated_document_id)) && (
                <div className="cta-block">
                  <div className="ctitle">{status === "quotation_generated" ? "Quotation generated" : "Priced"} — generate quotation</div>
                  {canGenerate && (
                    <ActionForm
                      action={generateQuotationFromProject}
                      success={status === "quotation_generated" ? "✓ Quotation regenerated" : "✓ Quotation generated"}
                      className="cta-row"
                    >
                      <input type="hidden" name="id" value={p.id} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sx-mute)" }}>Include:</span>
                      <label className="cta-check"><input type="checkbox" name="include_product" defaultChecked={status === "quotation_generated" ? p.quote_include_product !== false : true} /> Product</label>
                      <label className="cta-check"><input type="checkbox" name="include_pole" defaultChecked={status === "quotation_generated" ? !!p.quote_include_pole : !!p.pole_final_price} /> Pole</label>
                      <label className="cta-check"><input type="checkbox" name="include_freight" defaultChecked={status === "quotation_generated" ? !!p.quote_include_freight : p.req_freight} /> Freight</label>
                      <SubmitButton className="sx-btn sx-btn-go" pendingLabel={status === "quotation_generated" ? "Regenerating…" : "Generating…"}>
                        {status === "quotation_generated" ? "↻ Regenerate quotation" : "⚡ Generate quotation"}
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {status === "quotation_generated" && p.generated_document_id && (
                    <div className="cta-row" style={{ marginTop: 12 }}>
                      <Link href={`/documents/${p.generated_document_id}`} className="sx-btn sx-btn-ink">
                        Open generated quotation →
                      </Link>
                    </div>
                  )}
                  {status === "quotation_generated" && canGenerate && (
                    <p style={{ fontSize: 11.5, color: "var(--sx-mute-2)", marginTop: 10, lineHeight: 1.5 }}>
                      Freight now appears in the quotation&apos;s Shipping section (not as a product line). If your existing
                      quotation still shows freight as a line, click <b>Regenerate quotation</b> to rebuild it.
                    </p>
                  )}
                  {(status === "priced" || status === "quotation_generated") && canPrice && (
                    <div className="cta-row" style={{ marginTop: 12 }}>
                      <ActionForm action={setProjectOutcome} success="✓ Marked won">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="outcome" value="won" />
                        <SubmitButton className="sx-link" pendingLabel="…">Mark won</SubmitButton>
                      </ActionForm>
                      <ActionForm action={setProjectOutcome} success="✓ Marked lost">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="outcome" value="lost" />
                        <SubmitButton className="sx-muted-link" pendingLabel="…">Mark lost</SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </div>
              )}

            {!terminal && canCreate && (
              <div className="cta-row" style={{ marginTop: 14 }}>
                <ActionForm action={setProjectOutcome} success="✓ Service request cancelled">
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="outcome" value="cancelled" />
                  <SubmitButton className="sx-muted-link" pendingLabel="…">Cancel service request</SubmitButton>
                </ActionForm>
              </div>
            )}
          </div>


          <div className="detail-cols">
            <div className="detail-main">
              {/* TECHNICAL — Solar product + Pole, visually separated */}
              <section className="card sec" style={{ marginTop: 0 }}>
                <div className="eyebrow" style={{ marginBottom: 14 }}>Solar product configuration</div>
                <div className="spec-list">
                  {solarRows.map(([k, v]) => (
                    <SpecRow key={k} k={k} v={v || "—"} />
                  ))}
                </div>
                <div style={{ borderTop: "1px solid var(--sx-line)", marginTop: 18, paddingTop: 16 }}>
                  <div className="eyebrow" style={{ marginBottom: 14 }}>Pole configuration · {p.pole_required === false ? "No poles" : "Poles included"}</div>
                  {p.pole_required === false ? (
                    <p style={{ fontSize: 13, color: "var(--sx-mute-2)" }}>This project does not include poles.</p>
                  ) : (
                    <div className="spec-list">
                      {poleRows.map(([k, v]) => (
                        <SpecRow key={k} k={k} v={v || "—"} />
                      ))}
                    </div>
                  )}
                </div>
                {(p.freight_transport_mode || p.freight_destination) && (
                  <div style={{ borderTop: "1px solid var(--sx-line)", marginTop: 18, paddingTop: 16 }}>
                    <div className="eyebrow" style={{ marginBottom: 14 }}>Freight brief (requested)</div>
                    <div className="spec-list">
                      <SpecRow k="Transport mode" v={transportModeLabel(p.freight_transport_mode)} />
                      <SpecRow k="Destination" v={p.freight_destination ?? "—"} />
                      {p.freight_notes && <SpecRow k="Notes" v={p.freight_notes} />}
                    </div>
                  </div>
                )}
                {p.additional_notes && (
                  <p style={{ borderTop: "1px solid var(--sx-line)", marginTop: 16, paddingTop: 14, fontSize: 13, color: "var(--sx-mute)", lineHeight: 1.5 }}>{p.additional_notes}</p>
                )}
              </section>

              {/* O1 — make the Operations pricing SEQUENCE explicit up front.
                  Freight is built from the packing list (an INTENDED dependency,
                  not a bug) — surfaced here as a sequence instead of as a late
                  dead-end inside the freight card. */}
              {(canCost || canLogistics) &&
                (status === "waiting_factory_cost" || status === "waiting_logistics") && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "baseline",
                      gap: "4px 10px",
                      margin: "0 0 14px",
                      padding: "10px 14px",
                      border: "1px solid var(--sx-line, #e5e5e5)",
                      borderRadius: 10,
                      background: "var(--sx-soft, #f8f8f7)",
                    }}
                  >
                    <span className="sx-micro" style={{ fontWeight: 700 }}>
                      Operations pricing — complete in order
                    </span>
                    <span style={{ fontSize: 12.5, color: "var(--sx-mute, #666)" }}>
                      ① Factory cost → ② Packing list → ③ Freight (built from the packing list)
                    </span>
                  </div>
                )}

              {/* FACTORY COST — view_cost only (hidden from Sales) */}
              {canViewCost && p.req_product_pricing && (
                <section className="card sec" style={{ marginTop: 0, borderLeft: "3px solid var(--sx-ink)" }}>
                  <div className="sechead">
                    <div className="eyebrow">① Factory cost (RMB)</div>
                    <span className="right">{cost?.status ?? "not requested"}</span>
                  </div>
                  {cost && (
                    <div className="cost-grid">
                      <div>Product: <b>{cost.product_cost_rmb != null ? `${Number(cost.product_cost_rmb).toLocaleString()} RMB` : "—"}</b> <span className="usd">{usd(cost.product_cost_rmb)}</span></div>
                      <div>Pole: <b>{cost.pole_cost_rmb != null ? `${Number(cost.pole_cost_rmb).toLocaleString()} RMB` : "—"}</b> <span className="usd">{usd(cost.pole_cost_rmb)}</span></div>
                      {cost.cost_notes && <div style={{ gridColumn: "span 2", color: "var(--sx-mute)" }}>{cost.cost_notes}</div>}
                    </div>
                  )}
                  {canCost && cost && (
                    <div style={{ borderTop: "1px solid var(--sx-line)", marginTop: 14, paddingTop: 14 }}>
                      <ActionForm action={enterFactoryCost} success="✓ Factory cost updated">
                        <input type="hidden" name="project_id" value={p.id} />
                        <div className="fgrid two">
                          <div className="fcol"><span className="fl">Product cost RMB</span><input name="product_cost_rmb" type="number" min={0} step="0.01" defaultValue={cost.product_cost_rmb ?? ""} /></div>
                          <div className="fcol"><span className="fl">Pole cost RMB</span><input name="pole_cost_rmb" type="number" min={0} step="0.01" defaultValue={cost.pole_cost_rmb ?? ""} /></div>
                          <div className="fcol span2"><span className="fl">Cost notes (e.g. MOQ)</span><input name="cost_notes" defaultValue={cost.cost_notes ?? ""} placeholder="e.g. MOQ 500 pcs" /></div>
                        </div>
                        <div className="savebar"><SubmitButton className="sx-btn" pendingLabel="Saving…">{cost.status === "completed" ? "Update cost" : "Save cost"}</SubmitButton></div>
                      </ActionForm>
                    </div>
                  )}
                  {/* Director override (audited) */}
                  {canOverride && cost && (
                    <details style={{ borderTop: "1px solid var(--sx-line)", marginTop: 14, paddingTop: 14 }}>
                      <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--sx-amber-deep)" }}>Override cost (audited)</summary>
                      <ActionForm action={overrideFactoryCost} success="✓ Factory cost overridden (logged)">
                        <input type="hidden" name="project_id" value={p.id} />
                        <div className="fgrid two" style={{ marginTop: 10 }}>
                          <div className="fcol"><span className="fl">New product RMB</span><input name="product_cost_rmb" type="number" min={0} step="0.01" defaultValue={cost.product_cost_rmb ?? ""} /></div>
                          <div className="fcol"><span className="fl">New pole RMB</span><input name="pole_cost_rmb" type="number" min={0} step="0.01" defaultValue={cost.pole_cost_rmb ?? ""} /></div>
                          <div className="fcol span2"><span className="fl">Reason <span className="req">*</span> (required, audited)</span><input name="reason" required placeholder="e.g. Factory verbally updated cost" /></div>
                        </div>
                        <div className="savebar"><SubmitButton className="sx-btn sx-btn-sm sx-btn-danger" pendingLabel="Saving…">Override &amp; log</SubmitButton></div>
                      </ActionForm>
                    </details>
                  )}
                  {/* Audit trail */}
                  {auditRows.length > 0 && (
                    <ul className="audit-list">
                      <div className="sx-micro" style={{ marginBottom: 6 }}>Cost audit trail</div>
                      {auditRows.map((a) => (
                        <li key={a.id}>
                          <b>{a.field === "pole_cost_rmb" ? "Pole" : "Product"}</b>: {a.old_value ?? "—"} → {a.new_value ?? "—"} RMB
                          {a.reason ? ` · ${a.reason}` : ""} · {a.changed_by ? ownerLabels.get(a.changed_by) ?? "—" : "—"} · {a.changed_at ? String(a.changed_at).slice(0, 10) : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {/* PACKING + FREIGHT */}
              <div className="sx-pf-grid">
                {p.req_packing_list && (
                  <section className="card sec" style={{ marginTop: 0 }}>
                    <div className="sechead"><div className="eyebrow">② Packing list</div><span className="right">{pack?.status ?? "not requested"}</span></div>
                    {pack?.status === "completed" && (
                      <div style={{ fontSize: 13.5 }}>
                        <div style={{ fontWeight: 600 }}>
                          {Array.isArray(pack.containers) && pack.containers.length > 0
                            ? pack.containers.map((c: any) => `${c.quantity} × ${c.type}`).join(", ")
                            : "—"}
                          {pack.total_cbm != null ? ` · ${pack.total_cbm} CBM` : ""}
                        </div>
                        {pack.loading_notes && <div style={{ color: "var(--sx-mute)", marginTop: 4 }}>{pack.loading_notes}</div>}
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
                      <div style={{ borderTop: "1px solid var(--sx-line)", marginTop: 14, paddingTop: 14 }}>
                        <div className="sx-micro" style={{ marginBottom: 6 }}>Attach packing list document (optional)</div>
                        {canLogistics && <ProjectFilesUploader projectId={p.id} fixedCategory="packing" label="Packing list PDF / Excel." />}
                        {fileRows.filter((f) => f.category === "packing").length > 0 && (
                          <ul style={{ marginTop: 6, listStyle: "none" }}>
                            {fileRows
                              .filter((f) => f.category === "packing")
                              .map((f) => (
                                <li key={f.id} className="truncate" style={{ fontSize: 12 }}>
                                  <a href={signed.get(f.id) ?? "#"} target="_blank" rel="noreferrer" className="sx-link" style={{ color: "var(--sx-ink-soft)" }}>
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
                  <section className="card sec" style={{ marginTop: 0 }}>
                    <div className="sechead">
                      <div className="eyebrow">③ Freight cost</div>
                      <span className="right">
                        {freight?.valid_until && <FreightStatusBadge validUntil={freight.valid_until} today={today} />}
                        {freight?.status ?? "not requested"}
                      </span>
                    </div>
                    {/* Request Freight Update (m098) — Sales/owner refresh, no director. */}
                    {freight?.status === "completed" && canGenerate && (
                      freight.update_requested_at ? (
                        <p className="note-amber" style={{ marginTop: 10 }}>⏳ Freight update requested — waiting on Operations.</p>
                      ) : (
                        <ActionForm action={requestFreightUpdate} success="✓ Freight update requested" className="cta-row">
                          <input type="hidden" name="project_id" value={p.id} />
                          <SubmitButton className="sx-btn sx-btn-sm" pendingLabel="Requesting…">↻ Request freight update</SubmitButton>
                        </ActionForm>
                      )
                    )}
                    {freight?.status === "completed" && (
                      <div style={{ fontSize: 13.5, marginTop: 10 }}>
                        <div style={{ fontWeight: 600 }}>
                          {freight.transport_mode ? `${transportModeLabel(freight.transport_mode)} · ` : ""}
                          {freight.incoterm ? `${freight.incoterm} · ` : ""}
                          {freight.port_of_destination ?? freight.destination_country ?? "—"}
                        </div>
                        {Array.isArray(freight.containers) && freight.containers.length > 0 && (
                          <ul style={{ listStyle: "none", color: "var(--sx-ink-soft)", marginTop: 6 }}>
                            {freight.containers.map((c: any, i: number) => (
                              <li key={i} className="sx-tnum">
                                {c.quantity} × {c.type} @ {money(c.freight_per_unit)} = <b>{money((c.quantity ?? 0) * (c.freight_per_unit ?? 0))}</b>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div style={{ marginTop: 6 }}>Total freight: <b className="sx-tnum">{money(freight.estimated_total_freight)}</b></div>
                        {freight.notes && <div style={{ color: "var(--sx-mute)", marginTop: 4 }}>{freight.notes}</div>}
                      </div>
                    )}
                    {canLogistics && freight && (
                      packingContainers.length > 0 ? (
                        <FreightEntryForm
                          projectId={p.id}
                          goodsValue={
                            (Number(p.product_final_price ?? 0) +
                              Number(p.pole_final_price ?? 0)) *
                            Number(p.quantity ?? 0)
                          }
                          packingContainers={packingContainers}
                          freightContainers={Array.isArray(freight.containers) ? freight.containers : []}
                          defaults={{
                            transport_mode: freight.transport_mode ?? null,
                            incoterm: freight.incoterm ?? null,
                            port_of_destination: freight.port_of_destination ?? null,
                            destination_country: freight.destination_country ?? null,
                            notes: freight.notes ?? null,
                            valid_until: freight.valid_until ?? null,
                            insurance_cost: freight.insurance_cost ?? null,
                            additional_charges: Array.isArray(freight.additional_charges)
                              ? freight.additional_charges
                              : null,
                          }}
                          countryFallback={p.country ?? null}
                          completed={freight.status === "completed"}
                        />
                      ) : (
                        <p className="note-amber" style={{ marginTop: 12 }}>
                          Freight is generated from the Packing List. Complete the packing
                          containers {p.req_packing_list ? "in the card to the left" : "first"} — then price each container here.
                        </p>
                      )
                    )}
                    {/* Freight update history (m098) — append-only audit. */}
                    {freightAuditRows.length > 0 && (
                      <div style={{ borderTop: "1px solid var(--sx-line)", marginTop: 14, paddingTop: 14 }}>
                        <div className="sx-micro" style={{ marginBottom: 8 }}>Freight update history</div>
                        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                          {freightAuditRows.slice(0, 6).map((a) => (
                            <li key={a.id} style={{ border: "1px solid var(--sx-line)", background: "#fafafa", padding: "6px 10px", fontSize: 12 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span className="sx-tnum" style={{ fontWeight: 600, color: "var(--sx-ink-soft)" }}>
                                  {money(a.old_total)} → {money(a.new_total)}
                                </span>
                                <span style={{ color: "var(--sx-mute-2)" }}>{new Date(a.changed_at).toLocaleDateString()}</span>
                              </div>
                              {a.new_valid_until && <div style={{ color: "var(--sx-mute)" }}>New validity: {a.new_valid_until}</div>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                )}
              </div>

              {/* PRICING — Sales Director's job (project.set_pricing, not view_cost) */}
              {showPricing && canPrice && (
                <section id="pricing" className="card sec" style={{ marginTop: 0, scrollMarginTop: 24 }}>
                  <div className="eyebrow" style={{ marginBottom: 12 }}>Pricing — product &amp; pole</div>
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
              {/* Read-only selling prices for Sales who will quote */}
              {showPricing && !canPrice && canGenerate && (p.product_final_price || p.pole_final_price) && (
                <section className="card sec" style={{ marginTop: 0 }}>
                  <div className="eyebrow" style={{ marginBottom: 14 }}>Selling prices</div>
                  <div className="selling-grid">
                    <MetaTile label="Product / unit" value={money(p.product_final_price)} />
                    <MetaTile label="Pole / unit" value={money(p.pole_final_price)} />
                    <MetaTile label="Freight (est.)" value={money(freight?.estimated_total_freight ?? null)} />
                    <MetaTile
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
                <section className="card sec" style={{ marginTop: 0 }}>
                  <div className="sechead"><div className="eyebrow">Project product</div><span className="right">Generated · not in catalog</span></div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--sx-ink)", marginBottom: 14 }}>{pp.commercial_description ?? p.name}</div>
                  <div className="selling-grid">
                    <MetaTile label="Category" value={p.product_categories?.name ?? "—"} />
                    <MetaTile label="Product / unit" value={money(pp.product_unit_price)} />
                    <MetaTile label="Pole / unit" value={money(pp.pole_unit_price)} />
                    <MetaTile label="Freight" value={money(pp.freight_total)} />
                  </div>
                  <p style={{ fontSize: 11, color: "var(--sx-mute-2)", marginTop: 12, lineHeight: 1.5 }}>
                    Generated when pricing was approved. The quotation is created directly from this — no catalog product needed.
                  </p>
                </section>
              )}

              {/* FILES */}
              <section className="card sec" style={{ marginTop: 0 }}>
                <div className="eyebrow" style={{ marginBottom: 12 }}>Documents</div>
                {canCreate && <ProjectFilesUploader projectId={p.id} />}
                {fileRows.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--sx-mute-2)", marginTop: 8 }}>No documents yet.</p>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    {fileRows.map((f) => (
                      <div key={f.id} className="docrow">
                        <span className="dn">
                          <a href={signed.get(f.id) ?? "#"} target="_blank" rel="noreferrer" className="sx-link" style={{ color: "var(--sx-ink)" }}>
                            {f.file_name}
                          </a>
                          <span className="dm">
                            · {PROJECT_FILE_CATEGORY_LABEL[f.category as keyof typeof PROJECT_FILE_CATEGORY_LABEL] ?? f.category}
                            {f.file_size ? ` · ${formatFileSize(f.file_size)}` : ""}
                          </span>
                        </span>
                        {canCreate && (
                          <ActionForm action={deleteProjectFile} success="✓ File removed">
                            <input type="hidden" name="id" value={f.id} />
                            <input type="hidden" name="project_id" value={p.id} />
                            <SubmitButton className="x" pendingLabel="…">×</SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* ACTIVITY — compact full-width footer. History is support data:
                latest few as terse one-liners, full trail behind an expander. */}
            <div className="card sec sx-activity" style={{ marginTop: 0 }}>
              <div className="sx-act-head">
                <div className="eyebrow">Activity</div>
                {events.length > 0 && (
                  <span className="sx-act-count">{events.length} event{events.length === 1 ? "" : "s"}</span>
                )}
              </div>
              {events.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--sx-mute-2)" }}>No activity yet.</p>
              ) : (
                <>
                  <ul className="sx-act-list">
                    {events.slice(0, ACTIVITY_PREVIEW).map((e: any) => (
                      <li key={e.id} className="sx-act-row">
                        <span className="sx-act-label"><span className="d" />{(/pr\.(info_requested|rejected)/.test(e.event_type) && e.message) ? e.message : shortEvent(e.event_type)}</span>
                        <span className="sx-act-meta">{actMeta(e)}</span>
                      </li>
                    ))}
                  </ul>
                  {events.length > ACTIVITY_PREVIEW && (
                    <details className="sx-act-more">
                      <summary>View full history ({events.length})</summary>
                      <ul className="sx-act-list">
                        {events.slice(ACTIVITY_PREVIEW).map((e: any) => (
                          <li key={e.id} className="sx-act-row">
                            <span className="sx-act-label"><span className="d" />{(/pr\.(info_requested|rejected)/.test(e.event_type) && e.message) ? e.message : shortEvent(e.event_type)}</span>
                            <span className="sx-act-meta">{actMeta(e)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
