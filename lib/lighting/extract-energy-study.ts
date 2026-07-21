/**
 * Product Lighting Setup — optional "Auto-fill from Energy Study" (server-only).
 *
 * Mirrors the historical-import extractor (lib/import/extract-claude.ts): the
 * Energy Study PDF is turned into text (unpdf, text-first; raw-PDF fallback for
 * thin text layers) and Claude is forced — via tool-use — to return a fixed
 * JSON shape with a per-field confidence map. We NEVER parse free-form prose.
 *
 * AI is COMPLETELY OPTIONAL: extraction only pre-fills the form; manual values
 * always override, and if extraction fails or confidence is low the caller just
 * keeps the manual path. The SDK + key are OWNER-provisioned (same as import),
 * imported dynamically so the app builds before the dependency is installed.
 */

import { extractPdfText } from "../import/pdf-text.ts";
import { normalizeLightingProgram } from "./validate.ts";
import {
  normalizeTiltCandidate,
  pickTiltCandidate,
  type TiltCandidate,
} from "../tilt-provenance.ts";
import type { LightingExtraction } from "./types.ts";

const DEFAULT_MODEL = "claude-sonnet-4-6";

const LIGHTING_TOOL = {
  name: "emit_lighting",
  description:
    "Return the approved street/area LIGHTING operating parameters printed in this Energy Study (photometric / energy / autonomy study for a solar or grid luminaire). Transcribe only what is stated; never invent a value. Use null for anything not clearly present.",
  input_schema: {
    type: "object" as const,
    properties: {
      lighting_power: {
        type: ["number", "null"],
        description:
          "Nominal luminaire lighting power in WATTS (the LED/fixture power, e.g. 40, 60, 80). Plain number, no unit.",
      },
      operating_hours: {
        type: ["number", "null"],
        description:
          "Total operating hours per night (e.g. 12). Plain number of hours. If the study gives a full dimming schedule, this is the sum of the periods' durations.",
      },
      lighting_program: {
        type: "array",
        description:
          "The dimming schedule as an ordered list of periods. Each period holds an output level for a duration.",
        items: {
          type: "object",
          properties: {
            output: {
              type: "number",
              description:
                "Output level held during this period as a percentage 0..100. For a presence-detection phase this is the LOW baseline (e.g. 10), NOT the boost.",
            },
            duration_hours: {
              type: "number",
              description: "How long that level is held, in hours (e.g. 5, 2).",
            },
            presence_detection: {
              type: ["boolean", "null"],
              description:
                "true if a presence/motion DETECTOR governs this phase: the luminaire holds the baseline `output`% and boosts to `detection_output`% for a few seconds on each detection.",
            },
            detection_output: {
              type: ["number", "null"],
              description: "Boost output % reached on each detection (e.g. 100).",
            },
            detection_hold_seconds: {
              type: ["number", "null"],
              description:
                "Seconds the luminaire holds the boost level per detection (e.g. 40).",
            },
            estimated_detections: {
              type: ["number", "null"],
              description:
                "Estimated number of detections per night the study assumed (e.g. 80).",
            },
          },
          required: ["output", "duration_hours"],
        },
      },
      tilt_candidates: {
        type: "array",
        description:
          "EVERY solar-panel tilt angle the study states, one entry each — do not pre-select a winner, the caller ranks them. Omit values that are not a panel tilt (latitude, azimuth, luminaire/arm tilt, beam angle, roof slope) and values that are only illustrative (plotted on a comparison graph, part of a rejected simulation scenario, or a generic table of 'what if' angles). Empty array when the study states none.",
        items: {
          type: "object",
          properties: {
            value: {
              type: "number",
              description:
                "The angle in DEGREES as a plain number (15 for '15°', '15 degrees', '15 deg', 'Tilt = 15°'). Never include the unit.",
            },
            basis: {
              type: "string",
              enum: [
                "final_recommended",
                "product_specific",
                "project_installation",
                "simulation_input",
                "general_default",
              ],
              description:
                "What this value IS in the study: 'final_recommended' = the tilt the study finally recommends for this project; 'product_specific' = tied to one product/model; 'project_installation' = the installation tilt for the project site; 'simulation_input' = an input explicitly used for the FINAL retained calculation; 'general_default' = a generic/default/example angle.",
            },
            source_text: {
              type: "string",
              description:
                "The sentence or table row it was read from, transcribed VERBATIM from the document (max ~2 lines). This is the evidence a human reviews — never paraphrase it.",
            },
            source_page: {
              type: ["number", "null"],
              description:
                "The 1-based page number, taken from the nearest preceding [[page N]] marker in the supplied text. null when the input carries no markers.",
            },
          },
          required: ["value", "basis", "source_text"],
        },
      },
      confidence: {
        type: "object",
        description:
          "Your confidence 0..1 for each field. Use 0.9+ only when the value is clearly and unambiguously printed; lower it when blurry, ambiguous, or inferred.",
        properties: {
          lighting_power: { type: "number" },
          operating_hours: { type: "number" },
          lighting_program: { type: "number" },
          tilt_angle: { type: "number" },
        },
      },
    },
    required: ["lighting_program", "confidence"],
  },
};

