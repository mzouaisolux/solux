import Link from "next/link";

/**
 * Activity feed. Server-built from creation timestamps across documents,
 * task lists, clients, and products. We don't have an audit log table yet,
 * so this is "creation events" only — but it's enough to give the team
 * feed a heartbeat.
 *
 * Each event has a tone color (sales = emerald, production = sky,
 * admin = neutral) so the eye can scan by source.
 */
export type ActivityEvent = {
  id: string;
  /** "Camille created quotation Q-26-0142" */
  description: string;
  /** Optional secondary line — small details like value or units. */
  detail?: string;
  /** Where clicking the row goes. */
  href?: string;
  /** Best-effort relative time string ("12 min ago", "Yesterday"). */
  relativeTime: string;
  /** Used for the colored dot in the gutter. */
  tone: "sales" | "production" | "admin" | "system";
};

const TONE_DOT: Record<ActivityEvent["tone"], string> = {
  sales: "bg-emerald-500",
  production: "bg-sky-500",
  admin: "bg-violet-500",
  system: "bg-neutral-400",
};

export default function ActivityFeed({
  events,
}: {
  events: ActivityEvent[];
}) {
  return (
    <div className="rounded-xl border border-neutral-200/80 bg-white shadow-soft overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-100">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widerx text-neutral-500">
            Activity
          </div>
          <div className="text-xs text-neutral-500 mt-0.5">
            Team feed · today
          </div>
        </div>
      </div>
      {events.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-neutral-500">
          Nothing happened yet today. Start a quotation to see activity here.
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {events.map((e) => {
            const inner = (
              <div className="px-5 py-3 flex items-start gap-3">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[e.tone]}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-neutral-900 leading-snug">
                    {e.description}
                  </div>
                  {e.detail && (
                    <div className="text-xs text-neutral-500 mt-0.5 truncate">
                      {e.detail}
                    </div>
                  )}
                  <div className="text-[11px] text-neutral-400 mt-0.5">
                    {e.relativeTime}
                  </div>
                </div>
              </div>
            );
            return (
              <li key={e.id}>
                {e.href ? (
                  <Link
                    href={e.href}
                    className="block hover:bg-neutral-50/60 transition-colors"
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Tiny helper — keeps the timestamp formatting consistent. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day} days ago`;
  return d.toLocaleDateString("en-GB", {
    month: "short",
    day: "2-digit",
  });
}
