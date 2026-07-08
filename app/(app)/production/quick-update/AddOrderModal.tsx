"use client";

/**
 * Manual-order entry modal (m155) — the Excel-transition on-ramp.
 *
 * Registers a production order BY HAND, without a quotation or task list:
 * Operations types the facts they have in the old Excel book (their own PO
 * number, client, total, deposit %, due date) and the row appears in Quick
 * Update with the exact same inline editing as workflow orders. Everything
 * here is optional except the PO number — partial knowledge is expected
 * during a migration and every field stays editable afterwards.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/feedback/toast-store";
import {
  PRODUCTION_ORDER_STATUSES,
  PRODUCTION_ORDER_STATUS_LABEL,
} from "@/lib/types";
import { createManualOrder } from "./actions";
import styles from "./quick-update.module.css";

export function AddOrderModal({
  clientOptions,
  onClose,
}: {
  clientOptions: { id: string; label: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [number, setNumber] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [salesLabel, setSalesLabel] = useState("");
  const [total, setTotal] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [depositPct, setDepositPct] = useState("30");
  const [status, setStatus] = useState("awaiting_deposit");
  const [incoterm, setIncoterm] = useState("");
  const [productionDue, setProductionDue] = useState("");
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (!number.trim()) {
      toast.error("PO number is required");
      return;
    }
    const fd = new FormData();
    fd.set("number", number.trim());
    fd.set("client_id", clientId);
    fd.set("client_name", clientName);
    fd.set("sales_label", salesLabel);
    fd.set("total", total);
    fd.set("currency", currency);
    fd.set("deposit_percent", depositPct);
    fd.set("status", status);
    fd.set("incoterm", incoterm);
    fd.set("production_due", productionDue);
    fd.set("notes", notes);
    startTransition(async () => {
      try {
        await createManualOrder(fd);
        toast.success(`Order ${number.trim()} registered`);
        onClose();
        router.refresh(); // force-dynamic page → refetch includes the new row
      } catch (e: any) {
        toast.error(e?.message ?? "Could not create the order");
      }
    });
  };

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.popTitle}>Add order manually</div>
        <p className={styles.modalHint}>
          Excel-transition entry — no quotation needed. Only the PO number is
          required; everything else can be completed later, inline.
        </p>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>PO number *</span>
          <input
            className={styles.popInput}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="e.g. PO-2024-117 (your existing number)"
            autoFocus
          />
        </label>

        <div className={styles.popRow}>
          <label className={styles.field} style={{ flex: 1 }}>
            <span className={styles.fieldLabel}>Client</span>
            <select
              className={styles.popInput}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">— not linked —</option>
              {clientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field} style={{ flex: 1 }}>
            <span className={styles.fieldLabel}>Sales rep (free text)</span>
            <input
              className={styles.popInput}
              value={salesLabel}
              onChange={(e) => setSalesLabel(e.target.value)}
              placeholder="As written in Excel"
            />
          </label>
        </div>

        {!clientId && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Client name (free text, if not in the client list)
            </span>
            <input
              className={styles.popInput}
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Company name as written in Excel"
            />
          </label>
        )}

        <div className={styles.popRow}>
          <label className={styles.field} style={{ flex: 2 }}>
            <span className={styles.fieldLabel}>Order total</span>
            <input
              className={styles.popInput}
              type="number"
              min="0"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="32128"
            />
          </label>
          <label className={styles.field} style={{ flex: 1 }}>
            <span className={styles.fieldLabel}>Currency</span>
            <input
              className={styles.popInput}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            />
          </label>
          <label className={styles.field} style={{ flex: 1 }}>
            <span className={styles.fieldLabel}>Deposit %</span>
            <input
              className={styles.popInput}
              type="number"
              min="0"
              max="100"
              value={depositPct}
              onChange={(e) => setDepositPct(e.target.value)}
            />
          </label>
        </div>

        <div className={styles.popRow}>
          <label className={styles.field} style={{ flex: 1 }}>
            <span className={styles.fieldLabel}>Production status</span>
            <select
              className={styles.popInput}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {PRODUCTION_ORDER_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {PRODUCTION_ORDER_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field} style={{ flex: 1 }}>
            <span className={styles.fieldLabel}>Production due</span>
            <input
              className={styles.popInput}
              type="date"
              value={productionDue}
              onChange={(e) => setProductionDue(e.target.value)}
            />
          </label>
          <label className={styles.field} style={{ width: 90 }}>
            <span className={styles.fieldLabel}>Incoterm</span>
            <select
              className={styles.popInput}
              value={incoterm}
              onChange={(e) => setIncoterm(e.target.value)}
            >
              <option value="">—</option>
              {["EXW", "FOB", "CFR", "CIF", "DDP", "DDU"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Notes</span>
          <input
            className={styles.popInput}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth carrying over from Excel"
          />
        </label>

        <div className={styles.popActions}>
          <button type="button" className={styles.chip} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.chip} ${styles.chipActive}`}
            onClick={submit}
            disabled={pending}
          >
            {pending ? "Creating…" : "Create order"}
          </button>
        </div>
      </div>
    </div>
  );
}
