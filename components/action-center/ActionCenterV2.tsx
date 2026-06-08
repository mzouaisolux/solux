import Link from "next/link";
import {
  BEHAVIOR_META,
  ROLE_CHIP,
  type ActionCenterV2Data,
  type ActionItem,
} from "@/lib/action-center";
import {
  acknowledgeAction,
  unacknowledgeAction,
} from "@/app/(app)/dashboard-v2/actions";

/**
 * Action Center V2 — the ONE calm list with 3 item behaviors:
 *   • Action required  → strong CTA; vanishes when done.
 *   • Follow-up        → Acknowledge ("I'm on it"); dims but stays until
 *                        the situation resolves.
 *   • Recent activity  → passive awareness, no CTA.
 *
 * No tabs, no extra widgets. Role filtering happens upstream in the engine.
 */
export function ActionCenterV2({ data }: { data: ActionCenterV2Data }) {
  const empty =
    data.action.length === 0 && data.followup.length === 0 && data.info.length === 0;

  if (empty) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-6 py-12 text-center">
        <div className="text-2xl">✓</div>
        <p className="mt-2 text-sm font-medium text-neutral-800">
          Nothing needs you right now.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Things to do or follow up will show up here — and clear themselves
          once handled.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1 — ACTION REQUIRED */}
      {data.action.length > 0 && (
        <Group behavior="action" count={data.action.length}>
          <ul className="space-y-1.5">
            {data.action.map((a) => (
              <ActionRow key={a.id} a={a} />
            ))}
          </ul>
        </Group>
      )}

      {/* 2 — FOLLOW-UP / AWARENESS */}
      {data.followup.length > 0 && (
        <Group behavior="followup" count={data.followupCount}>
          <ul className="space-y-1.5">
            {data.followup.map((a) => (
              <FollowupRow key={a.id} a={a} />
            ))}
          </ul>
        </Group>
      )}

      {/* 3 — RECENT ACTIVITY (info) */}
      {data.info.length > 0 && (
        <Group behavior="info" count={data.info.length}>
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200/70 overflow-hidden">
            {data.info.map((a) => (
              <li key={a.id} className="flex items-center gap-2.5 px-3 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-neutral-300 shrink-0" aria-hidden />
                <Link href={a.href} className="min-w-0 flex-1 group">
                  <span className="text-[12px] text-neutral-700 group-hover:text-neutral-900">
                    {a.title}
                  </span>
                  {a.subtitle && (
                    <span className="text-[11px] text-neutral-400 truncate block">
                      {a.subtitle}
                    </span>
                  )}
                </Link>
                <span
                  title={sinceTitle(a.since)}
                  className="text-[10px] text-neutral-400 tabular-nums whitespace-nowrap shrink-0"
                >
                  {agoLabel(a.ageDays)}
                </span>
              </li>
            ))}
          </ul>
        </Group>
      )}
    </div>
  );
}

function Group({
  behavior,
  count,
  children,
}: {
  behavior: keyof typeof BEHAVIOR_META;
  count: number;
  children: React.ReactNode;
}) {
  const meta = BEHAVIOR_META[behavior];
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-sm font-semibold text-neutral-900">{meta.label}</h2>
        {count > 0 && (
          <span className="text-[11px] tabular-nums text-neutral-400">{count}</span>
        )}
        <span className="text-[11px] text-neutral-400 hidden sm:inline">
          · {meta.help}
        </span>
      </div>
      {children}
    </section>
  );
}

/* ---- Action required: strong CTA, vanishes when done ---- */
function ActionRow({ a }: { a: ActionItem }) {
  const chip = ROLE_CHIP[a.roles[0] ?? "management"];
  return (
    <li className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 hover:border-neutral-300 hover:shadow-sm transition-all">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-neutral-900">{a.title}</span>
          <RoleChip chip={chip} />
        </div>
        <Meta a={a} />
      </div>
      <Link
        href={a.href}
        className="shrink-0 rounded-md bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-800 whitespace-nowrap"
      >
        {ctaLabel(a.kind)}
      </Link>
    </li>
  );
}

/* ---- Follow-up: acknowledge ("I'm on it"); dims but stays ---- */
function FollowupRow({ a }: { a: ActionItem }) {
  const chip = ROLE_CHIP[a.roles[0] ?? "management"];
  const acked = !!a.acknowledgedAt;
  return (
    <li
      className={`rounded-lg border px-3 py-2.5 transition-all ${
        acked
          ? "border-neutral-150 bg-neutral-50/60 opacity-70"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-3">
        <Link href={a.href} className="min-w-0 flex-1 group">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[13px] font-medium ${
                acked ? "text-neutral-600" : "text-neutral-900 group-hover:text-solux"
              }`}
            >
              {a.title}
            </span>
            <RoleChip chip={chip} />
          </div>
          <Meta a={a} />
        </Link>

        {acked ? (
          <form action={unacknowledgeAction} className="shrink-0">
            <input type="hidden" name="action_key" value={a.id} />
            <button className="text-[11px] text-neutral-400 hover:text-neutral-700">
              Undo
            </button>
          </form>
        ) : (
          <form action={acknowledgeAction} className="shrink-0">
            <input type="hidden" name="action_key" value={a.id} />
            <button className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 whitespace-nowrap">
              Acknowledge
            </button>
          </form>
        )}
      </div>

      {acked && (
        <div className="mt-1.5 pl-0 text-[11px] text-emerald-700">
          ✓ Acknowledged
          {a.acknowledgedByName ? ` by ${a.acknowledgedByName}` : ""}
          {a.acknowledgedAt ? ` · ${agoLabel(daysAgo(a.acknowledgedAt), a.acknowledgedAt)}` : ""}
        </div>
      )}
    </li>
  );
}

function RoleChip({ chip }: { chip: { label: string; cls: string } }) {
  return (
    <span
      className={`rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${chip.cls}`}
    >
      {chip.label}
    </span>
  );
}

function Meta({ a }: { a: ActionItem }) {
  return (
    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-500">
      {a.tag && (
        <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-rose-700">
          {a.tag}
        </span>
      )}
      <span className="truncate">{a.subtitle}</span>
      {a.amount && (
        <span className="tabular-nums text-neutral-600 whitespace-nowrap">
          · {a.amount.currency} {a.amount.value.toLocaleString()}
        </span>
      )}
      {a.ageDays != null && (
        <span title={sinceTitle(a.since)} className="tabular-nums whitespace-nowrap">
          · {a.ageDays === 0 ? "today" : `${a.ageDays}d`}
        </span>
      )}
    </div>
  );
}

/* ---- helpers ---- */

function ctaLabel(kind: string): string {
  switch (kind) {
    case "tl_validate":
    case "doc_validate":
      return "Review";
    case "missing_deadline":
      return "Set deadline";
    case "won_no_tasklist":
      return "Create task list";
    default:
      return "Open";
  }
}

function sinceTitle(since: string | null): string | undefined {
  if (!since) return undefined;
  const d = new Date(since);
  if (Number.isNaN(d.getTime())) return undefined;
  return `On the list since ${d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  })}`;
}

function daysAgo(iso: string): number | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function agoLabel(days: number | null, iso?: string): string {
  if (iso) {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m ago`;
    if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  }
  if (days == null) return "";
  if (days === 0) return "today";
  return `${days}d ago`;
}
