"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  SEVERITY_PILL,
  SEVERITY_LABEL,
  STATUS_PILL,
  STATUS_LABEL,
  WAITING_FOR_LABEL,
  WAITING_FOR_PILL,
  EVENT_WAITING_FOR_VALUES,
  eventTypeLabel,
  eventEntityHref,
  type EventRow,
  type EventComment,
  type EventStatus,
  type EventWaitingFor,
} from "@/lib/events-shared";
import {
  acknowledgeEvent,
  markEventWorking,
  markEventWaiting,
  escalateEvent,
  resolveEvent,
  reopenEvent,
  claimEventOwnership,
  releaseEventOwnership,
  addEventComment,
  markEventRead,
} from "@/app/(app)/dashboard/event-actions";

/**
 * Right-side slide-in drawer — collaborative ticket for one event.
 *
 * v2 (m044): event becomes a mini-ticket with rich workflow:
 *
 *   Header        ─ severity · status · waiting_for sub-pill · owner
 *   Meta          ─ entity link · timestamps
 *   Quick actions ─ Acknowledge / Working / Waiting [reason] / Escalate / Resolve / Reopen
 *   Ownership     ─ "Owned by X · Release" OR "Claim ownership"
 *   Comments      ─ thread (oldest first) with optimistic insert
 *   Quick replies ─ pre-filled templates for "Ask sales / ops / supplier"
 *
 * Status transitions are permissive — any state can move to any other
 * state from the drawer. The buttons surface only the transitions
 * that make operational sense from the current state to avoid noise.
 */

/* ===========================================================================
   Quick-comment templates — pre-fill the textarea so the user just
   has to add their specific details + post.
   =========================================================================== */
const QUICK_COMMENT_TEMPLATES: Array<{ label: string; text: string }> = [
  {
    label: "Ask sales",
    text: "@sales — could you confirm the client's status on this? ",
  },
  {
    label: "Ask operations",
    text: "@operations — could you check the production side? ",
  },
  {
    label: "Ask supplier",
    text: "Supplier follow-up needed — pinged them about ",
  },
  {
    label: "Client confirmed",
    text: "Client confirmed: ",
  },
  {
    label: "Working on it",
    text: "I'm on it. Status: ",
  },
];

