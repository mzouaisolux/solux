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
import { extractLightingFromEnergyStudy } from "@/lib/lighting/extract-energy-study";
import { extractDialux } from "@/lib/lighting/extract-dialux";
import { normalizeLightingProgram } from "@/lib/lighting/validate";
import type { LightingExtraction, DialuxExtraction } from "@/lib/lighting/types";

export type ExtractEnergyStudyResult =
  | {
      ok: true;
      extraction: LightingExtraction;
      /** m159 — true when the detected tilt angle was written onto the task
       *  list (its field was still empty). False = field already had a value
       *  (manual override wins) or the migration isn't applied yet. */
      tiltApplied: boolean;
    }
  | { ok: false; error: string };

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

    // m159 — auto-populate the task list's Solar Panel Tilt Angle when the
    // Energy Study states it. NEVER overwrites: only fills a still-empty
    // field (manual values always win — the user can override afterwards).
    // Defensive: pre-m159 the column doesn't exist → silently skipped.
    let tiltApplied = false;
    const documentId = String(formData.get("document_id") ?? "").trim();
    if (documentId && extraction.tilt_angle != null) {
      const tilt = extraction.tilt_angle;
      if (tilt >= 0 && tilt <= 90) {
        const { data: updated, error: tiltErr } = await supabase
          .from("production_task_lists")
          .update({ solar_panel_tilt_angle: tilt })
          .eq("quotation_id", documentId)
          .is("solar_panel_tilt_angle", null)
          .select("id");
        tiltApplied = !tiltErr && (updated?.length ?? 0) > 0;
      }
    }

    return { ok: true, extraction, tiltApplied };
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
      /** 0..1 model confidence for the tilt field, when reported. */
      confidence: number | null;
      sourceName: string | null;
      /** 1-based page in the study, when the model could tell. */
      sourcePage: number | null;
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
    const { role } = await getCurrentUserRole();
    if (
      !isTechnicalRole(role) &&
      TASK_LIST_LOCKED_FOR_SALES.includes(tl.status as ProductionTaskListStatus)
    ) {
      return {
        ok: false,
        error: "This task list is in production validation — the tilt angle can no longer be edited by sales.",
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

    // Read-modify-write: reset the pole-drawing checkpoint ONLY when the
    // value actually changes (same contract as updateIndustrialFile).
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
    const oldTilt = (pre as any)?.solar_panel_tilt_angle ?? null;
    const patch: Record<string, any> = { solar_panel_tilt_angle: tilt };
    if ((oldTilt ?? null) !== tilt) {
      patch.pole_drawing_tilt_verified = false;
      patch.pole_drawing_tilt_verified_by = null;
      patch.pole_drawing_tilt_verified_at = null;
    }
    const { error: upErr } = await supabase
      .from("production_task_lists")
      .update(patch)
      .eq("id", taskListId);
    if (upErr) return { ok: false, error: upErr.message };

    revalidatePath(`/task-lists/${taskListId}`);
    const conf = extraction.confidence?.tilt_angle;
    return {
      ok: true,
      found: true,
      tilt,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
      sourceName,
      sourcePage:
        extraction.tilt_source_page != null && extraction.tilt_source_page >= 1
          ? Math.round(extraction.tilt_source_page)
          : null,
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
      .select("id")
      .eq("document_id", documentId)
      .maybeSingle();

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

// --- local FormData coercers ----------------------------------------------
function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
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
