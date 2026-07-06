/**
 * DIALux report — Production-field extraction (server-only). FIRST DRAFT.
 *
 * Same architecture as the Energy Study extractor (lib/lighting/extract-energy-
 * study.ts): unpdf text-first (raw-PDF fallback for thin text layers) + Claude
 * forced via tool-use to return a fixed JSON shape with per-field confidence.
 * Only the SCHEMA changes — the pipeline, confidence system, editability and
 * async UX are shared.
 *
 * Goal: NOT to recreate the lighting study — only to pull the fields Production
 * needs (mounting height, power, optics, CCT, quantities), one entry per
 * lighting configuration, never merging different configs. Never invents; when
 * a value is not clearly present it stays null with low confidence.
 *
 * NOTE: this prompt/schema is a first pass to refine against several real DIALux
 * reports (owner: "study several examples before finalizing the parser").
 */

import { extractPdfText } from "../import/pdf-text.ts";
import type { DialuxConfiguration, DialuxExtraction } from "./types.ts";

const DEFAULT_MODEL = "claude-sonnet-4-6";

const DIALUX_TOOL = {
  name: "emit_dialux",
  description:
    "Return ONLY the Production-relevant data reliably printed in this DIALux lighting report, as one entry per independent lighting configuration (area / luminaire type / optic). Never invent a value; when a field is not clearly present return null and lower its confidence. Do NOT merge different configurations together.",
  input_schema: {
    type: "object" as const,
    properties: {
      configurations: {
        type: "array",
        description:
          "One entry per independent lighting configuration. A report with several areas / luminaire types / optics yields several entries — keep them separate.",
        items: {
          type: "object",
          properties: {
            label: {
              type: ["string", "null"],
              description:
                "A short label for this configuration: the area/zone/scene name or the luminaire designation as printed.",
            },
            power: {
              type: ["number", "null"],
              description: "Luminaire power in WATTS for this configuration.",
            },
            mounting_height: {
              type: ["number", "null"],
              description:
                "Mounting height (hauteur de feu) in METRES for this configuration.",
            },
            optic_code: {
              type: ["string", "null"],
              description:
                "Optic code / reference exactly as printed (e.g. a lens/photometry reference).",
            },
            optic_lens_type: {
              type: ["string", "null"],
              description: "Lens type, if named separately from the code.",
            },
            optic_beam_distribution: {
              type: ["string", "null"],
              description:
                "Beam / photometric distribution as printed (e.g. 'Type II', '2M', 'ME4', 'wide').",
            },
            cct: {
              type: ["number", "null"],
              description:
                "Correlated colour temperature in KELVIN (e.g. 3000, 4000).",
            },
            quantity: {
              type: ["number", "null"],
              description:
                "Number of luminaires in this configuration (from the luminaire schedule / parts list).",
            },
            confidence: {
              type: "object",
              description:
                "Your confidence 0..1 per field. Use 0.9+ only when clearly and unambiguously printed; lower it when inferred, ambiguous, or read from a figure.",
              properties: {
                power: { type: "number" },
                mounting_height: { type: "number" },
                optic: { type: "number" },
                cct: { type: "number" },
                quantity: { type: "number" },
              },
            },
          },
          required: ["confidence"],
        },
      },
    },
    required: ["configurations"],
  },
};

