import Link from "next/link";
import Image from "next/image";
import { logout } from "@/app/login/actions";
import {
  ROLE_LABEL,
  ROLE_SHORT_LABEL,
  isAdminLike,
  isTechnicalRole,
  type Role,
} from "@/lib/types";
import ViewAsSwitcher from "@/components/ViewAsSwitcher";
import { hasUiCapability, type Capability } from "@/lib/permissions";
import { navCapabilities, buildVisibleNavigation } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProjectActions } from "@/lib/project-queue";
import { projectActionTotal } from "@/lib/project-dashboard";
import { getOrdersBadgeCount, getTaskListsBadgeCount } from "@/lib/nav-badges";
import MegaMenu from "@/components/MegaMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { getNotificationSummary } from "@/lib/notifications";

export async function Nav({
  userId,
  email,
  realRole,
  effectiveRole,
  isSuperAdmin,
  isSimulating,
}: {
  /** Auth user id — drives the notification bell summary. */
  userId: string | null;
  email?: string | null;
  realRole: Role | null;
  effectiveRole: Role | null;
  isSuperAdmin: boolean;
  isSimulating: boolean;
}) {
  // Nav renders based on the EFFECTIVE role so the simulator previews what
  // other users would see. Server actions / page guards gate on the REAL
  // role independently — see lib/auth.ts.
  const role = effectiveRole;

  // Build the permission-filtered mega menu ON THE SERVER from the central
  // config (lib/navigation.ts). We resolve every capability the menu uses in
  // one batch via hasUiCapability (EFFECTIVE role, View-As faithful), then
  // buildVisibleNavigation prunes items/groups/categories the user can't see.
  // The client <MegaMenu/> receives an already-filtered tree and does NO
  // permission checks — keeping all access logic in one place.
  const grantedEntries = await Promise.all(
    navCapabilities().map(
      async (cap): Promise<[Capability, boolean]> => [
        cap,
        await hasUiCapability(cap),
      ]
    )
  );
  const granted = new Set<Capability>(
    grantedEntries.filter(([, ok]) => ok).map(([cap]) => cap)
  );
  // Role flags computed with the SAME validated helpers the route guards use,
  // so the menu mirrors access exactly (never shows a link the route denies).
  const menu = buildVisibleNavigation({
    granted,
    adminLike: isAdminLike(role),
    technical: isTechnicalRole(role),
    finance: role === "finance",
  });

  // Notification summary — counts unread comments on events the user
  // can see (RLS-scoped). Soft-fails to {0, []} on missing migrations
  // or DB errors so the nav never crashes.
  const notifications = await getNotificationSummary(userId, role);

  // Menu action badges — count of items needing the current user's action.
  // All lightweight + RLS-scoped + soft-failing, so the nav never crashes.
  //   - Clients & Projects → pending project approvals / ready-for-pricing / etc.
  //   - Orders             → delayed / behind-schedule production orders.
  //   - Task Lists         → lists under validation / needing revision.
  const supabase = createClient();
  const [projectActions, ordersCount, taskListsCount] = await Promise.all([
    getProjectActions(supabase, userId),
    getOrdersBadgeCount(supabase),
    getTaskListsBadgeCount(supabase),
  ]);
  const badges: Record<string, number> = {
    "clients-projects": projectActionTotal(projectActions),
    orders: ordersCount,
    "task-lists": taskListsCount,
  };
  // Per-item counts (right-aligned in the dropdown) for the dedicated work-queue
  // pages. Keyed by item href; the price/quote/draft actions target the filtered
  // /projects list (no dedicated item) so they only feed the category total.
  const PROJECT_QUEUE_PAGES = new Set(["/projects/approvals", "/projects/cost-requests", "/projects/logistics-requests"]);
  const itemBadges: Record<string, number> = {};
  for (const a of projectActions) {
    const base = a.href.split("?")[0];
    if (PROJECT_QUEUE_PAGES.has(base)) itemBadges[base] = (itemBadges[base] ?? 0) + a.count;
  }

  return (
    <header className="border-b border-neutral-200 bg-white sticky top-0 z-40">
      {/* Optional simulation banner — only visible while a super-admin is
          actively viewing as a non-super role. Keeps the dev mode obvious. */}
      {isSimulating && role && (
        <div className="bg-amber-100 border-b border-amber-300">
          <div className="mx-auto max-w-screen-2xl px-6 py-1.5 flex items-center justify-between text-[11px] text-amber-900">
            <span>
              <b>Dev simulation active</b> — UI is rendering as{" "}
              <b>{ROLE_LABEL[role]}</b>. Server actions still use your real
              role ({ROLE_LABEL[realRole ?? "admin"]}).
            </span>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-screen-2xl px-6 h-16 flex items-center gap-8">
        <Link
          href="/dashboard"
          className="flex items-center"
          aria-label="SOLUX"
        >
          <Image
            src="/solux-logo.png"
            alt="SOLUX"
            width={120}
            height={36}
            priority
            className="h-8 w-auto"
          />
        </Link>
        {/* Top mega menu — permission-filtered server-side, rendered by the
            client component for hover/click panels. Defined centrally in
            lib/navigation.ts (label · route · capability · group · category). */}
        <MegaMenu categories={menu} badges={badges} itemBadges={itemBadges} />
        <div className="ml-auto flex items-center gap-3 text-[13px]">
          {email && (
            <span className="text-neutral-500 hidden md:inline">{email}</span>
          )}

          {/* Notification bell — unread operational comments across
              every event the user can see. RLS-scoped server-side so
              sales only see their own deals' activity. */}
          <NotificationBell
            count={notifications.totalUnreadEvents}
            items={notifications.items}
          />

          {/* Role badge — shows the effective role, with a discrete indicator
              when it differs from the real role. */}
          {role && (
            <RoleBadge
              effective={role}
              realRole={realRole}
              isSimulating={isSimulating}
            />
          )}

          {/* Super-admin-only View As switcher. Always available to the real
              super-admin, even while they're simulating, so they can switch
              back. Non-super-admins never see this control. */}
          {isSuperAdmin && realRole && role && (
            <ViewAsSwitcher
              realRole={realRole}
              effectiveRole={role}
              isSimulating={isSimulating}
            />
          )}

          <form action={logout}>
            <button className="rounded border border-neutral-200 px-3 py-1.5 text-[13px] text-neutral-700 hover:bg-neutral-50 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

function RoleBadge({
  effective,
  realRole,
  isSimulating,
}: {
  effective: Role;
  realRole: Role | null;
  isSimulating: boolean;
}) {
  if (effective === "super_admin") {
    return (
      <span
        className="rounded bg-violet-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widerx text-white"
        title={`Real role: ${ROLE_LABEL[realRole ?? "admin"]}`}
      >
        Super
      </span>
    );
  }
  if (effective === "admin") {
    return (
      <span className="rounded bg-neutral-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widerx text-white">
        Admin
      </span>
    );
  }
  if (effective === "task_list_manager") {
    return (
      <span className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widerx text-white">
        TLM
      </span>
    );
  }
  if (effective === "operations") {
    // Distinct chip from TLM so the user can tell them apart at a
    // glance — operations gets a sky tone (logistics/coordination
    // vibe) vs. TLM's amber.
    return (
      <span className="rounded bg-sky-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widerx text-white">
        Ops
      </span>
    );
  }
  return (
    <span className="rounded bg-solux-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widerx text-neutral-700">
      {ROLE_SHORT_LABEL[effective]}
    </span>
  );
}
