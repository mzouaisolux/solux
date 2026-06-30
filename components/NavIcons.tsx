import type { ReactNode } from "react";

/**
 * Small line-icon set for the premium mega menu / notifications. Icons mirror
 * the validated mockup (Feather/Lucide style). `pickGlyph` maps a nav label to
 * the most fitting glyph by keyword, with a neutral default.
 */
const P = (d: string) => <path d={d} key={d} />;

const GLYPHS: Record<string, ReactNode> = {
  users: (
    <>
      {P("M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2")}
      <circle cx="9" cy="7" r="4" />
      {P("M23 21v-2a4 4 0 0 0-3-3.87")}
      {P("M16 3.13a4 4 0 0 1 0 7.75")}
    </>
  ),
  "user-plus": (
    <>
      {P("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2")}
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </>
  ),
  chart: (
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </>
  ),
  file: (
    <>
      {P("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z")}
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </>
  ),
  trending: (
    <>
      {P("M3 3v18h18")}
      {P("M7 14l4-4 3 3 5-6")}
    </>
  ),
  check: (
    <>
      {P("M22 11.08V12a10 10 0 1 1-5.93-9.14")}
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  dollar: (
    <>
      <line x1="12" y1="1" x2="12" y2="23" />
      {P("M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6")}
    </>
  ),
  package: (
    <>
      {P(
        "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
      )}
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </>
  ),
  list: (
    <>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </>
  ),
  edit: (
    <>
      {P("M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7")}
      {P("M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z")}
    </>
  ),
  tool: (
    <>
      {P("M2 20a8 8 0 0 1 16 0")}
      {P("M2 20h20l-3-9-4 3-3-6-3 6-4-3z")}
    </>
  ),
  grid: (
    <>
      <rect x="2" y="2" width="8" height="8" rx="1" />
      <rect x="14" y="14" width="8" height="8" rx="1" />
      {P("M10 6h6a2 2 0 0 1 2 2v6")}
    </>
  ),
  book: (
    <>
      {P("M4 19.5A2.5 2.5 0 0 1 6.5 17H20")}
      {P("M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z")}
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      {P(
        "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
      )}
    </>
  ),
  dot: <circle cx="12" cy="12" r="3" />,
};

/** Pick the glyph name that best fits a nav label. */
export function pickGlyph(label: string): string {
  const s = label.toLowerCase();
  if (/new client|add client/.test(s)) return "user-plus";
  if (/client|account|directory/.test(s)) return "users";
  if (/forecast|projection/.test(s)) return "trending";
  if (/overview|pipeline|business|dashboard/.test(s)) return "chart";
  if (/quotation|quote|document|proposal/.test(s)) return "file";
  if (/approval|pending|await|validation|validated|ready/.test(s)) return "clock";
  if (/cost|finance|rmb|margin/.test(s)) return "dollar";
  if (/price list|pricing|price/.test(s)) return "list";
  if (/library/.test(s)) return "book";
  if (/factory|mapping|tool/.test(s)) return "tool";
  if (/component|reference/.test(s)) return "grid";
  if (/categor/.test(s)) return "grid";
  if (/template/.test(s)) return "file";
  if (/revision|edit/.test(s)) return "edit";
  if (/task list|task/.test(s)) return "list";
  if (/logistics|packing|freight|catalog|product|order|production|shipping|delivered|archived|package/.test(s))
    return "package";
  if (/project|request|tender/.test(s)) return "check";
  if (/admin|setting|user|permission|config/.test(s)) return "settings";
  return "dot";
}

/** Render a line glyph by name. */
export function NavGlyph({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {GLYPHS[name] ?? GLYPHS.dot}
    </svg>
  );
}

/** Standard right-arrow used on items / footers. */
export function NavArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
