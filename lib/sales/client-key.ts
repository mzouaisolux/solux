/**
 * Sales & Analytics — canonical client key (module spec §4).
 *
 * Turns a raw, human-typed client name (Chinese country prefix, legal suffixes,
 * punctuation, casing noise) into a STABLE `normalized_key` used to:
 *   - deduplicate on import (identical key → same client),
 *   - back the UNIQUE constraint on `sales_client_aliases.normalized_key`,
 *   - auto-attach a new order to a known client when its name matches an alias.
 *
 * Pure + dependency-free (erasable under `--experimental-strip-types`), so the
 * import script, the server actions and the unit tests all share ONE recipe.
 *
 * Recipe (the spec's, in order):
 *   1. lowercase
 *   2. strip a leading Chinese country prefix  [汉字]+ [digits]? [-]?
 *   3. "&" → " and "
 *   4. drop diacritics + punctuation (also drops any remaining CJK)
 *   5. drop legal-form / filler words (ltd, llc, sarl, …, international, de, the)
 *   6. remove spaces
 */

/** Legal-form / filler words dropped from the key (spec §4). */
export const LEGAL_WORDS: ReadonlySet<string> = new Set([
  "ltd", "limited", "llc", "inc", "co", "sa", "sas", "sarl", "pty", "gmbh",
  "srl", "bv", "pvt", "corp", "corporation", "company", "group", "groupe",
  "international", "de", "the",
]);

// A leading country prefix = a run of CJK characters, optional digits, and an
// optional dash/space separator: "美国5-", "法国-", "阿曼2", "越南10- ".
const CHINESE_PREFIX = /^[㐀-䶿一-鿿]+\s*\d*\s*-?\s*/;

/** Strip only the leading Chinese country prefix (kept separate for testing). */
export function stripCountryPrefix(input: string): string {
  return input.replace(CHINESE_PREFIX, "");
}

/**
 * The spec's `normalized_key`. Returns "" when nothing meaningful remains
 * (e.g. an all-Chinese sample label) — callers MUST skip empty keys so they
 * never collide on the UNIQUE(normalized_key) index.
 */
export function normalizedClientKey(raw: string | null | undefined): string {
  let s = String(raw ?? "").trim().toLowerCase();
  s = stripCountryPrefix(s);                                  // 2
  s = s.replace(/&/g, " and ");                               // 3
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");     // drop accents
  s = s.replace(/[^a-z0-9]+/g, " ").trim();                   // 4 (also drops leftover CJK)
  const kept = s.split(/\s+/).filter((t) => t.length > 0 && !LEGAL_WORDS.has(t)); // 5
  return kept.join("");                                       // 6
}