const SYSTEM_PROMPT = [
  "You are a meticulous data-entry engine reading a street/area lighting ENERGY STUDY (for a SOLUX autonomous solar luminaire) and transcribing its approved operating parameters into structured fields.",
  "Rules:",
  "- Transcribe ONLY what the study states. Do not compute, infer, or round values that are not on the page.",
  "- lighting_power is the luminaire's nominal power in watts (the luminaire/LED power, NOT the solar panel or battery wattage). E.g. 'PUISSANCE: 15 W'.",
  "- lighting_program is the dimming schedule: for each period give the output percentage and its duration in hours, in chronological order.",
  "- operating_hours is the total hours the luminaire runs per night (dusk to dawn), i.e. the sum of the period durations.",
  "",
  "PRESENCE DETECTOR (critical — do NOT miss this):",
  "- These luminaires often use a PRESENCE / MOTION DETECTOR ('détecteur de présence', 'détection') on one phase of the night — usually the long middle phase between the first hours after dusk and the last hours before dawn.",
  "- During that phase the luminaire holds a LOW baseline (e.g. 10%) and BOOSTS to full (e.g. 100%) for a few seconds (e.g. 40s) on each detection; the study estimates a number of detections per night (e.g. 80).",
  "- For such a period set: output = the baseline % (e.g. 10), presence_detection = true, detection_output = the boost % (e.g. 100), detection_hold_seconds = the hold time (e.g. 40), estimated_detections = the per-night estimate (e.g. 80).",
  "- NEVER flatten a presence-detection phase to a single fixed level and NEVER drop the detection — it is essential for manufacturing and controller programming.",
  "- A typical profile: full power for the first hours after dusk → a long presence-detection phase (dimmed baseline + boost on detection) → full power for the last hours before dawn.",
  "",
  "",
  "SOLAR PANEL TILT ANGLE (drives the pole drawing in production — read the WHOLE study):",
  "- Scan every page: body text, tables, figure captions, simulation summaries and annexes.",
  "- Labels, any language: 'Tilt', 'Tilt Angle', 'Panel Tilt', 'PV Tilt', 'Panel Inclination', 'PV Inclination', 'Solar Panel Angle', 'Installation Angle', 'Mounting Angle', 'Fixed Tilt', 'Array Tilt', 'Module Tilt'; 'Inclinaison', 'Inclinaison du panneau', \"Angle d'inclinaison\", 'Angle du panneau solaire', 'Angle de pose'; '倾角', '光伏板倾角', '太阳能板倾角', '组件倾角', '安装角度'.",
  "- Formats to normalize to a plain number of degrees: '15°', '15 degrees', '15 deg', '15º', 'Tilt = 15°', 'Panel inclination: 15°', 'Recommended tilt angle: 15 degrees', '倾角15°'. A range ('15-20°') is NOT a single value — emit both endpoints as separate candidates so the ambiguity is visible.",
  "- Emit ONE candidate per stated value in tilt_candidates, each with its basis, its VERBATIM source sentence, and its page from the nearest preceding [[page N]] marker.",
  "- NEVER emit: latitude, longitude, azimuth/orientation, the luminaire or arm tilt, the beam/optic angle, a roof pitch, or a temperature. These are not panel tilts.",
  "- NEVER emit a value that only appears as a point on a comparison graph, inside a scenario the study REJECTS, or in a generic 'angles considered' table — those are not the project's tilt.",
  "- If the study genuinely states no panel tilt, return an empty tilt_candidates array. Do not infer one from latitude or from rules of thumb.",
  "",
  "- If a field is not clearly present, return null (or an empty program) and lower its confidence.",
  "- Numbers must be plain numbers (no units, no thousands separators, dot as decimal).",
  "Call the emit_lighting tool with your result. Do not write prose.",
].join("\n");

