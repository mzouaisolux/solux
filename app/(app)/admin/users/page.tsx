import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRole } from "@/lib/auth";
import {
  requireCapability,
  hasUiCapability,
} from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import {
  ASSIGNABLE_ROLES,
  ROLE_LABEL,
  type AssignableRole,
  type Role,
} from "@/lib/types";
import { setUserRole, toggleSuperAdmin, setUserDisplayName } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Super-admin user management.
 *
 * Lists every row in `user_roles` (= every user who has been assigned a
 * role at some point). For each row:
 *   - User id (shortened) + super_admin pill
 *   - Role dropdown to assign one of the 4 roles
 *   - Toggle to promote/demote super-admin
 *
 * Safety
 * ------
 *  - Page is gated at the route level (effective role redirect + real
 *    role requireCapability throw) — same pattern as /permissions/actions.
 *  - You can't edit your own row (forms are disabled). Server actions
 *    also refuse self-edits.
 *  - You can't disable the LAST super-admin (the server action checks
 *    the count before allowing it).
 *
 * Out of scope (intentionally, per Q3)
 * -----------------------------------
 *  - No emails (would need a profiles table or admin API). Identify
 *    users by the 8-char prefix of their UUID.
 *  - No "invite new user" flow. New users come from Supabase Auth signup;
 *    once they exist, admin can assign their role here.
 */
