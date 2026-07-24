/**
 * Spec-version LABELS — the sales-facing YYMM qualifier (Section 17).
 *
 * DECISION (Section 16/17): the internal version string stays `v1.0` / `v1.1`
 * in `spec_versions.version` (no schema change), while every customer- and
 * sales-facing surface renders a YYMM label derived from `published_at`:
 *
 *     published 2026-04-08  →  "2604"   →  shown as "Spec 2604"
 *
 * YYMM sorts correctly as a string (MMYY would not) and reads as a date to the
 * team. When two versions publish in the SAME month, the older keeps the bare
 * YYMM and later ones get a `-r2`, `-r3` … suffix, so labels stay unique within
 * a family. If `published_at` is missing (shouldn't happen for a published
 * row), we fall back to the internal `version` string so nothing renders blank.
 *
 * Pure functions only — no DB, no framework — so the label rule is unit-tested
 * end-to-end (see tests/spec-version-pin.test.ts).
 */

/** A published spec version, in the minimal shape these helpers need. */
export type LabelableVersion = {
  id: string;
  version: string;
  published_at: string | null;
};

/**
 * The bare YYMM string for an ISO timestamp, or null if unparseable.
 * Uses UTC so the label is stable regardless of server timezone.
 */
export function yymm(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

/**
 * Build the id → sales-facing label map for ONE family's versions.
 *
 * Accepts the versions in any order (the read layer returns them newest-first).
 * Within each YYMM month the OLDEST published version gets the bare label and
 * each later one gets `-r2`, `-r3` … — deterministic and collision-free.
 * Versions with no parseable `published_at` fall back to their `version` string.
 */
export function buildVersionLabels(
  versions: LabelableVersion[]
): Map<string, string> {
  // Oldest → newest so the first in a month is the base label.
  const ordered = [...versions].sort((a, b) => {
    const ta = a.published_at ? Date.parse(a.published_at) : NaN;
    const tb = b.published_at ? Date.parse(b.published_at) : NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1; // undated last
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  });

  const seenPerMonth = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const v of ordered) {
    const base = yymm(v.published_at);
    if (!base) {
      labels.set(v.id, v.version); // undated → internal label
      continue;
    }
    const n = (seenPerMonth.get(base) ?? 0) + 1;
    seenPerMonth.set(base, n);
    labels.set(v.id, n === 1 ? base : `${base}-r${n}`);
  }
  return labels;
}

/**
 * The label for a single version id, given the family's label map. Falls back
 * to the internal version string, then to a short id, so it never renders blank.
 */
export function labelFor(
  versionId: string | null | undefined,
  labels: Map<string, string>,
  fallbackVersion?: string | null
): string {
  if (versionId && labels.has(versionId)) return labels.get(versionId)!;
  if (fallbackVersion) return fallbackVersion;
  return versionId ? versionId.slice(0, 8) : "—";
}

/**
 * The complete qualifier for any screen, PDF or email — a SKU is NEVER shown
 * without its spec label beside it (Section 17 display rule). "APF-100" alone
 * is ambiguous; "APF-100 — Spec 2604" is complete.
 */
export function qualifier(
  sku: string | null | undefined,
  label: string | null | undefined
): string {
  const s = (sku ?? "").trim();
  const l = (label ?? "").trim();
  if (s && l) return `${s} — Spec ${l}`;
  if (s) return s;
  if (l) return `Spec ${l}`;
  return "—";
}

/** A spec version tagged with the family it belongs to. */
export type CategorizedVersion = LabelableVersion & { category_id: string };

/**
 * The CURRENT (latest-published) spec version id per family — the value the pin
 * freezes to at send. Newest `published_at` wins; an undated row only wins a
 * category that has nothing else. Pure and deterministic, so freeze-at-send is
 * unit-testable without a DB.
 */
export function latestVersionIdByCategory(
  rows: CategorizedVersion[]
): Map<string, string> {
  const best = new Map<string, CategorizedVersion>();
  for (const r of rows) {
    if (!r.category_id || !r.id) continue;
    const cur = best.get(r.category_id);
    if (!cur || isNewer(r.published_at, cur.published_at)) best.set(r.category_id, r);
  }
  const out = new Map<string, string>();
  for (const [cat, v] of best) out.set(cat, v.id);
  return out;
}

/** True iff `a` is a strictly newer publish date than `b` (nulls are oldest). */
function isNewer(a: string | null, b: string | null): boolean {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta)) return false; // undated never beats anything
  if (Number.isNaN(tb)) return true; // dated beats undated
  return ta > tb;
}

/**
 * id → label map across SEVERAL families at once — for a quotation whose lines
 * span multiple ranges. Collision suffixes (`-r2`) stay scoped per family (they
 * are computed within each category), then merged into one map keyed by the
 * globally-unique version id.
 */
export function buildVersionLabelsForCategories(
  rows: CategorizedVersion[]
): Map<string, string> {
  const byCat = new Map<string, LabelableVersion[]>();
  for (const r of rows) {
    if (!r.category_id) continue;
    const arr = byCat.get(r.category_id);
    if (arr) arr.push(r);
    else byCat.set(r.category_id, [r]);
  }
  const out = new Map<string, string>();
  for (const versions of byCat.values()) {
    for (const [id, label] of buildVersionLabels(versions)) out.set(id, label);
  }
  return out;
}
