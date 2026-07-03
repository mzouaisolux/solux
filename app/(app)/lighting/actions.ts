"use server";

/**
 * Product Lighting Setup — server actions.
 *
 * Only the OPTIONAL "Auto-fill from Energy Study" lives here: it reads the PDF
 * the user already uploaded to Storage and runs the Claude extractor. Saving the
 * setup is NOT here — it happens inside launchProduction (the launch gate), so
 * the config is written in the same transaction as the production command.
 */

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/permissions";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments";
import { extractLightingFromEnergyStudy } from "@/lib/lighting/extract-energy-study";
import { normalizeLightingProgram } from "@/lib/lighting/validate";
import type { LightingExtraction } from "@/lib/lighting/types";

export type ExtractEnergyStudyResult =
  | { ok: true; extraction: LightingExtraction }
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
    return { ok: true, extraction };
  } catch (e: any) {
    return {
      ok: false,
      error:
        e?.message ??
        "Auto-fill failed. Please enter the lighting values manually.",
    };
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
