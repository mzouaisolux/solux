"use client";

// =====================================================================
// Tender Drawer (UX refactor) — the professional side workspace that
// replaces the old inline row expansion. Opens from the inbox table or
// a pipeline card; the list stays visible behind (context preserved).
//
//   • 70–80% of the screen, slide-in from the right, Esc / backdrop close
//   • Premium header: name + Country · Buyer · Closing · Days · Score ·
//     Budget stat tiles
//   • Tabs: Overview / Documents / Qualification / History / Notes
//   • Fixed ACTION column on the right — never disappears, whatever the
//     active tab. Content follows the lifecycle:
//       New        → Accept / Reject
//       Accepted   → Assign Existing Client / Create New Prospect / Plan
//       In progress→ Change Status / Add Follow-up / Add Next Action
//   • Accepting from the Inbox shows the hand-over banner: the dossier
//     now lives in the Tender Pipeline.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { toast } from "@/components/feedback/toast-store";
import {
  attachTender,
  createOpportunityFromTender,
  acceptTender,
  rejectTender,
  markTenderSearchingPartner,
  createPartnerAndAttach,
  addTenderFollowUp,
  deleteTender,
  addTenderParticipant,
  deleteTenderParticipant,
  promoteParticipantToProspect,
  setTenderCommercialStatus,
  setTenderOwner,
  saveTenderNotes,
  createTenderNextAction,
  completeTenderNextAction,
  deleteTenderNextAction,
} from "@/app/(app)/prospects/actions";
import {
  COMMERCIAL_STATUS_LABEL,
  STATUS_CHIP,
  ACTIVE_PIPELINE,
} from "@/components/prospects/tender-status";
import {
  type TenderMRow,
  type CompanyOption,
  type OwnerOption,
  type ActFn,
  REJECT_REASON_LABEL,
  FOLLOWUP_KIND_LABEL,
  FOLLOWUP_FORM_KINDS,
  ACTION_TYPE_OPTIONS,
  SPEC_CARDS,
  prettify,
  specValueToText,
  isLongSpec,
  classify,
  CLASS_CHIP,
  daysLeft,
  todayISO,
  money,
  needsAction,
  smallSelect,
  isNavError,
} from "@/components/prospects/tender-shared";

type DrawerTab = "overview" | "documents" | "qualification" | "history" | "notes";

/* ------------------------------- primitives ------------------------------- */

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-[12.5px]">
      <span className="text-neutral-500">{label}</span>
      <span className="text-right font-medium text-neutral-800">{value ?? "—"}</span>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 border-b-2 border-neutral-200 pb-1.5 text-[12px] font-bold uppercase tracking-wider text-neutral-800">
        {title}
      </div>
      {children}
    </div>
  );
}

