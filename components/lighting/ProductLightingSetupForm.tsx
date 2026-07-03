"use client";

/**
 * Product Lighting Setup — editable "Lighting" tab on the production task list.
 *
 * Sales completes the APPROVED lighting configuration here while the task list
 * is draft: the Energy Study (PDF) + Dialux study (PDF/ZIP), lighting power, the
 * dimming program (a structured table), operating hours and the approved optic.
 * Optional "Auto-fill from Energy Study" pre-fills power / hours / program via
 * AI — manual values always win.
 *
 * NON-BLOCKING (owner decision): the section is transferred to the production
 * order but never blocks submission; an advisory banner lists what's still
 * missing. Files upload to Storage from the browser (paths only ride in the
 * save); the row is anchored on the command (proforma) so the production order
 * reads it back via its quotation_id.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { toast } from "@/components/feedback/toast-store";
import {
  ATTACHMENTS_BUCKET,
  ATTACHMENT_MAX_BYTES,
  formatFileSize,
} from "@/lib/attachments";
import {
  saveProductLightingSetup,
  extractEnergyStudyAction,
} from "@/app/(app)/lighting/actions";
import { OPTIC_PRESETS } from "@/lib/lighting/types";
import type {
  LightingProgramPeriod,
  LightingExtraction,
  LightingSetupRow,
} from "@/lib/lighting/types";
import {
  validateLightingSetup,
  normalizeLightingProgram,
  LIGHTING_FIELD_LABEL,
  type LightingField,
} from "@/lib/lighting/validate";

/** Confidence at/above which the extraction is shown as trustworthy (matches import). */
const AI_CONFIDENCE_MIN = 0.85;

type UploadedFile = { path: string; name: string; size: number };
type AiStatus =
  | { kind: "idle" }
  | { kind: "extracting" }
  | { kind: "ok"; note: string }
  | { kind: "verify"; note: string }
  | { kind: "error"; note: string };

