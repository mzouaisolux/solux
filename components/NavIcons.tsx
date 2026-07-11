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
  /* --- Solux DNA skin (client hub) — document folders & inline actions.
     Paths mirror the validated client-hub mockup exactly. --- */
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="0" />
      {P("M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18")}
    </>
  ),
  flask: P(
    "M9 3h6M10 3v5.2L4.6 18a2 2 0 0 0 1.8 3h11.2a2 2 0 0 0 1.8-3L14 8.2V3M7.5 15h9"
  ),
  dividers: (
    <>
      <circle cx="12" cy="5" r="2" />
      {P("M11 6.7 5 21M13 6.7 19 21M7.6 15h8.8")}
    </>
  ),
  factory: P("M2 21h20M4 21V8.5l5 3.5V8.5l5 3.5V8.5l5 3.5V21M8 17h2M14 17h2"),
  ship: (
    <>
      {P("M3 14h18l-2 5H5Z")}
      {P("M6 14V9h12v5M12 9V5")}
    </>
  ),
  paperclip: P(
    "M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
  ),
  envelope: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      {P("m3 7 9 6 9-6")}
    </>
  ),
  doc: (
    <>
      {P("M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z")}
      {P("M14 3v4h4M9.5 12h5M9.5 16h5")}
    </>
  ),
  time: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P("M12 7v5l3.2 1.9")}
    </>
  ),
  arrow: P("M5 12h14M13 6l6 6-6 6"),
  /* --- Requests mega menu (validated mockup 2026-07-10) --- */
  bolt: P("M13 2 3 14h8l-1 8 11-12h-8l1-8Z"),
  truck: (
    <>
      {P("M1 5h14v11H1zM15 9h4l3.2 3.4V16H15z")}
      <circle cx="5.5" cy="18" r="1.8" />
      <circle cx="18" cy="18" r="1.8" />
    </>
  ),
  bulb: P(
    "M9 18h6M10.5 21h3M12 3a6 6 0 0 0-3.9 10.6c.7.6 1.1 1.5 1.1 2.4h5.6c0-.9.4-1.8 1.1-2.4A6 6 0 0 0 12 3Z"
  ),
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="9.2" />
      {P("m8.2 12.4 2.6 2.6 5-5.4")}
    </>
  ),
  /* --- Incoming Requests mega menu (Ops/TLM processing side) --- */
  inbox: (
    <>
      {P("M22 12h-6l-2 3h-4l-2-3H2")}
      {P(
        "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"
      )}
    </>
  ),
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

/**
 * Small inline icon for button/label text (Solux DNA skin). Renders at
 * 13px via the `.sx-inline-ic` rule in premium.css, aligned to the text
 * baseline — replaces the old emoji glyphs (📧 ⏳ 🚀).
 */
export function InlineIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="sx-inline-ic"
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
