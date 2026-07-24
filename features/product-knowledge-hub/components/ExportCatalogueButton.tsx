"use client";

/**
 * Export the families directory as a CSV, client-side (no server round-trip).
 * Matches the "Export catalogue" affordance in the Section 14.1c read view.
 */

import type { FamilySummary } from "../lib/types";

export function ExportCatalogueButton({ families }: { families: FamilySummary[] }) {
  function exportCsv() {
    const header = ["Family", "Models", "Version", "Last updated", "Status"];
    const rows = families.map((f) => [
      f.name,
      String(f.modelCount),
      f.currentVersion ?? "",
      f.lastUpdated ? new Date(f.lastUpdated).toLocaleDateString() : "",
      f.pending ? "Change pending" : f.currentVersion ? "Published" : "No version",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "knowledge-hub-catalogue.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button className="sx-btn" onClick={exportCsv}>
      Export catalogue
    </button>
  );
}
