"use client";

// =====================================================================
// Profitability breakdown drawer (m152 widget) — the "one click away" full
// financial analysis. Portal right-panel per the TenderDrawer architecture
// (backdrop click + Esc close, body scroll lock). Management-only by
// construction: it renders ONLY from data the capability-gated loader /
// server action produced — this component never fetches costs itself unless
// given an affairId, in which case it calls the REAL-role-gated action.
// =====================================================================

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  getProfitabilityBreakdown,
  getProfitabilityWaterfall,
} from "@/app/(app)/affairs/profitability-actions";
import type {
  AffairProfitability,
  ProfitabilityResult,
  ProfitComponent,
  ProfitHealth,
  TraceSource,
} from "@/lib/profitability";
import type { WaterfallPayload } from "@/lib/profitability-server";

const HEALTH_DOT: Record<ProfitHealth, string> = {
  green: "bg-green-600",
  yellow: "bg-amber-500",
  red: "bg-red-600",
};

const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });

const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toFixed(1)}%`;

function HealthDot({ health }: { health: ProfitHealth | null }) {
  if (!health) return null;
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${HEALTH_DOT[health]}`}
    />
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span
        className={
          strong
            ? "text-sm font-semibold text-neutral-900"
            : "text-sm text-neutral-500"
        }
      >
        {label}
      </span>
      <span
        className={`tabular-nums ${
          strong
            ? "text-sm font-bold text-neutral-900"
            : "text-sm text-neutral-800"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** One audit line: where a figure comes from, with a click-through. */
function SourceLine({ s }: { s: TraceSource }) {
  return (
    <div className="mt-0.5 text-[11px] leading-snug text-neutral-400">
      <span className="mr-1 font-semibold uppercase tracking-wide text-neutral-400">
        Source
      </span>
      {s.href ? (
        <a
          href={s.href}
          className="text-neutral-600 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
        >
          {s.label}
        </a>
      ) : (
        <span className="text-neutral-600">{s.label}</span>
      )}
      {s.detail ? <span className="text-neutral-400"> · {s.detail}</span> : null}
    </div>
  );
}

function GoodsSection({
  title,
  c,
  trace,
}: {
  title: string;
  c: ProfitComponent;
  trace?: { sources: TraceSource[]; formula: string } | null;
}) {
  if (!c.available) return null;
  return (
    <section className="border-t border-neutral-100 pt-3">
      <div className="mb-1 flex items-center gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          {title}
        </h4>
        <HealthDot health={c.health} />
      </div>
      <Row label="Revenue" value={money(c.revenue)} />
      <Row
        label="Cost"
        value={
          c.costMissing ? (
            <span className="text-amber-700">cost missing</span>
          ) : (
            money(c.cost)
          )
        }
      />
      <Row label="Margin" value={money(c.marginValue)} />
      <Row label="Margin %" value={pct(c.marginPct)} strong />
      {trace?.sources.map((s, i) => (
        <SourceLine key={i} s={s} />
      ))}
      {trace && (
        <div className="mt-0.5 text-[11px] leading-snug text-neutral-400">
          <span className="mr-1 font-semibold uppercase tracking-wide">
            Formula
          </span>
          {trace.formula}
        </div>
      )}
    </section>
  );
}

export function ProfitabilityDrawer({
  open,
  onClose,
  data,
  affairId,
}: {
  open: boolean;
  onClose: () => void;
  /** Full result when the caller already holds it (badge surfaces). */
  data?: ProfitabilityResult | null;
  /** Chip surfaces pass the affair id: the drawer lazy-loads on open. */
  affairId?: string | null;
}) {
  const [shown, setShown] = useState(false);
  const [fetched, setFetched] = useState<ProfitabilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [audit, setAudit] = useState<WaterfallPayload | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setShown(false);
    const raf = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open || data || !affairId) return;
    let alive = true;
    setLoading(true);
    getProfitabilityBreakdown(affairId)
      .then((r) => {
        if (alive) setFetched(r);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, data, affairId]);

  // Margin history + cost-revision audit — lazy, drawer-only (never on lists).
  useEffect(() => {
    if (!open || !affairId || audit != null) return;
    let alive = true;
    getProfitabilityWaterfall(affairId).then((payload) => {
      if (alive)
        setAudit(payload ?? { steps: [], costHistory: [], versions: [] });
    });
    return () => {
      alive = false;
    };
  }, [open, affairId, audit]);

  if (!open) return null;

  const result = data ?? fetched;
  const p: AffairProfitability | null =
    result && result.ok ? result : null;
  const byKey = (k: ProfitComponent["key"]) =>
    p?.components.find((c) => c.key === k) ?? null;
  const freight = byKey("freight");
  const insurance = byKey("insurance");
  const charges = byKey("additional_charges");
  const commission = byKey("commission");

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true">
      <div
        className={`absolute inset-0 bg-neutral-900/40 transition-opacity duration-200 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />
      <div
        className={`absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col bg-white shadow-2xl transition-transform duration-200 ease-out ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Project profitability
            </div>
            {p ? (
              <div className="mt-1 text-sm text-neutral-700">
                Latest approved quotation{" "}
                <a
                  href={`/documents/${p.leadingDoc.id}`}
                  className="font-mono font-bold underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
                  title="Open the quotation used for every revenue figure"
                >
                  {p.leadingDoc.number ?? "—"}
                </a>
                {p.leadingDoc.version > 1 ? (
                  <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800">
                    V{p.leadingDoc.version}
                  </span>
                ) : null}
                <span className="ml-2 text-neutral-400">
                  {p.leadingDoc.status}
                </span>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-neutral-200 px-2.5 py-1 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="animate-pulse space-y-3">
              <div className="h-5 w-2/3 rounded bg-neutral-100" />
              <div className="h-24 rounded bg-neutral-100" />
              <div className="h-24 rounded bg-neutral-100" />
            </div>
          )}
          {!loading && !p && (
            <p className="text-sm text-neutral-500">
              No profitability data for this project
              {result && !result.ok && result.reason === "non_usd"
                ? " (non-USD quotation — not supported yet)"
                : ""}
              .
            </p>
          )}
          {p && (
            <>
              <Row
                label="Selling price"
                value={money(p.grandTotal)}
                strong
              />
              {p.trace?.sellingPrice && (
                <SourceLine s={p.trace.sellingPrice} />
              )}

              <GoodsSection
                title="Product"
                c={byKey("product")!}
                trace={p.trace?.product}
              />
              <GoodsSection
                title="Pole"
                c={byKey("pole")!}
                trace={p.trace?.pole}
              />

              {/* OTHER COSTS — pass-throughs by company rule: re-invoiced,
                  never counted in margin. Each line names its source. */}
              <section className="border-t border-neutral-100 pt-3">
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  Other costs{" "}
                  <span className="normal-case tracking-normal text-neutral-400">
                    (re-invoiced — never counted in margin)
                  </span>
                </h4>
                {freight?.available && (
                  <>
                    <Row label="Transport" value={money(freight.cost)} />
                    {p.trace?.freight && <SourceLine s={p.trace.freight} />}
                  </>
                )}
                {insurance?.available && (
                  <>
                    <Row label="Insurance" value={money(insurance.cost)} />
                    {p.trace?.insurance && (
                      <SourceLine s={p.trace.insurance} />
                    )}
                  </>
                )}
                {charges?.available && (
                  <>
                    <Row
                      label="Additional charges"
                      value={money(charges.cost)}
                    />
                    {p.trace?.charges?.items.map((it, i) => (
                      <div
                        key={i}
                        className="flex items-baseline justify-between gap-3 pl-4 text-[12px] text-neutral-500"
                      >
                        <span>· {it.label}</span>
                        <span className="tabular-nums">{money(it.amount)}</span>
                      </div>
                    ))}
                    {p.trace?.charges?.href && (
                      <SourceLine
                        s={{
                          label: "documents.additional_charges",
                          href: p.trace.charges.href,
                          detail: "entered in the quotation builder (m146)",
                        }}
                      />
                    )}
                  </>
                )}
                {commission?.available && (
                  <Row label="Commission" value={money(commission.cost)} />
                )}
                <Row
                  label="Manufacturing adders"
                  value={
                    <span className="text-neutral-400">not tracked yet</span>
                  }
                />
              </section>

              {/* TOTAL */}
              <section className="border-t-2 border-neutral-200 pt-3">
                <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  Total
                </h4>
                <Row label="Selling price" value={money(p.grandTotal)} />
                <Row
                  label="Total cost"
                  value={
                    p.totalCost == null ? (
                      <span className="text-amber-700">
                        incomplete{p.partial ? " *" : ""}
                      </span>
                    ) : (
                      money(p.totalCost)
                    )
                  }
                />
                <Row label="Gross profit" value={money(p.grossProfit)} />
                <div className="mt-1 flex items-baseline justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2">
                  <span className="text-sm font-semibold text-neutral-900">
                    Overall margin
                  </span>
                  <span className="flex items-center gap-2">
                    <HealthDot health={p.overallHealth} />
                    <span className="text-xl font-bold tabular-nums text-neutral-900">
                      {pct(p.overallPct)}
                      {p.partial ? " *" : ""}
                    </span>
                  </span>
                </div>
                {p.partial && (
                  <p className="mt-2 text-[11px] leading-snug text-neutral-500">
                    * Some costs are unknown (uncosted or unclassified items) —
                    the overall margin only counts the known components.
                  </p>
                )}
                {p.trace?.basis && (
                  <p className="mt-2 text-[11px] leading-snug text-neutral-400">
                    Calculation basis: 1 USD = {p.trace.basis.exchangeRate} RMB
                    · export rebate{" "}
                    {Math.round(p.trace.basis.taxRebate * 100)}% (pricing
                    settings) · computed live from current data — no cached
                    values.
                  </p>
                )}
                {/* m153 auto-suggestion: low margins on an aging costing. */}
                {p.revisionHint && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                    <span>
                      ⚠ Margins look low and the approved costing is{" "}
                      <b>{p.revisionHint.ageDays} days old</b> — supplier
                      prices or FX may have moved. Consider a cost revision.
                    </span>
                    {p.revisionHint.srId && (
                      <a
                        href={`/projects/${p.revisionHint.srId}`}
                        className="shrink-0 font-semibold underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
                      >
                        Open the Service Request →
                      </a>
                    )}
                  </div>
                )}
              </section>

              {/* COST REVISION HISTORY (m153 audit center) — every audited
                  manufacturing-cost change: revision #, old→new RMB, reason,
                  who, when + the m140 costing versions. Expandable to keep the
                  drawer calm. */}
              {affairId &&
                audit &&
                (audit.costHistory.length > 0 || audit.versions.length > 0) && (
                  <section className="border-t border-neutral-100 pt-3">
                    <button
                      type="button"
                      onClick={() => setHistoryOpen((v) => !v)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                        Cost revision history ({audit.costHistory.length})
                        {audit.versions.length
                          ? ` · costing V${
                              audit.versions[audit.versions.length - 1].versionNo
                            }`
                          : ""}
                      </h4>
                      <span className="text-xs text-neutral-400">
                        {historyOpen ? "▲" : "▼"}
                      </span>
                    </button>
                    {historyOpen && (
                      <div className="mt-2 space-y-2">
                        {audit.costHistory.length > 0 && (
                          <ol className="space-y-1.5">
                            {[...audit.costHistory].reverse().map((r) => (
                              <li key={r.revision} className="text-[12px] leading-snug">
                                <span className="font-semibold text-neutral-800">
                                  Revision #{r.revision}
                                </span>{" "}
                                <span className="text-neutral-600">
                                  {r.changes
                                    .map(
                                      (c) =>
                                        `${
                                          c.field === "pole_cost_rmb"
                                            ? "Pole"
                                            : "Product"
                                        } ${c.old ?? "—"} → ${c.new ?? "—"} RMB`
                                    )
                                    .join(" · ")}
                                </span>
                                {r.reason && (
                                  <span className="text-neutral-500"> · {r.reason}</span>
                                )}
                                <span className="text-neutral-400">
                                  {" "}
                                  · {r.by ?? "—"} · {r.at ? r.at.slice(0, 10) : "—"}
                                </span>
                                {r.srId && (
                                  <a
                                    href={`/projects/${r.srId}`}
                                    className="ml-1 text-neutral-500 underline decoration-neutral-300 underline-offset-2 hover:text-neutral-900"
                                  >
                                    open SR
                                  </a>
                                )}
                              </li>
                            ))}
                          </ol>
                        )}
                        {audit.versions.length > 0 && (
                          <div className="rounded-md bg-neutral-50 px-3 py-2">
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                              Costing versions
                            </div>
                            <ol className="space-y-1">
                              {[...audit.versions].reverse().map((v) => (
                                <li key={v.versionNo} className="text-[12px] text-neutral-600">
                                  <b>V{v.versionNo}</b> · {v.status}
                                  {v.productUnitPrice != null
                                    ? ` · product $${v.productUnitPrice}`
                                    : ""}
                                  {v.poleUnitPrice != null
                                    ? ` · pole $${v.poleUnitPrice}`
                                    : ""}
                                  {v.reason ? ` · ${v.reason}` : ""}
                                  {v.approvedBy
                                    ? ` · approved by ${v.approvedBy}${
                                        v.approvedAt
                                          ? ` (${v.approvedAt.slice(0, 10)})`
                                          : ""
                                      }`
                                    : v.requestedBy
                                    ? ` · requested by ${v.requestedBy}${
                                        v.requestedAt
                                          ? ` (${v.requestedAt.slice(0, 10)})`
                                          : ""
                                      }`
                                    : ""}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                        <p className="text-[11px] leading-snug text-neutral-400">
                          Nothing is ever deleted — every change keeps its
                          reason, author and date.
                        </p>
                      </div>
                    )}
                  </section>
                )}

              {/* WHY DID THE MARGIN CHANGE? — reconstructed % waterfall from
                  the app's dated records (versions, shipping updates, cost
                  audits). Renders only when history exists. */}
              {affairId && audit && audit.steps.length > 1 && (
                <section className="border-t border-neutral-100 pt-3">
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    Why did the margin change?
                  </h4>
                  <ol className="space-y-1.5">
                    {audit.steps.map((s, i) => (
                      <li key={i} className="flex items-baseline gap-3">
                        <span className="w-20 shrink-0 text-[11px] tabular-nums text-neutral-400">
                          {s.at ? s.at.slice(0, 10) : "—"}
                        </span>
                        <span className="w-14 shrink-0 text-sm font-bold tabular-nums text-neutral-900">
                          {s.overallPct == null
                            ? "—"
                            : `${s.overallPct.toFixed(1)}%`}
                        </span>
                        {s.deltaPct != null && Math.abs(s.deltaPct) >= 0.05 && (
                          <span
                            className={`shrink-0 text-[11px] font-semibold tabular-nums ${
                              s.deltaPct < 0 ? "text-red-600" : "text-green-700"
                            }`}
                          >
                            {s.deltaPct < 0 ? "↓" : "↑"}
                            {Math.abs(s.deltaPct).toFixed(1)}
                          </span>
                        )}
                        <span className="min-w-0 truncate text-sm text-neutral-600">
                          {s.detail}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2 text-[11px] leading-snug text-neutral-400">
                    Reconstructed from quotation versions, shipping updates and
                    cost audits. Exchange-rate changes and untracked edits are
                    not shown.
                  </p>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
