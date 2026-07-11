// =====================================================================
// Transport Request module — pure helpers (owner 2026-07-10).
//
// The module (m161) gives Sales one place for every logistics request,
// always linked Client → Affair, in three kinds. Completed price /
// price_update rows ARE the affair's transport price history (V1..Vn,
// never overwritten). Lines mirror document_lines' shape so quotation
// products import 1:1 — and the captured configuration (solar panel size
// above all) is the foundation for future automatic packing lists / CBM /
// container loading (NOT implemented yet, by design).
// =====================================================================

export type TransportRequestKind = "packing_list" | "price" | "price_update";

export type TransportRequestStatus =
  | "waiting"
  | "in_progress"
  | "completed"
  | "cancelled";

export const TRANSPORT_KINDS: readonly {
  key: TransportRequestKind;
  emoji: string;
  label: string;
  description: string;
}[] = [
  {
    key: "packing_list",
    emoji: "📦",
    label: "New Packing List Request",
    description: "Operations prepares the packing list for a project shipment",
  },
  {
    key: "price",
    emoji: "🚢",
    label: "Packing List + Transport Quotation",
    description: "Packing calculation + a freight quotation in one request",
  },
  {
    key: "price_update",
    emoji: "🔄",
    label: "Transport Price Update Request",
    description:
      "Refresh an existing transport quotation — rates, destination, incoterm, products or quantities changed",
  },
];

/**
 * Owner UX round 2 (2026-07-10): the WIZARD offers ONE main workflow —
 * "New Packing List Request" — with an optional "Request Transport Quotation
 * as well" checkbox (checked → the request is submitted as kind 'price':
 * packing + freight answered together, and it becomes a version of the
 * price history). Price UPDATES are not started from a blank wizard: they
 * start from an existing quotation (the /transport list or the affair card)
 * which deep-links here with ?kind=price_update pre-loaded.
 */
export const WIZARD_MAIN_KIND = TRANSPORT_KINDS[0];

/** Standard solar-panel sizes — the fallback when a product's category has
 *  no SOLAR PANEL config field (options are data-driven when it does). */
export const SOLAR_PANEL_FALLBACK_OPTIONS = [
  "100W",
  "150W",
  "200W",
  "250W",
  "300W",
  "350W",
  "430W",
  "500W",
  "600W",
] as const;

export function transportKindLabel(kind: string): string {
  return TRANSPORT_KINDS.find((k) => k.key === kind)?.label ?? kind;
}

export const TRANSPORT_STATUS_LABEL: Record<TransportRequestStatus, string> = {
  waiting: "Waiting",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Why sales asks for a price update — datalist suggestions (m149 spirit). */
export const TRANSPORT_UPDATE_REASONS = [
  "Freight rates changed",
  "Destination changed",
  "Incoterm changed",
  "Products changed",
  "Quantities changed",
  "Customer asked for an updated quotation",
] as const;

/**
 * The solar panel is THE transport-driving parameter (carton size, pallet
 * size, CBM, container loading) — its config field is surfaced prominently
 * on every line card. Matches the catalog's field naming ("SOLAR PANEL").
 */
export function isSolarPanelField(fieldName: string): boolean {
  return /solar\s*panel/i.test(fieldName);
}

/** A transport request line — mirrors document_lines' shape (m161). */
export type TransportRequestLineDraft = {
  product_id: string | null;
  category_id: string | null;
  /** Catalog-name snapshot (survives product deletion). */
  product_name: string | null;
  client_product_name: string | null;
  quantity: number;
  config_values: Record<string, string>;
};

/**
 * Map ONE quotation line to a transport-request line draft. Import keeps
 * product, quantity and the exact configuration; free-text lines (custom
 * poles, SR-flattened specs — product_id null) stay readable through
 * client_product_name. Returns null for rows with nothing to ship.
 */
export function mapDocumentLineToRequestLine(
  line: {
    product_id?: string | null;
    category_id?: string | null;
    quantity?: number | string | null;
    config_values?: Record<string, string> | null;
    client_product_name?: string | null;
  },
  productName?: string | null
): TransportRequestLineDraft | null {
  const hasProduct = !!line.product_id;
  const name = (line.client_product_name ?? "").trim();
  if (!hasProduct && !name) return null;
  const qty = Number(line.quantity ?? 1);
  return {
    product_id: line.product_id ?? null,
    category_id: line.category_id ?? null,
    product_name: productName ?? null,
    client_product_name: name || null,
    quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
    config_values: line.config_values ?? {},
  };
}

/**
 * Version numbers for the affair's transport price history: completed
 * price / price_update rows, oldest first → V1, V2, V3… Never overwritten;
 * display-time numbering (stable order key = completed_at, then id).
 */
export function versionedHistory<
  T extends {
    id: string;
    kind: string;
    status: string;
    completed_at?: string | null;
  }
>(rows: T[]): (T & { version: number })[] {
  return rows
    .filter(
      (r) =>
        r.status === "completed" &&
        (r.kind === "price" || r.kind === "price_update")
    )
    .sort((a, b) => {
      const da = a.completed_at ?? "";
      const db = b.completed_at ?? "";
      if (da !== db) return da < db ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    })
    .map((r, i) => ({ ...r, version: i + 1 }));
}

/** True when the error means m161 isn't applied yet (dormant mode). */
export function isTransportTablesMissing(err: {
  code?: string | null;
  message?: string | null;
}): boolean {
  const code = err.code ?? "";
  const msg = err.message ?? "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /transport_requests|transport_request_lines/.test(msg)
  );
}

export const TRANSPORT_MIGRATION_HINT =
  "Transport request tables missing — apply migration m161 (161_transport_requests.sql) in the Supabase SQL editor.";
