"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  SHIPPING_UPDATE_STATUS_LABEL,
  shippingDelta,
  formatDelta,
  type FreshnessThresholds,
  type ShippingSnapshot,
  type ShippingUpdateStatus,
} from "@/lib/shipping-update";
import type { ShippingStatusLite } from "@/lib/shipping-status-server";
import { pushToast } from "@/components/feedback/toast-store";
import { cancelShippingUpdate } from "@/app/(app)/operations/shipping-updates/actions";
import { ShippingFreshnessBadge } from "@/components/shipping/ShippingFreshnessBadge";
import { RequestShippingUpdateButton } from "@/components/shipping/RequestShippingUpdateButton";

/** Detailed completed/open row (with costs) — for the banner + history list. */
export type ShippingUpdateLite = {
  id: string;
  status: ShippingUpdateStatus;
  priority: string;
  reason: string | null;
  requested_at: string | null;
  completed_at: string | null;
  previous_freight_cost: number | null;
  previous_insurance_cost: number | null;
  new_freight_cost: number | null;
  new_insurance_cost: number | null;
  mine: boolean;
};

function d(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * The permanent, reusable "Shipping Status" component (m149 Lot 2). Shown
 * everywhere a commercial document lives — it gives the salesperson context
 * BEFORE clicking: how old the freight quote is (traffic-light), the current
 * freight, destination, incoterm, and when it was last / previously updated.
 * Then the one action that protects margin: Request Shipping Update.
 *
 * Available across the WHOLE lifecycle (draft → won → production → invoice) —
 * it is never gated by document status, only by the capability. Winning a
 * deal doesn't freeze freight: prices keep moving while production runs.
 */
export function ShippingStatusCard({
  documentId,
  canRequest,
  status,
  thresholds,
  prefill,
  openRequest = null,
  history = [],
}: {
  documentId: string;
  canRequest: boolean;
  status: ShippingStatusLite;
  thresholds: FreshnessThresholds;
  prefill: ShippingSnapshot;
  openRequest?: ShippingUpdateLite | null;
  history?: ShippingUpdateLite[];
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Freshness works even pre-m149 (derived from the quote date); only the
  // request button + history depend on the table (`status.available`).
  const withdraw = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      try {
        await cancelShippingUpdate(fd);
        pushToast("Request withdrawn");
        router.refresh();
      } catch (e: any) {
        pushToast(e?.message ?? "Cancel failed", "error");
      }
    });
  };

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between gap-4">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="eyebrow">Shipping status</div>
        <ShippingFreshnessBadge ageDays={status.ageDays} thresholds={thresholds} />
      </div>

      <dl className="mt-2 space-y-1 text-sm">
        <Row
          label="Last freight update"
          value={
            status.lastUpdateDate
              ? `${d(status.lastUpdateDate)}${
                  status.ageDays == null ? "" : ` · ${status.ageDays} day${status.ageDays === 1 ? "" : "s"} ago`
                }`
              : "—"
          }
        />
        <Row
          label="Current freight"
          value={<span className="tabular-nums font-medium">{status.currentFreight.toFixed(2)}</span>}
        />
        {status.currentInsurance != null && status.currentInsurance > 0 && (
          <Row
            label="Insurance"
            value={<span className="tabular-nums">{Number(status.currentInsurance).toFixed(2)}</span>}
          />
        )}
        <Row label="Destination" value={status.destination ?? "—"} />
        <Row label="Incoterm" value={status.incoterm ?? "—"} />
        {status.previousUpdateDate && (
          <Row label="Previous update" value={d(status.previousUpdateDate)} />
        )}
      </dl>

      {/* Action — or the "already requested" banner. */}
      <div className="mt-3">
        {openRequest ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span>
              ⏳ {SHIPPING_UPDATE_STATUS_LABEL[openRequest.status]} — requested{" "}
              {d(openRequest.requested_at)}
              {openRequest.reason ? ` · ${openRequest.reason}` : ""} · waiting on Operations
            </span>
            {openRequest.mine && openRequest.status === "waiting" && (
              <button
                type="button"
                className="font-medium underline hover:no-underline disabled:opacity-50"
                disabled={pending}
                onClick={() => withdraw(openRequest.id)}
              >
                Withdraw
              </button>
            )}
          </div>
        ) : (
          <RequestShippingUpdateButton
            documentId={documentId}
            canRequest={canRequest}
            available={status.available}
            prefill={prefill}
            previousCost={status.currentFreight}
            previousDate={status.lastUpdateDate}
            hasOpenRequest={false}
            variant="secondary"
          />
        )}
        {!status.available && (
          <p className="mt-1 text-[11px] text-neutral-400">
            Freight refresh requests activate once migration 149 is applied.
          </p>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-3 border-t border-neutral-200 pt-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Shipping history
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-neutral-700">
            {history.map((h) => {
              const delta = shippingDelta(h);
              return (
                <li key={h.id} className="flex justify-between gap-3">
                  <span>{d(h.completed_at)} — Freight</span>
                  <span className="tabular-nums">
                    {h.previous_freight_cost == null
                      ? "—"
                      : Number(h.previous_freight_cost).toFixed(2)}{" "}
                    → {h.new_freight_cost == null ? "—" : Number(h.new_freight_cost).toFixed(2)}
                    {delta.freight != null && (
                      <b className={delta.freight > 0 ? "text-rose-700" : "text-emerald-700"}>
                        {" "}
                        ({formatDelta(delta.freight)})
                      </b>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
