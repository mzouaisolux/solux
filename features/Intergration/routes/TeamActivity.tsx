/**
 * Team activity — sales-supervision rollup of client interactions.
 *
 * Gated by integration.view_team_interactions (admins always pass). The data
 * itself is RLS-scoped, so a manager sees their team and a director the whole
 * org — the page just refuses non-supervisors outright.
 *
 * Rendered by the thin wrapper at app/(app)/team-activity/page.tsx.
 */

import Link from "next/link";
import { canAccessOrAdmin } from "@/lib/permissions";
import { getTeamActivity } from "@/features/Intergration/actions/team-activity";
import { TeamActivityRollup } from "@/features/Intergration/components/TeamActivityRollup";

export default async function TeamActivityPage() {
  const allowed = await canAccessOrAdmin(["integration.view_team_interactions"]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Reporting</div>
      <h1 className="mt-1 text-2xl font-bold">Team activity</h1>
      <p className="mt-2 max-w-xl text-sm text-neutral-500">
        Client interactions by rep over the last weeks, and accounts that have gone quiet. Scoped to
        the accounts you supervise.
      </p>

      {allowed ? (
        <div className="mt-6">
          <TeamActivityRollup data={await getTeamActivity()} />
        </div>
      ) : (
        <div className="mt-6 rounded-md border border-dashed border-neutral-200 px-4 py-10 text-center text-sm text-neutral-500">
          You don’t have access to team activity. Ask a super-admin to enable
          “View team interaction timelines” for your role in{" "}
          <Link href="/permissions" className="underline">
            permissions
          </Link>
          .
        </div>
      )}
    </div>
  );
}
