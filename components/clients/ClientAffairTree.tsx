"use client";

// =====================================================================
// Clients drill-down — Client → Affair → Quotation versions.
// Premium skin (validated clients mockup). Operational status is owned by the
// AFFAIR; each version owns its commercial status. Logic/data unchanged — this
// is a presentational rebuild over the same ClientAffairs model.
// =====================================================================

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AffairVersionsTable } from "@/components/affairs/AffairVersionsTable";
import {
  AffairProgressStrip,
  affairOperationalStatus,
} from "@/components/affairs/AffairProgressStrip";
import { Collapse } from "@/components/ui/Collapse";
import {
  formatMoney,
  type ClientAffairs,
  type AffairGroup,
} from "@/lib/affairs-prototype";

const DEAD = new Set(["lost", "abandoned", "archived"]);
function isActiveAffair(a: AffairGroup): boolean {
  if (a.isArchived) return false;
  if (a.effectiveStatus === "lost" || a.effectiveStatus === "cancelled")
    return false;
  if (a.lifecycleStatus && DEAD.has(a.lifecycleStatus)) return false;
  return true;
}

/** Per-currency value total over a set of affairs (no FX). */
function valueChips(affairs: AffairGroup[]): string {
  const byCur = new Map<string, number>();
  for (const a of affairs) {
    if (!a.totalValue) continue;
    const cur = (a.currency || "USD").toUpperCase();
    byCur.set(cur, (byCur.get(cur) ?? 0) + a.totalValue);
  }
  if (byCur.size === 0) return "—";
  return Array.from(byCur.entries())
    .sort((x, y) => y[1] - x[1])
    .map(([cur, total]) => formatMoney(total, cur))
    .join(" · ");
}

const STAGES = [
  "Quote",
  "Task list",
  "Payment",
  "Production",
  "Shipping",
  "Delivery",
] as const;

/** Best-effort current stage (0-5) for the seg-bar + label. Reuses the
 *  affair's existing lifecycle/effective status — no new calculation. */
function stageOf(a: AffairGroup): number {
  const s = `${a.lifecycleStatus ?? ""} ${a.effectiveStatus ?? ""}`.toLowerCase();
  if (/deliver/.test(s)) return 5;
  if (/ship/.test(s)) return 4;
  if (/production|delayed|completed|manufactur/.test(s)) return 3;
  if (/deposit|payment|paid|balance/.test(s)) return 2;
  if (/task|validated|production_ready|in_review|under_validation/.test(s))
    return 1;
  return 0;
}

/** Commercial status chip styling. */
function commercialChip(a: AffairGroup): { label: string; cls: string } {
  const s = (a.effectiveStatus ?? "draft").toLowerCase();
  if (s === "won") return { label: "Won", cls: "sent" };
  if (s === "sent" || s === "negotiating") return { label: "Sent", cls: "sent" };
  if (s === "lost" || s === "cancelled") return { label: "Lost", cls: "" };
  return { label: "Draft", cls: "on" };
}

/** Live commercial stages — the "no deal sleeps" golden rule applies. */
const GOLDEN_RULE_STATUSES = new Set([
  "lead", "tender_review", "partner_selection", "opportunity", "quotation", "negotiation",
]);

export function ClientAffairTree({
  clients,
  openActionAffairIds,
}: {
  clients: ClientAffairs[];
  /** affairs.id set with at least one OPEN planned action (golden-rule
   *  enforcement in lists — Phase 2). Omitted = indicator hidden. */
  openActionAffairIds?: string[];
}) {
  const openActionSet = useMemo(
    () => new Set(openActionAffairIds ?? []),
    [openActionAffairIds]
  );
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((c) =>
      [c.clientName, c.clientCode, c.country, c.contactName]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(term))
    );
  }, [clients, q]);

  return (
    <div>
      <div className="cli-search" style={{ marginBottom: 18 }}>
        <SearchIcon />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients — name, code, country, contact…"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="panel p-12 text-center text-sm text-neutral-500">
          No clients with projects match.
        </p>
      ) : (
        filtered.map((c) => (
          <ClientNode key={c.clientId ?? "unlinked"} client={c} openActionSet={openActionSet} />
        ))
      )}
    </div>
  );
}

