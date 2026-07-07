"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  SNAPSHOT_FIELDS,
  SHIPPING_UPDATE_STATUS_LABEL,
  SHIPPING_UPDATE_PRIORITY_LABEL,
  formatDelta,
  type ShippingSnapshot,
  type ShippingUpdateStatus,
  type ShippingUpdatePriority,
} from "@/lib/shipping-update";
import { pushToast } from "@/components/feedback/toast-store";
import {
  startShippingUpdate,
  completeShippingUpdate,
  cancelShippingUpdate,
} from "./actions";

export type QueueItem = {
  id: string;
  documentId: string;
  documentNumber: string;
  documentType: string;
  status: ShippingUpdateStatus;
  priority: ShippingUpdatePriority | string;
  reason: string | null;
  snapshot: ShippingSnapshot;
  previousFreight: number | null;
  previousInsurance: number | null;
  previousQuoteDate: string | null;
  newFreight: number | null;
  newInsurance: number | null;
  opsNotes: string | null;
  customer: string;
  project: string;
  requestedBy: string;
  requestedAt: string | null;
  completedAt: string | null;
  currentInsurance: number | null;
  currentCharges: { label: string; amount: number }[];
  containers: {
    id: string;
    container_type: string;
    quantity: number;
    unit_price: number;
    wooden_box_cost: number;
  }[];
};

