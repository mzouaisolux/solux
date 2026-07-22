"use server";

/**
 * Product Lighting Setup — server actions.
 *
 * Only the OPTIONAL "Auto-fill from Energy Study" lives here: it reads the PDF
 * the user already uploaded to Storage and runs the Claude extractor. Saving the
 * setup is NOT here — it happens inside launchProduction (the launch gate), so
 * the config is written in the same transaction as the production command.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { getCurrentUserRole } from "@/lib/auth";
import {
  TASK_LIST_LOCKED_FOR_SALES,
  isTechnicalRole,
  type ProductionTaskListStatus,
} from "@/lib/types";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments";
import { cleanTiltAngle } from "@/lib/industrial-spec";
import { isFrozenStatus } from "@/lib/task-list-revisions";
import {
  applyCorrectionsAfterSave,
  isReviewableField,
  normalizeAiReview,
} from "@/lib/lighting/ai-review";
import {
  cleanConfidence,
  resolveExtraction,
  type TiltProvenance,
} from "@/lib/tilt-provenance";
import { extractLightingFromEnergyStudy } from "@/lib/lighting/extract-energy-study";
import { extractDialux } from "@/lib/lighting/extract-dialux";
import { normalizeLightingProgram } from "@/lib/lighting/validate";
import type { LightingExtraction, DialuxExtraction } from "@/lib/lighting/types";

/**
 * m176 — what happened to the tilt the study stated, once measured against the
 * value already in production.
 *
 *   none      — the study states no panel tilt.
 *   applied   — the field was empty (or already equal): the AI value stands.
 *   conflict  — it disagrees with the stored value, or the study is ambiguous.
 *               Production is UNCHANGED and a human must settle it; the
 *               pole-drawing checkpoint stays blocked meanwhile.
 *   unavailable — pre-m176 database, nothing was recorded.
 */
export type TiltOutcome =
  | { kind: "none" }
  | { kind: "applied"; tilt: number }
  | { kind: "conflict"; tilt: number; stored: number | null; ambiguous: boolean }
  | { kind: "unavailable" };

export type ExtractEnergyStudyResult =
  | {
      ok: true;
      extraction: LightingExtraction;
      /** m176 — replaces the m159 `tiltApplied` boolean, which could not
       *  express "the study disagrees with production". */
      tilt: TiltOutcome;
    }
  | { ok: false; error: string };

/**
 * Record a tilt extraction against ONE task list: always persist the
 * provenance, write the value ONLY when there is nothing to contradict.
 *
 * This is the m159 bug's fix. The old auto-fill wrote
 * `where solar_panel_tilt_angle is null`, but a task list is seeded with the
 * SR's mandatory tilt at creation — so the guard never matched and every
 * extracted value was silently dropped. We now compare explicitly and surface
 * the disagreement instead of discarding it.
 *
 * Never throws: a pre-m176 database (no provenance column) degrades to the
 * m159 behaviour — fill-if-empty, no record.
 */
async function recordTiltExtraction(
  supabase: any,
  taskList: { id: string; solar_panel_tilt_angle: number | null },
  extraction: LightingExtraction,
  sourceName: string | null
): Promise<TiltOutcome> {
  const value = cleanTiltAngle(extraction.tilt_angle);
  if (value == null) return { kind: "none" };

  const stored = cleanTiltAngle(taskList.solar_panel_tilt_angle);
  const { resolution, writeValue } = resolveExtraction(
    value,
    stored,
    extraction.tilt_ambiguous
  );

  const provenance: TiltProvenance = {
    value,
    unit: "degrees",
    basis: extraction.tilt_basis,
    source_document: sourceName,
    source_page: extraction.tilt_source_page,
    source_text: extraction.tilt_source_text,
    confidence: cleanConfidence(extraction.confidence?.tilt_angle),
    model: extraction.model,
    extracted_at: new Date().toISOString(),
    ambiguous: extraction.tilt_ambiguous,
    candidates: extraction.tilt_candidates,
    resolution,
    resolved_by: null,
    resolved_at: null,
    manually_modified_after: false,
  };

  const patch: Record<string, any> = { tilt_ai_provenance: provenance };
  if (writeValue != null) {
    patch.solar_panel_tilt_angle = writeValue;
    // A new production value invalidates the drawing sign-off, exactly like a
    // manual edit (same contract as updateIndustrialFile).
    if ((stored ?? null) !== writeValue) {
      patch.pole_drawing_tilt_verified = false;
      patch.pole_drawing_tilt_verified_by = null;
      patch.pole_drawing_tilt_verified_at = null;
    }
  }

  const { error } = await supabase
    .from("production_task_lists")
    .update(patch)
    .eq("id", taskList.id);

  if (error) {
    if (!/tilt_ai_provenance/i.test(error.message ?? "")) return { kind: "unavailable" };
    // Pre-m176 — keep the m159 behaviour (fill an empty field, no provenance).
    if (writeValue == null) return { kind: "unavailable" };
    const { error: legacyErr } = await supabase
      .from("production_task_lists")
      .update({ solar_panel_tilt_angle: writeValue })
      .eq("id", taskList.id);
    return legacyErr ? { kind: "unavailable" } : { kind: "applied", tilt: writeValue };
  }

  return resolution === "pending"
    ? { kind: "conflict", tilt: value, stored, ambiguous: extraction.tilt_ambiguous }
    : { kind: "applied", tilt: writeValue ?? value };
}

