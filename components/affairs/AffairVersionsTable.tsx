"use client";

// =====================================================================
// Quotation versions list for an affair — V{n} · date · value · commercial
// status · Open / Continue editing. Used inside the affair EXPANSION (Clients
// tree + Client Hub Affaires tab) so basic consultation needs no extra page.
// The version owns only its commercial status; operational status is the
// affair's (shown by the progress strip / operational status chip).
// =====================================================================

import Link from "next/link";
import InlineStatusSwitcher from "@/components/InlineStatusSwitcher";
import { fmtDate } from "@/components/affairs/badges";
import { formatMoney, type AffairGroup } from "@/lib/affairs-prototype";

export function AffairVersionsTable({ affair }: { affair: AffairGroup }) {
  const versions = [...affair.documents].sort(
    (a, b) => (b.version ?? 1) - (a.version ?? 1),
  );
  if (versions.length === 0) {
    return (
      <p className="text-[12px] text-neutral-500">No quotation versions yet.</p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg bg-white ring-1 ring-neutral-200/70">
      <table className="w-full text-left text-[12px]">
        <tbody>
          {versions.map((d) => (
            <tr
              key={d.id}
              className="border-t border-neutral-100 first:border-t-0 hover:bg-solux-surface"
            >
              <td className="py-2 pl-3 pr-2 font-mono text-[11.5px] font-medium text-neutral-700">
                V{d.version ?? 1}
                {d.type === "proforma" && (
                  <span className="ml-1.5 rounded bg-indigo-50 px-1 py-0.5 text-[9px] font-semibold uppercase text-indigo-700">
                    PF
                  </span>
                )}
              </td>
              <td className="py-2 pr-2 text-neutral-400">{fmtDate(d.date)}</td>
              <td className="py-2 pr-2 text-right font-medium tabular-nums text-neutral-800">
                {d.total_price ? formatMoney(d.total_price, d.currency) : ""}
              </td>
              <td className="py-2 pr-2">
                {/* COMMERCIAL status only (draft/sent/won/lost) */}
                <InlineStatusSwitcher docId={d.id} current={d.status} />
              </td>
              <td className="py-1.5 pl-2 pr-3 text-right">
                {d.status === "draft" ? (
                  <Link
                    href={`/documents/new?edit=${d.id}`}
                    className="inline-flex items-center rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark"
                  >
                    Continue editing →
                  </Link>
                ) : (
                  <Link
                    href={`/documents/${d.id}`}
                    className="text-[11px] font-medium text-solux-dark hover:underline"
                  >
                    Open →
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
