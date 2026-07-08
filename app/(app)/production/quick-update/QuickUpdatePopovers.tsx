"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "@/components/feedback/toast-store";
import { DELAY_TYPES, DELAY_TYPE_LABEL } from "@/lib/delays";
import type { QuickUpdateRow } from "@/lib/quick-update-columns";
import {
  updateProductionOrderPayments,
  updateProductionOrderDeadline,
  requestBlInfoFromSales,
  requestShippingDocsRequirements,
} from "@/app/(app)/production/orders/actions";
import { updateOrderCell } from "./actions";
import styles from "./quick-update.module.css";

/* ---------- shared save contract with the table ---------- */

export type CommitInput = {
  id: string;
  patch: Record<string, unknown>;
  prev: Record<string, unknown>;
  run: () => Promise<void>;
  /** Omit for non-undoable changes (e.g. adding a delay event). */
  undoRun?: () => Promise<void>;
  label: string;
  touched: string[];
};
export type CommitFn = (input: CommitInput) => void;

export type PopoverKind = "payment" | "bl" | "timeline" | "documents";

/* ---------- helpers ---------- */

function money(currency: string, n: number): string {
  return `${currency} ${Math.round(n).toLocaleString()}`;
}
function s(v: unknown): string {
  return v == null ? "" : String(v);
}

/* ============================================================
   Popover shell — fixed portal, positioned near the anchor rect,
   closes on Escape + outside click.
   ============================================================ */

export function Popover({
  anchor,
  onClose,
  children,
}: {
  anchor: DOMRect;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: anchor.bottom + 6,
    left: anchor.left,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = anchor.left;
    let top = anchor.bottom + 6;
    if (left + r.width > window.innerWidth - 12)
      left = Math.max(12, window.innerWidth - r.width - 12);
    if (top + r.height > window.innerHeight - 12)
      top = Math.max(12, anchor.top - r.height - 6);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    // defer so the opening click itself doesn't immediately close it
    const t = window.setTimeout(
      () => document.addEventListener("mousedown", onDown),
      0
    );
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.clearTimeout(t);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className={styles.pop}
      style={{ top: pos.top, left: pos.left }}
      role="dialog"
    >
      {children}
    </div>,
    document.body
  );
}

/* ============================================================
   Payment popover — resubmits the WHOLE payments bundle (with current
   values) so the existing action's auto-advance + baseline-lock fire.
   ============================================================ */

