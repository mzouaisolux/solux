"use server";

/**
 * Per-line Lighting Setup — server actions (m180).
 *
 * Every mutation: gated on the collaboration window (technical roles, or
 * sales while draft / Pre-Validation / needs_revision), refused on frozen
 * task lists (assert + the m179 line trigger as the authoritative backstop),
 * validated for coherence, and history-preserving — mode switches and study
 * imports archive the outgoing state before touching anything (owner spec:
 * "nothing should ever disappear").
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import { emitEvent } from "@/lib/events";
import {
  isTechnicalRole,
  type ProductionTaskListStatus,
} from "@/lib/types";
import { isFrozenStatus } from "@/lib/task-list-revisions";
import {
  editedSetup,
  importUpdatedRecommendation,
  manualSetup,
  normalizeLineLighting,
  normalizeLineValues,
  copiedSetup,
  setupFromRecommendation,
  switchToAutomatic,
  switchToManual,
  validateLineValues,
  hasProgrammingContent,
  type LineLightingRecommendation,
  type LineLightingSetup,
} from "@/lib/lighting/line-setup";
import {
  resolveProgrammingRequirement,
  ruleSubjectFromLine,
} from "@/lib/lighting/programming-rules";
import { loadRules } from "@/lib/lighting/programming-rules-server";

const MISSING_COLUMN =
  "Per-line lighting column missing — apply migration m180 (180_line_lighting_and_rules.sql) in Supabase.";

type LineRow = {
  id: string;
  task_list_id: string;
  product_id: string | null;
  category_id: string | null;
  product_name: string | null;
  product_sku: string | null;
  config_values: Record<string, unknown> | null;
  lighting: unknown;
};

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return v == null ? null : String(v).trim() || null;
}

/** Sales participates while the file is being worked, like action items. */
const SALES_WINDOW: ProductionTaskListStatus[] = [
  "draft",
  "under_validation",
  "needs_revision",
];

async function loadLineAndGate(
  supabase: ReturnType<typeof createClient>,
  lineId: string
): Promise<{
  line: LineRow;
  taskList: { id: string; number: string | null; status: ProductionTaskListStatus; quotation_id: string | null };
  userId: string | null;
}> {
  const { role, userId } = await getCurrentUserRole();
  const { data: line, error } = await supabase
    .from("production_task_list_lines")
    .select("id, task_list_id, product_id, category_id, product_name, product_sku, config_values, lighting")
    .eq("id", lineId)
    .maybeSingle();
  if (error && /lighting/i.test(error.message ?? "")) throw new Error(MISSING_COLUMN);
  if (error || !line) throw new Error("Product line not found.");

  // m179 DEFENSIVE — `current_rev` only exists once m179 is applied. Before
  // that this select fails with 42703 and, because the error was discarded,
  // `tl` came back null and EVERY per-line lighting write died with a
  // misleading "Task list not found." — even though m180 was deployed and the
  // panel rendered fine. (QA campaign 2026-07-22, finding P0-2.) Retry without
  // the column: the rev is only used to label the freeze message, so falling
  // back to "A" is safe. Same contract as the `lighting` column just above.
  const TL_BASE_COLS = "id, number, status, quotation_id";
  let tl: any = null;
  {
    const withRev = await supabase
      .from("production_task_lists")
      .select(`${TL_BASE_COLS}, current_rev`)
      .eq("id", (line as any).task_list_id)
      .maybeSingle();
    if (withRev.error) {
      const withoutRev = await supabase
        .from("production_task_lists")
        .select(TL_BASE_COLS)
        .eq("id", (line as any).task_list_id)
        .maybeSingle();
      tl = withoutRev.data;
    } else {
      tl = withRev.data;
    }
  }
  if (!tl) throw new Error("Task list not found.");

  const status = (tl as any).status as ProductionTaskListStatus;
  if (isFrozenStatus(status)) {
    throw new Error(
      `Final Validation freeze — this task list (Rev ${(tl as any).current_rev ?? "A"}) is immutable. Open a controlled revision to modify programming.`
    );
  }
  if (!isTechnicalRole(role) && !SALES_WINDOW.includes(status)) {
    throw new Error("Programming can no longer be edited at this stage.");
  }
  return { line: line as unknown as LineRow, taskList: tl as any, userId: userId ?? null };
}

