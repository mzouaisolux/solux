import Link from "next/link";
import {
  TRANSPORT_STATUS_LABEL,
  transportKindLabel,
  versionedHistory,
  type TransportRequestStatus,
} from "@/lib/transport-request";

/**
 * Transport quotes — the affair's read surface for the Transport Request
 * module (m161): the versioned price history (V1..Vn, never overwritten)
 * plus packing-list results and any open request. Server component; the
 * caller loads rows dormant-safely and hides the card pre-m161 / when empty.
 */
export type TransportQuoteRow = {
  id: string;
  kind: string;
  status: TransportRequestStatus | string;
  freight_cost: number | null;
  insurance_cost: number | null;
  cbm: number | null;
  gross_weight_kg: number | null;
  cartons_count: number | null;
  pallets_count: number | null;
  incoterm: string | null;
  destination_country: string | null;
  destination_port: string | null;
  valid_until: string | null;
  ops_comments: string | null;
  requested_at: string | null;
  requested_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function TransportQuotesCard({
  rows,
  affairId,
  userLabels = {},
  canRequest = false,
}: {
  rows: TransportQuoteRow[];
  affairId: string;
  userLabels?: Record<string, string>;
  /** hasUiCapability("shipping.request_update") — shows the CTAs. */
  canRequest?: boolean;
}) {
  // Owner §7 (2026-07-10): the Logistics / Transport section lives on EVERY
  // project page — when nothing exists yet it invites the first request
  // instead of hiding (context-aware hub, no Mega-Menu round-trips).
  if (rows.length === 0) {
    if (!canRequest) return null;
    return (
      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="eyebrow mb-1">Transport &amp; logistics</div>
            <p className="text-[11px] text-neutral-500">
              No transport request yet — packing lists and freight quotations
              for this project will appear here.
            </p>
          </div>
          <Link
            href={`/transport/new?affair=${affairId}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-black"
          >
            ➕ New Transport Request
          </Link>
        </div>
      </section>
    );
  }

  const versions = versionedHistory(rows);
  const versionById = new Map(versions.map((v) => [v.id, v.version]));
  const current = versions[versions.length - 1] ?? null;
  const open = rows.filter(
    (r) => r.status === "waiting" || r.status === "in_progress"
  );
  const packing = rows.filter(
    (r) => r.kind === "packing_list" && r.status === "completed"
  );

  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="eyebrow mb-1">Transport quotes</div>
          <p className="text-[11px] text-neutral-500">
            Every transport price is a version — the history is never
            overwritten.{" "}
            <Link href="/transport" className="underline decoration-dotted">
              All quotations →
            </Link>
          </p>
        </div>
        {canRequest && (
          <div className="flex shrink-0 items-center gap-2">
            {open.length > 0 ? (
              <Link
                href="/transport"
                className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-800 hover:bg-neutral-50"
              >
                Open Transport Request →
              </Link>
            ) : (
              <>
                {current && (
                  <Link
                    href={`/transport/new?affair=${affairId}&kind=price_update`}
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-800 hover:bg-neutral-50"
                  >
                    ↻ Update Transport Price
                  </Link>
                )}
                <Link
                  href={`/transport/new?affair=${affairId}`}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[11.5px] font-medium text-neutral-600 hover:bg-neutral-50"
                  title="Create another transport request for this project"
                >
                  ➕ New
                </Link>
              </>
            )}
          </div>
        )}
      </div>

      {open.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-[11.5px] text-amber-900">
          {open
            .map(
              (o) =>
                `${transportKindLabel(o.kind)} — ${
                  TRANSPORT_STATUS_LABEL[o.status as TransportRequestStatus] ?? o.status
                } (requested ${fmtDate(o.requested_at)})`
            )
            .join(" · ")}
        </div>
      )}

      {versions.length > 0 && (
        <ul className="mt-2 divide-y divide-neutral-100">
          {[...versions].reverse().map((v) => (
            <li key={v.id} className="py-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="inline-flex h-5 min-w-[2rem] items-center justify-center rounded bg-neutral-100 px-1.5 text-[10px] font-semibold text-neutral-700">
                  V{versionById.get(v.id)}
                </span>
                <span className="text-[13px] font-semibold text-neutral-900">
                  {v.freight_cost != null
                    ? `${Number(v.freight_cost).toLocaleString()} USD`
                    : "—"}
                </span>
                <span className="text-[11.5px] text-neutral-600">
                  {v.incoterm ?? "—"}{" "}
                  {v.destination_port || v.destination_country || ""}
                </span>
                {v.cbm != null && (
                  <span className="text-[11px] text-neutral-500">CBM {v.cbm}</span>
                )}
                {v.valid_until && (
                  <span className="text-[11px] text-neutral-500">
                    valid until {fmtDate(v.valid_until)}
                  </span>
                )}
                <span className="ml-auto text-[11px] tabular-nums text-neutral-400">
                  {v.requested_by && userLabels[v.requested_by]
                    ? `req. ${userLabels[v.requested_by]} · `
                    : ""}
                  {fmtDate(v.completed_at)}
                  {v.completed_by && userLabels[v.completed_by]
                    ? ` · ${userLabels[v.completed_by]}`
                    : ""}
                </span>
              </div>
              {v.ops_comments && (
                <p className="mt-0.5 pl-10 text-[11px] text-neutral-500">
                  {v.ops_comments}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {packing.length > 0 && (
        <div className="mt-2 text-[11.5px] text-neutral-600">
          <span className="font-semibold uppercase tracking-wide text-[10px] text-neutral-500">
            Packing —{" "}
          </span>
          {packing
            .map((p) =>
              [
                p.cbm != null ? `${p.cbm} CBM` : null,
                p.gross_weight_kg != null ? `GW ${p.gross_weight_kg} kg` : null,
                p.cartons_count != null ? `${p.cartons_count} cartons` : null,
                p.pallets_count != null ? `${p.pallets_count} pallets` : null,
                `(${fmtDate(p.completed_at)})`,
              ]
                .filter(Boolean)
                .join(" · ")
            )
            .join("  |  ")}
        </div>
      )}
    </section>
  );
}
