// =====================================================================
// Client code (3 letters) — pure, dependency-free helpers.
//
// The code is stamped into every document number (SLX-<CODE>-YY-NNN) and
// MUST be unique (partial unique index `clients_client_code_unique_idx`,
// m006). DB constraint: `^[A-Z]{3}$` — three UPPERCASE letters, NO digits.
//
// Owner req (2026-07-03): a rep should never have to think about the code.
// We derive it from the company name — mirroring the m130 backfill
// heuristic (strip non-letters, first three, upper-case) so live-generated
// codes match historic ones — and, on collision, walk a deterministic,
// name-anchored, ultimately-exhaustive candidate stream so a free code is
// always reachable.
//
// These helpers only decide WHICH code to try and in WHICH order. The real
// atomicity guarantee against concurrent creators is the DB unique index +
// a server-side insert-retry on 23505 (see createClientRecord) — never a
// read-then-write check, which races.
// =====================================================================

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Combining diacritical marks (U+0300–U+036F): dropped after NFD so accented
// letters fold to their ASCII base (É → E) instead of being stripped whole.
const DIACRITICS = /[̀-ͯ]/g;

export const CLIENT_CODE_RE = /^[A-Z]{3}$/;

/** True when `code` is a storable client code (exactly 3 upper-case letters). */
export function isValidClientCode(code: string | null | undefined): code is string {
  return !!code && CLIENT_CODE_RE.test(code);
}

/** Fold accents, upper-case, keep A–Z only. "Éléctrique Bénin" → "ELECTRIQUEBENIN". */
function lettersOf(name: string): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

/** Accent-folded upper-case words (split on any run of non-letters). */
function wordsOf(name: string): string[] {
  return (name ?? "")
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
}

/**
 * Normalize raw user input into a 0–3 letter upper-case stem (never throws).
 * Accepts messy input ("s.o.l ", "sölu") and returns the storable prefix.
 */
export function normalizeClientCode(raw: string | null | undefined): string {
  return lettersOf(raw ?? "").slice(0, 3);
}

/**
 * First-choice code from a company name: first three letters, upper-cased
 * (padded with the leading letter if the name has 1–2 letters). Mirrors the
 * m130 backfill so live codes match historic ones. "" when the name has no
 * letters at all.
 *   "Solux Africa" → "SOL" · "Benin Energy" → "BEN" · "Lighting Group" → "LIG"
 */
export function deriveClientCodeBase(name: string): string {
  const letters = lettersOf(name);
  if (!letters) return "";
  return letters.slice(0, 3).padEnd(3, letters[0]);
}

/**
 * Ordered, de-duplicated candidate stream for a company name:
 *   1. the derived base (first 3 letters);
 *   2. per-word initials (>=3 words) then word1[0..1]+word2[0] (>=2 words);
 *   3. name-anchored pairs (base letter + adjacent name letters);
 *   4. base's first two letters + A..Z  — the letter analog of SO1, SO2...;
 *   5. EXHAUSTIVE AAA..ZZZ — guarantees a free code while any of the 17 576
 *      codes remains, so the stream NEVER runs dry.
 * Every yielded value matches `^[A-Z]{3}$`. Lazy: pulling N values never
 * materializes the whole 17 576-code tail.
 */
export function* clientCodeCandidates(name: string): Generator<string> {
  const seen = new Set<string>();
  const emit = (t: string): string | null => {
    if (CLIENT_CODE_RE.test(t) && !seen.has(t)) {
      seen.add(t);
      return t;
    }
    return null;
  };

  const letters = lettersOf(name);
  const words = wordsOf(name);
  const anchored: string[] = [];
  if (letters) {
    const base = letters.slice(0, 3).padEnd(3, letters[0]);
    anchored.push(base);
    if (words.length >= 3) anchored.push(words[0][0] + words[1][0] + words[2][0]);
    if (words.length >= 2) anchored.push(words[0].slice(0, 2) + words[1][0]);
    for (let i = 1; i < letters.length - 1; i++)
      anchored.push(letters[0] + letters[i] + letters[i + 1]);
    const two = letters.slice(0, 2).padEnd(2, letters[0]);
    for (const ch of ALPHA) anchored.push(two + ch);
    const first = letters[0];
    const third = letters[1] ?? first;
    for (const ch of ALPHA) anchored.push(first + ch + third);
  }
  for (const t of anchored) {
    const v = emit(t);
    if (v) yield v;
  }
  // Exhaustive tail — surfaces any remaining free code.
  for (const a of ALPHA)
    for (const b of ALPHA)
      for (const c of ALPHA) {
        const v = emit(a + b + c);
        if (v) yield v;
      }
}

/**
 * First code not present in `taken`, following {@link clientCodeCandidates}.
 * `taken` is matched case-insensitively. Returns "" only in the (practically
 * impossible) event that all 17 576 codes are taken.
 */
export function suggestClientCode(name: string, taken: Iterable<string>): string {
  const takenSet = new Set(
    [...taken].map((c) => (c ?? "").toUpperCase()).filter(Boolean)
  );
  for (const cand of clientCodeCandidates(name)) {
    if (!takenSet.has(cand)) return cand;
  }
  return "";
}
