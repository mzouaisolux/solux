"use client";

// =====================================================================
// TENDER WORKSPACE (Discovery V2) — the prospecting workspace page.
//
// HubSpot-deal feel, SOLUX design system: hero header → KPI cards →
// opportunity intelligence → project info → 🏆 winner → participants as
// CRM cards (status badges) → documents → activity timeline. Prospect
// creation goes through the PROSPECTING ASSISTANT (guided filters),
// never a blind "create all".
//
// Role separation unchanged: assignment = management (server-enforced),
// tasks/prospects/contacts = everyone with prospect.access.
// =====================================================================

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  setTenderOwner,
  setParticipantOwner,
  promoteParticipantToProspect,
  createProspectsForTender,
  createTenderNextAction,
} from "@/app/(app)/prospects/actions";
import { normalizeCompanyKey, PROSPECT_STATUS_LABEL } from "@/lib/prospect-intel";
import { CompanyDrawer, type ProspectRow } from "@/components/prospects/ProspectsPanel";
import type {
  ProspectTenderHistoryRow,
  ProspectActivityRow,
} from "@/app/(app)/prospects/tenders-data";
import {
  tenderUsd,
  fmtUsd,
  funderOf,
  projectPriorityScore,
  opportunityTier,
  FUNDER_LABEL,
} from "@/lib/tender-discovery";
import { findCountry } from "@/lib/countries";
import { toast } from "@/components/feedback/toast-store";

type OwnerOpt = { id: string; name: string };
type CrmRef = { prospectId: string; status: string } | null;

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */

function flagFor(country: string | null | undefined): string {
  const code = findCountry(country ?? null)?.code;
  if (!code || code.length !== 2) return "🌍";
  const A = 0x1f1e6;
  return String.fromCodePoint(A + (code.charCodeAt(0) - 65), A + (code.charCodeAt(1) - 65));
}

function fmtD(iso: string | null | undefined): string {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

const TIER_STYLE: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  medium: "bg-amber-50 text-amber-800 ring-amber-200",
  low: "bg-neutral-100 text-neutral-500 ring-neutral-200",
};

const CRM_BADGE: Record<string, string> = {
  new: "bg-sky-50 text-sky-700 ring-sky-200",
  assigned: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  contacted: "bg-amber-50 text-amber-700 ring-amber-200",
  lead: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  opportunity: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  customer: "bg-neutral-900 text-white ring-neutral-900",
  rejected: "bg-neutral-100 text-neutral-400 ring-neutral-200",
  blacklisted: "bg-rose-50 text-rose-600 ring-rose-200",
};

function crmBadge(ref: CrmRef): { label: string; cls: string } {
  if (!ref) {
    return { label: "Not created", cls: "bg-neutral-50 text-neutral-400 ring-neutral-200" };
  }
  const label =
    PROSPECT_STATUS_LABEL[ref.status as keyof typeof PROSPECT_STATUS_LABEL] ?? ref.status;
  return { label, cls: CRM_BADGE[ref.status] ?? CRM_BADGE.new };
}

/* ------------------------------------------------------------------ */
/* workspace                                                            */
/* ------------------------------------------------------------------ */

