import type { DocStatus } from "@/lib/types";
import { DOC_STATUSES, DOC_STATUS_LABEL } from "@/lib/types";

/**
 * Color scheme for the six quotation statuses. Used everywhere a status
 * needs to be displayed inline. Keep this in sync with InlineStatusSwitcher
 * so the badge and the dropdown look consistent.
 */
const STYLES: Record<DocStatus, { bg: string; dot: string }> = {
  draft: {
    bg: "border border-neutral-300 bg-white text-neutral-600",
    dot: "bg-neutral-400",
  },
  sent: {
    bg: "border border-sky-300 bg-sky-50 text-sky-800",
    dot: "bg-sky-500",
  },
  negotiating: {
    bg: "border border-amber-300 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  won: {
    bg: "border-emerald-500 bg-emerald-500 text-white",
    dot: "bg-white",
  },
  lost: {
    bg: "border border-red-300 bg-red-50 text-red-700",
    dot: "bg-red-500",
  },
  cancelled: {
    bg: "border border-neutral-200 bg-neutral-50 text-neutral-400",
    dot: "bg-neutral-300",
  },
};

export function StatusBadge({
  status,
  size = "sm",
}: {
  status: DocStatus | string | null | undefined;
  size?: "sm" | "md";
}) {
  const raw = (status ?? "draft").toString().toLowerCase();
  const s: DocStatus = (
    DOC_STATUSES.includes(raw as DocStatus) ? raw : "draft"
  ) as DocStatus;
  const sizing =
    size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  const style = STYLES[s];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizing} ${style.bg}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {DOC_STATUS_LABEL[s]}
    </span>
  );
}
