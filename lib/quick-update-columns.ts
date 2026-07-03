/**
 * Quick Update workspace — pure, testable metadata for the Production Orders
 * spreadsheet (`/production/quick-update`).
 *
 * This module owns THREE things, all side-effect-free so the node test runner
 * can load it standalone (imports are `import type` only — stripped at
 * runtime, zero runtime dependency):
 *
 *   1. `QuickUpdateRow` — the already-derived, primitive-only shape the server
 *      page computes per order and the client table renders. Derivations
 *      (payment state, alert, delay split, expected deposit/balance) are done
 *      ONCE on the server with the existing lib helpers, never re-derived here.
 *   2. `QUICK_UPDATE_COLUMNS` — the column catalogue (label, kind, edited
 *      field, capability, default width/visibility, group).
 *   3. `EDITABLE_FIELDS` + smart-filter predicates + search — the whitelist the
 *      granular save action trusts, and the pure filter logic the UI applies.
 *
 * Keep it pure: NO React, NO DB, NO `@/…` runtime imports.
 */

import type { ProductionOrderStatus, ProductionPaymentState } from "./types.ts";
import type { OperationsAlertLevel } from "./operations-alerts.ts";
import type { Capability } from "./permissions.ts";

/** BL profile completeness on the client (drives the BL cell colour). */
export type BlStatus = "complete" | "partial" | "missing";

/**
 * One row of the Quick Update table. Every value is a primitive or null —
 * the server has already flattened the joins and run the derivations, so the
 * client (and these predicates) never touch Supabase or re-compute money.
 */
export type QuickUpdateRow = {
  id: string;
  number: string;
  detailHref: string;

  // identity
  clientName: string;
  clientCode: string | null;
  country: string | null;
  clientId: string | null;
  salesLabel: string | null;
  salesOwnerId: string | null;

  // status
  status: ProductionOrderStatus;
  archived: boolean;
  currency: string;

  // payment (all derived on the server)
  paymentState: ProductionPaymentState;
  expectedDeposit: number;
  depositReceived: number;
  expectedBalance: number;
  balanceReceived: number;
  balanceRemaining: number;
  depositReceivedAt: string | null;
  balanceReceivedAt: string | null;
  balanceDueDate: string | null;
  lcExpiryDate: string | null;
  paymentNotes: string | null;

  // production timeline
  initialDeadline: string | null;
  currentEta: string | null; // current_production_deadline (materialised)
  factoryDelayDays: number;
  externalDelayDays: number;

  // shipping
  shipmentBooked: boolean;
  etd: string | null;
  eta: string | null; // operational ETA (own column, distinct from currentEta)
  carrier: string | null; // shipping_details.forwarder
  bookingNumber: string | null;
  containerNumber: string | null;
  trackingUrl: string | null;
  blNumber: string | null;
  blStatus: BlStatus;

  // documents
  ciNumber: string | null;
  docsReady: number;
  docsTotal: number;

  // meta
  notes: string | null; // shipping_notes
  alertLevel: OperationsAlertLevel;
  alertLabel: string;
  updatedAt: string | null;
};

/* ============================================================
   Editable fields — the whitelist the granular save trusts
   ============================================================
   Only NEUTRAL, side-effect-free fields live here (all under the
   `production_order.edit_shipment` capability). Fields with workflow
   side effects are NOT here — they go through the existing bundle
   actions instead:
     - status                    → updateProductionOrderStatus
     - deposit/balance/due/LC     → updateProductionOrderPayments (Payment popover)
     - shipment_booked            → updateProductionOrderShipment (BL gate)
     - deadlines / delays         → updateProductionOrderDeadline etc. (Timeline popover)
*/
export type EditableFieldKind = "scalar" | "blob-str" | "blob-num";

export const EDITABLE_FIELDS: Record<
  string,
  { kind: EditableFieldKind; capability: Capability }
> = {
  // scalar columns on production_orders
  etd: { kind: "scalar", capability: "production_order.edit_shipment" },
  eta: { kind: "scalar", capability: "production_order.edit_shipment" },
  shipping_notes: { kind: "scalar", capability: "production_order.edit_shipment" },
  // keys inside the shipping_details jsonb blob
  bl_number: { kind: "blob-str", capability: "production_order.edit_shipment" },
  forwarder: { kind: "blob-str", capability: "production_order.edit_shipment" },
  vessel: { kind: "blob-str", capability: "production_order.edit_shipment" },
  voyage: { kind: "blob-str", capability: "production_order.edit_shipment" },
  hs_code: { kind: "blob-str", capability: "production_order.edit_shipment" },
  booking_number: { kind: "blob-str", capability: "production_order.edit_shipment" },
  container_number: { kind: "blob-str", capability: "production_order.edit_shipment" },
  tracking_url: { kind: "blob-str", capability: "production_order.edit_shipment" },
  gross_weight: { kind: "blob-num", capability: "production_order.edit_shipment" },
  net_weight: { kind: "blob-num", capability: "production_order.edit_shipment" },
  cbm: { kind: "blob-num", capability: "production_order.edit_shipment" },
  packages: { kind: "blob-num", capability: "production_order.edit_shipment" },
};

