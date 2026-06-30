/**
 * Export shipping-documents package (m115) — pure module.
 *
 * Owner decision (2026-06-12): think "Export Documentation Package",
 * not "Accounting Invoice". The Commercial Invoice is a SHIPPING
 * document generated when the shipment is prepared — for customs,
 * import procedures, bank/LC documentation and freight forwarding.
 *
 * This module answers ONE question, with zero persistence (Règle #0 —
 * requirements are DERIVED, never stored):
 *
 *   "Given this order's payment mode and the client's BL profile,
 *    which shipping documents does the shipment need?"
 *
 * Sources of truth it reads:
 *   - payment mode (lc / hybrid → the LC document package is required)
 *   - the client's BL profile checklist (m054 — sales ticked the export
 *     documents this client's market requires: COO, Form E, ECTN, …)
 *
 * Relative .ts imports on purpose: keeps the chain loadable by the node
 * test runner (same convention as lib/operations-alerts.ts).
 */

import type { PaymentMode } from "./types.ts";

/** Canonical document kinds — aligned with BL_DOCUMENT_CATALOG keys
 *  (lib/bl.ts) so the client BL profile maps 1:1, plus `lc_documents`
 *  for the Letter-of-Credit package. */
export type ShippingDocKind =
  | "commercial_invoice"
  | "packing_list"
  | "bill_of_lading"
  | "certificate_of_origin"
  | "inspection_report"
  | "lc_documents"
  | "ectn"
  | "form_e_eur1"
  | "insurance_certificate"
  | "certificates_iec_ce_rohs"
  | "battery_msds"
  | "warranty_letter";

export const SHIPPING_DOC_KIND_LABEL: Record<ShippingDocKind, string> = {
  commercial_invoice: "Commercial Invoice",
  packing_list: "Packing List",
  // One checklist row for the transport document: B/L for sea freight,
  // AWB for air. All Solux freight today is sea (containers / LCL).
  bill_of_lading: "Bill of Lading / AWB",
  certificate_of_origin: "Certificate of Origin",
  inspection_report: "Inspection Certificate",
  lc_documents: "LC Documents",
  ectn: "ECTN",
  form_e_eur1: "Form E / EUR1",
  insurance_certificate: "Insurance Certificate",
  certificates_iec_ce_rohs: "IEC / CE / RoHS Certificates",
  battery_msds: "Battery MSDS",
  warranty_letter: "Warranty Letter",
};

export type ShippingDocRequirementLevel = "mandatory" | "required" | "optional";

export type ShippingDocRequirement = {
  kind: ShippingDocKind;
  label: string;
  level: ShippingDocRequirementLevel;
  /** WHY this document is on the list — shown as the row's sub-line. */
  hint: string;
};

const LEVEL_ORDER: Record<ShippingDocRequirementLevel, number> = {
  mandatory: 0,
  required: 1,
  optional: 2,
};

/**
 * Compute the shipment's document checklist.
 *
 *   - mandatory  — every export shipment: Commercial Invoice, Packing
 *                  List, transport document (B/L or AWB).
 *   - required   — driven by the deal: LC package when payment terms
 *                  involve a Letter of Credit; any document ticked in
 *                  the client's BL profile (COO, ECTN, Form E, …).
 *   - optional   — COO + Inspection Certificate always appear (most
 *                  common conditional docs) so the team sees at a
 *                  glance they were CONSIDERED, not forgotten.
 */
export function requiredShippingDocs(args: {
  paymentMode: PaymentMode | null;
  /** Client BL profile checklist rows (m054): key + included. */
  blDocuments: Array<{ key: string; included: boolean }> | null;
}): ShippingDocRequirement[] {
  const { paymentMode, blDocuments } = args;
  const out = new Map<ShippingDocKind, ShippingDocRequirement>();
  const add = (
    kind: ShippingDocKind,
    level: ShippingDocRequirementLevel,
    hint: string
  ) => {
    const existing = out.get(kind);
    // Stronger requirement wins; never downgrade.
    if (existing && LEVEL_ORDER[existing.level] <= LEVEL_ORDER[level]) return;
    out.set(kind, { kind, label: SHIPPING_DOC_KIND_LABEL[kind], level, hint });
  };

  // ----- mandatory: every export shipment -----
  add("commercial_invoice", "mandatory", "Customs clearance · import · bank/LC documentation");
  add("packing_list", "mandatory", "Customs · freight forwarder · receiving warehouse");
  add("bill_of_lading", "mandatory", "Transport document — B/L (sea) or AWB (air)");

  // ----- required: Letter of Credit package -----
  if (paymentMode === "lc" || paymentMode === "hybrid") {
    add("lc_documents", "required", "Payment terms include a Letter of Credit");
  }

  // ----- required: client BL profile (m054) -----
  for (const row of blDocuments ?? []) {
    if (!row.included) continue;
    const kind = row.key as ShippingDocKind;
    if (!(kind in SHIPPING_DOC_KIND_LABEL)) continue; // custom rows → free uploads
    add(kind, "required", "Required by the client's BL profile");
  }

  // ----- optional: most common conditional docs, always visible -----
  add("certificate_of_origin", "optional", "If the destination market requires it");
  add("inspection_report", "optional", "If a pre-shipment inspection applies");

  return Array.from(out.values()).sort(
    (a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      a.label.localeCompare(b.label)
  );
}

/* ---------------------------------------------------------------------
   Readiness — drives the collapsed-header badges ("2/3 required ready")
   ---------------------------------------------------------------------
   Required = mandatory + required levels (a document the client's BL
   profile or the LC terms demands IS required for this shipment).
   Optional documents NEVER block readiness — they get their own count.
   ------------------------------------------------------------------ */

export type ShippingDocsReadiness = {
  requiredReady: number;
  requiredTotal: number;
  optionalReady: number;
  optionalTotal: number;
  /** True when every non-optional document is present. */
  allRequiredReady: boolean;
};

export function computeShippingDocsReadiness(
  requirements: ShippingDocRequirement[],
  presentKinds: Iterable<string>
): ShippingDocsReadiness {
  const present = new Set(presentKinds);
  let requiredReady = 0;
  let requiredTotal = 0;
  let optionalReady = 0;
  let optionalTotal = 0;
  for (const r of requirements) {
    const ready = present.has(r.kind);
    if (r.level === "optional") {
      optionalTotal += 1;
      if (ready) optionalReady += 1;
    } else {
      requiredTotal += 1;
      if (ready) requiredReady += 1;
    }
  }
  return {
    requiredReady,
    requiredTotal,
    optionalReady,
    optionalTotal,
    allRequiredReady: requiredTotal > 0 && requiredReady === requiredTotal,
  };
}
