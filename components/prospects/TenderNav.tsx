"use client";

// =====================================================================
// Tender navigation — the two-universe switcher (UX refactor):
//
//   Tender Inbox    = DISCOVERY  (analyse, accept, reject)
//   Tender Pipeline = EXECUTION  (partner, contact, follow-up, convert)
//
//   • TenderViewToggle — a real segmented switch, always at the top of
//     both screens. One click = the other universe.
//   • TenderFlowBar — the global progression read, clickable:
//     Discovery → Working → Interested → Opportunities.
// =====================================================================

import Link from "next/link";
import { ACTIVE_PIPELINE } from "@/components/prospects/tender-status";
import { needsAction, type TenderMRow } from "@/components/prospects/tender-shared";

/* ------------------------------ view toggle ------------------------------- */

export function TenderViewToggle({
  active,
  tenders,
}: {
  active: "inbox" | "pipeline";
  tenders: TenderMRow[];
}) {
  const newCount = tenders.filter((t) => t.commercial_status === "new").length;
  const working = tenders.filter((t) => ACTIVE_PIPELINE.has(t.commercial_status)).length;
  const alerts = tenders.filter(needsAction).length;

  // COMPACT modern segmented control — premium-CRM style: the universe
  // switch reads instantly without eating vertical space.
  const seg = (on: boolean) =>
    `flex items-center gap-2 rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
      on ? "bg-neutral-900 text-white shadow-sm" : "text-neutral-500 hover:text-neutral-900"
    }`;
  const badge = (on: boolean, alert = false) =>
    `rounded px-1.5 py-px text-[10px] font-bold tabular-nums ${
      alert
        ? "bg-rose-500 text-white"
        : on
          ? "bg-white/20 text-white"
          : "bg-neutral-100 text-neutral-500"
    }`;

  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5 shadow-sm">
      <Link href="/prospects" className={seg(active === "inbox")}>
        Tender Inbox
        <span className={badge(active === "inbox")}>{newCount}</span>
      </Link>
      <Link href="/prospects/pipeline" className={seg(active === "pipeline")}>
        Tender Pipeline
        <span className={badge(active === "pipeline", alerts > 0)}>
          {alerts > 0 ? `⚠ ${alerts}` : working}
        </span>
      </Link>
    </div>
  );
}

/* ----------------------------- global flow bar ----------------------------- */

const WORKING_STATUSES = new Set([
  "accepted", "searching_partner", "partner_assigned", "contacted", "waiting_feedback",
]);

export function TenderFlowBar({
  active,
  tenders,
}: {
  active: "inbox" | "pipeline";
  tenders: TenderMRow[];
}) {
  const discovery = tenders.filter((t) => t.commercial_status === "new").length;
  const working = tenders.filter((t) => WORKING_STATUSES.has(t.commercial_status)).length;
  const interested = tenders.filter((t) =>
    ["interested", "project_request"].includes(t.commercial_status)
  ).length;
  const opportunities = tenders.filter(
    (t) => t.commercial_status === "opportunity_created"
  ).length;

  const steps = [
    { label: "Discovery", count: discovery, href: "/prospects", current: active === "inbox" },
    { label: "Working", count: working, href: "/prospects/pipeline", current: active === "pipeline" },
    { label: "Interested", count: interested, href: "/prospects/pipeline", current: false },
    { label: "Opportunities", count: opportunities, href: "/affairs", current: false },
  ];

  return (
    <div className="panel flex items-stretch divide-x divide-neutral-100 p-0">
      {steps.map((s, i) => (
        <Link
          key={s.label}
          href={s.href}
          className={`group relative flex flex-1 items-center justify-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-neutral-50 ${
            s.current ? "bg-neutral-50/80" : ""
          }`}
        >
          <span
            className={`text-xl font-bold tabular-nums ${
              s.count > 0 ? "text-neutral-900" : "text-neutral-300"
            }`}
          >
            {s.count}
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 group-hover:text-neutral-800">
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <span className="absolute right-[-7px] z-10 text-neutral-300">›</span>
          )}
        </Link>
      ))}
    </div>
  );
}
