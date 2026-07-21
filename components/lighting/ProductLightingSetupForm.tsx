"use client";

/**
 * Product Lighting Setup — production validation workspace (task list "Lighting" tab).
 *
 * ONE vertical workflow card (owner spec 2026-07-05): everything lives inside
 * "Final Production Configuration", top to bottom mirroring the real flow —
 *
 *   ⚠ Mismatch alerts (outside, unmissable)
 *   ┌ Final Production Configuration ─────────────────────────────┐
 *   │ 🟢/🟠/🔴 verdict — can I launch production or not?           │
 *   │ 📄 Technical documents (OPTIONAL) — upload, ✨ Analyze,      │
 *   │    AI summary + extracted parameters per configuration      │
 *   │ Approved Power / Optics / Hours  |  LIGHTING PROGRAM        │
 *   │    (with provenance + kept originals)   (bars + editor)     │
 *   │ Save lighting setup                                          │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * BOTH workflows are first-class (owner rule: documents PROPOSE, the human
 * VALIDATES, production EXECUTES — AI is an aid, never an obligation):
 *   assisted: upload → analyze → validate → production
 *   manual:   direct entry → production (no documents, no analysis)
 * Completeness therefore ignores documents (lib/lighting/validate.ts).
 */

import { useEffect, useMemo, useState, useTransition } from "react";
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
  extractDialuxAction,
} from "@/app/(app)/lighting/actions";
import type { TiltOutcome } from "@/app/(app)/lighting/actions";
import { OPTIC_PRESETS } from "@/lib/lighting/types";
import type {
  LightingProgramPeriod,
  LightingExtraction,
  LightingSetupRow,
  DialuxProvenance,
} from "@/lib/lighting/types";
import {
  validateLightingSetup,
  normalizeLightingProgram,
  totalProgramHours,
  LIGHTING_FIELD_LABEL,
  type LightingField,
} from "@/lib/lighting/validate";
import {
  formatApprovedOptics,
  parseApprovedOptics,
  aggregateDialuxOptics,
  sameOpticsBreakdown,
  type OpticEntry,
} from "@/lib/lighting/optics";

/** Confidence at/above which the extraction is shown as trustworthy (matches import). */
const AI_CONFIDENCE_MIN = 0.85;

/** Rotating lines for the animated "AI is reading" state. */
const ANALYZE_MESSAGES = [
  "Analyzing lighting layout…",
  "Extracting optics…",
  "Detecting mounting height…",
  "Reading operating program…",
];

