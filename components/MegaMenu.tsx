"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavCategory } from "@/lib/navigation";
import { NavGlyph, NavArrow, pickGlyph } from "@/components/NavIcons";

/**
 * Premium top mega menu. PURE PRESENTATION — receives an already permission-
 * filtered tree (`categories`) computed on the server (components/Nav.tsx via
 * buildVisibleNavigation). No permission checks here.
 *
 * Visual: validated mega-menu mockup — dark trigger with green caret/underline,
 * white dropdown panel (big shadow), columns from groups, each item an icon
 * box (inverts to ink on hover) + title + sub + arrow + green hover rail.
 * The Orders category renders as a single-column status list.
 */
export default function MegaMenu({
  categories,
  badges,
  itemBadges,
}: {
  categories: NavCategory[];
  /** categoryId → count of items requiring the current user's action. */
  badges?: Record<string, number>;
  /** item href (base, no query) → action count, shown on the row. */
  itemBadges?: Record<string, number>;
}) {
  const pathname = usePathname() ?? "";
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

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
    <nav ref={rootRef} className="flex items-stretch h-[62px]">
      {categories.map((cat, i) => {
        const hasPanel = cat.groups.length > 0;
        const active = isActiveCategory(cat);
        const catBadge = badges?.[cat.id] ?? 0;

        // Direct-link category (e.g. Dashboard): plain link, no panel.
        if (!hasPanel && cat.href) {
          return (
            <Link
              key={cat.id}
              href={cat.href}
              className={`sx-navlink flex items-center gap-2 px-4 text-[13.5px] font-medium transition-colors ${
                active ? "text-white is-open" : "text-[#DFDEE4] hover:text-white"
              }`}
            >
              {cat.label}
              {catBadge > 0 && (
                <span className="sx-navcount">{catBadge > 99 ? "99+" : catBadge}</span>
              )}
            </Link>
          );
        }

        const open = openId === cat.id;
        const alignRight = i >= categories.length - 2;
        const isOrders = cat.id === "orders";
        const cols = cat.groups.length;

        return (
          <div
            key={cat.id}
            className="relative flex"
            onMouseEnter={() => setOpenId(cat.id)}
            onMouseLeave={() =>
              setOpenId((cur) => (cur === cat.id ? null : cur))
            }
          >
            <button
              type="button"
              aria-expanded={open}
              aria-haspopup="true"
              onClick={() => setOpenId((cur) => (cur === cat.id ? null : cat.id))}
              className={`sx-navlink flex items-center gap-2 px-4 text-[13.5px] font-medium transition-colors ${
                active || open ? "text-white" : "text-[#DFDEE4] hover:text-white"
              } ${open ? "is-open" : ""}`}
            >
              {cat.label}
              {catBadge > 0 && (
                <span className="sx-navcount">{catBadge > 99 ? "99+" : catBadge}</span>
              )}
              <span className="sx-caret" aria-hidden>
                ▾
              </span>
            </button>

            {open &&
              (isOrders ? (
                <div
                  className="sx-mega sx-list"
                  style={alignRight ? { right: 0, left: "auto" } : undefined}
                >
                  <div className="sx-colhead">{cat.label}</div>
                  {cat.groups
                    .flatMap((g) => g.items)
                    .map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpenId(null)}
                        className={`sx-li ${isActiveHref(item.href) ? "is-active" : ""}`}
                      >
                        <span className={`sx-lidot ${orderDot(item.label)}`} />
                        <span className="sx-body">
                          <span className="sx-title">{item.label}</span>
                          {item.description && (
                            <span className="sx-sub">{item.description}</span>
                          )}
                        </span>
                        <span className="sx-arrow">
                          <NavArrow />
                        </span>
                      </Link>
                    ))}
                </div>
              ) : (
                <div
                  className="sx-mega"
                  style={alignRight ? { right: 0, left: "auto" } : undefined}
                >
                  <div
                    className="sx-mega-cols"
                    style={{
                      gridTemplateColumns: `repeat(${cols}, 290px)`,
                    }}
                  >
                    {cat.groups.map((group, gi) => (
                      <div
                        key={group.title}
                        className={`sx-mega-col ${
                          cols > 1 && gi === cols - 1 ? "accent" : ""
                        }`}
                      >
                        <div className="sx-colhead">{group.title}</div>
                        {group.items.map((item) => {
                          const itemActive = isActiveHref(item.href);
                          const cnt = itemBadges?.[base(item.href)] ?? 0;
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={() => setOpenId(null)}
                              className={`sx-item ${itemActive ? "is-active" : ""}`}
                            >
                              <span className="sx-ic">
                                <NavGlyph name={pickGlyph(item.label)} />
                              </span>
                              <span className="sx-body">
                                <span className="sx-title">
                                  {item.label}
                                  {cnt > 0 && (
                                    <span className="sx-badge">
                                      <span className="sx-ring" />
                                      {cnt > 99 ? "99+" : cnt}
                                    </span>
                                  )}
                                </span>
                                {item.description && (
                                  <span className="sx-sub">{item.description}</span>
                                )}
                              </span>
                              <span className="sx-arrow">
                                <NavArrow />
                              </span>
                            </Link>
                          );
                        })}
                        {gi === 0 && cat.href && (
                          <div className="sx-colfoot">
                            <Link
                              href={cat.href}
                              onClick={() => setOpenId(null)}
                              className="sx-footlink"
                            >
                              <NavArrow /> All {cat.label.toLowerCase()}
                            </Link>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        );
      })}
      {openId && <div className="sx-scrim" aria-hidden />}
    </nav>
  );
}

/** Status dot tone for the Orders list variant. */
function orderDot(label: string): string {
  const s = label.toLowerCase();
  if (/production/.test(s)) return "live";
  if (/archiv/.test(s)) return "hollow";
  return "ink";
}