function ClientNode({
  client,
  openActionSet,
}: {
  client: ClientAffairs;
  openActionSet: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const activeAffairs = client.affairs.filter(isActiveAffair);
  const activeCount = activeAffairs.length;
  const value = valueChips(activeAffairs);
  const loc =
    [client.country, client.contactName].filter(Boolean).join(" · ") || "—";

  return (
    <div className="cli-client">
      <div
        className="cli-client-head"
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <ChevronDown className={`cli-chev ${open ? "" : "closed"}`} />
        <div className="cli-cid">
          <div className="top">
            <span className="cli-name">{client.clientName}</span>
            {client.clientCode && (
              <span className="cli-code">{client.clientCode}</span>
            )}
          </div>
          <span className="cli-loc">{loc}</span>
        </div>
        <div className="cli-stats">
          <div className="cstat">
            <div className="v">
              {activeCount}/{client.affairCount}
            </div>
            <div className="k">active affairs</div>
          </div>
          <div className="cstat">
            <div className="v green">{value}</div>
            <div className="k">portfolio value</div>
          </div>
          <Link
            href={client.clientId ? `/clients/${client.clientId}` : "/clients"}
            className="cli-open"
            onClick={(e) => e.stopPropagation()}
          >
            Open Client Hub →
          </Link>
        </div>
      </div>

      <Collapse open={open}>
        <div className="cli-affairs">
          {client.affairs.length === 0 ? (
            <p className="px-6 py-4 text-[12px] text-neutral-500">
              No projects yet for this client.
            </p>
          ) : (
            <>
              <div className="cli-colhead">
                <span>Affair</span>
                <span>Production stage</span>
                <span>Status &amp; next action</span>
                <span className="right">Amount</span>
                <span className="right h-ver">Ver.</span>
              </div>
              {client.affairs.map((a) => (
                <AffairNode key={a.anchorId} affair={a} openActionSet={openActionSet} />
              ))}
            </>
          )}
        </div>
      </Collapse>
    </div>
  );
}

function AffairNode({
  affair,
  openActionSet,
}: {
  affair: AffairGroup;
  openActionSet: Set<string>;
}) {
  // Golden rule (Phase 2, enforced in LISTS too): a live deal with no
  // open planned action is flagged red right on the row.
  const sleeping =
    affair.isRealAffair &&
    !!affair.affairId &&
    !affair.isArchived &&
    GOLDEN_RULE_STATUSES.has(affair.lifecycleStatus ?? "") &&
    !openActionSet.has(affair.affairId);
  const [open, setOpen] = useState(false);
  const op = affairOperationalStatus(affair);
  const stage = stageOf(affair);
  const cc = commercialChip(affair);
  const amount = affair.totalValue
    ? formatMoney(affair.totalValue, affair.currency)
    : "—";
  const docCount = affair.documents.length;

  return (
    <div className={`cli-affair ${open ? "open" : ""}`}>
      <div
        className="cli-affair-row"
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        {/* col 1 — name */}
        <div className="cli-aname">
          <ChevronRight className="cli-achev" />
          <span className="nm">{affair.displayName}</span>
        </div>
        {/* col 2 — stage */}
        <div className="cli-stage">
          <div className="cli-stage-label">
            <span className="cli-badge-stage">{STAGES[stage]}</span> Stage{" "}
            {stage + 1} / 6
          </div>
          <div className="cli-segbar">
            {STAGES.map((_, i) => (
              <i
                key={i}
                className={i < stage ? "done" : i === stage ? "now" : ""}
              />
            ))}
          </div>
        </div>
        {/* col 3 — commercial status + next */}
        <div className="cli-astatus">
          <div className="cli-chips">
            <span className={`cli-chip ${cc.cls}`}>{cc.label}</span>
            <span className="cli-chip">{op.label}</span>
          </div>
          {affair.nextAction && (
            <div className="cli-next">
              <span className="arr">→</span> Next: <b>{affair.nextAction}</b>
            </div>
          )}
          {sleeping && (
            <Link
              href={`/affairs/${affair.affairId}`}
              onClick={(e) => e.stopPropagation()}
              className="cli-next"
              style={{ color: "#be123c", fontWeight: 600 }}
              title="Every live deal needs a next action with a date — plan it."
            >
              ⚠ No next action — plan one →
            </Link>
          )}
        </div>
        {/* col 4 — amount */}
        <div className="cli-amount">
          <div className="amt">{amount}</div>
          <div className="cur">{(affair.currency || "USD").toUpperCase()}</div>
        </div>
        {/* col 5 — versions */}
        <div className="cli-ver">
          <span className="cli-verbadge" title={`${docCount} version(s)`}>
            <FileIcon />
            {docCount}
          </span>
        </div>
      </div>

      <Collapse open={open}>
        <div className="cli-detail">
          <AffairProgressStrip affair={affair} />
          <AffairVersionsTable affair={affair} />
          <div className="flex justify-end mt-2">
            {affair.affairId ? (
              <Link
                href={`/affairs/${affair.affairId}`}
                className="cli-open"
                title="Editing · production · shipping · documents"
              >
                Manage affair →
              </Link>
            ) : affair.latest ? (
              <Link href={`/documents/${affair.latest.id}`} className="cli-open">
                Open latest →
              </Link>
            ) : null}
          </div>
        </div>
      </Collapse>
    </div>
  );
}

/* ---- inline icons ---- */
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function ChevronDown({ className }: { className?: string }): ReactNode {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function ChevronRight({ className }: { className?: string }): ReactNode {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
