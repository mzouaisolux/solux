// =====================================================================
// lib/packing-core/pole.ts — lamp-pole helpers.
// Phase 1: classification + the "long pole forces 40HQ" rule. Wooden-case
// geometry (pcs/level × levels) is Phase 2 (packing_pole_profile) — here we
// only need to know a pole exists and whether it forces a 40HQ.
// =====================================================================
import type { PackageOut, PackingConfig } from "./types.ts";
import { longestAxis } from "./cbm.ts";

/** The longest pole length (mm) among pole packages, or null if none. */
export function longestPoleMm(packages: PackageOut[]): number | null {
  const lengths = packages
    .filter((p) => p.is_pole)
    .map((p) => longestAxis(p.dimensions_mm))
    .filter((x): x is number => x != null);
  return lengths.length ? Math.max(...lengths) : null;
}

/** True when any pole exceeds the config threshold (Word §II: >5.5m → 40HQ). */
export function polesForce40HQ(packages: PackageOut[], config: PackingConfig): boolean {
  const longest = longestPoleMm(packages);
  return longest != null && longest > config.pole_forces_40hq_length_mm;
}
