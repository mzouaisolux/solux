"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishPrices, getPriceCsv } from "./actions";

/**
 * Publish a price list's computed prices into prices_version (the seam the
 * old CSV upload fed) and export the backward-compat per-list CSV.
 */
export default function PricingActionsClient({
  priceListId,
  listName,
  totalCount = 0,
  missingCount = 0,
}: {
  priceListId: string;
  listName: string;
  totalCount?: number;
  /** Products in the category with no active cost (will be skipped on publish). */
  missingCount?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function onPublish() {
    setErr(null);
    setMsg(null);
    setWarn(null);
    let prompt = `Publishing will update the active prices used by the quote builder for “${listName}” (${totalCount} product${totalCount === 1 ? "" : "s"} with a cost).`;
    if (missingCount > 0) {
      prompt += `\n\n${missingCount} product${missingCount === 1 ? "" : "s"} ${
        missingCount === 1 ? "has" : "have"
      } no active cost and will be SKIPPED (not priced). Enter a cost for ${
        missingCount === 1 ? "it" : "them"
      } and re-publish to include ${missingCount === 1 ? "it" : "them"}.`;
    }
    prompt += `\n\nContinue?`;
    if (!confirm(prompt)) return;
    startTransition(async () => {
      try {
        const res = await publishPrices(priceListId);
        setMsg(`Published ${res?.published ?? 0} product(s).`);
        const skippedNames = res?.skippedNames ?? [];
        if (res?.skipped) {
          const shown = skippedNames.slice(0, 5).join(", ");
          const more = skippedNames.length > 5 ? ` +${skippedNames.length - 5} more` : "";
          setWarn(
            `${res.skipped} product${res.skipped === 1 ? "" : "s"} skipped — no active cost${
              shown ? `: ${shown}${more}` : ""
            }.`
          );
        }
        router.refresh();
      } catch (e: any) {
        setErr(e?.message ?? "Publish failed.");
      }
    });
  }

  async function onExport() {
    setErr(null);
    try {
      const csv = await getPriceCsv(priceListId);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prices_${listName.replace(/\s+/g, "-").toLowerCase()}_${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.message ?? "Export failed.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={onPublish} disabled={pending || totalCount === 0} className="sx-btn sx-btn-go disabled:opacity-50">
        {pending ? "Publishing…" : "Publish to quotes →"}
      </button>
      <button onClick={onExport} className="sx-btn">
        ↓ Export CSV
      </button>
      {msg && <span className="text-sm text-emerald-700">{msg}</span>}
      {warn && <span className="text-sm text-amber-700">{warn}</span>}
      {err && <span className="text-sm text-rose-700">{err}</span>}
    </div>
  );
}
