import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { getProjectActions } from "@/lib/project-queue";

/**
 * "Action required — Projects" — a self-contained, role-aware server component
 * for the top of role dashboards. Shows ONLY the items needing the current
 * user's action (clickable), and renders null when there's nothing — so the
 * dashboard leads with what requires attention, not historical events.
 *
 * Styled with the SOLUX Projects design (mockup `.ar-tile`): it carries its own
 * `.solux-pro` scope so the tokens + Plus Jakarta Sans resolve even when used
 * standalone (e.g. on the main /dashboard), independent of the page wrapper.
 *
 * Tile tone → accent: the positive "generate quotation" reads green (`pos`),
 * anything else awaiting input reads amber (`act`), and inert drafts stay plain.
 */
function tileTone(tone: string): string {
  if (tone === "emerald") return "pos";
  if (tone === "neutral") return "";
  return "act";
}

export async function ProjectActionsWidget() {
  const supabase = createClient();
  const { userId } = await getEffectiveRole();
  const items = await getProjectActions(supabase, userId);
  if (items.length === 0) return null;

  return (
    <section className="solux-pro">
      <div className="sx-sectitle">
        <h2>Action required — Projects</h2>
        <div className="rhs">
          <Link href="/projects" className="sx-link">
            Open Projects →
          </Link>
        </div>
      </div>
      <div className="sx-argrid">
        {items.map((it) => (
          <Link key={it.key} href={it.href} className={`sx-tile ${tileTone(it.tone)}`}>
            <span className="arn">{it.count}</span>
            <span className="arl">{it.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
