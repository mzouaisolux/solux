// =====================================================================
// Document number allocation helpers (pure).
//
// A quotation/proforma number is "SLX-{client_code}-{YY}-{NNN}". The number
// carries a SINGLE-COLUMN, GLOBAL unique constraint (documents_number_key) —
// two documents can never share a number, whatever the client.
//
// next_client_document_number() (migration 006) mints the next sequence, but
// it runs as SECURITY INVOKER and counts existing documents under the caller's
// RLS scope (a sales rep only sees rows where created_by = auth.uid(), per
// migration 046). It therefore UNDERCOUNTS whenever the client's number space
// already holds rows the rep cannot see — created by another rep, or by another
// client that happens to share the same 3-letter code (dup codes persist until
// m145 is applied). It then returns an already-taken sequence and the insert
// trips the global unique constraint → a 500 on save.
//
// saveDocument treats the RPC value as a STARTING GUESS and, on the unique
// violation, probes upward with these helpers until the insert lands. The
// index is authoritative regardless of RLS, so probing always converges. These
// functions are pure so that probe/parse logic is unit-tested without a DB.
// The DB-side root-cause fix is migration 147 (SECURITY DEFINER + prefix-scoped
// counter); the app-side probe keeps saving correct with or without it applied.
// =====================================================================

export type ParsedDocumentNumber = { prefix: string; seq: number };

/**
 * Split "SLX-ABC-26-001" → { prefix: "SLX-ABC-26-", seq: 1 }.
 *
 * Returns null for anything that does not end in a plain sequence — notably a
 * revision ("SLX-ABC-26-001-V2"), whose number is derived separately and must
 * never be probed/renumbered.
 */
export function parseDocumentNumber(
  num: string | null | undefined
): ParsedDocumentNumber | null {
  const m = /^(.*-)(\d+)$/.exec(String(num ?? ""));
  if (!m) return null;
  return { prefix: m[1], seq: Number(m[2]) };
}

/** Re-assemble a number, zero-padding the sequence to at least 3 digits. */
export function formatDocumentNumber(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

/**
 * Highest sequence already used in `prefix`'s number space among the rows we
 * CAN see (RLS may hide others), or null when none match. Revision suffixes are
 * ignored (they don't consume a sequence). Used only as a fast jump hint — the
 * insert probe is what actually guarantees global uniqueness.
 */
export function highestVisibleSeq(
  prefix: string,
  numbers: ReadonlyArray<string | null | undefined>
): number | null {
  let max: number | null = null;
  for (const n of numbers) {
    const p = parseDocumentNumber(n);
    if (p && p.prefix === prefix && (max === null || p.seq > max)) max = p.seq;
  }
  return max;
}

/**
 * True when a Supabase/PostgREST error is the GLOBAL document-number unique
 * violation (as opposed to any other insert failure). Postgres includes the
 * constraint name in a 23505 message, so we match it precisely and never treat
 * an unrelated unique violation as a number collision.
 */
export function isDocumentNumberCollision(
  err: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  const msg = err?.message ?? "";
  return (
    /documents_number_key/i.test(msg) ||
    (err?.code === "23505" && /\bnumber\b/i.test(msg))
  );
}
