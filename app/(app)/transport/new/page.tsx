import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import { resolveUserLabelStrings } from "@/lib/user-display";
import { isTransportTablesMissing } from "@/lib/transport-request";
import TransportRequestForm from "./TransportRequestForm";

/**
 * TRANSPORT REQUEST MODULE (m161, owner 2026-07-10) — the dedicated workflow
 * behind "⚡ Requests → New Transport Request". One place for every logistics
 * request, always Client → Affair:
 *   📦 packing list   🚢 transport price   🔄 transport price update
 * Product lines capture the EXACT shipped configuration (solar panel size
 * above all — it drives cartons/pallets/CBM); completed price requests are
 * the affair's versioned transport price history. Operations answer from
 * /operations/transport-requests.
 *
 * DORMANT-SAFE: until the owner applies m161 this page renders a clear
 * migration note instead of the form (probe below) — nothing else breaks.
 */
export default async function NewTransportRequestPage({
  searchParams,
}: {
  searchParams?: {
    affair?: string;
    client?: string;
    kind?: string;
    /** Deep-link from a document page ("Request Transport"): auto-import
     *  this quotation/proforma's products on load — zero re-typing. */
    source?: string;
  };
}) {
  const canRequest = await hasUiCapability("shipping.request_update");
  if (!canRequest) return <AccessDenied capability="shipping.request_update" />;

  const supabase = createClient();

  // Dormant probe — the form must never be fillable when doomed (m161 not
  // applied): the submit would 42P01 after the user typed everything.
  const probe = await supabase.from("transport_requests").select("id").limit(1);
  if (probe.error && isTransportTablesMissing(probe.error)) {
    return (
      <div className="solux-pro sx-page">
        <div className="sx-wrap">
          <Link href="/dashboard" className="sx-backlink">
            ← Dashboard
          </Link>
          <h1 className="sx-h1" style={{ marginTop: 16 }}>
            Transport Requests
          </h1>
          <p className="sx-sub">
            This module needs migration <b>161_transport_requests.sql</b> (not
            applied yet). Apply it in the Supabase SQL editor, then reload —
            nothing else is affected meanwhile.
          </p>
        </div>
      </div>
    );
  }

  const [
    { data: clients },
    { data: affairs },
    { data: products },
    { data: categories },
    { data: configFields },
    { data: configFieldOptions },
  ] = await Promise.all([
    supabase.from("clients").select("id, company_name").order("company_name"),
    // Live affairs only — closed/archived deals can't receive new requests
    // (same filter as the quotation builder / SR wizard).
    supabase
      .from("affairs")
      .select("id, name, client_id")
      .is("archived_at", null)
      .not("status", "in", "(lost,abandoned)")
      .order("created_at", { ascending: false }),
    supabase
      .from("products")
      .select("id, name, sku, category, category_id, image_url")
      .eq("active", true)
      .order("name"),
    supabase
      .from("product_categories")
      .select("id, name")
      .eq("is_template", false)
      .order("position")
      .order("name"),
    // The same field set quotations were configured under — imported
    // config_values keys line up 1:1.
    supabase
      .from("config_fields")
      .select(
        "id, category_id, field_name, field_type, required, default_value, placeholder, field_order, allow_custom_value, active"
      )
      .eq("active", true)
      .eq("visible_in_quotation", true)
      .order("field_order"),
    supabase
      .from("config_field_options")
      .select("id, field_id, option_value, option_order")
      .order("option_order"),
  ]);

  // ---- Context (?affair= / ?client=) — RequestHub deep-links ----
  const affairParam = searchParams?.affair || null;
  const clientParam = searchParams?.client || null;
  let ctxAffair: { id: string; name: string | null; client_id: string | null } | null =
    null;
  if (affairParam) {
    const { data } = await supabase
      .from("affairs")
      .select("id, name, client_id")
      .eq("id", affairParam)
      .maybeSingle();
    ctxAffair = (data as any) ?? null;
  }

  // ---- Affair-scoped data for the standard (deep-linked) path ----
  // Quotations to import products from + the transport history (the update
  // flow's "current quotation" card + V1..Vn list). When the user changes
  // the affair manually (rare — naked menu entry), the form refetches these
  // client-side (without resolved names).
  let initialQuotations: any[] = [];
  let initialHistory: any[] = [];
  let userLabels: Record<string, string> = {};
  if (ctxAffair) {
    const [qRes, hRes] = await Promise.all([
      supabase
        .from("documents")
        .select("id, number, version, date, type, status")
        .eq("affair_id", ctxAffair.id)
        .in("type", ["quotation", "proforma"])
        .order("date", { ascending: false }),
      supabase
        .from("transport_requests")
        .select(
          "id, kind, status, freight_cost, insurance_cost, cbm, incoterm, transport_mode, destination_country, destination_port, valid_until, ops_comments, reason, requested_by, requested_at, completed_by, completed_at, gross_weight_kg, net_weight_kg, cartons_count, pallets_count, containers"
        )
        .eq("affair_id", ctxAffair.id)
        .order("requested_at", { ascending: false }),
    ]);
    initialQuotations = (qRes.data ?? []) as any[];
    initialHistory = hRes.error ? [] : ((hRes.data ?? []) as any[]);
    const ids = new Set<string>();
    for (const h of initialHistory) {
      if (h.requested_by) ids.add(h.requested_by);
      if (h.completed_by) ids.add(h.completed_by);
    }
    if (ids.size > 0) {
      try {
        userLabels = Object.fromEntries(await resolveUserLabelStrings([...ids]));
      } catch {
        userLabels = {};
      }
    }
  }

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <Link
          href={ctxAffair ? `/affairs/${ctxAffair.id}` : "/dashboard"}
          className="sx-backlink"
        >
          ← {ctxAffair ? "Back to project" : "Dashboard"}
        </Link>
        <div className="sx-head" style={{ marginTop: 16 }}>
          <div>
            <div className="sx-eyebrow">⚡ Requests</div>
            <h1 className="sx-h1" style={{ fontSize: 26 }}>
              New Transport Request
            </h1>
            <p className="sx-sub">
              Packing list, freight quotation or price update — always linked
              to a client and a project. Operations answer from their Transport
              Requests queue; every completed price becomes a version of the
              project&apos;s transport history.
            </p>
          </div>
        </div>

        <TransportRequestForm
          clients={(clients ?? []) as any[]}
          affairs={(affairs ?? []) as any[]}
          products={(products ?? []) as any[]}
          categories={(categories ?? []) as any[]}
          configFields={(configFields ?? []) as any[]}
          configFieldOptions={(configFieldOptions ?? []) as any[]}
          ctxAffair={ctxAffair}
          ctxClientId={clientParam}
          initialKind={searchParams?.kind ?? null}
          sourceParam={searchParams?.source ?? null}
          initialQuotations={initialQuotations}
          initialHistory={initialHistory}
          userLabels={userLabels}
        />
      </div>
    </div>
  );
}
