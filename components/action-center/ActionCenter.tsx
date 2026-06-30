import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import {
  ACTION_SECTION_ORDER,
  SECTION_META,
  ROLE_CHIP,
  type ActionCenterData,
  type ActionContextChip,
  type ActionItem,
  type ActionNote,
} from "@/lib/action-center";
import {
  markActionDone,
  addActionNote,
} from "@/app/(app)/dashboard/action-center-actions";

/** Tooltip: the exact date an item first appeared on the list. */
function sinceTitle(since: string | null): string | undefined {
  if (!since) return undefined;
  const d = new Date(since);
  if (Number.isNaN(d.getTime())) return undefined;
  return `Added ${d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  })}`;
}

/** "Added 2d ago" — different from `ageDays` (which is the issue magnitude). */
function openedAgoLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days <= 0) return "Added today";
  if (days === 1) return "Added 1d ago";
  return `Added ${days}d ago`;
}

/** Tone → CSS classes for the inline context chips. Soft surfaces — these
 *  must read calm and informational, never compete with the headline.
 *  Borderless on purpose: chips sit on the title line and a border would
 *  fight with the role chip for visual weight. */
const CHIP_TONE: Record<NonNullable<ActionContextChip["tone"]>, string> = {
  neutral: "bg-neutral-100 text-neutral-700",
  warn: "bg-amber-50 text-amber-800",
  danger: "bg-rose-50 text-rose-800",
  good: "bg-emerald-50 text-emerald-800",
};

/**
 * Action Center (Dashboard, Operations tab). Renders the derived actions
 * grouped into calm, prioritized sections. Each action is an imperative the
 * user can act on in one click — not a notification to dismiss.
 *
 * Each card now carries:
 *   - inline operational context (initial / current ETA, incoterm, etc.) so a
 *     sales person can inform the client without first opening the order
 *   - a separate "Added Xd ago" footer (independent of the issue magnitude)
 *   - a lightweight notes pane — micro-operational coordination pinned to the
 *     card itself, replacing WhatsApp / verbal nudges
 *
 * Deliberately quiet: empty sections don't render, and a fully-clear state
 * shows a single reassuring line instead of a wall of widgets.
 */
