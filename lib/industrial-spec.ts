/**
 * Industrial production file (m159) — pure types + catalog + normalizer.
 *
 * The Task List is the complete industrial production file that follows a
 * project from quotation to manufacturing, logistics, installation and
 * after-sales (owner spec 2026-07-08). This module is the single source of
 * truth for its structured sections, stored as ONE jsonb blob
 * (`production_task_lists.industrial_spec`) — same pattern as the sticker
 * requirements (m061) and risk flags (m062):
 *
 *   • pole_accessories — every pole ships with accessories; anchor bolts,
 *     nut caps and nut-cap grease are INCLUDED by default, the TLM unchecks
 *     what a project doesn't need. Custom rows supported.
 *   • packaging — the packaging version is standardized: neutral (no logo),
 *     standard SOLUX, French-Branch exclusive, or customized client (which
 *     requires the customer logo/design files and auto-notifies Sales).
 *   • user_manual — SOLUX-branded / neutral (each with EN·FR·AR language
 *     picks) or a customized customer manual (requires artwork upload).
 *   • spare_parts — structured table (part / model / qty / notes) replacing
 *     free text, with optional per-part factory naming (different factories
 *     name identical parts differently — After-Sales needs the mapping).
 *
 * Client + server safe (no DB access). The app NEVER trusts the raw stored
 * shape — always render/save through normalizeIndustrialSpec().
 */

// ---------------------------------------------------------------------------
// Solar panel tilt angle (stored as its own column, not in the blob — it is a
// first-class production parameter reused by the SR, the AI Energy-Study
// assist, the pole-drawing checkpoint and future factory instructions).
// ---------------------------------------------------------------------------

/** Preset tilt angles offered everywhere (SR form + task list). Degrees. */
export const TILT_ANGLE_PRESETS = [0, 10, 15, 20, 30, 45] as const;

/** Parse a user/AI-provided tilt angle into a sane number of degrees. */
export function cleanTiltAngle(v: unknown): number | null {
  if (v == null || v === "") return null;
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else {
    // Strip units ("15°", "20 deg") but never coerce pure junk to 0.
    const stripped = String(v).replace(/[^0-9.\-]/g, "");
    if (stripped === "") return null;
    n = Number(stripped);
  }
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 90) return null; // physical range of a panel tilt
  return n;
}

/** Display helper — "15°" / "—". */
export function formatTiltAngle(v: number | null | undefined): string {
  return v == null ? "—" : `${v}°`;
}

// ---------------------------------------------------------------------------
// Pole accessories
// ---------------------------------------------------------------------------

export type PoleAccessoryItem = {
  key: string;
  label: string;
  included: boolean;
  note: string | null;
  custom?: boolean;
};

/** Default-included accessories every pole usually ships with. */
export const POLE_ACCESSORY_CATALOG: Array<{ key: string; label: string }> = [
  { key: "anchor_bolts", label: "Anchor bolts" },
  { key: "nut_caps", label: "Nut caps" },
  { key: "nut_cap_grease", label: "Oil / grease for nut caps" },
];

export type PoleAccessoriesSpec = {
  items: PoleAccessoryItem[];
  notes: string | null;
};

// ---------------------------------------------------------------------------
// Packaging version
// ---------------------------------------------------------------------------

export type PackagingVersion =
  | "neutral"
  | "solux_standard"
  | "french_branch"
  | "custom_client";

export const PACKAGING_VERSIONS: Array<{
  value: PackagingVersion;
  label: string;
  hint: string;
}> = [
  { value: "neutral", label: "Neutral version", hint: "No logo" },
  { value: "solux_standard", label: "Standard SOLUX version", hint: "SOLUX branding" },
  {
    value: "french_branch",
    label: "French Branch Exclusive version",
    hint: "Reserved for the French branch",
  },
  {
    value: "custom_client",
    label: "Customized Client version",
    hint: "Customer logo + design files required — Sales is notified automatically",
  },
];

export type PackagingSpec = {
  version: PackagingVersion | null;
  notes: string | null;
};

// ---------------------------------------------------------------------------
// User manual
// ---------------------------------------------------------------------------

export type UserManualBrand = "solux" | "neutral" | "custom";

export const USER_MANUAL_BRANDS: Array<{
  value: UserManualBrand;
  label: string;
  hint: string;
}> = [
  { value: "solux", label: "SOLUX branded", hint: "Pick the languages to include" },
  { value: "neutral", label: "Neutral (no brand)", hint: "Pick the languages to include" },
  {
    value: "custom",
    label: "Customized Customer Manual",
    hint: "Upload the customer's manual artwork, or their logo + design assets",
  },
];

export type ManualLanguage = "en" | "fr" | "ar";

export const MANUAL_LANGUAGES: Array<{ value: ManualLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "ar", label: "Arabic" },
];

export type UserManualSpec = {
  brand: UserManualBrand | null;
  languages: ManualLanguage[];
  notes: string | null;
};

// ---------------------------------------------------------------------------
// Spare parts (structured table — never free text)
// ---------------------------------------------------------------------------

export type SparePartRow = {
  /** Part designation, e.g. "Battery", "Controller", "LED Module", "Screws". */
  part: string;
  /** Model / reference — free text or picked from the product catalog. */
  model: string | null;
  /** Optional catalog anchor when the model was picked from the catalog. */
  product_id: string | null;
  quantity: number;
  notes: string | null;
  /** Internal naming / factory notes — factories name identical parts differently. */
  factory_name: string | null;
  customer_name: string | null;
  factory_notes: string | null;
};

