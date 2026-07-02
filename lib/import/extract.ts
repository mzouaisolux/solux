/**
 * Historical Invoice Import — extraction ORCHESTRATOR (server-only).
 *
 * The single seam the rest of the app calls. It is doc-type generic (invoice
 * today; quotation/proforma/credit-note/PO/delivery-note tomorrow) so the whole
 * engine extends without redesign.
 *
 * Pipeline: PDF text layer → Claude structured extraction → deterministic
 * validation (arithmetic reconciliation + confidence gate) → customer-name
 * verification. Product matching is layered on top by the server action (it
 * needs the catalog + remembered mappings from the DB).
 */

import { extractPdfText } from "./pdf-text.ts";
import { extractViaClaude } from "./extract-claude.ts";
import { validateInvoice, type ValidationResult } from "./validate.ts";
import { matchCustomerName, type NameMatch } from "./name-match.ts";
import type {
  ExtractedInvoice,
  FieldConfidence,
  ImportDocType,
} from "./types.ts";

export type StagedExtraction = {
  invoice: ExtractedInvoice;
  confidence: FieldConfidence;
  validation: ValidationResult;
  nameMatch: NameMatch;
  /** True when the customer-name check or the integrity check flags this file. */
  needsAttention: boolean;
  attentionReasons: string[];
  model?: string;
  raw?: unknown;
  textPages: number;
  usedPdfFallback: boolean;
};

export type ExtractInput = {
  pdfBuffer: Buffer | Uint8Array;
  expectedCustomerName: string | null;
  docType?: ImportDocType;
  model?: string;
};

export async function extractInvoiceFromPdf(input: ExtractInput): Promise<StagedExtraction> {
  const docType: ImportDocType = input.docType ?? "invoice";

  // 1. Text layer first (cheap). Fall back to the raw PDF only if it's thin.
  const pdfText = await extractPdfText(input.pdfBuffer);
  const usedPdfFallback = !pdfText.hasUsableText;

  const result = await extractViaClaude({
    docType,
    expectedCustomerName: input.expectedCustomerName,
    model: input.model,
    ...(usedPdfFallback
      ? { pdfBase64: Buffer.from(input.pdfBuffer).toString("base64") }
      : { textLayer: pdfText.text }),
  });

  // 2. Deterministic integrity gate.
  const validation = validateInvoice(result.invoice, result.confidence);

  // 3. Customer verification (we import FROM a customer → verify, don't search).
  const nameMatch = matchCustomerName(
    result.invoice.detected_customer_name,
    input.expectedCustomerName
  );

  const attentionReasons: string[] = [];
  if (!nameMatch.matches) {
    attentionReasons.push(
      nameMatch.reason === "empty"
        ? "No customer name found on the document"
        : "This document appears to belong to another customer"
    );
  }
  for (const issue of validation.issues) attentionReasons.push(issue.detail);

  return {
    invoice: result.invoice,
    confidence: result.confidence,
    validation,
    nameMatch,
    needsAttention: !validation.ok || !nameMatch.matches,
    attentionReasons,
    model: result.model,
    raw: result.raw,
    textPages: pdfText.pages,
    usedPdfFallback,
  };
}
