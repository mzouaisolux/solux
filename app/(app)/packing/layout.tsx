// =====================================================================
// /packing — Packing List module (Phase 1).
//
// ISOLATED + SUPER-ADMIN ONLY. The whole module is gated here so every
// child route (overview / library / issues / calculator) is protected by
// one guard. Uses the REAL role (getCurrentUserRole) — a super-admin can
// reach it even while previewing another role via View-As.
// =====================================================================
import Link from "next/link";
import { getCurrentUserRole } from "@/lib/auth";
import AccessDenied from "@/components/AccessDenied";

export const dynamic = "force-dynamic";

const TABS = [
  { href: "/packing", label: "Overview" },
  { href: "/packing/library", label: "Packaging Library" },
  { href: "/packing/issues", label: "Import Issues" },
  { href: "/packing/calculator", label: "Packing Calculator" },
  { href: "/packing/containers", label: "Containers" },
];

export default async function PackingLayout({ children }: { children: React.ReactNode }) {
  const { isSuperAdmin } = await getCurrentUserRole();
  if (!isSuperAdmin) {
    return (
      <AccessDenied
        title="Packing module — Super-Admin only"
        message="This module is in Phase 1 (isolated, local, unvalidated). Access is restricted to Super-Admins until it is validated for wider use."
      />
    );
  }

  return (
    <div className="po-premium max-w-[1400px] mx-auto px-4 py-6">
      <header className="mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold tracking-tight">Packing List Module</h1>
          <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 border border-amber-400 text-amber-700 bg-amber-50 rounded-sm">
            Phase 1 · Super-Admin · Local
          </span>
        </div>
        <p className="text-sm text-neutral-500 mt-1">
          Standalone packing calculations from the imported packaging database. Not yet connected to
          Sales / Operations / PI / Quotation / SR / Transport workflows.
        </p>
      </header>

      <nav className="flex gap-1 border-b border-neutral-200 mb-6 flex-wrap">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="px-3 py-2 text-sm text-neutral-600 hover:text-neutral-900 border-b-2 border-transparent hover:border-neutral-300 -mb-px"
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
