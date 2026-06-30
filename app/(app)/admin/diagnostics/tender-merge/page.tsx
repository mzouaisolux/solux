// =====================================================================
// Tender duplicate consolidation — RETRO DRY-RUN report (read-only).
// Owner decision 4 (2026-06-13): show what WOULD merge before any write.
// This page never modifies data — the "Apply" step is a separate,
// reviewed action (phase 2b) once the report looks right.
// =====================================================================

import Link from "next/link";
import { hasUiCapability, requireCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import { analyzeTenderDuplicates } from "./actions";

export const dynamic = "force-dynamic";

export default async function TenderMergeDryRunPage() {
  const canSee = await hasUiCapability("admin.diagnostics");
  if (!canSee) return <AccessDenied capability="admin.diagnostics" />;
  await requireCapability("admin.diagnostics");

  const report = await analyzeTenderDuplicates();

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <section className="card sec ad-section">
          <div className="eyebrow">Admin · Diagnostics</div>
          <h2 className="ad-doc-title">Tender duplicates — consolidation dry-run</h2>
          <p className="ad-lead">
            Existing award projects that look like the SAME real-world tender (one project,
            many lots/winners). Uses the same matcher as the import. <b>This page writes
            nothing</b> — review the proposal here; merging is a separate, confirmed step.
          </p>

          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900"
            style={{ marginTop: 12 }}
          >
            ⚠ Dry-run only. No tender is merged or deleted by opening this page.
          </div>

          {report.error ? (
            <p className="ad-lead" style={{ marginTop: 16 }}>
              Could not analyze: <code>{report.error}</code>
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{ marginTop: 16 }}>
                <Kpi label="Result tenders" value={report.totalTenders} />
                <Kpi label="Duplicate groups" value={report.clusters} />
                <Kpi label="Records to fold in" value={report.duplicates} tone={report.duplicates ? "warn" : "ok"} />
                <Kpi label="Projects after merge" value={report.projectedAfter} tone="ok" />
              </div>
              {report.flagged > 0 && (
                <p className="ad-lead" style={{ marginTop: 10 }}>
                  {report.flagged} proposed merge(s) are gray-zone (close but not certain) — review these first.
                </p>
              )}

              {report.groups.length === 0 ? (
                <p className="text-[13px] text-emerald-700" style={{ marginTop: 18 }}>
                  ✓ No duplicate tenders detected — every project is already unique.
                </p>
              ) : (
                <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                  {report.groups.map((g) => (
                    <div key={g.principal.id} className="rounded-lg border border-neutral-200 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                        Keep as principal ({g.principal.participantCount} participants)
                      </div>
                      <Link
                        href={`/prospects/tenders/${g.principal.id}`}
                        className="text-[14px] font-semibold text-neutral-900 underline decoration-dotted underline-offset-2"
                      >
                        {g.principal.title ?? "(untitled)"}
                      </Link>
                      <div className="text-[12px] text-neutral-500">
                        {[g.principal.country, g.principal.buyer, g.principal.date].filter(Boolean).join(" · ")}
                      </div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-700" style={{ marginTop: 10 }}>
                        Would fold in ({g.duplicates.length})
                      </div>
                      <ul className="divide-y divide-neutral-100">
                        {g.duplicates.map((d) => (
                          <li key={d.id} className="py-1.5 text-[13px]">
                            <Link
                              href={`/prospects/tenders/${d.id}`}
                              className="font-medium text-neutral-800 underline decoration-dotted underline-offset-2"
                            >
                              {d.title ?? "(untitled)"}
                            </Link>
                            <span className="text-neutral-400"> · {d.participantCount} part.</span>
                            <span
                              className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                d.confidence === "candidate"
                                  ? "bg-amber-50 text-amber-800 border border-amber-200"
                                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              }`}
                            >
                              {d.confidence === "candidate" ? "review" : "high"}
                            </span>
                            <div className="text-[11px] text-neutral-500">{d.reason}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              <p className="ad-lead" style={{ marginTop: 18, fontSize: 12 }}>
                Looks right? The merge step (repoint participants by company + lot, keep all
                source URLs, hide the folded records) is applied separately once you approve.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const color = tone === "warn" && value > 0 ? "#be123c" : tone === "ok" ? "#047857" : "#111";
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
    </div>
  );
}
