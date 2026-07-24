/**
 * Product naming convention — single source of truth.
 *
 * A product's human `name` is composed as FAMILY + VARIANT, where the family is
 * the product's category name (products.category / product_categories.name) and
 * the variant is the distinguishing token within that family (e.g. "B-80",
 * "120"). The SKU/code (products.sku) stays a separate machine string.
 *
 *   composeProductName("Vandal", "B-80")         -> "Vandal B-80"
 *   composeProductName("AOS Performance", "120") -> "AOS Performance 120"
 *   composeProductName("Kansa", "")              -> "Kansa"   (single-variant family)
 *
 * Both the Admin product form and the bulk import call this so the two creation
 * paths can never drift again (which is how "VDL B-80" — a code — ended up as a
 * product's name while "AOS PERFORMANCE 120" got a real one).
 *
 * Pure functions only — no I/O, unit-tested in tests/product-name.test.ts.
 */

/** Collapse runs of whitespace to a single space and trim the ends. */
function tidy(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Compose a product name from its family (category) and variant token.
 * Empty / missing parts are dropped, so a single-variant family (variant "")
 * yields just the family name with no trailing separator.
 */
export function composeProductName(
  family: string | null | undefined,
  variant?: string | null
): string {
  return [tidy(family), tidy(variant)].filter(Boolean).join(" ");
}

/**
 * True when a product's name is really just its code — the tell-tale of a
 * product that was named with its SKU instead of a human family+variant name.
 * Case-insensitive, whitespace-insensitive; false when either side is blank.
 * Used by the catalogue audit to flag rename candidates.
 */
export function looksLikeCodeName(
  name: string | null | undefined,
  sku: string | null | undefined
): boolean {
  const n = tidy(name).toLowerCase();
  const s = tidy(sku).toLowerCase();
  return n.length > 0 && s.length > 0 && n === s;
}

/**
 * Best-effort recovery of the variant token from an existing name, by stripping
 * a leading family prefix (case-insensitive). Returns "" when the name is just
 * the family. Used only to PROPOSE a rename in the audit — never authoritative.
 *
 *   inferVariant("AOS Performance 120", "AOS Performance") -> "120"
 *   inferVariant("Kansa", "Kansa")                         -> ""
 *   inferVariant("VDL B-80", "Vandal")                     -> "VDL B-80"  (no prefix match)
 */
export function inferVariant(
  name: string | null | undefined,
  family: string | null | undefined
): string {
  const n = tidy(name);
  const f = tidy(family);
  if (!f) return n;
  if (n.toLowerCase() === f.toLowerCase()) return "";
  const prefix = f.toLowerCase() + " ";
  if (n.toLowerCase().startsWith(prefix)) return n.slice(prefix.length).trim();
  return n;
}