const SYSTEM_PROMPT = [
  "You are a meticulous data-entry engine reading a DIALux street/area LIGHTING report and extracting ONLY the fields a factory needs to PRODUCE the luminaires.",
  "You are NOT recreating the lighting study. Extract only reliable, printed values.",
  "Rules:",
  "- Transcribe ONLY what is printed. NEVER invent, compute, or round a value that is not on the page. If a field is not clearly present, return null and lower its confidence — the user reviews and edits everything.",
  "- A DIALux report often contains SEVERAL independent lighting configurations (different streets/areas/scenes, or different luminaire types/optics). Detect each one and return it as a SEPARATE entry. NEVER merge different configurations.",
  "- For EACH configuration extract, when reliably present: power (W), mounting_height (m), optic (code + lens type + beam/photometric distribution), cct (K), quantity (luminaire count).",
  "- Reports are often FRENCH. Vocabulary: 'Hauteur point d'éclairage' / 'hauteur de feu' = mounting_height; 'Optique' = optic; 'Puissance' / 'P xx.x W' = power; 'Espacement poteau' = pole spacing (NOT a quantity).",
  "- OPTICS are among the most important fields. The value printed after 'Optique'/'Optic' in the luminaire component block (e.g. 'Optique T1' → 'T1', 'T36', 'TYPE III-M') is the optic CODE → optic_code. Use optic_beam_distribution only for a separately printed photometric distribution class. Different configurations may use different optics — keep them distinct.",
  "- QUANTITIES: only from an explicit luminaire schedule / parts list ('Liste des luminaires', 'Nombre', 'Quantité', 'pcs', 'pièces'). NEVER derive a quantity from pole spacing, street length, or the calculation grid — if no explicit count is printed, quantity is null with confidence 0.",
  "- POWER and CCT often appear inside the luminaire designation or component block — read them there if not tabulated.",
  "- Numbers must be plain numbers (no units, no thousands separators, dot as decimal).",
  "Call the emit_dialux tool with your result. Do not write prose.",
].join("\n");

export type DialuxExtractInput = {
  /** The DIALux report PDF bytes. */
  pdf: Uint8Array | Buffer;
  model?: string;
};

/**
 * Extract Production fields from a DIALux report. Throws with a clear,
 * caller-surfaceable message when the key/SDK is missing or the model returns
 * nothing structured — the UI treats any throw as "extraction failed, continue
 * manually".
 */
export async function extractDialux(
  input: DialuxExtractInput
): Promise<DialuxExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to ~/dev/facturation/.env.local (owner step)."
    );
  }

  let Anthropic: any;
  try {
    // @ts-ignore — optional dependency installed by the owner.
    Anthropic = (await import("@anthropic-ai/sdk")).default;
  } catch {
    throw new Error(
      "Anthropic SDK not installed. Run `npm i @anthropic-ai/sdk` (owner step)."
    );
  }

  const client = new Anthropic({ apiKey });
  const model =
    input.model || process.env.LIGHTING_EXTRACTION_MODEL || DEFAULT_MODEL;

  const bytes =
    input.pdf instanceof Uint8Array ? input.pdf : new Uint8Array(input.pdf);
  let textLayer = "";
  try {
    const t = await extractPdfText(bytes);
    if (t.hasUsableText) textLayer = t.text;
  } catch {
    // unpdf missing / unreadable → fall through to the raw-PDF path.
  }

  const userContent: any[] = [];
  if (textLayer) {
    userContent.push({
      type: "text",
      text: `Extract the Production fields from this DIALux report text layer:\n\n"""\n${textLayer}\n"""`,
    });
  } else {
    const b64 = Buffer.from(bytes).toString("base64");
    userContent.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: b64 },
    });
    userContent.push({
      type: "text",
      text: "Extract the Production fields from the DIALux report above.",
    });
  }

  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [DIALUX_TOOL],
    tool_choice: { type: "tool", name: "emit_dialux" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = (msg.content ?? []).find((b: any) => b.type === "tool_use");
  if (!toolUse) {
    throw new Error("Extraction failed: the model did not return structured data.");
  }
  const out = toolUse.input as any;

  const configurations: DialuxConfiguration[] = Array.isArray(out.configurations)
    ? out.configurations.map((c: any) => ({
        label: nullableStr(c?.label),
        power: nullableNum(c?.power),
        mounting_height: nullableNum(c?.mounting_height),
        optic_code: nullableStr(c?.optic_code),
        optic_lens_type: nullableStr(c?.optic_lens_type),
        optic_beam_distribution: nullableStr(c?.optic_beam_distribution),
        cct: nullableNum(c?.cct),
        quantity: nullableNum(c?.quantity),
        confidence: normalizeConfidence(c?.confidence),
      }))
    : [];

  return { configurations, model };
}

function normalizeConfidence(c: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (c && typeof c === "object") {
    for (const k of Object.keys(c)) {
      const v = Number(c[k]);
      if (Number.isFinite(v)) out[k] = Math.max(0, Math.min(1, v));
    }
  }
  return out;
}

function nullableStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function nullableNum(v: any): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
