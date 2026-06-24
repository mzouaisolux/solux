// =====================================================================
// FINANCE VIEW — /finance (audit Phase 1, final piece — m119).
//
// READ-ONLY money cockpit for Finance & Direction:
//   "what has been paid, what is outstanding, what is overdue, which
//    LCs are about to expire?"
//
// One screen, zero actions (finance is read-only by design — m119 adds
// SELECT-only RLS). Every number is DERIVED from the same sources the
// operations pages use (computeExpected*, computeEffectiveBalanceDueDate,
// computeOperationsAlert) — Règle Produit #0: no second source of truth.
// Gated by the finance.view capability (menu → page chain).
// =====================================================================

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import {
  computeExpectedDeposit,
  computeExpectedBalance,
  computeEffectiveBalanceDueDate,
  BALANCE_DUE_SOURCE_LABEL,
  PRODUCTION_TERMINAL_STATUSES,
  type PaymentMode,
  type PaymentTerms,
  type ProductionOrderStatus,
} from "@/lib/types";
import {
  computeOperationsAlert,
  LC_EXPIRY_WARNING_DAYS,
} from "@/lib/operations-alerts";
import { OperationsAlertBadge } from "@/components/OperationsAlertBadge";
import { calendarDaysBetween, todayISO } from "@/lib/working-days";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  number: string | null;
  status: ProductionOrderStatus;
  clientName: string;
  docNumber: string | null;
  currency: string;
  total: number;
  depositRemaining: number;
  balanceRemaining: number;
  outstanding: number;
  dueDate: string | null;
  dueSource: string | null;
  daysLate: number | null;
  lcExpiry: string | null;
  lcDays: number | null;
  alert: ReturnType<typeof computeOperationsAlert>;
};