export default async function UsersAdminPage() {
  // Page-level gates (View-As faithful + real-role security). Same
  // capability the menu uses (admin.manage_users) — menu visibility and
  // route access are bound to ONE key. No silent dashboard redirect: a
  // direct visit without the capability shows Access Denied.
  const canSeePage = await hasUiCapability("admin.manage_users");
  if (!canSeePage) return <AccessDenied capability="admin.manage_users" />;
  await requireCapability("admin.manage_users");

  const supabase = createClient();
  const { userId: actorId } = await getCurrentUserRole();

  // Pull EVERY auth.users row + their (maybe-null) role via the
  // security-definer RPC (migration 027). The RPC verifies the caller
  // is a super-admin at SQL level — so this won't surface emails to
  // anyone else even via direct REST call.
  const { data: rows, error: listErr } = await supabase.rpc(
    "list_users_with_roles"
  );
  if (listErr) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-5">
          <h1 className="text-base font-semibold text-rose-900">
            Could not load users.
          </h1>
          <p className="text-sm text-rose-800 mt-2">{listErr.message}</p>
          <p className="text-xs text-rose-700 mt-3">
            Likely cause: migration <code>027_user_listing.sql</code>{" "}
            hasn&apos;t been applied yet. Run it in the Supabase SQL
            Editor and reload this page.
          </p>
        </div>
      </div>
    );
  }

  // The RPC returns columns with `out_` prefix to avoid SQL ambiguity
  // with the user_roles table columns. Normalize to friendly names here
  // so the rest of the page renders without that detail leaking.
  type UserRow = {
    user_id: string;
    email: string | null;
    display_name: string | null;
    role: Role | null;
    super_admin: boolean;
    user_created_at: string;
  };
  const users: UserRow[] = ((rows ?? []) as Array<any>).map((r) => ({
    user_id: r.out_user_id,
    email: r.out_email ?? null,
    // out_display_name only exists once m052 is applied; tolerate absence.
    display_name: r.out_display_name ?? null,
    role: (r.out_role ?? null) as Role | null,
    super_admin: !!r.out_super_admin,
    user_created_at: r.out_user_created_at,
  }));

  // Sort: super-admins first, then by role, then unassigned at the end.
  users.sort((a, b) => {
    if (a.super_admin !== b.super_admin) return a.super_admin ? -1 : 1;
    if (!a.role && b.role) return 1;
    if (a.role && !b.role) return -1;
    if (a.role !== b.role) return (a.role ?? "").localeCompare(b.role ?? "");
    return 0;
  });

  const superAdminCount = users.filter((u) => u.super_admin).length;
  const unassignedCount = users.filter((u) => !u.role).length;

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-5">
      <div>
        <div className="eyebrow">Admin · Users</div>
        <h1 className="doc-title mt-1">User roles</h1>
        <p className="text-xs text-neutral-500 mt-2 max-w-2xl">
          Assign a role to each user and toggle the super-admin flag.
          Roles drive what users can do via the permissions matrix.
          Super-admins always have the right to manage permissions and
          users — protect that flag carefully.
        </p>
      </div>

      <div className="rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 text-[11px] text-sky-900 leading-relaxed">
        <b>Safety</b> · you can&apos;t edit your own row. The system
        also refuses to disable the last super-admin (currently{" "}
        <b className="tabular-nums">{superAdminCount}</b> super-admin
        {superAdminCount === 1 ? "" : "s"}).
        {unassignedCount > 0 && (
          <>
            {" "}
            <b className="tabular-nums">{unassignedCount}</b> user
            {unassignedCount === 1 ? "" : "s"} {unassignedCount === 1 ? "has" : "have"} no role assigned —
            pick one in the dropdown and click Save.
          </>
        )}
      </div>

      <div className="panel overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-widerx text-neutral-600">
                Email · User ID
              </th>
              <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-widerx text-neutral-600">
                Display name
              </th>
              <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-widerx text-neutral-600">
                Role
              </th>
              <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-widerx text-neutral-600">
                Super-admin
              </th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-neutral-500"
                >
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <UserRow
                  key={u.user_id}
                  user={u}
                  isSelf={u.user_id === actorId}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({
  user,
  isSelf,
}: {
  user: {
    user_id: string;
    email: string | null;
    display_name: string | null;
    role: Role | null;
    super_admin: boolean;
  };
  isSelf: boolean;
}) {
  return (
    <tr
      className={`border-b border-neutral-100 last:border-b-0 ${
        isSelf ? "bg-amber-50/40" : ""
      }`}
    >
      <td className="px-4 py-3 align-top">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-neutral-900">
            {user.email ?? "(no email)"}
          </span>
          {isSelf && (
            <span className="rounded bg-amber-200 text-amber-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widerx">
              You
            </span>
          )}
          {user.super_admin && (
            <span className="rounded bg-violet-700 text-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widerx">
              Super
            </span>
          )}
          {!user.role && (
            <span className="rounded bg-neutral-200 text-neutral-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widerx">
              No role
            </span>
          )}
        </div>
        <div className="text-[10px] text-neutral-400 font-mono mt-1 break-all">
          {user.user_id}
        </div>
      </td>

      <td className="px-4 py-3 align-top">
        <form
          action={setUserDisplayName}
          className="flex items-center gap-2"
        >
          <input type="hidden" name="user_id" value={user.user_id} />
          <input
            name="display_name"
            defaultValue={user.display_name ?? ""}
            placeholder="e.g. John Smith"
            maxLength={80}
            className="w-40 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs focus:border-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
            Save
          </SubmitButton>
        </form>
        <p className="text-[10px] text-neutral-400 mt-1">
          Shown in conversations, forecasts &amp; audit.
        </p>
      </td>

      <td className="px-4 py-3 align-top">
        <form action={setUserRole} className="flex items-center gap-2">
          <input type="hidden" name="user_id" value={user.user_id} />
          <select
            name="role"
            // If no role yet, default to 'sales' as the safest starting
            // point. Admin can promote from there. The dropdown only
            // exposes the 3 DB-storable roles — super-admin is the
            // separate flag (use the toggle on the right).
            defaultValue={
              user.role && ASSIGNABLE_ROLES.includes(user.role as AssignableRole)
                ? (user.role as AssignableRole)
                : "sales"
            }
            disabled={isSelf}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs disabled:bg-neutral-50 disabled:text-neutral-500"
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <SubmitButton
            variant="secondary"
            size="sm"
            disabled={isSelf}
            pendingLabel={user.role ? "Saving…" : "Assigning…"}
          >
            {user.role ? "Save" : "Assign"}
          </SubmitButton>
        </form>
      </td>

      <td className="px-4 py-3 align-top">
        <form action={toggleSuperAdmin} className="flex items-center gap-2">
          <input type="hidden" name="user_id" value={user.user_id} />
          <input
            type="hidden"
            name="enable"
            value={user.super_admin ? "false" : "true"}
          />
          <SubmitButton
            variant={user.super_admin ? "danger" : "violet"}
            size="sm"
            disabled={isSelf}
            pendingLabel={user.super_admin ? "Demoting…" : "Promoting…"}
          >
            {user.super_admin
              ? "Demote from super-admin"
              : "Promote to super-admin"}
          </SubmitButton>
        </form>
      </td>
    </tr>
  );
}
