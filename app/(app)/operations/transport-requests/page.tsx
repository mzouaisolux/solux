import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { canAccessOrAdmin } from "@/lib/permissions";
import { resolveUserLabelStrings } from "@/lib/user-display";
import AccessDenied from "@/components/AccessDenied";
import {
  TransportRequestsQueue,
  type TransportQueueItem,
} from "./TransportRequestsQueue";

export const dynamic = "force-dynamic";

/**
 * TRANSPORT REQUESTS — the Operations queue of the Transport Request module
 * (m161). Sales submit packing-list / freight-price / price-update requests
 * from an affair (with the exact product configuration — solar panel size
 * above all); Operations answer here. Completing a price request makes it a
 * VERSION of the affair's transport price history (never overwritten).
 */
export default async function TransportRequestsPage({
  searchParams,
}: {
  searchParams?: { scope?: string };
}) {
  const allowed = await canAccessOrAdmin(["shipping.process_update"]);
  if (!allowed) return <AccessDenied capability="shipping.process_update" />;

  const scope =
    searchParams?.scope === "done" || searchParams?.scope === "all"
      ? searchParams.scope
      : "open";

  const supabase = createClient();
  let q = supabase
    .from("transport_requests")
    .select(
      "id, kind, status, priority, reason, destination_country, destination_port, port_of_loading, delivery_address, incoterm, transport_mode, notes, freight_cost, insurance_cost, additional_charges, transit_time_days, gross_weight_kg, net_weight_kg, cbm, cartons_count, pallets_count, containers, valid_until, ops_comments, requested_by, requested_at, completed_at, affair_id, clients:client_id(company_name), affairs:affair_id(name), source_doc:documents!source_document_id(number)"
    )
    .order("requested_at", { ascending: false })
    .limit(500);
  if (scope === "open") q = q.in("status", ["waiting", "in_progress"]);
  else if (scope === "done") q = q.in("status", ["completed", "cancelled"]);
  const { data, error } = await q;

  // Pre-m161: the table doesn't exist yet — say so instead of a blank page.
  if (error) {
    return (
      <div className="solux-pro sx-page">
        <div className="sx-wrap">
          <h1 className="sx-h1">Transport Requests</h1>
          <p className="sx-sub">
            This queue needs migration <b>161_transport_requests.sql</b> (not
            applied yet): {error.message}
          </p>
        </div>
      </div>
    );
  }
  const rows = (data ?? []) as any[];

  // Product lines of the listed requests — one query, grouped.
  const ids = rows.map((r) => r.id);
  const linesByRequest = new Map<string, any[]>();
  if (ids.length) {
    const { data: lineRows } = await supabase
      .from("transport_request_lines")
      .select(
        "transport_request_id, product_name, client_product_name, quantity, config_values, position"
      )
      .in("transport_request_id", ids)
      .order("position");
    for (const l of lineRows ?? []) {
      const list = linesByRequest.get(l.transport_request_id) ?? [];
      list.push(l);
      linesByRequest.set(l.transport_request_id, list);
    }
  }

  const requesterIds = Array.from(
    new Set(rows.map((r) => r.requested_by).filter(Boolean))
  ) as string[];
  const labels = await resolveUserLabelStrings(requesterIds);

  const items: TransportQueueItem[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    priority: r.priority,
    reason: r.reason,
    customer: r.clients?.company_name ?? "—",
    project: r.affairs?.name ?? "—",
    affairId: r.affair_id,
    destinationCountry: r.destination_country,
    destinationPort: r.destination_port,
    portOfLoading: r.port_of_loading,
    deliveryAddress: r.delivery_address,
    incoterm: r.incoterm,
    transportMode: r.transport_mode,
    notes: r.notes,
    freightCost: r.freight_cost,
    insuranceCost: r.insurance_cost,
    transitTimeDays: r.transit_time_days,
    grossWeightKg: r.gross_weight_kg,
    netWeightKg: r.net_weight_kg,
    cbm: r.cbm,
    cartonsCount: r.cartons_count,
    palletsCount: r.pallets_count,
    containers: Array.isArray(r.containers) ? r.containers : [],
    validUntil: r.valid_until,
    opsComments: r.ops_comments,
    requestedBy: r.requested_by ? labels.get(r.requested_by) ?? "—" : "—",
    importedFrom: r.source_doc?.number ?? null,
    requestedAt: r.requested_at,
    completedAt: r.completed_at,
    lines: (linesByRequest.get(r.id) ?? []).map((l) => ({
      product_name: l.product_name,
      client_product_name: l.client_product_name,
      quantity: Number(l.quantity) || 0,
      config_values: l.config_values ?? {},
    })),
  }));

  const openCount = items.filter(
    (i) => i.status === "waiting" || i.status === "in_progress"
  ).length;

  const tab = (key: string, label: string) => (
    <Link
      key={key}
      href={
        key === "open"
          ? "/operations/transport-requests"
          : `/operations/transport-requests?scope=${key}`
      }
      className={`sx-stab ${scope === key ? "active" : ""}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <div className="sx-head">
          <div>
            <div className="sx-eyebrow">
              {openCount} request{openCount === 1 ? "" : "s"} waiting on Operations
            </div>
            <h1 className="sx-h1">Transport Requests</h1>
            <p className="sx-sub">
              Packing lists, freight quotations and price updates requested by
              Sales — with the exact product configuration. Completing a price
              request becomes a version of the project&apos;s transport history.
            </p>
          </div>
        </div>
        <div className="sx-stabs">
          {tab("open", "Open")}
          {tab("done", "Completed / Cancelled")}
          {tab("all", "All")}
        </div>
        <TransportRequestsQueue items={items} />
      </div>
    </div>
  );
}
