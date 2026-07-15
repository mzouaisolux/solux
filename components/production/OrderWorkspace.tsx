"use client";

import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * OrderWorkspace — the "Ops Dense" single-screen cockpit shell (owner mockup
 * 2026-07-15). A top tab bar switches the LEFT column between the order's
 * sections; the RIGHT rail (Needs Attention / At a Glance / Latest Activity)
 * is persistent and passed as `rail`. No reload, no route change, no scroll
 * between sections. Same design tokens — this only arranges them.
 *
 * Inactive panels stay MOUNTED (display:none) so a half-filled form is never
 * lost when the operator flips sections and back.
 */

export type WsTone = "complete" | "attention" | "blocked" | "idle";
export type WsTab = {
  id: string;
  label: string;
  tone: WsTone;
  /** short status shown next to the label, e.g. "$96k due", "blocked", "0/7". */
  status?: string;
};

// Attention amber matches the mockup (#e8870e); complete uses the brand's
// deep green; idle is the neutral mute. The only added colour is the amber.
const DOT: Record<WsTone, string> = {
  complete: "#0b7a39",
  attention: "#e8870e",
  blocked: "#e8870e",
  idle: "#aeaaba",
};

export default function OrderWorkspace({
  tabs,
  initial,
  rail,
  children,
}: {
  tabs: WsTab[];
  initial?: string | null;
  rail: ReactNode;
  children: ReactNode;
}) {
  const panels = Children.toArray(children);
  const ids = tabs.map((t) => t.id);
  const firstValid =
    initial && ids.includes(initial) ? initial : tabs[0]?.id ?? "";
  const [active, setActive] = useState<string>(firstValid);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace(/^#area-/, "");
      if (h && ids.includes(h)) setActive(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeIndex = Math.max(0, ids.indexOf(active));

  const onKeyNav = useCallback(
    (e: React.KeyboardEvent, i: number) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const next =
        e.key === "ArrowRight"
          ? (i + 1) % tabs.length
          : (i - 1 + tabs.length) % tabs.length;
      setActive(tabs[next].id);
      tabRefs.current[next]?.focus();
    },
    [tabs]
  );

  return (
    <div className="ws-root">
      <div className="ws-nav" role="tablist" aria-label="Order sections">
        {tabs.map((t, i) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onKeyNav(e, i)}
              className={`ws-tab ${on ? "is-active" : ""}`}
            >
              <span
                className="ws-dot"
                style={{ background: DOT[t.tone] }}
                aria-hidden
              />
              <span>{t.label}</span>
              {t.status ? <span className="ws-st">{t.status}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="ops-grid">
        <div className="ops-main">
          {panels.map((panel, i) => {
            const on = i === activeIndex;
            return (
              <div
                key={i}
                role="tabpanel"
                aria-hidden={!on}
                className={`ws-stage ${on ? "is-on" : ""}`}
                style={on ? undefined : { display: "none" }}
              >
                {panel}
              </div>
            );
          })}
        </div>
        <aside className="ops-rail">{rail}</aside>
      </div>
    </div>
  );
}