export function PaymentPopoverBody({
  row,
  commit,
  onClose,
}: {
  row: QuickUpdateRow;
  commit: CommitFn;
  onClose: () => void;
}) {
  const [depAmt, setDepAmt] = useState(s(row.depositReceived || ""));
  const [depAt, setDepAt] = useState(s(row.depositReceivedAt));
  const [balAmt, setBalAmt] = useState(s(row.balanceReceived || ""));
  const [balAt, setBalAt] = useState(s(row.balanceReceivedAt));
  const [dueDate, setDueDate] = useState(s(row.balanceDueDate));
  const [lc, setLc] = useState(s(row.lcExpiryDate));
  const [notes, setNotes] = useState(s(row.paymentNotes));
  // Manual orders (m155) have no quotation to read total/terms from — the
  // expected amounts derive from these two editable facts instead.
  const [mTotal, setMTotal] = useState(s(row.manualTotal ?? ""));
  const [mPct, setMPct] = useState(s(row.manualDepositPct ?? ""));

  /** Granular save of one manual money fact (whitelisted updateOrderCell). */
  const commitManualFact = (
    field: "manual_total_price" | "manual_deposit_percent",
    value: string,
    prevValue: string,
    patch: Record<string, unknown>,
    prev: Record<string, unknown>
  ) => {
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("field", field);
    fd.set("value", value);
    const prevFd = new FormData();
    prevFd.set("id", row.id);
    prevFd.set("field", field);
    prevFd.set("value", prevValue);
    commit({
      id: row.id,
      patch,
      prev,
      run: () => updateOrderCell(fd),
      undoRun: () => updateOrderCell(prevFd),
      label: `${field === "manual_total_price" ? "Order total" : "Deposit %"} · ${row.number}`,
      touched: ["deposit", "balance", "payment_status"],
    });
  };

  const build = (vals: {
    depAmt: string;
    depAt: string;
    balAmt: string;
    balAt: string;
    dueDate: string;
    lc: string;
    notes: string;
  }) => {
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("deposit_received_amount", vals.depAmt);
    fd.set("deposit_received_at", vals.depAt);
    fd.set("balance_received_amount", vals.balAmt);
    fd.set("balance_received_at", vals.balAt);
    fd.set("balance_due_date", vals.dueDate);
    fd.set("lc_expiry_date", vals.lc);
    fd.set("payment_notes", vals.notes);
    return fd;
  };

  const save = () => {
    // Manual money facts first (independent granular writes) — the expected
    // amounts in the optimistic patch mirror the server derivation.
    if (row.source === "manual") {
      const totalN = mTotal.trim() === "" ? null : Number(mTotal);
      const pctN = mPct.trim() === "" ? null : Number(mPct);
      const expDep =
        totalN != null && pctN != null ? (totalN * pctN) / 100 : 0;
      const expBal = totalN != null ? Math.max(0, totalN - expDep) : 0;
      const derived = {
        manualTotal: totalN,
        manualDepositPct: pctN,
        expectedDeposit: expDep,
        expectedBalance: expBal,
        balanceRemaining: Math.max(0, expBal - Number(balAmt || 0)),
      };
      const prevDerived = {
        manualTotal: row.manualTotal,
        manualDepositPct: row.manualDepositPct,
        expectedDeposit: row.expectedDeposit,
        expectedBalance: row.expectedBalance,
        balanceRemaining: row.balanceRemaining,
      };
      if (totalN !== (row.manualTotal ?? null)) {
        commitManualFact(
          "manual_total_price",
          mTotal.trim(),
          s(row.manualTotal ?? ""),
          derived,
          prevDerived
        );
      }
      if (pctN !== (row.manualDepositPct ?? null)) {
        commitManualFact(
          "manual_deposit_percent",
          mPct.trim(),
          s(row.manualDepositPct ?? ""),
          derived,
          prevDerived
        );
      }
    }

    const nextDeposit = Number(depAmt || 0);
    const nextBalance = Number(balAmt || 0);
    const patch: Record<string, unknown> = {
      depositReceived: nextDeposit,
      depositReceivedAt: depAt || null,
      balanceReceived: nextBalance,
      balanceReceivedAt: balAt || null,
      balanceDueDate: dueDate || null,
      lcExpiryDate: lc || null,
      paymentNotes: notes || null,
      balanceRemaining: Math.max(0, row.expectedBalance - nextBalance),
    };
    // Optimistic auto-advance mirror (server does the authoritative flip).
    if (
      row.status === "awaiting_deposit" &&
      row.expectedDeposit > 0 &&
      nextDeposit + 0.01 >= row.expectedDeposit
    ) {
      patch.status = "deposit_received";
    }
    const prev = {
      depositReceived: row.depositReceived,
      depositReceivedAt: row.depositReceivedAt,
      balanceReceived: row.balanceReceived,
      balanceReceivedAt: row.balanceReceivedAt,
      balanceDueDate: row.balanceDueDate,
      lcExpiryDate: row.lcExpiryDate,
      paymentNotes: row.paymentNotes,
      balanceRemaining: row.balanceRemaining,
      status: row.status,
    };
    const prevVals = {
      depAmt: s(row.depositReceived || ""),
      depAt: s(row.depositReceivedAt),
      balAmt: s(row.balanceReceived || ""),
      balAt: s(row.balanceReceivedAt),
      dueDate: s(row.balanceDueDate),
      lc: s(row.lcExpiryDate),
      notes: s(row.paymentNotes),
    };
    commit({
      id: row.id,
      patch,
      prev,
      run: () =>
        updateProductionOrderPayments(
          build({ depAmt, depAt, balAmt, balAt, dueDate, lc, notes })
        ),
      undoRun: () => updateProductionOrderPayments(build(prevVals)),
      label: `Payment · ${row.number}`,
      touched: ["deposit", "balance", "payment_status", "status"],
    });
    onClose();
  };

  return (
    <div>
      <div className={styles.popTitle}>Payment · {row.number}</div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
        Expected deposit {money(row.currency, row.expectedDeposit)} · balance{" "}
        {money(row.currency, row.expectedBalance)}
      </div>
      {row.source === "manual" && (
        <div className={styles.popRow}>
          <label className={styles.field} style={{ flex: 2 }}>
            <span className={styles.fieldLabel}>
              Order total ({row.currency})
            </span>
            <input
              className={styles.popInput}
              type="number"
              min="0"
              value={mTotal}
              onChange={(e) => setMTotal(e.target.value)}
            />
          </label>
          <label className={styles.field} style={{ flex: 1 }}>
            <span className={styles.fieldLabel}>Deposit %</span>
            <input
              className={styles.popInput}
              type="number"
              min="0"
              max="100"
              value={mPct}
              onChange={(e) => setMPct(e.target.value)}
            />
          </label>
        </div>
      )}
      <div className={styles.popRow}>
        <label className={styles.field} style={{ flex: 1 }}>
          <span className={styles.fieldLabel}>Deposit received</span>
          <input
            className={styles.popInput}
            type="number"
            value={depAmt}
            onChange={(e) => setDepAmt(e.target.value)}
            autoFocus
          />
        </label>
        <label className={styles.field} style={{ flex: 1 }}>
          <span className={styles.fieldLabel}>Deposit date</span>
          <input
            className={styles.popInput}
            type="date"
            value={depAt}
            onChange={(e) => setDepAt(e.target.value)}
          />
        </label>
      </div>
      <div className={styles.popRow}>
        <label className={styles.field} style={{ flex: 1 }}>
          <span className={styles.fieldLabel}>Balance received</span>
          <input
            className={styles.popInput}
            type="number"
            value={balAmt}
            onChange={(e) => setBalAmt(e.target.value)}
          />
        </label>
        <label className={styles.field} style={{ flex: 1 }}>
          <span className={styles.fieldLabel}>Balance date</span>
          <input
            className={styles.popInput}
            type="date"
            value={balAt}
            onChange={(e) => setBalAt(e.target.value)}
          />
        </label>
      </div>
      <div className={styles.popRow}>
        <label className={styles.field} style={{ flex: 1 }}>
          <span className={styles.fieldLabel}>Balance due date</span>
          <input
            className={styles.popInput}
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>
        <label className={styles.field} style={{ flex: 1 }}>
          <span className={styles.fieldLabel}>LC expiry</span>
          <input
            className={styles.popInput}
            type="date"
            value={lc}
            onChange={(e) => setLc(e.target.value)}
          />
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Payment notes</span>
        <input
          className={styles.popInput}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <PopActions onClose={onClose} onSave={save} />
    </div>
  );
}

