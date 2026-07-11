import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import {
  versionedHistory,
  TRANSPORT_STATUS_LABEL,
  transportKindLabel,
  type TransportRequestStatus,
} from "@/lib/transport-request";

export const dynamic = "force-dynamic";

/**
 * TRANSPORT QUOTATIONS — the Sales read surface of the Transport Request
 * module (owner UX round 2, 2026-07-10). Every transport price ever quoted,
 * one row per version (Client · Project · V · Date · Price · Validity ·
 * Incoterm · Status), plus the open requests. Updating starts HERE: pick a
 * quotation → "Update Transport Price" → the wizard opens pre-loaded and a
 * NEW version is created — the history is never overwritten.
 */
export default async function TransportQuotationsPage() {
  const canRequest = await hasUiCapability("shipping.request_update");
  if (!canRequest) return <AccessDenied capability="shipping.request_update" />;

  const supabase = createClient();
  const { data, error } = await supabase
    .from("transport_requests")
    .select(
      "id, kind, status, affair_id, freight_cost, cbm, incoterm, destination_country, destination_port, valid_until, requested_at, completed_at, reason, clients:client_id(company_name), affairs:affair_id(name)"
    )
    .order("requested_at", { ascending: false })
    .limit(500);

  if (error) {
    return (
      <div className="solux-pro sx-page">
        <div className="sx-wrap">
          <h1 className="sx-h1">Transport Quotations</h1>
          <p className="sx-sub">
            This page needs migration <b>161_transport_requests.sql</b> (not
            applied yet): {error.message}
          </p>
        </div>
      </div>
    );
  }

  const rows = (data ?? []) as any[];

  // Group by affair → number the completed price versions per project.
  const byAffair = new Map<string, any[]>();
  for (const r of rows) {
    const arr = byAffair.get(r.affair_id) ?? [];
    arr.push(r);
    byAffair.set(r.affair_id, arr);
  }
  type Row = {
    affairId: string;
    client: string;
    project: string;
    version: number | null;
    kindLabel: string;
    date: string | null;
    price: number | null;
    validUntil: string | null;
    incoterm: string | null;
    destination: string | null;
    status: string;
    isCurrent: boolean;
    reason: string | null;
  };
  const tableRows: Row[] = [];
  for (const [affairId, list] of byAffair) {
    const versions = versionedHistory(list);
    const currentId = versions[versions.length - 1]?.id;
    for (const r of list) {
      const v = versions.find((x) => x.id === r.id);
      const open = r.status === "waiting" || r.status === "in_progress";
      // The table shows QUOTATIONS (versions) + whatever is open now;
      // cancelled noise and completed packing-only rows stay out.
      if (!v && !open) continue;
      tableRows.push({
        affairId,
        client: r.clients?.company_name ?? "—",
        project: r.affairs?.name ?? "—",
        version: v?.version ?? null,
        kindLabel: transportKindLabel(r.kind),
        date: r.completed_at ?? r.requested_at,
        price: r.freight_cost,
        validUntil: r.valid_until,
        incoterm: r.incoterm,
        destination: r.destination_port || r.destination_country || null,
        status: r.status,
        isCurrent: r.id === currentId,
        reason: r.reason,
      });
    }
  }
  tableRows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const fmtD = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "—";

  const statusChip = (s: string) => {
    const tone =
      s === "completed"
        ? "bg-emerald-100 text-emerald-800"
        : s === "cancelled"
        ? "bg-neutral-100 text-neutral-500"
        : s === "in_progress"
        ? "bg-sky-100 text-sky-900"
        : "bg-amber-100 text-amber-900";
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
      >
        {TRANSPORT_STATUS_LABEL[s as TransportRequestStatus] ?? s}
      </span>
    );
  };

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <div className="sx-head">
          <div>
            <div className="sx-eyebrow">⚡ Requests</div>
            <h1 className="sx-h1">Transport Quotations</h1>
            <p className="sx-sub">
              Every transport price is a version — the history is never
              overwritten. To refresh a price, pick the quotation and click
              “Update Transport Price”: the wizard opens pre-loaded and a new
              version is created.
            </p>
          </div>
          <Link href="/transport/new" className="btn-primary shrink-0">
            📦 New Transport Request
          </Link>
        </div>

        {tableRows.length === 0 ? (
          <p className="mt-6 text-sm text-neutral-400">
            No transport quotations yet — start with{" "}
            <Link href="/transport/new" className="underline">
              a New Transport Request
            </Link>
            .
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-neutral-200 text-[10.5px] uppercase tracking-wide text-neutral-500">
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Version</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Validity</th>
                  <th className="px-3 py-2">Incoterm</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {tableRows.map((r, i) => (
                  <tr key={i} className="hover:bg-neutral-50/60">
                    <td className="px-3 py-2 font-medium text-neutral-800">
                      {r.client}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/affairs/${r.affairId}`}
                        className="text-neutral-700 hover:underline"
                      >
                        {r.project}
                      </Link>
                      {r.destination && (
                        <span className="ml-1.5 text-[11px] text-neutral-400">
                          → {r.destination}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.version ? (
                        <span className="inline-flex h-5 min-w-[2rem] items-center justify-center rounded bg-neutral-100 px-1.5 text-[10px] font-semibold text-neutral-700">
                          V{r.version}
                        </span>
                      ) : (
                        <span className="text-[11px] text-neutral-400">
                          {r.kindLabel}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-neutral-600">
                      {fmtD(r.date)}
                    </td>
                    <td className="px-3 py-2 font-semibold text-neutral-900">
                      {r.price != null
                        ? `${Number(r.price).toLocaleString()} USD`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-neutral-600">
                      {fmtD(r.validUntil)}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">
                      {r.incoterm ?? "—"}
                    </td>
                    <td className="px-3 py-2">{statusChip(r.status)}</td>
                    <td className="px-3 py-2 text-right">
                      {r.isCurrent && r.status === "completed" && (
                        <Link
                          href={`/transport/new?affair=${r.affairId}&kind=price_update`}
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-neutral-800 hover:bg-neutral-50"
                        >
                          ↻ Update Transport Price
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
