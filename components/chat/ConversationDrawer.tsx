"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  postEntityComment,
  markEntityRead,
} from "@/app/(app)/_actions/entity-messages";
import {
  authorInitials,
  authorLabel,
  type EntityMessageEntityType,
  type EntityMessageWithAuthor,
} from "@/lib/entity-messages-shared";
import { ENTITY_TYPE_LABEL } from "@/lib/conversation-context";

/**
 * Slide-in conversation drawer.
 *
 * Renders nothing when there's no entity context (the launcher
 * already hides itself in that case, but defensive).
 *
 * Lifecycle
 * ---------
 * - On open + on (entity_type, entity_id) change: fetch the thread
 *   from `/api/conversations/[type]/[id]` and immediately call
 *   `markEntityRead` so the unread badge clears.
 * - On send: optimistic-append the new message, fire the server
 *   action, then re-fetch to reconcile (in case other people posted
 *   meanwhile). Failures roll back the optimistic message + show
 *   an inline error.
 *
 * Read state stays per-user — no cross-user broadcasts. A2 will add
 * polling / realtime; A1 ships with "re-fetch on submit + on open"
 * which is enough for the operational tempo we're chasing.
 */

type ConversationPayload = {
  messages: EntityMessageWithAuthor[];
  unread: number;
  entity_title: string | null;
  /** Secondary line — the quotation number when the title is the affair. */
  entity_subtitle?: string | null;
  current_user_id: string | null;
};

