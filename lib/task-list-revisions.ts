/**
 * Final Validation revisions (m179) — pure types + rev labels + diff.
 *
 * Final Validation (status `validated`) FREEZES the task list (owner
 * decision 2026-07-21, hard freeze): the validated content becomes an
 * immutable snapshot — Rev A, Rev B, … — and any later change goes through a
 * CONTROLLED REVISION: reason required, author + timestamp recorded, the
 * file re-runs the full Pre-Validation → Final Validation cycle, and the new
 * revision is diffed field-by-field against the previous validated one.
 * Previous validated revisions remain accessible forever.
 *
 * This module is the PURE half: revision labels, the snapshot shape, and the
 * field-level diff. The server half (lib/task-list-revisions-server.ts)
 * builds snapshots from the database and records them.
 *
 * Client + server safe (no DB access).
 */

/** The frozen statuses — content is immutable here (DB triggers enforce it). */
export const TASK_LIST_FROZEN_STATUSES = ["validated", "production_ready"] as const;

export function isFrozenStatus(s: string | null | undefined): boolean {
  return s === "validated" || s === "production_ready";
}

/** Everything Final Validation freezes, as raw rows. */
export type TaskListSnapshot = {
  /** production_task_lists row (workflow columns included; diff excludes them). */
  task: Record<string, unknown>;
  /** production_task_list_lines rows, stable order. */
  lines: Record<string, unknown>[];
  /** product_lighting_setups row for the command, when present. */
  lighting: Record<string, unknown> | null;
  /** Attachment METADATA (files themselves live in Storage, untouched). */
  attachments: Record<string, unknown>[];
};

export type TaskListRevisionStatus = "in_progress" | "validated" | "superseded";

export type TaskListRevision = {
  id: string;
  task_list_id: string;
  rev: string;
  status: TaskListRevisionStatus;
  reason: string | null;
  snapshot: TaskListSnapshot | null;
  created_by: string | null;
  created_by_label?: string | null;
  created_at: string | null;
  validated_by: string | null;
  validated_by_label?: string | null;
  validated_at: string | null;
};

// ---------------------------------------------------------------------------
// Revision labels — A, B, … Z, AA, AB, …
// ---------------------------------------------------------------------------

