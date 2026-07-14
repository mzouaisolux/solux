// =====================================================================
// Forwarder freight-quotation email builder (feature #3)
// =====================================================================
// Operations repeats the same "please quote this freight" email to
// forwarders. This turns the packing/freight brief into ready-to-copy text.
// PURE + framework-free so it is unit-testable and reusable from any surface
// (Transport Request queue, SR freight section, future affair logistics).
//
// EXTENSIBILITY: forwarders are a data list today (no address book, no auto
// send). Later phases add real recipients/regions/history by extending
// `Forwarder` (e.g. email, region) and the caller — `buildForwarderEmail`
// keeps the same signature.
// =====================================================================

export interface Forwarder {
  key: string;
  label: string;
  /** Reserved for a later address book — unused for now (text-only). */
  email?: string;
  region?: string;
}

export const FORWARDERS: readonly Forwarder[] = [
  { key: "A", label: "Forwarder A" },
  { key: "B", label: "Forwarder B" },
] as const;

export interface ForwarderContainer {
  type: string;
  quantity: number;
}

/** Raw container rows as stored in either JSON shape (transport_requests uses
 *  `container_type`, packing_list_requests uses `type`). Normalized by
 *  normalizeContainers before use. */
export type RawContainer = {
  type?: string | null;
  container_type?: string | null;
  quantity?: number | null;
};

export interface ForwarderBrief {
  /** Project / affair reference for the subject line. */
  projectRef?: string | null;
  destinationCountry?: string | null;
  destinationPort?: string | null;
  incoterm?: string | null;
  transportMode?: string | null;
  /** Estimated shipment date (ISO) or free text; optional. */
  estimatedShipment?: string | null;
  containers?: RawContainer[] | null;
  /** Gross weight in kg, if known. */
  grossWeightKg?: number | null;
  /** Total volume in CBM, if known. */
  cbm?: number | null;
}

/**
 * Normalize the two container JSON shapes used in the app into {type, quantity}:
 *  - transport_requests.containers → { container_type, quantity }
 *  - packing_list_requests.containers → { type, quantity }
 */
export function normalizeContainers(raw: unknown): ForwarderContainer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c: any) => ({
      type: String(c?.type ?? c?.container_type ?? "").trim(),
      quantity: Number(c?.quantity ?? 0) || 0,
    }))
    .filter((c) => c.type && c.quantity > 0);
}

function containerSummary(containers: ForwarderContainer[]): string {
  if (!containers.length) return "To be confirmed";
  return containers.map((c) => `${c.quantity} × ${c.type}`).join(", ");
}

function destinationLine(b: ForwarderBrief): string {
  const parts = [b.destinationPort, b.destinationCountry].filter((x) => x && String(x).trim());
  return parts.length ? parts.join(", ") : "To be confirmed";
}

/**
 * Build the subject + body for a freight-quotation email. `forwarderKey`
 * selects a forwarder from FORWARDERS; content is identical across forwarders
 * for now (kept as a parameter so per-forwarder tone/recipient can differ later).
 */
export function buildForwarderEmail(
  brief: ForwarderBrief,
  forwarderKey?: string
): { subject: string; body: string; forwarder: Forwarder | null } {
  const forwarder = FORWARDERS.find((f) => f.key === forwarderKey) ?? null;
  const containers = normalizeContainers(brief.containers);
  const ref = (brief.projectRef ?? "").trim() || "—";

  const subject = `Freight quotation request - Project ${ref}`;

  const modeSuffix = brief.transportMode ? ` (${brief.transportMode})` : "";
  const lines = [
    "Hello,",
    "",
    "Could you please provide your best freight quotation for:",
    "",
    `Destination: ${destinationLine(brief)}${modeSuffix}`,
    `Incoterm: ${brief.incoterm?.trim() || "To be confirmed"}`,
    `Estimated shipment: ${brief.estimatedShipment?.trim() || "To be confirmed"}`,
    `Containers: ${containerSummary(containers)}`,
    `Weight: ${brief.grossWeightKg != null && brief.grossWeightKg > 0 ? `${brief.grossWeightKg} kg` : "To be confirmed"}`,
    `Volume: ${brief.cbm != null && brief.cbm > 0 ? `${brief.cbm} CBM` : "To be confirmed"}`,
    "",
    "Thank you.",
    "",
    "Best regards",
  ];

  return { subject, body: lines.join("\n"), forwarder };
}