type UploadedFile = { path: string; name: string; size: number; at?: string };
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
  // Approved Optics = a PRODUCTION BREAKDOWN (optic → luminaire count), not a
  // plain value (owner 2026-07-05). Edited as structured rows, serialized into
  // the existing TEXT column via lib/lighting/optics ("T35 ×3 + T38 ×3").
  const [opticEntries, setOpticEntries] = useState<OpticEntry[]>(() =>
    parseApprovedOptics(initial?.approved_optics)
  );
  const optics = formatApprovedOptics(opticEntries);
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
  // The persisted AI provenance splits in two: the Energy-Study half (fields/
  // confidence) and the Dialux half — merged back into one ai_extracted JSON
  // on save so either assist can run alone.
  const [aiProvenance, setAiProvenance] = useState<any | null>(() => {
    const prov: any = initial?.ai_extracted ?? null;
    if (!prov) return null;
    const { dialux: _d, ...rest } = prov;
    return Object.keys(rest).length ? rest : null;
  });
  const [dialuxProv, setDialuxProv] = useState<DialuxProvenance | null>(
    (initial?.ai_extracted as any)?.dialux ?? null
  );
  const [dialuxAi, setDialuxAi] = useState<AiStatus>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsgIdx, setAnalyzeMsgIdx] = useState(0);
  // AI details (summary + extracted parameters) — open right after an analysis,
  // collapsed by default on a validated/saved setup to keep the screen compact.
  const [aiDetailsOpen, setAiDetailsOpen] = useState(false);
  // In-page document preview (drawer with the signed PDF) — review an optic or
  // a mounting height during validation without losing the page context.
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(
    null
  );

  useEffect(() => {
    if (!analyzing) return;
    const t = window.setInterval(
      () => setAnalyzeMsgIdx((i) => (i + 1) % ANALYZE_MESSAGES.length),
      1100
    );
    return () => window.clearInterval(t);
  }, [analyzing]);

  useEffect(() => {
    if (!preview) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [preview]);

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
      const rec: UploadedFile = {
        path,
        name: file.name,
        size: file.size,
        at: new Date().toISOString(),
      };
      if (kind === "energy") {
        setEnergyStudy(rec);
        setAi({ kind: "idle" }); // a new study invalidates any prior extraction
      } else {
        setDialux(rec);
        setDialuxAi({ kind: "idle" }); // ditto for a replaced Dialux report
      }
      toast.success(`${file.name} uploaded.`);
    } catch (e: any) {
      toast.error(e?.message || "Upload failed.");
    } finally {
      setUploading(null);
    }
  }

  /** Open a study in a new tab via a short-lived signed URL (private bucket). */
  async function openDoc(path: string) {
    try {
      const supabase = createBrowserSupabase();
      const { data, error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(path, 600);
      if (error || !data?.signedUrl) throw new Error(error?.message);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message || "Could not open the document.");
    }
  }

  /** Preview a study in the in-page drawer (PDFs only — ZIP falls back to Open). */
  async function previewDoc(path: string, name: string) {
    if (/\.zip$/i.test(path)) {
      // Browsers can't render ZIP archives inline — open/download instead.
      return openDoc(path);
    }
    try {
      const supabase = createBrowserSupabase();
      const { data, error } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(path, 600);
      if (error || !data?.signedUrl) throw new Error(error?.message);
      setPreview({ name, url: data.signedUrl });
    } catch (e: any) {
      toast.error(e?.message || "Could not preview the document.");
    }
  }

  // ---- AI analysis (one CTA runs both available extractions) ---------------
  async function runEnergy() {
    if (!energyStudy) return;
    setAi({ kind: "extracting" });
    const fd = new FormData();
    fd.set("storage_path", energyStudy.path);
    // m176 — lets the action record the study's tilt angle against the task
    // list (applying it, or raising a conflict when it disagrees).
    fd.set("document_id", documentId);
    fd.set("source_name", energyStudy.name);
    const res = await extractEnergyStudyAction(fd);
    if (!res.ok) {
      setAi({
        kind: "error",
        note: `${res.error} You can still enter the values manually.`,
      });
      return;
    }
    applyExtraction(res.extraction, res.tilt);
  }

  function applyExtraction(ex: LightingExtraction, tilt: TiltOutcome = { kind: "none" }) {
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
        tilt_angle: ex.tilt_angle ?? null, // m159 — audit of the auto-fill
      },
      confidence: ex.confidence,
      model: ex.model,
      extracted_at: new Date().toISOString(),
    });

    const confs = Object.values(ex.confidence ?? {}).filter((n) =>
      Number.isFinite(n)
    );
    // m176 — surface what happened to the tilt. A CONFLICT is the important
    // case: production was left untouched and someone must settle it in the
    // Industrial production file, so say that explicitly rather than the old
    // "it was kept" whisper that hid the disagreement entirely.
    let tiltNote = "";
    if (tilt.kind === "applied") {
      tiltNote = ` Tilt angle ${tilt.tilt}° detected — applied to the task list (override it there if needed).`;
    } else if (tilt.kind === "conflict") {
      tiltNote = tilt.ambiguous
        ? ` The study states several tilt angles (${tilt.tilt}° among them) — the task list keeps ${
            tilt.stored != null ? `${tilt.stored}°` : "its value"
          } until someone confirms which applies, in the Industrial production file.`
        : ` Tilt angle ${tilt.tilt}° detected, but the task list says ${
            tilt.stored != null ? `${tilt.stored}°` : "something else"
          } — resolve the conflict in the Industrial production file.`;
    } else if (tilt.kind === "unavailable" && ex.tilt_angle != null) {
      tiltNote = ` Tilt angle ${ex.tilt_angle}° detected — it could not be recorded (apply migration m176).`;
    }
    const minConf = confs.length ? Math.min(...confs) : 0;
    if (tilt.kind === "conflict") {
      setAi({ kind: "verify", note: `Successfully extracted — review the values.${tiltNote}` });
    } else if (minConf >= AI_CONFIDENCE_MIN) {
      setAi({ kind: "ok", note: `Successfully extracted — review the values.${tiltNote}` });
    } else {
      setAi({
        kind: "verify",
        note: `Please verify the extracted values before continuing.${tiltNote}`,
      });
    }
    if (tilt.kind === "applied" || tilt.kind === "conflict") router.refresh();
    setAiDetailsOpen(true); // fresh analysis → open the details for review
  }

  async function runDialux() {
    if (!dialux) return;
    setDialuxAi({ kind: "extracting" });
    const fd = new FormData();
    fd.set("storage_path", dialux.path);
    const res = await extractDialuxAction(fd);
    if (!res.ok) {
      setDialuxAi({
        kind: "error",
        note: `${res.error} You can still enter the values manually.`,
      });
      return;
    }
    const configs = res.extraction.configurations;
    setDialuxProv({
      configurations: configs,
      model: res.extraction.model,
      extracted_at: new Date().toISOString(),
    });

    // Pre-fill the production breakdown (optic → luminaire count) when the
    // user hasn't entered anything yet — the full aggregation is unambiguous
    // even with several optics. Functional update → no stale closure.
    const breakdown = aggregateDialuxOptics(configs);
    if (breakdown.length) {
      setOpticEntries((cur) =>
        cur.some((e) => e.optic.trim() !== "") ? cur : breakdown
      );
    }

    // Status: min confidence over the fields that actually carry a value.
    let minConf = 1;
    let any = false;
    for (const c of configs) {
      const checks: Array<[unknown, number | undefined]> = [
        [c.power, c.confidence?.power],
        [c.mounting_height, c.confidence?.mounting_height],
        [
          c.optic_code ?? c.optic_beam_distribution ?? c.optic_lens_type,
          c.confidence?.optic,
        ],
        [c.cct, c.confidence?.cct],
        [c.quantity, c.confidence?.quantity],
      ];
      for (const [v, conf] of checks) {
        if (v != null && Number.isFinite(conf)) {
          any = true;
          minConf = Math.min(minConf, conf as number);
        }
      }
    }
    if (any && minConf >= AI_CONFIDENCE_MIN) {
      setDialuxAi({
        kind: "ok",
        note: `${configs.length} configuration(s) extracted — review below.`,
      });
    } else {
      setDialuxAi({
        kind: "verify",
        note: "Please verify the extracted configuration values.",
      });
    }
    setAiDetailsOpen(true); // fresh analysis → open the details for review
  }

  /** The single "✨ Analyze Documents" CTA — runs every available extraction. */
  function analyzeAll() {
    if (!energyStudy && !dialux) return;
    setAnalyzing(true);
    setAnalyzeMsgIdx(0);
    startTransition(async () => {
      try {
        await Promise.all([
          energyStudy ? runEnergy() : Promise.resolve(),
          dialux ? runDialux() : Promise.resolve(),
        ]);
      } finally {
        setAnalyzing(false);
      }
    });
  }

  // ---- program editor -------------------------------------------------------
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
  function toggleDetection(i: number) {
    setProgram((p) =>
      p.map((row, idx) => {
        if (idx !== i) return row;
        if (row.presence_detection) {
          const {
            presence_detection,
            detection_output,
            detection_hold_seconds,
            estimated_detections,
            ...rest
          } = row;
          return rest;
        }
        return {
          ...row,
          presence_detection: true,
          detection_output: 100,
          detection_hold_seconds: 40,
          estimated_detections: null,
        };
      })
    );
  }
  function updateDetection(
    i: number,
    field:
      | "detection_output"
      | "detection_hold_seconds"
      | "estimated_detections",
    value: string
  ) {
    const n = value === "" ? null : Number(value);
    setProgram((p) =>
      p.map((row, idx) =>
        idx === i
          ? { ...row, [field]: n != null && Number.isFinite(n) ? n : null }
          : row
      )
    );
  }

  // ---- save -------------------------------------------------------------------
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
    // Merge both AI halves back into one provenance object (either may be null).
    const prov: any = {};
    if (aiProvenance) Object.assign(prov, aiProvenance);
    if (dialuxProv) prov.dialux = dialuxProv;
    if (Object.keys(prov).length) fd.set("ai_extracted", JSON.stringify(prov));

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

  const busy = pending || uploading !== null || analyzing;
  const disabled = !editable;

  // ---- derived: AI + consistency ------------------------------------------------
  const hasEnergyAi = !!aiProvenance?.fields;
  const hasDialuxAi = !!dialuxProv?.configurations?.length;
  const hasAi = hasEnergyAi || hasDialuxAi;

  const powerNum = power.trim() === "" ? null : Number(power);
  const energyPower: number | null =
    aiProvenance?.fields?.lighting_power ?? null;
  const dialuxPowers = (dialuxProv?.configurations ?? [])
    .map((c) => c.power)
    .filter((p): p is number => p != null);
  const distinctDialuxPowers = Array.from(new Set(dialuxPowers));
  const distinctDialuxOptics = Array.from(
    new Set(
      (dialuxProv?.configurations ?? [])
        .map(
          (c) => c.optic_code ?? c.optic_beam_distribution ?? c.optic_lens_type
        )
        .filter((v): v is string => !!v)
    )
  );

  // The Dialux-derived production breakdown (optic → summed luminaire count) —
  // the reference the approved breakdown is compared against.
  const dialuxBreakdown = aggregateDialuxOptics(dialuxProv?.configurations ?? []);
  const filledOpticEntries = opticEntries.filter((e) => e.optic.trim() !== "");
  const opticsCoveredByDialux =
    filledOpticEntries.length > 0 &&
    filledOpticEntries.every((e) =>
      distinctDialuxOptics.some(
        (o) => o.toLowerCase() === e.optic.trim().toLowerCase()
      )
    );

  // Approved-optics row editing.
  function updateOpticEntry(i: number, patch: Partial<OpticEntry>) {
    setOpticEntries((es) =>
      es.map((e, idx) => (idx === i ? { ...e, ...patch } : e))
    );
  }
  function removeOpticEntry(i: number) {
    setOpticEntries((es) => es.filter((_, idx) => idx !== i));
  }
  function addOpticEntry() {
    setOpticEntries((es) => [...es, { optic: "", quantity: null }]);
  }

  // Cross-document / cross-field inconsistencies → prominent alerts (never
  // blocking: the approved values below stay the human decision).
  const alerts = useMemo(() => {
    const out: Array<{ title: string; lines: string[] }> = [];
    if (distinctDialuxPowers.length) {
      if (
        energyPower != null &&
        distinctDialuxPowers.some((p) => p !== energyPower)
      ) {
        out.push({
          title: "Power mismatch",
          lines: [
            `Energy Study → ${energyPower} W`,
            `Dialux → ${distinctDialuxPowers.join(" / ")} W`,
          ],
        });
      } else if (
        energyPower == null &&
        powerNum != null &&
        distinctDialuxPowers.some((p) => p !== powerNum)
      ) {
        out.push({
          title: "Power mismatch",
          lines: [
            `Approved Power → ${powerNum} W`,
            `Dialux → ${distinctDialuxPowers.join(" / ")} W`,
          ],
        });
      }
    }
    if (
      optics.trim() !== "" &&
      distinctDialuxOptics.length > 0 &&
      !opticsCoveredByDialux // a combination like "T35 + T38" is consistent
    ) {
      out.push({
        title: "Optics mismatch",
        lines: [
          `Dialux → ${distinctDialuxOptics.join(", ")}`,
          `Approved Optics → ${optics.trim()}`,
        ],
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [energyPower, powerNum, optics, dialuxProv]);

  // Simple overall confidence indicator: the minimum confidence over every
  // value-bearing extracted field.
  const minConfidence = useMemo(() => {
    let min: number | null = null;
    const consider = (v: unknown, conf: number | undefined) => {
      if (v != null && Number.isFinite(conf)) {
        min = min == null ? (conf as number) : Math.min(min, conf as number);
      }
    };
    const ef = aiProvenance?.fields ?? {};
    const ec = aiProvenance?.confidence ?? {};
    consider(ef.lighting_power, ec.lighting_power);
    consider(ef.operating_hours, ec.operating_hours);
    consider((ef.lighting_program ?? []).length || null, ec.lighting_program);
    for (const c of dialuxProv?.configurations ?? []) {
      consider(c.power, c.confidence?.power);
      consider(c.mounting_height, c.confidence?.mounting_height);
      consider(
        c.optic_code ?? c.optic_beam_distribution ?? c.optic_lens_type,
        c.confidence?.optic
      );
      consider(c.cct, c.confidence?.cct);
      consider(c.quantity, c.confidence?.quantity);
    }
    return min;
  }, [aiProvenance, dialuxProv]);

  const normalizedProgram = normalizeLightingProgram(program);
  const programTotal = totalProgramHours(normalizedProgram);

  /** 🟡 marker for a low-confidence extracted value. */
  const low = (conf: number | undefined) =>
    Number.isFinite(conf) && (conf as number) < AI_CONFIDENCE_MIN ? "🟡 " : "";

  // Validation verdict — the one thing a production manager needs instantly.
  const prodStatus: "ready" | "review" | "missing" = !validation.ok
    ? "missing"
    : alerts.length > 0
      ? "review"
      : "ready";

  // Provenance of each APPROVED value ("why did we pick T35?" → answered
  // without reopening the PDFs). Business rule: documents PROPOSE, the human
  // VALIDATES, production EXECUTES — so the AI never locks anything, and the
  // trace distinguishes:
  //   🟢 <doc>          — value matches the document's extraction exactly
  //   🟡 <doc> (edited) — the document proposed it, a human adjusted it
  //                        (the ORIGINAL is kept and shown for audits)
  //   🔵 Manual         — no document ever proposed this field
  // "(edited)" only applies to the document that actually FEEDS the field
  // (Energy Study → power/hours/program; Dialux → optics). Originals come from
  // the persisted ai_extracted provenance — no extra storage needed.
  type Provenance = {
    icon: "🟢" | "🟡" | "🔵";
    label: string;
    original?: string;
    current?: string;
  };

  const provPower: Provenance | null = (() => {
    if (powerNum == null) return null;
    if (energyPower != null) {
      return powerNum === energyPower
        ? { icon: "🟢", label: "Energy Study" }
        : {
            icon: "🟡",
            label: "Energy Study (edited)",
            original: `${energyPower} W`,
            current: `${powerNum} W`,
          };
    }
    // Dialux is a cross-check for power, not its feed: an exact match is worth
    // crediting, anything else is a human decision (the alert flags mismatches).
    if (dialuxPowers.includes(powerNum)) return { icon: "🟢", label: "Dialux" };
    return { icon: "🔵", label: "Manual" };
  })();

  const provHours: Provenance | null = (() => {
    if (hours.trim() === "") return null;
    const h = Number(hours);
    const eh = aiProvenance?.fields?.operating_hours ?? null;
    if (eh != null) {
      return h === eh
        ? { icon: "🟢", label: "Energy Study" }
        : {
            icon: "🟡",
            label: "Energy Study (edited)",
            original: `${eh} h`,
            current: `${h} h`,
          };
    }
    return { icon: "🔵", label: "Manual" };
  })();

  const provOptics: Provenance | null = (() => {
    if (filledOpticEntries.length === 0) return null;
    if (dialuxBreakdown.length) {
      // 🟢 only when the approved breakdown (optics AND counts) matches the
      // report exactly; any adjustment keeps the original for the audit trail.
      return sameOpticsBreakdown(filledOpticEntries, dialuxBreakdown)
        ? { icon: "🟢", label: "Dialux" }
        : {
            icon: "🟡",
            label: "Dialux (edited)",
            original: formatApprovedOptics(dialuxBreakdown),
            current: optics,
          };
    }
    return { icon: "🔵", label: "Manual" };
  })();

  const provProgram: Provenance | null = (() => {
    if (!normalizedProgram.length) return null;
    const aiProg = normalizeLightingProgram(
      aiProvenance?.fields?.lighting_program ?? []
    );
    if (aiProg.length) {
      const same = JSON.stringify(aiProg) === JSON.stringify(normalizedProgram);
      return same
        ? { icon: "🟢", label: "Energy Study" }
        : {
            icon: "🟡",
            label: "Energy Study (edited)",
            original: `${aiProg.length} period${aiProg.length > 1 ? "s" : ""} • ${totalProgramHours(aiProg)} h`,
            current: `${normalizedProgram.length} period${normalizedProgram.length > 1 ? "s" : ""} • ${programTotal} h`,
          };
    }
    return { icon: "🔵", label: "Manual" };
  })();

  // ---- render --------------------------------------------------------------------
  return (
    <div className="space-y-5">
      {!editable && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
          Read-only — the lighting setup can be edited by the deal owner while
          the task list is draft.
        </div>
      )}

      {/* ============ INCONSISTENCY ALERTS — impossible to miss ============ */}
      {alerts.map((a) => (
        <div
          key={a.title}
          className="rounded-lg border-2 border-amber-400 bg-amber-50 px-4 py-3"
        >
          <div className="text-sm font-bold text-amber-900">⚠ {a.title}</div>
          <div className="mt-1 space-y-0.5">
            {a.lines.map((l) => (
              <div key={l} className="text-sm text-amber-900 tabular-nums">
                {l}
              </div>
            ))}
          </div>
          <div className="mt-1.5 text-xs font-semibold text-amber-800">
            Manual review required.
          </div>
        </div>
      ))}

      {/* ============ FINAL PRODUCTION CONFIGURATION — one workflow ============ */}
      <section className="rounded-lg border-2 border-neutral-900 bg-white p-5 space-y-5">
        <div>
          <h4 className="text-base font-bold text-neutral-900">
            Final Production Configuration
          </h4>
          <p className="mt-0.5 text-xs text-neutral-500">
            This is exactly what will be sent to production, controller
            programming and quality control.
          </p>
        </div>

        {/* Validation verdict — can I launch production or not? */}
        {prodStatus === "ready" && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2.5">
            <span className="text-sm font-extrabold tracking-wide text-emerald-800">
              🟢 READY FOR PRODUCTION
            </span>
            <span className="ml-2 text-xs text-emerald-700">
              All required data is present and consistent.
            </span>
          </div>
        )}
        {prodStatus === "review" && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5">
            <span className="text-sm font-extrabold tracking-wide text-amber-800">
              🟠 REVIEW REQUIRED
            </span>
            <span className="ml-2 text-xs text-amber-700">
              {alerts.length} inconsistenc{alerts.length > 1 ? "ies" : "y"}{" "}
              flagged above — resolve before launching production.
            </span>
          </div>
        )}
        {prodStatus === "missing" && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2.5">
            <span className="text-sm font-extrabold tracking-wide text-red-800">
              🔴 MISSING INFORMATION
            </span>
            <span className="ml-2 text-xs text-red-700">
              Still needed:{" "}
              {validation.missing
                .map((m: LightingField) => LIGHTING_FIELD_LABEL[m])
                .join(", ")}
              .
            </span>
          </div>
        )}

        {/* ---- Technical documents (OPTIONAL) — the assisted workflow ---- */}
        <div className="rounded-md border border-indigo-100 bg-indigo-50/30 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h5 className="text-sm font-bold text-neutral-800">
              📄 Technical documents{" "}
              <span className="font-normal text-neutral-400">(optional)</span>
            </h5>
            {hasAi && minConfidence != null && (
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  minConfidence >= AI_CONFIDENCE_MIN
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {minConfidence >= AI_CONFIDENCE_MIN
                  ? "✨ High confidence"
                  : "✨ Verify 🟡 values"}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <DocRow
              label="Energy Study"
              file={energyStudy}
              accept=".pdf,application/pdf"
              busy={uploading === "energy"}
              disabled={disabled}
              onPick={(f) => upload("energy", f)}
              onPreview={previewDoc}
            />
            <DocRow
              label="Dialux Study"
              file={dialux}
              accept=".pdf,.zip,application/pdf,application/zip,application/x-zip-compressed"
              busy={uploading === "dialux"}
              disabled={disabled}
              onPick={(f) => upload("dialux", f)}
              onPreview={previewDoc}
            />
          </div>

          {!energyStudy && !dialux && (
            <p className="text-xs text-neutral-500">
              📄 No technical studies for this project? No problem — documents
              are an aid, never an obligation. Upload them to let AI extract
              Power · Optics · CCT · Mounting height · Operating program, or
              fill the production configuration directly below.
            </p>
          )}

          {/* Analyze CTA / animated state */}
          {analyzing ? (
            <div className="rounded-md border border-indigo-100 bg-white/70 px-3 py-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
                <span className="animate-pulse" aria-hidden>
                  ✨
                </span>
                AI is reading your lighting studies…
                <span className="font-normal text-indigo-600 animate-pulse">
                  {ANALYZE_MESSAGES[analyzeMsgIdx]}
                </span>
              </div>
            </div>
          ) : (
            !disabled &&
            (energyStudy || dialux) && (
              <button
                type="button"
                onClick={analyzeAll}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-indigo-900 hover:bg-indigo-50 disabled:opacity-50"
              >
                <span aria-hidden>✨</span>
                {hasAi ? "Re-analyze Documents" : "Analyze Documents"}
              </button>
            )
          )}

          {(ai.kind === "error" || ai.kind === "verify") && (
            <p
              className={`text-xs font-medium ${
                ai.kind === "verify" ? "text-amber-700" : "text-neutral-500"
              }`}
            >
              {ai.kind === "verify" ? "⚠ " : ""}Energy Study: {ai.note}
            </p>
          )}
          {(dialuxAi.kind === "error" || dialuxAi.kind === "verify") && (
            <p
              className={`text-xs font-medium ${
                dialuxAi.kind === "verify"
                  ? "text-amber-700"
                  : "text-neutral-500"
              }`}
            >
              {dialuxAi.kind === "verify" ? "⚠ " : ""}Dialux: {dialuxAi.note}
            </p>
          )}

          {/* Extracted values — grouped BY CONFIGURATION. Collapsible: open
              after a fresh analysis, folded on a validated setup so the screen
              stays compact (Status · Documents · Final configuration). */}
          {hasAi && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setAiDetailsOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 text-left"
                aria-expanded={aiDetailsOpen}
              >
                <span className="text-xs font-bold text-indigo-900">
                  ✨ AI Summary & Extracted Parameters
                </span>
                <span className="text-[11px] font-semibold text-indigo-400">
                  {aiDetailsOpen ? "Hide ▴" : "Show ▾"}
                </span>
              </button>
              {aiDetailsOpen && (
              <>
              <p className="text-xs text-neutral-600">
                <span className="font-semibold text-indigo-900">
                  ✨ AI Summary —
                </span>{" "}
                {hasDialuxAi
                  ? dialuxProv!.configurations.length === 1
                    ? "one luminaire configuration detected"
                    : `${dialuxProv!.configurations.length} luminaire configurations detected`
                  : "lighting parameters extracted from the Energy Study"}
                {alerts.length === 0
                  ? " · no inconsistencies detected."
                  : ` · ${alerts.length} inconsistenc${
                      alerts.length > 1 ? "ies" : "y"
                    } flagged above.`}
              </p>

              {hasEnergyAi && (
                <ConfigGroup title="✨ AI Extracted Parameters — Energy Study">
                  <ConfigItem
                    label="Power"
                    value={
                      aiProvenance.fields.lighting_power != null
                        ? `${low(aiProvenance.confidence?.lighting_power)}${aiProvenance.fields.lighting_power} W`
                        : "—"
                    }
                  />
                  <ConfigItem
                    label="Operating hours"
                    value={
                      aiProvenance.fields.operating_hours != null
                        ? `${low(aiProvenance.confidence?.operating_hours)}${aiProvenance.fields.operating_hours} h`
                        : "—"
                    }
                  />
                  <ConfigItem
                    label="Program"
                    value={
                      (aiProvenance.fields.lighting_program ?? []).length
                        ? `${low(aiProvenance.confidence?.lighting_program)}${
                            aiProvenance.fields.lighting_program.length
                          } period${
                            aiProvenance.fields.lighting_program.length > 1
                              ? "s"
                              : ""
                          }`
                        : "—"
                    }
                  />
                  {aiProvenance.fields.lighting_program?.some(
                    (p: any) => p.presence_detection
                  ) && <ConfigItem label="Presence detector" value="⚡ Yes" />}
                </ConfigGroup>
              )}

              {hasDialuxAi &&
                dialuxProv!.configurations.map((c, i) => {
                  const optic = [
                    c.optic_code,
                    c.optic_lens_type,
                    c.optic_beam_distribution,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <ConfigGroup
                      key={i}
                      title={`✨ AI Detected Configuration ${i + 1}${
                        c.label ? ` — ${c.label}` : ""
                      }`}
                    >
                      <ConfigItem
                        label="Power"
                        value={
                          c.power != null
                            ? `${low(c.confidence?.power)}${c.power} W`
                            : "—"
                        }
                      />
                      <ConfigItem
                        label="Optics"
                        value={
                          optic ? `${low(c.confidence?.optic)}${optic}` : "—"
                        }
                      />
                      <ConfigItem
                        label="CCT"
                        value={
                          c.cct != null
                            ? `${low(c.confidence?.cct)}${c.cct} K`
                            : "—"
                        }
                      />
                      <ConfigItem
                        label="Mounting height"
                        value={
                          c.mounting_height != null
                            ? `${low(c.confidence?.mounting_height)}${c.mounting_height} m`
                            : "—"
                        }
                      />
                      <ConfigItem
                        label="Quantity"
                        value={
                          c.quantity != null
                            ? `${low(c.confidence?.quantity)}${c.quantity}`
                            : "—"
                        }
                      />
                    </ConfigGroup>
                  );
                })}

              <p className="text-[11px] text-neutral-400">
                Values with no reliable source stay “—” (the AI never invents) ·
                🟡 = verify against the document · manual values always
                override.
              </p>
              </>
              )}
            </div>
          )}
        </div>

        {/* Left: the approved values (with provenance). Right: the LIGHTING
            PROGRAM — the controller payload, worth half the card. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="rounded-md border border-neutral-200 bg-neutral-50/50 p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                ⚡ Approved Power (W)
              </div>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                value={power}
                onChange={(e) => setPower(e.target.value)}
                placeholder="—"
                className="input mt-1.5 text-xl font-bold tabular-nums"
                disabled={disabled}
              />
              <SourceLine prov={provPower} />
            </div>
            <div className="rounded-md border border-neutral-200 bg-neutral-50/50 p-3.5">
              {/* Approved Optics = the production breakdown: how many distinct
                  optics, how many luminaires on each — readable at a glance. */}
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                  🔍 Approved Optics
                </div>
                {!disabled && (
                  <button
                    type="button"
                    onClick={addOpticEntry}
                    className="text-xs font-semibold text-solux hover:underline"
                  >
                    + Add optic
                  </button>
                )}
              </div>

              {disabled ? (
                filledOpticEntries.length ? (
                  <ul className="mt-2 space-y-1">
                    {filledOpticEntries.map((e, i) => (
                      <li
                        key={i}
                        className="text-lg font-bold text-neutral-900 tabular-nums"
                      >
                        • {e.optic}
                        {e.quantity != null && (
                          <span className="text-sm font-semibold text-neutral-500">
                            {" "}
                            → {e.quantity} luminaire{e.quantity > 1 ? "s" : ""}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 text-xl font-bold text-neutral-300">
                    —
                  </div>
                )
              ) : (
                <>
                  {opticEntries.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <div className="grid grid-cols-[1fr_88px_28px] gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                        <span>Optic</span>
                        <span>Luminaires</span>
                        <span />
                      </div>
                      {opticEntries.map((e, i) => (
                        <div
                          key={i}
                          className="grid grid-cols-[1fr_88px_28px] gap-1.5 items-center"
                        >
                          <input
                            type="text"
                            list="lighting-optics-presets"
                            value={e.optic}
                            onChange={(ev) =>
                              updateOpticEntry(i, { optic: ev.target.value })
                            }
                            placeholder="e.g. T35"
                            className="input py-1.5 font-bold"
                          />
                          <input
                            type="number"
                            min="0"
                            value={e.quantity ?? ""}
                            onChange={(ev) =>
                              updateOpticEntry(i, {
                                quantity:
                                  ev.target.value === ""
                                    ? null
                                    : Number(ev.target.value),
                              })
                            }
                            placeholder="—"
                            className="input py-1.5 tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() => removeOpticEntry(i)}
                            className="px-1 py-0.5 rounded hover:bg-red-50 text-red-500"
                            title="Remove optic"
                            aria-label="Remove optic"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {opticEntries.length === 0 && (
                    <div className="mt-2 text-xs text-neutral-400">
                      No optic yet — add one, or analyze the documents to fill
                      this automatically.
                    </div>
                  )}
                  <datalist id="lighting-optics-presets">
                    {[
                      ...distinctDialuxOptics,
                      ...OPTIC_PRESETS.filter(
                        (o) => !distinctDialuxOptics.includes(o)
                      ),
                    ].map((o) => (
                      <option key={o} value={o} />
                    ))}
                  </datalist>
                  {dialuxBreakdown.length > 0 &&
                    !sameOpticsBreakdown(filledOpticEntries, dialuxBreakdown) && (
                      <button
                        type="button"
                        onClick={() => setOpticEntries(dialuxBreakdown)}
                        className="mt-2 inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-indigo-900 hover:bg-indigo-50"
                        title="Replace the breakdown with what the Dialux report detected"
                      >
                        ↺ Apply from Dialux:{" "}
                        {formatApprovedOptics(dialuxBreakdown)}
                      </button>
                    )}
                </>
              )}
              <SourceLine prov={provOptics} />
            </div>
            <div className="rounded-md border border-neutral-200 bg-neutral-50/50 p-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                ☀ Operating Hours (per night)
              </div>
              <input
                type="number"
                min="0"
                step="0.5"
                inputMode="decimal"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="—"
                className="input mt-1.5 text-xl font-bold tabular-nums"
                disabled={disabled}
              />
              <SourceLine prov={provHours} />
            </div>
          </div>

          {/* LIGHTING PROGRAM — the controller payload */}
          <div className="rounded-md border border-neutral-200 bg-neutral-50/50 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                🌙 Lighting Program
              </div>
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

            {/* Per-period output bars (bar length = output %) */}
            {normalizedProgram.length > 0 && (
              <div className="space-y-1.5">
                {normalizedProgram.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="h-4 flex-1 rounded-sm bg-white border border-neutral-200 overflow-hidden">
                      <div
                        className="h-full bg-emerald-600"
                        style={{ width: `${Math.max(p.output, 3)}%` }}
                        title={`${p.output}% — ${p.duration_hours} h`}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs font-semibold tabular-nums text-neutral-700">
                      {p.presence_detection ? "⚡ " : ""}
                      {p.output}% — {p.duration_hours}h
                    </span>
                  </div>
                ))}
                <div className="pt-1 text-xs font-semibold text-neutral-600">
                  {normalizedProgram.length} period
                  {normalizedProgram.length > 1 ? "s" : ""} • {programTotal}{" "}
                  hours
                </div>
                <SourceLine prov={provProgram} />
              </div>
            )}

            {/* Period editor */}
            <div className="overflow-hidden rounded-md border border-neutral-200 bg-white">
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
                    <ProgramRow
                      key={i}
                      row={row}
                      i={i}
                      count={program.length}
                      disabled={disabled}
                      updatePeriod={updatePeriod}
                      updateDetection={updateDetection}
                      toggleDetection={toggleDetection}
                      move={move}
                      removePeriod={removePeriod}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {editable && (
          <div className="flex items-center justify-end border-t border-neutral-100 pt-4">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-solux px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-solux-dark disabled:opacity-50"
            >
              {pending && !analyzing ? "Saving…" : "Save lighting setup"}
            </button>
          </div>
        )}
      </section>

      {/* ---- Document preview drawer — review a study without losing the
              validation context (Esc or backdrop click to close). ---- */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/30"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${preview.name}`}
        >
          <div
            className="flex h-full w-[min(760px,92vw)] flex-col bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
              <div className="min-w-0 truncate text-sm font-semibold text-neutral-800">
                📄 {preview.name}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
                >
                  Open in tab ↗
                </a>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  aria-label="Close preview"
                >
                  ✕
                </button>
              </div>
            </div>
            <iframe
              src={preview.url}
              title={preview.name}
              className="h-full w-full flex-1"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Provenance trace under an approved value — with the original kept when a
 *  document-proposed value was adjusted by a human (industrial audit trail). */
function SourceLine({
  prov,
}: {
  prov: {
    icon: string;
    label: string;
    original?: string;
    current?: string;
  } | null;
}) {
  if (!prov) return null;
  return (
    <div className="mt-1 text-[10.5px] text-neutral-400">
      Source: {prov.icon} {prov.label}
      {prov.original && (
        <span>
          {" "}
          · Original:{" "}
          <span className="font-medium text-neutral-500">{prov.original}</span>
          {" "}· Current:{" "}
          <span className="font-medium text-neutral-600">{prov.current}</span>
        </span>
      )}
    </div>
  );
}

function DocRow({
  label,
  file,
  accept,
  busy,
  disabled,
  required = false,
  onPick,
  onPreview,
}: {
  label: string;
  file: UploadedFile | null;
  accept: string;
  busy: boolean;
  disabled: boolean;
  required?: boolean;
  onPick: (f: File) => void;
  /** Opens the in-page preview drawer (ZIPs fall back to a new tab). */
  onPreview: (path: string, name: string) => void;
}) {
  const isZip = file ? /\.zip$/i.test(file.path) : false;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 bg-white px-3 py-2">
      <div className="min-w-0 flex items-center gap-2">
        <span aria-hidden>📄</span>
        <span className="text-xs font-semibold text-neutral-800 shrink-0">
          {label}
          {required && (
            <span className="text-red-500" title="Required">
              *
            </span>
          )}
        </span>
        {file ? (
          <span className="text-xs text-neutral-500 truncate">
            {/* Clicking the name previews the document in place. */}
            <button
              type="button"
              onClick={() => onPreview(file.path, file.name)}
              className="underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800"
              title="Preview the document"
            >
              {file.name}
            </button>{" "}
            <span className="text-emerald-700 font-medium">✓</span>
            {file.at && (
              <span className="text-neutral-400">
                {" · "}
                {new Date(file.at).toLocaleDateString()}
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-neutral-400">not uploaded</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {file && (
          <button
            type="button"
            onClick={() => onPreview(file.path, file.name)}
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            {isZip ? "Open" : "Preview"}
          </button>
        )}
        {!disabled && (
          <label className="cursor-pointer rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50">
            {busy ? "Uploading…" : file ? "Replace" : "Upload"}
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
    </div>
  );
}

function ConfigGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-indigo-100 bg-white/70 px-3 py-2.5">
      <div className="text-[11px] font-bold uppercase tracking-wide text-indigo-900/70 mb-1.5">
        {title}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1">{children}</div>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  const empty = value === "—";
  return (
    <div className="text-xs">
      <span className="text-neutral-500">{label}: </span>
      <span
        className={`font-semibold tabular-nums ${
          empty ? "text-neutral-300" : "text-neutral-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ProgramRow({
  row,
  i,
  count,
  disabled,
  updatePeriod,
  updateDetection,
  toggleDetection,
  move,
  removePeriod,
}: {
  row: LightingProgramPeriod;
  i: number;
  count: number;
  disabled: boolean;
  updatePeriod: (
    i: number,
    field: keyof LightingProgramPeriod,
    value: string
  ) => void;
  updateDetection: (
    i: number,
    field:
      | "detection_output"
      | "detection_hold_seconds"
      | "estimated_detections",
    value: string
  ) => void;
  toggleDetection: (i: number) => void;
  move: (i: number, dir: -1 | 1) => void;
  removePeriod: (i: number) => void;
}) {
  return (
    <>
      <tr className="border-t border-neutral-100">
        <td className="px-2 py-1.5">
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={Number.isFinite(row.output) ? row.output : ""}
            onChange={(e) => updatePeriod(i, "output", e.target.value)}
            className="input py-1.5"
            disabled={disabled}
          />
        </td>
        <td className="px-2 py-1.5">
          <input
            type="number"
            min="0"
            step="0.5"
            value={Number.isFinite(row.duration_hours) ? row.duration_hours : ""}
            onChange={(e) => updatePeriod(i, "duration_hours", e.target.value)}
            className="input py-1.5"
            disabled={disabled}
          />
        </td>
        {!disabled && (
          <td className="px-2 py-1.5">
            <div className="flex items-center gap-1 justify-end text-neutral-500">
              <button
                type="button"
                onClick={() => toggleDetection(i)}
                className={`px-1.5 py-0.5 rounded ${
                  row.presence_detection
                    ? "bg-amber-100 text-amber-700"
                    : "hover:bg-neutral-100"
                }`}
                title="Presence detector on this phase"
                aria-label="Toggle presence detection"
              >
                ⚡
              </button>
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
                disabled={i === count - 1}
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
      {row.presence_detection && (
        <tr className="bg-amber-50/50">
          <td colSpan={disabled ? 2 : 3} className="px-3 py-2">
            {disabled ? (
              <div className="text-xs text-amber-800">
                ⚡ Presence detection — baseline {row.output}% boosts to{" "}
                {row.detection_output ?? 100}% for{" "}
                {row.detection_hold_seconds ?? "—"} s per detection
                {row.estimated_detections != null
                  ? ` · ~${row.estimated_detections}/night`
                  : ""}
                .
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-800">
                <span className="font-semibold">⚡ Presence detection —</span>
                <label className="inline-flex items-center gap-1">
                  boost
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={row.detection_output ?? ""}
                    onChange={(e) =>
                      updateDetection(i, "detection_output", e.target.value)
                    }
                    className="input py-1 w-16"
                  />
                  %
                </label>
                <label className="inline-flex items-center gap-1">
                  hold
                  <input
                    type="number"
                    min="0"
                    value={row.detection_hold_seconds ?? ""}
                    onChange={(e) =>
                      updateDetection(
                        i,
                        "detection_hold_seconds",
                        e.target.value
                      )
                    }
                    className="input py-1 w-16"
                  />
                  s
                </label>
                <label className="inline-flex items-center gap-1">
                  ~
                  <input
                    type="number"
                    min="0"
                    value={row.estimated_detections ?? ""}
                    onChange={(e) =>
                      updateDetection(i, "estimated_detections", e.target.value)
                    }
                    className="input py-1 w-16"
                  />
                  detections/night
                </label>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
