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
  fmtShortDate,
  daysBetweenISO,
  type QuickUpdateRow,
  type ColumnDef,
  type FilterContext,
  type SmartFilterId,
} from "@/lib/quick-update-columns";
import {
  PRODUCTION_ORDER_STATUSES,
  PRODUCTION_ORDER_STATUS_LABEL,
  PRODUCTION_PAYMENT_STATE_LABEL,
  reconcilePaymentTranche,
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
import { AddOrderModal } from "./AddOrderModal";
import styles from "./quick-update.module.css";

type Caps = {
  status: boolean;
  shipment: boolean;
  payments: boolean;
  deadline: boolean;
  /** May register manual (Excel-transition) orders — m155. */
  createManual: boolean;
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

// Bare amounts in cells — the column header + currency tooltip carry the
// context, so "32,128 / 32,128" reads faster than "USD 32,128 / USD 32,128".
function money(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function sVal(v: unknown): string {
  return v == null ? "" : String(v);
}
function dateShort(v: string | null): string {
  if (!v) return "";
  return v.slice(0, 10);
}

/* ---------- keyboard grid navigation (Excel-like) ----------
   Every focusable cell control carries data-qrow / data-qcol; vertical moves
   stay in the column, horizontal moves stay in the row (DOM order = visual
   order). Focus change blurs the current input, which commits it. */

function navProps(rowId: string, colKey: string) {
  return { "data-qrow": rowId, "data-qcol": colKey } as const;
}

/** Returns true when focus actually moved (false at the grid edge). */
function moveFocus(el: HTMLElement, dRow: number, dCol: number): boolean {
  const col = el.getAttribute("data-qcol");
  const rowId = el.getAttribute("data-qrow");
  if (!col || !rowId) return false;
  const list =
    dRow !== 0
      ? Array.from(
          document.querySelectorAll<HTMLElement>(
            `[data-qcol="${CSS.escape(col)}"]`
          )
        )
      : Array.from(
          document.querySelectorAll<HTMLElement>(
            `[data-qrow="${CSS.escape(rowId)}"]`
          )
        );
  const i = list.indexOf(el);
  if (i === -1) return false;
  const next = list[i + (dRow !== 0 ? dRow : dCol)];
  if (!next) return false;
  next.focus();
  if (next instanceof HTMLInputElement && next.type === "text") next.select();
  return true;
}

/** Arrow-key navigation for button cells (popover triggers). */
function triggerKeyNav(e: React.KeyboardEvent<HTMLElement>): void {
  const map: Record<string, [number, number]> = {
    ArrowDown: [1, 0],
    ArrowUp: [-1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const d = map[e.key];
  if (!d) return;
  e.preventDefault();
  moveFocus(e.currentTarget, d[0], d[1]);
}

/** DB/row property each editable text/date column maps to. */
const CELL_ROWKEY: Record<string, keyof QuickUpdateRow> = {
  incoterm: "incoterm",
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
  clientOptions,
}: {
  rows: QuickUpdateRow[];
  today: string;
  currentUserId: string | null;
  caps: Caps;
  clientOptions: { id: string; label: string }[];
}) {
  const [rows, setRows] = useState<QuickUpdateRow[]>(initialRows);
  const [, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  // server refetch after a create lands here via the page re-render
  useEffect(() => setRows(initialRows), [initialRows]);

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

  // save-status indicator: number of in-flight saves + a short "✓ Saved" flash
  const [inflight, setInflight] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);

  /* ---- persistence ----
     v2 keys: the v1 layout (pre column-reorder / Production Due rename) used
     "qu:cols"/"qu:widths" with now-renamed keys — starting fresh once is
     cheaper than migrating stale orderings everyone wants to replace. */
  useEffect(() => {
    try {
      const v = localStorage.getItem("qu2:cols");
      if (v) {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed) && parsed.length) setVisible(parsed);
      }
      const w = localStorage.getItem("qu2:widths");
      if (w) setWidths((prev) => ({ ...prev, ...JSON.parse(w) }));
    } catch {
      /* ignore corrupt storage */
    }
  }, []);
  const persistCols = (next: string[]) => {
    setVisible(next);
    try {
      localStorage.setItem("qu2:cols", JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const persistWidths = (next: Record<string, number>) => {
    setWidths(next);
    try {
      localStorage.setItem("qu2:widths", JSON.stringify(next));
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

  // Track in-flight saves so the header indicator can show
  // "Saving…" → "✓ Saved" — trust in the auto-save is the whole game.
  const saveStarted = useCallback(() => {
    window.clearTimeout(flashTimer.current);
    setSavedFlash(false);
    setInflight((n) => n + 1);
  }, []);
  const saveSettled = useCallback(() => {
    setInflight((n) => {
      const next = Math.max(0, n - 1);
      if (next === 0) {
        setSavedFlash(true);
        window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1600);
      }
      return next;
    });
  }, []);

  const commit: CommitFn = useCallback(
    ({ id, patch, prev, run, undoRun, label, touched }: CommitInput) => {
      applyPatch(id, patch);
      markRecent(id, touched);
      saveStarted();
      startTransition(async () => {
        try {
          await run();
          if (undoRun) {
            window.clearTimeout(undoTimer.current);
            const doUndo = () => {
              applyPatch(id, prev);
              markRecent(id, touched);
              setUndo(null);
              saveStarted();
              startTransition(async () => {
                try {
                  await undoRun();
                } catch (e: any) {
                  toast.error(e?.message ?? "Undo failed");
                } finally {
                  saveSettled();
                }
              });
            };
            setUndo({ label, run: doUndo });
            undoTimer.current = window.setTimeout(() => setUndo(null), 5000);
          }
        } catch (e: any) {
          applyPatch(id, prev);
          toast.error(e?.message ?? "Save failed");
        } finally {
          saveSettled();
        }
      });
    },
    [applyPatch, markRecent, saveStarted, saveSettled]
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
      // catalogue order is the display order — the workflow scan
      // (identity → production → payment → transport → docs) stays intact
      // whatever order columns were toggled in.
      QUICK_UPDATE_COLUMNS.filter((c) => visible.includes(c.key)),
    [visible]
  );

  // Sticky columns: the leading run of `sticky` columns pins to the left with
  // cumulative offsets so PO / Client / Sales / Status stay visible while the
  // transport columns scroll. `stickyLefts` maps key → left px; the last one
  // gets the edge shadow.
  const { stickyLefts, lastStickyKey } = useMemo(() => {
    const lefts: Record<string, number> = {};
    let left = 0;
    let last: string | null = null;
    for (const c of visibleCols) {
      if (!c.sticky) break;
      lefts[c.key] = left;
      left += widths[c.key] ?? c.width;
      last = c.key;
    }
    return { stickyLefts: lefts, lastStickyKey: last };
  }, [visibleCols, widths]);

  // Column-group boundaries get a slightly stronger separator to help the eye
  // jump between Production / Payment / Transport / Docs blocks.
  const groupStartKeys = useMemo(() => {
    const set = new Set<string>();
    for (let i = 1; i < visibleCols.length; i++) {
      if (visibleCols[i].group !== visibleCols[i - 1].group)
        set.add(visibleCols[i].key);
    }
    return set;
  }, [visibleCols]);

  const cellClass = (col: ColumnDef): string | undefined => {
    const cls: string[] = [];
    if (col.key in stickyLefts) cls.push(styles.stickyCol);
    if (col.key === lastStickyKey) cls.push(styles.stickyLast);
    if (groupStartKeys.has(col.key)) cls.push(styles.groupStart);
    if (col.numeric) cls.push(styles.numCol);
    return cls.length ? cls.join(" ") : undefined;
  };
  const cellStyle = (col: ColumnDef): React.CSSProperties => ({
    width: widths[col.key],
    minWidth: widths[col.key],
    maxWidth: widths[col.key],
    ...(col.key in stickyLefts ? { left: stickyLefts[col.key] } : null),
  });

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
        <div className="flex items-center gap-3">
          {/* auto-save trust indicator — always in the same spot */}
          <span
            className={`${styles.saveState} ${
              inflight > 0
                ? styles.saveStateSaving
                : savedFlash
                ? styles.saveStateSaved
                : ""
            }`}
            aria-live="polite"
          >
            {inflight > 0 ? "Saving…" : savedFlash ? "✓ Saved" : ""}
          </span>
          <div className="text-sm text-neutral-500">
            {filtered.length} / {rows.length} orders
          </div>
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
        {caps.createManual && (
          <button
            type="button"
            className={`${styles.chip} ${styles.chipActive}`}
            onClick={() => setAddOpen(true)}
            title="Register an order by hand (Excel transition) — no quotation needed"
          >
            + Add order
          </button>
        )}
      </div>

      {/* manual-order entry (m155) */}
      {addOpen && (
        <AddOrderModal
          clientOptions={clientOptions}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* table */}
      <div className={styles.wrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {visibleCols.map((col) => (
                <th
                  key={col.key}
                  className={cellClass(col)}
                  style={cellStyle(col)}
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
                    className={cellClass(col)}
                    style={cellStyle(col)}
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
              canEdit={caps.shipment}
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
          title={
            row.source === "manual"
              ? "Manual order (Excel transition) — not linked to a quotation"
              : undefined
          }
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.number}
          </span>
          {row.source === "manual" && <Pill tone="grey">M</Pill>}
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
          colKey={col.key}
          amount={row.depositReceived}
          expected={row.expectedDeposit}
          receivedAt={row.depositReceivedAt}
          canEdit={caps.payments}
          recent={recent}
          onOpen={(e) => openPop("payment", row.id, e)}
        />
      );
    case "balance":
      return (
        <PaymentTrigger
          row={row}
          colKey={col.key}
          amount={row.balanceReceived}
          expected={row.expectedBalance}
          receivedAt={row.balanceReceivedAt}
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

    case "production_due":
      return <ProductionDueCell row={row} />;
    case "production_deadline":
      return (
        <div className={styles.cell}>
          {fmtShortDate(row.initialDeadline) || "—"}
        </div>
      );
    case "factory_delay":
      return (
        <DelayTrigger
          row={row}
          colKey={col.key}
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
          row={row}
          colKey={col.key}
          value={row.externalDelayDays}
          tone={row.externalDelayDays > 0 ? "amber" : "grey"}
          canEdit={caps.deadline}
          recent={recent}
          onOpen={(e) => openPop("timeline", row.id, e)}
        />
      );

    case "incoterm":
      // Workflow orders: read-only (the quotation is the source of truth).
      // Manual orders: editable (shipping_details.incoterm).
      if (row.source === "manual") {
        return (
          <TextCell
            row={row}
            col={col}
            canEdit={caps.shipment}
            commit={commit}
            recent={recent}
          />
        );
      }
      return (
        <div
          className={styles.cell}
          title="Incoterm from the quotation — tells you whether shipping is Solux's responsibility (CIF/CFR/DDP) or the client's (EXW/FOB)"
        >
          {row.incoterm ? (
            <span style={{ fontWeight: 600 }}>{row.incoterm}</span>
          ) : (
            <span style={{ color: "#c4c7cc" }}>—</span>
          )}
        </div>
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
          onKeyDown={triggerKeyNav}
          {...navProps(row.id, col.key)}
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
          onKeyDown={triggerKeyNav}
          {...navProps(row.id, col.key)}
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

/* ---------- production due: planned vs actual dates ---------- */

function ProductionDueCell({ row }: { row: QuickUpdateRow }) {
  const planned = row.initialDeadline;
  // Actual finish once production completed; else the current expectation.
  const effective = row.actualCompletion ?? row.productionDue;
  const finished = !!row.actualCompletion;
  const delta =
    planned && effective ? daysBetweenISO(planned, effective) ?? 0 : 0;

  if (!planned && !effective) {
    return (
      <div className={styles.cell}>
        <span style={{ color: "#c4c7cc" }}>—</span>
      </div>
    );
  }

  const tip = [
    planned ? `Planned finish ${planned}` : null,
    finished
      ? `Actual finish ${row.actualCompletion}`
      : effective
      ? `Expected finish ${effective}`
      : null,
    delta !== 0 ? `${delta > 0 ? "+" : ""}${delta} days vs plan` : "on plan",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`${styles.cell} ${styles.stack}`} title={tip}>
      <span>
        {finished && <span style={{ color: "#16a34a" }}>✓ </span>}
        {fmtShortDate(effective) || "—"}
      </span>
      {planned && delta !== 0 && (
        <span className={styles.sub}>
          plan {fmtShortDate(planned)} ·{" "}
          <span style={{ color: delta > 0 ? "#b91c1c" : "#166534" }}>
            {delta > 0 ? "+" : ""}
            {delta}d
          </span>
        </span>
      )}
      {planned && delta === 0 && effective !== null && (
        <span className={styles.sub}>on plan</span>
      )}
    </div>
  );
}

/* ---------- editable cells ---------- */

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
  // Escape must revert WITHOUT saving — the blur handler still sees the edited
  // value in its closure, so it needs an explicit "cancelled" flag.
  const cancelled = useRef(false);
  useEffect(() => setVal(initial), [initial]);

  if (!canEdit) {
    return (
      <div className={styles.cell}>
        {initial || <span style={{ color: "#c4c7cc" }}>—</span>}
      </div>
    );
  }

  const save = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
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

  // Excel-like keys. Focus moves blur the input, which commits it:
  //   Enter / Shift+Enter   → save + down / up
  //   ↑ / ↓                 → save + up / down
  //   ← / → (text, at edge) → previous / next cell in the row
  //   Escape                → revert, stay put
  // Date inputs keep native ←/→ (they move between date segments).
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (e.key === "Enter") {
      e.preventDefault();
      // At the grid edge (first/last row) there is no sibling to move to —
      // Enter must still COMMIT, like Excel: blur saves in place.
      if (!moveFocus(input, e.shiftKey ? -1 : 1, 0)) input.blur();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(input, e.key === "ArrowDown" ? 1 : -1, 0);
    } else if (e.key === "ArrowLeft" && type === "text") {
      if (input.selectionStart === 0 && input.selectionEnd === 0) {
        e.preventDefault();
        moveFocus(input, 0, -1);
      }
    } else if (e.key === "ArrowRight" && type === "text") {
      const len = input.value.length;
      if (input.selectionStart === len && input.selectionEnd === len) {
        e.preventDefault();
        moveFocus(input, 0, 1);
      }
    } else if (e.key === "Escape") {
      cancelled.current = true;
      setVal(initial);
      input.blur();
    }
  };

  return (
    <input
      className={`${styles.input} ${recent ? styles.recent : ""}`}
      type={type}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={onKeyDown}
      {...navProps(row.id, col.key)}
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
      <select
        className={styles.select}
        value={row.status}
        onChange={onChange}
        {...navProps(row.id, "status")}
      >
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
  colKey,
  amount,
  expected,
  receivedAt,
  canEdit,
  recent,
  onOpen,
}: {
  row: QuickUpdateRow;
  colKey: string;
  amount: number;
  expected: number;
  receivedAt: string | null;
  canEdit: boolean;
  recent: boolean;
  onOpen: (e: React.MouseEvent) => void;
}) {
  // Dot = deposit health at a glance (green complete / amber partial /
  // rose none) — but the exact amounts always stay visible, and the
  // receipt date shows underneath (Ops + Finance need the WHEN).
  const tone =
    expected <= 0 ? "grey" : reconcilePaymentTranche(expected, amount).covered ? "green" : amount > 0 ? "amber" : "rose";
  const tip =
    `${row.currency} ${money(amount)} received / ${money(expected)} expected` +
    (receivedAt ? ` · received ${receivedAt}` : "");
  const body = (
    <div className={styles.stack} style={{ alignItems: "flex-end" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span className={styles.dot} style={{ background: DOT[tone] }} />
        <span className={styles.amount}>{money(amount)}</span>
        {expected > 0 && (
          <span className={styles.amountExpected}>/ {money(expected)}</span>
        )}
      </span>
      {receivedAt && amount > 0 && (
        <span className={styles.sub}>recd {fmtShortDate(receivedAt)}</span>
      )}
    </div>
  );
  if (!canEdit)
    return (
      <div className={styles.cell} title={tip}>
        {body}
      </div>
    );
  return (
    <button
      type="button"
      className={`${styles.trigger} ${recent ? styles.recent : ""}`}
      title={tip}
      onClick={onOpen}
      onKeyDown={triggerKeyNav}
      {...navProps(row.id, colKey)}
    >
      {body}
    </button>
  );
}

function DelayTrigger({
  row,
  colKey,
  value,
  tone,
  canEdit,
  recent,
  onOpen,
}: {
  row: QuickUpdateRow;
  colKey: string;
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
      onKeyDown={triggerKeyNav}
      {...navProps(row.id, colKey)}
    >
      {body}
    </button>
  );
}
