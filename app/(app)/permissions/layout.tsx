import { hasUiCapability } from "@/lib/permissions";
import AdminTabs from "@/components/AdminTabs";
import AccessDenied from "@/components/AccessDenied";

/**
 * Permissions & Access — a focused, security-only environment, separate
 * from Admin / Master-data configuration.
 *
 * Gate: `admin.manage_permissions` (View-As faithful). Tabs cover the two
 * orthogonal axes:
 *   - Action permissions → who can DO what (the capability matrix)
 *   - Teams & access     → who can SEE what (teams, members, scopes)
 */
export default async function PermissionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const canManage = await hasUiCapability("admin.manage_permissions");
  if (!canManage) return <AccessDenied capability="admin.manage_permissions" />;

  return (
    <>
      <AdminTabs
        tabs={[
          { href: "/permissions/actions", label: "Action permissions" },
          { href: "/permissions/teams", label: "Teams & access" },
        ]}
      />
      {children}
    </>
  );
}
