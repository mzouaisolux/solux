"use client";

// =====================================================================
// Contextual help popover (client island). A small ⓘ icon that, on hover
// or click, explains an event in plain business language: when it happens,
// why anyone would care, and who is normally notified.
//
// Accessible: it's a real <button> (keyboard-focusable, aria-expanded).
// Hover opens it; click PINS it open so the reader can move the pointer in;
// Escape or an outside click closes a pinned popover. Content is passed in
// (serializable) so the same component serves the index table and the
// per-event page.
// =====================================================================

import { useEffect, useId, useRef, useState } from "react";
import type { EventHelp as EventHelpData } from "@/lib/event-help";

export default function EventHelp({
  title,
  help,
  align = "left",
}: {
  /** Event label — shown as the popover heading + used for aria. */
  title: string;
  help: EventHelpData;
  /** Which edge of the icon the popover hangs from. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popId = useId();

  // While pinned, close on Escape or any click outside the widget.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPinned(false);
        setOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPinned(false);
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [pinned]);

  return (
    <span
      ref={wrapRef}
      className="evt-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => !pinned && setOpen(false)}
    >
      <button
        type="button"
        className="evt-help-btn"
        aria-expanded={open}
        aria-controls={popId}
        aria-label={`What does "${title}" mean?`}
        onClick={() => {
          const next = !pinned;
          setPinned(next);
          setOpen(next);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
      >
        i
      </button>

      {open && (
        <span
          id={popId}
          role="tooltip"
          className={`evt-help-pop align-${align}`}
        >
          <span className="evt-help-title">{title}</span>

          <span className="evt-help-block">
            <span className="evt-help-q">When does this happen?</span>
            <span className="evt-help-a">{help.when}</span>
          </span>

          <span className="evt-help-block">
            <span className="evt-help-q">Why would someone care?</span>
            <span className="evt-help-a">{help.why}</span>
          </span>

          <span className="evt-help-block">
            <span className="evt-help-q">Typical recipients</span>
            <span className="evt-help-recipients">
              {help.recipients.map((r, i) => (
                <span key={r} className="evt-help-role">
                  {i > 0 && <span className="evt-help-arrow" aria-hidden>→</span>}
                  {r}
                </span>
              ))}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