/**
 * Read the uploaded Energy Study PDF from Storage and extract lighting params.
 * Never throws to the client — any failure comes back as { ok:false, error } so
 * the form simply keeps the manual path (AI is optional by design).
 */
export async function extractEnergyStudyAction(
  formData: FormData
): Promise<ExtractEnergyStudyResult> {
  try {
    // Same gate as launching production — only a user who can create the
    // commercial command may run the assist.
    await requireCapability("quotation.create");

    const path = String(formData.get("storage_path") ?? "").trim();
    if (!path) {
      return { ok: false, error: "Upload the Energy Study first." };
    }

    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .download(path);
    if (error || !data) {
      return {
        ok: false,
        error: error?.message ?? "Could not read the uploaded Energy Study.",
      };
    }

    const bytes = new Uint8Array(await data.arrayBuffer());
    const extraction = await extractLightingFromEnergyStudy({ pdf: bytes });

    // m176 — record the Solar Panel Tilt Angle the Energy Study states against
    // the task list(s) of this command. Replaces the m159 fill-if-empty write,
    // which never fired (the column is seeded from the SR at creation) and so
    // discarded every extracted value. We now keep production untouched on a
    // disagreement and raise a conflict a human settles.
    let tilt: TiltOutcome = { kind: "none" };
    const documentId = String(formData.get("document_id") ?? "").trim();
    if (documentId && extraction.tilt_angle != null) {
      // m179 — frozen task lists (Final Validation) are immutable: the
      // extraction records/conflicts only against lists still in the cycle.
      const { data: lists } = await supabase
        .from("production_task_lists")
        .select("id, solar_panel_tilt_angle")
        .eq("quotation_id", documentId)
        .in("status", ["draft", "under_validation", "needs_revision"]);
      const sourceName =
        String(formData.get("source_name") ?? "").trim() || basename(path);
      for (const tl of (lists ?? []) as any[]) {
        const outcome = await recordTiltExtraction(supabase, tl, extraction, sourceName);
        // Surface the most actionable outcome across the (normally single)
        // task lists — a conflict must never be masked by a sibling's success.
        if (outcome.kind === "conflict" || tilt.kind === "none") tilt = outcome;
        if (outcome.kind === "conflict") revalidatePath(`/task-lists/${tl.id}`);
      }
    }

    return { ok: true, extraction, tilt };
  } catch (e: any) {
    return {
      ok: false,
      error:
        e?.message ??
        "Auto-fill failed. Please enter the lighting values manually.",
    };
  }
}

export type ExtractDialuxResult =
  | { ok: true; extraction: DialuxExtraction }
  | { ok: false; error: string };

/**
 * Read the uploaded DIALUX report from Storage and extract the
 * Production-relevant fields (mounting height, power, optics, CCT,
 * quantities — one entry per lighting configuration, never merged).
 * Same pipeline / confidence contract as the Energy Study assist; never
 * throws to the client — any failure keeps the manual path.
 */
export async function extractDialuxAction(
  formData: FormData
): Promise<ExtractDialuxResult> {
  try {
    await requireCapability("quotation.create");

    const path = String(formData.get("storage_path") ?? "").trim();
    if (!path) {
      return { ok: false, error: "Upload the Dialux study first." };
    }
    if (/\.zip$/i.test(path)) {
      return {
        ok: false,
        error:
          "AI analysis reads PDF Dialux reports — upload the PDF export to use the assist (ZIP archives are stored but not parsed).",
      };
    }

    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .download(path);
    if (error || !data) {
      return {
        ok: false,
        error: error?.message ?? "Could not read the uploaded Dialux study.",
      };
    }

    const bytes = new Uint8Array(await data.arrayBuffer());
    const extraction = await extractDialux({ pdf: bytes });
    if (!extraction.configurations.length) {
      return {
        ok: false,
        error:
          "No lighting configuration could be reliably read from this report. Please enter the values manually.",
      };
    }
    return { ok: true, extraction };
  } catch (e: any) {
    return {
      ok: false,
      error:
        e?.message ??
        "Dialux analysis failed. Please enter the values manually.",
    };
  }
}

