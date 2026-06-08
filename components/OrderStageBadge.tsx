import {
  computeOrderFlightStage,
  type OrderStageInput,
  type OrderStageTone,
} from "@/lib/lifecycle";

/**
 * The single, reusable operational-stage chip — same source of truth as the
 * Orders-in-Flight strip (computeOrderFlightStage). Drop it anywhere an order's
 * real lifecycle stage should be shown (operations table, order detail, client
 * rows…) so the whole app speaks one stage vocabulary.
 */
export const ORDER_STAGE_TONE: Record<OrderStageTone, { pill: string; dot: string }> = {
  neutral: { pill: "border-neutral-200 bg-neutral-50 text-neutral-700", dot: "bg-neutral-400" },
  sky: { pill: "border-sky-200 bg-sky-50 text-sky-800", dot: "bg-sky-500" },
  amber: { pill: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  violet: { pill: "border-violet-200 bg-violet-50 text-violet-800", dot: "bg-violet-500" },
  emerald: { pill: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-600" },
  red: { pill: "border-red-200 bg-red-50 text-red-700", dot: "bg-red-500" },
};

export function OrderStageBadge({
  input,
  showContext = false,
  className = "",
}: {
  input: OrderStageInput;
  /** Show the plain-English context line under the badge. */
  showContext?: boolean;
  className?: string;
}) {
  const stage = computeOrderFlightStage(input);
  const tone = ORDER_STAGE_TONE[stage.tone];
  return (
    <span className={`inline-flex flex-col gap-0.5 ${className}`}>
      <span
        title={stage.context}
        className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${tone.pill}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        {stage.label}
      </span>
      {showContext && (
        <span className="text-[10px] text-neutral-500 leading-snug">
          {stage.context}
        </span>
      )}
    </span>
  );
}
