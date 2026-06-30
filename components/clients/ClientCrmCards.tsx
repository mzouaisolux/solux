"use client";

// =====================================================================
// Clients — CRM cards view (solux-clients-crm-offline.html skin).
// The sales command center: KPI dashboard, sticky toolbar (scope / view /
// sort), filter bar, attention strip, and one card per client (health,
// portfolio value + spark, pipeline mix, alerts, primary contact, CTA).
// All data is computed server-side in page.tsx and passed down plain;
// search / sort / filters are client-side over that array.
// =====================================================================

import { useMemo, useState } from "react";
import Link from "next/link";
import NewClientPanel from "@/app/(app)/clients/NewClientPanel";

export type CrmCard = {
  clientId: string;
  name: string;
  code: string | null;
  country: string | null;
  countryCode: string | null;
  topAffair: string | null;
  health: "strong" | "watch" | "steady";
  value: number;
  valueLabel: string;
  trendPct: number | null;
  spark: { h: number; hi: boolean }[];
  activeCount: number;
  wonCount: number;
  quoteCount: number;
  prodCount: number;
  awaitingReply: number;
  behindSchedule: number;
  lastActivityDays: number | null;
  ownerName: string | null;
  contactName: string | null;
  contactRole: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  archived: boolean;
};

export type CrmKpis = {
  totalClients: number;
  activeClients: number;
  dormantClients: number;
  activeAffairs: number;
  newAffairs30d: number;
  wonQuarter: number;
  wonQuarterValueLabel: string;
  portfolioValueLabel: string;
  portfolioSpark: { h: number; hi: boolean }[];
};

export type CrmAttention = {
  awaitingReply: number;
  behindSchedule: number;
  accounts: number;
};

type Scope = "active" | "all" | "archived";

const TrendUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);
const TrendDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" />
    <polyline points="22 6 12 13 2 6" />
  </svg>
);
const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

