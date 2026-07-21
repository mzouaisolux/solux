import { createClient } from "@/lib/supabase/server";
import { canAccessOrAdmin } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import {
  TERM_DEFAULTS,
  TERM_CATEGORY_LABELS,
  normalizeTermRow,
  type TermCategory,
  type TermRow,
} from "@/lib/terminology";
import { TerminologyEditor } from "./TerminologyEditor";

// Render fresh so a just-saved term shows immediately.
export const dynamic = "force-dynamic";

/**
 * Admin → Terminology (m177) — the centralized FIXED TRANSLATIONS.
 *
 * One row per fixed term: a stable key, the English value (mandatory — it is
 * the last fallback before the key itself), the Chinese value, an optional
 * French value, a category, an editorial status and full audit.
 *
 * The vocabulary here is what the Task List, the exports and the factory
 * dossier render. A VALIDATED row is a fixed controlled value: nothing in
 * this system retranslates it, and no automatic translation exists to
 * overwrite it. A draft falls back to English so half-finished Chinese can
 * never reach a factory.
 *
 * Access is `terminology.manage` (super_admin + admin floor, plus the Task
 * List Manager) — enforced here, in the server actions and in RLS.
 */
export default async function TerminologyPage() {
  const allowed = await canAccessOrAdmin(["terminology.manage"]);
  if (!allowed) {
    return (
      <AccessDenied message="Terminology is available to super-admins and the Task List Manager." />
    );
  }

  const supabase = createClient();
  // Pre-m177 the table is absent — the page still lists the built-in catalog
  // (read-only in effect: saving surfaces the "apply m177" error).
  const { data, error } = await supabase
    .from("terminology")
    .select("key, category, en, zh, fr, status, notes, updated_at, updated_by")
    .order("key");
  const live = !error;
  // Never guess WHY the read failed. "Apply m177" is only one possible cause —
  // a permissions/RLS problem or a stale PostgREST schema cache produce the
  // same empty page, and silently blaming the migration sends you to the wrong
  // fix. Surface what Postgres actually said.
  const readError = error ? `${error.code ?? "error"}: ${error.message}` : null;

  const stored = new Map<string, TermRow>();
  for (const raw of (data ?? []) as unknown[]) {
    const row = normalizeTermRow(raw);
    if (row) stored.set(row.key, row);
  }

  // Resolve the author labels in one query rather than per row.
  const authorIds = Array.from(
    new Set(
      Array.from(stored.values())
        .map((r) => r.updated_by)
        .filter((v): v is string => !!v)
    )
  );
  const authors = new Map<string, string>();
  if (authorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", authorIds);
    for (const p of (profiles ?? []) as any[]) {
      authors.set(p.id, p.full_name || p.email || "—");
    }
  }

  // The catalogue is the union of the built-in keys and anything the admin
  // added since — a term added in code but not yet stored still shows up.
  const keys = Array.from(
    new Set([...Object.keys(TERM_DEFAULTS), ...stored.keys()])
  ).sort();

  const rows = keys.map((key) => {
    const builtin = (TERM_DEFAULTS as Record<string, any>)[key];
    const row = stored.get(key);
    return {
      key,
      category: (row?.category ?? builtin?.category ?? "field") as TermCategory,
      en: row?.en ?? builtin?.en ?? "",
      zh: row?.zh ?? builtin?.zh ?? null,
      fr: row?.fr ?? builtin?.fr ?? null,
      status: row?.status ?? ("validated" as const),
      notes: row?.notes ?? null,
      updated_at: row?.updated_at ?? null,
      updated_by_label: row?.updated_by ? (authors.get(row.updated_by) ?? null) : null,
      /** No stored row yet — the built-in default is what renders today. */
      builtin: !row,
      /** Differs from the value shipped in code. */
      overridden: !!row && !!builtin && (row.en !== builtin.en || row.zh !== builtin.zh),
    };
  });

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + 1;
    return acc;
  }, {});
  const pendingZh = rows.filter((r) => !r.zh || r.status !== "validated").length;

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="doc-title mt-1">Terminology</h1>
        <p className="text-xs text-neutral-500 mt-2 max-w-3xl">
          The centralized <b>fixed translations</b> the Task List, the exports
          and the factory dossier render. Each term is validated <b>once</b>{" "}
          here and reused everywhere — a validated value is a fixed controlled
          value, and nothing in this system retranslates it. A term that is
          not validated falls back to its English value rather than being
          machine-translated.
        </p>
        <p className="text-xs text-neutral-500 mt-1.5 max-w-3xl">
          Fallback order: <b>validated translation</b> → built-in default →{" "}
          <b>English</b> → the key itself.
        </p>
        {!live && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 max-w-3xl">
            <p>
              The terminology table could not be read, so this page is listing
              the built-in catalog shipped in the code — which is exactly what
              the documents render today. Nothing is broken.
            </p>
            <p className="mt-1.5">
              If migration <b>m177</b> (177_terminology.sql) has not been
              applied in Supabase, that is the cause. Otherwise the database
              said:
            </p>
            <code className="mt-1 block rounded bg-amber-100 px-2 py-1 font-mono text-[11px]">
              {readError}
            </code>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1">
            {rows.length} terms
          </span>
          {Object.entries(counts).map(([c, n]) => (
            <span
              key={c}
              className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-neutral-600"
            >
              {TERM_CATEGORY_LABELS[c as TermCategory] ?? c}: {n}
            </span>
          ))}
          {pendingZh > 0 && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-amber-900">
              {pendingZh} awaiting a validated Chinese value
            </span>
          )}
        </div>
      </div>

      <TerminologyEditor rows={rows} live={live} />
    </div>
  );
}
