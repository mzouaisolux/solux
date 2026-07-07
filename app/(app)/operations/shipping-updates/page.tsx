import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { canAccessOrAdmin } from "@/lib/permissions";
import { resolveUserLabelStrings } from "@/lib/user-display";
import AccessDenied from "@/components/AccessDenied";
import {
  ShippingUpdatesQueue,
  type QueueItem,
} from "./ShippingUpdatesQueue";

export const dynamic = "force-dynamic";

/**
 * SHIPPING UPDATES — the Operations queue of the Shipping Rate Refresh
 * loop (m149). Sales ask for a freight refresh from a document; each row
 * here carries the editable shipping summary they confirmed, the previous
 * cost/date, and a completion form (per-container new prices or a flat
 * freight + insurance + additional charges). Completing pushes the new
 * costs onto the document and the row becomes the document's history.
 */
export default async function ShippingUpdatesPage({
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
    .from("shipping_update_requests")
    .select(
      "id, document_id, status, priority, reason, snapshot, previous_freight_cost, previous_insurance_cost, previous_quote_date, new_freight_cost, new_insurance_cost, ops_notes, requested_by, requested_at, completed_at, clients:client_id(company_name), affairs:affair_id(name), documents:document_id(number, type, freight_cost, insurance_cost, additional_charges, date)"
    )
    .order("requested_at", { ascending: false })
    .limit(500);
  if (scope === "open") q = q.in("status", ["waiting", "in_progress"]);
  else if (scope === "done") q = q.in("status", ["completed", "cancelled"]);
  const { data, error } = await q;

  // Pre-m149: the table doesn't exist yet — say so instead of a blank page.
  if (error) {
    return (
      <div className="solux-pro sx-page">
        <div className="sx-wrap">
          <h1 className="sx-h1">Shipping Updates</h1>
          <p className="sx-sub">
            This queue needs migration <b>149_shipping_update_requests.sql</b>{" "}
            (not applied yet): {error.message}
          </p>
        </div>
      </div>
    );
  }
  const rows = (data ?? []) as any[];

  // Containers of the open documents — the completion form edits per-row
  // unit prices so the document breakdown stays coherent. One query.
  const openDocIds = Array.from(
    new Set(
      rows
        .filter((r) => r.status === "waiting" || r.status === "in_progress")
        .map((r) => r.document_id)
    )
  );
  const containersByDoc = new Map<string, any[]>();
  if (openDocIds.length) {
    const { data: cRows } = await supabase
      .from("document_containers")
      .select("id, document_id, container_type, quantity, unit_price, wooden_box_cost")
      .in("document_id", openDocIds);
    for (const c of cRows ?? []) {
      const list = containersByDoc.get(c.document_id) ?? [];
      list.push(c);
      containersByDoc.set(c.document_id, list);
    }
  }

  const requesterIds = Array.from(
    new Set(rows.map((r) => r.requested_by).filter(Boolean))
  ) as string[];
  const labels = await resolveUserLabelStrings(requesterIds);

  const items: QueueItem[] = rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    documentNumber: r.documents?.number ?? "—",
    documentType: r.documents?.type ?? "quotation",
    status: r.status,
    priority: r.priority,
    reason: r.reason,
    snapshot: r.snapshot ?? {},
    previousFreight: r.previous_freight_cost,
    previousInsurance: r.previous_insurance_cost,
    previousQuoteDate: r.previous_quote_date ?? r.documents?.date ?? null,
    newFreight: r.new_freight_cost,
    newInsurance: r.new_insurance_cost,
    opsNotes: r.ops_notes,
    customer: r.clients?.company_name ?? "—",
    project: r.affairs?.name ?? "—",
    requestedBy: r.requested_by ? labels.get(r.requested_by) ?? "—" : "—",
    requestedAt: r.requested_at,
    completedAt: r.completed_at,
    currentInsurance: r.documents?.insurance_cost ?? null,
    currentCharges: Array.isArray(r.documents?.additional_charges)
      ? r.documents.additional_charges
      : [],
    containers: (containersByDoc.get(r.document_id) ?? []).map((c) => ({
      id: c.id,
      container_type: c.container_type,
      quantity: Number(c.quantity) || 0,
      unit_price: Number(c.unit_price) || 0,
      wooden_box_cost: Number(c.wooden_box_cost) || 0,
    })),
  }));

  const openCount = items.filter(
    (i) => i.status === "waiting" || i.status === "in_progress"
  ).length;

  const tab = (key: string, label: string) => (
    <Link
      key={key}
      href={key === "open" ? "/operations/shipping-updates" : `/operations/shipping-updates?scope=${key}`}
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
            <h1 className="sx-h1">Shipping Updates</h1>
            <p className="sx-sub">
              Freight refresh requests from Sales. Enter the new transport
              costs — completing a request updates the document and notifies
              the requester.
            </p>
          </div>
        </div>
        <div className="sx-stabs">
          {tab("open", "Open")}
          {tab("done", "Completed / Cancelled")}
          {tab("all", "All")}
        </div>
        <ShippingUpdatesQueue items={items} />
      </div>
    </div>
  );
}