async function persist(
  supabase: ReturnType<typeof createClient>,
  line: LineRow,
  taskListId: string,
  setup: LineLightingSetup,
  eventMsg: string
): Promise<void> {
  const { error } = await supabase
    .from("production_task_list_lines")
    .update({ lighting: setup })
    .eq("id", line.id);
  if (error) {
    throw new Error(/lighting/i.test(error.message ?? "") ? MISSING_COLUMN : error.message);
  }
  await emitEvent({
    entity_type: "task_list",
    entity_id: taskListId,
    event_type: "tl.header_changed",
    message: eventMsg,
    payload: { section: "line_lighting", line_id: line.id, product: line.product_name },
    bestEffort: true,
  });
  revalidatePath(`/task-lists/${taskListId}`);
}

/** The study recommendation for a command — from the approved extraction. */
async function recommendationForCommand(
  supabase: ReturnType<typeof createClient>,
  quotationId: string | null
): Promise<LineLightingRecommendation | null> {
  if (!quotationId) return null;
  const { data } = await supabase
    .from("product_lighting_setups")
    .select("ai_extracted, energy_study_name")
    .eq("document_id", quotationId)
    .maybeSingle();
  const ai = (data as any)?.ai_extracted;
  if (!ai?.fields) return null;
  const confidence: Record<string, number> = {};
  for (const [k, v] of Object.entries(ai.confidence ?? {})) {
    const n = Number(v);
    if (Number.isFinite(n)) confidence[k] = Math.max(0, Math.min(1, n));
  }
  return {
    method: "energy_study",
    source_document: (data as any)?.energy_study_name ?? null,
    extracted_at: typeof ai.extracted_at === "string" ? ai.extracted_at : null,
    model: typeof ai.model === "string" ? ai.model : null,
    confidence,
    values: {
      operating_hours: ai.fields.operating_hours ?? null,
      program: Array.isArray(ai.fields.lighting_program) ? ai.fields.lighting_program : [],
      control_mode: null,
    },
  };
}

/**
 * Save the FINAL values of a line's setup (both modes — automatic is never
 * read-only; an automatic edit is recorded as review='adjusted').
 */
export async function saveLineLighting(formData: FormData) {
  const lineId = str(formData, "line_id");
  if (!lineId) throw new Error("Missing line id");
  const supabase = createClient();
  const { line, taskList, userId } = await loadLineAndGate(supabase, lineId);

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("values") ?? "{}"));
  } catch {
    throw new Error("Invalid programming payload (must be JSON).");
  }
  const values = normalizeLineValues(payload);
  const check = validateLineValues(values);
  if (check.errors.length) throw new Error(check.errors.join(" "));

  const existing = normalizeLineLighting(line.lighting);
  const now = new Date().toISOString();
  const next = existing
    ? editedSetup(existing, values, userId, now)
    : manualSetup(values, userId, now);

  await persist(
    supabase,
    line,
    taskList.id,
    next,
    `Programming updated on ${line.product_name ?? "line"} (${taskList.number ?? "task list"})`
  );
}

/** Explicit review confirmation of an automatic setup. */
export async function confirmLineLighting(formData: FormData) {
  const lineId = str(formData, "line_id");
  if (!lineId) throw new Error("Missing line id");
  const supabase = createClient();
  const { line, taskList, userId } = await loadLineAndGate(supabase, lineId);
  const existing = normalizeLineLighting(line.lighting);
  if (!existing) throw new Error("Nothing to confirm — no programming on this line yet.");
  const now = new Date().toISOString();
  const next: LineLightingSetup = {
    ...existing,
    review: { state: "confirmed", by: userId, at: now },
    audit: { ...existing.audit, updated_by: userId, updated_at: now },
  };
  await persist(supabase, line, taskList.id, next,
    `Programming confirmed on ${line.product_name ?? "line"} (${taskList.number ?? "task list"})`);
}

/** Populate a line from the approved study (creates an automatic setup). */
export async function autoPopulateLineLighting(formData: FormData) {
  const lineId = str(formData, "line_id");
  if (!lineId) throw new Error("Missing line id");
  const supabase = createClient();
  const { line, taskList, userId } = await loadLineAndGate(supabase, lineId);

  const rec = await recommendationForCommand(supabase, taskList.quotation_id);
  if (!rec) {
    throw new Error(
      "No approved study extraction on this command — run the Energy Study analysis first, or use Manual mode."
    );
  }
  const now = new Date().toISOString();
  const existing = normalizeLineLighting(line.lighting);

  // D2 — importUpdatedRecommendation forces mode:"automatic". On a MANUAL
  // line that therefore discards the hand-entered values, which is exactly
  // the transition setLineLightingMode protects with confirm=1. Without this
  // check the guard was bypassable through a different action ("Import
  // updated study values" on a line switched to Manual after having been
  // Automatic — it keeps its stale `recommended`, so the button shows).
  // Same wording as setLineLightingMode so the two paths cannot diverge.
  if (existing?.mode === "manual" && str(formData, "confirm") !== "1") {
    throw new Error(
      "Switching to Automatic replaces the current values with the study's recommendation. Confirm to proceed — the manual values stay in the history."
    );
  }

  const next = existing
    ? importUpdatedRecommendation(existing, rec, userId, now)
    : setupFromRecommendation(rec, userId, now);
  await persist(supabase, line, taskList.id, next,
    `Programming populated from ${rec.source_document ?? "the study"} on ${line.product_name ?? "line"}`);
}

