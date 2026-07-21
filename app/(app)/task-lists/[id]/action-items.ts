"use server";

/**
 * Pre-Validation action items — server actions (m178).
 *
 * The collaboration surface of the Pre-Validation phase: anyone working the
 * task list can raise an item ("Waiting for pole calculation", "Missing
 * engineering approval"), tag it with a department, optionally assign it to
 * an existing user, and mark it blocking — an open blocking item joins the
 * release gate (evaluateRelease) and prevents Final Validation.
 *
 * Edit window:
 *   - technical roles: full CRUD in any non-cancelled status;
 *   - sales: may create items and update their own while the list is in
 *     draft / Pre-Validation / needs_revision (they participate in the
 *     collaboration — "request additional customer information" flows both
 *     ways) — but a sales user never toggles someone else's item;
 *   - the assignee may always update the STATUS of their own item.
 *
 * Never throws raw DB errors to the client; a pre-m178 database surfaces a
 * clear "apply m178" message.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import { emitEvent } from "@/lib/events";
import {
  isTechnicalRole,
  type ProductionTaskListStatus,
} from "@/lib/types";
import {
  ACTION_ITEM_DEPARTMENTS,
  ACTION_ITEM_STATUSES,
  type ActionItemDepartment,
  type ActionItemStatus,
} from "@/lib/task-list-action-items";

const MISSING_TABLE =
  "Action items table missing — apply migration m178 (178_task_list_action_items.sql) in Supabase.";

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

function isMissingTable(message: string | undefined): boolean {
  return /task_list_action_items/i.test(message ?? "");
}

async function loadTaskList(supabase: ReturnType<typeof createClient>, id: string) {
  const { data } = await supabase
    .from("production_task_lists")
    .select("id, number, status")
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new Error("Task list not found");
  return data as { id: string; number: string | null; status: ProductionTaskListStatus };
}

/** Sales participates while the file is still being worked, not after. */
const SALES_ITEM_WINDOW: ProductionTaskListStatus[] = [
  "draft",
  "under_validation",
  "needs_revision",
];

export async function createTaskListActionItem(formData: FormData) {
  const taskListId = str(formData, "task_list_id");
  if (!taskListId) throw new Error("Missing task list id");
  const title = str(formData, "title");
  if (!title) throw new Error("The item needs a title.");

  const { role, userId } = await getCurrentUserRole();
  const supabase = createClient();
  const tl = await loadTaskList(supabase, taskListId);

  if (tl.status === "cancelled") {
    throw new Error("This task list is cancelled — no new items.");
  }
  if (!isTechnicalRole(role) && !SALES_ITEM_WINDOW.includes(tl.status)) {
    throw new Error(
      "Items can no longer be added at this stage — ask the Task List Manager."
    );
  }

  const department = (ACTION_ITEM_DEPARTMENTS as readonly string[]).includes(
    str(formData, "department") ?? ""
  )
    ? (str(formData, "department") as ActionItemDepartment)
    : "other";
  // Only technical roles may raise a BLOCKING item — a blocking flag gates
  // Final Validation, which is a production decision.
  const blocking = isTechnicalRole(role) && str(formData, "blocking") === "1";
  const due = str(formData, "due_date");

  const { error } = await supabase.from("task_list_action_items").insert({
    task_list_id: taskListId,
    title,
    details: str(formData, "details"),
    department,
    assignee: str(formData, "assignee"),
    blocking,
    due_date: due,
    created_by: userId ?? null,
  });
  if (error) throw new Error(isMissingTable(error.message) ? MISSING_TABLE : error.message);

  await emitEvent({
    entity_type: "task_list",
    entity_id: taskListId,
    event_type: "tl.header_changed",
    message: `Pre-Validation item added on ${tl.number ?? "task list"}: ${title}${
      blocking ? " (blocking)" : ""
    }`,
    payload: { section: "pre_validation", action: "item_created", title, department, blocking },
    bestEffort: true,
  });

  revalidatePath(`/task-lists/${taskListId}`);
}

export async function setTaskListActionItemStatus(formData: FormData) {
  const itemId = str(formData, "item_id");
  if (!itemId) throw new Error("Missing item id");
  const next = str(formData, "status") as ActionItemStatus | null;
  if (!next || !(ACTION_ITEM_STATUSES as readonly string[]).includes(next)) {
    throw new Error("Invalid item status.");
  }

  const { role, userId } = await getCurrentUserRole();
  const supabase = createClient();

  const { data: item, error: readErr } = await supabase
    .from("task_list_action_items")
    .select("id, task_list_id, title, blocking, created_by, assignee")
    .eq("id", itemId)
    .maybeSingle();
  if (readErr) throw new Error(isMissingTable(readErr.message) ? MISSING_TABLE : readErr.message);
  if (!item) throw new Error("Item not found");

  const mine = userId != null && (item.created_by === userId || item.assignee === userId);
  if (!isTechnicalRole(role) && !mine) {
    throw new Error("Only the item's owner or a technical role can update it.");
  }

  const terminal = next === "done" || next === "dismissed";
  const { error } = await supabase
    .from("task_list_action_items")
    .update({
      status: next,
      resolved_at: terminal ? new Date().toISOString() : null,
      resolved_by: terminal ? userId ?? null : null,
    })
    .eq("id", itemId);
  if (error) throw new Error(error.message);

  await emitEvent({
    entity_type: "task_list",
    entity_id: item.task_list_id,
    event_type: "tl.header_changed",
    message: `Pre-Validation item ${next === "done" ? "resolved" : next === "dismissed" ? "dismissed" : "reopened"}: ${item.title}`,
    payload: { section: "pre_validation", action: "item_status", item_id: itemId, status: next },
    bestEffort: true,
  });

  revalidatePath(`/task-lists/${item.task_list_id}`);
}

export async function deleteTaskListActionItem(formData: FormData) {
  const itemId = str(formData, "item_id");
  if (!itemId) throw new Error("Missing item id");

  const { role, userId } = await getCurrentUserRole();
  const supabase = createClient();

  const { data: item, error: readErr } = await supabase
    .from("task_list_action_items")
    .select("id, task_list_id, title, created_by")
    .eq("id", itemId)
    .maybeSingle();
  if (readErr) throw new Error(isMissingTable(readErr.message) ? MISSING_TABLE : readErr.message);
  if (!item) return; // already gone — deleting twice is not an error

  if (!isTechnicalRole(role) && item.created_by !== userId) {
    throw new Error("Only the item's creator or a technical role can delete it.");
  }

  const { error } = await supabase.from("task_list_action_items").delete().eq("id", itemId);
  if (error) throw new Error(error.message);

  revalidatePath(`/task-lists/${item.task_list_id}`);
}
