import Link from "next/link";
import { ProjectStatusBadge } from "@/components/projects/ProjectStatusBadge";
import { ClickableRow } from "@/components/projects/ClickableRow";
import { projectStatusColors } from "@/lib/project-status-colors";
import type { ProjectRequestStatus } from "@/lib/types";

export type QueueRow = {
  id: string;
  name: string;
  clientName: string | null;
  country: string | null;
  quantity: number | null;
  status: ProjectRequestStatus;
};

/** Thin reusable queue table for the Projects work-queue views. */
export function ProjectQueueTable({ rows, emptyText }: { rows: QueueRow[]; emptyText: string }) {
  return (
    <section className="panel overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-solux-accent text-left">
            <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Project</th>
            <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Client</th>
            <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Country</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-neutral-700">Qty</th>
            <th className="px-3 py-2 text-xs font-semibold text-neutral-700">Status</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-10 text-center text-neutral-500">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <ClickableRow key={r.id} href={`/projects/${r.id}`} className="group cursor-pointer border-t border-neutral-100 hover:bg-neutral-50">
                <td className={`border-l-2 px-3 py-2 ${projectStatusColors(r.status).leftBorder}`}>
                  <Link href={`/projects/${r.id}`} className="font-medium text-neutral-900 hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-neutral-700">{r.clientName ?? "—"}</td>
                <td className="px-3 py-2 text-neutral-600">{r.country ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.quantity ?? "—"}</td>
                <td className="px-3 py-2">
                  <ProjectStatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-right text-[12px] font-medium text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 whitespace-nowrap">
                  Open →
                </td>
              </ClickableRow>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
