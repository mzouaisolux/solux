/**
 * Pre-Validation action items (m178) — pure types + vocabulary + normalizer.
 *
 * Pre-Validation (status `under_validation`) is the collaborative phase where
 * the Task List Manager iterates with the factory, engineering, the study
 * lab, purchasing and sales until every department agrees the file is
 * complete (owner spec 2026-07-21). This module structures the PENDING
 * ISSUES of that phase: who owes what, for which department, by when.
 *
 * Departments are METADATA, not roles (owner decision 2026-07-21): the
 * factory and study lab have no logins today — the TLM is their proxy — so
 * an item carries a department tag and an optional assignee picked from the
 * EXISTING users. Real department logins can arrive later without rework.
 *
 * An item marked `blocking` prevents Final Validation while open — it joins
 * the release gate (evaluateRelease) alongside missing mappings and the
 * pole-drawing checkpoint. Non-blocking items are the "Pending Issues" /
 * "Warnings" of the dashboard: visible, assignable, never a gate.
 *
 * Client + server safe (no DB access). The app never trusts the raw stored
 * shape — always read through normalizeActionItem().
 */

export const ACTION_ITEM_DEPARTMENTS = [
  "task_list_manager",
  "factory",
  "engineering",
  "study_lab",
  "purchasing",
  "sales",
  "logistics",
  "quality",
  "other",
] as const;
export type ActionItemDepartment = (typeof ACTION_ITEM_DEPARTMENTS)[number];

export const ACTION_ITEM_DEPARTMENT_LABELS: Record<ActionItemDepartment, string> = {
  task_list_manager: "Task List Manager",
  factory: "Factory",
  engineering: "Engineering",
  study_lab: "Study Lab",
  purchasing: "Purchasing",
  sales: "Sales",
  logistics: "Logistics",
  quality: "Quality",
  other: "Other",
};

/**
 * Lifecycle. `open` and `in_progress` count as PENDING (they show on the
 * dashboard and, when blocking, gate the release); `done` and `dismissed`
 * are terminal and keep the trail.
 */
export const ACTION_ITEM_STATUSES = ["open", "in_progress", "done", "dismissed"] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];

export const ACTION_ITEM_STATUS_LABELS: Record<ActionItemStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};

export function isPendingActionStatus(s: ActionItemStatus): boolean {
  return s === "open" || s === "in_progress";
}

export type TaskListActionItem = {
  id: string;
  task_list_id: string;
  title: string;
  details: string | null;
  department: ActionItemDepartment;
  /** Optional owner among EXISTING users (auth.users id). */
  assignee: string | null;
  /** Display label resolved by the loader (profiles join) — never stored. */
  assignee_label?: string | null;
  status: ActionItemStatus;
  /** Open blocking items prevent Final Validation (evaluateRelease). */
  blocking: boolean;
  /** Optional — the owner spec makes due dates optional here, unlike m103. */
  due_date: string | null;
  created_by: string | null;
  created_by_label?: string | null;
  created_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
};

function cleanStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Normalize one stored row; null when unusable (no id / no title). */
export function normalizeActionItem(raw: unknown): TaskListActionItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = cleanStr(r.id);
  const task_list_id = cleanStr(r.task_list_id);
  const title = cleanStr(r.title);
  if (!id || !task_list_id || !title) return null;
  const department = (ACTION_ITEM_DEPARTMENTS as readonly string[]).includes(
    String(r.department)
  )
    ? (r.department as ActionItemDepartment)
    : "other";
  const status = (ACTION_ITEM_STATUSES as readonly string[]).includes(String(r.status))
    ? (r.status as ActionItemStatus)
    : "open"; // an unknown status must keep gating, not silently vanish
  return {
    id,
    task_list_id,
    title,
    details: cleanStr(r.details),
    department,
    assignee: cleanStr(r.assignee),
    assignee_label: cleanStr(r.assignee_label),
    status,
    blocking: r.blocking === true,
    due_date: cleanStr(r.due_date),
    created_by: cleanStr(r.created_by),
    created_by_label: cleanStr(r.created_by_label),
    created_at: cleanStr(r.created_at),
    resolved_at: cleanStr(r.resolved_at),
    resolved_by: cleanStr(r.resolved_by),
  };
}

/** Items still gating Final Validation. */
export function openBlockingItems(items: readonly TaskListActionItem[]): TaskListActionItem[] {
  return items.filter((i) => i.blocking && isPendingActionStatus(i.status));
}

/** Pending (open/in-progress) items, blocking first, then oldest due first. */
export function pendingItemsSorted(
  items: readonly TaskListActionItem[]
): TaskListActionItem[] {
  return items
    .filter((i) => isPendingActionStatus(i.status))
    .sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
      const da = a.due_date ?? "9999-12-31";
      const db = b.due_date ?? "9999-12-31";
      if (da !== db) return da < db ? -1 : 1;
      return (a.created_at ?? "") < (b.created_at ?? "") ? -1 : 1;
    });
}
