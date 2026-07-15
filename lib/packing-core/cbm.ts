// =====================================================================
// lib/packing-core/cbm.ts — volume + volumetric-weight primitives.
// Pure functions, mm in, CBM/kg out. No data missing → returns null
// (never a wrong 0, per §24 "do not calculate CBM when dims are missing").
// =====================================================================
import type { Dimensions } from "./types.ts";

/** Round to `dp` decimals without float dust (e.g. r(0.1+0.2,2)=0.3). */
export function r(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** True only when all three axes are present AND > 0. */
export function hasAllDims(d: Dimensions): boolean {
  return (
    d.l_mm != null && d.l_mm > 0 &&
    d.w_mm != null && d.w_mm > 0 &&
    d.h_mm != null && d.h_mm > 0
  );
}

/**
 * CBM = L × W × H ÷ 1,000,000,000 (dims in mm). Returns null when any
 * required dimension is missing — the caller must surface that, not ship a 0.
 */
export function cbm(d: Dimensions): number | null {
  if (!hasAllDims(d)) return null;
  return r((d.l_mm! * d.w_mm! * d.h_mm!) / 1_000_000_000, 6);
}

/** Volumetric (dimensional) weight = CBM × factor. factor is configurable. */
export function volumetricWeight(cbmValue: number | null, factor: number): number | null {
  if (cbmValue == null) return null;
  return r(cbmValue * factor, 3);
}

/** Longest single axis across a set of dimensions (mm). null if none known. */
export function longestAxis(d: Dimensions): number | null {
  const axes = [d.l_mm, d.w_mm, d.h_mm].filter((x): x is number => x != null && x > 0);
  return axes.length ? Math.max(...axes) : null;
}

/**
 * Can a box pass through a rectangular door opening in SOME orientation?
 * A box slides in lengthwise, so its two SMALLEST dimensions must fit the
 * opening. Returns true when dims/door are unknown (can't disprove → no false
 * alarm). Only returns false when we positively know it won't fit.
 */
export function fitsThroughDoor(d: Dimensions, doorW: number | null | undefined, doorH: number | null | undefined): boolean {
  if (doorW == null || doorH == null) return true; // door not configured → no check
  const dims = [d.l_mm, d.w_mm, d.h_mm].filter((x): x is number => x != null && x > 0);
  if (dims.length < 3) return true; // incomplete dims → can't disprove
  const [a, b] = dims.sort((x, y) => x - y); // two smallest
  const [o1, o2] = [doorW, doorH].sort((x, y) => x - y);
  return a <= o1 && b <= o2;
}