export function isEditableField(field: string): boolean {
  return Object.prototype.hasOwnProperty.call(EDITABLE_FIELDS, field);
}

/* ============================================================
   Column catalogue
   ============================================================ */

/**
 * How a cell behaves:
 *   readonly  — display only
 *   status    — inline dropdown (updateProductionOrderStatus)
 *   text/date/number — inline editable, granular auto-save (updateOrderCell)
 *   payment/shipping/bl/timeline/docs — opens a side popover (bundle actions)
 */
export type CellKind =
  | "readonly"
  | "status"
  | "text"
  | "date"
  | "number"
  | "checkbox"
  | "payment"
  | "shipping"
  | "bl"
  | "timeline"
  | "docs";

export type ColumnGroup =
  | "identity"
  | "payment"
  | "production"
  | "shipping"
  | "docs"
  | "meta";

export type ColumnDef = {
  key: string;
  label: string;
  kind: CellKind;
  group: ColumnGroup;
  width: number;
  /** DB field the cell edits (for granular text/date/number cells). */
  field?: string;
  /** Capability required to edit — the cell is read-only without it. */
  capability?: string;
  sticky?: boolean;
  defaultVisible?: boolean;
  /** Right-align numeric/money columns. */
  numeric?: boolean;
};

export const QUICK_UPDATE_COLUMNS: ColumnDef[] = [
  // identity
  { key: "number", label: "PO Number", kind: "readonly", group: "identity", width: 150, sticky: true, defaultVisible: true },
  { key: "client", label: "Client", kind: "readonly", group: "identity", width: 200, defaultVisible: true },
  { key: "sales", label: "Sales", kind: "readonly", group: "identity", width: 130, defaultVisible: true },

  // status + payment
  { key: "status", label: "Production Status", kind: "status", group: "production", width: 170, capability: "production_order.edit_status", defaultVisible: true },
  { key: "deposit", label: "Deposit", kind: "payment", group: "payment", width: 130, capability: "production_order.edit_payments", numeric: true, defaultVisible: true },
  { key: "balance", label: "Balance", kind: "payment", group: "payment", width: 130, capability: "production_order.edit_payments", numeric: true, defaultVisible: true },
  { key: "payment_status", label: "Payment Status", kind: "readonly", group: "payment", width: 150, defaultVisible: true },

  // production timeline
  { key: "current_eta", label: "Current ETA", kind: "readonly", group: "production", width: 130, defaultVisible: true },
  { key: "production_deadline", label: "Production Deadline", kind: "readonly", group: "production", width: 150, defaultVisible: false },
  { key: "factory_delay", label: "Factory Delay", kind: "timeline", group: "production", width: 120, capability: "production_order.edit_deadline", numeric: true, defaultVisible: true },
  { key: "external_delay", label: "External Delay", kind: "timeline", group: "production", width: 120, capability: "production_order.edit_deadline", numeric: true, defaultVisible: false },

  // shipping
  { key: "carrier", label: "Carrier", kind: "text", group: "shipping", width: 140, field: "forwarder", capability: "production_order.edit_shipment", defaultVisible: true },
  { key: "booking", label: "Booking", kind: "text", group: "shipping", width: 140, field: "booking_number", capability: "production_order.edit_shipment", defaultVisible: false },
  { key: "container", label: "Container", kind: "text", group: "shipping", width: 150, field: "container_number", capability: "production_order.edit_shipment", defaultVisible: false },
  { key: "etd", label: "ETD", kind: "date", group: "shipping", width: 130, field: "etd", capability: "production_order.edit_shipment", defaultVisible: true },
  { key: "eta", label: "ETA", kind: "date", group: "shipping", width: 130, field: "eta", capability: "production_order.edit_shipment", defaultVisible: true },
  { key: "bl", label: "BL", kind: "bl", group: "shipping", width: 130, capability: "production_order.edit_shipment", defaultVisible: true },
  { key: "tracking", label: "Tracking", kind: "text", group: "shipping", width: 150, field: "tracking_url", capability: "production_order.edit_shipment", defaultVisible: false },

  // documents
  { key: "documents", label: "Shipping Documents", kind: "docs", group: "docs", width: 160, defaultVisible: true },

  // meta
  { key: "notes", label: "Notes", kind: "text", group: "meta", width: 200, field: "shipping_notes", capability: "production_order.edit_shipment", defaultVisible: true },
  { key: "alert", label: "Alert", kind: "readonly", group: "meta", width: 150, defaultVisible: true },
  { key: "updated", label: "Last Updated", kind: "readonly", group: "meta", width: 130, defaultVisible: false },
];

