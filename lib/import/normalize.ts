/**
 * Historical Invoice Import — PURE string normalization + similarity.
 *
 * Used by name-match (customer verification) and product-match. Kept
 * dependency-free and unit-tested. No I/O.
 */

/** Strip diacritics: "Éclairage" -> "Eclairage". */
export function stripAccents(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Lowercase, de-accent, collapse punctuation to spaces, squeeze whitespace. */
export function normalizeBasic(s: string): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** A stable key for a product/line name (used as historical_product_map key). */
export function productNameKey(s: string): string {
  return normalizeBasic(s);
}

/** Legal-entity suffixes to drop when comparing company names. */
const LEGAL_SUFFIXES = new Set([
  "sas", "sasu", "sarl", "sarlu", "sa", "eurl", "sci", "snc",
  "llc", "ltd", "ltda", "limited", "inc", "incorporated",
  "co", "company", "corp", "corporation", "gmbh", "ag", "kg", "ug",
  "bv", "nv", "srl", "spa", "plc", "pty", "lda", "oy", "ab", "as",
  "sl", "sagl", "cc",
]);

/** Generic industry words that don't distinguish a company ("Arlux Lighting"
 *  and "Arlux" are the same customer). Dropped for the CORE token set. */
const GENERIC_WORDS = new Set([
  "lighting", "light", "lights", "electric", "electrical", "electronics",
  "electronic", "eclairage", "energy", "energie", "solar", "solaire",
  "industries", "industrie", "industrial", "group", "groupe", "holding",
  "trading", "trade", "international", "intl", "global", "solutions",
  "systems", "system", "technologies", "technology", "tech", "services",
  "service", "import", "export", "distribution",
]);

/** Core tokens of a company name: normalized, minus legal suffixes + generic
 *  industry words. "ARLUX SAS" -> ["arlux"]; "Arlux Lighting" -> ["arlux"]. */
export function companyCoreTokens(name: string): string[] {
  return normalizeBasic(name)
    .split(" ")
    .filter((t) => t.length > 0 && !LEGAL_SUFFIXES.has(t) && !GENERIC_WORDS.has(t));
}

/** Levenshtein edit distance (iterative, O(n·m) time, O(min) space). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // ensure `a` is the shorter for the O(min) row
  if (a.length > b.length) {
    const t = a;
    a = b;
    b = t;
  }
  const prev = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;
  for (let j = 1; j <= b.length; j++) {
    let prevDiag = prev[0];
    prev[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = prev[i];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[i] = Math.min(
        prev[i] + 1, // deletion
        prev[i - 1] + 1, // insertion
        prevDiag + cost // substitution
      );
      prevDiag = tmp;
    }
  }
  return prev[a.length];
}

/** Similarity ratio in [0,1] from edit distance. 1 = identical. */
export function similarityRatio(a: string, b: string): number {
  const na = normalizeBasic(a).replace(/\s+/g, "");
  const nb = normalizeBasic(b).replace(/\s+/g, "");
  if (na === "" && nb === "") return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

/** Dice coefficient over two token sets (order-independent overlap). */
export function tokenSetDice(aTokens: string[], bTokens: string[]): number {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}
