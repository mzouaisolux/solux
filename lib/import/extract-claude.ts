/**
 * Historical Invoice Import — Claude extraction adapter (server-only).
 *
 * Forces STRUCTURED output via tool-use: the model must call `emit_invoice`
 * with a fixed JSON schema, so we never parse free-form prose. It also returns
 * a per-field confidence map, which `validate.ts` combines with a deterministic
 * arithmetic reconciliation to decide what needs a human.
 *
 * Two input modes (chosen by extract.ts):
 *   - text  : the PDF text layer (cheap; the default for our digital invoices)
 *   - pdf   : the raw PDF as a document block (fallback for thin/odd text layers)
 *
 * The SDK + key are OWNER-provisioned. The import is dynamic so the app builds
 * before `@anthropic-ai/sdk` is installed; a missing key throws a clear error
 * the caller surfaces on the file's row.
 */

import type {
  ExtractedInvoice,
  ExtractionResult,
  ImportDocType,
} from "./types.ts";

const DEFAULT_MODEL = "claude-sonnet-4-6";

const DOC_TYPE_LABEL: Record<ImportDocType, string> = {
  invoice: "invoice",
  quotation: "quotation",
  proforma: "proforma invoice",
  credit_note: "credit note",
  purchase_order: "purchase order",
  delivery_note: "delivery note",
};

const INVOICE_TOOL = {
  name: "emit_invoice",
  description:
    "Return the exact commercial data printed on this document. Transcribe only what is visible; never invent or compute a value that is not printed. Use null for anything not clearly present.",
  input_schema: {
    type: "object" as const,
    properties: {
      number: { type: ["string", "null"], description: "The document/invoice number exactly as printed." },
      date: { type: ["string", "null"], description: "Document date as ISO yyyy-mm-dd if determinable, else the printed string." },
      currency: { type: ["string", "null"], description: "ISO currency code (EUR, USD, ...) or the printed symbol resolved to a code." },
      detected_customer_name: { type: ["string", "null"], description: "The BILL-TO / customer company name printed on the document." },
      subtotal: { type: ["number", "null"] },
      discount_total: { type: ["number", "null"] },
      tax_total: { type: ["number", "null"], description: "Total VAT/tax amount." },
      total_amount: { type: ["number", "null"], description: "Grand total (tax included)." },
      notes: { type: ["string", "null"] },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantity: { type: ["number", "null"] },
            unit_price: { type: ["number", "null"] },
            discount_amount: { type: ["number", "null"] },
            discount_pct: { type: ["number", "null"] },
            tax_rate: { type: ["number", "null"] },
            tax_amount: { type: ["number", "null"] },
            line_total: { type: ["number", "null"], description: "The line total exactly as printed." },
          },
          required: ["description"],
        },
      },
      confidence: {
        type: "object",
        description:
          "Your confidence 0..1 for each critical field. Use 0.97+ when the value is clearly and unambiguously printed and you did NOT have to guess; lower it only when the text is blurry, ambiguous, cut off, or inferred.",
        properties: {
          number: { type: "number" },
          date: { type: "number" },
          total_amount: { type: "number" },
          currency: { type: "number" },
          lines: { type: "number" },
        },
      },
    },
    required: ["number", "date", "total_amount", "lines", "confidence"],
  },
};

function systemPrompt(docLabel: string, expectedCustomer: string | null): string {
  return [
    `You are a meticulous data-entry engine transcribing a ${docLabel} into structured fields.`,
    "Rules:",
    "- Transcribe ONLY what is printed. Do not compute, infer, or round values that are not on the page.",
    "- If a field is not clearly present, return null and lower its confidence.",
    "- Numbers must be plain numbers (no thousands separators, dot as decimal).",
    "- Preserve every line item, in order.",
    expectedCustomer
      ? `- This document is expected to belong to the customer "${expectedCustomer}". Still transcribe the customer name exactly as printed (do not force it to match).`
      : "",
    "Call the emit_invoice tool with your result. Do not write prose.",
  ]
    .filter(Boolean)
    .join("\n");
}

export type ClaudeExtractInput = {
  docType: ImportDocType;
  expectedCustomerName: string | null;
  /** Provide EITHER textLayer OR pdfBase64 (extract.ts decides). */
  textLayer?: string;
  pdfBase64?: string;
  model?: string;
};

export async function extractViaClaude(input: ClaudeExtractInput): Promise<ExtractionResult> {
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
  const model = input.model || process.env.IMPORT_EXTRACTION_MODEL || DEFAULT_MODEL;
  const docLabel = DOC_TYPE_LABEL[input.docType] ?? "invoice";

  const userContent: any[] = [];
  if (input.pdfBase64) {
    userContent.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 },
    });
    userContent.push({ type: "text", text: `Extract the ${docLabel} above.` });
  } else {
    userContent.push({
      type: "text",
      text: `Extract the ${docLabel} from this text layer:\n\n"""\n${input.textLayer ?? ""}\n"""`,
    });
  }

  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt(docLabel, input.expectedCustomerName),
    tools: [INVOICE_TOOL],
    tool_choice: { type: "tool", name: "emit_invoice" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = (msg.content ?? []).find((b: any) => b.type === "tool_use");
  if (!toolUse) {
    throw new Error("Extraction failed: the model did not return structured data.");
  }
  const out = toolUse.input as any;

  const invoice: ExtractedInvoice = {
    number: nullableStr(out.number),
    date: nullableStr(out.date),
    currency: nullableStr(out.currency),
    detected_customer_name: nullableStr(out.detected_customer_name),
    subtotal: nullableNum(out.subtotal),
    discount_total: nullableNum(out.discount_total),
    tax_total: nullableNum(out.tax_total),
    total_amount: nullableNum(out.total_amount),
    notes: nullableStr(out.notes),
    lines: Array.isArray(out.lines)
      ? out.lines.map((l: any) => ({
          description: String(l?.description ?? "").trim(),
          quantity: nullableNum(l?.quantity),
          unit_price: nullableNum(l?.unit_price),
          discount_amount: nullableNum(l?.discount_amount),
          discount_pct: nullableNum(l?.discount_pct),
          tax_rate: nullableNum(l?.tax_rate),
          tax_amount: nullableNum(l?.tax_amount),
          line_total: nullableNum(l?.line_total),
        }))
      : [],
  };

  const confidence: Record<string, number> = {};
  const c = out.confidence ?? {};
  for (const k of Object.keys(c)) {
    const v = Number(c[k]);
    if (Number.isFinite(v)) confidence[k] = Math.max(0, Math.min(1, v));
  }

  return {
    invoice,
    confidence,
    model,
    raw: out,
  };
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
