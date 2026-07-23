"use client";

import { useState } from "react";

/**
 * OPS DENSE — tab bar for the task-list cockpit.
 *
 * The page used to be one very long vertical stack: reaching the activity log
 * meant ~10 000 px of scrolling. The sections are now panels behind a tab bar,
 * so the whole file is reachable in one click and the viewport always shows a
 * complete, self-contained working area.
 *
 * RSC-safe by construction: the panels are rendered on the SERVER and handed
 * over as `children`. This component never re-renders them — it only toggles
 * which one is visible. Every form, server action and permission gate inside a
 * panel keeps working exactly as before.
 *
 * Panels are hidden with `display:none` rather than unmounted, so:
 *   - in-progress form input is never lost when switching tabs;
 *   - the browser's in-page search still finds everything;
 *   - anchor links from the "Needs attention" list keep resolving.
 */

export type OpsTabDef = {
  id: string;
  label: string;
  /** Small badge — a count of things needing attention in that panel. */
  count?: number | null;
  /** Neutral badge (informational, e.g. activity) instead of the amber one. */
  neutral?: boolean;
};

export default function OpsTabs({
  tabs,
  initial,
  children,
}: {
  tabs: OpsTabDef[];
  initial?: string;
  children: React.ReactNode;
}) {
  const first = tabs[0]?.id ?? "";
  const [active, setActive] = useState(initial && tabs.some((t) => t.id === initial) ? initial : first);

  return (
    <>
      <div className="ops-tabbar" role="tablist" aria-label="Task list sections">
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`ops-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`ops-panel-${t.id}`}
              className={`ops-tab${on ? " is-on" : ""}`}
              data-testid={`ops-tab-${t.id}`}
              onClick={() => setActive(t.id)}
            >
              <span>{t.label}</span>
              {t.count != null && t.count > 0 && (
                <span className={`ops-tab-count${t.neutral ? " neutral" : ""}`}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* The active panel is exposed through a data attribute; the CSS hides
          every other one. Keeping the markup mounted preserves form state. */}
      <div className="ops-panels" data-active={active}>
        {children}
      </div>
    </>
  );
}

/** Server-rendered wrapper for one panel. */
export function OpsPanel({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="ops-panel"
      data-ops-panel={id}
      id={`ops-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`ops-tab-${id}`}
    >
      {children}
    </div>
  );
}
