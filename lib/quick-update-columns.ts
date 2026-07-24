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
import type { Capability } from "@/lib/permissions";

/** BL profile completeness on the client (drives the BL cell colour). */
export type BlStatus = "complete" | "partial" | "missing";

/** One required shipping document, resolved per order (server-derived). */
export type ShippingDocItem = {
  key: string;
  label: string;
  level: "mandatory" | "required" | "optional";
  present: boolean;
};

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

  // provenance — 'workflow' rows come from Launch Production (linked
  // quotation); 'manual' rows are typed in during the Excel transition and
  // may be linked to nothing. Manual money fields feed the same expected
  // deposit/balance derivation the quotation normally provides.
  source: "workflow" | "manual";
  manualTotal: number | null;
  manualDepositPct: number | null;

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

  // production timeline — planned vs actual (owner 2026-07-08: "the dates
  // are much more valuable than only +5 days")
  initialDeadline: string | null; // planned finish (immutable baseline)
  productionDue: string | null; // current expected finish (materialised)
  actualCompletion: string | null; // actual finish once production completed
  factoryDelayDays: number;
  externalDelayDays: number;

  // shipping (transport terminology: ETD = departure, ETA = arrival —
  // production dates are NEVER called ETA, they are "Production Due")
  shipmentBooked: boolean;
  /** Workflow orders: the quotation's incoterm (read-only source of truth).
   *  Manual orders: shipping_details.incoterm (editable). */
  incoterm: string | null;
  etd: string | null;
  eta: string | null; // transport arrival (distinct from productionDue)
  carrier: string | null; // shipping_details.forwarder
  bookingNumber: string | null;
  containerNumber: string | null;
  trackingUrl: string | null;
  blNumber: string | null;
  blStatus: BlStatus;

  // documents — counts + the actual requirement checklist (derived from
  // payment mode + the client's BL profile; shown in the Documents popover
  // so Operations knows WHICH documents the shipment needs, not just "0/7")
  ciNumber: string | null;
  docsReady: number;
  docsTotal: number;
  docsItems: ShippingDocItem[];

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
export type EditableFieldKind = "scalar" | "scalar-num" | "blob-str" | "blob-num";

export const EDITABLE_FIELDS: Record<
  string,
  { kind: EditableFieldKind; capability: Capability }
