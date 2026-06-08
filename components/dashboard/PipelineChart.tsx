/**
 * 12-month pipeline bar chart. Each bar shows total quotations issued
 * that month, with a green segment for the won portion stacked at the top.
 *
 * Pure CSS bars — no chart library, no client-side JS. Hover reveals
 * the exact counts.
 */
export type MonthBucket = {
  label: string; // "May" / "Jun" / etc.
  key: string; // "2026-05"
  total: number; // all quotations issued that month
  won: number; // won subset
};

export default function PipelineChart({
  data,
}: {
  data: MonthBucket[];
}) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const currentMonthKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-1.5 h-44 px-1">
        {data.map((m) => {
          const totalPct = (m.total / max) * 100;
          const wonPct = m.total > 0 ? (m.won / m.total) * totalPct : 0;
          const isCurrent = m.key === currentMonthKey;
          const tooltip = `${m.label}: ${m.total} issued · ${m.won} won`;
          return (
            <div
              key={m.key}
              className="flex-1 flex flex-col items-center group min-w-0"
              title={tooltip}
            >
              <div className="w-full flex-1 flex flex-col justify-end relative">
                {/* Sent portion — the bulk of the bar */}
                <div
                  className={`w-full rounded-t-md transition-all duration-200 ${
                    isCurrent
                      ? "bg-solux group-hover:bg-solux-dark"
                      : "bg-neutral-900 group-hover:bg-neutral-700"
                  }`}
                  style={{ height: `${totalPct}%` }}
                >
                  {/* Won segment overlay — stacked at top of bar */}
                  {!isCurrent && m.won > 0 && (
                    <div
                      className="w-full rounded-t-md bg-solux"
                      style={{
                        height: `${(m.won / m.total) * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="mt-2 text-[10px] uppercase tracking-widerx text-neutral-500 font-medium">
                {m.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
