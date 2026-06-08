"use client";

import { useFormStatus } from "react-dom";

/**
 * Form-submit button with automatic pending state.
 *
 * Drops into any `<form action={serverAction}>` and uses React's
 * `useFormStatus()` to know when the parent form is submitting. While
 * pending the button:
 *   - becomes disabled (prevents double-submit)
 *   - shows a tiny spinner + the `pendingLabel` (or "Working…")
 *   - keeps the same visual size so the layout doesn't jump
 *
 * This is the standard React 18 + Next 14 pattern for action feedback.
 * It does NOT require any client state in the parent — useFormStatus
 * subscribes directly to the form's submission state.
 *
 * Usage:
 *   <form action={saveStuff}>
 *     <SubmitButton variant="primary">Save</SubmitButton>
 *   </form>
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className = "",
  title,
  disabled = false,
}: {
  children: React.ReactNode;
  /** Label shown while submitting. Defaults to "Working…". */
  pendingLabel?: string;
  variant?:
    | "primary"
    | "secondary"
    | "ghost"
    | "danger"
    | "amber"
    | "violet"
    | "neutral-dark";
  size?: "xs" | "sm" | "md";
  className?: string;
  title?: string;
  /** External disabled state. Combined with pending — either disables the button. */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const isPending = pending;
  const isDisabled = disabled || pending;

  // Variant → tailwind classes. Each variant has both idle + disabled looks.
  const variantClass = {
    primary:
      "bg-solux text-white hover:bg-solux-dark border-transparent disabled:bg-solux/50",
    secondary:
      "bg-white text-neutral-700 hover:bg-neutral-50 border-neutral-200 disabled:bg-neutral-50",
    ghost:
      "bg-transparent text-neutral-700 hover:bg-neutral-100 border-transparent disabled:opacity-50",
    danger:
      "bg-rose-50 text-rose-700 hover:bg-rose-100 border-rose-300 disabled:opacity-50",
    amber:
      "bg-amber-900 text-white hover:bg-amber-800 border-transparent disabled:opacity-50",
    violet:
      "bg-violet-50 text-violet-700 hover:bg-violet-100 border-violet-300 disabled:opacity-50",
    "neutral-dark":
      "bg-neutral-900 text-white hover:bg-neutral-800 border-transparent disabled:opacity-50",
  }[variant];

  const sizeClass = {
    xs: "px-2 py-0.5 text-[10px]",
    sm: "px-2.5 py-1 text-[11px]",
    md: "px-3.5 py-1.5 text-xs",
  }[size];

  return (
    <button
      type="submit"
      disabled={isDisabled}
      title={title}
      aria-busy={isPending}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors ${variantClass} ${sizeClass} disabled:cursor-not-allowed ${className}`}
    >
      {isPending && <Spinner />}
      <span>{isPending ? (pendingLabel ?? "Working…") : children}</span>
    </button>
  );
}

/**
 * Tiny inline spinner — pure SVG, GPU-friendly (transform animation).
 * Sized to match the surrounding text via 1em.
 */
function Spinner() {
  return (
    <svg
      className="animate-spin h-3 w-3 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.25"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Pill-style submit — for status switchers / quick-action chips.
 *
 * Same useFormStatus hook, slimmer visual: rounded-full pill, small
 * font, optional active state (when the pill represents the current
 * value of a multi-choice control).
 */
export function SubmitPill({
  children,
  pendingLabel,
  active = false,
  className = "",
  title,
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  /** When true, renders with the "selected" appearance. */
  active?: boolean;
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const isPending = pending;
  const isDisabled = disabled || pending;

  const stateClass = active
    ? "bg-neutral-900 text-white border-neutral-900"
    : "bg-white text-neutral-700 hover:bg-neutral-50 border-neutral-200";

  return (
    <button
      type="submit"
      disabled={isDisabled}
      title={title}
      aria-busy={isPending}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${stateClass} ${className}`}
    >
      {isPending && <Spinner />}
      <span>{isPending ? (pendingLabel ?? "…") : children}</span>
    </button>
  );
}