// ---------------------------------------------------------------------------
// m160 — "AI Find from Energy Study" (Industrial production file tilt block).
// ---------------------------------------------------------------------------
export type AiFindTiltResult =
  | {
      ok: true;
      found: true;
      tilt: number;
      /** m176 — false when the study was ambiguous: the value was recorded as a
       *  pending conflict rather than written to production. */
      applied: boolean;
      ambiguous: boolean;
      /** 0..1 model confidence for the tilt field, when reported. */
      confidence: number | null;
      sourceName: string | null;
      /** 1-based page in the study, when the model could tell. */
      sourcePage: number | null;
      /** m176 — the verbatim sentence the value was read from. */
      sourceText: string | null;
    }
  | { ok: true; found: false; sourceName: string | null }
  | { ok: false; error: string };

/**
 * Explicit AI assist on the task list's Solar Panel Tilt Angle: reads the
 * LATEST uploaded Energy Study of this command (the lighting setup anchored
 * on the proforma), extracts the tilt and WRITES it on the task list —
 * user-triggered, so the found value replaces the current one (still fully
 * overridable afterwards). Changing the value resets the pole-drawing
 * checkpoint, exactly like a manual edit. Never throws to the client.
 */
export async function aiFindTiltAction(
  formData: FormData
): Promise<AiFindTiltResult> {
  try {
    await requireCapability("quotation.create");
    const taskListId = str(formData.get("task_list_id"));
    if (!taskListId) return { ok: false, error: "Missing task list reference." };

    const supabase = createClient();
    const { data: tl } = await supabase
      .from("production_task_lists")
      .select("id, status, quotation_id")
      .eq("id", taskListId)
      .maybeSingle();
    if (!tl) return { ok: false, error: "Task list not found." };

    // Same edit window as the manual field (sales locked post-submission).
    const { role, userId } = await getCurrentUserRole();
    if (
      !isTechnicalRole(role) &&
      TASK_LIST_LOCKED_FOR_SALES.includes(tl.status as ProductionTaskListStatus)
    ) {
      return {
        ok: false,
        error: "This task list is in production validation — the tilt angle can no longer be edited by sales.",
      };
    }
    // m179 — Final Validation freeze: immutable for every role.
    if (isFrozenStatus(tl.status as string)) {
      return {
        ok: false,
        error:
          "Final Validation freeze — this task list is immutable. Open a controlled revision to change the tilt angle.",
      };
    }

    const { data: setup } = await supabase
      .from("product_lighting_setups")
      .select("energy_study_path, energy_study_name")
      .eq("document_id", (tl as any).quotation_id)
      .maybeSingle();
    const path = (setup as any)?.energy_study_path as string | null;
    const sourceName = ((setup as any)?.energy_study_name as string | null) ?? null;
    if (!path) {
      return {
        ok: false,
        error:
          "No Energy Study uploaded for this command — add it in the Product Lighting Setup section, then retry.",
      };
    }

    const { data: file, error: dlErr } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .download(path);
    if (dlErr || !file) {
      return { ok: false, error: dlErr?.message ?? "Could not read the Energy Study." };
    }

    const extraction = await extractLightingFromEnergyStudy({
      pdf: new Uint8Array(await file.arrayBuffer()),
    });
    const tilt = cleanTiltAngle(extraction.tilt_angle);
    if (tilt == null) return { ok: true, found: false, sourceName };

    const { data: pre, error: preErr } = await supabase
      .from("production_task_lists")
      .select("solar_panel_tilt_angle")
      .eq("id", taskListId)
      .maybeSingle();
    if (preErr) {
      return {
        ok: false,
        error: "Tilt column missing — apply migration m159 (159_task_list_industrial_file.sql) first.",
      };
    }
    const oldTilt = cleanTiltAngle((pre as any)?.solar_panel_tilt_angle);

    // This path is an EXPLICIT human click, not a background auto-fill: the
    // user asked for the study's value and sees exactly what changed, so the
    // found value replaces the current one (still overridable) and the
    // provenance is recorded as already accepted.
    //
    // The one exception is AMBIGUITY — when the study states several equally
    // authoritative values the model cannot choose between, we refuse to guess
    // (owner spec) and raise the same pending conflict as the auto path.
    const accepted = !extraction.tilt_ambiguous;
    const now = new Date().toISOString();
    const provenance: TiltProvenance = {
      value: tilt,
      unit: "degrees",
      basis: extraction.tilt_basis,
      source_document: sourceName,
      source_page: extraction.tilt_source_page,
      source_text: extraction.tilt_source_text,
      confidence: cleanConfidence(extraction.confidence?.tilt_angle),
      model: extraction.model,
      extracted_at: now,
      ambiguous: extraction.tilt_ambiguous,
      candidates: extraction.tilt_candidates,
      resolution: accepted ? "accepted_ai" : "pending",
      resolved_by: accepted ? userId : null,
      resolved_at: accepted ? now : null,
      manually_modified_after: false,
    };

    const patch: Record<string, any> = { tilt_ai_provenance: provenance };
    if (accepted) {
      patch.solar_panel_tilt_angle = tilt;
      // Read-modify-write: reset the pole-drawing checkpoint ONLY when the
      // value actually changes (same contract as updateIndustrialFile).
      if ((oldTilt ?? null) !== tilt) {
        patch.pole_drawing_tilt_verified = false;
        patch.pole_drawing_tilt_verified_by = null;
        patch.pole_drawing_tilt_verified_at = null;
      }
    }

    let { error: upErr } = await supabase
      .from("production_task_lists")
      .update(patch)
      .eq("id", taskListId);
    if (upErr && /tilt_ai_provenance/i.test(upErr.message ?? "")) {
      // Pre-m176 — write the value alone, exactly as m160 did.
      delete patch.tilt_ai_provenance;
      ({ error: upErr } = await supabase
        .from("production_task_lists")
        .update(patch)
        .eq("id", taskListId));
    }
    if (upErr) return { ok: false, error: upErr.message };

    revalidatePath(`/task-lists/${taskListId}`);
    return {
      ok: true,
      found: true,
      tilt,
      applied: accepted,
      ambiguous: extraction.tilt_ambiguous,
      confidence: cleanConfidence(extraction.confidence?.tilt_angle),
      sourceName,
      sourcePage: extraction.tilt_source_page,
      sourceText: extraction.tilt_source_text,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "AI Find failed — enter the tilt angle manually." };
  }
}