export function TenderWorkspace({
  tender: t,
  participants,
  crmByParticipant,
  actions,
  timeline,
  owners,
  ownerLabels,
  canAssign,
  prospectsById,
  historyByProspect,
  activitiesByProspect,
}: {
  tender: any;
  participants: any[];
  crmByParticipant: Record<string, CrmRef>;
  actions: any[];
  timeline: Array<{ at: string; label: string }>;
  owners: OwnerOpt[];
  ownerLabels: Record<string, string>;
  canAssign: boolean;
  /** In-place company profile (owner request 2026-06-13: opening a
   *  profile must NOT throw the user back to the companies list). */
  prospectsById: Record<string, any>;
  historyByProspect: Record<string, ProspectTenderHistoryRow[]>;
  activitiesByProspect: Record<string, ProspectActivityRow[]>;
}) {
  const router = useRouter();
  const [addingTask, setAddingTask] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [openCompanyId, setOpenCompanyId] = useState<string | null>(null);
  const openCompany = openCompanyId ? prospectsById[openCompanyId] ?? null : null;

  // A v2 multi-lot tender has MANY winners (one per lot) — all is_winner.
  // Show them all, not just the first (ZEROX/TOMBEL bug 2026-06-16).
  const winners = participants.filter((p) => p.is_winner);
  const others = participants.filter((p) => !p.is_winner);
  const contacts = participants.filter((p) => p.email || p.phone).length;
  const prospectsCreated = participants.filter((p) => crmByParticipant[p.id]).length;
  const { usd, exact: usdExact } = tenderUsd(t);
  const funder = funderOf(t.buyer);
  const tier = opportunityTier(
    projectPriorityScore({
      usd,
      funder,
      hasWinner: winners.length > 0,
      participantsCount: participants.length,
      contactsCount: contacts,
      relevanceScore: t.score != null ? Number(t.score) : null,
    })
  );

  // m107 stores source documents as a jsonb array — shapes vary by tool.
  const documents: Array<{ name: string; url: string | null }> = useMemo(() => {
    const raw = Array.isArray(t.documents) ? t.documents : [];
    return raw
      .map((d: any) => {
        if (typeof d === "string") return { name: d.split("/").pop() ?? d, url: d };
        if (d && typeof d === "object") {
          const url = d.url ?? d.lien ?? d.link ?? d.href ?? null;
          const name = d.name ?? d.nom ?? d.titre ?? d.title ?? url ?? "Document";
          return { name: String(name), url: url ? String(url) : null };
        }
        return null;
      })
      .filter(Boolean) as Array<{ name: string; url: string | null }>;
  }, [t.documents]);

  const openTasks = actions.filter((a) => !a.done_at);

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-5">
      {/* ================= SECTION 1 — HERO ================= */}
      <div>
        <Link
          href="/prospects?u=prospects&p=projects"
          className="text-[12px] text-neutral-500 hover:text-neutral-900"
        >
          ← Back to projects
        </Link>
        <div className="mt-2 rounded-2xl border border-neutral-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
                <span className="text-2xl leading-none">{flagFor(t.country)}</span>
                <span className="font-semibold text-neutral-800">{t.country ?? "—"}</span>
                <span className="text-neutral-400">·</span>
                <span className="font-semibold text-neutral-800">
                  🏦 {funder === "unknown" && t.buyer ? t.buyer : FUNDER_LABEL[funder]}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ring-1 ${TIER_STYLE[tier.tier]}`}
                >
                  {tier.tier === "high" ? "🟢" : tier.tier === "medium" ? "🟡" : "⚪"}{" "}
                  {tier.label}
                </span>
              </div>
              <h1 className="mt-2 max-w-3xl text-2xl font-bold leading-snug tracking-tight text-neutral-900">
                {t.title ?? "—"}
              </h1>
              <div className="mt-2 flex flex-wrap items-baseline gap-3">
                <span className="text-3xl font-bold tabular-nums tracking-tight text-neutral-900">
                  {fmtUsd(usd)}
                </span>
                {t.budget_usd != null && (
                  <span className="text-[13px] tabular-nums text-neutral-400">
                    {Number(t.budget_usd).toLocaleString()} {t.currency ?? ""}
                    {usd != null && !usdExact ? " · estimated" : ""}
                  </span>
                )}
                <span className="text-[12px] text-neutral-500">
                  Published {fmtD(t.publication_date)}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {canAssign ? (
                <form
                  action={async (fd) => {
                    try {
                      await setTenderOwner(fd);
                      toast.success("Project assigned");
                      router.refresh();
                    } catch (e: any) {
                      toast.error(e?.message ?? "Could not assign.");
                    }
                  }}
                >
                  <input type="hidden" name="id" value={t.id} />
                  <select
                    name="owner_id"
                    defaultValue={t.owner_id ?? "__unassign__"}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                    className="rounded-md border border-neutral-200 px-2 py-1.5 text-[12px]"
                  >
                    <option value="__unassign__">Assign owner…</option>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </form>
              ) : (
                <span className="text-[12px] text-neutral-500">
                  Owner:{" "}
                  <b className="text-neutral-800">
                    {t.owner_id ? ownerLabels[t.owner_id] ?? "assigned" : "unassigned"}
                  </b>
                </span>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAddingTask((v) => !v)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  + Create task
                </button>
                <button
                  type="button"
                  onClick={() => setAssistantOpen(true)}
                  className="rounded-md bg-solux px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-solux-dark"
                >
                  ✨ Prospecting Assistant
                </button>
                {t.source_url && (
                  <a
                    href={t.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50"
                  >
                    Open source ↗
                  </a>
                )}
              </div>
            </div>
          </div>

          {addingTask && (
            <form
              action={async (fd) => {
                try {
                  await createTenderNextAction(fd);
                  toast.success("Task created — it shows up in the morning to-do");
                  setAddingTask(false);
                  router.refresh();
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not create the task.");
                }
              }}
              className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2"
            >
              <input type="hidden" name="tender_id" value={t.id} />
              <select name="action_type" className="rounded border border-neutral-200 px-1.5 py-1 text-[12px]">
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="follow_up">Follow up</option>
                <option value="other">Other</option>
              </select>
              <input
                name="title"
                placeholder="e.g. Call the winner about supply"
                className="min-w-[200px] flex-1 rounded border border-neutral-200 px-2 py-1 text-[12px]"
              />
              <input type="date" name="due_date" required className="rounded border border-neutral-200 px-2 py-1 text-[12px]" />
              <button className="rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-neutral-800">
                Create
              </button>
            </form>
          )}
        </div>
      </div>

      {/* ================= SECTION 2 — KPI CARDS ================= */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(
          [
            ["Amount", fmtUsd(usd)],
            ["Participants", String(participants.length)],
            ["Winner", winners.length === 0 ? "—" : winners.length === 1 ? winners[0].company_name : `${winners.length} winners`],
            ["Contacts found", String(contacts)],
            ["Prospects created", String(prospectsCreated)],
            ["Imported", fmtD(t.imported_at ?? t.created_at)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
            <div className="truncate text-lg font-bold tabular-nums text-neutral-900" title={value}>
              {value}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ============ SECTION 3 — OPPORTUNITY INTELLIGENCE ============ */}
        <section
          className={`rounded-2xl border p-5 ${
            tier.tier === "high"
              ? "border-emerald-200 bg-emerald-50/40"
              : tier.tier === "medium"
                ? "border-amber-200 bg-amber-50/40"
                : "border-neutral-200 bg-white"
          }`}
        >
          <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            Opportunity intelligence
          </div>
          <div className="mt-1 text-lg font-bold text-neutral-900">
            {tier.tier === "high"
              ? "HIGH VALUE OPPORTUNITY"
              : tier.tier === "medium"
                ? "Medium value opportunity"
                : "Low prospecting value"}
          </div>
          <ul className="mt-3 space-y-1.5 text-[13px] text-neutral-700">
            {funder !== "unknown" && <li>✔ {FUNDER_LABEL[funder]} funded</li>}
            {participants.length > 0 && <li>✔ {participants.length} companies identified</li>}
            {winners.length > 0 && <li>✔ {winners.length === 1 ? "Winner identified" : `${winners.length} winners identified`}</li>}
            {contacts > 0 && <li>✔ Contact information found ({contacts})</li>}
            {others.length >= 2 && <li>✔ Multiple prospecting targets available</li>}
            {contacts === 0 && <li className="text-amber-700">⚠ No contacts in the file — enrich manually</li>}
          </ul>
          <div className="mt-4 border-t border-neutral-200/70 pt-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              Recommended next steps
            </div>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13px] text-neutral-700">
              {!t.owner_id && <li>Assign a sales owner</li>}
              {prospectsCreated === 0 && participants.length > 0 && (
                <li>Create prospects (use the Prospecting Assistant)</li>
              )}
              {openTasks.length === 0 && <li>Plan the first outreach task</li>}
              {contacts > 0 && <li>Launch outreach — {contacts} direct contacts available</li>}
              {t.owner_id && prospectsCreated > 0 && openTasks.length > 0 && (
                <li>Follow up on the {openTasks.length} open task{openTasks.length > 1 ? "s" : ""}</li>
              )}
            </ol>
          </div>
        </section>

        {/* ============ SECTION 4 — PROJECT INFORMATION ============ */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            Project information
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
            <Info label="Buyer" value={t.buyer} />
            <Info label="Funder" value={FUNDER_LABEL[funder]} />
            <Info label="Country" value={t.country} />
            <Info
              label="Original amount"
              value={
                t.budget_usd != null
                  ? `${Number(t.budget_usd).toLocaleString()} ${t.currency ?? ""}`
                  : null
              }
            />
            <Info label="Published" value={fmtD(t.publication_date)} />
            <Info label="Imported" value={fmtD(t.imported_at ?? t.created_at)} />
            <Info
              label="Owner"
              value={t.owner_id ? ownerLabels[t.owner_id] ?? "assigned" : "Unassigned"}
            />
            <Info label="Relevance score" value={t.score != null ? String(t.score) : t.relevance} />
          </div>
        </section>

        {/* ============ SECTION 8 — ACTIVITY TIMELINE ============ */}
        <section className="rounded-2xl border border-neutral-200 bg-white p-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            Activity timeline
          </div>
          {timeline.length === 0 ? (
            <p className="mt-3 text-[12px] text-neutral-400">No activity yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 border-l-2 border-neutral-100 pl-4">
              {timeline.map((e, i) => (
                <li key={i} className="relative text-[12px]">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-neutral-300" />
                  <span className="tabular-nums text-neutral-400">{fmtD(e.at)}</span>{" "}
                  <span className="text-neutral-700">{e.label}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ================= SECTION 5 — WINNER ================= */}
      <section className="rounded-2xl border border-emerald-200 bg-white p-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
          🏆 {winners.length > 1 ? `Winners (${winners.length})` : "Winner"}
        </div>
        {winners.length === 0 ? (
          <p className="mt-2 text-[12px] text-neutral-400">No winner recorded in the file.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {winners.map((w) => (
              <div key={w.id}>
                {w.lot_number && (
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    Lot {w.lot_number}
                  </div>
                )}
                <CompanyCard
                  part={w}
                  crm={crmByParticipant[w.id]}
                  owners={owners}
                  ownerLabels={ownerLabels}
                  canAssign={canAssign}
                  onOpenProfile={(pid) => setOpenCompanyId(pid)}
                  highlight
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ================= SECTION 6 — PARTICIPANTS ================= */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            Participants ({others.length}) — future prospects
          </div>
          <span className="text-[11px] text-neutral-400">
            {participants.length} companies total · {contacts} with contacts
          </span>
        </div>
        {others.length === 0 ? (
          <p className="mt-2 text-[12px] text-neutral-400">No other participants recorded.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {others.map((p) => (
              <CompanyCard
                key={p.id}
                part={p}
                crm={crmByParticipant[p.id]}
                owners={owners}
                ownerLabels={ownerLabels}
                canAssign={canAssign}
                onOpenProfile={(pid) => setOpenCompanyId(pid)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ================= SECTION 7 — DOCUMENTS ================= */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
          Documents &amp; sources
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {t.source_url && (
            <a
              href={t.source_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50"
            >
              🔗 Official notice
            </a>
          )}
          {t.j360_url && (
            <a
              href={t.j360_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50"
            >
              🔗 J360 project page
            </a>
          )}
          {documents.map((d, i) =>
            d.url ? (
              <a
                key={i}
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50"
              >
                📄 {d.name}
              </a>
            ) : (
              <span
                key={i}
                className="rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-500"
              >
                📄 {d.name}
              </span>
            )
          )}
          {!t.source_url && !t.j360_url && documents.length === 0 && (
            <p className="text-[12px] text-neutral-400">No documents attached to this tender.</p>
          )}
        </div>
      </section>

      {/* ---- in-place company profile (stays on THIS project) ---- */}
      {openCompany && (
        <CompanyDrawer
          key={openCompany.id}
          prospect={openCompany as ProspectRow}
          owners={owners}
          ownerLabels={ownerLabels}
          others={[]}
          history={historyByProspect[openCompany.id] ?? []}
          activities={activitiesByProspect[openCompany.id] ?? []}
          onClose={() => setOpenCompanyId(null)}
        />
      )}

      {/* ============ SECTION 9 — PROSPECTING ASSISTANT (modal) ============ */}
      {assistantOpen && (
        <ProspectingAssistant
          tenderId={t.id}
          participants={participants}
          crmByParticipant={crmByParticipant}
          onClose={() => setAssistantOpen(false)}
        />
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-400">{label}</div>
      <div className="break-words text-neutral-800">
        {value && String(value).trim() ? value : "—"}
      </div>
    </div>
  );
}

/* ===================================================================== */
/* Company card — CRM status, contacts, actions                          */
/* ===================================================================== */

function CompanyCard({
  part: p,
  crm,
  owners,
  ownerLabels,
  canAssign,
  onOpenProfile,
  highlight = false,
}: {
  part: any;
  crm: CrmRef;
  owners: OwnerOpt[];
  ownerLabels: Record<string, string>;
  canAssign: boolean;
  /** Opens the company profile drawer ON the project page. */
  onOpenProfile: (prospectId: string) => void;
  highlight?: boolean;
}) {
  const router = useRouter();
  const badge = crmBadge(crm);

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        highlight ? "border-emerald-200 bg-emerald-50/30" : "border-neutral-200 bg-neutral-50/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-neutral-900" title={p.company_name}>
            {highlight ? "🏆 " : ""}
            {p.company_name}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className={`rounded px-1.5 py-0.5 font-bold uppercase ring-1 ${badge.cls}`}>
              {badge.label}
            </span>
            <span className="text-neutral-400">
              {p.is_winner ? "Winner" : "Participant"}
              {p.country ? ` · ${p.country}` : ""}
            </span>
          </div>
        </div>
        {canAssign ? (
          <form
            className="shrink-0"
            action={async (fd) => {
              try {
                await setParticipantOwner(fd);
                toast.success(`${p.company_name} assigned`);
                router.refresh();
              } catch (e: any) {
                toast.error(e?.message ?? "Could not assign.");
              }
            }}
          >
            <input type="hidden" name="id" value={p.id} />
            <select
              name="owner_id"
              defaultValue={p.owner_id ?? "__unassign__"}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="max-w-[120px] rounded border border-neutral-200 px-1 py-0.5 text-[11px] text-neutral-700"
            >
              <option value="__unassign__">Assign…</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </form>
        ) : (
          p.owner_id && (
            <span className="shrink-0 text-[11px] text-neutral-500">
              → {ownerLabels[p.owner_id] ?? "assigned"}
            </span>
          )
        )}
      </div>

      <div className="mt-2 space-y-0.5 text-[12px] text-neutral-600">
        {p.manager_name && <div>👤 {p.manager_name}</div>}
        {p.email ? (
          <a href={`mailto:${p.email}`} className="block truncate text-neutral-700 underline underline-offset-2">
            📧 {p.email}
          </a>
        ) : (
          <div className="text-neutral-400">📧 No email</div>
        )}
        {p.phone ? (
          <a href={`tel:${p.phone}`} className="block text-neutral-700 underline underline-offset-2">
            📞 {p.phone}
          </a>
        ) : (
          <div className="text-neutral-400">📞 No phone</div>
        )}
        {p.address && <div className="truncate text-neutral-500" title={p.address}>📍 {p.address}</div>}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        {crm ? (
          <button
            type="button"
            onClick={() => onOpenProfile(crm.prospectId)}
            className="rounded-md border border-neutral-300 px-2 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-white"
          >
            Open profile →
          </button>
        ) : (
          <form
            action={async (fd) => {
              try {
                await promoteParticipantToProspect(fd);
                toast.success(`${p.company_name} is now a prospect`);
                router.refresh();
              } catch (e: any) {
                toast.error(e?.message ?? "Could not create the prospect.");
              }
            }}
          >
            <input type="hidden" name="id" value={p.id} />
            <button className="rounded-md bg-solux px-2 py-1 text-[11px] font-semibold text-white hover:bg-solux-dark">
              Create prospect
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ===================================================================== */
/* Prospecting Assistant — guided, mistake-proof prospect creation       */
/* ===================================================================== */

function ProspectingAssistant({
  tenderId,
  participants,
  crmByParticipant,
  onClose,
}: {
  tenderId: string;
  participants: any[];
  crmByParticipant: Record<string, CrmRef>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [includeParticipants, setIncludeParticipants] = useState(true);
  const [includeWinner, setIncludeWinner] = useState(false);
  const [requireEmail, setRequireEmail] = useState(false);
  const [requirePhone, setRequirePhone] = useState(false);
  const [includeExisting, setIncludeExisting] = useState(false);
  const [busy, setBusy] = useState(false);

  // Live preview — the SAME filter logic the server applies.
  const count = useMemo(() => {
    return participants
      .filter((p) => (p.is_winner ? includeWinner : includeParticipants))
      .filter((p) => {
        if (!requireEmail && !requirePhone) return true;
        return (requireEmail && p.email) || (requirePhone && p.phone);
      })
      .filter((p) => includeExisting || !crmByParticipant[p.id]).length;
  }, [participants, crmByParticipant, includeParticipants, includeWinner, requireEmail, requirePhone, includeExisting]);

  async function run() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("tender_id", tenderId);
      fd.set("scope", "custom");
      if (includeWinner) fd.set("include_winner", "on");
      if (includeParticipants) fd.set("include_participants", "on");
      if (requireEmail) fd.set("require_email", "on");
      if (requirePhone) fd.set("require_phone", "on");
      if (includeExisting) fd.set("include_existing", "on");
      await createProspectsForTender(fd);
      toast.success(`${count} prospect${count === 1 ? "" : "s"} created`);
      onClose();
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create prospects.");
    } finally {
      setBusy(false);
    }
  }

  const box = (
    checked: boolean,
    set: (v: boolean) => void,
    label: string,
    hint?: string
  ) => (
    <label className="flex items-start gap-2 rounded-lg border border-neutral-200 px-3 py-2 hover:bg-neutral-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => set(e.target.checked)}
        className="mt-0.5"
      />
      <span className="text-[13px] text-neutral-800">
        {label}
        {hint && <span className="block text-[11px] text-neutral-400">{hint}</span>}
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">✨ Prospecting Assistant</h2>
            <p className="mt-0.5 text-[12px] text-neutral-500">
              Choose which companies become prospects — deduplicated, never blind.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-200 px-2 py-1 text-[12px] text-neutral-600 hover:bg-neutral-50"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {box(includeParticipants, setIncludeParticipants, "Participants", "the losing bidders — your warmest targets")}
          {box(includeWinner, setIncludeWinner, "Winner", "they just won — different pitch")}
          {box(requireEmail, setRequireEmail, "Only companies with email")}
          {box(requirePhone, setRequirePhone, "Only companies with phone")}
          {box(includeExisting, setIncludeExisting, "Include companies already in the CRM", "off = skip them (recommended)")}
        </div>

        <button
          type="button"
          disabled={busy || count === 0}
          onClick={run}
          className="mt-4 w-full rounded-lg bg-solux px-3 py-2 text-sm font-bold text-white hover:bg-solux-dark disabled:opacity-50"
        >
          {busy ? "Creating…" : `Create ${count} prospect${count === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
