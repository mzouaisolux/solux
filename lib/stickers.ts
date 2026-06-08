/**
 * Stickers & branding requirements — pure types + catalog.
 *
 * A production-handoff checklist of which stickers/labels a project
 * needs, by which METHOD (sticker vs laser printing), where they go,
 * and any instructions. Branding leads (Solux vs customer branding).
 * Client + server safe. Artwork files go through the Attachments panel;
 * this is the spec.
 */

export type StickerKind =
  | "branding"
  | "global_product"
  | "component"
  | "battery"
  | "panel"
  | "certification"
  | "other";

/** How the marking is applied. */
export type StickerMethod = "sticker" | "laser" | null;

/** Whose branding — only meaningful for the branding row. */
export type BrandingSource = "solux" | "customer" | null;

export const STICKER_METHODS: Array<{ value: "sticker" | "laser"; label: string }> = [
  { value: "sticker", label: "Sticker" },
  { value: "laser", label: "Laser printing" },
];

export const BRANDING_SOURCES: Array<{
  value: "solux" | "customer";
  label: string;
}> = [
  { value: "solux", label: "Solux branding" },
  { value: "customer", label: "Customer branding" },
];

// Branding first — that's where the team starts.
export const STICKER_CATALOG: Array<{ kind: StickerKind; label: string }> = [
  { kind: "branding", label: "Branding" },
  { kind: "global_product", label: "Global product sticker" },
  { kind: "component", label: "Component sticker" },
  { kind: "battery", label: "Battery sticker" },
  { kind: "panel", label: "Solar panel sticker" },
  { kind: "certification", label: "Certification label" },
];

export type StickerRequirement = {
  kind: StickerKind;
  label: string;
  required: boolean;
  /** Application method — sticker or laser printing. */
  method: StickerMethod;
  /** Branding origin — only used when kind === 'branding'. */
  branding_source?: BrandingSource;
  positioning: string | null;
  note: string | null;
  custom?: boolean;
};

export type StickerRequirements = {
  items: StickerRequirement[];
  notes: string | null;
};

function catalogRow(kind: StickerKind, label: string): StickerRequirement {
  return {
    kind,
    label,
    required: false,
    method: null,
    branding_source: kind === "branding" ? null : undefined,
    positioning: null,
    note: null,
  };
}

/** Fresh spec with the full catalog laid out (all unchecked). */
export function defaultStickerRequirements(): StickerRequirements {
  return {
    items: STICKER_CATALOG.map((s) => catalogRow(s.kind, s.label)),
    notes: null,
  };
}

const VALID_METHODS = new Set(["sticker", "laser"]);
const VALID_SOURCES = new Set(["solux", "customer"]);

function cleanMethod(v: unknown): StickerMethod {
  return typeof v === "string" && VALID_METHODS.has(v)
    ? (v as StickerMethod)
    : null;
}
function cleanSource(v: unknown): BrandingSource {
  return typeof v === "string" && VALID_SOURCES.has(v)
    ? (v as BrandingSource)
    : null;
}

/**
 * Normalize a stored (possibly partial / legacy / null) value into a
 * complete spec: catalog rows first (merging saved values by kind, in
 * catalog order — so legacy data missing the new branding row still
 * gets it), then custom rows, then notes.
 */
export function normalizeStickerRequirements(
  raw: unknown
): StickerRequirements {
  const base = defaultStickerRequirements();
  if (!raw || typeof raw !== "object") return base;
  const p = raw as Partial<StickerRequirements>;

  const savedByKind = new Map<string, StickerRequirement>();
  const customs: StickerRequirement[] = [];
  for (const it of (p.items ?? []) as StickerRequirement[]) {
    if (!it || typeof it !== "object") continue;
    if (it.custom) {
      customs.push({
        kind: "other",
        label: String(it.label ?? "Custom sticker"),
        required: !!it.required,
        method: cleanMethod(it.method),
        positioning: it.positioning ?? null,
        note: it.note ?? null,
        custom: true,
      });
    } else if (it.kind) {
      savedByKind.set(it.kind, it);
    }
  }

  const catalogItems = base.items.map((row) => {
    const saved = savedByKind.get(row.kind);
    if (!saved) return row;
    return {
      ...row,
      required: !!saved.required,
      method: cleanMethod(saved.method),
      branding_source:
        row.kind === "branding" ? cleanSource(saved.branding_source) : undefined,
      positioning: saved.positioning ?? null,
      note: saved.note ?? null,
    };
  });

  return {
    items: [...catalogItems, ...customs],
    notes: typeof p.notes === "string" ? p.notes : null,
  };
}

/** Count of required stickers — for a compact badge. */
export function requiredStickerCount(s: StickerRequirements): number {
  return s.items.filter((i) => i.required).length;
}
