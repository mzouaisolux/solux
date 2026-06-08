/**
 * High-visibility banner for cancelled / deleted / terminal entities.
 *
 * Drop this above any entity detail when its status reads as a terminal
 * "stopped" state (cancelled / lost / archived). Designed to be visually
 * unmistakable so an operator can't accidentally treat a dead deal as live.
 *
 * Usage:
 *   <CancellationBanner
 *     tone="critical"
 *     title="This production order has been cancelled."
 *     detail="Cancelled by admin·a1b2c3d4 on May 14 — no further updates expected."
 *   />
 */
export function CancellationBanner({
  tone = "critical",
  title,
  detail,
  actionHref,
  actionLabel,
}: {
  tone?: "critical" | "warning" | "muted";
  title: string;
  detail?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  const palette = {
    critical: {
      border: "border-rose-300",
      bg: "bg-rose-50",
      eyebrow: "text-rose-800",
      title: "text-rose-900",
      detail: "text-rose-800",
      icon: "text-rose-600",
      action:
        "bg-rose-900 hover:bg-rose-800 text-white",
    },
    warning: {
      border: "border-amber-300",
      bg: "bg-amber-50",
      eyebrow: "text-amber-800",
      title: "text-amber-900",
      detail: "text-amber-800",
      icon: "text-amber-600",
      action:
        "bg-amber-900 hover:bg-amber-800 text-white",
    },
    muted: {
      border: "border-neutral-300",
      bg: "bg-neutral-50",
      eyebrow: "text-neutral-700",
      title: "text-neutral-900",
      detail: "text-neutral-700",
      icon: "text-neutral-500",
      action: "bg-neutral-900 hover:bg-neutral-800 text-white",
    },
  }[tone];

  return (
    <div
      className={`rounded-xl border ${palette.border} ${palette.bg} p-4`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-5 w-5 mt-0.5 shrink-0 ${palette.icon}`}
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M18 10A8 8 0 1 1 2 10a8 8 0 0 1 16 0Zm-7-4a1 1 0 1 0-2 0v4a1 1 0 1 0 2 0V6Zm-1 8a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
              clipRule="evenodd"
            />
          </svg>
          <div className="min-w-0">
            <div
              className={`text-[10px] font-semibold uppercase tracking-widerx ${palette.eyebrow}`}
            >
              {tone === "critical"
                ? "Terminal state"
                : tone === "warning"
                  ? "Attention required"
                  : "Inactive"}
            </div>
            <p className={`text-sm font-semibold mt-0.5 ${palette.title}`}>
              {title}
            </p>
            {detail && (
              <p className={`text-xs mt-1 leading-relaxed ${palette.detail}`}>
                {detail}
              </p>
            )}
          </div>
        </div>
        {actionHref && actionLabel && (
          <a
            href={actionHref}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${palette.action}`}
          >
            {actionLabel}
          </a>
        )}
      </div>
    </div>
  );
}
