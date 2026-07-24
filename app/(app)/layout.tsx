import "./premium.css";
import { Suspense } from "react";
import { getEffectiveRole } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import NoRoleNotice from "@/components/NoRoleNotice";
import { Toaster } from "@/components/feedback/Toaster";
import { DocumentTray } from "@/components/delivery/DocumentTray";
import { SendModalHost } from "@/components/delivery/SendModalHost";
import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/server";
import { I18nProvider } from "@/components/i18n/I18nProvider";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Layout uses the EFFECTIVE role so the Nav can simulate what other
  // roles would see when a super-admin is in dev mode. Every server
  // action and RLS policy still uses the REAL role independently.
  //
  // Identity (userId/email) comes from the SAME call — `getEffectiveRole`
  // (React-`cache()`d) already validates the user via `getCurrentUserRole`,
  // so we no longer make a separate `supabase.auth.getUser()` round-trip
  // here. Middleware remains the token-validation gate on every request.
  const { userId, email, realRole, effectiveRole, isSuperAdmin, isSimulating } =
    await getEffectiveRole();
  if (!userId) redirect("/login");
  const locale = getLocale();

  // S1.5 — an authenticated user with NO role (no user_roles row) used to get a
  // silently-degraded default shell. Show an explicit "account not configured"
  // state instead, so they know to contact an admin instead of wondering why
  // everything is empty/denied. (super_admins always have a role.)
  if (!realRole && !isSuperAdmin) {
    return (
      <I18nProvider locale={locale}>
        <NoRoleNotice email={email} />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider locale={locale}>
    <div className="min-h-screen flex flex-col">
      <Nav
        userId={userId}
        email={email}
        realRole={realRole}
        effectiveRole={effectiveRole}
        isSuperAdmin={isSuperAdmin}
        isSimulating={isSimulating}
        locale={locale}
      />
      {/* `po-premium` applies the validated design language (Plus Jakarta Sans,
          sharp 0px corners, ink + Flash-Green palette, disciplined de-rainbow,
          tightened micro-labels) to EVERY page in the app from one place, so
          the whole product reads as one design system. Page-level po-premium
          wrappers (added earlier) are harmless no-ops under this. */}
      <main className="flex-1 po-premium">{children}</main>
      {/* Global floating "Messages" launcher removed (Sprint 1 polish) — a
          persistent bottom-right chat bubble on every page read like a SaaS
          support widget and offered "Pick something to discuss" with no
          context. Conversations stay available where embedded per record. */}
      {/* Global action feedback — toasts + one-shot ?flash confirmations. */}
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
      {/* Document Delivery System — the ONE generic send modal (opened from
          anywhere via openSendModal) + the floating tray of documents prepared
          for email (downloaded, ready to attach). Both persist across nav. */}
      <SendModalHost />
      <DocumentTray />
    </div>
    </I18nProvider>
  );
}
