"use client";

// =====================================================================
// NumericField (m172, Pricing UX) — an Excel-like numeric input.
//   • no pre-filled "0": an empty/zero value shows a placeholder ("—"), so
//     the user never has to delete a zero before typing.
//   • select-all on focus: click a field → the whole value is selected →
//     type to replace it.
//   • no aggressive reformatting/recalc while typing: keystrokes only touch a
//     local draft; the parent is notified ONCE, on commit (blur / Enter). This
//     is what keeps the caret stable and stops the "loses focus" churn.
//   • keyboard: Tab/Shift+Tab (native), Enter = commit (never submits the
//     form), Escape = cancel the edit and restore.
// The parent stays the source of truth; NumericField is fully controlled
// between edits, and self-controlled (draft) during an edit.
// =====================================================================

import { useState } from "react";

export function NumericField({
  value,
  onCommit,
  disabled = false,
  placeholder = "—",
  className,
  ariaLabel,
  min,
  max,
  prefix,
  suffix,
}: {
  /** Committed numeric value (null/0 render as the placeholder). */
  value: number | null;
  /** Called once per edit, on blur or Enter. null = field left empty. */
  onCommit: (n: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  min?: number;
  max?: number;
  prefix?: string;
  suffix?: string;
}) {
  // draft === null → not editing (show the committed value).
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const shown =
    value == null || value === 0
      ? ""
      : // strip trailing .00 noise but keep meaningful decimals
        String(Math.round(value * 100) / 100);
  const display = editing ? (draft as string) : shown;

  function commit(raw: string) {
    const t = raw.trim();
    if (t === "") {
      onCommit(null);
      return;
    }
    let n = Number(t.replace(",", "."));
    if (!Number.isFinite(n)) return; // ignore garbage — keep previous value
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    onCommit(n);
  }

  return (
    <div className="relative flex items-center">
      {prefix && (
        <span className="pointer-events-none absolute left-2 text-[12px] text-neutral-400">{prefix}</span>
      )}
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={display}
        style={prefix ? { paddingLeft: 18 } : undefined}
        className={className}
        onFocus={(e) => {
          setDraft(shown);
          // select-all so typing replaces the value (Excel behaviour).
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (editing) {
            commit(draft as string);
            setDraft(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Never let Enter submit the surrounding pricing form.
            e.preventDefault();
            commit((draft ?? shown) as string);
            setDraft(null);
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null); // discard the edit
            e.currentTarget.blur();
          }
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 text-[12px] text-neutral-400">{suffix}</span>
      )}
    </div>
  );
}
