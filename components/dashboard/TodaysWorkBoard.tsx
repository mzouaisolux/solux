// =====================================================================
// TodaysWorkBoard — the TOP of the Operations V2 dashboard.
//
// Answers "What needs doing today?" as three compact Kanban-style columns of
// task cards (inspired by the owner's reference CRM, 2026-06-25): Blocked /
// Action required / At risk. The source is the role-filtered Action Center
// (the derived operational exceptions) — these ARE the operator's work today.
//
// Distinct from Orders in flight below, which answers "where do our affairs in
// execution stand?". Top = tasks (what to do); bottom = affairs (where things
// are). They share the severity vocabulary on purpose.
//
// Pure presentation; the page maps action items → TaskCard. Hardcoded English.
// =====================================================================

import Link from "next/link";
import { CATEGORY_META, type DashCategory } from "@/lib/dashboard-operations-config";

export type TaskCard = {
  id: string;
  title: string;
  /** Affair · client context line. */
  sub: string;
  /** Short role tag — OPS / SALES / TLM / MGMT — or null. */
  role: string | null;
  href: string;
  /** SLA badge — "Overdue" / "Escalated" — when the item has aged. */
  tag: string | null;
};

export type TodaysWorkGroups = {
  blocked: TaskCard[];
  action: TaskCard[];
  risk: TaskCard[];
};

const COL_CAP = 8;

type ColKey = "blocked" | "action" | "risk";
// Column labels + accents come from the rulebook (CATEGORY_META) — one place
// to rename a category or restyle it.
const COLS: { key: ColKey; cat: DashCategory }[] = [
  { key: "blocked", cat: "blocked" },
  { key: "action", cat: "action_required" },
  { key: "risk", cat: "at_risk" },
];

function Card({ t }: { t: TaskCard }) {
  return (
    <li>
      <Link
        href={t.href}
        className="group block rounded-lg border border-neutral-200 bg-white px-3 py-2 hover:border-neutral-300 hover:shadow-sm transition-all"
      >
        <div className="flex items-start gap-2">
          <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full border border-neutral-300 group-hover:border-neutral-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-neutral-900">{t.title}</span>
              {t.tag && (
                <span className="shrink-0 rounded border border-rose-200 bg-rose-50 px-1 text-[9px] font-bold uppercase tracking-wide text-rose-700">
                  {t.tag}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500">{t.sub || "—"}</span>
              {t.role && (
                <span className="shrink-0 rounded border border-neutral-200 bg-neutral-50 px-1 text-[9px] font-bold uppercase tracking-wide text-neutral-500">
                  {t.role}
                </span>
              )}
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}

function Column({
  label,
  dot,
  head,
  ring,
  cards,
}: {
  label: string;
  dot: string;
  head: string;
  ring: string;
  cards: TaskCard[];
}) {
  return (
    <section className={`rounded-xl border border-neutral-200/80 bg-neutral-50/40 ring-1 ${ring} p-3`}>
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        <h3 className={`text-[11px] font-semibold uppercase tracking-wider ${head}`}>{label}</h3>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[10px] tabular-nums text-neutral-600 border border-neutral-200">
          {cards.length}
        </span>
      </div>
      {cards.length === 0 ? (
        <p className="px-1 py-3 text-[12px] text-emerald-700">✓ Clear</p>
      ) : (
        <ul className="space-y-1.5">
          {cards.slice(0, COL_CAP).map((t) => (
            <Card key={t.id} t={t} />
          ))}
          {cards.length > COL_CAP && (
            <li className="px-1 pt-0.5 text-[11px] text-neutral-400">+{cards.length - COL_CAP} more</li>
          )}
        </ul>
      )}
    </section>
  );
}

export default function TodaysWorkBoard({ groups }: { groups: TodaysWorkGroups }) {
  const total = groups.blocked.length + groups.action.length + groups.risk.length;
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-neutral-900">Today&apos;s work</h2>
        <span className="text-xs text-neutral-500">What needs doing today?</span>
        <span className="ml-auto text-[11px] text-neutral-400">{total} open</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COLS.map((c) => {
          const m = CATEGORY_META[c.cat];
          return (
            <Column
              key={c.key}
              label={m.label}
              dot={m.dot}
              head={m.head}
              ring={m.ring}
              cards={groups[c.key]}
            />
          );
        })}
      </div>
    </section>
  );
}
