// =====================================================================
// Affair operational progress strip — replaces the textual timeline in the
// affair preview with the 6-phase flight strip the team thinks in:
//   Quote → Task List → Payment → Production → Shipping → Delivered
// Reuses ORDER_FLIGHT_PHASES (lib/lifecycle.ts). Phase is derived from the
// affair's already-computed `stage` — no new data. Pure presentational.
// =====================================================================

import { ORDER_FLIGHT_PHASES } from "@/lib/lifecycle";
import type { AffairGroup } from "@/lib/affairs-prototype";

type AffairPhaseInput = Pick<AffairGroup, "stage" | "effectiveStatus">;

/** Map the affair's derived stage to a 0..5 flight-phase index. */
export function affairPhaseIndex(affair: AffairPhaseInput): number {
  switch (affair.stage) {
    case "delivered":
      return 5;
    case "ready_to_ship":
      return 4;
    case "in_production":
    case "production_delayed":
      return 3;
    case "task_list_created":
      return 2; // task list exists → next operational step is Payment
    case "task_list_missing":
      return 1; // won but no task list yet
    default:
      return affair.effectiveStatus === "won" ? 1 : 0; // Quote stage
  }
}

/** Current-phase label (or "Cancelled"). */
export function affairPhaseLabel(affair: AffairPhaseInput): string {
  if (affair.stage === "cancelled") return "Cancelled";
  return ORDER_FLIGHT_PHASES[affairPhaseIndex(affair)] ?? "Quote";
}

export type AffairOpTone =
  | "neutral"
  | "amber"
  | "sky"
  | "violet"
  | "emerald"
  | "red";

/**
 * The AFFAIR's OPERATIONAL status — owned by the affair, NOT its quotation
 * versions (the business correction: versions keep only draft/sent/won/lost).
 * Derived from the affair's stage + alerts.
 */
export function affairOperationalStatus(
  affair: Pick<AffairGroup, "stage" | "effectiveStatus" | "alerts">,
): { label: string; tone: AffairOpTone } {
  if (affair.stage === "cancelled") return { label: "Cancelled", tone: "neutral" };
  if (affair.alerts.includes("Awaiting deposit"))
    return { label: "Awaiting deposit", tone: "amber" };
  switch (affair.stage) {
    case "delivered":
      return { label: "Delivered", tone: "emerald" };
    case "ready_to_ship":
      return { label: "Shipping", tone: "violet" };
    case "production_delayed":
      return { label: "Delayed", tone: "red" };
    case "in_production":
      return { label: "In production", tone: "amber" };
    case "task_list_created":
      return { label: "Deposit received", tone: "sky" };
    case "task_list_missing":
      return { label: "Task list to create", tone: "amber" };
    default:
      if (affair.effectiveStatus === "won")
        return { label: "Won", tone: "emerald" };
      return {
        label:
          affair.effectiveStatus.charAt(0).toUpperCase() +
          affair.effectiveStatus.slice(1),
        tone: "neutral",
      };
  }
}

export type AffairAccentKey = "green" | "orange" | "red" | "neutral";

export type AffairAccent = {
  key: AffairAccentKey;
  /** thin status edge / dot background */
  bar: string;
  /** status-word text color */
  text: string;
};

const ACCENTS: Record<AffairAccentKey, Omit<AffairAccent, "key">> = {
  green: { bar: "bg-emerald-500", text: "text-emerald-700" },
  orange: { bar: "bg-amber-500", text: "text-amber-700" },
  red: { bar: "bg-rose-500", text: "text-rose-700" },
  neutral: { bar: "bg-neutral-300", text: "text-neutral-500" },
};

/**
 * The ONE semantic accent for an affair (calm B2B palette — no decorative
 * blue/purple). Green = won/success, Orange = follow-up/warning, Red =
 * problem/overdue/lost, Neutral = everything else (incl. on-track production).
 * Priority: Red → Orange → Green → Neutral.
 */
export function affairAccent(
  affair: Pick<
    AffairGroup,
    "stage" | "effectiveStatus" | "lifecycleStatus" | "isArchived" | "alerts"
  >,
): AffairAccent {
  const life = (affair.lifecycleStatus ?? "").toLowerCase();
  const eff = affair.effectiveStatus;

  const isProblem =
    affair.stage === "cancelled" ||
    affair.stage === "production_delayed" ||
    eff === "lost" ||
    eff === "cancelled" ||
    life === "lost" ||
    life === "abandoned";
  const isWarning =
    (affair.alerts?.length ?? 0) > 0 ||
    eff === "negotiating" ||
    life === "negotiation";
  const isSuccess =
    eff === "won" ||
    life === "won" ||
    life === "completed" ||
    affair.stage === "delivered";

  const key: AffairAccentKey = isProblem
    ? "red"
    : isWarning
      ? "orange"
      : isSuccess
        ? "green"
        : "neutral";

  return { key, ...ACCENTS[key] };
}

/**
 * Compact single-line operational tracker: ✓ done · ● current · ○ pending.
 * Grayscale only — minimal height, no container. Quote → … → Delivered.
 */
export function AffairProgressStrip({ affair }: { affair: AffairPhaseInput }) {
  if (affair.stage === "cancelled") {
    return <span className="text-[11px] font-medium text-rose-600">Cancelled</span>;
  }
  const current = affairPhaseIndex(affair);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {ORDER_FLIGHT_PHASES.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <span key={label} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span
              className={`text-[11px] leading-none ${
                done
                  ? "text-neutral-800"
                  : active
                    ? "text-neutral-900"
                    : "text-neutral-300"
              }`}
              aria-hidden
            >
              {done ? "✓" : active ? "●" : "○"}
            </span>
            <span
              className={`text-[11px] ${
                done || active
                  ? "font-medium text-neutral-700"
                  : "text-neutral-400"
              }`}
            >
              {label}
            </span>
          </span>
        );
      })}
    </div>
  );
}