function sanitize(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

const DEFAULT_PROGRAM: LightingProgramPeriod[] = [
  { output: 100, duration_hours: 5 },
];

export default function ProductLightingSetupForm({
  documentId,
  affairId = null,
  clientId = null,
  initial = null,
  editable = true,
}: {
  /** The production command (proforma) id — the anchor for the setup row. */
  documentId: string;
  affairId?: string | null;
  clientId?: string | null;
  initial?: Partial<LightingSetupRow> | null;
  editable?: boolean;
}) {
  const router = useRouter();

  const [power, setPower] = useState(
    initial?.lighting_power != null ? String(initial.lighting_power) : ""
  );
  const [hours, setHours] = useState(
    initial?.operating_hours != null ? String(initial.operating_hours) : ""
  );
  const [optics, setOptics] = useState(initial?.approved_optics ?? "");
  const [program, setProgram] = useState<LightingProgramPeriod[]>(() => {
    const p = normalizeLightingProgram(initial?.lighting_program ?? []);
    return p.length ? p : DEFAULT_PROGRAM;
  });
  const [energyStudy, setEnergyStudy] = useState<UploadedFile | null>(
    initial?.energy_study_path
      ? {
          path: initial.energy_study_path,
          name: initial.energy_study_name ?? "Energy Study",
          size: 0,
        }
      : null
  );
  const [dialux, setDialux] = useState<UploadedFile | null>(
    initial?.dialux_path
      ? {
          path: initial.dialux_path,
          name: initial.dialux_name ?? "Dialux Study",
          size: 0,
        }
      : null
  );
  const [uploading, setUploading] = useState<"energy" | "dialux" | null>(null);
  const [ai, setAi] = useState<AiStatus>({ kind: "idle" });
  const [aiProvenance, setAiProvenance] = useState<any | null>(
    initial?.ai_extracted ?? null
  );
  const [pending, startTransition] = useTransition();

  const validation = useMemo(
    () =>
      validateLightingSetup({
        lighting_power: power.trim() === "" ? null : Number(power),
        operating_hours: hours.trim() === "" ? null : Number(hours),
        lighting_program: normalizeLightingProgram(program),
        approved_optics: optics.trim() || null,
        energy_study_path: energyStudy?.path ?? null,
      }),
    [power, hours, program, optics, energyStudy]
  );

  // ---- uploads ------------------------------------------------------------
  async function upload(kind: "energy" | "dialux", file: File) {
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error(
        `"${file.name}" is too large (max ${formatFileSize(ATTACHMENT_MAX_BYTES)}).`
      );
      return;
    }
    setUploading(kind);
    try {
      const supabase = createBrowserSupabase();
      const path = `lighting/${documentId}/${Date.now()}-${kind}-${sanitize(
        file.name
      )}`;
      const { error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (error) throw new Error(error.message);
      const rec = { path, name: file.name, size: file.size };
      if (kind === "energy") {
        setEnergyStudy(rec);
        setAi({ kind: "idle" }); // a new study invalidates any prior extraction
      } else {
        setDialux(rec);
      }
      toast.success(`${file.name} uploaded.`);
    } catch (e: any) {
      toast.error(e?.message || "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  // ---- AI auto-fill -------------------------------------------------------
  function autoFill() {
    if (!energyStudy) return;
    setAi({ kind: "extracting" });
    startTransition(async () => {
      const fd = new FormData();
      fd.set("storage_path", energyStudy.path);
      const res = await extractEnergyStudyAction(fd);
      if (!res.ok) {
        setAi({
          kind: "error",
          note: `${res.error} You can still enter the values manually.`,
        });
        return;
      }
      applyExtraction(res.extraction);
    });
  }

  function applyExtraction(ex: LightingExtraction) {
    // Manual values always win — only fill fields the user left empty.
    if (power.trim() === "" && ex.lighting_power != null) {
      setPower(String(ex.lighting_power));
    }
    if (hours.trim() === "" && ex.operating_hours != null) {
      setHours(String(ex.operating_hours));
    }
    const cleanProgram = normalizeLightingProgram(ex.lighting_program);
    const programIsUntouched =
      program.length === 0 ||
      (program.length === 1 &&
        program[0].output === 100 &&
        program[0].duration_hours === 5);
    if (cleanProgram.length && programIsUntouched) {
      setProgram(cleanProgram);
    }

    setAiProvenance({
      fields: {
        lighting_power: ex.lighting_power,
        operating_hours: ex.operating_hours,
        lighting_program: cleanProgram,
      },
      confidence: ex.confidence,
      model: ex.model,
      extracted_at: new Date().toISOString(),
    });

    const confs = Object.values(ex.confidence ?? {}).filter((n) =>
      Number.isFinite(n)
    );
    const minConf = confs.length ? Math.min(...confs) : 0;
    if (minConf >= AI_CONFIDENCE_MIN) {
      setAi({ kind: "ok", note: "Successfully extracted — review the values." });
    } else {
      setAi({
        kind: "verify",
        note: "Please verify the extracted values before continuing.",
      });
    }
  }

  // ---- program editor -----------------------------------------------------
  function addPeriod() {
    setProgram((p) => [...p, { output: 100, duration_hours: 1 }]);
  }
  function removePeriod(i: number) {
    setProgram((p) => p.filter((_, idx) => idx !== i));
  }
  function updatePeriod(
    i: number,
    field: keyof LightingProgramPeriod,
    value: string
  ) {
    const n = value === "" ? NaN : Number(value);
    setProgram((p) =>
      p.map((row, idx) =>
        idx === i ? { ...row, [field]: Number.isFinite(n) ? n : 0 } : row
      )
    );
  }
  function move(i: number, dir: -1 | 1) {
    setProgram((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  // ---- save ---------------------------------------------------------------
  function save() {
    const fd = new FormData();
    fd.set("document_id", documentId);
    if (affairId) fd.set("affair_id", affairId);
    if (clientId) fd.set("client_id", clientId);
    fd.set("lighting_power", power.trim());
    fd.set("operating_hours", hours.trim());
    fd.set("approved_optics", optics.trim());
    fd.set("lighting_program", JSON.stringify(normalizeLightingProgram(program)));
    if (energyStudy) {
      fd.set("energy_study_path", energyStudy.path);
      fd.set("energy_study_name", energyStudy.name);
    }
    if (dialux) {
      fd.set("dialux_path", dialux.path);
      fd.set("dialux_name", dialux.name);
    }
    if (aiProvenance) fd.set("ai_extracted", JSON.stringify(aiProvenance));

    startTransition(async () => {
      const res = await saveProductLightingSetup(fd);
      if (res.ok) {
        toast.success("Lighting setup saved.");
        router.refresh();
      } else {
        toast.error(res.error || "Could not save the lighting setup.");
      }
    });
  }

  const busy = pending || uploading !== null;
  const disabled = !editable;

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-600">
        Configure the lighting parameters and upload the technical studies used
        during production, controller programming and quality control. This is
        transferred to Operations and Manufacturing with the production order.
      </p>

      {!editable && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
          Read-only — the lighting setup can be edited by the deal owner while
          the task list is draft.
        </div>
      )}

      {/* Documents -------------------------------------------------------- */}
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-700">
          Documents
        </h4>
        <FileRow
          label="Energy Study"
          required
          hint="PDF · technical reference for power, operating hours, program, dimming, battery sizing."
          accept=".pdf,application/pdf"
          uploaded={energyStudy}
          busy={uploading === "energy"}
          disabled={disabled}
          onPick={(f) => upload("energy", f)}
        />
        <FileRow
          label="Dialux Study"
          hint="PDF or ZIP · approved lighting calculation (optional)."
          accept=".pdf,.zip,application/pdf,application/zip,application/x-zip-compressed"
          uploaded={dialux}
          busy={uploading === "dialux"}
          disabled={disabled}
          onPick={(f) => upload("dialux", f)}
        />

        {/* AI auto-fill */}
        <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-neutral-600">
              <span className="font-semibold text-neutral-800">
                Optional AI assistance.
              </span>{" "}
              Extract Lighting Power, Operating Hours and the Program from the
              Energy Study.
            </div>
            <button
              type="button"
              onClick={autoFill}
              disabled={!energyStudy || ai.kind === "extracting" || busy || disabled}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
              title={
                energyStudy
                  ? "Analyze the Energy Study"
                  : "Upload the Energy Study first"
              }
            >
              {ai.kind === "extracting"
                ? "Analyzing…"
                : "Auto-fill from Energy Study"}
            </button>
          </div>
          {ai.kind === "ok" && (
            <p className="mt-2 text-xs font-medium text-emerald-700">
              ✅ {ai.note}
            </p>
          )}
          {ai.kind === "verify" && (
            <p className="mt-2 text-xs font-medium text-amber-700">⚠ {ai.note}</p>
          )}
          {ai.kind === "error" && (
            <p className="mt-2 text-xs font-medium text-neutral-500">
              {ai.note}
            </p>
          )}
        </div>
      </section>

      {/* Configuration ---------------------------------------------------- */}
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-700">
          Lighting configuration
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="label">Lighting Power (W)</span>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              value={power}
              onChange={(e) => setPower(e.target.value)}
              placeholder="e.g. 60"
              className="input"
              disabled={disabled}
            />
          </label>
          <label className="block">
            <span className="label">Operating Hours (per night)</span>
            <input
              type="number"
              min="0"
              step="0.5"
              inputMode="decimal"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder="e.g. 12"
              className="input"
              disabled={disabled}
            />
          </label>
          <label className="block">
            <span className="label">Approved Optics</span>
            <input
              type="text"
              list="lighting-optics-presets"
              value={optics}
              onChange={(e) => setOptics(e.target.value)}
              placeholder="Select or type…"
              className="input"
              disabled={disabled}
            />
            <datalist id="lighting-optics-presets">
              {OPTIC_PRESETS.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </label>
        </div>

        {/* Program table */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="label mb-0">Lighting Program</span>
            {!disabled && (
              <button
                type="button"
                onClick={addPeriod}
                className="text-xs font-semibold text-solux hover:underline"
              >
                + Add period
              </button>
            )}
          </div>
          <div className="overflow-hidden rounded-md border border-neutral-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="text-left font-semibold px-3 py-2">
                    Output (%)
                  </th>
                  <th className="text-left font-semibold px-3 py-2">
                    Duration (h)
                  </th>
                  {!disabled && <th className="px-3 py-2 w-24" />}
                </tr>
              </thead>
              <tbody>
                {program.length === 0 && (
                  <tr>
                    <td
                      colSpan={disabled ? 2 : 3}
                      className="px-3 py-3 text-xs text-neutral-400"
                    >
                      No period yet — add at least one.
                    </td>
                  </tr>
                )}
                {program.map((row, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={Number.isFinite(row.output) ? row.output : ""}
                        onChange={(e) =>
                          updatePeriod(i, "output", e.target.value)
                        }
                        className="input py-1.5"
                        disabled={disabled}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={
                          Number.isFinite(row.duration_hours)
                            ? row.duration_hours
                            : ""
                        }
                        onChange={(e) =>
                          updatePeriod(i, "duration_hours", e.target.value)
                        }
                        className="input py-1.5"
                        disabled={disabled}
                      />
                    </td>
                    {!disabled && (
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1 justify-end text-neutral-500">
                          <button
                            type="button"
                            onClick={() => move(i, -1)}
                            disabled={i === 0}
                            className="px-1.5 py-0.5 rounded hover:bg-neutral-100 disabled:opacity-30"
                            title="Move up"
                            aria-label="Move up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => move(i, 1)}
                            disabled={i === program.length - 1}
                            className="px-1.5 py-0.5 rounded hover:bg-neutral-100 disabled:opacity-30"
                            title="Move down"
                            aria-label="Move down"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removePeriod(i)}
                            className="px-1.5 py-0.5 rounded hover:bg-red-50 text-red-500"
                            title="Delete period"
                            aria-label="Delete period"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">
            Any number of dimming periods, in order. Stored as structured data
            for controller programming and QC.
          </p>
        </div>
      </section>

      {/* Advisory (non-blocking) + save ---------------------------------- */}
      {!validation.ok && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Incomplete —</span> still needed:{" "}
          {validation.missing
            .map((m: LightingField) => LIGHTING_FIELD_LABEL[m])
            .join(", ")}
          . You can still save and submit; complete it before production.
        </div>
      )}
      {validation.ok && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          ✓ Lighting setup complete.
        </div>
      )}

      {editable && (
        <div className="flex items-center justify-end pt-1">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-solux px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-solux-dark disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save lighting setup"}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File row
// ---------------------------------------------------------------------------
function FileRow({
  label,
  hint,
  accept,
  uploaded,
  busy,
  required = false,
  disabled = false,
  onPick,
}: {
  label: string;
  hint: string;
  accept: string;
  uploaded: UploadedFile | null;
  busy: boolean;
  required?: boolean;
  disabled?: boolean;
  onPick: (f: File) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-neutral-200 bg-white p-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-neutral-800">
          {label}
          {required ? (
            <span className="ml-1 text-red-500" title="Required">
              *
            </span>
          ) : (
            <span className="ml-1 text-[11px] font-normal text-neutral-400">
              (optional)
            </span>
          )}
        </div>
        <div className="text-xs text-neutral-500">{hint}</div>
        {uploaded && (
          <div className="mt-1 text-xs text-emerald-700 font-medium truncate">
            ✓ {uploaded.name}{" "}
            {uploaded.size > 0 && (
              <span className="text-neutral-400 font-normal">
                ({formatFileSize(uploaded.size)})
              </span>
            )}
          </div>
        )}
      </div>
      {!disabled && (
        <label className="shrink-0 cursor-pointer inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50">
          {busy ? "Uploading…" : uploaded ? "Replace" : "Upload"}
          <input
            type="file"
            accept={accept}
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
        </label>
      )}
    </div>
  );
}