/* ============================================================
   BL popover — inline bl_number edit (granular) + profile status +
   request-info-from-sales workflow trigger + link to the client profile.
   ============================================================ */

export function BLPopoverBody({
  row,
  commit,
  canEdit,
  onClose,
}: {
  row: QuickUpdateRow;
  commit: CommitFn;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [bl, setBl] = useState(s(row.blNumber));
  const [pending, startTransition] = useTransition();

  const STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
    complete: { bg: "#dcfce7", fg: "#166534", label: "Profile complete" },
    partial: { bg: "#fef9c3", fg: "#854d0e", label: "Profile partial" },
    missing: { bg: "#fee2e2", fg: "#991b1b", label: "Profile missing" },
  };
  const tone = STATUS_TONE[row.blStatus] ?? STATUS_TONE.missing;

  const saveBl = () => {
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("field", "bl_number");
    fd.set("value", bl);
    const prevFd = new FormData();
    prevFd.set("id", row.id);
    prevFd.set("field", "bl_number");
    prevFd.set("value", s(row.blNumber));
    commit({
      id: row.id,
      patch: { blNumber: bl || null },
      prev: { blNumber: row.blNumber },
      run: () => updateOrderCell(fd),
      undoRun: () => updateOrderCell(prevFd),
      label: `BL# · ${row.number}`,
      touched: ["bl"],
    });
    onClose();
  };

  const requestInfo = () => {
    const fd = new FormData();
    fd.set("id", row.id);
    startTransition(async () => {
      try {
        await requestBlInfoFromSales(fd);
        toast.success("BL info requested from Sales");
        onClose();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not request BL info");
      }
    });
  };

  return (
    <div>
      <div className={styles.popTitle}>Bill of Lading · {row.number}</div>
      <span
        className={styles.pill}
        style={{ background: tone.bg, color: tone.fg, marginBottom: 10 }}
      >
        {tone.label}
      </span>
      <label className={styles.field} style={{ marginTop: 10 }}>
        <span className={styles.fieldLabel}>BL number</span>
        <input
          className={styles.popInput}
          value={bl}
          disabled={!canEdit}
          onChange={(e) => setBl(e.target.value)}
          placeholder="Issued by the carrier"
          autoFocus
        />
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          className={styles.chip}
          onClick={requestInfo}
          disabled={pending || !canEdit}
        >
          {pending ? "Requesting…" : "Request BL info from Sales"}
        </button>
        {row.clientId && (
          <Link
            href={`/clients/${row.clientId}`}
            className={styles.chip}
            onClick={onClose}
          >
            Edit client BL profile →
          </Link>
        )}
      </div>
      {canEdit && <PopActions onClose={onClose} onSave={saveBl} />}
    </div>
  );
}