// ---------------------------------------------------------------------------
// Save the lighting setup (from the task list "Lighting" tab).
// ---------------------------------------------------------------------------
export type SaveLightingResult = { ok: true } | { ok: false; error: string };

/**
 * Upsert the lighting setup for a production command (proforma). Authorization
 * is the table RLS (creator + technical roles) PLUS a readability check on the
 * parent command — only someone who can see the command may attach its lighting.
 * Anchored on document_id so the production order reads it back via quotation_id.
 * Never throws to the client.
 */
export async function saveProductLightingSetup(
  formData: FormData
): Promise<SaveLightingResult> {
  try {
    const documentId = str(formData.get("document_id"));
    if (!documentId) {
      return { ok: false, error: "Missing production command reference." };
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated." };

    // Only someone who can SEE the command (documents RLS) may attach lighting.
    const { data: doc } = await supabase
      .from("documents")
      .select("id")
      .eq("id", documentId)
      .maybeSingle();
    if (!doc) {
      return {
        ok: false,
        error: "Production command not found or not accessible.",
      };
    }

    // m182 — friendly freeze error. This action had NO app-level check and
    // relied entirely on the `lighting_freeze_guard` DB trigger, so the user
    // got a raw Postgres error (and, on a database without m179, no guard at
    // all). Mirrors confirmLightingAiField. (QA campaign 2026-07-22, P0-1.)
    const { data: frozenTl } = await supabase
      .from("production_task_lists")
      .select("number")
      .eq("quotation_id", documentId)
      .in("status", ["validated", "production_ready"])
      .limit(1)
      .maybeSingle();
    if (frozenTl) {
      return {
        ok: false,
        error:
          `Final Validation freeze: task list ${(frozenTl as any).number} is validated — ` +
          `open a controlled revision before changing the lighting setup.`,
      };
    }

    const fields = {
      affair_id: str(formData.get("affair_id")) || null,
      client_id: str(formData.get("client_id")) || null,
      lighting_power: num(formData.get("lighting_power")),
      operating_hours: num(formData.get("operating_hours")),
      lighting_program: normalizeLightingProgram(
        json(formData.get("lighting_program"))
      ),
      approved_optics: str(formData.get("approved_optics")) || null,
      energy_study_path: str(formData.get("energy_study_path")) || null,
      energy_study_name: str(formData.get("energy_study_name")) || null,
      dialux_path: str(formData.get("dialux_path")) || null,
      dialux_name: str(formData.get("dialux_name")) || null,
      ai_extracted: json(formData.get("ai_extracted")),
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from("product_lighting_setups")
      .select("id, ai_extracted")
      .eq("document_id", documentId)
      .maybeSingle();

    // Phase 2 (owner spec 2026-07-21) — MANUAL CORRECTIONS are detected here,
    // server-side, never self-reported: any AI-extracted field whose saved
    // value now differs is stamped `corrected` (who + when + both values).
    // The review map rides inside ai_extracted; the incoming blob (client) or
    // the stored one (server) provides the AI baseline — stored wins for the
    // existing review history.
    {
      const storedAi = ((existing as any)?.ai_extracted ?? null) as any;
      const incomingAi = (fields.ai_extracted ?? storedAi) as any;
      if (incomingAi?.fields) {
        const review = applyCorrectionsAfterSave({
          aiFields: incomingAi.fields,
          existingReview: normalizeAiReview(storedAi?.review ?? incomingAi?.review),
          saved: {
            lighting_power: fields.lighting_power,
            operating_hours: fields.operating_hours,
            lighting_program: fields.lighting_program,
          },
          userId: user.id,
          now: new Date().toISOString(),
        });
        fields.ai_extracted = { ...incomingAi, review };
      }
    }

    if (existing) {
      const { error } = await supabase
        .from("product_lighting_setups")
        .update(fields)
        .eq("document_id", documentId);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabase
        .from("product_lighting_setups")
        .insert({ document_id: documentId, created_by: user.id, ...fields });
      if (error) return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message ?? "Could not save the lighting setup.",
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — explicit "confirm" of an AI-extracted lighting value.
// ---------------------------------------------------------------------------
export type ConfirmAiFieldResult = { ok: true } | { ok: false; error: string };

/**
 * A human confirms one AI-extracted Energy-Study value (power / hours /
 * program) as reviewed-and-correct. Stored in the ai_extracted.review map;
 * a later manual correction overwrites it (the newer human act wins).
 * Refused once any task list of the command is frozen — and the m179 DB
 * trigger enforces that even if this check were bypassed.
 */
export async function confirmLightingAiField(
  formData: FormData
): Promise<ConfirmAiFieldResult> {
  try {
    await requireCapability("quotation.create");
    const documentId = str(formData.get("document_id"));
    const field = str(formData.get("field"));
    if (!documentId) return { ok: false, error: "Missing production command reference." };
    if (!isReviewableField(field)) return { ok: false, error: "Unknown AI field." };

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated." };

    // Frozen command → the review is part of the validated content.
    const { data: frozenTl } = await supabase
      .from("production_task_lists")
      .select("id, number, status")
      .eq("quotation_id", documentId);
    const frozen = (frozenTl ?? []).find((t: any) => isFrozenStatus(t.status));
    if (frozen) {
      return {
        ok: false,
        error: `Final Validation freeze — ${(frozen as any).number ?? "the task list"} is immutable. Open a controlled revision first.`,
      };
    }

    const { data: setup } = await supabase
      .from("product_lighting_setups")
      .select("id, ai_extracted")
      .eq("document_id", documentId)
      .maybeSingle();
    const ai = (setup as any)?.ai_extracted;
    if (!setup || !ai?.fields) {
      return { ok: false, error: "No AI extraction on this command yet." };
    }

    const review = normalizeAiReview(ai.review);
    review[field] = {
      state: "confirmed",
      by: user.id,
      at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("product_lighting_setups")
      .update({ ai_extracted: { ...ai, review } })
      .eq("document_id", documentId);
    if (error) return { ok: false, error: error.message };

    for (const t of frozenTl ?? []) revalidatePath(`/task-lists/${(t as any).id}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not confirm the value." };
  }
}

// --- local FormData coercers ----------------------------------------------
function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

/** Last path segment of a Storage key — the fallback "source document" name
 *  when the caller didn't pass the study's display name. */
function basename(p: string): string | null {
  const seg = p.split("/").filter(Boolean).pop();
  return seg && seg.trim() !== "" ? seg : null;
}
function num(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function json(v: FormDataEntryValue | null): any {
  if (typeof v !== "string" || v.trim() === "") return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
