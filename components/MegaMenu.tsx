"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const triggerRefs = useRef<Map<string, HTMLElement>>(new Map());
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Computed viewport position of the open panel (anchored to its trigger).
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

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

  // Anchor the open panel to ITS trigger: a single-column menu drops directly
  // under the button (left-aligned); a wide multi-column menu is centred under
  // it. The left is clamped to the viewport so a panel never spills off either
  // edge. `top` is the nav's measured bottom (so it's banner-aware) and is
  // shared with the scrim, whose dim therefore never reaches above the titles.
  useLayoutEffect(() => {
    if (!openId) {
      setPos(null);
      return;
    }
    const place = () => {
      const root = rootRef.current;
      const trigger = triggerRefs.current.get(openId);
      if (!root || !trigger) return;
      const navBottom = root.getBoundingClientRect().bottom;
      const t = trigger.getBoundingClientRect();
      const pw = panelRef.current?.offsetWidth ?? 0;
      const cols = categories.find((c) => c.id === openId)?.groups.length ?? 1;
      const MARGIN = 12;
      let left = cols >= 2 ? t.left + t.width / 2 - pw / 2 : t.left;
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - pw - MARGIN));
      setPos({ left, top: navBottom });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [openId, categories]);

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
      {categories.map((cat) => {
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
              {cat.icon && (
                <span className="sx-navic" aria-hidden>
                  <NavGlyph name={cat.icon} />
                </span>
              )}
              {cat.label}
              {catBadge > 0 && (
                <span className="sx-navcount">{catBadge > 99 ? "99+" : catBadge}</span>
              )}
            </Link>
          );
        }

        const open = openId === cat.id;
        const isOrders = cat.id === "orders";
        const cols = cat.groups.length;

        // Option A: hover (or keyboard focus) opens the panel; clicking the
        // section label NAVIGATES to its landing page (cat.href, resolved in
        // buildVisibleNavigation). Panels are LEFT-ANCHORED to the nav root
        // with content-driven width (see nav-premium.css) — every section
        // opens at the same left point; width follows its content. Banner-
        // aware via top:100% of the nav (which sits below the sim banner).
        return (
          <div
            key={cat.id}
            ref={(el) => {
              if (el) triggerRefs.current.set(cat.id, el);
              else triggerRefs.current.delete(cat.id);
            }}
            className="flex"
            onMouseEnter={() => setOpenId(cat.id)}
            onMouseLeave={() =>
              setOpenId((cur) => (cur === cat.id ? null : cur))
            }
            onFocus={() => setOpenId(cat.id)}
          >
            <Link
              href={cat.href ?? "#"}
              aria-haspopup="true"
              aria-expanded={open}
              onClick={() => setOpenId(null)}
              className={`sx-navlink flex items-center gap-2 px-4 text-[13.5px] font-medium transition-colors ${
                active || open ? "text-white" : "text-[#DFDEE4] hover:text-white"
              } ${open ? "is-open" : ""}`}
            >
              {cat.icon && (
                <span className="sx-navic" aria-hidden>
                  <NavGlyph name={cat.icon} />
                </span>
              )}
              {cat.label}
              {catBadge > 0 && (
                <span className="sx-navcount">{catBadge > 99 ? "99+" : catBadge}</span>
              )}
              <span className="sx-caret" aria-hidden>
                ▾
              </span>
            </Link>

            {open &&
              (isOrders ? (
                <div
                  ref={panelRef}
                  className="sx-mega sx-list"
                  style={{ left: pos?.left, top: pos?.top, visibility: pos ? undefined : "hidden" }}
                >
                  <div className="sx-mega-inner">
                    <div className="sx-list-col">
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
                  </div>
                </div>
              ) : (
                <div
                  ref={panelRef}
                  className="sx-mega"
                  style={{ left: pos?.left, top: pos?.top, visibility: pos ? undefined : "hidden" }}
                >
                  <div className="sx-mega-inner">
                    <div
                      className="sx-mega-cols"
                      style={{
                        gridTemplateColumns: `repeat(${cols}, ${cat.colWidth ?? 290}px)`,
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
                            const inner = (
                              <>
                                <span className="sx-ic">
                                  <NavGlyph name={item.icon ?? pickGlyph(item.label)} />
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
                                    {item.badge && (
                                      <span className="ml-1.5 inline-flex items-center rounded-full border border-neutral-200 bg-neutral-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
                                        {item.badge}
                                      </span>
                                    )}
                                  </span>
                                  {item.description && (
                                    <span className="sx-sub">{item.description}</span>
                                  )}
                                </span>
                                {!item.disabled && (
                                  <span className="sx-arrow">
                                    <NavArrow />
                                  </span>
                                )}
                              </>
                            );
                            // Coming-soon items render as inert rows — same
                            // look, no navigation (trains users to the future
                            // architecture without a dead link).
                            if (item.disabled) {
                              return (
                                <span
                                  key={`${item.href}-${item.label}`}
                                  className="sx-item cursor-default opacity-55"
                                  aria-disabled="true"
                                >
                                  {inner}
                                </span>
                              );
                            }
                            return (
                              <Link
                                // Label-scoped key — two request items may share
                                // one target href (both land on the SR wizard).
                                key={`${item.href}-${item.label}`}
                                href={item.href}
                                onClick={() => setOpenId(null)}
                                className={`sx-item ${itemActive ? "is-active" : ""}`}
                              >
                                {inner}
                              </Link>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        );
      })}
      {openId && <div className="sx-scrim" aria-hidden style={{ top: pos?.top ?? 0 }} />}
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
