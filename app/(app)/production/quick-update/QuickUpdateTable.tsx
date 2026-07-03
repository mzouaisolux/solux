"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { toast } from "@/components/feedback/toast-store";
import {
  QUICK_UPDATE_COLUMNS,
  DEFAULT_VISIBLE_KEYS,
  SMART_FILTERS,
  getSmartFilter,
  matchesSearch,
  facetValues,
  type QuickUpdateRow,
  type ColumnDef,
  type FilterContext,
  type SmartFilterId,
} from "@/lib/quick-update-columns";
import {
  PRODUCTION_ORDER_STATUSES,
  PRODUCTION_ORDER_STATUS_LABEL,
  PRODUCTION_PAYMENT_STATE_LABEL,
  type ProductionOrderStatus,
} from "@/lib/types";
import { updateOrderCell } from "./actions";
import { updateProductionOrderStatus } from "@/app/(app)/production/orders/actions";
import {
  Popover,
  PaymentPopoverBody,
  BLPopoverBody,
  TimelinePopoverBody,
  DocumentsPopoverBody,
  type CommitFn,
  type CommitInput,
  type PopoverKind,
} from "./QuickUpdatePopovers";
import styles from "./quick-update.module.css";

type Caps = {
  status: boolean;
  shipment: boolean;
  payments: boolean;
  deadline: boolean;
};

/* ---------- colour tones (deterministic inline styles) ---------- */

type Tone = { bg: string; fg: string; bd: string };
const TONES: Record<string, Tone> = {
  green: { bg: "#dcfce7", fg: "#166534", bd: "#bbf7d0" },
  sky: { bg: "#e0f2fe", fg: "#075985", bd: "#bae6fd" },
  amber: { bg: "#fef9c3", fg: "#854d0e", bd: "#fde68a" },
  orange: { bg: "#ffedd5", fg: "#9a3412", bd: "#fed7aa" },
  rose: { bg: "#fee2e2", fg: "#991b1b", bd: "#fecaca" },
  grey: { bg: "#f3f4f6", fg: "#4b5563", bd: "#e5e7eb" },
  violet: { bg: "#ede9fe", fg: "#5b21b6", bd: "#ddd6fe" },
};
const DOT: Record<string, string> = {
  green: "#22c55e",
  sky: "#0ea5e9",
  amber: "#f59e0b",
  orange: "#f97316",
  rose: "#ef4444",
  grey: "#9ca3af",
  violet: "#8b5cf6",
};

const STATUS_TONE: Record<ProductionOrderStatus, string> = {
  awaiting_deposit: "amber",
  deposit_received: "sky",
  production_scheduled: "violet",
  in_production: "violet",
  production_delayed: "orange",
  production_completed: "green",
  shipment_booked: "sky",
  shipped: "green",
  delivered: "grey",
  cancelled: "rose",
};
const ALERT_TONE: Record<string, string> = {
  ok: "green",
  awaiting_deposit: "grey",
  completion_approaching: "amber",
  overdue: "rose",
  delayed: "orange",
  balance_due: "rose",
};
const PAY_TONE: Record<string, string> = {
  paid_in_full: "green",
  deposit_received: "sky",
  partial_balance: "amber",
  awaiting_deposit: "amber",
  no_deposit_required: "grey",
  no_terms: "grey",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  const t = TONES[tone] ?? TONES.grey;
  return (
    <span
      className={styles.pill}
      style={{ background: t.bg, color: t.fg, borderColor: t.bd }}
    >
      {children}
    </span>
  );
}

/* ---------- misc helpers ---------- */

function money(currency: string, n: number): string {
  return `${currency} ${Math.round(n).toLocaleString()}`;
}
function sVal(v: unknown): string {
  return v == null ? "" : String(v);
}
function dateShort(v: string | null): string {
  if (!v) return "";
  return v.slice(0, 10);
}

