// =====================================================================
// /packing/issues — Import Issues review (ambiguous data, never discarded).
// =====================================================================
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listIssues, issueTypeCounts } from "@/lib/packing-server";

export const dynamic = "force-dynamic";

const SEV: Record<string, string> = {
  error: "border-red-300 text-red-700 bg-red-50",
  warning: "border-amber-300 text-amber-700 bg-amber-50",
  info: "border-neutral-300 text-neutral-600 bg-neutral-50",
};

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const sb = createClient();
  const type = searchParams.type;
  const [issues, counts] = await Promise.all([
    listIssues(sb, { type, status: searchParams.status }),
    issueTypeCounts(sb),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Link
          href="/packing/issues"
          className={`text-xs px-2 py-1 border rounded-sm ${!type ? "bg-neutral-900 text-white" : "border-neutral-300"}`}
        >
          All ({Object.values(counts).reduce((a, b) => a + b, 0)})
        </Link>
        {Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([t, n]) => (
            <Link
              key={t}
              href={`/packing/issues?type=${t}`}
              className={`text-xs px-2 py-1 border rounded-sm ${type === t ? "bg-neutral-900 text-white" : "border-neutral-300 hover:bg-neutral-50"}`}
            >
              {t.replace(/_/g, " ")} ({n})
            </Link>
          ))}
      </div>

      <div className="overflow-x-auto border border-neutral-200 rounded-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="p-2 w-14">Row</th>
              <th className="p-2 w-12">Col</th>
              <th className="p-2">Issue</th>
              <th className="p-2 w-20">Severity</th>
              <th className="p-2">Original</th>
              <th className="p-2">Detected</th>
              <th className="p-2">Proposed interpretation</th>
              <th className="p-2 w-20">Status</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i: any) => (
              <tr key={i.id} className="border-t border-neutral-100 align-top hover:bg-neutral-50">
                <td className="p-2 tabular-nums text-neutral-500">{i.source_row ?? "—"}</td>
                <td className="p-2 text-neutral-500">{i.column_ref ?? "—"}</td>
                <td className="p-2 text-neutral-700 whitespace-nowrap">{i.issue_type.replace(/_/g, " ")}</td>
                <td className="p-2">
                  <span className={`text-[10px] px-1.5 py-0.5 border rounded-sm ${SEV[i.severity]}`}>{i.severity}</span>
                </td>
                <td className="p-2 font-mono text-[12px] text-neutral-600 max-w-[120px] truncate" title={i.original_value ?? ""}>
                  {i.original_value || "—"}
                </td>
                <td className="p-2 text-neutral-600 max-w-[360px]">{i.detected_message}</td>
                <td className="p-2 text-neutral-500 max-w-[200px]">{i.proposed_interpretation ?? "—"}</td>
                <td className="p-2">
                  <span className="text-[10px] px-1.5 py-0.5 border border-neutral-300 rounded-sm text-neutral-600">{i.status}</span>
                </td>
              </tr>
            ))}
            {!issues.length && (
              <tr><td colSpan={8} className="p-6 text-center text-neutral-400">No issues.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-neutral-400">
        Ambiguous data is flagged, never silently cleaned. Accept / correct actions (writing back a
        corrected value + audit) land in Phase 1b.
      </p>
    </div>
  );
}