export function EventDetailDrawer({
  event,
  initialComments,
  open,
  onClose,
  actorLabel,
  currentUserId,
  initialLastReadAt,
}: {
  event: EventRow | null;
  initialComments: EventComment[];
  open: boolean;
  onClose: () => void;
  actorLabel?: Map<string, string>;
  /** Current user id — used to exclude self-comments from the
   *  "unread since last visit" highlight. */
  currentUserId?: string | null;
  /** Server-captured snapshot of the user's `event_reads.last_read_at`
   *  for this event AT THE MOMENT the page was rendered. Comments
   *  newer than this AND not authored by `currentUserId` render with
   *  the unread highlight (rose ring + "NEW" badge). The snapshot
   *  survives the auto-mark-read side effect that fires when the
   *  drawer opens, so the highlight stays during the session. */
  initialLastReadAt?: string | null;
}) {
  const [comments, setComments] = useState<EventComment[]>(initialComments);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [waitingOpen, setWaitingOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Snapshot of last_read_at captured ONCE when the drawer first
  // opens for an event. Stays stable so the highlight survives the
  // markEventRead auto-fire and any subsequent comments in the same
  // session. Reset whenever a different event is opened.
  const [readSnapshot, setReadSnapshot] = useState<string | null>(null);
  // Comments refs by id — drives the auto-scroll on first unread.
  const commentRefs = useRef<Record<string, HTMLLIElement | null>>({});
  // Tracks the event id we last auto-scrolled for so we don't scroll
  // again every time `comments` changes (e.g. after optimistic add).
  const lastScrolledEventId = useRef<string | null>(null);

  /** Is this comment unread relative to the snapshot? */
  function isCommentUnread(c: EventComment): boolean {
    if (currentUserId && c.user_id === currentUserId) return false; // own
    if (!readSnapshot) return true; // user has never opened this event
    return new Date(c.created_at).getTime() > new Date(readSnapshot).getTime();
  }

  // Reset state each time a different event is opened. We also
  // capture the lastReadAt snapshot here so it stays stable for the
  // whole session (auto-mark-read won't move the highlight).
  useEffect(() => {
    setComments(initialComments);
    setDraft("");
    setError(null);
    setWaitingOpen(false);
    setReadSnapshot(initialLastReadAt ?? null);
  }, [event?.id, initialComments, initialLastReadAt]);

  // Auto-scroll to the first unread comment when the drawer opens
  // (or when a different event is opened). Runs once per event-id so
  // optimistic adds later in the session don't re-scroll.
  useEffect(() => {
    if (!open || !event) return;
    if (lastScrolledEventId.current === event.id) return;
    // Defer to next frame so the drawer transition starts first and
    // the list is mounted. 150ms is enough for the slide-in (200ms
    // total) without feeling laggy.
    const t = setTimeout(() => {
      const firstUnread = comments.find(isCommentUnread);
      if (firstUnread) {
        const el = commentRefs.current[firstUnread.id];
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      lastScrolledEventId.current = event.id;
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id, readSnapshot]);

  // Auto-mark the event as read whenever the drawer opens. Fire-and-
  // forget — the server action is a soft-fail (warn-only), so a stale
  // schema or network blip never breaks the drawer UX. Runs only when
  // the drawer is OPEN (not just mounted) so closed-but-cached drawer
  // state doesn't fire spurious read events.
  useEffect(() => {
    if (!open || !event) return;
    const fd = new FormData();
    fd.set("event_id", event.id);
    // Server action — discard the promise (no UI feedback needed).
    markEventRead(fd).catch(() => {
      // Already logged server-side; swallow client-side rejection so
      // the unhandled-rejection console noise stays quiet.
    });
  }, [open, event?.id]);

  // ESC closes the drawer.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!event) return null;

  const status = (event.status ?? "open") as EventStatus;
  const entityHref = eventEntityHref(event);
  const waitingFor = (event.waiting_for ?? null) as EventWaitingFor | null;
  const ownerLabel = event.owner_id
    ? actorLabel?.get(event.owner_id) ??
      event.owner_id.slice(0, 8) + "…"
    : null;

  /** Run a server action with an event_id form field. */
  function callStatusAction(
    action: (fd: FormData) => Promise<void>,
    extras?: Record<string, string>
  ) {
    if (!event) return;
    setError(null);
    const fd = new FormData();
    fd.set("event_id", event.id);
    if (extras) {
      for (const [k, v] of Object.entries(extras)) fd.set(k, v);
    }
    startTransition(async () => {
      try {
        await action(fd);
        setWaitingOpen(false);
        // Don't auto-close on every status change — the user often wants
        // to add a comment right after. Only close on explicit close.
      } catch (err: any) {
        if (err?.digest?.startsWith("NEXT_REDIRECT")) throw err;
        setError(err?.message || "Action failed");
      }
    });
  }

  function submitComment() {
    if (!event) return;
    const text = draft.trim();
    if (!text) return;
    setError(null);
    const fd = new FormData();
    fd.set("event_id", event.id);
    fd.set("comment", text);
    const optimistic: EventComment = {
      id: `tmp-${Date.now()}`,
      event_id: event.id,
      user_id: null,
      comment: text,
      created_at: new Date().toISOString(),
    };
    setComments((prev) => [...prev, optimistic]);
    setDraft("");
    startTransition(async () => {
      try {
        await addEventComment(fd);
      } catch (err: any) {
        if (err?.digest?.startsWith("NEXT_REDIRECT")) throw err;
        setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
        setDraft(text);
        setError(err?.message || "Could not add comment");
      }
    });
  }

  /** Apply a quick-comment template: fill textarea + focus + place
   *  cursor at the end so the user can keep typing right away. */
  function applyTemplate(text: string) {
    setDraft(text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(text.length, text.length);
      }
    });
  }

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-40 bg-neutral-900/30 transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />

      <aside
        role="dialog"
        aria-label="Event detail"
        className={`fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[500px] bg-white border-l border-neutral-200 shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        } flex flex-col`}
      >
        {/* HEADER */}
        <header className="p-5 border-b border-neutral-200 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-widerx border ${SEVERITY_PILL[event.severity]}`}
              >
                {SEVERITY_LABEL[event.severity]}
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-widerx border ${STATUS_PILL[status]}`}
              >
                {STATUS_LABEL[status]}
              </span>
              {/* Waiting_for sub-pill — only when relevant. */}
              {waitingFor && status === "waiting" && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-widerx border ${WAITING_FOR_PILL[waitingFor]}`}
                >
                  {WAITING_FOR_LABEL[waitingFor]}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-neutral-400 hover:text-neutral-700 transition-colors"
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M4 4l12 12M16 4L4 16" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widerx text-neutral-500 font-semibold">
              {eventTypeLabel(event.event_type)}
            </div>
            <h2 className="text-sm font-semibold text-neutral-900 mt-0.5">
              {event.message}
            </h2>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-neutral-600 pt-1">
            <div>
              <dt className="text-neutral-400 uppercase tracking-widerx text-[9px]">
                Created
              </dt>
              <dd className="font-mono">
                {new Date(event.created_at).toLocaleString()}
              </dd>
            </div>
            {event.acknowledged_at && (
              <div>
                <dt className="text-neutral-400 uppercase tracking-widerx text-[9px]">
                  Acknowledged
                </dt>
                <dd className="font-mono">
                  {new Date(event.acknowledged_at).toLocaleString()}
                </dd>
              </div>
            )}
            {event.resolved_at && (
              <div>
                <dt className="text-neutral-400 uppercase tracking-widerx text-[9px]">
                  Resolved
                </dt>
                <dd className="font-mono">
                  {new Date(event.resolved_at).toLocaleString()}
                </dd>
              </div>
            )}
            {event.due_date && (
              <div>
                <dt className="text-neutral-400 uppercase tracking-widerx text-[9px]">
                  Due
                </dt>
                <dd className="font-mono">
                  {new Date(event.due_date).toLocaleDateString("en-GB")}
                </dd>
              </div>
            )}
          </dl>
          {entityHref && (
            <Link
              href={entityHref}
              className="inline-flex items-center gap-1 text-[11px] text-neutral-700 hover:text-neutral-900 hover:underline mt-1"
            >
              Open related {event.entity_type.replace(/_/g, " ")} →
            </Link>
          )}
        </header>

        {/* OWNERSHIP STRIP */}
        <div className="px-5 py-2 border-b border-neutral-200 bg-neutral-50/40 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-neutral-400 uppercase tracking-widerx text-[9px] font-semibold">
              Owner
            </span>
            {ownerLabel ? (
              <span className="text-neutral-800 font-medium">
                {ownerLabel}
                {event.owner_assigned_at && (
                  <span className="text-neutral-400 ml-1">
                    · since{" "}
                    {new Date(event.owner_assigned_at).toLocaleDateString("en-GB")}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-neutral-400 italic">unassigned</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {ownerLabel ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => callStatusAction(releaseEventOwnership)}
                className="text-[10px] text-neutral-500 hover:text-neutral-800 hover:underline disabled:opacity-50"
              >
                Release
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => callStatusAction(claimEventOwnership)}
                className="rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                Claim ownership
              </button>
            )}
          </div>
        </div>

        {/* QUICK ACTIONS — surface transitions that make sense from
            the current state. Resolve is always available (except
            when already resolved). Escalate is always available unless
            already escalated or resolved. */}
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center gap-1.5 flex-wrap">
          {status !== "resolved" && (
            <>
              {status !== "acknowledged" && status !== "working" && (
                <ActionBtn
                  tone="sky-light"
                  disabled={pending}
                  onClick={() => callStatusAction(acknowledgeEvent)}
                >
                  Acknowledge
                </ActionBtn>
              )}
              {status !== "working" && (
                <ActionBtn
                  tone="sky"
                  disabled={pending}
                  onClick={() => callStatusAction(markEventWorking)}
                >
                  Working on it
                </ActionBtn>
              )}
              <div className="relative">
                <ActionBtn
                  tone="amber"
                  disabled={pending}
                  onClick={() => setWaitingOpen((v) => !v)}
                  active={waitingOpen}
                >
                  Mark waiting ▾
                </ActionBtn>
                {waitingOpen && (
                  <div className="absolute left-0 top-full mt-1 z-10 w-44 rounded-md border border-neutral-200 bg-white shadow-lg overflow-hidden">
                    {EVENT_WAITING_FOR_VALUES.map((w) => (
                      <button
                        key={w}
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          callStatusAction(markEventWaiting, {
                            waiting_for: w,
                          })
                        }
                        className="block w-full text-left px-3 py-1.5 text-xs text-neutral-700 hover:bg-amber-50 disabled:opacity-50"
                      >
                        {WAITING_FOR_LABEL[w]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {status !== "escalated" && (
                <ActionBtn
                  tone="purple"
                  disabled={pending}
                  onClick={() => callStatusAction(escalateEvent)}
                >
                  Escalate
                </ActionBtn>
              )}
              <ActionBtn
                tone="emerald"
                disabled={pending}
                onClick={() => callStatusAction(resolveEvent)}
              >
                Resolve
              </ActionBtn>
            </>
          )}
          {status === "resolved" && (
            <ActionBtn
              tone="neutral"
              disabled={pending}
              onClick={() => callStatusAction(reopenEvent)}
            >
              Re-open
            </ActionBtn>
          )}
          {pending && (
            <span className="text-[11px] text-neutral-500 ml-auto">
              Working…
            </span>
          )}
        </div>

        {error && (
          <div className="mx-5 mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </div>
        )}

        {/* COMMENTS THREAD */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className="text-[11px] uppercase tracking-widerx font-semibold text-neutral-500">
            Comments · {comments.length}
          </div>
          {comments.length === 0 ? (
            <p className="text-xs text-neutral-500 italic">
              No comments yet. Add context — what's the status, who's
              following up, what's blocking?
            </p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => {
                const author = c.user_id
                  ? actorLabel?.get(c.user_id) ?? c.user_id.slice(0, 8) + "…"
                  : "system";
                const isOptimistic = c.id.startsWith("tmp-");
                const isUnread = !isOptimistic && isCommentUnread(c);
                return (
                  <li
                    key={c.id}
                    ref={(el) => {
                      commentRefs.current[c.id] = el;
                    }}
                    className={`rounded-md border px-3 py-2 transition-colors ${
                      isOptimistic
                        ? "border-neutral-200 bg-neutral-50 opacity-70"
                        : isUnread
                        ? "border-rose-300 bg-rose-50/60 ring-2 ring-rose-200"
                        : "border-neutral-200 bg-white"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-widerx text-neutral-500">
                          {author}
                        </span>
                        {isUnread && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widerx border border-rose-300 bg-rose-100 text-rose-800"
                            title="New since your last visit"
                          >
                            <span className="w-1 h-1 rounded-full bg-rose-600" />
                            New
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] text-neutral-400 tabular-nums">
                        {new Date(c.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-800 whitespace-pre-wrap leading-relaxed">
                      {c.comment}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ADD COMMENT + QUICK TEMPLATES */}
        <div className="p-4 border-t border-neutral-200 bg-neutral-50/50 space-y-2">
          {/* Quick-comment templates row */}
          <div className="flex items-center gap-1 flex-wrap">
            {QUICK_COMMENT_TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => applyTemplate(t.text)}
                disabled={pending}
                className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50 transition-colors"
                title={`Insert: "${t.text}"`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment… (Cmd-Enter to submit)"
            rows={3}
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitComment();
              }
            }}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs focus:outline-none focus:border-neutral-500 disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-neutral-400">
              {draft.length} / 2000
            </span>
            <button
              type="button"
              disabled={pending || !draft.trim()}
              onClick={submitComment}
              className="rounded-md border border-neutral-900 bg-neutral-900 text-white px-3 py-1.5 text-xs font-semibold hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {pending ? "Posting…" : "Post comment"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ===========================================================================
   ActionBtn — internal helper for the consistent quick-action buttons.
   =========================================================================== */

function ActionBtn({
  children,
  tone,
  disabled,
  onClick,
  active,
}: {
  children: React.ReactNode;
  tone: "sky-light" | "sky" | "amber" | "purple" | "emerald" | "neutral";
  disabled?: boolean;
  onClick: () => void;
  active?: boolean;
}) {
  const toneClass = {
    "sky-light":
      "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100",
    sky: "border-sky-700 bg-sky-600 text-white hover:bg-sky-700",
    amber:
      "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100",
    purple:
      "border-purple-300 bg-purple-50 text-purple-800 hover:bg-purple-100",
    emerald:
      "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    neutral:
      "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
  }[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-60 transition-colors ${toneClass} ${
        active ? "ring-2 ring-offset-1 ring-neutral-400" : ""
      }`}
    >
      {children}
    </button>
  );
}