export function revLabelFromIndex(i: number): string {
  // 0 → A, 25 → Z, 26 → AA (bijective base-26).
  let n = i + 1;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/** The next label after the existing ones (by count — labels are append-only). */
export function nextRevLabel(existing: readonly string[]): string {
  return revLabelFromIndex(existing.length);
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Workflow/bookkeeping columns — they legitimately change across a revision
 * cycle and would drown the real differences. Excluded from the diff, kept in
 * the snapshot (the record stays complete).
 */
export const DIFF_EXCLUDED_TASK_FIELDS = new Set([
  "status",
  "submitted_at",
  "validated_at",
  "validated_by",
  "current_rev",
  "created_at",
  "updated_at",
  "archived_at",
  "archived_by",
]);

const DIFF_EXCLUDED_CHILD_FIELDS = new Set(["created_at", "updated_at"]);

export type RevisionFieldChange = {
  /** Dot path, e.g. "task.solar_panel_tilt_angle" or "line[SKU-12].config_values.battery". */
  path: string;
  kind: "changed" | "added" | "removed";
  from: unknown;
  to: unknown;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function flatten(
  prefix: string,
  value: unknown,
  out: Map<string, unknown>,
  exclude?: Set<string>,
  depth = 0
): void {
  if (isPlainObject(value) && depth < 6) {
    for (const [k, v] of Object.entries(value)) {
      if (depth === 0 && exclude?.has(k)) continue;
      flatten(prefix ? `${prefix}.${k}` : k, v, out, undefined, depth + 1);
    }
    return;
  }
  // Arrays and scalars compare as values (JSON-stable).
  out.set(prefix, value);
}

function diffFlat(
  prevFlat: Map<string, unknown>,
  nextFlat: Map<string, unknown>,
  pathPrefix: string,
  out: RevisionFieldChange[]
): void {
  const keys = new Set([...prevFlat.keys(), ...nextFlat.keys()]);
  for (const k of keys) {
    const a = prevFlat.get(k);
    const b = nextFlat.get(k);
    const has = { a: prevFlat.has(k), b: nextFlat.has(k) };
    const same = JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (has.a && has.b && !same) {
      out.push({ path: `${pathPrefix}${k}`, kind: "changed", from: a, to: b });
    } else if (has.a && !has.b && a != null) {
      out.push({ path: `${pathPrefix}${k}`, kind: "removed", from: a, to: null });
    } else if (!has.a && has.b && b != null) {
      out.push({ path: `${pathPrefix}${k}`, kind: "added", from: null, to: b });
    }
  }
}

/** A stable identity for a line row so reordering never reads as a change. */
function lineKey(row: Record<string, unknown>): string {
  return String(row.id ?? row.product_sku ?? row.product_name ?? "?");
}

/**
 * Field-level diff between two snapshots — the "highlight every modified
 * field" of the owner spec. Deterministic, pure, reorder-insensitive for
 * lines. Workflow columns are excluded (see DIFF_EXCLUDED_TASK_FIELDS).
 */
export function diffSnapshots(
  prev: TaskListSnapshot,
  next: TaskListSnapshot
): RevisionFieldChange[] {
  const out: RevisionFieldChange[] = [];

  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  flatten("", prev.task ?? {}, a, DIFF_EXCLUDED_TASK_FIELDS);
  flatten("", next.task ?? {}, b, DIFF_EXCLUDED_TASK_FIELDS);
  diffFlat(a, b, "task.", out);

  const prevLines = new Map((prev.lines ?? []).map((l) => [lineKey(l), l]));
  const nextLines = new Map((next.lines ?? []).map((l) => [lineKey(l), l]));
  for (const [key, row] of prevLines) {
    const other = nextLines.get(key);
    if (!other) {
      out.push({
        path: `line[${String(row.product_name ?? key)}]`,
        kind: "removed",
        from: row.product_name ?? key,
        to: null,
      });
      continue;
    }
    const fa = new Map<string, unknown>();
    const fb = new Map<string, unknown>();
    flatten("", row, fa, DIFF_EXCLUDED_CHILD_FIELDS);
    flatten("", other, fb, DIFF_EXCLUDED_CHILD_FIELDS);
    diffFlat(fa, fb, `line[${String(row.product_name ?? key)}].`, out);
  }
  for (const [key, row] of nextLines) {
    if (!prevLines.has(key)) {
      out.push({
        path: `line[${String(row.product_name ?? key)}]`,
        kind: "added",
        from: null,
        to: row.product_name ?? key,
      });
    }
  }

  const la = new Map<string, unknown>();
  const lb = new Map<string, unknown>();
  flatten("", prev.lighting ?? {}, la, DIFF_EXCLUDED_CHILD_FIELDS);
  flatten("", next.lighting ?? {}, lb, DIFF_EXCLUDED_CHILD_FIELDS);
  diffFlat(la, lb, "lighting.", out);

  // Attachments: metadata identity by storage_path.
  const pa = new Set((prev.attachments ?? []).map((x) => String(x.storage_path ?? "")));
  const pb = new Set((next.attachments ?? []).map((x) => String(x.storage_path ?? "")));
  for (const x of prev.attachments ?? []) {
    const p = String(x.storage_path ?? "");
    if (!pb.has(p))
      out.push({ path: `attachment[${String(x.file_name ?? p)}]`, kind: "removed", from: x.file_name ?? p, to: null });
  }
  for (const x of next.attachments ?? []) {
    const p = String(x.storage_path ?? "");
    if (!pa.has(p))
      out.push({ path: `attachment[${String(x.file_name ?? p)}]`, kind: "added", from: null, to: x.file_name ?? p });
  }

  return out.sort((x, y) => (x.path < y.path ? -1 : 1));
}

/** Short display form of a diff value ("—" for empty; JSON truncated). */
export function formatDiffValue(v: unknown, max = 80): string {
  if (v == null || v === "") return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
