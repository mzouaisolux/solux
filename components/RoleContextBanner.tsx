import { getEffectiveRole } from "@/lib/auth";
import { ROLE_LABEL, isTechnicalRole, type Role } from "@/lib/types";
import { clearViewAsRole } from "@/app/(app)/view-as/actions";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Visibility / role-context diagnostic banner — explains WHY operational
 * editing might be hidden on the current page.
 *
 * The PO detail page (and /operations) hide all editing UI when
 * `technical=false`. That's correct behaviour for sales users, but it
 * was reported as a regression because:
 *
 *   1. A super-admin can leave View-As stuck on "sales" and forget,
 *      then think the editing UI is broken.
 *   2. A new sales account created during RLS testing might still be
 *      the active session — operator forgets to log back in as admin.
 *
 * This banner gives an unmistakable on-page signal + a one-click
 * recovery path (Reset View-As button when simulating).
 *
 * Mounting rule
 * -------------
 * Mount on operational pages that have edit forms gated by `technical`:
 *   - /operations
 *   - /production/orders/[id]
 *
 * The banner ALSO renders a green confirmation strip for technical
 * users (so they get reassurance "yes, you have edit access here").
 * Pass `mode="auto"` to get both flows, or `mode="only-when-hidden"`
 * to only render the read-only diagnostic.
 */
export async function RoleContextBanner({
  mode = "auto",
}: {
  /** "auto" : show green strip when technical, amber/rose when not.
   *  "only-when-hidden" : only render when editing UI is hidden. */
  mode?: "auto" | "only-when-hidden";
}) {
  const { effectiveRole, realRole, isSimulating } = await getEffectiveRole();
  const technical = isTechnicalRole(effectiveRole);

  // Technical user with no simulation → optional reassurance strip
  // (skipped in "only-when-hidden" mode).
  if (technical && !isSimulating) {
    if (mode === "only-when-hidden") return null;
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-1.5 text-[11px] text-emerald-800 flex items-center gap-2">
        <span className="font-semibold">●</span>
        <span>
          <b>Technical view</b> — you can edit production status, timelines,
          payments and shipment on this page and on each order's detail.
        </span>
      </div>
    );
  }

  // Simulating: super-admin → show amber banner with Reset button.
  if (isSimulating) {
    return (
      <div className="rounded-md border-2 border-amber-300 bg-amber-50 px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widerx text-amber-900">
            ⚠ Dev simulation active
          </div>
          <p className="text-xs text-amber-900 mt-1 max-w-xl">
            You&apos;re viewing the app as{" "}
            <b>{ROLE_LABEL[(effectiveRole ?? "sales") as Role]}</b>. Edit
            controls are hidden because that role can&apos;t modify
            production. Your real role is{" "}
            <b>{ROLE_LABEL[(realRole ?? "admin") as Role]}</b> — reset
            to restore full editing.
          </p>
        </div>
        <form action={clearViewAsRole} className="shrink-0">
          <SubmitButton
            variant="amber"
            size="sm"
            pendingLabel="Resetting…"
          >
            Reset to my real role
          </SubmitButton>
        </form>
      </div>
    );
  }

  // Real sales user (not simulating) — explain why editing is hidden
  // and how to escalate.
  return (
    <div className="rounded-md border border-neutral-300 bg-neutral-50 px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-widerx text-neutral-700">
        Sales view · read-only
      </div>
      <p className="text-xs text-neutral-700 mt-1 max-w-xl">
        Editing production status, timelines, payments and shipment is
        restricted to <b>Operations</b>, <b>Task List Manager</b> and{" "}
        <b>Admin</b> roles. Contact your production coordinator if a
        change is needed on this order.
      </p>
    </div>
  );
}
