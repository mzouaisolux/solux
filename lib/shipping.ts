/**
 * Shipping / BL operational details (m070) — the execution fields that end up
 * on the actual Bill of Lading, stored per production order in
 * `production_orders.shipping_details` (jsonb).
 *
 * Pure module (client + server safe). v1 = the essential operational set.
 * Parties (consignee / notify) live on the client's BL profile (m054, lib/bl.ts);
 * ports / incoterm live on the quote; ETD / ETA / booking live as their own
 * order columns. This holds what those don't.
 */

export type ShippingDetails = {
  /** Bill of Lading number (filled once the carrier issues it). */
  bl_number: string | null;
  /** Freight forwarder / agent handling the shipment. */
  forwarder: string | null;
  vessel: string | null;
  voyage: string | null;
  /** Kilograms. */
  gross_weight: number | null;
  net_weight: number | null;
  /** Cubic metres. */
  cbm: number | null;
  /** Number of packages / cartons. */
  packages: number | null;
  /** Harmonised System customs code. */
  hs_code: string | null;
  /** Carrier booking / reference number (Quick Update — jsonb, no migration). */
  booking_number: string | null;
  /** Container number (Quick Update — jsonb, no migration). */
  container_number: string | null;
  /** Carrier tracking URL (Quick Update — jsonb, no migration). */
  tracking_url: string | null;
};

export function emptyShippingDetails(): ShippingDetails {
  return {
    bl_number: null,
    forwarder: null,
    vessel: null,
    voyage: null,
    gross_weight: null,
    net_weight: null,
    cbm: null,
    packages: null,
    hs_code: null,
    booking_number: null,
    container_number: null,
    tracking_url: null,
  };
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Normalise a stored (possibly partial / legacy / null) value into a full shape. */
export function normalizeShippingDetails(raw: unknown): ShippingDetails {
  const base = emptyShippingDetails();
  if (!raw || typeof raw !== "object") return base;
  const p = raw as Partial<ShippingDetails>;
  return {
    bl_number: str(p.bl_number),
    forwarder: str(p.forwarder),
    vessel: str(p.vessel),
    voyage: str(p.voyage),
    gross_weight: num(p.gross_weight),
    net_weight: num(p.net_weight),
    cbm: num(p.cbm),
    packages: num(p.packages),
    hs_code: str(p.hs_code),
    booking_number: str(p.booking_number),
    container_number: str(p.container_number),
    tracking_url: str(p.tracking_url),
  };
}

/** True when nothing has been filled in yet (drives the "incomplete" hint). */
export function isShippingDetailsEmpty(d: ShippingDetails): boolean {
  return (
    !d.bl_number &&
    !d.forwarder &&
    !d.vessel &&
    !d.voyage &&
    d.gross_weight == null &&
    d.net_weight == null &&
    d.cbm == null &&
    d.packages == null &&
    !d.hs_code &&
    !d.booking_number &&
    !d.container_number &&
    !d.tracking_url
  );
}
