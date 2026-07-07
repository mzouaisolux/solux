"use client";

// =====================================================================
// Quotations — the PRIMARY section of the commercial deal workspace. Lists
// every version (V1, V2, V3 (Current), V4 (Draft)) with the fast actions a
// salesperson reaches for constantly: Open · Edit · Duplicate · Export PDF,
// plus an inline status switcher. Calm grayscale; status is the only color.
// =====================================================================

import Link from "next/link";
import { formatMoney, type AffairGroup } from "@/lib/affairs-prototype";
import type { DocStatus } from "@/lib/types";
import type { ShippingStatusLite } from "@/lib/shipping-status-server";
import { freshnessLevel, type ShippingSnapshot, type FreshnessThresholds } from "@/lib/shipping-update";
import { fmtDate } from "@/components/affairs/badges";
import InlineStatusSwitcher from "@/components/InlineStatusSwitcher";
import { DuplicateQuotationButton } from "@/components/affairs/DuplicateQuotationButton";
import { ShippingFreshnessBadge } from "@/components/shipping/ShippingFreshnessBadge";
import { RequestShippingUpdateButton } from "@/components/shipping/RequestShippingUpdateButton";

const ACT = "text-[11px] font-medium text-neutral-500 hover:text-neutral-900";

export function AffairQuotations({
  affair,
  affairId,
  clientName,
  shippingStatuses,
  canRequestShipping = false,
  freshnessThresholds,
}: {
  affair: AffairGroup;
  affairId: string;
  clientName?: string;
  shippingStatuses?: Record<string, ShippingStatusLite>;
  canRequestShipping?: boolean;
  freshnessThresholds?: FreshnessThresholds;
}) {
  const versions = [...affair.documents].sort(
    (a, b) => (b.version ?? 1) - (a.version ?? 1),
  );
  // "Current" = the highest-version quotation that isn't a draft.
  const currentId = versions.find((d) => d.status !== "draft")?.id ?? null;

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Quotations
          <span className="ml-1.5 font-normal text-neutral-400">{versions.length}</span>
        </h3>
        <Link
          href={`/documents/new?affair=${affairId}`}
          className="text-[11px] font-medium text-neutral-600 hover:text-neutral-900"
        >
          + New quotation
        </Link>
      </div>

      {versions.length === 0 ? (
        <p className="mt-2 text-[12px] text-neutral-400">
          No quotations yet — start one with + New quotation.
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-neutral-100 border-t border-neutral-100">
          {versions.map((d) => {
            const tag = d.status === "draft" ? "Draft" : d.id === currentId ? "Current" : null;
            const ship = shippingStatuses?.[d.id];
            const fresh = ship ? freshnessLevel(ship.ageDays, freshnessThresholds) : null;
            const shipTone =
              fresh?.level === "stale" ? "stale" : fresh?.level === "warn" ? "warn" : "neutral";
            const shipPrefill: ShippingSnapshot = {
              customer: clientName ?? "",
              project: affair.displayName ?? d.affair_name ?? "",
              destination_port: ship?.destination ?? "",
              port_of_loading: ship?.portOfLoading ?? "",
              incoterm: ship?.incoterm ?? "",
              shipping_method: "Sea freight",
            };
            return (
              <li key={d.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-neutral-900">
                      V{d.version ?? 1}
                    </span>
                    {tag && (
                      <span
                        className={`text-[10px] font-medium uppercase tracking-wide ${
                          tag === "Current" ? "text-emerald-700" : "text-neutral-400"
                        }`}
                      >
                        {tag}
                      </span>
                    )}
                    {d.type === "proforma" && (
                      <span className="text-[10px] font-semibold uppercase text-neutral-400">
                        PF
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-400">
                    <span>
                      {fmtDate(d.date)}
                      {d.total_price ? (
                        <>
                          {" · "}
                          <span className="font-semibold tabular-nums text-neutral-600">
                            {formatMoney(d.total_price, d.currency)}
                          </span>
                        </>
                      ) : null}
                    </span>
                    {ship && (
                      <ShippingFreshnessBadge
                        ageDays={ship.ageDays}
                        thresholds={freshnessThresholds}
                        compact
                      />
                    )}
                  </div>
                </div>

                <InlineStatusSwitcher docId={d.id} current={d.status as DocStatus} />

                <div className="flex shrink-0 items-center gap-2.5">
                  {d.status === "draft" ? (
                    <Link
                      href={`/documents/new?edit=${d.id}`}
                      className="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
                    >
                      Edit
                    </Link>
                  ) : (
                    <>
                      <Link href={`/documents/${d.id}`} className={ACT}>
                        Open
                      </Link>
                      <Link
                        href={`/documents/new?edit=${d.id}`}
                        className="rounded-md border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
                      >
                        Edit
                      </Link>
                    </>
                  )}
                  <DuplicateQuotationButton id={d.id} className={ACT} />
                  <a
                    href={`/api/documents/${d.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className={ACT}
                  >
                    Export PDF
                  </a>
                  {ship && (
                    <RequestShippingUpdateButton
                      documentId={d.id}
                      canRequest={canRequestShipping}
                      available={ship.available}
                      prefill={shipPrefill}
                      previousCost={ship.currentFreight}
                      previousDate={ship.lastUpdateDate}
                      hasOpenRequest={ship.hasOpenRequest}
                      variant="chip"
                      tone={shipTone}
                      label={`↻ Shipping${fresh ? ` · ${fresh.emoji}` : ""}`}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