export function ConversationDrawer({
  entityType,
  entityId,
  open,
  onClose,
  onCountsChanged,
}: {
  entityType: EntityMessageEntityType;
  entityId: string;
  open: boolean;
  onClose: () => void;
  /** Fires after every re-fetch so the launcher can update its badge. */
  onCountsChanged?: (unread: number) => void;
}) {
  const router = useRouter();
  const [payload, setPayload] = useState<ConversationPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  /* ───── Fetch + mark read on open / entity change ───── */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/conversations/${entityType}/${entityId}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as ConversationPayload;
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        onCountsChanged?.(0); // we're about to mark read
        // Fire-and-forget mark-read.
        const fd = new FormData();
        fd.set("entity_type", entityType);
        fd.set("entity_id", entityId);
        markEntityRead(fd).catch(() => {});
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message ?? "Failed to load conversation");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, entityType, entityId, onCountsChanged]);

  /* ───── Auto-scroll to the bottom on message arrival ───── */
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [payload?.messages.length, open]);

  /* ───── ESC closes ───── */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* ───── Send ───── */
  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;

    setError(null);
    const fd = new FormData();
    fd.set("entity_type", entityType);
    fd.set("entity_id", entityId);
    fd.set("message", text);

    // Optimistic append — render immediately so the conversation
    // feels instantaneous. We use a sentinel id ("__tmp__") so the
    // re-fetch can reconcile cleanly.
    const optimistic: EntityMessageWithAuthor = {
      id: `__tmp__${Date.now()}`,
      entity_type: entityType,
      entity_id: entityId,
      user_id: payload?.current_user_id ?? null,
      message: text,
      message_kind: "comment",
      request_type: null,
      parent_message_id: null,
      resolved_at: null,
      resolved_by: null,
      created_at: new Date().toISOString(),
      author_email: null,
      author_name: "You",
    };
    setPayload((p) =>
      p ? { ...p, messages: [...p.messages, optimistic] } : p
    );
    setDraft("");

    startTransition(async () => {
      try {
        await postEntityComment(fd);
        // Re-fetch to swap the optimistic row for the real one + pull
        // any concurrent messages from teammates.
        const r = await fetch(
          `/api/conversations/${entityType}/${entityId}`,
          { cache: "no-store" }
        );
        if (r.ok) {
          const data = (await r.json()) as ConversationPayload;
          setPayload(data);
        }
        // Let the host page re-derive any per-row counts (the dashboard
        // badges on Orders in flight will pick this up on next nav).
        router.refresh();
      } catch (e: any) {
        // Roll back the optimistic message + show the error.
        setPayload((p) =>
          p
            ? { ...p, messages: p.messages.filter((m) => m.id !== optimistic.id) }
            : p
        );
        setDraft(text); // restore the user's draft so they don't lose it
        setError(e?.message ?? "Failed to send");
      }
    });
  };

  /* ───── Cmd/Ctrl+Enter to send ───── */
  const onKeyDownComposer = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Backdrop — soft, click to close. Pointer-events-none when
          closed so it never blocks the page underneath. */}
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-neutral-900/20 backdrop-blur-[2px] transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Drawer */}
      <aside
        aria-hidden={!open}
        aria-label="Operational conversation"
        className={`fixed top-0 right-0 z-50 h-[100dvh] w-full max-w-md bg-white border-l border-neutral-200 shadow-2xl flex flex-col transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <header className="shrink-0 px-4 py-3 border-b border-neutral-200">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
                {ENTITY_TYPE_LABEL[entityType]}
              </div>
              {/* Lead with the affair / project name so the conversation
                  always carries clear context; the quotation number sits
                  underneath as the technical reference. */}
              <h2 className="text-sm font-semibold text-neutral-900 truncate">
                {payload?.entity_title ?? "Conversation"}
              </h2>
              {payload?.entity_subtitle && (
                <div className="text-[11px] font-mono text-neutral-500 truncate">
                  {payload.entity_subtitle}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-900 transition-colors p-1 -m-1"
              aria-label="Close conversation"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Operational discussion attached to this {ENTITY_TYPE_LABEL[entityType].toLowerCase()}
          </p>
        </header>

        {/* Thread */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-neutral-50/40"
        >
          {loading && !payload && (
            <div className="text-center text-[11px] text-neutral-400 py-6">
              Loading…
            </div>
          )}
          {!loading && payload && payload.messages.length === 0 && (
            <div className="rounded-lg border border-dashed border-neutral-200 bg-white px-4 py-8 text-center">
              <p className="text-xs text-neutral-500">
                No conversation yet. Start the discussion below.
              </p>
            </div>
          )}
          {payload?.messages.map((m) => {
            const isOwn =
              m.user_id != null && m.user_id === payload.current_user_id;
            return (
              <MessageBubble
                key={m.id}
                message={m}
                isOwn={isOwn}
                pending={m.id.startsWith("__tmp__")}
              />
            );
          })}
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-neutral-200 px-3 py-2.5 bg-white">
          {error && (
            <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 mb-1.5">
              {error}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDownComposer}
              rows={1}
              placeholder="Type a message…  (⌘+Enter to send)"
              className="flex-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400 resize-none max-h-32"
              style={{
                height: Math.min(
                  128,
                  Math.max(32, 22 + draft.split("\n").length * 18)
                ),
              }}
              disabled={submitting}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={submitting || !draft.trim()}
              className="shrink-0 inline-flex items-center justify-center rounded-md bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-800 disabled:bg-neutral-300 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "…" : "Send"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function MessageBubble({
  message,
  isOwn,
  pending,
}: {
  message: EntityMessageWithAuthor;
  isOwn: boolean;
  pending: boolean;
}) {
  return (
    <div className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
      <div
        className={`h-6 w-6 shrink-0 rounded-md text-[10px] font-medium grid place-items-center ${
          isOwn
            ? "bg-neutral-900 text-white"
            : "bg-neutral-200 text-neutral-700"
        }`}
        title={authorLabel(message)}
        aria-hidden
      >
        {authorInitials(message)}
      </div>
      <div className={`min-w-0 max-w-[80%] ${isOwn ? "text-right" : ""}`}>
        <div className="flex items-baseline gap-1.5 flex-wrap">
          {!isOwn && (
            <span className="text-[10px] font-medium text-neutral-700">
              {authorLabel(message)}
            </span>
          )}
          <span className="text-[10px] tabular-nums text-neutral-400">
            {formatRelativeOrTime(message.created_at)}
          </span>
        </div>
        <div
          className={`inline-block mt-0.5 px-2.5 py-1.5 rounded-lg text-xs leading-relaxed whitespace-pre-wrap text-left ${
            isOwn
              ? "bg-neutral-900 text-white"
              : "bg-white border border-neutral-200 text-neutral-800"
          } ${pending ? "opacity-60" : ""}`}
        >
          {message.message}
        </div>
      </div>
    </div>
  );
}

function formatRelativeOrTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
}
