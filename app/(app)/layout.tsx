import "./premium.css";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { ConversationLauncher } from "@/components/chat/ConversationLauncher";
import { Toaster } from "@/components/feedback/Toaster";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Layout uses the EFFECTIVE role so the Nav can simulate what other
  // roles would see when a super-admin is in dev mode. Every server
  // action and RLS policy still uses the REAL role independently.
  const { realRole, effectiveRole, isSuperAdmin, isSimulating } =
    await getEffectiveRole();

  return (
    <div className="min-h-screen flex flex-col">
      <Nav
        userId={user.id}
        email={user.email}
        realRole={realRole}
        effectiveRole={effectiveRole}
        isSuperAdmin={isSuperAdmin}
        isSimulating={isSimulating}
      />
      {/* `po-premium` applies the validated design language (Plus Jakarta Sans,
          sharp 0px corners, ink + Flash-Green palette, disciplined de-rainbow,
          tightened micro-labels) to EVERY page in the app from one place, so
          the whole product reads as one design system. Page-level po-premium
          wrappers (added earlier) are harmless no-ops under this. */}
      <main className="flex-1 po-premium">{children}</main>
      {/* Persistent conversation layer — floating button bottom-right
          appears on every workspace route that maps to an entity
          (document / task list / production order / client). Stays
          mounted across navigations so the chat feels like part of
          the shell, not a section on each page. */}
      <ConversationLauncher />
      {/* Global action feedback — toasts + one-shot ?flash confirmations. */}
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
    </div>
  );
}
