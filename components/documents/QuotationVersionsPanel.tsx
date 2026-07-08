import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";

/**
 * QuotationVersionsPanel — version history for a quotation's affair.
 *
 * Lists every version (V1, V2, V3…) grouped under the same affair
 * (root_document_id), so sales can see the negotiation history and jump
 * between revisions. Self-loading async server component: mount it with
 * the current doc's id / root / number.
 *
 * Robust grouping: matches by the root chain (root_document_id) AND by
 * the shared base number (SLX-…  +  SLX-…-V%), so versions still group
 * even if root_document_id wasn't populated on an older revision.
 *
 * Renders nothing if there's only one version and it's not part of an
 * affair — no clutter on a plain single quotation (the "Create new
 * version" action lives in the header ⋯ menu).
 */
export async function QuotationVersionsPanel({
  docId,
  rootId,
  number,
  currentVersion,
}: {
  docId: string;
  rootId: string | null;
  number: string | null;
  currentVersion: number | null;
}) {
  const supabase = createClient();

  const affairRoot = rootId ?? docId;
  const baseNumber = (number ?? "").replace(/-V\d+$/i, "");

  // Build an OR across root chain + number pattern. Guard against an
  // empty baseNumber (would make the ilike match everything).
  const orParts = [
    `id.eq.${affairRoot}`,
    `root_document_id.eq.${affairRoot}`,
  ];
  if (baseNumber) {
    orParts.push(`number.eq.${baseNumber}`);
    orParts.push(`number.ilike.${baseNumber}-V%`);
  }

  let rows: any[] = [];
  const res = await supabase
    .from("documents")
    .select("id, number, version, status, total_price, currency, date")
    .or(orParts.join(","));
  if (!res.error) {
    rows = res.data ?? [];
  } else {
    // m059 columns missing — fall back to number-only grouping.
    if (baseNumber) {
      const fb = await supabase
        .from("documents")
        .select("id, number, status, total_price, currency, date")
        .or(`number.eq.${baseNumber},number.ilike.${baseNumber}-V%`);
      rows = (fb.data ?? []).map((r: any) => ({ ...r, version: null }));
    }
  }

  // De-dupe + sort by version DESCENDING (most recent first).
  const byId = new Map<string, any>();
  for (const r of rows) byId.set(r.id, r);
  const versions = Array.from(byId.values()).sort((a, b) => {
    const va = Number(a.version ?? 1);
    const vb = Number(b.version ?? 1);
    if (va !== vb) return vb - va;
    return String(b.number ?? "").localeCompare(String(a.number ?? ""));
  });

  // Only one version and no affair root → nothing meaningful to show.
  if (versions.length <= 1 && !rootId) return null;

  return (
    <section className="panel p-4">
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="eyebrow">Versions</div>
          <p className="text-xs text-neutral-500 mt-0.5">
            All revisions of this affair. The original is never changed —
            each version is its own draft.
          </p>
        </div>
        <Link
          href={`/documents/new?revise=${docId}`}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 shrink-0"
        >
          + New version
        </Link>
      </div>

      <ol className="space-y-1.5">
        {versions.map((v, idx) => {
          // Highlight = the version you're LOOKING at; "Current" = the
          // family's LATEST version (sorted DESC → index 0). Older versions
          // below are the immutable record of what was sent to the customer.
          const isCurrent = v.id === docId;
          const isLatest = idx === 0;
          return (
            <li key={v.id}>
              <Link
                href={`/documents/${v.id}`}
                className={`flex items-center gap-3 rounded-md border px-3 py-2 transition-colors ${
                  isCurrent
                    ? "border-violet-300 bg-violet-50/60"
                    : "border-neutral-200 bg-white hover:bg-neutral-50"
                }`}
              >
                <span className="inline-flex h-6 min-w-[2rem] items-center justify-center rounded bg-violet-100 px-1.5 text-[11px] font-semibold text-violet-800">
                  V{v.version ?? 1}
                </span>
                <span className="font-mono text-xs text-neutral-700 truncate">
                  {v.number ?? "—"}
                </span>
                <StatusBadge status={v.status} />
                {v.date && (
                  <span className="text-[11px] tabular-nums text-neutral-400 whitespace-nowrap">
                    {new Date(v.date).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "2-digit",
                    })}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-3 shrink-0">
                  <span className="text-xs tabular-nums text-neutral-700">
                    {(v.currency ?? "USD")}{" "}
                    {Number(v.total_price || 0).toLocaleString()}
                  </span>
                  {isLatest ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                      Current
                    </span>
                  ) : isCurrent ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                      Viewing — archived version
                    </span>
                  ) : (
                    <span className="text-[11px] text-neutral-400">Open →</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
