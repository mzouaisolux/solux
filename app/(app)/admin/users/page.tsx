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

const SX_BTN_SM = "sx-btn sx-btn-sm";

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
      <div className="solux-pro sx-page">
        <div className="sx-wrap">
          <section className="card sec ad-section">
            <div className="eyebrow">Admin · Users</div>
            <h2 className="ad-doc-title">User roles</h2>
            <div className="ad-callout warn">
              <b>Could not load users</b> · {listErr.message} — likely migration{" "}
              <code>027_user_listing.sql</code> hasn&apos;t been applied yet. Run it in the Supabase SQL
              Editor and reload this page.
            </div>
          </section>
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
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <section className="card sec ad-section">
          <div className="eyebrow">Admin · Users</div>
          <h2 className="ad-doc-title">User roles</h2>
          <p className="ad-lead">
            Assign a role to each user and toggle the super-admin flag. Roles drive what users can do via
            the permissions matrix. Super-admins always have the right to manage permissions and users —
            protect that flag carefully.
          </p>

          {/* S1.2 — surface unconfigured accounts prominently. A user with no
              role can't use the app (they get the "account not configured"
              screen, S1.5), so make that obvious at the top, not just per-row. */}
          {unassignedCount > 0 && (
            <div
              className="ad-callout"
              style={{ borderColor: "#f59e0b", background: "#fffbeb", color: "#92400e" }}
            >
              ⚠ <b className="ad-mono">{unassignedCount}</b> account
              {unassignedCount === 1 ? "" : "s"}{" "}
              {unassignedCount === 1 ? "has" : "have"} <b>no role</b> and can&apos;t use
              the app yet — assign one in the Role dropdown below.
            </div>
          )}

          <div className="ad-callout">
            <b>Safety</b> · you can&apos;t edit your own row. The system also refuses to disable the last
            super-admin (currently <b className="ad-mono">{superAdminCount}</b> super-admin
            {superAdminCount === 1 ? "" : "s"}).
            {unassignedCount > 0 && (
              <>
                {" "}
                <b className="ad-mono">{unassignedCount}</b> user{unassignedCount === 1 ? "" : "s"}{" "}
                {unassignedCount === 1 ? "has" : "have"} no role assigned — pick one in the dropdown and
                click Save.
              </>
            )}
          </div>

          <div className="card" style={{ marginTop: 14, boxShadow: "none", overflow: "hidden" }}>
            <table className="ad-tbl">
              <thead>
                <tr>
                  <th>Email · User ID</th>
                  <th>Display name</th>
                  <th>Role</th>
                  <th>Super-admin</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", color: "var(--sx-mute)", padding: "32px 14px" }}>
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => <UserRow key={u.user_id} user={u} isSelf={u.user_id === actorId} />)
                )}
              </tbody>
            </table>
          </div>
        </section>
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
    <tr className={isSelf ? "self" : ""}>
      <td>
        <div className="ad-uname">
          {user.email ?? "(no email)"}
          {isSelf && <span className="ad-tag you">You</span>}
          {user.super_admin && <span className="ad-tag super">Super</span>}
          {!user.role && <span className="ad-tag norole">No role</span>}
        </div>
        <div className="ad-uid">{user.user_id}</div>
      </td>

      <td>
        <form action={setUserDisplayName} className="ad-inline-form">
          <input type="hidden" name="user_id" value={user.user_id} />
          <input
            type="text"
            name="display_name"
            defaultValue={user.display_name ?? ""}
            placeholder="e.g. John Smith"
            maxLength={80}
          />
          <SubmitButton variant="ghost" className={SX_BTN_SM} pendingLabel="Saving…">
            Save
          </SubmitButton>
        </form>
        <p className="ad-hint-sm">Shown in conversations, forecasts &amp; audit.</p>
      </td>

      <td>
        <form action={setUserRole} className="ad-inline-form">
          <input type="hidden" name="user_id" value={user.user_id} />
          <select
            name="role"
            // If no role yet, default to 'sales' as the safest starting point. Admin
            // can promote from there. The dropdown only exposes the DB-storable roles —
            // super-admin is the separate flag (use the toggle on the right).
            defaultValue={
              user.role && ASSIGNABLE_ROLES.includes(user.role as AssignableRole)
                ? (user.role as AssignableRole)
                : "sales"
            }
            disabled={isSelf}
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <SubmitButton
            variant="ghost"
            className={user.role ? SX_BTN_SM : "sx-btn sx-btn-go sx-btn-sm"}
            disabled={isSelf}
            pendingLabel={user.role ? "Saving…" : "Assigning…"}
          >
            {user.role ? "Save" : "Assign"}
          </SubmitButton>
        </form>
      </td>

      <td>
        <form action={toggleSuperAdmin} className="ad-inline-form">
          <input type="hidden" name="user_id" value={user.user_id} />
          <input type="hidden" name="enable" value={user.super_admin ? "false" : "true"} />
          <SubmitButton
            variant="ghost"
            className={user.super_admin ? "sx-btn sx-btn-danger sx-btn-sm" : "sx-btn sx-btn-ink sx-btn-sm"}
            disabled={isSelf}
            pendingLabel={user.super_admin ? "Demoting…" : "Promoting…"}
          >
            {user.super_admin ? "Demote from super-admin" : "Promote to super-admin"}
          </SubmitButton>
        </form>
      </td>
    </tr>
  );
}
