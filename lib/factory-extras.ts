/**
 * Additional factory attributes (m071) — factory-side-only technical fields
 * that are NOT part of the sales configuration: controller, connector type,
 * cable / wiring / driver references, mounting hardware, packaging refs,
 * internal production refs, inspection requirements, factory notes, …
 *
 * These COMPLEMENT — never replace — the sales-derived factory instructions
 * (which resolve via global mapping → client preset → order override on the
 * SALES field_name). Extras are free-standing, self-describing attributes
 * (`{ key, label, value }`) so a new factory concept needs no migration.
 *
 * Two layers, resolved per attribute key:
 *
 *     client preset (reusable per client+product)  >  order override (this line)
 *
 * (A product-default layer is reserved for Phase 2 — the product admin editor.)
 *
 * Pure module (client + server safe). Stored in the jsonb columns as an ARRAY.
 */

export type FactoryExtra = { key: string; label: string; value: string };
export type FactoryExtras = FactoryExtra[];

export type FactoryExtraCategory =
  | "Electronics"
  | "Mechanical"
  | "Battery"
  | "Packaging"
  | "Production"
  | "Other";

export const FACTORY_EXTRA_CATEGORIES: FactoryExtraCategory[] = [
  "Electronics",
  "Mechanical",
  "Battery",
  "Packaging",
  "Production",
  "Other",
];

/**
 * Suggested field types per category for the "Add factory field" picker.
 * NOT a fixed schema — just shortcuts. "Custom field" is always available, and
 * adding a suggestion here needs no migration.
 */
export const FACTORY_EXTRA_SUGGESTIONS: Record<
  FactoryExtraCategory,
  { key: string; label: string }[]
> = {
  Electronics: [
    { key: "controller", label: "Controller" },
    { key: "connector_type", label: "Connector type" },
    { key: "cable_reference", label: "Cable reference" },
    { key: "wiring_reference", label: "Wiring reference" },
    { key: "driver_reference", label: "Driver reference" },
    { key: "led_reference", label: "LED reference" },
  ],
  Mechanical: [
    { key: "mounting_hardware", label: "Mounting hardware" },
    { key: "bracket_reference", label: "Bracket reference" },
    { key: "pole_arm_reference", label: "Pole / arm reference" },
  ],
  Battery: [
    { key: "bms_reference", label: "BMS reference" },
    { key: "cell_reference", label: "Cell reference" },
  ],
  Packaging: [
    { key: "packaging_reference", label: "Packaging reference" },
    { key: "carton_spec", label: "Carton spec" },
    { key: "label_reference", label: "Sticker / label reference" },
  ],
  Production: [
    { key: "internal_production_ref", label: "Internal production reference" },
    { key: "bom_reference", label: "BOM reference" },
    { key: "inspection_requirement", label: "Inspection requirement" },
    { key: "factory_note", label: "Factory note" },
  ],
  Other: [],
};

/** Slug for a custom attribute key (stable, lowercase, underscore). */
export function slugifyKey(label: string): string {
  const base = String(label ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || `custom_${Date.now().toString(36)}`;
}

/**
 * Clean an unknown jsonb value into a valid, de-duped attribute list.
 * `keepEmpty` preserves empty-value entries — used for the ORDER layer where
 * an empty value is a tombstone (suppress a client-preset key for this order).
 */
export function normalizeFactoryExtras(
  raw: unknown,
  opts: { keepEmpty?: boolean } = {}
): FactoryExtras {
  if (!Array.isArray(raw)) return [];
  const out: FactoryExtras = [];
  const seen = new Set<string>();
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const key = String((a as any).key ?? "").trim();
    const value = String((a as any).value ?? "").trim();
    if (!key || seen.has(key)) continue;
    if (!value && !opts.keepEmpty) continue;
    seen.add(key);
    out.push({
      key,
      label: String((a as any).label ?? "").trim() || key,
      value,
    });
  }
  return out;
}

/** Parse the serialized extras posted by the builder (server actions). */
export function parseFactoryExtras(
  json: string | null | undefined,
  opts: { keepEmpty?: boolean } = {}
): FactoryExtras {
  if (!json) return [];
  try {
    return normalizeFactoryExtras(JSON.parse(json), opts);
  } catch {
    return [];
  }
}

export type FactoryExtraSource = "client" | "order";
export type ResolvedFactoryExtra = FactoryExtra & { source: FactoryExtraSource };

/**
 * Resolve the effective extras across the two layers, per key.
 * order > client. An order entry with an empty value is a tombstone: it
 * removes a key inherited from the client preset for this order.
 */
export function resolveFactoryExtras(
  client: FactoryExtras,
  order: FactoryExtras
): ResolvedFactoryExtra[] {
  const byKey = new Map<string, ResolvedFactoryExtra>();
  for (const a of client) {
    if (!a.value.trim()) continue;
    byKey.set(a.key, { ...a, source: "client" });
  }
  for (const a of order) {
    if (!a.value.trim()) {
      byKey.delete(a.key); // tombstone
      continue;
    }
    const prev = byKey.get(a.key);
    byKey.set(a.key, {
      key: a.key,
      label: a.label || prev?.label || a.key,
      value: a.value,
      source: "order",
    });
  }
  return [...byKey.values()];
}

/**
 * Compute the minimal ORDER layer (what to store on the line) given the
 * client base and the full working list shown in the editor. Only deviations
 * from the client preset are stored; removed client keys become tombstones.
 */
export function diffOrderExtras(
  client: FactoryExtras,
  working: FactoryExtras
): FactoryExtras {
  const clientByKey = new Map(client.map((e) => [e.key, e]));
  const out: FactoryExtras = [];
  const seen = new Set<string>();
  for (const ex of working) {
    if (!ex.value.trim()) continue;
    seen.add(ex.key);
    const c = clientByKey.get(ex.key);
    if (!c || c.value !== ex.value || c.label !== ex.label) {
      out.push({ key: ex.key, label: ex.label, value: ex.value });
    }
  }
  // Client keys dropped from the working list → tombstone for this order.
  for (const c of client) {
    if (!seen.has(c.key)) out.push({ key: c.key, label: c.label, value: "" });
  }
  return out;
}
