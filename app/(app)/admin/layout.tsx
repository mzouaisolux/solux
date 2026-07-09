import { getEffectiveRole } from "@/lib/auth";
import { isAdminLike, isTechnicalRole } from "@/lib/types";
import AdminTabs, { type AdminTab } from "@/components/AdminTabs";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The /admin section hosts TWO kinds of pages:
  //   • master-data config (Products, Pricing, Categories, Components,
  //     Sales conditions, Banks) — admin-only, no dedicated capability;
  //     each of those pages self-gates on isAdminLike.
  //   • capability-gated tools (Users, Diagnostics) that a super-admin can
  //     grant to NON-admin roles via /permissions (e.g. give a Task List
  //     Manager `admin.manage_users`).
  //
  // So this layout must NOT blanket-redirect every non-admin: that was the
  // bug — it preempted the per-page capability gate and bounced a user who
  // legitimately holds, e.g., admin.manage_users, back to /dashboard even
  // though their menu link (correctly) appeared. Instead we let anyone with
  // admin-like access OR an admin-section capability INTO the section and
  // let each page enforce its own gate (capability or isAdminLike), showing
  // <AccessDenied/> — never a silent dashboard redirect.
  const { effectiveRole } = await getEffectiveRole();
  const adminLike = isAdminLike(effectiveRole);
  const canManageUsers = await hasUiCapability("admin.manage_users");
  const canSeeDiagnostics = await hasUiCapability("admin.diagnostics");

  // m160 — technical roles (TLM / Operations) maintain the Industrial
  // dictionary (/admin/components, self-gated on isTechnicalRole); the nav
  // already shows it to them. Letting them INTO the section is safe: every
  // other master-data page self-gates on isAdminLike / capability and shows
  // its own <AccessDenied/> (the design rule above).
  const mayEnter =
    adminLike ||
    isTechnicalRole(effectiveRole) ||
    canManageUsers ||
    canSeeDiagnostics;
  if (!mayEnter) {
    // Backstop only — every /admin page also self-gates. This fires when a
    // user has no admin-section access at all; capability-grantable pages
    // (Users, Diagnostics) show their own capability-specific denial.
    return (
      <AccessDenied message="You don't have access to this section." />
    );
  }

  // Master-data tabs only make sense for admin-like users. A capability-only
  // visitor (e.g. a Task List Manager who was granted Users access) must NOT
  // see tabs they can't open — so the tab bar renders for admin-like users
  // only. Their own page (Users) carries its own heading.
  const baseTabs: AdminTab[] = [
    // Catalog master data grouped first: Products, Categories, Components.
    { href: "/admin/products", label: "Products" },
    { href: "/admin/categories", label: "Categories" },
    { href: "/admin/components", label: "Industrial dictionary" },
    { href: "/admin/pricing", label: "Pricing" },
    { href: "/admin/sales-conditions", label: "Sales conditions" },
    { href: "/admin/banks", label: "Bank accounts" },
  ];
  const tabs: AdminTab[] = [
    ...baseTabs,
    ...(canSeeDiagnostics
      ? [{ href: "/admin/diagnostics", label: "Diagnostics" } satisfies AdminTab]
      : []),
  ];

  return (
    <>
      {adminLike && <AdminTabs tabs={tabs} />}
      {children}
    </>
  );
}
