// =====================================================================
// PROSPECTS & TENDERS — the commercial-discovery center (m116/m117).
//
// Two universes on ONE page — and they are DIFFERENT BUSINESSES
// (owner ruling 2026-06-13):
//
//   [ Prospects ] — THE PROSPECTION MACHINE, fed by tender ATTRIBUTIONS
//     (awarded projects). Sub-tabs:
//       · Projects   (default) — the deal-discovery row list
//       · Companies  — the prospect companies database (lead queue)
//
//   [ Tenders ] — OPEN calls for tenders (published notices to qualify
//     and defend with a partner): Inbox · Pipeline. Attributions do NOT
//     belong here.
//
// View memory: explicit URL params win; bare /prospects reopens the
// last-used view (cookie). Gated by prospect.access.
// =====================================================================

import Link from "next/link";
import { cookies } from "next/headers";
import { getEffectiveRole } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import { ProspectsPanel } from "@/components/prospects/ProspectsPanel";
import { TendersManager } from "@/components/prospects/TendersManager";
import { AttributionsPanel } from "@/components/prospects/AttributionsPanel";
import {
  RememberDiscoveryView,
  DISCOVERY_VIEW_COOKIE,
} from "@/components/prospects/RememberDiscoveryView";
import { loadTendersBundle } from "./tenders-data";

export const dynamic = "force-dynamic";

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams?: { u?: string; t?: string; p?: string; open?: string };
}) {
  const { userId, effectiveRole } = await getEffectiveRole();
  const canAccess = await hasUiCapability("prospect.access");
  if (!canAccess) return <AccessDenied capability="prospect.access" />;

  // Role separation (owner ruling 2026-06-13) — UI mirror of the
  // server-side gates (requireProjectManagement / requireProjectImport).
  const canAssignProjects = ["admin", "super_admin", "sales_director"].includes(
    effectiveRole ?? ""
  );
  const canImportAttributions = ["admin", "super_admin"].includes(effectiveRole ?? "");
  const t = getT();

  const bundle = await loadTendersBundle();

  // ---- View resolution: explicit params > cookie > defaults ----
  const remembered = cookies().get(DISCOVERY_VIEW_COOKIE)?.value ?? "";
  const [rememberedU, , rememberedP] = remembered.split(":");
  const universe =
    searchParams?.u === "tenders"
      ? "tenders"
      : searchParams?.u === "prospects"
        ? "prospects"
        : rememberedU === "tenders"
          ? "tenders"
          : "prospects";
  // Deep links to a company profile (?open=…) land on the Companies tab.
  const prospectsTab: "projects" | "companies" =
    searchParams?.p === "companies" || searchParams?.open
      ? "companies"
      : searchParams?.p === "projects"
        ? "projects"
        : rememberedP === "companies"
          ? "companies"
          : "projects";

  // Attributions (type 'result') = the prospection fuel. Open tenders
  // (everything else) = the Tenders universe inbox.
  const attributionTenders = bundle.tenders.filter((t: any) => t.type === "result");
  const inboxTenders = bundle.tenders.filter((t: any) => t.type !== "result");

  const tabCls = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors ${
      active
        ? "bg-neutral-900 text-white ring-neutral-900"
        : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"
    }`;
  // The BIG universe switch — it IS the page title.
  const bigToggle = (active: boolean) =>
    `block rounded-xl border px-5 py-4 transition-colors ${
      active
        ? "border-neutral-900 bg-neutral-900 text-white shadow-sm"
        : "border-neutral-200 bg-white text-neutral-900 hover:border-neutral-400"
    }`;

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <RememberDiscoveryView
        universe={universe}
        tendersTab="inbox"
        prospectsTab={prospectsTab}
      />

      {/* ---- Header: the universe switch IS the title ---- */}
      <div>
        <div className="eyebrow">{t("prospects.eyebrow")}</div>
        <div className="mt-2 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/prospects?u=prospects"
            className={bigToggle(universe === "prospects")}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-2xl font-bold tracking-tight">Prospects</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                  universe === "prospects" ? "bg-white/15" : "bg-neutral-100 text-neutral-600"
                }`}
              >
                {t("prospects.universe.prospects_count", { projects: attributionTenders.length, companies: bundle.prospects.length })}
              </span>
            </div>
            <p
              className={`mt-1 text-[12px] leading-snug ${
                universe === "prospects" ? "text-white/70" : "text-neutral-500"
              }`}
            >
              {t("prospects.universe.prospects_desc")}
            </p>
          </Link>
          <Link href="/prospects?u=tenders" className={bigToggle(universe === "tenders")}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-2xl font-bold tracking-tight">{t("prospects.universe.tenders_title")}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                  universe === "tenders" ? "bg-white/15" : "bg-neutral-100 text-neutral-600"
                }`}
              >
                {inboxTenders.length}
              </span>
            </div>
            <p
              className={`mt-1 text-[12px] leading-snug ${
                universe === "tenders" ? "text-white/70" : "text-neutral-500"
              }`}
            >
              {t("prospects.universe.tenders_desc")}
            </p>
          </Link>
        </div>
      </div>

      {universe === "prospects" ? (
        <>
          {/* ---- Prospects sub-tabs: Projects (default) · Companies ---- */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/prospects?u=prospects&p=projects"
              className={tabCls(prospectsTab === "projects")}
            >
              {t("prospects.tab.projects")}
              {attributionTenders.length > 0 && (
                <span className="ml-1 tabular-nums">({attributionTenders.length})</span>
              )}
            </Link>
            <Link
              href="/prospects?u=prospects&p=companies"
              className={tabCls(prospectsTab === "companies")}
            >
              {t("prospects.tab.companies")}
              {bundle.prospects.length > 0 && (
                <span className="ml-1 tabular-nums">({bundle.prospects.length})</span>
              )}
            </Link>
          </div>

          {prospectsTab === "projects" ? (
            <AttributionsPanel
              attributions={attributionTenders}
              owners={bundle.owners}
              ownerLabels={bundle.ownerLabels}
              canAssign={canAssignProjects}
              canImport={canImportAttributions}
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50/60 px-3 py-2">
                <p className="text-[12px] text-neutral-600">
                  {t("prospects.companies_fed_notice")}
                </p>
                <Link
                  href="/prospects?u=prospects&p=projects"
                  className="shrink-0 text-[11px] font-semibold text-neutral-600 underline underline-offset-2 hover:text-neutral-900"
                >
                  {t("prospects.open_projects_tab")}
                </Link>
              </div>
              <ProspectsPanel
                prospects={bundle.prospects}
                owners={bundle.owners}
                ownerLabels={bundle.ownerLabels}
                historyByProspect={bundle.historyByProspect}
                activitiesByProspect={bundle.activitiesByProspect}
                initialOpenId={searchParams?.open ?? null}
                canImportAttributions={canImportAttributions}
              />
            </>
          )}
        </>
      ) : (
        <>
          {/* ---- Tenders: open calls only — Inbox · Pipeline ---- */}
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/prospects?u=tenders" className={tabCls(true)}>
              {t("prospects.tab.tender_inbox")}
            </Link>
            <Link href="/prospects/pipeline" className={tabCls(false)}>
              {t("prospects.tab.tender_pipeline")}
            </Link>
          </div>
          <TendersManager
            tenders={inboxTenders}
            clients={bundle.clients}
            prospects={bundle.prospectOptions}
            owners={bundle.owners}
            ownerLabels={bundle.ownerLabels}
            currentUserId={userId ?? null}
          />
        </>
      )}
    </div>
  );
}