/**
 * Switch mode. Manual → Automatic REQUIRES confirm=1 (the UI warns first);
 * both directions archive the outgoing state to the history.
 */
export async function setLineLightingMode(formData: FormData) {
  const lineId = str(formData, "line_id");
  const mode = str(formData, "mode");
  if (!lineId) throw new Error("Missing line id");
  if (mode !== "automatic" && mode !== "manual") throw new Error("Invalid mode.");
  const supabase = createClient();
  const { line, taskList, userId } = await loadLineAndGate(supabase, lineId);
  const existing = normalizeLineLighting(line.lighting);
  const now = new Date().toISOString();

  let next: LineLightingSetup;
  if (mode === "manual") {
    next = existing
      ? switchToManual(existing, userId, now)
      : manualSetup(normalizeLineValues(null), userId, now);
  } else {
    if (str(formData, "confirm") !== "1") {
      throw new Error(
        "Switching to Automatic replaces the current values with the study's recommendation. Confirm to proceed — the manual values stay in the history."
      );
    }
    const rec = await recommendationForCommand(supabase, taskList.quotation_id);
    if (!rec) throw new Error("No approved study extraction on this command.");
    next = existing
      ? switchToAutomatic(existing, rec, userId, now)
      : setupFromRecommendation(rec, userId, now);
  }
  await persist(supabase, line, taskList.id, next,
    `Programming mode → ${mode} on ${line.product_name ?? "line"} (${taskList.number ?? "task list"})`);
}

/**
 * "Apply this Lighting Setup to all eligible product lines" — an EXPLICIT
 * one-time COPY (decision #4): targets get independent copies; later edits
 * to the source never propagate. Lines resolved NOT APPLICABLE by the rules
 * are skipped; lines that already have programming are skipped (never
 * silently overwritten).
 */
export async function applyLightingToEligibleLines(formData: FormData) {
  const lineId = str(formData, "line_id");
  if (!lineId) throw new Error("Missing line id");
  const supabase = createClient();
  const { line, taskList, userId } = await loadLineAndGate(supabase, lineId);
  const source = normalizeLineLighting(line.lighting);
  if (!source || !hasProgrammingContent(source)) {
    throw new Error("This line has no programming to apply yet.");
  }

  const [{ data: lines }, rules] = await Promise.all([
    supabase
      .from("production_task_list_lines")
      .select("id, task_list_id, product_id, category_id, product_name, product_sku, config_values, lighting")
      .eq("task_list_id", taskList.id),
    loadRules(supabase),
  ]);

  const now = new Date().toISOString();
  let copied = 0;
  let skippedExisting = 0;
  for (const raw of (lines ?? []) as unknown as LineRow[]) {
    if (raw.id === line.id) continue;
    const { requirement } = resolveProgrammingRequirement(ruleSubjectFromLine(raw), rules);
    if (requirement === "not_applicable") continue;
    if (hasProgrammingContent(normalizeLineLighting(raw.lighting))) {
      skippedExisting++;
      continue;
    }
    const copy = copiedSetup(source, line.product_name ?? line.id, userId, now);
    const { error } = await supabase
      .from("production_task_list_lines")
      .update({ lighting: copy })
      .eq("id", raw.id);
    if (!error) copied++;
  }

  await emitEvent({
    entity_type: "task_list",
    entity_id: taskList.id,
    event_type: "tl.header_changed",
    message: `Programming from ${line.product_name ?? "line"} copied to ${copied} eligible line${copied === 1 ? "" : "s"}${
      skippedExisting ? ` (${skippedExisting} kept their own)` : ""
    }`,
    payload: { section: "line_lighting", action: "apply_to_all", copied, skipped: skippedExisting },
    bestEffort: true,
  });
  revalidatePath(`/task-lists/${taskList.id}`);
}
