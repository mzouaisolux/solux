import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import NewProjectForm, { type ProjectFormInitial } from "./NewProjectForm";

export const dynamic = "force-dynamic";

/**
 * New project request — the FULL form, optionally PRE-FILLED (m109):
 *   ?tender=<id> — everything the tender already knows arrives filled
 *     (name, country, quantity, value, buyer/closing/reference/documents
 *     in the notes, partner client when attached, linked opportunity).
 *     The partner may be unknown → client becomes optional for this flow.
 *   ?affair=<id> — pre-filled from the opportunity (name, client, country).
 * Every standard field stays available — the user only saves the
 * re-typing, nothing is removed.
 */
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams?: { tender?: string; affair?: string; client?: string; edit?: string };
}) {
  await getEffectiveRole();
  const canCreate = await hasUiCapability("project.create");
  if (!canCreate) return <AccessDenied capability="project.create" />;

  const supabase = createClient();
  const [{ data: clients }, { data: categories }, { data: affairs }] = await Promise.all([
    supabase.from("clients").select("id, company_name, country").order("company_name", { ascending: true }),
    supabase
      .from("product_categories")
      .select("id, name")
      .eq("is_template", false)
      .order("position")
      .order("name"),
    // CRM step 1 (m100): the client's live deals — closed/archived affairs are
    // not selectable for a new technical request.
    supabase
      .from("affairs")
      .select("id, name, client_id")
      .is("archived_at", null)
      .not("status", "in", "(lost,abandoned)")
      .order("created_at", { ascending: false }),
  ]);

  // ---- Pre-fill (m109) + edit mode (BUG-2) ----
  let initial: ProjectFormInitial | null = null;
  let editId: string | null = null;
  if (searchParams?.tender) {
    const { data: t } = await supabase
      .from("tenders")
      .select("*")
      .eq("id", searchParams.tender)
      .maybeSingle();
    if (t) {
      const specs: any = t.specs ?? {};
      const qty = Number(specs.quantite_totale ?? specs.quantity);
      const docs: any[] = Array.isArray(t.documents) ? t.documents : [];
      initial = {
        name: t.title ?? "",
        clientId: t.attached_client_id ?? "",
        affairId: t.converted_affair_id ?? "",
        country: t.country ?? "",
        quantity: Number.isFinite(qty) && qty > 0 ? String(Math.round(qty)) : "",
        opportunityValue:
          t.budget_usd != null ? String(t.budget_usd) : t.value != null ? String(t.value) : "",
        additionalNotes: [
          `Source: Tender Intelligence${t.platform ? ` (${t.platform})` : ""}`,
          t.reference ? `Tender reference: ${t.reference}` : null,
          t.buyer ? `Buyer: ${t.buyer}` : null,
          t.publication_date ? `Published: ${t.publication_date}` : null,
          t.deadline ? `Closing: ${t.deadline}` : null,
          t.source_url ? `Source URL: ${t.source_url}` : null,
          specs.descriptif ? `Description: ${specs.descriptif}` : null,
          docs.length > 0
            ? "Documents:\n" +
              docs
                .map((d: any) => `- [${d.type ?? "DOC"}] ${d.name ?? "Document"}${d.url ? ` — ${d.url}` : ""}`)
                .join("\n")
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
        sourceTenderId: t.id,
        sourceLabel: `Tender — ${t.buyer ?? t.platform ?? "Tender Intelligence"}${t.deadline ? ` · closing ${t.deadline}` : ""}`,
      };
    }
  } else if (searchParams?.affair) {
    const { data: a } = await supabase
      .from("affairs")
      .select("id, name, client_id, source_tender_id, clients:client_id(country)")
      .eq("id", searchParams.affair)
      .maybeSingle();
    if (a) {
      initial = {
        name: a.name ?? "",
        clientId: a.client_id ?? "",
        affairId: a.id,
        country: (a as any).clients?.country ?? "",
        quantity: "",
        opportunityValue: "",
        additionalNotes: `Source: Opportunity "${a.name}"`,
        sourceTenderId: (a as any).source_tender_id ?? null,
        sourceLabel: `Opportunity — ${a.name}`,
      };
    }
  } else if (searchParams?.client) {
    // CRM refactor (2026-06-17): opened from a Client Workspace — the client
    // is fixed (locked) so the salesperson never re-picks it. The affaire is
    // created automatically on submit (m124 + Workflow B) unless an existing
    // one is chosen.
    const { data: c } = await supabase
      .from("clients")
      .select("id, country")
      .eq("id", searchParams.client)
      .maybeSingle();
    if (c) {
      initial = {
        name: "",
        clientId: c.id,
        affairId: "",
        country: c.country ?? "",
        quantity: "",
        opportunityValue: "",
        additionalNotes: "",
        sourceTenderId: null,
        sourceLabel: "",
      };
    }
  } else if (searchParams?.edit) {
    // BUG-2 — edit an existing DRAFT request: full prefill of every field so
    // Sales can revise the specs after a Director "Request info" bounce.
    const { data: prow } = await supabase
      .from("project_requests")
      .select("*")
      .eq("id", searchParams.edit)
      .maybeSingle();
    const pr = prow as any;
    if (pr && pr.status === "draft") {
      editId = pr.id;
      let affairName: string | null = null;
      if (pr.affair_id) {
        const { data: aff } = await supabase
          .from("affairs")
          .select("name")
          .eq("id", pr.affair_id)
          .maybeSingle();
        affairName = (aff as any)?.name ?? null;
      }
      initial = {
        name: pr.name ?? "",
        clientId: pr.client_id ?? "",
        affairId: pr.affair_id ?? "",
        country: pr.country ?? "",
        quantity: pr.quantity != null ? String(pr.quantity) : "",
        opportunityValue: pr.opportunity_value != null ? String(pr.opportunity_value) : "",
        additionalNotes: pr.additional_notes ?? "",
        sourceTenderId: pr.source_tender_id ?? null,
        sourceLabel: "",
        productCategoryId: pr.product_category_id ?? "",
        reqProduct: pr.req_product_pricing ?? true,
        reqPacking: pr.req_packing_list ?? false,
        reqFreight: pr.req_freight ?? false,
        ledPower: pr.led_power ?? "",
        solarPanelSize: pr.solar_panel_size ?? "",
        batterySpec: pr.battery_spec ?? "",
        controller: pr.controller ?? "",
        iotRequired: pr.iot_required ?? false,
        poleRequired: pr.pole_required ?? false,
        poleQuantity: pr.pole_quantity != null ? String(pr.pole_quantity) : "",
        poleHeight: pr.pole_height ?? "",
        armLength: pr.arm_length ?? "",
        poleNotes: pr.pole_notes ?? "",
        transportMode: pr.freight_transport_mode ?? "",
        freightDestination: pr.freight_destination ?? "",
        freightNotes: pr.freight_notes ?? "",
        affairName,
      };
    }
  }

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <Link href="/projects" className="sx-backlink">
          ← Service requests
        </Link>
        <div className="sx-head" style={{ marginTop: 16 }}>
          <div>
            <div className="sx-eyebrow">{editId ? "Edit request" : "New request"}</div>
            <h1 className="sx-h1" style={{ fontSize: 26 }}>
              {editId ? "Edit service request" : "New service request"}
            </h1>
            <p className="sx-sub">
              {editId
                ? "Revise the request below, then re-submit it for the Sales Director's review."
                : "Capture the essentials — you can attach tender documents, specs and drawings on the next screen, then submit for the Sales Director's approval. Saved as a draft."}
            </p>
          </div>
        </div>
        {initial?.sourceLabel && (
          <div
            className="note-amber"
            style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}
          >
            <b>Pre-filled from: {initial.sourceLabel}</b>
            <span style={{ fontSize: 12 }}>
              Review and complete the fields below — nothing has been submitted yet.
            </span>
          </div>
        )}
        <NewProjectForm
          clients={((clients ?? []) as any[]).map((c) => ({
            id: c.id,
            name: c.company_name,
            country: c.country ?? null,
          }))}
          categories={((categories ?? []) as any[]).map((c) => ({ id: c.id, name: c.name }))}
          affairs={((affairs ?? []) as any[]).map((a) => ({
            id: a.id,
            name: a.name,
            clientId: a.client_id ?? null,
          }))}
          initial={initial}
          lockClient={!!searchParams?.client}
          editId={editId}
        />
      </div>
    </div>
  );
}
