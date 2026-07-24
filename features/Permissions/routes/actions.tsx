import { createClient } from "@/lib/supabase/server";
import { requireCapability, hasUiCapability } from "@/lib/permissions";
import {
  groupCapabilities,
  ALL_CAPABILITY_KEYS,
  type CapabilityGroup,
} from "@/lib/capabilities";
import { VIEW_AS_ROLES, ROLE_LABEL, type Role } from "@/lib/types";
import { updatePermissionsMatrix } from "@/features/Permissions/actions/matrix";
import { SubmitButton } from "@/components/SubmitButton";
import AccessDenied from "@/components/AccessDenied";

/**
 * Super-admin permissions matrix — SELF-MAINTAINING.
 *
 * Rows: EVERY capability in `lib/capabilities.ts` (the single source of truth),
 * grouped by module (derived from the `module.action` key convention). There is
 * NO hardcoded capability list or group list on this page — add a capability to
 * the catalog and it appears here automatically, with zero edits to this file.
 * Because `requireCapability()` is typed against the SAME catalog, every
 * capability the app actually enforces is guaranteed to show up.
 *
 * Columns: the roles in `VIEW_AS_ROLES`.
 * Cells: checkboxes bound to `role_permissions.enabled` — the who-has-what
 * state. A capability with no `role_permissions` row simply renders OFF for
 * every role until a super-admin enables it (fail-closed).
 *
 * Gating
 * ------
 * Page-level: `requireCapability("admin.manage_permissions")` — non-super-admins
 * hit the error boundary's amber permission panel.
 *
 * Save mechanics
 * --------------
 * One single `<form>` POST → `updatePermissionsMatrix`. The action persists the
 * FULL matrix state (walking the catalog × roles product), clears the capability
 * cache, emits a high-severity audit event, and revalidates every (app) route.
 */

type Cap = CapabilityGroup["caps"][number];

export default async function PermissionsAdminPage() {
  // Two-layer gate:
  //  - View-As simulation: hide the page if the EFFECTIVE role can't see it.
  //  - Security: requireCapability uses the REAL role and throws (error.tsx).
  const canSeePage = await hasUiCapability("admin.manage_permissions");
  if (!canSeePage) return <AccessDenied capability="admin.manage_permissions" />;
  await requireCapability("admin.manage_permissions");

  const supabase = createClient();

  // ROWS come from the code catalog (self-maintaining); only the checkbox STATE
  // comes from the DB. No dependency on a DB `permissions` catalog table.
  const { data: matrixRows } = await supabase
    .from("role_permissions")
    .select("role, permission_key, enabled");

  const groups = groupCapabilities();
  const totalCaps = ALL_CAPABILITY_KEYS.length;

  // Lookup: enabledMap.get("role:key") → boolean.
  const enabledMap = new Map<string, boolean>();
  for (const row of matrixRows ?? []) {
    enabledMap.set(`${row.role}:${row.permission_key}`, !!row.enabled);
  }

  // Per-role tally of enabled capabilities — shown in the column header.
  const enabledCountByRole = new Map<string, number>();
  for (const role of VIEW_AS_ROLES) {
    let c = 0;
    for (const key of ALL_CAPABILITY_KEYS) {
      if (enabledMap.get(`${role}:${key}`)) c++;
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
            <b>Self-maintaining</b> · this matrix is built from the capability catalog
            (<code>lib/capabilities.ts</code>), the single source of truth that also types{" "}
            <code>requireCapability()</code>. All <b>{totalCaps}</b> capabilities across{" "}
            <b>{groups.length}</b> modules are listed automatically — add a new capability and it
            shows up here with no edit to this page. Changing the matrix is logged as a critical
            event; disabling <code>admin.manage_permissions</code> for super-admin is force-kept on
            to avoid a lock-out.
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
                          {enabledCountByRole.get(role) ?? 0} / {totalCaps}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <CategoryGroup key={group.moduleId} group={group} enabledMap={enabledMap} />
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
 * One module section — a tinted sub-header strip + its capability rows.
 * The module label is derived from the key convention, not hardcoded here.
 */
function CategoryGroup({
  group,
  enabledMap,
}: {
  group: CapabilityGroup;
  enabledMap: Map<string, boolean>;
}) {
  return (
    <>
      <tr className="catrow">
        <td colSpan={1 + VIEW_AS_ROLES.length}>
          {group.label}
          <span
            style={{
              marginLeft: 8,
              fontWeight: 400,
              opacity: 0.6,
              fontSize: "0.8em",
            }}
          >
            {group.caps.length}
          </span>
        </td>
      </tr>
      {group.caps.map((cap) => (
        <CapabilityRow key={cap.key} cap={cap} enabledMap={enabledMap} />
      ))}
    </>
  );
}

/**
 * One capability row — human label + technical key (smaller) + one checkbox
 * per role.
 */
function CapabilityRow({
  cap,
  enabledMap,
}: {
  cap: Cap;
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
 * The actual checkbox. Native form semantics: checked = present in formData
 * (enable), unchecked = absent (disable). No client state.
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
        locked ? "Always on — protects super-admin access to this page" : undefined
      }
    />
  );
}