function d(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const STATUS_TONE: Record<string, string> = {
  waiting: "border-amber-300 bg-amber-50 text-amber-900",
  in_progress: "border-sky-300 bg-sky-50 text-sky-900",
  completed: "border-emerald-300 bg-emerald-50 text-emerald-900",
  cancelled: "border-neutral-200 bg-neutral-50 text-neutral-500",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATUS_TONE[status] ?? STATUS_TONE.cancelled}`}
    >
      {SHIPPING_UPDATE_STATUS_LABEL[status as ShippingUpdateStatus] ?? status}
    </span>
  );
}

/** One expandable request row with the completion form. */
function QueueRow({ item }: { item: QueueItem }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const isOpenStatus = item.status === "waiting" || item.status === "in_progress";

  // Completion form state — live delta preview is the point of the panel.
  const [unitPrices, setUnitPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.containers.map((c) => [c.id, String(c.unit_price)]))
  );
  const [flatFreight, setFlatFreight] = useState(
    item.previousFreight == null ? "" : String(item.previousFreight)
  );
  const [insurance, setInsurance] = useState(
    item.currentInsurance == null ? "" : String(item.currentInsurance)
  );
  const [charges, setCharges] = useState<{ label: string; amount: string }[]>(
    item.currentCharges.map((c) => ({ label: c.label, amount: String(c.amount) }))
  );
  const [notes, setNotes] = useState("");

  const newFreightTotal = useMemo(() => {
    if (item.containers.length === 0) {
      const n = Number(flatFreight.replace(",", "."));
      return Number.isFinite(n) ? n : 0;
    }
    return item.containers.reduce((s, c) => {
      const n = Number((unitPrices[c.id] ?? "").replace(",", "."));
      const unit = Number.isFinite(n) ? n : c.unit_price;
      const wooden = c.container_type === "LCL" ? c.wooden_box_cost : 0;
      return s + c.quantity * unit + wooden;
    }, 0);
  }, [item.containers, unitPrices, flatFreight]);

  const delta =
    item.previousFreight == null ? null : newFreightTotal - Number(item.previousFreight);

  const run = (action: (fd: FormData) => Promise<void>, fd: FormData, ok: string) => {
    startTransition(async () => {
      try {
        await action(fd);
        pushToast(ok);
        router.refresh();
      } catch (e: any) {
        pushToast(e?.message ?? "Action failed", "error");
      }
    });
  };

  const complete = () => {
    const fd = new FormData();
    fd.set("id", item.id);
    if (item.containers.length) {
      for (const c of item.containers) fd.set(`cu_${c.id}`, unitPrices[c.id] ?? "");
    } else {
      fd.set("new_freight_cost", flatFreight);
    }
    if (insurance.trim()) fd.set("new_insurance_cost", insurance);
    const cleanCharges = charges
      .map((c) => ({ label: c.label.trim(), amount: Number(c.amount.replace(",", ".")) }))
      .filter((c) => c.label && Number.isFinite(c.amount));
    fd.set("additional_charges_json", JSON.stringify(cleanCharges));
    if (notes.trim()) fd.set("ops_notes", notes.trim());
    run(completeShippingUpdate, fd, "✓ Document updated — requester notified");
  };

  const simple = (action: (fd: FormData) => Promise<void>, ok: string) => {
    const fd = new FormData();
    fd.set("id", item.id);
    run(action, fd, ok);
  };

  const inputCls =
    "rounded-md border border-neutral-200 bg-white px-2 py-1 text-[12px] focus:border-neutral-400 focus:outline-none";

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-neutral-50"
        onClick={(e) => {
          const el = e.target as HTMLElement;
          if (el.closest("a, button, input, select, textarea")) return;
          setOpen((v) => !v);
        }}
      >
        <td className="whitespace-nowrap">
          {item.priority === "high" ? (
            <span className="font-semibold text-rose-700">High</span>
          ) : (
            SHIPPING_UPDATE_PRIORITY_LABEL[item.priority as ShippingUpdatePriority] ?? item.priority
          )}
        </td>
        <td>{item.customer}</td>
        <td>{item.project}</td>
        <td>
          <Link href={`/documents/${item.documentId}`} className="pname">
            {item.documentNumber}
          </Link>
        </td>
        <td>{item.requestedBy}</td>
        <td className="sx-tnum">{d(item.requestedAt)}</td>
        <td className="sx-tnum">{d(item.previousQuoteDate)}</td>
        <td>
          <StatusPill status={item.status} />
        </td>
        <td className="r">
          <button type="button" className="open" onClick={() => setOpen((v) => !v)}>
            {open ? "Close ↑" : "Open ↓"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} className="bg-neutral-50/60">
            <div className="grid grid-cols-1 gap-6 p-4 md:grid-cols-2">
              {/* -------- Shipping summary (what Sales confirmed) -------- */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  Shipping summary
                </div>
                <dl className="mt-1 space-y-0.5 text-xs">
                  {SNAPSHOT_FIELDS.map(({ key, label }) =>
                    item.snapshot[key] ? (
                      <div key={key} className="flex justify-between gap-4">
                        <dt className="text-neutral-500">{label}</dt>
                        <dd className="text-right">{item.snapshot[key]}</dd>
                      </div>
                    ) : null
                  )}
                  <div className="flex justify-between gap-4 border-t border-neutral-200 pt-1">
                    <dt className="text-neutral-500">Previous freight</dt>
                    <dd className="tabular-nums">
                      {item.previousFreight == null
                        ? "—"
                        : Number(item.previousFreight).toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-neutral-500">Previous quote date</dt>
                    <dd>{d(item.previousQuoteDate)}</dd>
                  </div>
                  {item.reason && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-neutral-500">Reason</dt>
                      <dd className="text-right">{item.reason}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* -------- New costs (open) / outcome (closed) -------- */}
              {isOpenStatus ? (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                    New shipping cost
                  </div>
                  {item.containers.length ? (
                    <table className="mt-1 w-full text-xs">
                      <tbody>
                        {item.containers.map((c) => (
                          <tr key={c.id}>
                            <td className="py-0.5 text-neutral-500">
                              {c.quantity}× {c.container_type}
                            </td>
                            <td className="py-0.5 text-right">
                              <input
                                value={unitPrices[c.id] ?? ""}
                                onChange={(e) =>
                                  setUnitPrices((m) => ({ ...m, [c.id]: e.target.value }))
                                }
                                className={`${inputCls} w-28 text-right`}
                                aria-label={`New unit price for ${c.container_type}`}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <label className="mt-1 block text-xs">
                      <span className="mb-1 block text-neutral-500">New freight total</span>
                      <input
                        value={flatFreight}
                        onChange={(e) => setFlatFreight(e.target.value)}
                        className={`${inputCls} w-36 text-right`}
                      />
                    </label>
                  )}
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-neutral-500">New freight total</span>
                    <b className="tabular-nums">{newFreightTotal.toFixed(2)}</b>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-500">Difference vs previous</span>
                    <b
                      className={`tabular-nums ${
                        delta == null ? "" : delta > 0 ? "text-rose-700" : "text-emerald-700"
                      }`}
                    >
                      {formatDelta(delta)}
                    </b>
                  </div>
                  <label className="mt-2 block text-xs">
                    <span className="mb-1 block text-neutral-500">
                      Insurance (recalculated)
                    </span>
                    <input
                      value={insurance}
                      onChange={(e) => setInsurance(e.target.value)}
                      className={`${inputCls} w-36 text-right`}
                    />
                  </label>
                  <div className="mt-2 text-xs">
                    <span className="mb-1 block text-neutral-500">Additional charges</span>
                    {charges.map((c, i) => (
                      <div key={i} className="mb-1 flex items-center gap-2">
                        <input
                          value={c.label}
                          placeholder="Label (ECTN, BESC…)"
                          onChange={(e) =>
                            setCharges((arr) =>
                              arr.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))
                            )
                          }
                          className={`${inputCls} flex-1`}
                        />
                        <input
                          value={c.amount}
                          placeholder="0.00"
                          onChange={(e) =>
                            setCharges((arr) =>
                              arr.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x))
                            )
                          }
                          className={`${inputCls} w-24 text-right`}
                        />
                        <button
                          type="button"
                          className="text-neutral-400 hover:text-rose-600"
                          onClick={() => setCharges((arr) => arr.filter((_, j) => j !== i))}
                          aria-label="Remove charge"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="text-[11px] font-medium underline hover:no-underline"
                      onClick={() => setCharges((arr) => [...arr, { label: "", amount: "" }])}
                    >
                      + Add charge
                    </button>
                  </div>
                  <label className="mt-2 block text-xs">
                    <span className="mb-1 block text-neutral-500">Comments</span>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className={`${inputCls} w-full`}
                    />
                  </label>
                  <div className="mt-3 flex items-center gap-2">
                    {item.status === "waiting" && (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={pending}
                        onClick={() => simple(startShippingUpdate, "Marked in progress")}
                      >
                        Start
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-primary text-xs"
                      disabled={pending}
                      onClick={complete}
                    >
                      {pending ? "Saving…" : "✓ Complete & update document"}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-neutral-500 underline hover:no-underline"
                      disabled={pending}
                      onClick={() => simple(cancelShippingUpdate, "Request cancelled")}
                    >
                      Cancel request
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                    Outcome
                  </div>
                  <dl className="mt-1 space-y-0.5 text-xs">
                    <div className="flex justify-between gap-4">
                      <dt className="text-neutral-500">Old freight</dt>
                      <dd className="tabular-nums">
                        {item.previousFreight == null
                          ? "—"
                          : Number(item.previousFreight).toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-neutral-500">New freight</dt>
                      <dd className="tabular-nums">
                        {item.newFreight == null ? "—" : Number(item.newFreight).toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-neutral-500">Difference</dt>
                      <dd className="tabular-nums">
                        {item.previousFreight == null || item.newFreight == null
                          ? "—"
                          : formatDelta(Number(item.newFreight) - Number(item.previousFreight))}
                      </dd>
                    </div>
                    {item.completedAt && (
                      <div className="flex justify-between gap-4">
                        <dt className="text-neutral-500">Completed</dt>
                        <dd>{d(item.completedAt)}</dd>
                      </div>
                    )}
                    {item.opsNotes && (
                      <div className="flex justify-between gap-4">
                        <dt className="text-neutral-500">Comments</dt>
                        <dd className="text-right">{item.opsNotes}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function ShippingUpdatesQueue({ items }: { items: QueueItem[] }) {
  return (
    <div className="sx-panel">
      <table className="sx-list">
        <thead>
          <tr>
            <th>Priority</th>
            <th>Customer</th>
            <th>Project</th>
            <th>Document</th>
            <th>Requested by</th>
            <th>Request date</th>
            <th>Prev. quote date</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={9}>
                <div className="sx-empty">No shipping update requests here.</div>
              </td>
            </tr>
          ) : (
            items.map((item) => <QueueRow key={item.id} item={item} />)
          )}
        </tbody>
      </table>
    </div>
  );
}