export type EnergyStudyExtractInput = {
  /** The Energy Study PDF bytes. */
  pdf: Uint8Array | Buffer;
  model?: string;
};

/**
 * Extract lighting parameters from an Energy Study PDF. Throws with a clear,
 * caller-surfaceable message when the key/SDK is missing or the model returns
 * nothing structured — the UI treats any throw as "extraction failed, continue
 * manually".
 */
export async function extractLightingFromEnergyStudy(
  input: EnergyStudyExtractInput
): Promise<LightingExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to ~/dev/facturation/.env.local (owner step)."
    );
  }

  let Anthropic: any;
  try {
    // @ts-ignore — optional dependency installed by the owner (`npm i @anthropic-ai/sdk`).
    Anthropic = (await import("@anthropic-ai/sdk")).default;
  } catch {
    throw new Error(
      "Anthropic SDK not installed. Run `npm i @anthropic-ai/sdk` (owner step)."
    );
  }

  const client = new Anthropic({ apiKey });
  const model =
    input.model || process.env.LIGHTING_EXTRACTION_MODEL || DEFAULT_MODEL;

  // Text-first (cheap); fall back to sending the raw PDF for thin text layers.
  const bytes =
    input.pdf instanceof Uint8Array ? input.pdf : new Uint8Array(input.pdf);
  let textLayer = "";
  try {
    // pageMarkers: the tilt must be traceable to a page, and a merged text
    // layer has no boundaries left to cite (see PdfTextOptions).
    const t = await extractPdfText(bytes, { pageMarkers: true });
    if (t.hasUsableText) textLayer = t.text;
  } catch {
    // unpdf not installed / unreadable PDF → fall through to the raw-PDF path.
  }

  const userContent: any[] = [];
  if (textLayer) {
    userContent.push({
      type: "text",
      text:
        `Extract the lighting operating parameters from this Energy Study text layer. ` +
        `Lines of the form [[page N]] are PAGE MARKERS inserted by the reader, not document content: ` +
        `use them for source_page, and never transcribe them into a source_text.\n\n"""\n${textLayer}\n"""`,
    });
  } else {
    const b64 = Buffer.from(bytes).toString("base64");
    userContent.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: b64 },
    });
    userContent.push({
      type: "text",
      text: "Extract the lighting operating parameters from the Energy Study above.",
    });
  }

  const msg = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [LIGHTING_TOOL],
    tool_choice: { type: "tool", name: "emit_lighting" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = (msg.content ?? []).find((b: any) => b.type === "tool_use");
  if (!toolUse) {
    throw new Error("Extraction failed: the model did not return structured data.");
  }
  const out = toolUse.input as any;

  const confidence: Record<string, number> = {};
  const c = out.confidence ?? {};
  for (const k of Object.keys(c)) {
    const v = Number(c[k]);
    if (Number.isFinite(v)) confidence[k] = Math.max(0, Math.min(1, v));
  }

  // The model FINDS and classifies tilt values; the source-priority ranking is
  // ours, in deterministic testable code (lib/tilt-provenance.ts) rather than
  // hidden inside the model's own choice.
  const tilt_candidates = (Array.isArray(out.tilt_candidates) ? out.tilt_candidates : [])
    .map((c: unknown) => normalizeTiltCandidate(c))
    .filter((c: TiltCandidate | null): c is TiltCandidate => c != null);
  const { picked, ambiguous } = pickTiltCandidate(tilt_candidates);

  return {
    lighting_power: nullableNum(out.lighting_power),
    operating_hours: nullableNum(out.operating_hours),
    lighting_program: normalizeLightingProgram(out.lighting_program),
    tilt_angle: picked?.value ?? null,
    tilt_source_page: picked?.source_page ?? null,
    tilt_source_text: picked?.source_text ?? null,
    tilt_basis: picked?.basis ?? null,
    tilt_ambiguous: ambiguous,
    tilt_candidates,
    confidence,
    model,
  };
}

function nullableNum(v: any): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
