/**
 * Factory Mapping — bulk-edit grid logic (pure).
 *
 * PURE module (no DB / no React) so the spreadsheet behaviors that carry the
 * business risk — Excel clipboard parsing, paste-down fan-out, and the
 * save/delete payload derivation — are unit-testable end-to-end.
 *
 * Model: one grid row per dropdown option (the factory_mappings conflict key
 * is UNIQUE(option_id)). The instruction is the mapping's required payload —
 * a row whose working instruction is blank has NO mapping, so clearing a
 * previously-mapped cell means DELETE, never an upsert of "".
 */

export type GridCol = "instruction" | "code";

/** Column order in the grid — drives how multi-column pastes spill over. */
export const GRID_COLS: readonly GridCol[] = ["instruction", "code"] as const;

/** One option row as served to the grid (saved state = the baseline). */
export type MappingGridRow = {
  categoryId: string;
  categoryName: string;
  fieldId: string;
  fieldName: string;
  fieldScope: string;
  optionId: string;
  optionValue: string;
  /** Saved factory instruction ("" when unmapped). */
  instruction: string;
  /** Saved factory code ("" when none). */
  code: string;
  hasMapping: boolean;
  /** Saved admin fields — preserved by bulk save, editable only via copy. */
  notes: string | null;
  active: boolean;
};

/** The working (unsaved) value of one row's editable cells. */
export type WorkingCell = { ins: string; code: string };

/** A reversible single-cell edit — the unit of the undo/redo stacks. */
export type CellPatch = {
  optionId: string;
  col: GridCol;
  prev: string;
  next: string;
};

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/**
 * Parse clipboard text into a rows×cols grid (Excel/Sheets emit TSV).
 * Interior empty lines are KEPT (pasting a column with blanks clears those
 * cells); only the trailing newline Excel always appends is dropped.
 */
export function parseClipboardGrid(text: string): string[][] {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.map((l) => l.split("\t"));
}

/** True when the clipboard payload spans multiple cells (fan-out paste). */
export function isMultiCellPaste(text: string): boolean {
  const t = String(text ?? "");
  return t.includes("\n") || t.includes("\t");
}

/**
 * Fan a parsed clipboard grid DOWN from (startIndex, startCol) over the
 * currently visible rows — Google-Sheets semantics. Extra clipboard columns
 * spill into the next grid column(s); anything beyond the last column (or the
 * last visible row) is ignored. Values are trimmed. No-op cells produce no
 * patch so undo stays exact.
 */
export function buildPastePatches(args: {
  grid: string[][];
  visible: Array<{ optionId: string }>;
  startIndex: number;
  startCol: GridCol;
  current: (optionId: string, col: GridCol) => string;
}): CellPatch[] {
  const { grid, visible, startIndex, startCol, current } = args;
  const startColIdx = GRID_COLS.indexOf(startCol);
  if (startColIdx < 0) return [];
  const patches: CellPatch[] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = visible[startIndex + r];
    if (!row) break;
    const cells = grid[r];
    for (let c = 0; c < cells.length; c++) {
      const col = GRID_COLS[startColIdx + c];
      if (!col) break; // clipboard wider than the grid — ignore overflow
      const next = String(cells[c] ?? "").trim();
      const prev = current(row.optionId, col);
      if (next === prev) continue;
      patches.push({ optionId: row.optionId, col, prev, next });
    }
  }
  return patches;
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

export type GridCounters = { total: number; mapped: number; missing: number };

/** Live coverage counters over the WORKING state (saved + unsaved edits). */
export function computeCounters(
  rows: MappingGridRow[],
  workingInstruction: (optionId: string) => string
): GridCounters {
  let mapped = 0;
  for (const r of rows) {
    if (workingInstruction(r.optionId).trim() !== "") mapped++;
  }
  return { total: rows.length, mapped, missing: rows.length - mapped };
}

// ---------------------------------------------------------------------------
// Save payload
// ---------------------------------------------------------------------------

/** One upsert entry. notes/active are ONLY set for copy-applied rows — the
 *  server preserves the existing values otherwise. */
export type BulkUpsertEntry = {
  field_id: string;
  option_id: string;
  factory_instruction: string;
  factory_code: string | null;
  notes?: string | null;
  active?: boolean;
};

export type BulkSavePayload = {
  upserts: BulkUpsertEntry[];
  /** option_ids whose mapping must be removed (instruction cleared). */
  deletes: string[];
};

/** Did this row's working cells diverge from the saved baseline? */
export function isRowDirty(row: MappingGridRow, w: WorkingCell): boolean {
  return (
    w.ins.trim() !== row.instruction.trim() ||
    w.code.trim() !== row.code.trim()
  );
}

/**
 * Derive the one-shot save payload from the working state.
 *   - blank instruction + saved mapping  → DELETE (instruction is NOT NULL)
 *   - blank instruction + no mapping     → nothing
 *   - non-blank + changed (ins or code)  → UPSERT (conflict key option_id)
 *   - copiedExtras[optionId]             → carry notes/active from the clone
 */
export function buildBulkSavePayload(args: {
  rows: MappingGridRow[];
  working: (optionId: string) => WorkingCell;
  copiedExtras?: Record<string, { notes: string | null; active: boolean }>;
}): BulkSavePayload {
  const { rows, working, copiedExtras } = args;
  const upserts: BulkUpsertEntry[] = [];
  const deletes: string[] = [];
  for (const row of rows) {
    const w = working(row.optionId);
    const ins = w.ins.trim();
    const code = w.code.trim();
    if (ins === "") {
      if (row.hasMapping) deletes.push(row.optionId);
      continue;
    }
    if (!isRowDirty(row, w)) continue;
    const entry: BulkUpsertEntry = {
      field_id: row.fieldId,
      option_id: row.optionId,
      factory_instruction: ins,
      factory_code: code === "" ? null : code,
    };
    const extra = copiedExtras?.[row.optionId];
    if (extra) {
      entry.notes = extra.notes;
      entry.active = extra.active;
    }
    upserts.push(entry);
  }
  return { upserts, deletes };
}
