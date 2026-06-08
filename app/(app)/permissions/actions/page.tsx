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
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-5">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Admin · Permissions</div>
          <h1 className="doc-title mt-1">Permissions matrix</h1>
          <p className="text-xs text-neutral-500 mt-2 max-w-2xl">
            Toggle which roles have access to which capabilities. Backend
            actions enforce these checks (<code>requireCapability()</code>),
            and capability-gated UI buttons appear/disappear accordingly.
            Changes take effect immediately for the current process and
            within 30 seconds across the rest of the app.
          </p>
        </div>
      </div>

      {/* HELP CALLOUT — only first time visit feel, kept short */}
      <div className="rounded-md border border-sky-200 bg-sky-50/60 px-3 py-2 text-[11px] text-sky-900 leading-relaxed">
        <b>Heads up</b> · changing the matrix is logged as a critical event.
        Disabling <code>admin.manage_permissions</code> for super-admin
        would lock you out of this page — use with care. Sales rows for
        production capabilities are intentionally off to enforce the
        operational separation.
      </div>

      {/* MATRIX FORM */}
      <form action={updatePermissionsMatrix} className="panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-neutral-50 border-b border-neutral-200 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-widerx text-neutral-600 w-1/2">
                  Capability
                </th>
                {VIEW_AS_ROLES.map((role) => (
                  <th
                    key={role}
                    className="text-center px-3 py-2.5 font-semibold text-[10px] uppercase tracking-widerx text-neutral-600"
                  >
                    <div>{ROLE_LABEL[role]}</div>
                    <div className="text-[9px] text-neutral-400 font-normal tabular-nums mt-0.5">
                      {enabledCountByRole.get(role) ?? 0} / {catalog.length}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(grouped.entries()).map(([category, caps]) => (
                <CategoryGroup
                  key={category}
                  category={category}
                  caps={caps}
                  enabledMap={enabledMap}
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* STICKY SAVE BAR */}
        <div className="sticky bottom-0 bg-white border-t border-neutral-200 px-4 py-3 flex items-center justify-between">
          <span className="text-[11px] text-neutral-500">
            Save persists the entire matrix and logs an audit event.
          </span>
          <SubmitButton variant="primary" pendingLabel="Saving matrix…">
            Save changes
          </SubmitButton>
        </div>
      </form>
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
      <tr className="bg-neutral-50/60">
        <td
          colSpan={1 + VIEW_AS_ROLES.length}
          className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widerx text-neutral-700 border-y border-neutral-100"
        >
          {category}
        </td>
      </tr>
      {caps.map((cap) => (
        <CapabilityRow
          key={cap.key}
          cap={cap}
          enabledMap={enabledMap}
        />
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
    <tr className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50/50">
      <td className="px-4 py-2 align-top" title={cap.description ?? ""}>
        <div className="text-[12px] font-medium text-neutral-900">
          {cap.label}
        </div>
        <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
          {cap.key}
        </div>
      </td>
      {VIEW_AS_ROLES.map((role) => {
        const enabled = !!enabledMap.get(`${role}:${cap.key}`);
        return (
          <td key={role} className="px-3 py-2 text-center">
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
      className={`h-4 w-4 rounded border-neutral-300 text-solux focus:ring-solux focus:ring-offset-0 ${
        locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
    />
  );
}