export const DEFAULT_VISIBLE_KEYS: string[] = QUICK_UPDATE_COLUMNS.filter(
  (c) => c.defaultVisible !== false
).map((c) => c.key);

/* ============================================================
   Pure date helpers (no external deps)
   ============================================================ */

/** Whole calendar days from `fromISO` to `toISO` (YYYY-MM-DD). null if invalid. */
export function daysBetweenISO(
  fromISO: string | null | undefined,
  toISO: string | null | undefined
): number | null {
  if (!fromISO || !toISO) return null;
  const a = Date.parse(fromISO.slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(toISO.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/* ============================================================
   Smart filters — pure predicates over a derived row
   ============================================================ */

export type FilterContext = {
  today: string; // YYYY-MM-DD
  currentUserId: string | null;
};

export type SmartFilterId =
  | "waiting_deposit"
  | "production_complete"
  | "waiting_shipment"
  | "bl_missing"
  | "eta_this_week"
  | "late"
  | "waiting_documents"
  | "waiting_carrier"
  | "my_orders";

export type SmartFilter = {
  id: SmartFilterId;
  label: string;
  test: (row: QuickUpdateRow, ctx: FilterContext) => boolean;
};

const TERMINAL: ProductionOrderStatus[] = ["delivered", "cancelled"];
const isTerminal = (r: QuickUpdateRow) => TERMINAL.includes(r.status);

export const SMART_FILTERS: SmartFilter[] = [
  {
    id: "waiting_deposit",
    label: "Waiting Deposit",
    test: (r) => r.status === "awaiting_deposit",
  },
  {
    id: "production_complete",
    label: "Production Complete",
    test: (r) => r.status === "production_completed",
  },
  {
    id: "waiting_shipment",
    label: "Waiting Shipment",
    test: (r) => r.status === "production_completed" && !r.shipmentBooked,
  },
  {
    id: "bl_missing",
    // A shipment is being prepared but there's no BL number yet.
    label: "BL Missing",
    test: (r) =>
      !isTerminal(r) &&
      !r.blNumber &&
      (r.shipmentBooked || r.status === "production_completed"),
  },
  {
    id: "eta_this_week",
    label: "ETA This Week",
    test: (r, ctx) => {
      const d = daysBetweenISO(ctx.today, r.currentEta);
      return d !== null && d >= 0 && d <= 7;
    },
  },
  {
    id: "late",
    label: "Late Orders",
    test: (r) => r.alertLevel === "overdue" || r.factoryDelayDays > 0,
  },
  {
    id: "waiting_documents",
    label: "Waiting Documents",
    test: (r) => !isTerminal(r) && r.docsTotal > 0 && r.docsReady < r.docsTotal,
  },
  {
    id: "waiting_carrier",
    label: "Waiting Carrier",
    test: (r) =>
      r.status === "production_completed" && !r.shipmentBooked && !r.carrier,
  },
  {
    id: "my_orders",
    label: "My Orders",
    test: (r, ctx) =>
      ctx.currentUserId != null && r.salesOwnerId === ctx.currentUserId,
  },
];

export function getSmartFilter(id: string): SmartFilter | undefined {
  return SMART_FILTERS.find((f) => f.id === id);
}

/* ============================================================
   Free-text search + facet extraction
   ============================================================ */

/** Case-insensitive match across the human-readable identity fields. */
export function matchesSearch(row: QuickUpdateRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    row.number,
    row.clientName,
    row.clientCode,
    row.country,
    row.salesLabel,
    row.carrier,
    row.blNumber,
    row.bookingNumber,
    row.containerNumber,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/** Distinct, sorted values for a facet column (Country / Sales / Customer). */
export function facetValues(
  rows: QuickUpdateRow[],
  pick: (r: QuickUpdateRow) => string | null
): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = pick(r);
    if (v) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
