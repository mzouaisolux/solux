/**
 * Pure grouping of Hub families into the catalog hierarchy Line → Range →
 * Product (m162). No server imports — safe to use in client components and to
 * unit-test directly. Families with no range/line fall into an "Unclassified"
 * bucket that sorts last.
 */

import type { FamilySummary } from "./types";

export const UNCLASSIFIED = "Unclassified";

export type RangeGroup = { range: string; families: FamilySummary[] };
export type LineGroup = { line: string; ranges: RangeGroup[] };

const pos = (n: number | null | undefined) => (n == null ? 9999 : n);

/** Group families by Line then Range, preserving catalog ordering. */
export function groupFamiliesByLineRange(families: FamilySummary[]): LineGroup[] {
  const sorted = [...families].sort(
    (a, b) =>
      pos(a.linePosition) - pos(b.linePosition) ||
      pos(a.rangePosition) - pos(b.rangePosition) ||
      pos(a.position) - pos(b.position) ||
      a.name.localeCompare(b.name)
  );

  const lines: LineGroup[] = [];
  for (const f of sorted) {
    const lineName = f.line ?? UNCLASSIFIED;
    const rangeName = f.range ?? UNCLASSIFIED;
    let lg = lines.find((l) => l.line === lineName);
    if (!lg) {
      lg = { line: lineName, ranges: [] };
      lines.push(lg);
    }
    let rg = lg.ranges.find((r) => r.range === rangeName);
    if (!rg) {
      rg = { range: rangeName, families: [] };
      lg.ranges.push(rg);
    }
    rg.families.push(f);
  }

  // Unclassified line always last (pre-sort puts null positions last, but a
  // family with a line yet no line-position could still precede it — guard).
  lines.sort((a, b) => Number(a.line === UNCLASSIFIED) - Number(b.line === UNCLASSIFIED));
  return lines;
}