// ---------------------------------------------------------------------------
// The blob
// ---------------------------------------------------------------------------

export type IndustrialSpec = {
  pole_accessories: PoleAccessoriesSpec;
  packaging: PackagingSpec;
  user_manual: UserManualSpec;
  spare_parts: SparePartRow[];
};

/** Fresh spec — catalog accessories INCLUDED by default (owner spec). */
export function defaultIndustrialSpec(): IndustrialSpec {
  return {
    pole_accessories: {
      items: POLE_ACCESSORY_CATALOG.map((a) => ({
        key: a.key,
        label: a.label,
        included: true,
        note: null,
      })),
      notes: null,
    },
    packaging: { version: null, notes: null },
    user_manual: { brand: null, languages: [], notes: null },
    spare_parts: [],
  };
}

const VALID_PACKAGING = new Set(PACKAGING_VERSIONS.map((p) => p.value));
const VALID_BRANDS = new Set(USER_MANUAL_BRANDS.map((b) => b.value));
const VALID_LANGS = new Set(MANUAL_LANGUAGES.map((l) => l.value));

function cleanStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function cleanQty(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/**
 * Normalize a stored (possibly partial / legacy / null) value into a complete
 * spec: catalog accessory rows first (merging saved values by key — a legacy
 * blob missing a new catalog row still gets it, included by default), then
 * custom rows; enum fields fall back to null when unknown.
 */
export function normalizeIndustrialSpec(raw: unknown): IndustrialSpec {
  const base = defaultIndustrialSpec();
  if (!raw || typeof raw !== "object") return base;
  const p = raw as Partial<IndustrialSpec>;

  // --- pole accessories --------------------------------------------------
  const savedByKey = new Map<string, PoleAccessoryItem>();
  const customs: PoleAccessoryItem[] = [];
  const rawAcc = (p.pole_accessories as PoleAccessoriesSpec | undefined)?.items;
  for (const it of (Array.isArray(rawAcc) ? rawAcc : []) as PoleAccessoryItem[]) {
    if (!it || typeof it !== "object") continue;
    if (it.custom) {
      customs.push({
        key: "custom",
        // `||` (not ??): an empty label saved mid-typing falls back too.
        label: String(it.label || "Custom accessory"),
        included: !!it.included,
        note: cleanStr(it.note),
        custom: true,
      });
    } else if (it.key) {
      savedByKey.set(String(it.key), it);
    }
  }
  const accessoryItems = base.pole_accessories.items.map((row) => {
    const saved = savedByKey.get(row.key);
    if (!saved) return row;
    return {
      ...row,
      // Explicitly saved value wins — default is "included" only for rows the
      // TLM never touched.
      included: saved.included !== false,
      note: cleanStr(saved.note),
    };
  });

  // --- packaging -----------------------------------------------------------
  const rawPack = (p.packaging ?? {}) as Partial<PackagingSpec>;
  const packaging: PackagingSpec = {
    version:
      typeof rawPack.version === "string" && VALID_PACKAGING.has(rawPack.version as PackagingVersion)
        ? (rawPack.version as PackagingVersion)
        : null,
    notes: cleanStr(rawPack.notes),
  };

  // --- user manual -----------------------------------------------------------
  const rawManual = (p.user_manual ?? {}) as Partial<UserManualSpec>;
  const languages = (Array.isArray(rawManual.languages) ? rawManual.languages : [])
    .filter((l): l is ManualLanguage => typeof l === "string" && VALID_LANGS.has(l as ManualLanguage));
  const user_manual: UserManualSpec = {
    brand:
      typeof rawManual.brand === "string" && VALID_BRANDS.has(rawManual.brand as UserManualBrand)
        ? (rawManual.brand as UserManualBrand)
        : null,
    languages: Array.from(new Set(languages)),
    notes: cleanStr(rawManual.notes),
  };

  // --- spare parts -----------------------------------------------------------
  const spare_parts = (Array.isArray(p.spare_parts) ? p.spare_parts : [])
    .filter((r): r is SparePartRow => !!r && typeof r === "object")
    .map((r) => ({
      part: String(r.part ?? "").trim(),
      model: cleanStr(r.model),
      product_id: cleanStr(r.product_id),
      quantity: cleanQty(r.quantity),
      notes: cleanStr(r.notes),
      factory_name: cleanStr(r.factory_name),
      customer_name: cleanStr(r.customer_name),
      factory_notes: cleanStr(r.factory_notes),
    }))
    // A row with neither a part name nor a model is noise — drop it.
    .filter((r) => r.part !== "" || r.model != null);

  return {
    pole_accessories: {
      items: [...accessoryItems, ...customs],
      notes: cleanStr((p.pole_accessories as PoleAccessoriesSpec | undefined)?.notes),
    },
    packaging,
    user_manual,
    spare_parts,
  };
}

/** Does the current packaging choice require customer branding assets? */
export function packagingRequiresBranding(spec: IndustrialSpec): boolean {
  return spec.packaging.version === "custom_client";
}

/** Does the current manual choice require customer artwork? */
export function manualRequiresArtwork(spec: IndustrialSpec): boolean {
  return spec.user_manual.brand === "custom";
}
