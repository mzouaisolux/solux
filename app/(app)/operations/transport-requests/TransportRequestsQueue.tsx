"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pushToast } from "@/components/feedback/toast-store";
import {
  TRANSPORT_STATUS_LABEL,
  transportKindLabel,
  isSolarPanelField,
  type TransportRequestStatus,
} from "@/lib/transport-request";
import { TRANSPORT_MODE_LABEL } from "@/lib/types";
import {
  startTransportRequest,
  completeTransportRequest,
  cancelTransportRequest,
  reopenTransportRequest,
} from "./actions";

export type TransportQueueItem = {
  id: string;
  kind: string;
  status: TransportRequestStatus;
  priority: string;
  reason: string | null;
  customer: string;
  project: string;
  affairId: string;
  destinationCountry: string | null;
  destinationPort: string | null;
  portOfLoading: string | null;
  deliveryAddress: string | null;
  incoterm: string | null;
  transportMode: string | null;
  notes: string | null;
  freightCost: number | null;
  insuranceCost: number | null;
  transitTimeDays: number | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  cbm: number | null;
  cartonsCount: number | null;
  palletsCount: number | null;
  containers: Array<{ container_type?: string; quantity?: number }>;
  validUntil: string | null;
  opsComments: string | null;
  requestedBy: string;
  importedFrom?: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  lines: Array<{
    product_name: string | null;
    client_product_name: string | null;
    quantity: number;
    config_values: Record<string, string>;
  }>;
};

const KIND_EMOJI: Record<string, string> = {
  packing_list: "📦",
  price: "🚢",
  price_update: "🔄",
};
const STATUS_TONE: Record<string, string> = {
  waiting: "bg-amber-100 text-amber-900",
  in_progress: "bg-sky-100 text-sky-900",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-neutral-100 text-neutral-500",
};
const CONTAINER_TYPES = ["20ft", "40ft", "40ft HC", "LCL"];

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm";
const numCls =
  "w-28 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Compact "k: v" config summary — solar panel first, it drives the CBM. */
function configSummary(values: Record<string, string>): string[] {
  const entries = Object.entries(values).filter(
    ([k, v]) => v && !k.endsWith("__custom") && v !== "__custom__"
  );
  entries.sort(([a], [b]) => {
    const sa = isSolarPanelField(a) ? 0 : 1;
    const sb = isSolarPanelField(b) ? 0 : 1;
    return sa - sb || a.localeCompare(b);
  });
  return entries.map(([k, v]) => `${k}: ${v}`);
}

export function TransportRequestsQueue({ items }: { items: TransportQueueItem[] }) {
  if (items.length === 0) {
    return (
      <p className="mt-4 text-sm text-neutral-400">
        Nothing here — transport requests submitted by Sales land in this queue.
      </p>
    );
  }
  return (
    <div className="mt-4 space-y-3">
      {items.map((it) => (
        <QueueCard key={it.id} it={it} />
      ))}
    </div>
  );
}

