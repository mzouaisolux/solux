"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminTab = { href: string; label: string };

/**
 * Bottom-of-header tab bar for /admin/*.
 *
 * Tabs are passed in from the layout so the layout can filter them
 * server-side based on the caller's capabilities. We can't compute
 * permissions in a "use client" component, and we can't make this
 * tab bar fully server because it depends on `usePathname()` for the
 * active highlight. Passing the filtered array in is the simplest
 * boundary.
 */
export default function AdminTabs({ tabs }: { tabs: AdminTab[] }) {
  const pathname = usePathname() ?? "";
  return (
    <div className="solux-pro">
      <div className="ad-tabs-wrap">
        <nav className="ad-tabs">
          {tabs.map((t) => {
            const active = pathname === t.href || pathname.startsWith(t.href + "/");
            return (
              <Link key={t.href} href={t.href} className={`ad-tab${active ? " active" : ""}`}>
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