/* ============================================================
   Timeline popover — read the delay totals + add a delay event
   (updateProductionOrderDeadline recomputes the ETA server-side).
   No undo (adding a delay is a deliberate, audited action).
   ============================================================ */

export function TimelinePopoverBody({
  row,
  commit,
  canEdit,
  onClose,
}: {
  row: QuickUpdateRow;
  commit: CommitFn;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [days, setDays] = useState("");
  const [type, setType] = useState<string>("production");
  const [reason, setReason] = useState("");

  const addDelay = () => {
    const n = Number(days);
    if (!Number.isFinite(n) || n === 0) {
      toast.error("Enter a non-zero number of days");
      return;
    }
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("days_added", String(n));
    fd.set("delay_type", type);
    fd.set("reason", reason);
    const isFactory = type === "production";
    commit({
      id: row.id,
      patch: {
        factoryDelayDays: row.factoryDelayDays + (isFactory ? n : 0),
        externalDelayDays: row.externalDelayDays + (isFactory ? 0 : n),
      },
      prev: {
        factoryDelayDays: row.factoryDelayDays,
        externalDelayDays: row.externalDelayDays,
      },
      run: () => updateProductionOrderDeadline(fd),
      label: `Delay ${n > 0 ? "+" : ""}${n}d · ${row.number}`,
      touched: ["factory_delay", "external_delay", "production_due"],
    });
    onClose();
  };

  return (
    <div>
      <div className={styles.popTitle}>Timeline · {row.number}</div>
      <div style={{ fontSize: 12, color: "#374151", marginBottom: 10 }}>
        Production due <b>{row.productionDue ?? "—"}</b>
        <br />
        Initial deadline {row.initialDeadline ?? "—"} · factory{" "}
        {row.factoryDelayDays >= 0 ? "+" : ""}
        {row.factoryDelayDays}d · external {row.externalDelayDays >= 0 ? "+" : ""}
        {row.externalDelayDays}d
      </div>
      {canEdit ? (
        <>
          <div className={styles.popRow}>
            <label className={styles.field} style={{ width: 90 }}>
              <span className={styles.fieldLabel}>Days ±</span>
              <input
                className={styles.popInput}
                type="number"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="+7"
                autoFocus
              />
            </label>
            <label className={styles.field} style={{ flex: 1 }}>
              <span className={styles.fieldLabel}>Cause</span>
              <select
                className={styles.popInput}
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {DELAY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DELAY_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Reason</span>
            <input
              className={styles.popInput}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why the deadline moved"
            />
          </label>
          <PopActions onClose={onClose} onSave={addDelay} saveLabel="Add delay" />
        </>
      ) : (
        <Link href={row.detailHref} className={styles.chip} onClick={onClose}>
          Open order to edit timeline →
        </Link>
      )}
    </div>
  );
}

/* ============================================================
   Documents popover — the requirement CHECKLIST behind the "n/m"
   counter (which docs, ready or missing), plus the Operations → Sales
   loop: "which shipping documents does this customer require?" (Sales
   ticks them on the client's Shipping/BL profile — the same source
   these requirements derive from). Upload stays on the order page.
   ============================================================ */

export function DocumentsPopoverBody({
  row,
  canEdit,
  onClose,
}: {
  row: QuickUpdateRow;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const allReady = row.docsTotal > 0 && row.docsReady === row.docsTotal;

  const requestRequirements = () => {
    const fd = new FormData();
    fd.set("id", row.id);
    startTransition(async () => {
      try {
        await requestShippingDocsRequirements(fd);
        toast.success(
          "Request sent to Sales — they'll confirm the client's required documents"
        );
        onClose();
      } catch (e: any) {
        toast.error(e?.message ?? "Could not send the request");
      }
    });
  };

  return (
    <div>
      <div className={styles.popTitle}>Shipping documents · {row.number}</div>
      <div style={{ fontSize: 13, color: "#374151", marginBottom: 8 }}>
        <b style={{ color: allReady ? "#166534" : "#854d0e" }}>
          {row.docsReady}/{row.docsTotal}
        </b>{" "}
        required documents ready.
      </div>

      {/* the actual checklist — no more guessing what "0/7" means */}
      {row.docsItems.length > 0 && (
        <ul className={styles.docList}>
          {row.docsItems.map((d) => (
            <li key={d.key} className={styles.docItem}>
              <span
                className={styles.dot}
                style={{ background: d.present ? "#22c55e" : "#ef4444" }}
              />
              <span
                style={{
                  flex: 1,
                  color: d.present ? "#374151" : "#111827",
                }}
              >
                {d.label}
              </span>
              <span style={{ color: "#9ca3af", fontSize: 10 }}>
                {d.present ? "ready" : d.level}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ fontSize: 12, color: "#6b7280", margin: "8px 0 10px" }}>
        Commercial Invoice:{" "}
        {row.ciNumber ? <b>{row.ciNumber}</b> : "not generated yet"}
        <br />
        <span style={{ fontSize: 11 }}>
          The list derives from the payment terms + the client's document
          checklist (Shipping / BL profile).
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canEdit && (
          <button
            type="button"
            className={styles.chip}
            onClick={requestRequirements}
            disabled={pending || !row.clientId}
            title={
              row.clientId
                ? "Ask the Sales owner to confirm which shipping documents this customer requires"
                : "Link a client to this order first"
            }
          >
            {pending ? "Requesting…" : "Request requirements from Sales"}
          </button>
        )}
        <Link href={row.detailHref} className={styles.chip} onClick={onClose}>
          Open documents on the order →
        </Link>
      </div>
    </div>
  );
}

/* ---------- shared popover action row ---------- */

function PopActions({
  onClose,
  onSave,
  saveLabel = "Save",
}: {
  onClose: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  return (
    <div className={styles.popActions}>
      <button type="button" className={styles.chip} onClick={onClose}>
        Close
      </button>
      <button
        type="button"
        className={styles.chip}
        style={{ background: "#0f172a", color: "#fff", borderColor: "#0f172a" }}
        onClick={onSave}
      >
        {saveLabel}
      </button>
    </div>
  );
}
