/**
 * TERMINOLOGY — server-side loader (m177).
 *
 * Reads the `terminology` table and merges the VALIDATED rows over the
 * built-in catalog (lib/terminology.ts). Everything that renders factory
 * vocabulary — the dossier PDF, the exports, the task list — goes through
 * `getTermDict()` so there is exactly one resolution path.
 *
 * Defensive by design: a pre-m177 database has no table, the select 42P01s,
 * and we fall back to the built-in catalog. The app therefore behaves
 * IDENTICALLY before and after the migration — applying m177 only makes the
 * vocabulary editable, it never changes what a document says.
 *
 * `cache()` scopes memoization to the request, so one dossier render hits the
 * table once no matter how many terms it resolves.
 */

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  buildTermDict,
  normalizeTermRow,
  DEFAULT_TERM_DICT,
  type TermDict,
  type TermRow,
} from "@/lib/terminology";

/**
 * Every stored row, normalized. Empty array when the table is absent
 * (pre-migration) or unreadable — callers then get the built-in catalog.
 */
export const getTermRows = cache(async function getTermRows(): Promise<TermRow[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("terminology")
      .select("key, category, en, zh, fr, status, notes, updated_at, updated_by")
      .order("key");
    if (error || !data) return [];
    return data
      .map(normalizeTermRow)
      .filter((r): r is TermRow => r != null);
  } catch {
    return [];
  }
});

/**
 * The resolved dictionary for this request: validated DB rows over the
 * built-in defaults. Pre-migration this IS the built-in catalog.
 */
export const getTermDict = cache(async function getTermDict(): Promise<TermDict> {
  const rows = await getTermRows();
  return rows.length ? buildTermDict(rows) : DEFAULT_TERM_DICT;
});
