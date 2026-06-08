/**
 * Known risks / warnings — pure types + catalog.
 *
 * A lightweight flag set on the task list so factory/ops instantly see
 * what makes a project risky. Client + server safe. No workflow, no
 * approval — just fast visual awareness.
 */

export type RiskKey =
  | "non_standard_panel"
  | "urgent_lead_time"
  | "special_packaging"
  | "custom_sticker"
  | "new_optic"
  | "mechanical_sensitive"
  | "other";

export const RISK_CATALOG: Array<{ key: RiskKey; label: string }> = [
  { key: "non_standard_panel", label: "Non-standard panel dimensions" },
  { key: "mechanical_sensitive", label: "Mechanical dimension sensitive" },
  { key: "new_optic", label: "New optic — not previously validated" },
  { key: "urgent_lead_time", label: "Urgent lead time" },
  { key: "special_packaging", label: "Special packaging" },
  { key: "custom_sticker", label: "Custom sticker requirement" },
];

export type RiskFlag = {
  key: RiskKey;
  label: string;
  active: boolean;
  note: string | null;
  custom?: boolean;
};

export type RiskFlags = {
  items: RiskFlag[];
  notes: string | null;
};

function catalogRow(key: RiskKey, label: string): RiskFlag {
  return { key, label, active: false, note: null };
}

export function defaultRiskFlags(): RiskFlags {
  return {
    items: RISK_CATALOG.map((r) => catalogRow(r.key, r.label)),
    notes: null,
  };
}

/**
 * Normalize a stored (possibly partial / null) value into a complete
 * set: catalog rows (merged by key, in catalog order so new catalog
 * entries appear) + custom rows + notes.
 */
export function normalizeRiskFlags(raw: unknown): RiskFlags {
  const base = defaultRiskFlags();
  if (!raw || typeof raw !== "object") return base;
  const p = raw as Partial<RiskFlags>;

  const savedByKey = new Map<string, RiskFlag>();
  const customs: RiskFlag[] = [];
  for (const it of (p.items ?? []) as RiskFlag[]) {
    if (!it || typeof it !== "object") continue;
    if (it.custom) {
      customs.push({
        key: "other",
        label: String(it.label ?? "Custom risk"),
        active: !!it.active,
        note: it.note ?? null,
        custom: true,
      });
    } else if (it.key) {
      savedByKey.set(it.key, it);
    }
  }

  const catalogItems = base.items.map((row) => {
    const saved = savedByKey.get(row.key);
    return saved
      ? { ...row, active: !!saved.active, note: saved.note ?? null }
      : row;
  });

  return {
    items: [...catalogItems, ...customs],
    notes: typeof p.notes === "string" ? p.notes : null,
  };
}

/** The active flags only — for the loud summary banner / a list badge. */
export function activeRisks(r: RiskFlags): RiskFlag[] {
  return r.items.filter((i) => i.active);
}
