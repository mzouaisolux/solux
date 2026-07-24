/**
 * Knowledge Hub — home (Section 14.1). Header + role-aware summary tiles
 * (Recently published / Families / Models for READ; Awaiting approval for
 * task_list_manager; My open requests for operations), Export catalogue,
 * and a searchable families directory. Server component.
 */

import { getCurrentUserRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import { listFamilies, getHubStats } from "../lib/read";
import { HubFamiliesTable } from "../components/HubFamiliesTable";
import { ExportCatalogueButton } from "../components/ExportCatalogueButton";

function Tile({
  n,
  label,
  accent,
}: {
  n: number | string;
  label: string;
  accent?: "amber" | "green";
}) {
  const borderLeft =
    accent === "amber"
      ? "3px solid var(--sx-amber, #e8870e)"
      : accent === "green"
      ? "3px solid var(--sx-green-deep, #0b7a39)"
      : "3px solid var(--sx-line-2, #dcdde1)";
  return (
    <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, borderLeft }}>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{n}</div>
      <div className="sx-micro">{label}</div>
    </div>
  );
}

export default async function KnowledgeHubHome() {
  const [families, { userId }] = await Promise.all([listFamilies(), getCurrentUserRole()]);
  const [stats, canRaise, canApprove] = await Promise.all([
    getHubStats(userId),
    hasUiCapability("spec.raise"),
    hasUiCapability("spec.approve"),
  ]);

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <div className="sx-head">
          <div>
            <div className="sx-eyebrow">Catalog · source of truth</div>
            <h1 className="sx-h1">Product Knowledge Hub</h1>
            <p className="sx-sub">
              Browse published product specs. {stats.families} {stats.families === 1 ? "family" : "families"} ·{" "}
              {stats.models} {stats.models === 1 ? "model" : "models"}.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <ExportCatalogueButton families={families} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 16 }}>
          {canApprove ? (
            <Tile n={stats.awaitingApproval} label="Awaiting approval" accent="amber" />
          ) : canRaise ? (
            <Tile n={stats.myOpen} label="My open requests" accent="amber" />
          ) : (
            <Tile n={stats.recentlyPublished} label="Recently published" accent="green" />
          )}
          <Tile n={stats.families} label="Families" />
          <Tile n={stats.models} label="Models" />
        </div>

        {(canRaise || canApprove) && (
          <p className="sx-micro" style={{ marginTop: 8 }}>
            {canApprove
              ? "Open a family with a pending change to review & publish."
              : "Open a family to raise a change request."}
          </p>
        )}

        <HubFamiliesTable families={families} />
      </div>
    </div>
  );
}
