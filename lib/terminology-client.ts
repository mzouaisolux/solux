"use client";

/**
 * TERMINOLOGY — browser-side loader (m177).
 *
 * The production dossier PDF is generated IN THE BROWSER
 * (app/(app)/task-lists/[id]/dossier.ts), so it cannot use the server loader.
 * The RLS read policy is `authenticated → true`, so the browser client reads
 * the same rows and merges them the same way.
 *
 * Defensive by design: a pre-m177 database has no table, the select errors,
 * and we fall back to the built-in catalog — the dossier renders identically
 * before and after the migration.
 */

import { createClient } from "@/lib/supabase/client";
import {
  buildTermDict,
  normalizeTermRow,
  DEFAULT_TERM_DICT,
  type TermDict,
  type TermRow,
} from "@/lib/terminology";

/** Fetch + merge the vocabulary. Never throws — falls back to the catalog. */
export async function fetchTermDict(): Promise<TermDict> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("terminology")
      .select("key, category, en, zh, fr, status, notes, updated_at, updated_by")
      .order("key");
    if (error || !data) return DEFAULT_TERM_DICT;
    const rows = data
      .map(normalizeTermRow)
      .filter((r): r is TermRow => r != null);
    return rows.length ? buildTermDict(rows) : DEFAULT_TERM_DICT;
  } catch {
    return DEFAULT_TERM_DICT;
  }
}