/** DB/row property each editable text/date column maps to. */
const CELL_ROWKEY: Record<string, keyof QuickUpdateRow> = {
  carrier: "carrier",
  booking: "bookingNumber",
  container: "containerNumber",
  tracking: "trackingUrl",
  etd: "etd",
  eta: "eta",
  notes: "notes",
};

/* ============================================================
   Main workspace
   ============================================================ */

export function QuickUpdateTable({
  rows: initialRows,
  today,
  currentUserId,
  caps,
}: {
  rows: QuickUpdateRow[];
  today: string;
  currentUserId: string | null;
  caps: Caps;
}) {
  const [rows, setRows] = useState<QuickUpdateRow[]>(initialRows);
  const [, startTransition] = useTransition();

  // toolbar state
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<Set<SmartFilterId>>(
    new Set()
  );
  const [facetCountry, setFacetCountry] = useState("");
  const [facetSales, setFacetSales] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  // column visibility + widths (persisted)
  const [visible, setVisible] = useState<string[]>(DEFAULT_VISIBLE_KEYS);
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(QUICK_UPDATE_COLUMNS.map((c) => [c.key, c.width]))
  );
  const [colsMenuOpen, setColsMenuOpen] = useState(false);

  // popover + undo + recent-flash
  const [popover, setPopover] = useState<{
    kind: PopoverKind;
    id: string;
    rect: DOMRect;
  } | null>(null);
  const [undo, setUndo] = useState<{ label: string; run: () => void } | null>(
    null
  );
  const undoTimer = useRef<number | undefined>(undefined);
  const [recent, setRecent] = useState<Set<string>>(new Set());

  /* ---- persistence ---- */
  useEffect(() => {
    try {
      const v = localStorage.getItem("qu:cols");
      if (v) {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed) && parsed.length) setVisible(parsed);
      }
      const w = localStorage.getItem("qu:widths");
      if (w) setWidths((prev) => ({ ...prev, ...JSON.parse(w) }));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);
  const persistCols = (next: string[]) => {
    setVisible(next);
    try {
      localStorage.setItem("qu:cols", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const persistWidths = (next: Record<string, number>) => {
    setWidths(next);
    try {
      localStorage.setItem("qu:widths", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  /* ---- save engine (optimistic + undo + error revert) ---- */
  const applyPatch = useCallback(
    (id: string, patch: Record<string, unknown>): void => {
      setRows((rs) =>
        rs.map((r) => (r.id === id ? ({ ...r, ...patch } as QuickUpdateRow) : r))
      );
    },
    []
  );

  const markRecent = useCallback((id: string, cols: string[]): void => {
    const keys = cols.map((c) => `${id}:${c}`);
    setRecent((prev) => {
      const n = new Set(prev);
      keys.forEach((k) => n.add(k));
      return n;
    });
    window.setTimeout(() => {
      setRecent((prev) => {
        const n = new Set(prev);
        keys.forEach((k) => n.delete(k));
        return n;
      });
    }, 2400);
  }, []);

  const commit: CommitFn = useCallback(
    ({ id, patch, prev, run, undoRun, label, touched }: CommitInput) => {
      applyPatch(id, patch);
      markRecent(id, touched);
      startTransition(async () => {
        try {
          await run();
          if (undoRun) {
            window.clearTimeout(undoTimer.current);
            const doUndo = () => {
              applyPatch(id, prev);
              markRecent(id, touched);
              setUndo(null);
              startTransition(async () => {
                try {
                  await undoRun();
                } catch (e: any) {
                  toast.error(e?.message ?? "Undo failed");
                }
              });
            };
            setUndo({ label, run: doUndo });
            undoTimer.current = window.setTimeout(() => setUndo(null), 5000);
          }
        } catch (e: any) {
          applyPatch(id, prev);
          toast.error(e?.message ?? "Save failed");
        }
      });
    },
    [applyPatch, markRecent]
  );

  /* ---- filtering ---- */
  const ctx: FilterContext = useMemo(
    () => ({ today, currentUserId }),
    [today, currentUserId]
  );
  const countries = useMemo(
    () => facetValues(rows, (r) => r.country),
    [rows]
  );
  const salesPeople = useMemo(
    () => facetValues(rows, (r) => r.salesLabel),
    [rows]
  );

  const filtered = useMemo(() => {
    const active = Array.from(activeFilters);
    return rows.filter((r) => {
      if (!showClosed && (r.status === "delivered" || r.status === "cancelled"))
        return false;
      if (!matchesSearch(r, search)) return false;
      if (facetCountry && r.country !== facetCountry) return false;
      if (facetSales && r.salesLabel !== facetSales) return false;
      for (const id of active) {
        const f = getSmartFilter(id);
        if (f && !f.test(r, ctx)) return false;
      }
      return true;
    });
  }, [rows, search, facetCountry, facetSales, activeFilters, showClosed, ctx]);

  const visibleCols = useMemo(
    () =>
      visible
        .map((k) => QUICK_UPDATE_COLUMNS.find((c) => c.key === k))
        .filter((c): c is ColumnDef => !!c),
    [visible]
  );

  /* ---- column resize ---- */
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(
    null
  );
  const onResizeStart = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { key, startX: e.clientX, startW: widths[key] ?? 140 };
    const onMove = (ev: MouseEvent) => {
      const st = resizeRef.current;
      if (!st) return;
      const w = Math.max(70, st.startW + (ev.clientX - st.startX));
      setWidths((prev) => ({ ...prev, [st.key]: w }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setWidths((prev) => {
        persistWidths(prev);
        return prev;
      });
      resizeRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const toggleFilter = (id: SmartFilterId) =>
    setActiveFilters((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const openPop = (kind: PopoverKind, id: string, e: React.MouseEvent) =>
    setPopover({ kind, id, rect: e.currentTarget.getBoundingClientRect() });

  const popRow = popover ? rows.find((r) => r.id === popover.id) ?? null : null;

  return (
    <div className="px-6 py-6" style={{ maxWidth: "100%" }}>
      {/* header */}
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Quick Update</h1>
          <p className="text-sm text-neutral-500">
            Fast inline editing across production orders — every change
            auto-saves.{" "}
            <Link href="/operations" className="underline underline-offset-2">
              Open the full order list
            </Link>
            .
          </p>
        </div>
        <div className="text-sm text-neutral-500">
          {filtered.length} / {rows.length} orders
        </div>
      </div>

      {/* toolbar */}
      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search PO, client, carrier, BL, container…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {SMART_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`${styles.chip} ${
              activeFilters.has(f.id) ? styles.chipActive : ""
            }`}
            onClick={() => toggleFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        {countries.length > 1 && (
          <select
            className={styles.chip}
            value={facetCountry}
            onChange={(e) => setFacetCountry(e.target.value)}
          >
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {salesPeople.length > 1 && (
          <select
            className={styles.chip}
            value={facetSales}
            onChange={(e) => setFacetSales(e.target.value)}
          >
            <option value="">All sales</option>
            {salesPeople.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <label className={styles.chip} style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Show closed
        </label>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className={styles.chip}
            onClick={() => setColsMenuOpen((o) => !o)}
          >
            Columns ▾
          </button>
          {colsMenuOpen && (
            <div className={styles.menu}>
              {QUICK_UPDATE_COLUMNS.map((c) => (
                <label key={c.key} className={styles.menuItem}>
                  <input
                    type="checkbox"
                    checked={visible.includes(c.key)}
                    disabled={c.key === "number"}
                    onChange={(e) => {
                      if (e.target.checked)
                        persistCols(
                          QUICK_UPDATE_COLUMNS.filter(
                            (col) =>
                              visible.includes(col.key) || col.key === c.key
                          ).map((col) => col.key)
                        );
                      else
                        persistCols(visible.filter((k) => k !== c.key));
                    }}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* table */}
      <div className={styles.wrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {visibleCols.map((col) => (
                <th
                  key={col.key}
                  className={col.sticky ? styles.stickyCol : undefined}
                  style={{
                    width: widths[col.key],
                    minWidth: widths[col.key],
                    maxWidth: widths[col.key],
                  }}
                >
                  <span className={styles.headLabel}>{col.label}</span>
                  <span
                    className={styles.resizer}
                    onMouseDown={(e) => onResizeStart(col.key, e)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className={styles.row}>
                {visibleCols.map((col) => (
                  <td
                    key={col.key}
                    className={col.sticky ? styles.stickyCol : undefined}
                    style={{
                      width: widths[col.key],
                      minWidth: widths[col.key],
                      maxWidth: widths[col.key],
                    }}
                  >
                    <CellRenderer
                      col={col}
                      row={row}
                      caps={caps}
                      commit={commit}
                      openPop={openPop}
                      recent={recent.has(`${row.id}:${col.key}`)}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={visibleCols.length}
                  style={{ padding: 24, textAlign: "center", color: "#9ca3af" }}
                >
                  No orders match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* popover host */}
      {popover && popRow && (
        <Popover anchor={popover.rect} onClose={() => setPopover(null)}>
          {popover.kind === "payment" && (
            <PaymentPopoverBody
              row={popRow}
              commit={commit}
              onClose={() => setPopover(null)}
            />
          )}
          {popover.kind === "bl" && (
            <BLPopoverBody
              row={popRow}
              commit={commit}
              canEdit={caps.shipment}
              onClose={() => setPopover(null)}
            />
          )}
          {popover.kind === "timeline" && (
            <TimelinePopoverBody
              row={popRow}
              commit={commit}
              canEdit={caps.deadline}
              onClose={() => setPopover(null)}
            />
          )}
          {popover.kind === "documents" && (
            <DocumentsPopoverBody
              row={popRow}
              onClose={() => setPopover(null)}
            />
          )}
        </Popover>
      )}

      {/* undo bar */}
      {undo && (
        <div className={styles.undoBar}>
          <span>✓ Saved · {undo.label}</span>
          <button type="button" className={styles.undoBtn} onClick={undo.run}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Cell renderer
   ============================================================ */

function CellRenderer({
  col,
  row,
  caps,
  commit,
  openPop,
  recent,
}: {
  col: ColumnDef;
  row: QuickUpdateRow;
  caps: Caps;
  commit: CommitFn;
  openPop: (kind: PopoverKind, id: string, e: React.MouseEvent) => void;
  recent: boolean;
}) {
  switch (col.key) {
    case "number":
      return (
        <Link
          href={row.detailHref}
          className={styles.cell}
          style={{ fontWeight: 600, color: "#1d4ed8" }}
        >
          {row.number}
        </Link>
      );
    case "client":
      return (
        <div className={styles.cell} title={row.clientName}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.clientName}
          </span>
          {row.clientCode && (
            <span style={{ color: "#9ca3af", fontSize: 11 }}>
              {row.clientCode}
            </span>
          )}
        </div>
      );
    case "sales":
      return <div className={styles.cell}>{row.salesLabel ?? "—"}</div>;

    case "status":
      return <StatusCell row={row} canEdit={caps.status} commit={commit} />;

    case "deposit":
      return (
        <PaymentTrigger
          row={row}
          amount={row.depositReceived}
          expected={row.expectedDeposit}
          canEdit={caps.payments}
          recent={recent}
          onOpen={(e) => openPop("payment", row.id, e)}
        />
      );
    case "balance":
      return (
        <PaymentTrigger
          row={row}
          amount={row.balanceReceived}
          expected={row.expectedBalance}
          canEdit={caps.payments}
          recent={recent}
          onOpen={(e) => openPop("payment", row.id, e)}
        />
      );
    case "payment_status":
      return (
        <div className={styles.cell}>
          <Pill tone={PAY_TONE[row.paymentState] ?? "grey"}>
            {PRODUCTION_PAYMENT_STATE_LABEL[row.paymentState]}
          </Pill>
        </div>
      );

    case "current_eta":
      return <div className={styles.cell}>{dateShort(row.currentEta) || "—"}</div>;
    case "production_deadline":
      return (
        <div className={styles.cell}>{dateShort(row.initialDeadline) || "—"}</div>
      );
    case "factory_delay":
      return (
        <DelayTrigger
          value={row.factoryDelayDays}
          tone={row.factoryDelayDays > 0 ? "rose" : "grey"}
          canEdit={caps.deadline}
          recent={recent}
          onOpen={(e) => openPop("timeline", row.id, e)}
        />
      );
    case "external_delay":
      return (
        <DelayTrigger
          value={row.externalDelayDays}
          tone={row.externalDelayDays > 0 ? "amber" : "grey"}
          canEdit={caps.deadline}
          recent={recent}
          onOpen={(e) => openPop("timeline", row.id, e)}
        />
      );

    case "carrier":
    case "booking":
    case "container":
    case "tracking":
    case "notes":
      return (
        <TextCell
          row={row}
          col={col}
          canEdit={caps.shipment}
          commit={commit}
          recent={recent}
        />
      );
    case "etd":
    case "eta":
      return (
        <TextCell
          row={row}
          col={col}
          canEdit={caps.shipment}
          commit={commit}
          recent={recent}
          type="date"
        />
      );

    case "bl":
      return (
        <button
          type="button"
          className={`${styles.trigger} ${recent ? styles.recent : ""}`}
          onClick={(e) => openPop("bl", row.id, e)}
        >
          <span
            className={styles.dot}
            style={{
              background:
                DOT[
                  row.blStatus === "complete"
                    ? "green"
                    : row.blStatus === "partial"
                    ? "amber"
                    : "rose"
                ],
            }}
          />
          {row.blNumber ?? (
            <span style={{ color: "#9ca3af" }}>
              {row.blStatus === "missing" ? "BL missing" : "Add BL"}
            </span>
          )}
        </button>
      );

    case "documents":
      return (
        <button
          type="button"
          className={styles.trigger}
          onClick={(e) => openPop("documents", row.id, e)}
        >
          <Pill
            tone={
              row.docsTotal === 0
                ? "grey"
                : row.docsReady === row.docsTotal
                ? "green"
                : "amber"
            }
          >
            {row.docsReady}/{row.docsTotal} docs
          </Pill>
        </button>
      );

    case "alert":
      return (
        <div className={styles.cell}>
          <Pill tone={ALERT_TONE[row.alertLevel] ?? "grey"}>
            {row.alertLabel}
          </Pill>
        </div>
      );
    case "updated":
      return (
        <div className={styles.cell} style={{ color: "#9ca3af", fontSize: 12 }}>
          {dateShort(row.updatedAt) || "—"}
        </div>
      );
    default:
      return <div className={styles.cell}>—</div>;
  }
}

/* ---------- editable cells ---------- */

function focusSibling(el: HTMLElement, dir: number) {
  const col = el.getAttribute("data-qcol");
  if (!col) return;
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-qcol="${col}"]`)
  );
  const i = all.indexOf(el);
  const next = all[i + dir];
  if (next) next.focus();
}

function TextCell({
  row,
  col,
  canEdit,
  commit,
  recent,
  type = "text",
}: {
  row: QuickUpdateRow;
  col: ColumnDef;
  canEdit: boolean;
  commit: CommitFn;
  recent: boolean;
  type?: "text" | "date";
}) {
  const rowKey = CELL_ROWKEY[col.key];
  const field = col.field!;
  const initial = sVal(row[rowKey]);
  const [val, setVal] = useState(initial);
  useEffect(() => setVal(initial), [initial]);

  if (!canEdit) {
    return (
      <div className={styles.cell}>
        {initial || <span style={{ color: "#c4c7cc" }}>—</span>}
      </div>
    );
  }

  const save = () => {
    const next = val.trim();
    if (next === sVal(row[rowKey])) return; // no-op
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("field", field);
    fd.set("value", next);
    const prevFd = new FormData();
    prevFd.set("id", row.id);
    prevFd.set("field", field);
    prevFd.set("value", initial);
    commit({
      id: row.id,
      patch: { [rowKey]: next || null },
      prev: { [rowKey]: row[rowKey] },
      run: () => updateOrderCell(fd),
      undoRun: () => updateOrderCell(prevFd),
      label: `${col.label} · ${row.number}`,
      touched: [col.key],
    });
  };

  return (
    <input
      className={`${styles.input} ${recent ? styles.recent : ""}`}
      type={type}
      value={val}
      data-qcol={col.key}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          focusSibling(e.currentTarget, 1); // commits current (blur) + moves down
        } else if (e.key === "Escape") {
          setVal(initial);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function StatusCell({
  row,
  canEdit,
  commit,
}: {
  row: QuickUpdateRow;
  canEdit: boolean;
  commit: CommitFn;
}) {
  if (!canEdit) {
    return (
      <div className={styles.cell}>
        <Pill tone={STATUS_TONE[row.status]}>
          {PRODUCTION_ORDER_STATUS_LABEL[row.status]}
        </Pill>
      </div>
    );
  }
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as ProductionOrderStatus;
    if (next === row.status) return;
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("status", next);
    const prevFd = new FormData();
    prevFd.set("id", row.id);
    prevFd.set("status", row.status);
    commit({
      id: row.id,
      patch: { status: next },
      prev: { status: row.status },
      run: () => updateProductionOrderStatus(fd),
      undoRun: () => updateProductionOrderStatus(prevFd),
      label: `Status · ${row.number}`,
      touched: ["status"],
    });
  };
  return (
    <div style={{ display: "flex", alignItems: "center", height: "100%" }}>
      <span
        className={styles.dot}
        style={{ background: DOT[STATUS_TONE[row.status]], marginLeft: 10 }}
      />
      <select className={styles.select} value={row.status} onChange={onChange}>
        {PRODUCTION_ORDER_STATUSES.map((st) => (
          <option key={st} value={st}>
            {PRODUCTION_ORDER_STATUS_LABEL[st]}
          </option>
        ))}
      </select>
    </div>
  );
}

function PaymentTrigger({
  row,
  amount,
  expected,
  canEdit,
  recent,
  onOpen,
}: {
  row: QuickUpdateRow;
  amount: number;
  expected: number;
  canEdit: boolean;
  recent: boolean;
  onOpen: (e: React.MouseEvent) => void;
}) {
  const tone =
    expected <= 0 ? "grey" : amount + 0.01 >= expected ? "green" : amount > 0 ? "amber" : "rose";
  const body = (
    <>
      <span className={styles.dot} style={{ background: DOT[tone] }} />
      <span>{money(row.currency, amount)}</span>
      {expected > 0 && (
        <span style={{ color: "#9ca3af", fontSize: 11 }}>
          / {money(row.currency, expected)}
        </span>
      )}
    </>
  );
  if (!canEdit) return <div className={styles.cell}>{body}</div>;
  return (
    <button
      type="button"
      className={`${styles.trigger} ${recent ? styles.recent : ""}`}
      onClick={onOpen}
    >
      {body}
    </button>
  );
}

function DelayTrigger({
  value,
  tone,
  canEdit,
  recent,
  onOpen,
}: {
  value: number;
  tone: string;
  canEdit: boolean;
  recent: boolean;
  onOpen: (e: React.MouseEvent) => void;
}) {
  const label = value === 0 ? "—" : `${value > 0 ? "+" : ""}${value}d`;
  const body =
    value === 0 ? (
      <span style={{ color: "#c4c7cc" }}>—</span>
    ) : (
      <Pill tone={tone}>{label}</Pill>
    );
  if (!canEdit) return <div className={styles.cell}>{body}</div>;
  return (
    <button
      type="button"
      className={`${styles.trigger} ${recent ? styles.recent : ""}`}
      onClick={onOpen}
    >
      {body}
    </button>
  );
}
