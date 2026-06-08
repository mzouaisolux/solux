"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavCategory } from "@/lib/navigation";

/**
 * Top mega menu. PURE PRESENTATION — it receives an already permission-
 * filtered tree (`categories`) computed on the server in components/Nav.tsx
 * via buildVisibleNavigation(). It performs NO permission checks itself, so
 * the access logic stays in one place and can't drift.
 *
 * Behavior (desktop): a category with groups opens a dropdown panel on hover
 * or click; a category with only an `href` is a plain link. Panels close on
 * mouse-leave, click-outside, or Escape. Subtle fade/slide transition.
 */
export default function MegaMenu({
  categories,
  badges,
  itemBadges,
}: {
  categories: NavCategory[];
  /** categoryId → count of items requiring the current user's action. */
  badges?: Record<string, number>;
  /** item href (base, no query) → action count, shown right-aligned on the row. */
  itemBadges?: Record<string, number>;
}) {
  const pathname = usePathname() ?? "";
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  const ActionBadge = ({ id }: { id: string }) => {
    const n = badges?.[id] ?? 0;
    if (n <= 0) return null;
    return (
      <span
        className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white"
        aria-label={`${n} item${n === 1 ? "" : "s"} need action`}
      >
        {n > 99 ? "99+" : n}
      </span>
    );
  };

  // Close on click-outside + Escape.
  useEffect(() => {
    if (!openId) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  const base = (href: string) => href.split("?")[0];
  const isActiveHref = (href: string) => {
    const b = base(href);
    return pathname === b || pathname.startsWith(b + "/");
  };
  const isActiveCategory = (cat: NavCategory) => {
    if (cat.href && isActiveHref(cat.href)) return true;
    return cat.groups.some((g) => g.items.some((i) => isActiveHref(i.href)));
  };

  return (
    <nav ref={rootRef} className="flex items-center gap-1">
      {categories.map((cat) => {
        const hasPanel = cat.groups.length > 0;
        const active = isActiveCategory(cat);

        // Direct-link category (Dashboard, Operations): plain link, no panel.
        if (!hasPanel && cat.href) {
          return (
            <Link
              key={cat.id}
              href={cat.href}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                active
                  ? "text-neutral-900 bg-neutral-100"
                  : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50"
              }`}
            >
              {cat.label}
              <ActionBadge id={cat.id} />
            </Link>
          );
        }

        const open = openId === cat.id;
        // Width scales with the number of columns; capped so it never feels heavy.
        const cols = Math.min(cat.groups.length, 3);
        const panelWidth =
          cols >= 3 ? "w-[640px]" : cols === 2 ? "w-[460px]" : "w-[260px]";

        return (
          <div
            key={cat.id}
            className="relative"
            onMouseEnter={() => setOpenId(cat.id)}
            onMouseLeave={() => setOpenId((cur) => (cur === cat.id ? null : cur))}
          >
            <button
              type="button"
              aria-expanded={open}
              aria-haspopup="true"
              onClick={() => setOpenId((cur) => (cur === cat.id ? null : cat.id))}
              className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                active || open
                  ? "text-neutral-900 bg-neutral-100"
                  : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50"
              }`}
            >
              {cat.label}
              <ActionBadge id={cat.id} />
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden
                className={`h-3.5 w-3.5 text-neutral-400 transition-transform duration-200 ${
                  open ? "rotate-180" : ""
                }`}
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 1 1 1.08 1.04l-4.25 4.39a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {/* Panel — kept mounted for a smooth transition; pointer-events
                disabled while closed so it never blocks the page. */}
            <div
              className={`absolute left-0 top-full z-50 pt-2 transition duration-150 ease-out ${
                open
                  ? "opacity-100 translate-y-0 visible"
                  : "pointer-events-none invisible -translate-y-1 opacity-0"
              }`}
            >
              <div
                className={`${panelWidth} rounded-xl border border-neutral-200 bg-white p-4 shadow-lg shadow-neutral-200/60`}
              >
                <div
                  className="grid gap-x-6 gap-y-1"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                  {cat.groups.map((group) => (
                    <div key={group.title} className="min-w-0">
                      <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widerx text-neutral-400">
                        {group.title}
                      </div>
                      <ul className="space-y-0.5">
                        {group.items.map((item) => {
                          const itemActive = isActiveHref(item.href);
                          const itemCount = itemBadges?.[base(item.href)] ?? 0;
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                onClick={() => setOpenId(null)}
                                className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                                  itemActive
                                    ? "bg-neutral-100"
                                    : "hover:bg-neutral-50"
                                }`}
                              >
                                <span className="min-w-0 flex-1">
                                  <span
                                    className={`block text-[13px] font-medium ${
                                      itemActive
                                        ? "text-neutral-900"
                                        : "text-neutral-700"
                                    }`}
                                  >
                                    {item.label}
                                  </span>
                                  {item.description && (
                                    <span className="block text-[11px] text-neutral-400">
                                      {item.description}
                                    </span>
                                  )}
                                </span>
                                {itemCount > 0 && (
                                  <span
                                    className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold leading-none text-white"
                                    aria-label={`${itemCount} need action`}
                                  >
                                    {itemCount > 99 ? "99+" : itemCount}
                                  </span>
                                )}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