> = {
  // scalar columns on production_orders
  etd: { kind: "scalar", capability: "production_order.edit_shipment" },
  eta: { kind: "scalar", capability: "production_order.edit_shipment" },
  shipping_notes: { kind: "scalar", capability: "production_order.edit_shipment" },
  // manual-order money facts (m155) — side-effect-free: they only change the
  // DERIVED expected deposit/balance, recomputed at read time. Receipts
  // (deposit/balance received) stay in the payments bundle action.
  manual_total_price: { kind: "scalar-num", capability: "production_order.edit_payments" },
  manual_deposit_percent: { kind: "scalar-num", capability: "production_order.edit_payments" },
  // keys inside the shipping_details jsonb blob
  // incoterm is MANUAL-orders-only in the UI (workflow orders read the
  // quotation's incoterm); the blob key is harmless for workflow rows.
  incoterm: { kind: "blob-str", capability: "production_order.edit_shipment" },
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

/**
 * Column order follows the operations workflow the eye scans left→right:
 * WHO (PO/Client/Sales, sticky) → Production → Payment → Transport → Docs.
 * The first four columns are sticky so you always know which order you are
 * editing during horizontal scroll.
 */
export const QUICK_UPDATE_COLUMNS: ColumnDef[] = [
  // identity (sticky)
  { key: "number", label: "PO", kind: "readonly", group: "identity", width: 135, sticky: true, defaultVisible: true },
  { key: "client", label: "Client", kind: "readonly", group: "identity", width: 185, sticky: true, defaultVisible: true },
  { key: "sales", label: "Sales", kind: "readonly", group: "identity", width: 110, sticky: true, defaultVisible: true },

  // production
  { key: "status", label: "Production Status", kind: "status", group: "production", width: 175, capability: "production_order.edit_status", sticky: true, defaultVisible: true },

  // payment (the dot on each amount already encodes complete/partial/none,
  // so the redundant Payment Status pill column is opt-in)
  { key: "deposit", label: "Deposit", kind: "payment", group: "payment", width: 140, capability: "production_order.edit_payments", numeric: true, defaultVisible: true },
  { key: "balance", label: "Balance", kind: "payment", group: "payment", width: 140, capability: "production_order.edit_payments", numeric: true, defaultVisible: true },
  { key: "payment_status", label: "Payment Status", kind: "readonly", group: "payment", width: 150, defaultVisible: false },

  // production timeline (Production Due = end-of-production date; ETA is
  // reserved for transport arrival). The cell stacks planned vs actual
  // dates — real dates beat a bare "+5d".
  { key: "production_due", label: "Production Due", kind: "readonly", group: "production", width: 165, defaultVisible: true },
  { key: "production_deadline", label: "Initial Deadline", kind: "readonly", group: "production", width: 130, defaultVisible: false },
  { key: "factory_delay", label: "Factory Delay", kind: "timeline", group: "production", width: 105, capability: "production_order.edit_deadline", numeric: true, defaultVisible: true },
  { key: "external_delay", label: "External Delay", kind: "timeline", group: "production", width: 110, capability: "production_order.edit_deadline", numeric: true, defaultVisible: false },

  // transport — Incoterm first: it tells Operations at a glance whether
  // shipping is Solux's responsibility (CIF/DDP) or the client's (FOB/EXW)
  { key: "incoterm", label: "Incoterm", kind: "readonly", group: "shipping", width: 92, field: "incoterm", capability: "production_order.edit_shipment", defaultVisible: true },
  { key: "carrier", label: "Carrier", kind: "text", group: "shipping", width: 130, field: "forwarder", capability: "production_order.edit_shipment", defaultVisible: true },
  { key: "etd", label: "ETD", kind: "date", group: "shipping", width: 128, field: "etd", capability: "production_order.edit_shipment", defaultVisible: true },
  { key: "eta", label: "ETA", kind: "date", group: "shipping", width: 128, field: "eta", capability: "production_order.edit_shipment", defaultVisible: true },
  { key: "bl", label: "BL", kind: "bl", group: "shipping", width: 130, capability: "production_order.edit_shipment", defaultVisible: true },
  { key: "booking", label: "Booking", kind: "text", group: "shipping", width: 140, field: "booking_number", capability: "production_order.edit_shipment", defaultVisible: false },
  { key: "container", label: "Container", kind: "text", group: "shipping", width: 150, field: "container_number", capability: "production_order.edit_shipment", defaultVisible: false },
  { key: "tracking", label: "Tracking", kind: "text", group: "shipping", width: 150, field: "tracking_url", capability: "production_order.edit_shipment", defaultVisible: false },

  // documents
  { key: "documents", label: "Shipping Documents", kind: "docs", group: "docs", width: 145, defaultVisible: true },

  // meta
  { key: "notes", label: "Notes", kind: "text", group: "meta", width: 220, field: "shipping_notes", capability: "production_order.edit_shipment", defaultVisible: true },
  { key: "alert", label: "Alert", kind: "readonly", group: "meta", width: 150, defaultVisible: false },
  { key: "updated", label: "Last Updated", kind: "readonly", group: "meta", width: 130, defaultVisible: false },
];

export const DEFAULT_VISIBLE_KEYS: string[] = QUICK_UPDATE_COLUMNS.filter(
  (c) => c.defaultVisible !== false
).map((c) => c.key);

/* ============================================================
   Pure date helpers (no external deps)
   ============================================================ */

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "2026-08-12" → "12 Aug 26" (compact, human, fixed-locale). null/invalid → "". */
export function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const month = MONTHS_SHORT[Number(m[2]) - 1];
  if (!month) return "";
  return `${Number(m[3])} ${month} ${m[1].slice(2)}`;
}

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
  | "due_this_week"
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
    id: "due_this_week",
    label: "Due This Week",
    test: (r, ctx) => {
      const d = daysBetweenISO(ctx.today, r.productionDue);
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
