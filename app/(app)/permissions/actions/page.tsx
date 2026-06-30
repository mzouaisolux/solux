import { createClient } from "@/lib/supabase/server";
import {
  requireCapability,
  hasUiCapability,
} from "@/lib/permissions";
import { VIEW_AS_ROLES, ROLE_LABEL, type Role } from "@/lib/types";
import { updatePermissionsMatrix } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import AccessDenied from "@/components/AccessDenied";

/**
 * Super-admin permissions matrix.
 *
 * Rows: every capability in the catalog, grouped by category.
 * Columns: the 4 roles (super_admin, admin, task_list_manager, sales).
 * Cells: checkboxes bound to `role_permissions.enabled`.
 *
 * Gating
 * ------
 * Page-level: `requireCapability("admin.manage_permissions")` —
 * non-super-admins hit the error boundary's amber permission panel.
 *
 * Save mechanics
 * --------------
 * One single `<form>` POST → `updatePermissionsMatrix` action. The
 * action persists the FULL matrix state (not a diff) so we don't have
 * to track dirty cells client-side. After save:
 *   - The capability cache is cleared in this process for immediate effect.
 *   - A high-severity event is emitted with the cell-level diff.
 *   - Every (app) route is revalidated so capability-gated nav links
 *     and buttons reflect the new state on the next click.
 */

type PermissionRow = {
  key: string;
  category: string;
  label: string;
  description: string | null;
  sort_order: number;
};

type RolePermissionRow = {
  role: string;
  permission_key: string;
  enabled: boolean;
};

export default async function PermissionsAdminPage() {
  // Two-layer gate:
  //  - View-As simulation: redirect early if the EFFECTIVE role can't
  //    see this page. A super-admin viewing as sales gets bounced to
  //    /dashboard just like a real sales user would.
  //  - Security: requireCapability uses the REAL role and throws (caught
  //    by error.tsx). Belt-and-suspenders.
  const canSeePage = await hasUiCapability("admin.manage_permissions");
  if (!canSeePage) return <AccessDenied capability="admin.manage_permissions" />;
  await requireCapability("admin.manage_permissions");

  const supabase = createClient();

  const [{ data: catalogRows }, { data: matrixRows }] = await Promise.all([
    supabase
      .from("permissions")
      .select("key, category, label, description, sort_order")
      .order("sort_order"),
    supabase
      .from("role_permissions")
      .select("role, permission_key, enabled"),
  ]);

  const catalog = (catalogRows ?? []) as PermissionRow[];
  const matrix = (matrixRows ?? []) as RolePermissionRow[];

  // Build a lookup: enabledMap.get("role:key") → boolean
  const enabledMap = new Map<string, boolean>();
  for (const row of matrix) {
    enabledMap.set(`${row.role}:${row.permission_key}`, row.enabled);
  }

  // Group capabilities by category, preserving sort_order within each.
  const grouped = new Map<string, PermissionRow[]>();
  for (const cap of catalog) {
    if (!grouped.has(cap.category)) grouped.set(cap.category, []);
    grouped.get(cap.category)!.push(cap);
  }

  // Per-role tally of enabled capabilities — shown in the column header.
  const enabledCountByRole = new Map<string, number>();
  for (const role of VIEW_AS_ROLES) {
    let c = 0;
    for (const cap of catalog) {
      if (enabledMap.get(`${role}:${cap.key}`)) c++;
    }
    enabledCountByRole.set(role, c);
  }

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <section className="card sec ad-section">
          <div className="eyebrow">Admin · Permissions</div>
          <h2 className="ad-doc-title">Permissions matrix</h2>
          <p className="ad-lead">
            Toggle which roles have access to which capabilities. Backend actions enforce these checks
            (<code>requireCapability()</code>), and capability-gated UI buttons appear / disappear
            accordingly. Changes take effect immediately for the current process and within 30 seconds
            across the rest of the app.
          </p>

          <div className="ad-callout">
            <b>Heads up</b> · changing the matrix is logged as a critical event. Disabling{" "}
            <code>admin.manage_permissions</code> for super-admin would lock you out of this page — use
            with care. Sales rows for production capabilities are intentionally off to enforce the
            operational separation.
          </div>

          {/* MATRIX FORM */}
          <form
            action={updatePermissionsMatrix}
            className="card"
            style={{ marginTop: 14, boxShadow: "none", overflow: "hidden" }}
          >
            <div className="ad-mtx-wrap">
              <table className="ad-mtx">
                <thead>
                  <tr>
                    <th className="cap">Capability</th>
                    {VIEW_AS_ROLES.map((role) => (
                      <th key={role} className="role">
                        {ROLE_LABEL[role]}
                        <span className="ct">
                          {enabledCountByRole.get(role) ?? 0} / {catalog.length}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from(grouped.entries()).map(([category, caps]) => (
                    <CategoryGroup key={category} category={category} caps={caps} enabledMap={enabledMap} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* STICKY SAVE BAR */}
            <div className="ad-matrix-savebar">
              <span className="note">Save persists the entire matrix and logs an audit event.</span>
              <SubmitButton variant="ghost" className="sx-btn sx-btn-go" pendingLabel="Saving matrix…">
                Save changes
              </SubmitButton>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

/**
 * One category section — renders a sub-header row + N capability rows.
 * Visually compact: the category label is in a tinted strip above
 * the first capability row.
 */
function CategoryGroup({
  category,
  caps,
  enabledMap,
}: {
  category: string;
  caps: PermissionRow[];
  enabledMap: Map<string, boolean>;
}) {
  return (
    <>
      <tr className="catrow">
        <td colSpan={1 + VIEW_AS_ROLES.length}>{category}</td>
      </tr>
      {caps.map((cap) => (
        <CapabilityRow key={cap.key} cap={cap} enabledMap={enabledMap} />
      ))}
    </>
  );
}

/**
 * One capability row — label + description (in a hover title) + 4
 * checkboxes named `cap[<role>:<key>]`.
 */
function CapabilityRow({
  cap,
  enabledMap,
}: {
  cap: PermissionRow;
  enabledMap: Map<string, boolean>;
}) {
  return (
    <tr>
      <td className="cap" title={cap.description ?? ""}>
        <div className="cl">{cap.label}</div>
        <div className="ck">{cap.key}</div>
      </td>
      {VIEW_AS_ROLES.map((role) => {
        const enabled = !!enabledMap.get(`${role}:${cap.key}`);
        return (
          <td key={role} className="cell">
            <Checkbox role={role} capabilityKey={cap.key} enabled={enabled} />
          </td>
        );
      })}
    </tr>
  );
}

/**
 * The actual checkbox. We rely on native form semantics:
 *   - Checked = present in formData (action enables it)
 *   - Unchecked = absent (action disables it)
 *
 * No client state — the form submits the current DOM state of all
 * checkboxes. Defaults are pulled from the DB on the server render.
 */
function Checkbox({
  role,
  capabilityKey,
  enabled,
}: {
  role: Role;
  capabilityKey: string;
  enabled: boolean;
}) {
  // PERM-2 — the super-admin's manage-permissions cell is the gate to this
  // page; render it locked-on so it can't be unchecked (the server enforces
  // this too, so a crafted POST can't bypass it either).
  const locked =
    role === "super_admin" && capabilityKey === "admin.manage_permissions";
  return (
    <input
      type="checkbox"
      name={`cap[${role}:${capabilityKey}]`}
      defaultChecked={locked ? true : enabled}
      disabled={locked}
      title={
        locked
          ? "Always on — protects super-admin access to this page"
          : undefined
      }
    />
  );
}