export function ActionCenter({ data }: { data: ActionCenterData }) {
  const t = getT();
  if (data.total === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-6 py-12 text-center">
        <div className="text-2xl">✓</div>
        <p className="mt-2 text-sm font-medium text-neutral-800">
          {t("ac.empty")}
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          When a quote, task list or order needs action, it'll appear here —
          and disappear once it's handled.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {ACTION_SECTION_ORDER.map((section) => {
        const list = data.sections[section];
        if (list.length === 0) return null;
        const meta = SECTION_META[section];
        return (
          <section
            key={section}
            className={`rounded-xl border p-4 ${meta.accent}`}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className={`h-2 w-2 rounded-full ${meta.dot}`}
                aria-hidden
              />
              <h2 className="text-sm font-semibold text-neutral-900">
                {t(`ac.section.${section}`)}
              </h2>
              <span className="text-[11px] tabular-nums text-neutral-400">
                {list.length}
              </span>
              <span className="text-[11px] text-neutral-400 hidden sm:inline">
                · {t(`ac.help.${section}`)}
              </span>
            </div>

            <ul className="space-y-1.5">
              {list.map((a) => (
                <ActionCardRow key={a.id} item={a} section={section} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** One operational card. Server component — no client JS for the card body;
 *  only the notes <details> uses native browser state.
 *
 *  Density layout (m076): title + role + context chips all ride a SINGLE
 *  line, so a slip card now reads horizontally:
 *
 *      Production delayed · [OPS] · Initial Jul 02 · Current Aug 21 · +50d ↘ [tag][amount][50d][Open][Done]
 *
 *  Subtitle + "Added Xd ago" + notes share one quiet footer line. Saves
 *  ~40% vertical space vs the previous 4-row layout — operators can hold
 *  3–4 cards on screen instead of 1–2. */
function ActionCardRow({
  item: a,
  section,
}: {
  item: ActionItem;
  section: string;
}) {
  const chip = ROLE_CHIP[a.roles[0] ?? "management"];
  const openedAgo = openedAgoLabel(a.openedDaysAgo);
  return (
    <li className="group rounded-lg border border-neutral-200 bg-white px-3 py-2 hover:border-neutral-300 hover:shadow-sm transition-all">
      {/* Single-line title row — title + role + inline context chips on the
          left, SLA tag / amount / issue magnitude / Open / Done on the right.
          flex-wrap lets long titles + many chips overflow gracefully on
          narrow viewports without breaking the right cluster. */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
          <Link
            href={a.href}
            className="text-[13px] font-medium text-neutral-900 group-hover:text-solux"
          >
            {a.title}
          </Link>
          <span
            className={`rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${chip.cls}`}
          >
            {chip.label}
          </span>
          {a.contextChips.map((c, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] ${
                CHIP_TONE[c.tone ?? "neutral"]
              }`}
            >
              <span className="opacity-60">{c.label}</span>
              <span className="font-semibold tabular-nums">{c.value}</span>
            </span>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {a.tag && (
            <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-rose-700">
              {a.tag}
            </span>
          )}
          {a.amount && (
            <span className="text-[11px] tabular-nums text-neutral-600 whitespace-nowrap">
              {a.amount.currency} {a.amount.value.toLocaleString()}
            </span>
          )}
          {a.ageDays != null && a.ageDays > 0 && (
            <span
              title="Magnitude of the underlying issue (slip days / overdue days)."
              className={`text-[10px] tabular-nums whitespace-nowrap ${
                section === "urgent"
                  ? "text-rose-600 font-medium"
                  : "text-neutral-400"
              }`}
            >
              {a.ageDays}d
            </span>
          )}
          <Link
            href={a.href}
            className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50 whitespace-nowrap"
          >
            Open
          </Link>
          {/* "Done" only for items the registry marks resolution = "manual"
              (off-app follow-ups). In-app actions (auto_clear) self-clear. */}
          {a.resolution === "manual" && (
            <form action={markActionDone}>
              <input type="hidden" name="action_key" value={a.id} />
              <button className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 whitespace-nowrap">
                ✓ Done
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Quiet footer — subtitle + card open age on the left, notes on the
          right. Single line, small type, low contrast. */}
      <div className="mt-1 flex items-center justify-between gap-3 text-[11px]">
        <div className="min-w-0 flex-1 truncate text-neutral-500">
          <span className="truncate">{a.subtitle}</span>
          {openedAgo && (
            <span
              title={sinceTitle(a.since)}
              className={`ml-2 ${
                a.openedDaysAgo != null && a.openedDaysAgo >= 7
                  ? "text-amber-700"
                  : "text-neutral-400"
              }`}
            >
              · {openedAgo}
            </span>
          )}
        </div>
        <NotesPane item={a} />
      </div>
    </li>
  );
}

/**
 * Tiny native-collapsible notes pane. No client JS — the browser handles
 * the open/close state via <details>. The notes list is pre-rendered;
 * adding / deleting goes through server actions and revalidates the page.
 */
function NotesPane({ item }: { item: ActionItem }) {
  return (
    <details className="group/notes shrink-0">
      <summary
        className={`list-none cursor-pointer select-none rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap hover:text-neutral-700 hover:bg-neutral-50 ${
          item.noteCount > 0
            ? "text-violet-700 font-medium"
            : "text-neutral-400"
        }`}
      >
        {item.noteCount > 0 ? `💬 ${item.noteCount}` : "+ note"}
      </summary>
      <div className="mt-2 space-y-2 rounded-md border border-neutral-100 bg-neutral-50/60 p-2">
        {item.notes.length > 0 && (
          <ul className="space-y-1.5">
            {item.notes.map((n) => (
              <NoteRow key={n.id} note={n} />
            ))}
          </ul>
        )}
        <form
          action={addActionNote}
          className="flex items-start gap-2"
        >
          <input type="hidden" name="entity_type" value={item.entityType} />
          <input type="hidden" name="entity_id" value={item.entityId} />
          <input
            type="text"
            name="body"
            required
            maxLength={2000}
            placeholder="Quick note — “Factory confirmed shipment”, “Client informed”, “Waiting supplier reply”…"
            className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[12px] focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-300"
          />
          <button className="rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-100 whitespace-nowrap">
            Post
          </button>
        </form>
      </div>
    </details>
  );
}

function NoteRow({ note }: { note: ActionNote }) {
  const when = new Date(note.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <li className="flex items-start gap-2 text-[12px] text-neutral-700">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
      <div className="min-w-0 flex-1">
        <div className="leading-snug">{note.body}</div>
        <div className="mt-0.5 text-[10px] text-neutral-400">
          {note.authorLabel} · {when}
        </div>
      </div>
    </li>
  );
}
