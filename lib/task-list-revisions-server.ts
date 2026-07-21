/**
 * Final Validation revisions — server half (m179).
 *
 * Builds the immutable snapshots and maintains the Rev A/B lineage. Shared by
 * the workflow actions (validate / fast-track / open-revision) and the task
 * list page (revision panel + live diff). Everything here is DEFENSIVE:
 * pre-m179 the table/column are absent and every function degrades to a
 * no-op / empty result, so the app runs unchanged until the migration lands.
 */

import type { createClient } from "@/lib/supabase/server";
import {
  nextRevLabel,
  type TaskListRevision,
  type TaskListSnapshot,
} from "@/lib/task-list-revisions";

type Supabase = ReturnType<typeof createClient>;

function missingSchema(message: string | undefined): boolean {
  return /task_list_revisions|current_rev/i.test(message ?? "");
}

/**
 * The complete frozen content: task row + lines + lighting setup +
 * attachment metadata (files live in Storage and are preserved as-is;
 * the snapshot records exactly which files, names and paths were part of
 * the validated version).
 */
export async function buildTaskListSnapshot(
  supabase: Supabase,
  taskListId: string
): Promise<TaskListSnapshot | null> {
  const { data: task, error } = await supabase
    .from("production_task_lists")
    .select("*")
    .eq("id", taskListId)
    .maybeSingle();
  if (error || !task) return null;

  const [{ data: lines }, lighting, attachments] = await Promise.all([
    supabase
      .from("production_task_list_lines")
      .select("*")
      .eq("task_list_id", taskListId)
      .order("id"),
    (task as any).quotation_id
      ? supabase
          .from("product_lighting_setups")
          .select("*")
          .eq("document_id", (task as any).quotation_id)
          .maybeSingle()
          .then((r) => r.data ?? null)
      : Promise.resolve(null),
    (task as any).affair_id
      ? supabase
          .from("attachments")
          .select("id, file_name, storage_path, attachment_type, note, visible_factory, created_at")
          .eq("affair_id", (task as any).affair_id)
          .order("created_at")
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);

  return {
    task: task as Record<string, unknown>,
    lines: (lines ?? []) as Record<string, unknown>[],
    lighting: lighting as Record<string, unknown> | null,
    attachments: (attachments ?? []) as Record<string, unknown>[],
  };
}

/**
 * Record a Final Validation:
 *   - an `in_progress` controlled revision exists → finalize it (snapshot,
 *     validated stamps, status 'validated');
 *   - none exists (first validation) → create Rev A directly as validated;
 *   - the previously validated revision becomes `superseded` (never deleted);
 *   - production_task_lists.current_rev is stamped.
 *
 * Called BEFORE the status transition (the row is still editable then — the
 * freeze trigger allows nothing but workflow columns afterwards).
 * Returns the rev label, or null on a pre-m179 database (dormant).
 */
export async function recordValidationRevision(
  supabase: Supabase,
  taskListId: string,
  userId: string | null
): Promise<string | null> {
  const { data: existing, error } = await supabase
    .from("task_list_revisions")
    .select("id, rev, status")
    .eq("task_list_id", taskListId)
    .order("created_at");
  if (error) return null; // pre-m179 — dormant

  const snapshot = await buildTaskListSnapshot(supabase, taskListId);
  if (!snapshot) return null;
  const now = new Date().toISOString();

  const inProgress = (existing ?? []).find((r: any) => r.status === "in_progress");
  let rev: string;
  if (inProgress) {
    rev = (inProgress as any).rev;
    const { error: upErr } = await supabase
      .from("task_list_revisions")
      .update({ snapshot, status: "validated", validated_at: now, validated_by: userId })
      .eq("id", (inProgress as any).id);
    if (upErr) return null;
  } else {
    rev = nextRevLabel((existing ?? []).map((r: any) => r.rev));
    const { error: insErr } = await supabase.from("task_list_revisions").insert({
      task_list_id: taskListId,
      rev,
      status: "validated",
      reason: existing?.length ? null : "Initial validation",
      snapshot,
      created_by: userId,
      validated_at: now,
      validated_by: userId,
    });
    if (insErr) return null;
  }

  // Exactly one 'validated' revision at a time — the previous one is history.
  await supabase
    .from("task_list_revisions")
    .update({ status: "superseded" })
    .eq("task_list_id", taskListId)
    .eq("status", "validated")
    .neq("rev", rev);

  await supabase
    .from("production_task_lists")
    .update({ current_rev: rev })
    .eq("id", taskListId);

  return rev;
}

/**
 * Open a controlled revision on a FROZEN task list (validated or
 * production_ready): capture a BASELINE snapshot first if this list predates
 * m179 (so "the previous validated version stays accessible" holds for
 * legacy rows too), then create the next rev as `in_progress` with the
 * mandatory reason. The caller performs the status transition back to
 * Pre-Validation. Returns the new rev label.
 */
export async function openRevisionRecord(
  supabase: Supabase,
  taskList: { id: string; validated_at?: string | null; validated_by?: string | null },
  reason: string,
  userId: string | null
): Promise<string> {
  const { data: existing, error } = await supabase
    .from("task_list_revisions")
    .select("id, rev, status")
    .eq("task_list_id", taskList.id)
    .order("created_at");
  if (error) {
    throw new Error(
      "Revisions table missing — apply migration m179 (179_task_list_revisions_freeze.sql) first."
    );
  }
  if ((existing ?? []).some((r: any) => r.status === "in_progress")) {
    throw new Error("A revision is already in progress for this task list.");
  }

  const labels = (existing ?? []).map((r: any) => r.rev as string);

  // Legacy list validated before m179 → freeze what is CURRENTLY validated
  // as the baseline revision before anything gets edited.
  if (labels.length === 0) {
    const snapshot = await buildTaskListSnapshot(supabase, taskList.id);
    const baseline = nextRevLabel(labels);
    const { error: baseErr } = await supabase.from("task_list_revisions").insert({
      task_list_id: taskList.id,
      rev: baseline,
      status: "validated",
      reason: "Baseline — validated before revision tracking (m179)",
      snapshot,
      created_by: taskList.validated_by ?? null,
      validated_at: taskList.validated_at ?? new Date().toISOString(),
      validated_by: taskList.validated_by ?? null,
    });
    if (baseErr) throw new Error(baseErr.message);
    labels.push(baseline);
    await supabase
      .from("production_task_lists")
      .update({ current_rev: baseline })
      .eq("id", taskList.id);
  }

  const rev = nextRevLabel(labels);
  const { error: insErr } = await supabase.from("task_list_revisions").insert({
    task_list_id: taskList.id,
    rev,
    status: "in_progress",
    reason,
    created_by: userId,
  });
  if (insErr) throw new Error(insErr.message);
  return rev;
}

/** All revisions of a task list, newest first, with author labels resolved. */
export async function fetchRevisions(
  supabase: Supabase,
  taskListId: string
): Promise<TaskListRevision[]> {
  const { data, error } = await supabase
    .from("task_list_revisions")
    .select("id, task_list_id, rev, status, reason, snapshot, created_by, created_at, validated_by, validated_at")
    .eq("task_list_id", taskListId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];

  const ids = Array.from(
    new Set(
      (data as any[])
        .flatMap((r) => [r.created_by, r.validated_by])
        .filter((v): v is string => !!v)
    )
  );
  const labels = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    for (const p of (profs ?? []) as any[]) {
      labels.set(p.id, p.full_name || p.email || "—");
    }
  }
  return (data as any[]).map((r) => ({
    ...r,
    created_by_label: r.created_by ? (labels.get(r.created_by) ?? null) : null,
    validated_by_label: r.validated_by ? (labels.get(r.validated_by) ?? null) : null,
  })) as TaskListRevision[];
}
