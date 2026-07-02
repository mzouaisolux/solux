/**
 * Historical Invoice Import — PURE DTOs shared by the server actions and the
 * client wizard. No server deps; safe to import from a "use client" component.
 */

import type { MatchMethod } from "./product-match.ts";

export type StagedLineDTO = {
  id: string;
  lineNo: number;
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
  productId: string | null;
  matchedName: string | null;
  method: MatchMethod;
  needsReview: boolean;
  suggestion: { id: string; name: string; score: number } | null;
};

export type StagedDocStatus =
  | "staged" // ready to import
  | "needs_attention"
  | "imported"
  | "skipped"
  | "duplicate"; // already imported previously (transient UI signal)

export type StagedDocDTO = {
  id: string;
  fileName: string | null;
  number: string | null;
  date: string | null;
  currency: string | null;
  total: number | null;
  detectedCustomer: string | null;
  nameMatches: boolean;
  nameScore: number;
  nameDecision: string | null;
  integrityReconciles: boolean;
  integrityAck: boolean;
  confidence: number;
  status: StagedDocStatus;
  attentionReasons: string[];
  lines: StagedLineDTO[];
};

export type CommitResult = {
  imported: number;
  remainingAttention: number;
  skipped: number;
};

/** A catalog product as offered in the "match existing product" picker. */
export type ProductOption = {
  id: string;
  name: string;
  sku: string | null;
  categoryId: string | null;
  categoryName: string | null;
};
