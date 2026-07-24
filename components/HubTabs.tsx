"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type HubTab = { href: string; label: string; base?: boolean };

/**
 * Section tab bar for /productknowledgehub/* — mirrors AdminTabs styling
 * (.ad-tabs). The base tab (Browse) is the families directory; family and
 * model detail pages live under it, so it stays active on any Hub route that
 * isn't one of the admin sections. Tabs are filtered by capability in the
 * server layout that renders this.
 */
export default function HubTabs({ tabs }: { tabs: HubTab[] }) {
  const pathname = usePathname() ?? "";
  const sectionHrefs = tabs.filter((t) => !t.base).map((t) => t.href);
  const inSection = sectionHrefs.some((h) => pathname === h || pathname.startsWith(h + "/"));
  return (
    <div className="solux-pro">
      <div className="ad-tabs-wrap">
        <nav className="ad-tabs">
          {tabs.map((t) => {
            const active = t.base ? !inSection : pathname === t.href || pathname.startsWith(t.href + "/");
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
