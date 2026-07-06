"use client";

/**
 * Factory Mapping — the bulk-editing grid (client).
 *
 * A true spreadsheet, not a form (owner spec): every Factory-instruction and
 * Code cell is edited directly inline; changes stay LOCAL until one global
 * "Save mappings" click (mirrors /cost-entry's CostGrid). Built for a TLM
 * configuring 100+ mappings in minutes:
 *
 *   - Excel-style clipboard: multi-line/tab paste fans DOWN from the focused
 *     cell over the visible rows; Shift+Arrow / Shift+Click selects a cell
 *     range whose values Ctrl+C copies back as lines (plus per-column ⧉).
 *   - Keyboard-first: Tab/Shift+Tab (native), Enter/↓/↑ move rows,
 *     Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo/redo whole batches.
 *   - Instant search across family / attribute / option / instruction, a
 *     "Show only missing" filter, and live Total/Mapped/Missing counters
 *     computed from the WORKING state.
 *   - "Copy mappings between families" now applies LOCALLY (pure clone plan,
 *     lib/factory-mapping-clone.ts) so copied values are reviewable/editable
 *     before Save; their notes/active ride along via copiedExtras.
 *
 * All grid math (paste fan-out, counters, save payload) lives in the pure,
 * unit-tested lib/factory-mapping-grid.ts.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkSaveFactoryMappings } from "./actions";
import {
  GRID_COLS,
  parseClipboardGrid,
  isMultiCellPaste,
  buildPastePatches,
  computeCounters,
  buildBulkSavePayload,
  isRowDirty,
  type MappingGridRow,
  type WorkingCell,
  type CellPatch,
  type GridCol,
} from "@/lib/factory-mapping-grid";
import { buildFactoryMappingClonePlan } from "@/lib/factory-mapping-clone";

type Props = {
  rows: MappingGridRow[];
  categories: Array<{ id: string; name: string }>;
};

const ALL = "__all__";

export default function MappingGrid({ rows, categories }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // ---- working state --------------------------------------------------------
  const [draft, setDraft] = useState<Record<string, WorkingCell>>({});
  const [copiedExtras, setCopiedExtras] = useState<
    Record<string, { notes: string | null; active: boolean }>
  >({});
  const [undoStack, setUndoStack] = useState<CellPatch[][]>([]);
  const [redoStack, setRedoStack] = useState<CellPatch[][]>([]);
  const typingKeyRef = useRef<string | null>(null);

  // ---- toolbar state ---------------------------------------------------------
  const [q, setQ] = useState("");
  const [familyId, setFamilyId] = useState(ALL);
  const [missingOnly, setMissingOnly] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ---- copy-between-families -------------------------------------------------
  const [srcCat, setSrcCat] = useState("");
  const [tgtCat, setTgtCat] = useState("");
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const rowById = useMemo(() => {
    const m = new Map<string, MappingGridRow>();
    for (const r of rows) m.set(r.optionId, r);
    return m;
  }, [rows]);

  function workingCell(optionId: string, d: Record<string, WorkingCell> = draft): WorkingCell {
    const w = d[optionId];
    if (w) return w;
    const r = rowById.get(optionId);
    return { ins: r?.instruction ?? "", code: r?.code ?? "" };
  }
  function workingVal(optionId: string, col: GridCol): string {
    const w = workingCell(optionId);
    return col === "instruction" ? w.ins : w.code;
  }

  // ---- edits + undo/redo ------------------------------------------------------
  function applyValues(patches: CellPatch[], dir: "next" | "prev") {
    setDraft((d) => {
      const nd = { ...d };
      for (const p of patches) {
        const cur = workingCell(p.optionId, nd);
        nd[p.optionId] = {
          ...cur,
          [p.col === "instruction" ? "ins" : "code"]:
            dir === "next" ? p.next : p.prev,
        };
      }
      return nd;
    });
  }

  /** Push one undoable batch (paste / copy-between-families / redo). */
  function pushBatch(patches: CellPatch[]) {
    if (!patches.length) return;
    typingKeyRef.current = null;
    setUndoStack((s) => [...s, patches]);
    setRedoStack([]);
    applyValues(patches, "next");
  }

  /** Single-cell typing — consecutive keystrokes on the same cell coalesce
   *  into ONE undo batch so Ctrl+Z undoes the edit, not one character. */
  function editCell(optionId: string, col: GridCol, next: string) {
    const key = `${optionId}:${col}`;
    const prev = workingVal(optionId, col);
    if (prev === next) return;
    if (typingKeyRef.current === key) {
      setUndoStack((s) => {
        const top = s[s.length - 1];
        if (
          top &&
          top.length === 1 &&
          top[0].optionId === optionId &&
          top[0].col === col
        ) {
          return [...s.slice(0, -1), [{ ...top[0], next }]];
        }
        return [...s, [{ optionId, col, prev, next }]];
      });
    } else {
      typingKeyRef.current = key;
      setUndoStack((s) => [...s, [{ optionId, col, prev, next }]]);
    }
    setRedoStack([]);
    setDraft((d) => ({
      ...d,
      [optionId]: {
        ...workingCell(optionId, d),
        [col === "instruction" ? "ins" : "code"]: next,
      },
    }));
  }

  function undo() {
    if (!undoStack.length) return;
    const top = undoStack[undoStack.length - 1];
    typingKeyRef.current = null;
    applyValues(top, "prev");
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack([...redoStack, top]);
  }
  function redo() {
    if (!redoStack.length) return;
    const top = redoStack[redoStack.length - 1];
    typingKeyRef.current = null;
    applyValues(top, "next");
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack([...undoStack, top]);
  }

  // ---- filtering ---------------------------------------------------------------
  const visibleRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (familyId !== ALL && r.categoryId !== familyId) return false;
      const w = workingCell(r.optionId);
      if (missingOnly && w.ins.trim() !== "") return false;
      if (!needle) return true;
      return (
        r.categoryName.toLowerCase().includes(needle) ||
        r.fieldName.toLowerCase().includes(needle) ||
        r.optionValue.toLowerCase().includes(needle) ||
        w.ins.toLowerCase().includes(needle) ||
        w.code.toLowerCase().includes(needle)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, draft, q, familyId, missingOnly]);

  // Group markers for rendering: family row → field row → option rows.
  const renderList = useMemo(() => {
    const out: Array<
      | { t: "cat"; key: string; name: string }
      | { t: "field"; key: string; name: string; scope: string; count: number }
      | { t: "row"; key: string; row: MappingGridRow; visIdx: number }
    > = [];
    const fieldCounts = new Map<string, number>();
    for (const r of visibleRows) {
      fieldCounts.set(r.fieldId, (fieldCounts.get(r.fieldId) ?? 0) + 1);
    }
    let lastCat = "";
    let lastField = "";
    let visIdx = 0;
    for (const r of visibleRows) {
      if (r.categoryId !== lastCat) {
        lastCat = r.categoryId;
        lastField = "";
        out.push({ t: "cat", key: `c:${r.categoryId}`, name: r.categoryName });
      }
      if (r.fieldId !== lastField) {
        lastField = r.fieldId;
        out.push({
          t: "field",
          key: `f:${r.fieldId}`,
          name: r.fieldName,
          scope: r.fieldScope,
          count: fieldCounts.get(r.fieldId) ?? 0,
        });
      }
      out.push({ t: "row", key: r.optionId, row: r, visIdx: visIdx++ });
    }
    return out;
  }, [visibleRows]);

  // ---- counters + save payload (live) -------------------------------------------
  const counters = useMemo(
    () => computeCounters(rows, (id) => workingCell(id).ins),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, draft]
  );
  const payload = useMemo(
    () =>
      buildBulkSavePayload({
        rows,
        working: (id) => workingCell(id),
        copiedExtras,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, draft, copiedExtras]
  );
  const dirtyCount = payload.upserts.length + payload.deletes.length;

  // Warn before leaving with unsaved edits (a 100-cell paste is real work).
  useEffect(() => {
    if (dirtyCount === 0) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirtyCount === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- selection (for Ctrl+C back to Excel) ----------------------------------------
  const [sel, setSel] = useState<{ col: GridCol; a: number; b: number } | null>(
    null
  );
  const focusedRef = useRef<{ visIdx: number; col: GridCol } | null>(null);
  useEffect(() => setSel(null), [q, familyId, missingOnly]);

  function selectionText(): string | null {
    if (!sel) return null;
    const lo = Math.min(sel.a, sel.b);
    const hi = Math.max(sel.a, sel.b);
    return visibleRows
      .slice(lo, hi + 1)
      .map((r) => workingVal(r.optionId, sel.col))
      .join("\n");
  }

  async function copyColumn(col: GridCol) {
    const text = visibleRows.map((r) => workingVal(r.optionId, col)).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`Copied ${visibleRows.length} ${col} value(s).`);
      setErr(null);
    } catch {
      setErr("Clipboard copy failed.");
    }
  }

  // ---- keyboard --------------------------------------------------------------------
  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});
  function focusCell(visIdx: number, col: GridCol) {
    const el = cellRefs.current[`${visIdx}:${col}`];
    if (el) {
      el.focus();
      el.select();
    }
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (k === "y" || (k === "z" && e.shiftKey)) {
      e.preventDefault();
      redo();
    } else if (k === "c" && sel && sel.a !== sel.b) {
      // Multi-cell selection → copy the range; single cell keeps native copy.
      e.preventDefault();
      const text = selectionText();
      if (text != null) {
        navigator.clipboard.writeText(text).then(
          () => {
            setMsg(
              `Copied ${Math.abs(sel.b - sel.a) + 1} cell(s) — paste into Excel.`
            );
            setErr(null);
          },
          () => setErr("Clipboard copy failed.")
        );
      }
    }
  }

  function onCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    visIdx: number,
    col: GridCol
  ) {
    if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setSel((s) => {
        const a = s && s.col === col ? s.a : visIdx;
        const b = Math.max(
          0,
          Math.min(visibleRows.length - 1, (s && s.col === col ? s.b : visIdx) + dir)
        );
        return { col, a, b };
      });
      return;
    }
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(visIdx + 1, col);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(visIdx - 1, col);
    } else if (e.key === "Escape") {
      setSel(null);
    }
  }

  function onCellPaste(
    e: React.ClipboardEvent<HTMLInputElement>,
    visIdx: number,
    col: GridCol
  ) {
    const text = e.clipboardData.getData("text");
    if (!isMultiCellPaste(text)) return; // single value → native paste
    e.preventDefault();
    const patches = buildPastePatches({
      grid: parseClipboardGrid(text),
      visible: visibleRows.map((r) => ({ optionId: r.optionId })),
      startIndex: visIdx,
      startCol: col,
      current: (id, c) => workingVal(id, c),
    });
    pushBatch(patches);
    setMsg(`Pasted ${patches.length} cell(s).`);
    setErr(null);
  }

  // ---- copy between families (LOCAL apply — review before save) ----------------------
  function applyFamilyCopy() {
    setCopyMsg(null);
    if (!srcCat || !tgtCat || srcCat === tgtCat) return;
    const sourceMappedOptions = rows
      .filter(
        (r) =>
          r.categoryId === srcCat &&
          workingVal(r.optionId, "instruction").trim() !== ""
      )
      .map((r) => ({
        field_name: r.fieldName,
        option_value: r.optionValue,
        factory_instruction: workingVal(r.optionId, "instruction").trim(),
        factory_code: workingVal(r.optionId, "code").trim() || null,
        notes: r.notes,
        active: r.active,
      }));
    const targetOptions = rows
      .filter((r) => r.categoryId === tgtCat)
      .map((r) => ({
        field_id: r.fieldId,
        option_id: r.optionId,
        field_name: r.fieldName,
        option_value: r.optionValue,
      }));
    const plan = buildFactoryMappingClonePlan({
      sourceMappedOptions,
      targetOptions,
    });
    const patches: CellPatch[] = [];
    const extras = { ...copiedExtras };
    for (const p of plan.rows) {
      const curIns = workingVal(p.option_id, "instruction");
      const curCode = workingVal(p.option_id, "code");
      const nextIns = p.factory_instruction;
      const nextCode = p.factory_code ?? "";
      if (curIns !== nextIns)
        patches.push({ optionId: p.option_id, col: "instruction", prev: curIns, next: nextIns });
      if (curCode !== nextCode)
        patches.push({ optionId: p.option_id, col: "code", prev: curCode, next: nextCode });
      extras[p.option_id] = { notes: p.notes, active: p.active };
    }
    pushBatch(patches);
    setCopiedExtras(extras);
    setCopyMsg(
      `Applied ${plan.copied} mapping(s) from source (${plan.skipped} target option(s) had no match). Review the cells, then Save mappings.`
    );
  }

  // ---- save -----------------------------------------------------------------------
  function onSave() {
    setMsg(null);
    setErr(null);
    if (dirtyCount === 0) {
      setMsg("Nothing changed to save.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await bulkSaveFactoryMappings(payload);
        setMsg(
          `Saved ${res.saved} mapping(s)${
            res.deleted ? `, removed ${res.deleted}` : ""
          }.`
        );
        setCopiedExtras({});
        typingKeyRef.current = null;
        router.refresh();
      } catch (e: any) {
        setErr(e?.message ?? "Save failed.");
      }
    });
  }

  const catName = (id: string) =>
    categories.find((c) => c.id === id)?.name ?? id;

  // ---- render -----------------------------------------------------------------------
  return (
    <div onKeyDown={onGridKeyDown}>
      {/* Live coverage counters (working state, no refresh needed) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="panel p-4">
          <div className="eyebrow">Dropdown options</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">
            {counters.total}
          </div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow">Mapped</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums text-emerald-700">
            {counters.mapped}
          </div>
        </div>
        <div className="panel p-4">
          <div className="eyebrow">Missing</div>
          <div
            className={`text-2xl font-semibold mt-1 tabular-nums ${
              counters.missing > 0 ? "text-amber-700" : "text-neutral-500"
            }`}
          >
            {counters.missing}
          </div>
        </div>
      </div>

      {/* Copy mappings between families — applies to the GRID (unsaved). */}
      {categories.length >= 2 && (
        <div className="panel p-4 mt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="ce-tb-field">
              <span className="ce-tbl">Copy mappings — from (source)</span>
              <select
                className="select"
                value={srcCat}
                onChange={(e) => setSrcCat(e.target.value)}
              >
                <option value="">Select family…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="ce-tb-field">
              <span className="ce-tbl">To (target)</span>
              <select
                className="select"
                value={tgtCat}
                onChange={(e) => setTgtCat(e.target.value)}
              >
                <option value="">Select family…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-secondary"
              disabled={!srcCat || !tgtCat || srcCat === tgtCat}
              onClick={applyFamilyCopy}
              title="Fill the target family's cells from the source (matched by field + option value). Nothing is saved until you press Save mappings."
            >
              Apply to grid
            </button>
            {copyMsg && (
              <span className="text-xs text-neutral-600">{copyMsg}</span>
            )}
          </div>
        </div>
      )}

      {/* Toolbar + grid */}
      <div className="panel p-4 mt-4">
        <div className="ce-toolbar">
          <div className="ce-tb-field">
            <span className="ce-tbl">Search</span>
            <input
              className="ce-tb-search input"
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="family / attribute / option / instruction…"
            />
          </div>
          <div className="ce-tb-field">
            <span className="ce-tbl">Family</span>
            <select
              className="select"
              value={familyId}
              onChange={(e) => setFamilyId(e.target.value)}
            >
              <option value={ALL}>All families</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <label className="ce-tb-field cursor-pointer select-none">
            <span className="ce-tbl">Filter</span>
            <span className="inline-flex items-center gap-2 text-sm py-2">
              <input
                type="checkbox"
                checked={missingOnly}
                onChange={(e) => setMissingOnly(e.target.checked)}
              />
              Show only missing mappings
            </span>
          </label>
          <div className="ce-tb-right">
            {dirtyCount > 0 && (
              <span className="ce-unsaved-pill">{dirtyCount} unsaved</span>
            )}
            {msg && !err && (
              <span className="ce-saved-msg">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {msg}
              </span>
            )}
            {err && <span className="ce-err-msg">{err}</span>}
            <button
              type="button"
              className="btn-primary"
              onClick={onSave}
              disabled={pending || dirtyCount === 0}
            >
              {pending ? "Saving…" : "Save mappings"}
            </button>
          </div>
        </div>

        <div className="fm-wrap ce-grid-wrap" style={{ marginTop: 16 }}>
          <table className="ce-cost fm-table">
            <thead>
              <tr>
                <th style={{ width: "26%" }}>Sales option</th>
                <th>
                  Factory instruction{" "}
                  <button
                    type="button"
                    className="fm-copybtn"
                    onClick={() => copyColumn("instruction")}
                    title="Copy this column (visible rows) to the clipboard"
                  >
                    ⧉
                  </button>
                </th>
                <th style={{ width: 150 }}>
                  Code{" "}
                  <button
                    type="button"
                    className="fm-copybtn"
                    onClick={() => copyColumn("code")}
                    title="Copy this column (visible rows) to the clipboard"
                  >
                    ⧉
                  </button>
                </th>
                <th style={{ width: 90 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {renderList.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-neutral-500">
                    {rows.length === 0
                      ? "No dropdown options to map yet."
                      : "No rows match the current search/filter."}
                  </td>
                </tr>
              )}
              {renderList.map((item) => {
                if (item.t === "cat") {
                  return (
                    <tr key={item.key} className="fm-cat">
                      <td colSpan={4}>{item.name}</td>
                    </tr>
                  );
                }
                if (item.t === "field") {
                  return (
                    <tr key={item.key} className="fm-field">
                      <td colSpan={4}>
                        {item.name}
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            item.scope === "technical"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-sky-100 text-sky-900"
                          }`}
                        >
                          {item.scope === "technical" ? "Technical" : "Sales"}
                        </span>
                        <span className="ml-2 text-[11px] font-normal text-neutral-500 tabular-nums">
                          {item.count} option{item.count === 1 ? "" : "s"}
                        </span>
                      </td>
                    </tr>
                  );
                }
                const { row, visIdx } = item;
                const w = workingCell(row.optionId);
                const dirty = isRowDirty(row, w);
                const missing = w.ins.trim() === "";
                const inSel = (col: GridCol) =>
                  sel &&
                  sel.col === col &&
                  visIdx >= Math.min(sel.a, sel.b) &&
                  visIdx <= Math.max(sel.a, sel.b);
                return (
                  <tr key={item.key} className={dirty ? "dirty" : ""}>
                    <td className="fm-opt">{row.optionValue}</td>
                    <td
                      className={`fm-cell ${inSel("instruction") ? "fm-sel" : ""}`}
                    >
                      <input
                        ref={(el) => {
                          cellRefs.current[`${visIdx}:instruction`] = el;
                        }}
                        className={`fm-input${dirty ? " dirty" : ""}`}
                        value={w.ins}
                        onChange={(e) =>
                          editCell(row.optionId, "instruction", e.target.value)
                        }
                        onKeyDown={(e) => onCellKeyDown(e, visIdx, "instruction")}
                        onPaste={(e) => onCellPaste(e, visIdx, "instruction")}
                        onFocus={(e) => {
                          focusedRef.current = { visIdx, col: "instruction" };
                          e.target.select();
                        }}
                        onMouseDown={(e) => {
                          if (e.shiftKey) {
                            e.preventDefault();
                            setSel((s) => ({
                              col: "instruction",
                              a:
                                s && s.col === "instruction"
                                  ? s.a
                                  : focusedRef.current?.visIdx ?? visIdx,
                              b: visIdx,
                            }));
                          } else {
                            setSel(null);
                          }
                        }}
                        onBlur={() => {
                          typingKeyRef.current = null;
                        }}
                        placeholder="Factory instruction…"
                        spellCheck={false}
                      />
                    </td>
                    <td className={`fm-cell ${inSel("code") ? "fm-sel" : ""}`}>
                      <input
                        ref={(el) => {
                          cellRefs.current[`${visIdx}:code`] = el;
                        }}
                        className={`fm-input fm-code${dirty ? " dirty" : ""}`}
                        value={w.code}
                        onChange={(e) =>
                          editCell(row.optionId, "code", e.target.value)
                        }
                        onKeyDown={(e) => onCellKeyDown(e, visIdx, "code")}
                        onPaste={(e) => onCellPaste(e, visIdx, "code")}
                        onFocus={(e) => {
                          focusedRef.current = { visIdx, col: "code" };
                          e.target.select();
                        }}
                        onMouseDown={(e) => {
                          if (e.shiftKey) {
                            e.preventDefault();
                            setSel((s) => ({
                              col: "code",
                              a:
                                s && s.col === "code"
                                  ? s.a
                                  : focusedRef.current?.visIdx ?? visIdx,
                              b: visIdx,
                            }));
                          } else {
                            setSel(null);
                          }
                        }}
                        onBlur={() => {
                          typingKeyRef.current = null;
                        }}
                        placeholder="Code"
                        spellCheck={false}
                      />
                    </td>
                    <td>
                      {missing ? (
                        <span className="fm-missing-pill">Missing</span>
                      ) : dirty ? (
                        <span className="fm-dirty-note">edited</span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-2 text-[11px] text-neutral-400">
          Paste a column from Excel into any cell (Ctrl+V) to fill down ·
          Shift+↓/↑ or Shift+Click to select cells, Ctrl+C to copy them back ·
          Enter moves down · Ctrl+Z / Ctrl+Y undo/redo · Nothing is saved until
          “Save mappings”.
        </p>
      </div>
    </div>
  );
}
