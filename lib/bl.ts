/**
 * Bill of Lading (BL) profile — types, defaults, document catalog.
 *
 * Pure module (client + server safe). The BL profile is a reusable
 * shipping template stored per client (m054): who ships, who receives,
 * who to notify, and which export documents the shipment needs.
 *
 * Scope (Phase B1): parties + a document checklist with optional costs.
 * File upload is intentionally out of scope for now.
 */

export type BlShipper = {
  company_name: string | null;
  address: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
};

export type BlConsignee = {
  /** Prefill from the client's own company info (still editable). */
  same_as_client: boolean;
  company_name: string | null;
  address: string | null;
  country: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
};

export type BlNotify = {
  /** Prefill from the consignee (still editable). */
  same_as_consignee: boolean;
  company_name: string | null;
  address: string | null;
  country: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
};

export type BlDocument = {
  /** Catalog key (e.g. "ectn") or a slug for custom rows. */
  key: string;
  label: string;
  included: boolean;
  /** Optional cost charged for producing/obtaining this document. */
  cost: number | null;
  currency: string;
  /** True for manually-added rows not in the standard catalog. */
  custom?: boolean;
};

export type BlProfile = {
  shipper: BlShipper;
  consignee: BlConsignee;
  notify: BlNotify;
  documents: BlDocument[];
  /** Free-text manual space for anything not covered above. */
  notes: string | null;
};

/**
 * Default shipper — the factory/exporter. Prefilled (and editable) on
 * every client's BL profile so sales doesn't retype it. Update here if
 * the exporting entity ever changes.
 */
export const SOLUX_SHIPPER_DEFAULT: BlShipper = {
  company_name: "CHANGZHOU SOLUX TECHNOLOGY COMPANY LTD",
  address:
    "3F, D1 Building, Hutang Sci-Tech Park, Wujin, Changzhou, China",
  contact_person: "Vera Yang",
  phone: "+86 (0) 182 6115 6967",
  email: "vera@zr-light.com.cn",
};

/**
 * Standard export-document catalog. Each becomes a checklist row in the
 * BL editor; sales ticks the ones a given client requires and can set a
 * cost. Order is the display order.
 */
export const BL_DOCUMENT_CATALOG: Array<{ key: string; label: string }> = [
  { key: "ectn", label: "ECTN" },
  { key: "commercial_invoice", label: "Commercial Invoice" },
  { key: "packing_list", label: "Packing List" },
  { key: "bill_of_lading", label: "Bill of Lading" },
  { key: "certificate_of_origin", label: "Certificate of Origin" },
  { key: "form_e_eur1", label: "Form E / EUR1" },
  { key: "insurance_certificate", label: "Insurance Certificate" },
  { key: "certificates_iec_ce_rohs", label: "IEC / CE / RoHS Certificates" },
  { key: "battery_msds", label: "Battery MSDS" },
  { key: "inspection_report", label: "Inspection Report" },
  { key: "warranty_letter", label: "Warranty Letter" },
];

/** A blank document row for a catalog entry (not included by default). */
function catalogRow(
  key: string,
  label: string,
  currency: string
): BlDocument {
  return { key, label, included: false, cost: null, currency };
}

/**
 * Build a fresh BL profile with the shipper prefilled to Solux and the
 * full document catalog laid out (all unticked). `currency` seeds the
 * per-document cost currency (defaults to USD).
 */
export function defaultBlProfile(currency = "USD"): BlProfile {
  return {
    shipper: { ...SOLUX_SHIPPER_DEFAULT },
    consignee: {
      same_as_client: false,
      company_name: null,
      address: null,
      country: null,
      contact_person: null,
      phone: null,
      email: null,
      tax_id: null,
    },
    notify: {
      same_as_consignee: false,
      company_name: null,
      address: null,
      country: null,
      contact_person: null,
      phone: null,
      email: null,
    },
    documents: BL_DOCUMENT_CATALOG.map((d) => catalogRow(d.key, d.label, currency)),
    notes: null,
  };
}

/**
 * Normalize a stored (possibly partial / legacy) profile into a full
 * shape. Merges any saved catalog rows over a fresh default, preserves
 * custom rows, and backfills the shipper with Solux defaults when blank.
 *
 * Safe to call with `null` (returns a fresh default profile).
 */
export function normalizeBlProfile(
  raw: unknown,
  currency = "USD"
): BlProfile {
  const base = defaultBlProfile(currency);
  if (!raw || typeof raw !== "object") return base;
  const p = raw as Partial<BlProfile>;

  const shipper: BlShipper = { ...base.shipper, ...(p.shipper ?? {}) };
  // If a saved shipper has all-empty fields, fall back to the default.
  const shipperEmpty =
    !shipper.company_name &&
    !shipper.address &&
    !shipper.contact_person &&
    !shipper.phone &&
    !shipper.email;
  const resolvedShipper = shipperEmpty ? { ...base.shipper } : shipper;

  const consignee: BlConsignee = { ...base.consignee, ...(p.consignee ?? {}) };
  const notify: BlNotify = { ...base.notify, ...(p.notify ?? {}) };

  // Merge saved document rows over the catalog by key; keep customs.
  const savedByKey = new Map<string, BlDocument>();
  for (const d of (p.documents ?? []) as BlDocument[]) {
    if (d && typeof d.key === "string") savedByKey.set(d.key, d);
  }
  const catalogDocs = base.documents.map((d) => {
    const saved = savedByKey.get(d.key);
    return saved ? { ...d, ...saved, custom: false } : d;
  });
  const customDocs = (p.documents ?? [])
    .filter((d: any) => d && d.custom)
    .map((d: any) => ({
      key: String(d.key ?? `custom_${Math.random().toString(36).slice(2, 8)}`),
      label: String(d.label ?? "Custom document"),
      included: !!d.included,
      cost: typeof d.cost === "number" ? d.cost : null,
      currency: String(d.currency ?? currency),
      custom: true as const,
    }));

  return {
    shipper: resolvedShipper,
    consignee,
    notify,
    documents: [...catalogDocs, ...customDocs],
    notes: typeof p.notes === "string" ? p.notes : null,
  };
}

/** Sum of costs across included documents, bucketed by currency. */
export function blDocumentCostByCurrency(
  profile: BlProfile
): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of profile.documents) {
    if (d.included && d.cost != null && d.cost > 0) {
      out.set(d.currency, (out.get(d.currency) ?? 0) + d.cost);
    }
  }
  return out;
}
