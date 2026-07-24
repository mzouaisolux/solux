/**
 * Guards for the inbound datasheet-upload route (Endpoint B, POST /api/datasheets).
 *
 * Pure logic only — no DB, no framework, no `@/` alias — so every rule is
 * unit-tested end-to-end under the node type-stripping test runner
 * (see tests/datasheet-guards.test.ts) and reused by the route unchanged.
 *
 * These close the Workstream-7 security findings on Endpoint B, which runs with
 * the service-role client (RLS bypassed) — so all safety lives in the route:
 *
 *   • isSafeVersion  — HIGH: `version` is injected into the storage key
 *     `spec-sheets/{productId}/{version}/r{n}.pdf` with upsert:true. Without a
 *     check a valid-key caller could send `version=../../…` and overwrite
 *     arbitrary objects in the `documents` bucket. Only a dotted-numeric
 *     (optional leading `v`) is allowed — no slashes, dots-only, or traversal.
 *
 *   • escapeLike     — MEDIUM: `range`/`code` were fed to ilike; a value of `%`
 *     matches the FIRST row, so an upload could land on the wrong family/model.
 *     The SKU lookup switches to `.eq` (exact); the name fallback escapes LIKE
 *     metacharacters so any `% _ \` match literally.
 *
 *   • isPdfBytes     — MEDIUM: only file size was validated. Require the real
 *     `%PDF-` magic-byte header so a renamed non-PDF can't be filed as a sheet.
 *
 *   • rateOk         — MED–LOW: no rate limiting. A leaked key (full read+write,
 *     no scopes/expiry) could spam uploads. Best-effort per-key sliding window;
 *     in-memory, so it resets on a serverless cold start — a guard, not a wall.
 */

/** The `%PDF-` magic header, as bytes. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const; // "%PDF-"

/**
 * A version string is safe to place in a storage path iff it is a dotted
 * numeric with an optional leading `v` — e.g. `v1.0`, `1`, `2.3.4`. Rejects
 * anything with a slash, backslash, `..`, whitespace, or other characters, so
 * it can never traverse out of `spec-sheets/{productId}/{version}/`.
 */
export function isSafeVersion(v: string): boolean {
  return /^v?\d+(\.\d+)*$/.test(v);
}

/**
 * Escape Postgres LIKE/ILIKE metacharacters (`\ % _`) so a user-supplied value
 * matches literally instead of acting as a wildcard.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** True iff the bytes begin with the `%PDF-` magic header. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Best-effort per-key sliding-window rate guard. In-memory (module state), so
 * it only holds within a warm serverless instance — enough to blunt a runaway
 * loop or a leaked-key spam burst, not a hard quota. Returns true if the call
 * is allowed and records the hit; false if the key is over `limit` in `windowMs`.
 *
 * `now` is injectable so the window logic is deterministic under test.
 */
const HITS = new Map<string, number[]>();

export function rateOk(
  key: string,
  now: number = Date.now(),
  limit = 30,
  windowMs = 60_000,
): boolean {
  const recent = (HITS.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    HITS.set(key, recent);
    return false;
  }
  recent.push(now);
  HITS.set(key, recent);
  return true;
}

/** Test-only: clear the rate-guard state so cases don't bleed into each other. */
export function __resetRateGuard(): void {
  HITS.clear();
}