function QueueCard({ it }: { it: TransportQueueItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const open = it.status === "waiting" || it.status === "in_progress";
  const isPrice = it.kind === "price" || it.kind === "price_update";

  // ---- completion form state ----
  const [freight, setFreight] = useState<string>(it.freightCost?.toString() ?? "");
  const [insurance, setInsurance] = useState<string>(it.insuranceCost?.toString() ?? "");
  const [transit, setTransit] = useState<string>(it.transitTimeDays?.toString() ?? "");
  const [gw, setGw] = useState<string>(it.grossWeightKg?.toString() ?? "");
  const [nw, setNw] = useState<string>(it.netWeightKg?.toString() ?? "");
  const [cbm, setCbm] = useState<string>(it.cbm?.toString() ?? "");
  const [cartons, setCartons] = useState<string>(it.cartonsCount?.toString() ?? "");
  const [pallets, setPallets] = useState<string>(it.palletsCount?.toString() ?? "");
  const [validUntil, setValidUntil] = useState<string>(it.validUntil ?? "");
  const [comments, setComments] = useState<string>(it.opsComments ?? "");
  const [containers, setContainers] = useState<
    Array<{ container_type: string; quantity: number }>
  >(
    (it.containers ?? [])
      .filter((c) => c && c.container_type)
      .map((c) => ({
        container_type: String(c.container_type),
        quantity: Number(c.quantity) || 1,
      }))
  );
  const [charges, setCharges] = useState<Array<{ label: string; amount: number }>>([]);

  function run(fn: () => Promise<void>, doneMsg: string) {
    startTransition(async () => {
      try {
        await fn();
        pushToast(doneMsg);
        router.refresh();
      } catch (e: any) {
        pushToast(e?.message ?? "Action failed", "error");
      }
    });
  }

  function complete() {
    run(
      () =>
        completeTransportRequest({
          id: it.id,
          freightCost: freight ? Number(freight) : null,
          insuranceCost: insurance ? Number(insurance) : null,
          additionalCharges: charges.filter((c) => c.label && c.amount > 0),
          transitTimeDays: transit ? Number(transit) : null,
          grossWeightKg: gw ? Number(gw) : null,
          netWeightKg: nw ? Number(nw) : null,
          cbm: cbm ? Number(cbm) : null,
          cartonsCount: cartons ? Number(cartons) : null,
          palletsCount: pallets ? Number(pallets) : null,
          containers: containers.filter((c) => c.quantity > 0),
          validUntil: validUntil || null,
          opsComments: comments.trim() || null,
        }),
      "✅ Transport request completed — requester notified"
    );
  }

  return (
    <div className="panel p-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px]" aria-hidden>
          {KIND_EMOJI[it.kind] ?? "•"}
        </span>
        <span className="text-[13.5px] font-semibold text-neutral-900">
          {transportKindLabel(it.kind)}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_TONE[it.status]}`}
        >
          {TRANSPORT_STATUS_LABEL[it.status]}
        </span>
        {it.priority === "high" && (
          <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-800">
            High priority
          </span>
        )}
        <span className="ml-auto text-[11px] text-neutral-400">
          {it.requestedBy} · {fmtDate(it.requestedAt)}
        </span>
      </div>
      <div className="mt-1 text-[12px] text-neutral-600">
        <b>{it.customer}</b> · {it.project}
        {it.importedFrom && (
          <span className="ml-2 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
            📎 from <span className="font-mono">{it.importedFrom}</span>
          </span>
        )}
      </div>
      {it.reason && (
        <div className="mt-1 text-[12px] text-amber-800">Reason: {it.reason}</div>
      )}

      {/* transport info */}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-neutral-600">
        <span>
          → <b>{it.destinationPort || it.destinationCountry || "—"}</b>
          {it.destinationPort && it.destinationCountry
            ? ` (${it.destinationCountry})`
            : ""}
        </span>
        <span>From {it.portOfLoading || "—"}</span>
        <span>{it.incoterm || "—"}</span>
        <span>
          {TRANSPORT_MODE_LABEL[
            (it.transportMode ?? "") as keyof typeof TRANSPORT_MODE_LABEL
          ] ?? it.transportMode ?? "—"}
        </span>
        {it.deliveryAddress && <span>Delivery: {it.deliveryAddress}</span>}
      </div>
      {it.notes && (
        <p className="mt-1 text-[12px] text-neutral-500">{it.notes}</p>
      )}

      {/* product lines — the exact configuration to pack/quote */}
      {it.lines.length > 0 && (
        <ul className="mt-2.5 divide-y divide-neutral-100 rounded-md border border-neutral-100">
          {it.lines.map((l, i) => {
            const summary = configSummary(l.config_values);
            return (
              <li key={i} className="flex flex-wrap items-baseline gap-2 px-3 py-1.5">
                <span className="text-[12.5px] font-medium text-neutral-800">
                  {l.product_name ?? l.client_product_name ?? "—"}
                </span>
                <span className="text-[11px] text-neutral-400">× {l.quantity}</span>
                {summary.length > 0 && (
                  <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">
                    {summary.map((s, j) => (
                      <span
                        key={j}
                        className={
                          isSolarPanelField(s.split(":")[0])
                            ? "font-semibold text-amber-800"
                            : undefined
                        }
                      >
                        {j > 0 ? " · " : ""}
                        {s}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* results (done) or completion form (open) */}
      {!open ? (
        it.status === "completed" && (
          <div className="mt-2.5 rounded-md bg-neutral-50 px-3 py-2 text-[12px] text-neutral-700">
            {isPrice && (
              <>
                <b>{it.freightCost != null ? `${Number(it.freightCost).toLocaleString()} USD` : "—"}</b>
                {it.insuranceCost != null && ` · Insurance ${Number(it.insuranceCost).toLocaleString()} USD`}
                {it.transitTimeDays != null && ` · Transit ${it.transitTimeDays} d`}
                {it.validUntil && ` · Valid until ${fmtDate(it.validUntil)}`}
                {" · "}
              </>
            )}
            {it.cbm != null && <>CBM {it.cbm} · </>}
            {it.grossWeightKg != null && <>GW {it.grossWeightKg} kg · </>}
            {it.netWeightKg != null && <>NW {it.netWeightKg} kg · </>}
            {it.cartonsCount != null && <>{it.cartonsCount} cartons · </>}
            {it.palletsCount != null && <>{it.palletsCount} pallets</>}
            {it.opsComments && (
              <p className="mt-1 text-neutral-500">{it.opsComments}</p>
            )}
            {/* REOPEN (owner 2026-07-11) — controlled correction path. Only
                renders in this Operations queue (capability-gated page);
                the server action re-checks shipping.process_update, demands
                a reason and snapshots every previous value into the
                immutable event log before the status moves. */}
            <div className="mt-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  const reason = window.prompt(
                    "Reopen this completed request — why? (required, kept in the audit history)"
                  );
                  if (reason === null) return;
                  if (!reason.trim()) {
                    pushToast("A reason is required to reopen.", "error");
                    return;
                  }
                  run(
                    () => reopenTransportRequest(it.id, reason.trim()),
                    "↩ Request reopened — previous answer kept in the history"
                  );
                }}
                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                ↩ Reopen to correct
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          {it.status === "waiting" ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() => startTransportRequest(it.id), "Marked in progress")
                }
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-black disabled:opacity-50"
              >
                {pending ? "…" : "Start →"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm("Cancel this transport request?"))
                    run(() => cancelTransportRequest(it.id), "Request cancelled");
                }}
                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                Cancel request
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-end gap-3">
                {isPrice && (
                  <>
                    <label className="text-[11px] font-medium text-neutral-600">
                      Freight cost (USD) *
                      <input type="number" min={0} value={freight} onChange={(e) => setFreight(e.target.value)} className={`${numCls} mt-0.5 block`} />
                    </label>
                    <label className="text-[11px] font-medium text-neutral-600">
                      Insurance (USD)
                      <input type="number" min={0} value={insurance} onChange={(e) => setInsurance(e.target.value)} className={`${numCls} mt-0.5 block`} />
                    </label>
                    <label className="text-[11px] font-medium text-neutral-600">
                      Transit time (days)
                      <input type="number" min={0} value={transit} onChange={(e) => setTransit(e.target.value)} className={`${numCls} mt-0.5 block`} />
                    </label>
                    <label className="text-[11px] font-medium text-neutral-600">
                      Valid until
                      <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={`${numCls} mt-0.5 block w-36`} />
                    </label>
                  </>
                )}
                <label className="text-[11px] font-medium text-neutral-600">
                  Gross weight (kg){!isPrice && " *"}
                  <input type="number" min={0} value={gw} onChange={(e) => setGw(e.target.value)} className={`${numCls} mt-0.5 block`} />
                </label>
                <label className="text-[11px] font-medium text-neutral-600">
                  Net weight (kg)
                  <input type="number" min={0} value={nw} onChange={(e) => setNw(e.target.value)} className={`${numCls} mt-0.5 block`} />
                </label>
                <label className="text-[11px] font-medium text-neutral-600">
                  CBM{!isPrice && " *"}
                  <input type="number" min={0} step="0.01" value={cbm} onChange={(e) => setCbm(e.target.value)} className={`${numCls} mt-0.5 block`} />
                </label>
                <label className="text-[11px] font-medium text-neutral-600">
                  Cartons
                  <input type="number" min={0} value={cartons} onChange={(e) => setCartons(e.target.value)} className={`${numCls} mt-0.5 block w-24`} />
                </label>
                <label className="text-[11px] font-medium text-neutral-600">
                  Pallets
                  <input type="number" min={0} value={pallets} onChange={(e) => setPallets(e.target.value)} className={`${numCls} mt-0.5 block w-24`} />
                </label>
              </div>

              {/* containers breakdown (type + qty) */}
              <div className="text-[11px] font-medium text-neutral-600">
                Containers
                <div className="mt-1 space-y-1.5">
                  {containers.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={c.container_type}
                        onChange={(e) =>
                          setContainers((prev) =>
                            prev.map((x, j) =>
                              j === i ? { ...x, container_type: e.target.value } : x
                            )
                          )
                        }
                        className={`${inputCls} w-32`}
                      >
                        {CONTAINER_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        value={c.quantity}
                        onChange={(e) =>
                          setContainers((prev) =>
                            prev.map((x, j) =>
                              j === i
                                ? { ...x, quantity: Number(e.target.value) || 1 }
                                : x
                            )
                          )
                        }
                        className={`${numCls} w-20`}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setContainers((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="text-neutral-300 hover:text-rose-600"
                        aria-label="Remove container row"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setContainers((prev) => [
                        ...prev,
                        { container_type: "40ft HC", quantity: 1 },
                      ])
                    }
                    className="text-[11px] font-medium text-neutral-500 hover:text-neutral-900"
                  >
                    + Add container row
                  </button>
                </div>
              </div>

              {/* additional charges (price kinds) */}
              {isPrice && (
                <div className="text-[11px] font-medium text-neutral-600">
                  Additional charges (ECTN, BESC, inspection…)
                  <div className="mt-1 space-y-1.5">
                    {charges.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          value={c.label}
                          placeholder="Label"
                          onChange={(e) =>
                            setCharges((prev) =>
                              prev.map((x, j) =>
                                j === i ? { ...x, label: e.target.value } : x
                              )
                            )
                          }
                          className={`${inputCls} w-52`}
                        />
                        <input
                          type="number"
                          min={0}
                          value={c.amount || ""}
                          placeholder="USD"
                          onChange={(e) =>
                            setCharges((prev) =>
                              prev.map((x, j) =>
                                j === i
                                  ? { ...x, amount: Number(e.target.value) || 0 }
                                  : x
                              )
                            )
                          }
                          className={`${numCls} w-24`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setCharges((prev) => prev.filter((_, j) => j !== i))
                          }
                          className="text-neutral-300 hover:text-rose-600"
                          aria-label="Remove charge"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setCharges((prev) => [...prev, { label: "", amount: 0 }])
                      }
                      className="text-[11px] font-medium text-neutral-500 hover:text-neutral-900"
                    >
                      + Add charge
                    </button>
                  </div>
                </div>
              )}

              <label className="block text-[11px] font-medium text-neutral-600">
                Comments to the requester
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={2}
                  className={`${inputCls} mt-0.5 resize-none`}
                />
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={complete}
                  className="rounded-md bg-solux px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-solux-dark disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Complete request ✓"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm("Cancel this transport request?"))
                      run(() => cancelTransportRequest(it.id), "Request cancelled");
                  }}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Cancel request
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