const FILTERS = [
  { key: "all", label: "All outstanding" },
  { key: "overdue", label: "Overdue" },
  { key: "lc", label: "LC expiring" },
  { key: "deposit", label: "Awaiting deposit" },
] as const;

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams?: { f?: string };
}) {
  const canSee = await hasUiCapability("finance.view");
  if (!canSee) return <AccessDenied capability="finance.view" />;

  const supabase = createClient();
  const { data: orders } = await supabase
    .from("production_orders")
    .select(
      "*, documents:quotation_id(number, total_price, currency, payment_mode, payment_terms), clients:client_id(company_name)"
    )
    .order("created_at", { ascending: false });

  const today = todayISO();
  const rows: Row[] = [];
  for (const o of (orders ?? []) as any[]) {
    if (o.archived_at) continue;
    const doc = o.documents as any;
    const total = Number(doc?.total_price ?? 0);
    const paymentMode = (doc?.payment_mode ?? null) as PaymentMode | null;
    const paymentTerms = (doc?.payment_terms ?? null) as PaymentTerms | null;
    const expectedDeposit = computeExpectedDeposit(total, paymentMode, paymentTerms);
    const expectedBalance = computeExpectedBalance(total, paymentMode, paymentTerms);
    const depositRemaining = Math.max(0, expectedDeposit - Number(o.deposit_received_amount ?? 0));
    const balanceRemaining = Math.max(0, expectedBalance - Number(o.balance_received_amount ?? 0));
    const outstanding = depositRemaining + balanceRemaining;
    const terminal = PRODUCTION_TERMINAL_STATUSES.includes(o.status);
    // Finance cares about MONEY: keep every order with money outstanding
    // (even delivered ones — shipped-but-unpaid is the worst case), plus
    // running orders. Fully-paid terminal orders drop out.
    if (outstanding <= 0.01 && terminal) continue;
    if (outstanding <= 0.01) continue;

    const due = computeEffectiveBalanceDueDate({
      balanceDueDate: o.balance_due_date ?? null,
      paymentMode,
      paymentTerms,
      currentProductionDeadline: o.current_production_deadline ?? null,
      eta: o.eta ?? null,
    });
    const daysLate =
      due.date && balanceRemaining > 0.01 ? calendarDaysBetween(due.date, today) : null;
    const lcExpiry = (o.lc_expiry_date ?? null) as string | null;
    const lcDays = lcExpiry ? calendarDaysBetween(today, lcExpiry) : null;

    rows.push({
      id: o.id,
      number: o.number ?? null,
      status: o.status,
      clientName: (o.clients as any)?.company_name ?? "—",
      docNumber: doc?.number ?? null,
      currency: (doc?.currency as string) ?? "USD",
      total,
      depositRemaining,
      balanceRemaining,
      outstanding,
      dueDate: due.date,
      dueSource: due.source ? BALANCE_DUE_SOURCE_LABEL[due.source] : null,
      daysLate,
      lcExpiry,
      lcDays,
      alert: computeOperationsAlert({
        order: o,
        totalPrice: total,
        paymentMode,
        paymentTerms,
      }),
    });
  }

  // ---- KPIs ----
  const byCurrency = new Map<string, number>();
  for (const r of rows) {
    byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.outstanding);
  }
  const overdue = rows.filter((r) => (r.daysLate ?? 0) > 0);
  const overdueByCurrency = new Map<string, number>();
  for (const r of overdue) {
    overdueByCurrency.set(r.currency, (overdueByCurrency.get(r.currency) ?? 0) + r.balanceRemaining);
  }
  const lcSoon = rows.filter(
    (r) => r.lcDays != null && r.lcDays <= LC_EXPIRY_WARNING_DAYS && r.balanceRemaining > 0.01
  );
  const awaitingDeposit = rows.filter((r) => r.depositRemaining > 0.01);

  // ---- filter + sort ----
  const filter = (searchParams?.f ?? "all") as (typeof FILTERS)[number]["key"];
  const visible = rows
    .filter((r) => {
      switch (filter) {
        case "overdue":
          return (r.daysLate ?? 0) > 0;
        case "lc":
          return r.lcDays != null && r.lcDays <= LC_EXPIRY_WARNING_DAYS && r.balanceRemaining > 0.01;
        case "deposit":
          return r.depositRemaining > 0.01;
        default:
          return true;
      }
    })
    .sort(
      (a, b) =>
        (b.daysLate ?? -9999) - (a.daysLate ?? -9999) ||
        (a.lcDays ?? 9999) - (b.lcDays ?? 9999) ||
        b.outstanding - a.outstanding
    );

  const chip = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors ${
      active
        ? "bg-neutral-900 text-white ring-neutral-900"
        : "bg-white text-neutral-600 ring-neutral-200 hover:bg-neutral-50"
    }`;

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-5">
      <div>
        <div className="eyebrow">Finance · read-only</div>
        <h1 className="doc-title">Balances &amp; LC</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Every order with money outstanding — deposits, balances, due dates and Letter-of-Credit
          expiries. Same numbers as the operations pages, zero actions: collection happens on the
          order page.
        </p>
      </div>

      {/* ---- KPIs ---- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
          <div className="text-lg font-bold tabular-nums text-neutral-900">
            {byCurrency.size === 0
              ? "0"
              : [...byCurrency.entries()].map(([c, v]) => `${fmtMoney(v)} ${c}`).join(" · ")}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">
            Total outstanding ({rows.length} orders)
          </div>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/40 px-4 py-3">
          <div className="text-lg font-bold tabular-nums text-rose-700">
            {overdue.length === 0
              ? "0"
              : [...overdueByCurrency.entries()]
                  .map(([c, v]) => `${fmtMoney(v)} ${c}`)
                  .join(" · ")}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-rose-600">
            Overdue ({overdue.length} orders)
          </div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 px-4 py-3">
          <div className="text-lg font-bold tabular-nums text-amber-800">{lcSoon.length}</div>
          <div className="text-[10px] uppercase tracking-wider text-amber-700">
            LC expiring ≤ {LC_EXPIRY_WARNING_DAYS}d
          </div>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3">
          <div className="text-lg font-bold tabular-nums text-neutral-900">
            {awaitingDeposit.length}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">
            Deposits pending
          </div>
        </div>
      </div>

      {/* ---- filters ---- */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/finance${f.key === "all" ? "" : `?f=${f.key}`}`} className={chip(filter === f.key)}>
            {f.label}
          </Link>
        ))}
      </div>

      {/* ---- table ---- */}
      {visible.length === 0 ? (
        <p className="text-[12px] text-neutral-400">Nothing outstanding in this view. 🎉</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[10px] uppercase tracking-wider text-neutral-400">
                <th className="px-3 py-2 font-semibold">Client</th>
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 font-semibold text-right">Total</th>
                <th className="px-3 py-2 font-semibold text-right">Deposit due</th>
                <th className="px-3 py-2 font-semibold text-right">Balance due</th>
                <th className="px-3 py-2 font-semibold">Due date</th>
                <th className="px-3 py-2 font-semibold">LC expiry</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visible.map((r) => {
                const late = (r.daysLate ?? 0) > 0;
                const lcHot =
                  r.lcDays != null && r.lcDays <= LC_EXPIRY_WARNING_DAYS && r.balanceRemaining > 0.01;
                return (
                  <tr key={r.id} className="hover:bg-neutral-50/60">
                    <td className="px-3 py-2 font-medium text-neutral-900">{r.clientName}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/production/orders/${r.id}`}
                        className="text-neutral-700 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
                      >
                        {r.number ?? "—"}
                      </Link>
                      {r.docNumber && (
                        <span className="ml-1 text-[11px] text-neutral-400">{r.docNumber}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600">
                      {fmtMoney(r.total)} {r.currency}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.depositRemaining > 0.01 ? (
                        <span className="font-semibold text-neutral-800">
                          {fmtMoney(r.depositRemaining)}
                        </span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.balanceRemaining > 0.01 ? (
                        <span className={`font-semibold ${late ? "text-rose-700" : "text-neutral-800"}`}>
                          {fmtMoney(r.balanceRemaining)}
                        </span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      <span className={late ? "font-semibold text-rose-700" : "text-neutral-600"}>
                        {r.dueDate ?? "—"}
                        {late && ` · ${r.daysLate}d late`}
                      </span>
                      {r.dueSource && (
                        <span className="block text-[10px] text-neutral-400">{r.dueSource}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      {r.lcExpiry ? (
                        <span className={lcHot ? "font-semibold text-amber-700" : "text-neutral-600"}>
                          {r.lcExpiry}
                          {r.lcDays != null &&
                            ` · ${r.lcDays < 0 ? `expired ${Math.abs(r.lcDays)}d` : `${r.lcDays}d left`}`}
                        </span>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <OperationsAlertBadge alert={r.alert} size="xs" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
