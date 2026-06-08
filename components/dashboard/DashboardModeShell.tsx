"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * Dashboard mode shell — wraps the dashboard in a client component
 * that toggles between two layout modes ("business" / "operations")
 * without re-fetching anything from the server.
 *
 * How it works
 * ------------
 * The server-rendered dashboard page lays out BOTH views as siblings
 * in the DOM (one wrapped in `<BusinessSlot>`, the other in
 * `<OperationsSlot>`). This shell hosts a context that broadcasts the
 * active mode; the slots subscribe and apply `display: none` to the
 * inactive one. Switching is instant — no router refresh, no SSR
 * re-render, no double data fetch.
 *
 * Persistence
 * -----------
 * Last selected mode is saved to `localStorage` under
 * `solux-dashboard-mode`. On mount we hydrate from that value; on
 * change we write it back. The hydration runs in a `useEffect` so
 * the initial server-rendered HTML is consistent (no flash from
 * mismatched default).
 */

export type DashboardMode = "business" | "operations";

const STORAGE_KEY = "solux-dashboard-mode";
// Operations is the cockpit-first default: when a user lands on the
// dashboard fresh (no stored preference), they see the operational
// state of the company — what's awaiting deposit, what's delayed,
// what events need attention. Business mode is still one click away
// for momentum / KPI review.
const DEFAULT_MODE: DashboardMode = "operations";

const ModeContext = createContext<{
  mode: DashboardMode;
  setMode: (m: DashboardMode) => void;
}>({
  mode: DEFAULT_MODE,
  setMode: () => {},
});

/** Wrap the dashboard subtree so child slots + the toggle share mode state. */
export function DashboardModeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Start with the SSR default so the initial render matches the
  // server output. Hydrate from localStorage in an effect so we don't
  // create a hydration mismatch.
  const [mode, setModeState] = useState<DashboardMode>(DEFAULT_MODE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "operations" || saved === "business") {
        setModeState(saved);
      }
    } catch {
      // localStorage unavailable (private mode, SSR) — keep default.
    }
    setHydrated(true);
  }, []);

  function setMode(next: DashboardMode) {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best-effort persistence.
    }
  }

  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {/* During pre-hydration, render with `business` default so layout
          is stable. After hydration, the actual stored mode takes over.
          We pass `hydrated` to the slot consumers via the data attribute
          so they can avoid showing the wrong panel for a frame. */}
      <div data-dashboard-hydrated={hydrated ? "true" : "false"}>
        {children}
      </div>
    </ModeContext.Provider>
  );
}

/** Toggle UI — sits at the center top of the dashboard header. */
export function DashboardModeToggle() {
  const { mode, setMode } = useContext(ModeContext);
  // Operations first — it's the default landing mode and the primary
  // cockpit view. Business sits to the right for the secondary
  // "how are sales doing?" perspective.
  const items: { value: DashboardMode; label: string }[] = [
    { value: "operations", label: "Operations" },
    { value: "business", label: "Business" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Dashboard mode"
      className="inline-flex items-center rounded-lg border border-neutral-200 bg-white p-0.5 shadow-sm"
    >
      {items.map((item) => {
        const active = mode === item.value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setMode(item.value)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Slot that renders its children only when the active mode matches.
 * `display: none` on the inactive slot keeps the DOM mounted (no
 * re-render cost on toggle, instant flip).
 */
function ModeSlot({
  when,
  children,
}: {
  when: DashboardMode;
  children: React.ReactNode;
}) {
  const { mode } = useContext(ModeContext);
  const active = mode === when;
  return (
    <div
      style={{ display: active ? "block" : "none" }}
      aria-hidden={!active}
      data-mode-slot={when}
    >
      {children}
    </div>
  );
}

/** Children render only in BUSINESS mode. */
export function BusinessSlot({ children }: { children: React.ReactNode }) {
  return <ModeSlot when="business">{children}</ModeSlot>;
}

/** Children render only in OPERATIONS mode. */
export function OperationsSlot({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ModeSlot when="operations">{children}</ModeSlot>;
}
