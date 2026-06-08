import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { getProjectActions } from "@/lib/project-queue";

/**
 * "Action required — Projects" — a self-contained, role-aware server component
 * for the top of role dashboards. Shows ONLY the items needing the current
 * user's action (clickable), and renders null when there's nothing — so the
 * dashboard leads with what requires attention, not historical events.
 */
const TONE: Record<string, string> = {
  amber: "border-amber-300 bg-amber-50 hover:bg-amber-100/70",
  violet: "border-violet-300 bg-violet-50 hover:bg-violet-100/70",
  indigo: "border-indigo-300 bg-indigo-50 hover:bg-indigo-100/70",
  teal: "border-teal-300 bg-teal-50 hover:bg-teal-100/70",
  emerald: "border-emerald-300 bg-emerald-50 hover:bg-emerald-100/70",
  neutral: "border-neutral-300 bg-neutral-50 hover:bg-neutral-100/70",
};

export async function ProjectActionsWidget() {
  const supabase = createClient();
  const { userId } = await getEffectiveRole();
  const items = await getProjectActions(supabase, userId);
  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-900">Action required — Projects</h2>
        <Link href="/projects" className="text-[12px] text-neutral-500 hover:underline">
          Open Projects →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            className={`flex items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors ${TONE[it.tone] ?? TONE.neutral}`}
          >
            <span className="text-2xl font-semibold tabular-nums text-neutral-900">{it.count}</span>
            <span className="text-[12px] font-medium leading-tight text-neutral-700">{it.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
