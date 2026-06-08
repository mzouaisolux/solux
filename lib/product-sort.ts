/**
 * Natural product ordering — shared, pure, zero-dependency.
 *
 * Finance hands us Excel cost files ordered by business logic: smallest model
 * to largest, with the standard version just before its IoT variant, e.g.
 *
 *   AOSPRO+20, AOSPRO+20 IoT version, AOSPRO+30, AOSPRO+30 IoT version, …,
 *   AOSPRO+100, AOSPRO+100 IoT version, AOSPRO+120, AOSPRO+120 IoT version
 *
 * Plain alphabetical (ASCII) order is WRONG for this: it sorts "AOSPRO+100"
 * before "AOSPRO+20" because "1" < "2" character-by-character. So we split each
 * name into alternating text / number tokens and compare number tokens
 * NUMERICALLY. The three business rules the user asked for all fall out of that:
 *
 *   1. family/name first  → the leading text token ("AOSPRO+") sorts first.
 *   2. numeric model asc.  → the number token (20, 30, … 100, 120) sorts numeric.
 *   3. standard before IoT → "AOSPRO+20" is a prefix of "AOSPRO+20 IoT version",
 *                            so the shorter name sorts first.
 *
 * This is a DISPLAY/ORDER helper only — it never mutates data and needs no
 * `sort_order` column. If a stable DB ordering is ever added, prefer that and
 * use this purely as the tie-break.
 */

export type SortableProduct = {
  name?: string | null;
  sku?: string | null;
  id?: string | null;
};

/** Split "AOSPRO+100 IoT version" → ["aospro+", 100, " iot version"]. */
function tokenize(value: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  const re = /(\d+(?:\.\d+)?)|(\D+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (m[1] !== undefined) tokens.push(Number(m[1]));
    else tokens.push(m[2].toLowerCase());
  }
  return tokens;
}

/** Natural comparison of two raw strings (numbers compared numerically). */
export function compareNatural(a: string, b: string): number {
  if (a === b) return 0;
  const ta = tokenize(a);
  const tb = tokenize(b);
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const x = ta[i];
    const y = tb[i];
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
    } else if (typeof x === "number") {
      return -1; // a number sorts before text at the same position
    } else if (typeof y === "number") {
      return 1;
    } else {
      const c = x.localeCompare(y);
      if (c !== 0) return c;
    }
  }
  // Every shared token is equal → the shorter name comes first, which puts the
  // standard model ahead of its "… IoT version" / longer variant.
  return ta.length - tb.length;
}

/**
 * Comparator for `Array.prototype.sort` over product-like objects. Orders by
 * name naturally, then SKU (also natural), then id as a stable final tie-break.
 */
export function naturalProductSort(a: SortableProduct, b: SortableProduct): number {
  const byName = compareNatural((a?.name ?? "").trim(), (b?.name ?? "").trim());
  if (byName !== 0) return byName;
  const bySku = compareNatural((a?.sku ?? "").trim(), (b?.sku ?? "").trim());
  if (bySku !== 0) return bySku;
  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

/** Non-mutating convenience: returns a new, naturally-ordered array. */
export function sortProductsByName<T extends SortableProduct>(products: readonly T[]): T[] {
  return [...products].sort(naturalProductSort);
}