/** Header stat tile — the premium 5-second read. */
function HeaderStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "danger" | "muted";
}) {
  return (
    <div className="min-w-0 rounded-lg border border-neutral-200 bg-white px-3 py-2">
      <div className="text-[9.5px] font-bold uppercase tracking-wider text-neutral-400">
        {label}
      </div>
      <div
        className={`truncate text-[13px] font-bold ${
          tone === "danger" ? "text-rose-700" : tone === "muted" ? "text-neutral-400" : "text-neutral-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/* --------------------------------- drawer --------------------------------- */

export function TenderDrawer({
  t,
  context,
  owners,
  ownerLabels,
  currentUserId,
  clients,
  prospects,
  act,
  onClose,
}: {
  t: TenderMRow;
  /** Where the drawer was opened from — drives the Accept hand-over banner. */
  context: "inbox" | "pipeline";
  owners: OwnerOption[];
  ownerLabels: Record<string, string>;
  currentUserId: string | null;
  clients: CompanyOption[];
  prospects: CompanyOption[];
  act: ActFn;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DrawerTab>("overview");
  const [shown, setShown] = useState(false);

  // Keep the latest onClose without re-running the mount effect (a parent
  // re-render recreates the callback — re-running would leak the scroll
  // lock: the second run captures "hidden" as the value to restore).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Slide-in + lock the page scroll while open. Mount/unmount only.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const dl = daysLeft(t.deadline);
  const cls = classify(t.score);
  const docsWithUrl = t.documents.filter((d) => d.url).length;

  const TABS: { key: DrawerTab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "documents", label: "Documents", count: t.documents.length },
    { key: "qualification", label: "Qualification" },
    { key: "history", label: "History", count: t.followups.length },
    { key: "notes", label: "Notes" },
  ];

  // Mounted only after a user click, so document always exists — but be
  // defensive. The PORTAL is essential: rendered in place, the drawer
  // would inherit the page's stacking context (under the sticky nav) and
  // any transformed ancestor would break `position: fixed`.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true">
      {/* backdrop — the list stays visible behind. Close on CLICK (not
          mousedown): unmounting on mousedown lets the released click land
          on the table row behind, which instantly re-opens the drawer. */}
      <div
        className={`absolute inset-0 bg-neutral-900/40 transition-opacity duration-200 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* panel — 70–80% of the screen */}
      <div
        className={`absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl transition-transform duration-200 ease-out md:w-[78vw] md:max-w-[1280px] ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* ===== HEADER ===== */}
        <div className="border-b border-neutral-200 px-5 pt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${
                    STATUS_CHIP[t.commercial_status] ?? STATUS_CHIP.new
                  }`}
                >
                  {COMMERCIAL_STATUS_LABEL[t.commercial_status] ?? t.commercial_status}
                </span>
                {needsAction(t) && (
                  <span className="rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-700">
                    ⚠ No next action
                  </span>
                )}
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
                  {t.type}
                </span>
              </div>
              <h2 className="mt-1.5 text-[17px] font-bold leading-snug text-neutral-900">
                {t.title}
              </h2>
              <div className="mt-0.5 text-[12px] text-neutral-500">
                {[t.reference, t.platform, t.city].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-neutral-200 px-2 py-1 text-[13px] text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* premium meta band */}
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            <HeaderStat label="Country" value={t.country ?? "—"} />
            <HeaderStat label="Buyer" value={t.buyer ?? "—"} />
            <HeaderStat label="Closing Date" value={t.deadline ?? "—"} />
            <HeaderStat
              label="Days Remaining"
              value={dl == null ? "—" : dl < 0 ? "closed" : `${dl}d`}
              tone={dl != null && dl >= 0 && dl < 7 ? "danger" : dl != null && dl < 0 ? "muted" : undefined}
            />
            <HeaderStat
              label="Score"
              value={
                t.score != null ? (
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 tabular-nums ${CLASS_CHIP[cls]}`}>
                    {t.score}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <HeaderStat
              label="Budget"
              value={t.budget_usd != null ? `$${money(t.budget_usd)}` : money(t.value, t.currency)}
            />
          </div>

          {/* tabs */}
          <div className="mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((tb) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-[12.5px] font-semibold transition-colors ${
                  tab === tb.key
                    ? "border-neutral-900 text-neutral-900"
                    : "border-transparent text-neutral-400 hover:text-neutral-700"
                }`}
              >
                {tb.label}
                {tb.count != null && (
                  <span className="ml-1.5 rounded bg-neutral-100 px-1.5 py-px text-[10px] font-bold tabular-nums text-neutral-500">
                    {tb.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ===== BODY — tab content LEFT, fixed action column RIGHT ===== */}
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 overflow-y-auto p-5">
            {tab === "overview" && <OverviewTab t={t} act={act} />}
            {tab === "documents" && <DocumentsTab t={t} />}
            {tab === "qualification" && <QualificationTab t={t} />}
            {tab === "history" && <HistoryTab t={t} act={act} />}
            {tab === "notes" && <NotesTab t={t} act={act} />}
          </div>

          <aside className="overflow-y-auto border-t border-neutral-200 bg-neutral-50/60 p-4 lg:border-l lg:border-t-0">
            <ActionRail
              t={t}
              context={context}
              owners={owners}
              currentUserId={currentUserId}
              clients={clients}
              prospects={prospects}
              act={act}
              docsWithUrl={docsWithUrl}
            />
          </aside>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ================================== tabs =================================== */

function OverviewTab({ t, act }: { t: TenderMRow; act: ActFn }) {
  const specBlocks = useMemo(() => {
    const entries = Object.entries(t.specs ?? {}).map(
      ([k, v]) => [k, specValueToText(v)] as const
    );
    return {
      cards: entries.filter(([k]) => SPEC_CARDS[k]),
      long: entries.filter(([k, txt]) => isLongSpec(k, txt)),
      short: entries.filter(([k, txt]) => !SPEC_CARDS[k] && !isLongSpec(k, txt)),
    };
  }, [t.specs]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <DetailSection title="General information">
          <Info label="Buyer" value={t.buyer} />
          <Info label="Country" value={t.country} />
          <Info label="City" value={t.city} />
          <Info label="Platform" value={t.platform} />
          <Info label="Reference" value={t.reference} />
          <Info label="Published" value={t.publication_date} />
          <Info label="Closing" value={t.deadline} />
          {t.source_url && (
            <Info
              label="Source"
              value={
                <a
                  href={t.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted underline-offset-2 hover:text-neutral-900"
                >
                  Open ↗
                </a>
              }
            />
          )}
          {t.last_import_at && (
            <Info label="Last import" value={String(t.last_import_at).slice(0, 10)} />
          )}
        </DetailSection>

        <DetailSection title="Contact">
          <Info label="Name" value={t.contact_name} />
          <Info
            label="Email"
            value={
              t.contact_email ? (
                <a href={`mailto:${t.contact_email}`} className="underline decoration-dotted underline-offset-2">
                  {t.contact_email}
                </a>
              ) : (
                "—"
              )
            }
          />
          <Info label="Phone" value={t.contact_phone} />
          <Info label="Secondary" value={t.contact_phone2} />
          {t.attachedName && (
            <>
              <div className="my-1.5 border-t border-neutral-200" />
              <Info label="Partner" value={<b>{t.attachedName}</b>} />
            </>
          )}
        </DetailSection>
      </div>

      {(specBlocks.cards.length > 0 || specBlocks.short.length > 0) && (
        <DetailSection title="Technical specifications">
          {specBlocks.cards.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {specBlocks.cards.map(([k, txt]) => (
                <div key={k} className="rounded-lg border border-neutral-200 bg-white px-2 py-2.5 text-center">
                  <div className="text-base font-bold tabular-nums text-neutral-900">
                    {txt}
                    {SPEC_CARDS[k].unit ?? ""}
                  </div>
                  <div className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-neutral-500">
                    {SPEC_CARDS[k].label}
                  </div>
                </div>
              ))}
            </div>
          )}
          {specBlocks.short.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 md:grid-cols-3">
              {specBlocks.short.map(([k, txt]) => (
                <Info key={k} label={prettify(k)} value={txt} />
              ))}
            </div>
          )}
        </DetailSection>
      )}

      {specBlocks.long.length > 0 && (
        <DetailSection title="Raw specifications">
          {specBlocks.long.map(([k, txt]) => (
            <div key={k} className="mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                {prettify(k)}
              </div>
              <p className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-neutral-100 bg-neutral-50/50 px-2.5 py-1.5 text-[12px] leading-snug text-neutral-600">
                {txt}
              </p>
            </div>
          ))}
        </DetailSection>
      )}

      {t.type === "result" && (
        <DetailSection title="Competitor intel">
          <ParticipantsBlock tender={t} act={act} />
        </DetailSection>
      )}
    </div>
  );
}

function DocumentsTab({ t }: { t: TenderMRow }) {
  return (
    <DetailSection title={`Documents (${t.documents.length})`}>
      {t.documents.length === 0 ? (
        <p className="text-[12px] text-neutral-400">No documents on this tender.</p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {t.documents.map((d, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
              <span className="min-w-0 truncate">
                <span className="rounded bg-neutral-100 px-1 py-0.5 text-[9px] font-bold uppercase text-neutral-500">
                  {d.type}
                </span>{" "}
                <span className="text-neutral-700">{d.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`text-[10px] font-semibold ${d.imported ? "text-emerald-700" : "text-neutral-400"}`}>
                  {d.imported ? "✓ imported" : "not imported"}
                </span>
                {d.url && (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
                  >
                    Download
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}

function QualificationTab({ t }: { t: TenderMRow }) {
  const cls = classify(t.score);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <DetailSection title="Scoring">
          <Info
            label="Score"
            value={
              t.score != null ? (
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 ${CLASS_CHIP[cls]}`}>
                  {t.score} · {cls === "priority" ? "Priority" : cls === "to_qualify" ? "To Qualify" : "Watchlist"}
                </span>
              ) : (
                "—"
              )
            }
          />
          <Info label="Relevance" value={t.relevance} />
          <Info
            label="Solar confirmed"
            value={t.solar_confirmed == null ? "—" : t.solar_confirmed ? "Yes" : "No"}
          />
        </DetailSection>

        <DetailSection title="Budget">
          <Info label="Amount" value={money(t.value, t.currency)} />
          <Info label="Budget USD" value={t.budget_usd != null ? `$${money(t.budget_usd)}` : "—"} />
        </DetailSection>
      </div>

      <DetailSection title="Decision">
        <Info
          label="Qualification"
          value={
            t.commercial_status === "new"
              ? "Pending — accept or reject in the Actions column"
              : t.commercial_status === "rejected"
                ? "Rejected"
                : `Accepted${t.accepted_at ? ` on ${String(t.accepted_at).slice(0, 10)}` : ""}`
          }
        />
        {t.converted_at && <Info label="Converted" value={String(t.converted_at).slice(0, 10)} />}
      </DetailSection>

      {t.commercial_status === "rejected" && (
        <div className="rounded-md border border-rose-200 bg-rose-50/70 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wide text-rose-700">
            Rejected — {REJECT_REASON_LABEL[t.rejected_reason ?? "other"] ?? t.rejected_reason}
          </div>
          {t.rejected_comment && <p className="mt-1 text-[12.5px] text-rose-900">{t.rejected_comment}</p>}
          {t.rejected_at && (
            <p className="mt-0.5 text-[10px] text-rose-400">{String(t.rejected_at).slice(0, 10)}</p>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryTab({ t, act }: { t: TenderMRow; act: ActFn }) {
  const done = t.actions.filter((a) => a.done_at);
  return (
    <div className="space-y-5">
      <DetailSection title={`Follow-up history (${t.followups.length})`}>
        <FollowupForm t={t} act={act} />
        {t.followups.length === 0 ? (
          <p className="text-[12px] text-neutral-400">
            No follow-ups yet — contact attempts, communications, feedback and commercial
            progress are logged here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {t.followups.map((f) => (
              <li key={f.id} className="text-[12.5px]">
                <span className="mr-1.5 rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-neutral-500">
                  {FOLLOWUP_KIND_LABEL[f.kind] ?? f.kind}
                </span>
                <span className="text-neutral-700">{f.comment}</span>
                <span className="text-neutral-400"> · {String(f.created_at).slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      {done.length > 0 && (
        <DetailSection title={`Completed actions (${done.length})`}>
          <ul className="space-y-1">
            {done.map((a) => (
              <li key={a.id} className="text-[12.5px] text-neutral-500">
                <span className="text-emerald-600">✓</span>{" "}
                {ACTION_TYPE_OPTIONS.find((o) => o.value === a.action_type)?.label ?? "Action"} ·{" "}
                {a.title ?? "—"} · {a.due_date}
              </li>
            ))}
          </ul>
        </DetailSection>
      )}

      <DetailSection title="Timeline">
        <ul className="space-y-1 text-[12.5px] text-neutral-600">
          {t.converted_at && <li>→ Converted to opportunity · {String(t.converted_at).slice(0, 10)}</li>}
          {t.rejected_at && <li>→ Rejected · {String(t.rejected_at).slice(0, 10)}</li>}
          {t.accepted_at && <li>→ Accepted · {String(t.accepted_at).slice(0, 10)}</li>}
          {t.last_import_at && <li>→ Last import · {String(t.last_import_at).slice(0, 10)}</li>}
          {t.imported_at && <li>→ First imported · {String(t.imported_at).slice(0, 10)}</li>}
          {t.publication_date && <li>→ Published · {t.publication_date}</li>}
        </ul>
      </DetailSection>
    </div>
  );
}

function NotesTab({ t, act }: { t: TenderMRow; act: ActFn }) {
  return (
    <DetailSection title="Internal notes">
      <form action={(fd) => act(saveTenderNotes, fd, "Notes saved")}>
        <input type="hidden" name="id" value={t.id} />
        <textarea
          name="notes"
          defaultValue={t.notes ?? ""}
          rows={10}
          placeholder="Internal notes — never overwritten by imports."
          className="w-full rounded-md border border-neutral-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-neutral-200"
        />
        <button className="mt-2 rounded-md bg-solux px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-solux-dark">
          Save notes
        </button>
      </form>
    </DetailSection>
  );
}

/* ============================== action rail ================================ */

function ActionRail({
  t,
  context,
  owners,
  currentUserId,
  clients,
  prospects,
  act,
  docsWithUrl,
}: {
  t: TenderMRow;
  context: "inbox" | "pipeline";
  owners: OwnerOption[];
  currentUserId: string | null;
  clients: CompanyOption[];
  prospects: CompanyOption[];
  act: ActFn;
  docsWithUrl: number;
}) {
  const isActive = ACTIVE_PIPELINE.has(t.commercial_status);
  const inProgress =
    isActive && t.commercial_status !== "accepted"; // beyond the partner decision

  return (
    <div className="space-y-3">
      <div className="border-b-2 border-neutral-200 pb-1.5 text-[12px] font-bold uppercase tracking-wider text-neutral-800">
        Actions
      </div>

      {/* Hand-over banner (§7) — accepting from the Inbox moves the dossier
          to the Pipeline; make the user FEEL it. */}
      {context === "inbox" && isActive && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2.5">
          <p className="text-[11.5px] font-semibold text-emerald-800">
            ✓ This tender is yours — it now lives in the Tender Pipeline.
          </p>
          <Link
            href="/prospects/pipeline"
            className="mt-1.5 block rounded-md bg-emerald-600 px-3 py-1.5 text-center text-[12px] font-semibold text-white hover:bg-emerald-700"
          >
            Open in Tender Pipeline →
          </Link>
        </div>
      )}

      {/* NEW → qualify: Accept / Reject. */}
      {t.commercial_status === "new" && <QualifyBlock t={t} act={act} />}

      {/* REJECTED → record + overturn. */}
      {t.commercial_status === "rejected" && (
        <div className="rounded-md border border-rose-200 bg-rose-50/70 p-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-rose-700">
            Rejected — {REJECT_REASON_LABEL[t.rejected_reason ?? "other"] ?? t.rejected_reason}
          </div>
          {t.rejected_comment && <p className="mt-1 text-[12px] text-rose-900">{t.rejected_comment}</p>}
          <form action={(fd) => act(acceptTender, fd, "Tender re-accepted")} className="mt-1.5">
            <input type="hidden" name="id" value={t.id} />
            <button className="rounded border border-rose-300 px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-white">
              Overturn — accept tender
            </button>
          </form>
        </div>
      )}

      {needsAction(t) && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-rose-700">
          ⚠ No upcoming next action — plan the next step below.
        </p>
      )}

      {/* ===== PARTNER — Assign Client / Create Prospect (§6). ===== */}
      {t.commercial_status === "accepted" && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-amber-800">
          Next step — assign an existing client, create a new prospect, or mark as
          “Searching partner”.
        </p>
      )}
      {t.type === "open" && isActive && (
        <div className="space-y-1.5">
          <RailLabel>Partner</RailLabel>
          <form action={(fd) => act(attachTender, fd, "Partner attached")} className="flex items-center gap-1.5">
            <input type="hidden" name="id" value={t.id} />
            <select
              name="target"
              defaultValue={
                t.attached_client_id
                  ? `client:${t.attached_client_id}`
                  : t.attached_prospect_id
                    ? `prospect:${t.attached_prospect_id}`
                    : ""
              }
              className={`${smallSelect} min-w-0 flex-1`}
            >
              <option value="">— select a client / prospect —</option>
              <optgroup label="Clients">
                {clients.map((c) => (
                  <option key={c.id} value={`client:${c.id}`}>{c.name}</option>
                ))}
              </optgroup>
              <optgroup label="Prospects">
                {prospects.map((p) => (
                  <option key={p.id} value={`prospect:${p.id}`}>{p.name}</option>
                ))}
              </optgroup>
            </select>
            <button className="rounded border border-neutral-300 px-2 py-1 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50">
              Assign
            </button>
          </form>
          <PartnerOptionsBlock t={t} act={act} />
          {t.attachedName && (
            <p className="text-[11px] text-neutral-500">
              Partner: <b className="text-neutral-800">{t.attachedName}</b>
            </p>
          )}
        </div>
      )}

      {/* ===== QUICK LOG — Log Call / Log Email, one tap (§6). ===== */}
      {inProgress && (
        <div className="space-y-1.5">
          <RailLabel>Quick log</RailLabel>
          <QuickLog t={t} act={act} />
        </div>
      )}

      {/* ===== STATUS & OWNER ===== */}
      {(inProgress || t.commercial_status === "lost" || isActive) && (
        <div className="space-y-1.5">
          <RailLabel>Status & owner</RailLabel>
          <div className="flex flex-wrap items-center gap-2">
            {(inProgress || t.commercial_status === "lost") && (
              <form action={(fd) => act(setTenderCommercialStatus, fd)}>
                <input type="hidden" name="id" value={t.id} />
                <select
                  name="commercial_status"
                  defaultValue={t.commercial_status}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  className={smallSelect}
                >
                  {/* Partner Identified is reached ONLY by attaching a partner;
                      Opportunity Created ONLY by Convert. They stay visible
                      (disabled) when they ARE the current status. */}
                  {Object.entries(COMMERCIAL_STATUS_LABEL)
                    .filter(
                      ([v]) =>
                        (v !== "partner_assigned" && v !== "opportunity_created") ||
                        v === t.commercial_status
                    )
                    .map(([v, l]) => (
                      <option
                        key={v}
                        value={v}
                        disabled={v === "partner_assigned" || v === "opportunity_created"}
                      >
                        {l}
                      </option>
                    ))}
                </select>
              </form>
            )}
            {isActive &&
              (owners.length > 0 ? (
                <form action={(fd) => act(setTenderOwner, fd, "Owner assigned")} className="min-w-0 flex-1">
                  <input type="hidden" name="id" value={t.id} />
                  <select
                    name="owner_id"
                    defaultValue={t.owner_id ?? "__unassign__"}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className={`${smallSelect} w-full`}
                  >
                    <option value="__unassign__">— No owner —</option>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </form>
              ) : (
                currentUserId &&
                t.owner_id !== currentUserId && (
                  <form action={(fd) => act(setTenderOwner, fd, "Assigned to you")}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="owner_id" value={currentUserId} />
                    <button className="rounded border border-neutral-300 px-2 py-1 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50">
                      Assign to me
                    </button>
                  </form>
                )
              ))}
          </div>
        </div>
      )}

      {/* Convert to Opportunity — m111 maturity gate. */}
      {t.commercial_status === "opportunity_created" && t.converted_affair_id ? (
        <Link
          href={`/affairs/${t.converted_affair_id}`}
          className="block rounded-md bg-solux px-3 py-1.5 text-center text-[12px] font-semibold text-white hover:bg-solux-dark"
        >
          Open opportunity →
        </Link>
      ) : ["interested", "project_request"].includes(t.commercial_status) &&
        (t.attached_client_id || t.attached_prospect_id) ? (
        <form
          action={async (fd) => {
            try {
              await createOpportunityFromTender(fd); // lands on the affair
            } catch (e: any) {
              if (isNavError(e)) throw e;
              toast.error(e?.message ?? "Could not create the opportunity.");
            }
          }}
        >
          <input type="hidden" name="id" value={t.id} />
          <button className="w-full rounded-md bg-solux px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-solux-dark">
            Convert to Opportunity →
          </button>
        </form>
      ) : (
        ["waiting_feedback", "interested", "project_request"].includes(t.commercial_status) && (
          <p className="rounded-md border border-dashed border-neutral-300 px-2.5 py-1.5 text-[11px] text-neutral-500">
            🔒 Convert to Opportunity unlocks once a partner is assigned and confirms
            interest (journal: Interested / Quotation requested).
          </p>
        )
      )}

      {/* Create Project Request — same maturity rule as Convert. */}
      {["interested", "project_request"].includes(t.commercial_status) && (
        <Link
          href={`/projects/new?tender=${t.id}`}
          className="block rounded-md bg-neutral-900 px-3 py-1.5 text-center text-[12px] font-semibold text-white hover:bg-black"
        >
          Create Service Request →
        </Link>
      )}

      {/* ===== PLAN NEXT ACTION (§6) ===== */}
      {isActive && (
        <div className="space-y-1.5">
          <RailLabel>Plan next action</RailLabel>
          <NextActionsBlock t={t} act={act} />
        </div>
      )}

      {/* Source + documents shortcuts */}
      {(t.source_url || docsWithUrl > 0) && (
        <div className="space-y-1 border-t border-neutral-200 pt-2">
          {t.source_url && (
            <a
              href={t.source_url}
              target="_blank"
              rel="noreferrer"
              className="block text-[12px] font-semibold text-neutral-700 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
            >
              Open source tender ↗
            </a>
          )}
          {docsWithUrl > 0 && (
            <details>
              <summary className="cursor-pointer text-[12px] font-semibold text-neutral-700 hover:text-neutral-900">
                Download documents ({docsWithUrl})
              </summary>
              <ul className="mt-1 space-y-0.5 pl-3">
                {t.documents
                  .filter((d) => d.url)
                  .map((d, i) => (
                    <li key={i}>
                      <a
                        href={d.url!}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11.5px] text-neutral-600 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
                      >
                        {d.type} · {d.name}
                      </a>
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <form
        action={async (fd) => {
          try {
            await deleteTender(fd);
          } catch (e: any) {
            toast.error(e?.message ?? "Could not delete.");
          }
        }}
        className="border-t border-neutral-200 pt-2"
      >
        <input type="hidden" name="id" value={t.id} />
        <button className="text-[11px] text-neutral-400 hover:text-rose-600">Delete tender</button>
      </form>
    </div>
  );
}

/* ------------------------------ rail primitives ----------------------------- */

/** Tiny uppercase section label — gives the action column the structure
 *  of a premium CRM side panel. */
function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-neutral-200 pt-2.5 text-[9.5px] font-bold uppercase tracking-wider text-neutral-400">
      {children}
    </div>
  );
}

/** Log Call / Log Email — one tap opens a comment box, submit logs the
 *  journal entry (kind pre-set). The journal auto-advances the pipeline
 *  server-side (first contact → Contacted, etc.). */
function QuickLog({ t, act }: { t: TenderMRow; act: ActFn }) {
  const [kind, setKind] = useState<"contact_attempt" | "email_sent" | null>(null);
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setKind(kind === "contact_attempt" ? null : "contact_attempt")}
          className={`flex-1 rounded-md border px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${
            kind === "contact_attempt"
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"
          }`}
        >
          ☎ Log Call
        </button>
        <button
          type="button"
          onClick={() => setKind(kind === "email_sent" ? null : "email_sent")}
          className={`flex-1 rounded-md border px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${
            kind === "email_sent"
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"
          }`}
        >
          ✉ Log Email
        </button>
      </div>
      {kind && (
        <form
          action={async (fd) => {
            await act(addTenderFollowUp, fd, kind === "contact_attempt" ? "Call logged" : "Email logged");
            setKind(null);
          }}
          className="space-y-1.5"
        >
          <input type="hidden" name="tender_id" value={t.id} />
          <input type="hidden" name="kind" value={kind} />
          <textarea
            name="comment"
            required
            autoFocus
            rows={2}
            placeholder={
              kind === "contact_attempt"
                ? "e.g. Called partner — no answer, retry tomorrow…"
                : "e.g. Sent tender documents + technical specs…"
            }
            className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]"
          />
          <div className="flex gap-1.5">
            <button className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
              Log
            </button>
            <button
              type="button"
              onClick={() => setKind(null)}
              className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ------------------------- next actions (rail block) ------------------------ */

function NextActionsBlock({ t, act }: { t: TenderMRow; act: ActFn }) {
  const [adding, setAdding] = useState(false);
  const openActions = t.actions.filter((a) => !a.done_at);
  return (
    <div>
      {openActions.length === 0 && !adding && (
        <p className="text-[12px] font-medium text-rose-700">No next action planned.</p>
      )}
      <ul className="space-y-1">
        {openActions.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="min-w-0 truncate text-neutral-700">
              <span className="text-neutral-400">
                {ACTION_TYPE_OPTIONS.find((o) => o.value === a.action_type)?.label ?? "Action"} ·{" "}
              </span>
              {a.title ?? "—"}
              <span className={a.due_date < todayISO() ? "font-semibold text-rose-700" : "text-neutral-400"}>
                {" "}· {a.due_date}
              </span>
            </span>
            <span className="flex shrink-0 gap-1">
              <form action={(fd) => act(completeTenderNextAction, fd, "Action done")}>
                <input type="hidden" name="id" value={a.id} />
                <button className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-800 hover:bg-neutral-50">
                  ✓
                </button>
              </form>
              <form action={(fd) => act(deleteTenderNextAction, fd)}>
                <input type="hidden" name="id" value={a.id} />
                <button className="rounded px-1 text-[11px] text-neutral-400 hover:text-rose-600">×</button>
              </form>
            </span>
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          action={async (fd) => {
            await act(createTenderNextAction, fd, "Action planned");
            setAdding(false);
          }}
          className="mt-2 space-y-1.5"
        >
          <input type="hidden" name="tender_id" value={t.id} />
          <div className="flex gap-1.5">
            <select name="action_type" className={smallSelect} defaultValue="call">
              {ACTION_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              name="due_date"
              type="date"
              required
              defaultValue={todayISO()}
              className="rounded border border-neutral-200 px-2 py-1 text-[12px]"
            />
          </div>
          <input
            name="title"
            placeholder="e.g. Call partner, Download DAO…"
            className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]"
          />
          <div className="flex gap-1.5">
            <button className="rounded-md bg-solux px-2 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
              Plan
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1.5 rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
        >
          + Plan action
        </button>
      )}
    </div>
  );
}

/* --------------------------- qualification (m110) -------------------------- */

function QualifyBlock({ t, act }: { t: TenderMRow; act: ActFn }) {
  const [rejecting, setRejecting] = useState(false);
  if (rejecting) {
    return (
      <form
        action={async (fd) => {
          await act(rejectTender, fd, "Tender rejected");
          setRejecting(false);
        }}
        className="space-y-1.5 rounded-md border border-rose-200 bg-rose-50/60 p-2.5"
      >
        <input type="hidden" name="id" value={t.id} />
        <select
          name="rejected_reason"
          required
          defaultValue=""
          className="w-full rounded border border-rose-200 bg-white px-2 py-1 text-[12px] text-neutral-800"
        >
          <option value="" disabled>— Rejection reason * —</option>
          {Object.entries(REJECT_REASON_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <textarea
          name="rejected_comment"
          required
          rows={2}
          placeholder="Why are you rejecting this tender? *"
          className="w-full rounded border border-rose-200 bg-white px-2 py-1 text-[12px]"
        />
        <div className="flex gap-1.5">
          <button className="rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700">
            Reject Tender
          </button>
          <button
            type="button"
            onClick={() => setRejecting(false)}
            className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="space-y-1.5">
      <form
        action={(fd) =>
          act(acceptTender, fd, "Tender accepted — it moved to the Tender Pipeline")
        }
      >
        <input type="hidden" name="id" value={t.id} />
        <button className="w-full rounded-md bg-emerald-600 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-emerald-700">
          Accept Tender
        </button>
      </form>
      <button
        type="button"
        onClick={() => setRejecting(true)}
        className="w-full rounded-md border border-rose-300 bg-white px-3 py-2 text-[12.5px] font-semibold text-rose-700 hover:bg-rose-50"
      >
        Reject Tender
      </button>
    </div>
  );
}

/* ------------------- partner options B & C (m110 §4) ----------------------- */

function PartnerOptionsBlock({ t, act }: { t: TenderMRow; act: ActFn }) {
  const [creating, setCreating] = useState(false);
  const input = "w-full rounded border border-neutral-200 px-2 py-1 text-[12px]";
  return (
    <div className="space-y-1.5">
      {creating ? (
        <form
          action={async (fd) => {
            await act(createPartnerAndAttach, fd, "Partner created & attached");
            setCreating(false);
          }}
          className="space-y-1.5 rounded-md border border-neutral-200 bg-white p-2.5"
        >
          <input type="hidden" name="tender_id" value={t.id} />
          <input name="company_name" required placeholder="Company name *" className={input} />
          <div className="flex gap-1.5">
            <input name="country" placeholder="Country" className={input} />
            <input name="contact_name" placeholder="Contact name" className={input} />
          </div>
          <div className="flex gap-1.5">
            <input name="email" type="email" placeholder="Email" className={input} />
            <input name="phone" placeholder="Phone" className={input} />
          </div>
          <input name="notes" placeholder="Notes" className={input} />
          <div className="flex gap-1.5">
            <button className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
              Create & attach
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            + Create New Prospect
          </button>
          {t.commercial_status !== "searching_partner" && (
            <form
              action={(fd) => act(markTenderSearchingPartner, fd, "Marked as searching partner")}
              className="flex-1"
            >
              <input type="hidden" name="id" value={t.id} />
              <button className="w-full rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100">
                Searching partner
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------- follow-up form (m110 §6) --------------------------- */

function FollowupForm({
  t,
  act,
  alwaysOpen = false,
}: {
  t: TenderMRow;
  act: ActFn;
  alwaysOpen?: boolean;
}) {
  const [adding, setAdding] = useState(alwaysOpen);
  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mb-2 rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-50"
      >
        + Log follow-up
      </button>
    );
  }
  return (
    <form
      action={async (fd) => {
        await act(addTenderFollowUp, fd, "Follow-up logged");
        if (!alwaysOpen) setAdding(false);
      }}
      className="mb-2 space-y-1.5 rounded-md border border-neutral-200 bg-neutral-50/60 p-2.5"
    >
      <input type="hidden" name="tender_id" value={t.id} />
      <select name="kind" className={smallSelect} defaultValue="contact_attempt">
        {FOLLOWUP_FORM_KINDS.map((v) => (
          <option key={v} value={v}>{FOLLOWUP_KIND_LABEL[v]}</option>
        ))}
      </select>
      <textarea
        name="comment"
        required
        rows={2}
        placeholder="e.g. Called partner — no answer · Email sent, tender documents shared · Interested, meeting planned…"
        className="w-full rounded border border-neutral-200 px-2 py-1 text-[12px]"
      />
      <div className="flex gap-1.5">
        <button className="rounded-md bg-solux px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
          Log follow-up
        </button>
        {!alwaysOpen && (
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/* --------------------------- participants block ---------------------------- */

function ParticipantsBlock({ tender, act }: { tender: TenderMRow; act: ActFn }) {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      {tender.participants.length === 0 && !adding && (
        <p className="text-[12px] text-neutral-400">
          Who won? Who bid? Each company here is a hot lead — promote it to a prospect.
        </p>
      )}
      <ul className="space-y-1">
        {tender.participants.map((pp) => (
          <li key={pp.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span className="min-w-0">
              <span className="font-medium text-neutral-800">{pp.company_name}</span>
              {pp.is_winner && (
                <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  Winner
                </span>
              )}
              <span className="text-neutral-400">
                {pp.bid_value != null ? ` · ${pp.bid_value.toLocaleString()}` : ""}
                {pp.notes ? ` · ${pp.notes}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {pp.promoted_prospect_id ? (
                <span className="text-[11px] text-neutral-400">→ prospect created</span>
              ) : (
                <form action={(fd) => act(promoteParticipantToProspect, fd, `"${pp.company_name}" promoted`)}>
                  <input type="hidden" name="id" value={pp.id} />
                  <button className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-white">
                    Promote to prospect
                  </button>
                </form>
              )}
              <form action={(fd) => act(deleteTenderParticipant, fd)}>
                <input type="hidden" name="id" value={pp.id} />
                <button className="rounded px-1 text-[11px] text-neutral-400 hover:text-rose-600">×</button>
              </form>
            </span>
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          action={async (fd) => {
            await act(addTenderParticipant, fd);
            setAdding(false);
          }}
          className="mt-2 flex flex-wrap items-end gap-1.5"
        >
          <input type="hidden" name="tender_id" value={tender.id} />
          <input
            name="company_name"
            required
            placeholder="Company *"
            className="min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1 text-[12px]"
          />
          <input
            name="bid_value"
            type="number"
            min={0}
            placeholder="Bid"
            className="w-24 rounded border border-neutral-200 px-2 py-1 text-[12px]"
          />
          <input
            name="notes"
            placeholder="Why won / excluded"
            className="min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1 text-[12px]"
          />
          <label className="flex items-center gap-1 text-[11px] text-neutral-600">
            <input type="checkbox" name="is_winner" /> Winner
          </label>
          <button className="rounded-md bg-solux px-2 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
            Add
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1.5 rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-800 hover:bg-white"
        >
          + Add participant
        </button>
      )}
    </div>
  );
}