function initials(name: string | null): string {
  if (!name) return "—";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function lastActivityLabel(days: number | null): string {
  if (days == null) return "No activity yet";
  if (days <= 0) return "Last activity today";
  if (days === 1) return "Last activity yesterday";
  return `Last activity ${days} days ago`;
}

const HEALTH_LABEL: Record<CrmCard["health"], string> = {
  strong: "Strong",
  watch: "Watch",
  steady: "Steady",
};

function CardNode({ c }: { c: CrmCard }) {
  const healthCls = c.health === "strong" ? "health-strong" : c.health === "watch" ? "health-watch" : "";
  return (
    <div className={`ccard ${healthCls}`}>
      <div className="top-accent" />
      <div className="cc-head">
        <div className="cc-flag">{c.countryCode ?? initials(c.name)}</div>
        <div className="cc-id">
          <div className="cc-name-row">
            <span className="cc-name" title={c.name}>{c.name}</span>
            {c.code && <span className="cc-code">{c.code}</span>}
          </div>
          <div className="cc-loc">
            {c.country && <span className="ctry">{c.country}</span>}
            {c.country && c.topAffair && " · "}
            {c.topAffair ? (
              <span className="cc-aff" title={c.topAffair}>{c.topAffair}</span>
            ) : !c.country ? (
              "—"
            ) : (
              ""
            )}
          </div>
        </div>
        <span className={`health-badge ${c.health}`}>
          <span className="hd" />
          {HEALTH_LABEL[c.health]}
        </span>
      </div>

      <div className="cc-value">
        <div className="pv-label">Portfolio value</div>
        <div className="pv-row">
          <span className="pv tnum">{c.valueLabel}</span>
          {c.trendPct != null && (
            <span className={`pv-trend ${c.trendPct < 0 ? "down" : ""}`}>
              {c.trendPct < 0 ? <TrendDown /> : <TrendUp />}
              {c.trendPct < 0 ? "−" : "+"}
              {Math.abs(Math.round(c.trendPct))}%
            </span>
          )}
        </div>
        <div className="spark-sm">
          {c.spark.map((s, i) => (
            <i key={i} className={s.hi ? "hi" : ""} style={{ height: `${s.h}%` }} />
          ))}
        </div>
      </div>

      <div className="cc-stats">
        <div className="cc-stat">
          <div className="s-v tnum">{c.activeCount}</div>
          <div className="s-k">active affairs</div>
        </div>
        <div className="cc-stat">
          <div className="s-v tnum">
            <span className="won">{c.wonCount}</span>
          </div>
          <div className="s-k">won deals</div>
        </div>
      </div>

      {c.activeCount + c.wonCount > 0 && (
        <div className="cc-pipe">
          <div className="pl">
            <span>Pipeline</span>
            <span>
              {c.activeCount + c.wonCount} affair{c.activeCount + c.wonCount === 1 ? "" : "s"}
            </span>
          </div>
          <div className="pipe-bar">
            {c.quoteCount > 0 && <i className="quote" style={{ flex: c.quoteCount }} />}
            {c.prodCount > 0 && <i className="prod" style={{ flex: c.prodCount }} />}
            {c.wonCount > 0 && <i className="won" style={{ flex: c.wonCount }} />}
            {c.quoteCount + c.prodCount + c.wonCount === 0 && <i style={{ flex: 1 }} />}
          </div>
          <div className="pk">
            {c.quoteCount > 0 && (
              <span>
                <span className="dot quote" />
                {c.quoteCount} quoting
              </span>
            )}
            {c.prodCount > 0 && (
              <span>
                <span className="dot prod" />
                {c.prodCount} in production
              </span>
            )}
            {c.wonCount > 0 && (
              <span>
                <span className="dot won" />
                {c.wonCount} won
              </span>
            )}
          </div>
        </div>
      )}

      {(c.awaitingReply > 0 || c.behindSchedule > 0 || c.prodCount > 0) && (
        <div className="cc-alerts">
          {c.awaitingReply > 0 && (
            <span className="achip amber">
              <span className="n">{c.awaitingReply}</span> quote{c.awaitingReply === 1 ? "" : "s"} awaiting reply
            </span>
          )}
          {c.behindSchedule > 0 && (
            <span className="achip amber">
              <span className="n">{c.behindSchedule}</span> behind schedule
            </span>
          )}
          {c.prodCount > 0 && (
            <span className="achip">
              <span className="n">{c.prodCount}</span> in production
            </span>
          )}
        </div>
      )}

      <div className="cc-last">
        <span className={`ld ${c.lastActivityDays != null && c.lastActivityDays > 14 ? "cold" : ""}`} />
        {lastActivityLabel(c.lastActivityDays)}
      </div>

      <div className="cc-foot">
        <div className="cc-contact">
          <span className="cc-avatar">{initials(c.contactName)}</span>
          <div className="ci">
            <div className="cn" title={c.contactName ?? undefined}>{c.contactName ?? "No contact yet"}</div>
            <div className="cr">{c.contactRole ?? c.ownerName ?? "—"}</div>
          </div>
        </div>
        <div className="acts">
          {c.contactEmail && (
            <a className="icon-btn" title="Email" href={`mailto:${c.contactEmail}`}>
              <MailIcon />
            </a>
          )}
          {c.contactPhone && (
            <a className="icon-btn" title="Call" href={`tel:${c.contactPhone.replace(/\s+/g, "")}`}>
              <PhoneIcon />
            </a>
          )}
        </div>
      </div>

      <Link className="cc-cta" href={`/clients/${c.clientId}`}>
        Open Client Hub <span className="ar">→</span>
      </Link>
    </div>
  );
}

export function ClientCrmCards({
  cards,
  kpis,
  attention,
  scope,
  scopeCounts,
  canCreateQuotation,
  showOwnerFilter,
}: {
  cards: CrmCard[];
  kpis: CrmKpis;
  attention: CrmAttention;
  scope: Scope;
  scopeCounts: { active: number; all: number; archived: number };
  canCreateQuotation: boolean;
  showOwnerFilter: boolean;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("value");
  const [fCountry, setFCountry] = useState("");
  const [fOwner, setFOwner] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fValue, setFValue] = useState("");

  const countries = useMemo(
    () => [...new Set(cards.map((c) => c.country).filter(Boolean) as string[])].sort(),
    [cards]
  );
  const owners = useMemo(
    () => [...new Set(cards.map((c) => c.ownerName).filter(Boolean) as string[])].sort(),
    [cards]
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = cards.filter((c) => {
      if (term) {
        const hay = [c.name, c.code, c.country, c.contactName, c.ownerName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (fCountry && c.country !== fCountry) return false;
      if (fOwner && c.ownerName !== fOwner) return false;
      if (fStatus === "active" && c.activeCount === 0) return false;
      if (fStatus === "production" && c.prodCount === 0) return false;
      if (fStatus === "awaiting" && c.awaitingReply === 0) return false;
      if (fStatus === "won" && c.wonCount === 0) return false;
      if (fValue === "gt1m" && c.value <= 1_000_000) return false;
      if (fValue === "mid" && (c.value < 250_000 || c.value > 1_000_000)) return false;
      if (fValue === "lt250k" && c.value >= 250_000) return false;
      return true;
    });
    const healthRank = { watch: 0, steady: 1, strong: 2 } as const;
    list = list.slice().sort((a, b) => {
      switch (sort) {
        case "activity":
          return (b.activeCount - a.activeCount) || (b.value - a.value);
        case "attention":
          return (
            healthRank[a.health] - healthRank[b.health] ||
            b.awaitingReply + b.behindSchedule - (a.awaitingReply + a.behindSchedule)
          );
        case "recent":
          return (a.lastActivityDays ?? 9999) - (b.lastActivityDays ?? 9999);
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return b.value - a.value;
      }
    });
    return list;
  }, [cards, q, sort, fCountry, fOwner, fStatus, fValue]);

  const scopeHref = (key: Scope) => (key === "active" ? "/clients" : `/clients?scope=${key}`);

  return (
    <div className="solux-crm">
      <div className="crm-wrap">
        {/* HEADER */}
        <div className="head">
          <div>
            <div className="eyebrow">Sales command center</div>
            <h1 className="title">Clients</h1>
            <p className="sub">
              Where revenue is concentrated, which accounts are active, and which need attention —
              at a glance.
            </p>
          </div>
          <div className="head-actions">
            <NewClientPanel
              trigger={(open) => (
                <button type="button" className="btn" onClick={open}>
                  <span className="plus">+</span> New client
                </button>
              )}
            />
            {canCreateQuotation && (
              <Link href="/documents/new" className="btn primary">
                <span className="plus">+</span> New quotation
              </Link>
            )}
          </div>
        </div>

        {/* KPI DASHBOARD */}
        <div className="kpis">
          <div className="kpi">
            <div className="k">Total clients</div>
            <div className="v tnum">{kpis.totalClients}</div>
            <div className="d">
              {kpis.activeClients} active · {kpis.dormantClients} dormant
            </div>
          </div>
          <div className="kpi">
            <div className="k">Active affairs</div>
            <div className="v tnum">{kpis.activeAffairs}</div>
            <div className="d">
              {kpis.newAffairs30d > 0 ? (
                <>
                  <span className="trend">
                    <TrendUp />+{kpis.newAffairs30d}
                  </span>{" "}
                  new this month
                </>
              ) : (
                "across the portfolio"
              )}
            </div>
          </div>
          <div className="kpi">
            <div className="k">Won this quarter</div>
            <div className="v green tnum">{kpis.wonQuarter}</div>
            <div className="d">{kpis.wonQuarterValueLabel} closed value</div>
          </div>
          <div className="kpi accent">
            <div className="k">Portfolio value</div>
            <div className="v green tnum">{kpis.portfolioValueLabel}</div>
            <div className="spark">
              {kpis.portfolioSpark.map((s, i) => (
                <i key={i} className={s.hi ? "hi" : ""} style={{ height: `${s.h}%` }} />
              ))}
            </div>
          </div>
        </div>

        {/* STICKY TOOLBAR */}
        <div className="toolbar">
          <div className="tb-row">
            <div className="seg">
              <Link href={scopeHref("active")} className={scope === "active" ? "on" : ""}>
                Active <span className="c">{scopeCounts.active}</span>
              </Link>
              <Link href={scopeHref("all")} className={scope === "all" ? "on" : ""}>
                All <span className="c">{scopeCounts.all}</span>
              </Link>
              <Link href={scopeHref("archived")} className={scope === "archived" ? "on" : ""}>
                Archived <span className="c">{scopeCounts.archived}</span>
              </Link>
            </div>
            <div className="viewas">
              <span className="vl">View:</span>
              <a className="on">Cards</a>
              <span style={{ color: "var(--line-2)" }}>·</span>
              <Link href="/clients?view=tree">Affairs tree</Link>
              <span style={{ color: "var(--line-2)" }}>·</span>
              <Link href="/clients?view=flat">Flat list</Link>
            </div>
            <div className="sortby">
              <span>Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="value">Portfolio value ↓</option>
                <option value="activity">Most active</option>
                <option value="attention">Needs attention</option>
                <option value="recent">Recently active</option>
                <option value="name">Name A–Z</option>
              </select>
            </div>
          </div>
          <div className="filterbar">
            <div className="search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search clients — name, code, country, contact…"
              />
            </div>
            <select className="fdrop" value={fCountry} onChange={(e) => setFCountry(e.target.value)}>
              <option value="">All countries</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {showOwnerFilter && owners.length > 0 && (
              <select className="fdrop" value={fOwner} onChange={(e) => setFOwner(e.target.value)}>
                <option value="">All owners</option>
                {owners.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
            <select className="fdrop" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
              <option value="">Any status</option>
              <option value="active">Active deals</option>
              <option value="production">In production</option>
              <option value="awaiting">Awaiting reply</option>
              <option value="won">Won</option>
            </select>
            <select className="fdrop" value={fValue} onChange={(e) => setFValue(e.target.value)}>
              <option value="">Any value</option>
              <option value="gt1m">&gt; $1M</option>
              <option value="mid">$250k–$1M</option>
              <option value="lt250k">&lt; $250k</option>
            </select>
          </div>
        </div>

        {/* ATTENTION STRIP */}
        {(attention.awaitingReply > 0 || attention.behindSchedule > 0) && (
          <div className="attention">
            <span className="ai" />
            <span>
              {attention.awaitingReply > 0 && (
                <>
                  <b>
                    {attention.awaitingReply} quotation{attention.awaitingReply === 1 ? "" : "s"}
                  </b>{" "}
                  awaiting client response
                </>
              )}
              {attention.awaitingReply > 0 && attention.behindSchedule > 0 && " · "}
              {attention.behindSchedule > 0 && (
                <>
                  <b>
                    {attention.behindSchedule} order{attention.behindSchedule === 1 ? "" : "s"}
                  </b>{" "}
                  behind schedule
                </>
              )}
              {attention.accounts > 0 && (
                <>
                  {" "}
                  across <b>{attention.accounts} account{attention.accounts === 1 ? "" : "s"}</b>
                </>
              )}
            </span>
            <Link href="/dashboard?tab=sales">Review what needs attention →</Link>
          </div>
        )}

        {/* CARD GRID */}
        <div className="grid">
          {filtered.map((c) => (
            <CardNode key={c.clientId} c={c} />
          ))}
          <NewClientPanel
            deepLink={false}
            trigger={(open) => (
              <button type="button" className="ccard new-card" onClick={open}>
                <div className="plus-circle">+</div>
                <div className="nt">Add a new client</div>
                <div className="ns">Start a portfolio with their first affair</div>
              </button>
            )}
          />
        </div>
      </div>
    </div>
  );
}
