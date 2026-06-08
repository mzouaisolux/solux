# UI_UX_AUDIT.md — SOLUX Interface & UX Audit

> **Scope:** Read-only audit of the current UI/UX. No code was modified. All
> observations are drawn from source files under `app/(app)/`, `components/`,
> `lib/lifecycle.ts`, `lib/action-center.ts`, `lib/order-pills.ts`, and the
> primary documentation under `docs/current-implementation/`.
>
> **Labels used:**
> - **Confirmed** — directly observed in source code or copy strings.
> - **Suspected** — UX inference from code structure; behavior not directly
>   proven by running the app.
> - **Needs confirmation** — requires the running UI to verify.

---

## 1. Navigation & Global Shell

### 1.1 Navigation bar

**Confirmed.** The top nav (`components/Nav.tsx`, line 86) is a sticky full-width
bar 64px tall. It contains:

- Logo (links to `/dashboard`)
- Primary links: Dashboard, V2 ✦, Clients, Task lists, Operations, Forecast, Business
- Admin/Permissions/Users (conditional by capability)
- Right cluster: email address, notification bell, role badge, View-As switcher, Sign out

**Confirmed.** The role badge is always visible when a role is set, using distinct colors per
role (violet for super_admin, black for admin, amber for TLM, sky for Ops, solux-accent
for Sales). This is a useful always-on orientation signal. [Confirmed by code: `Nav.tsx`,
`RoleBadge` function, lines 162–210.]

**Confirmed.** The "V2 ✦" link is permanently in the nav alongside the existing "Dashboard"
link. Both point to active routes (`/dashboard` and `/dashboard-v2`). This creates a
two-dashboard situation that may confuse new users.
[Confirmed by code: `Nav.tsx` line 103.]

**Suspected.** At narrow viewport widths (mobile) the full nav link list likely overflows or
wraps in an uncontrolled way — there is no hamburger menu or mobile drawer pattern visible
in the Nav component. The email address already has `hidden md:inline` (line 118) but the
full link list does not appear to collapse.
**Needs confirmation:** Test viewport narrowing to see if nav overflow is handled.

**Confirmed.** The simulation banner ("Dev simulation active") appears above the nav only when
`isSimulating` is true, using amber-100 background with amber-900 text.
[Confirmed by code: `Nav.tsx`, lines 74–84.]

**Standing rule preserved [Confirmed].** Rule 1.7 (RULES_CANDIDATE.md) calls for a visible
note that View-As does not reduce real privileges. The simulation banner exists but calls the
feature "Dev simulation" which may understate its read-only safety character. The banner
says "Server actions still use your real role" — this is the substance of the required note.
**Needs confirmation:** whether "Dev simulation" phrasing is sufficient or needs clarifying
as "UI simulation only — your real permissions still apply to all writes."

---

## 2. Dashboard (classic `/dashboard`)

### 2.1 Structure

**Confirmed.** The classic dashboard (`app/(app)/dashboard/page.tsx`) uses a
`DashboardModeShell` with Operations/Business slots. The Operations slot renders
an `OperationsCockpit` component plus the `OrdersInFlight` component and an
`ActionCenter`. The Business slot contains forecast and KPI data.

**Confirmed.** The `OrdersInFlight` component is always present in the
Operations view of the classic dashboard. The 6-phase pipeline strip (Quote →
Task list → Payment → Production → Shipping → Delivered) is rendered for every
order row. [Confirmed by code: `components/dashboard/OrdersInFlight.tsx`.]

### 2.2 Information hierarchy on each order row (OrdersInFlight)

**Confirmed.** Each row contains four visual layers from top to bottom:

1. **Header line**: client name (semi-bold, 14px), client country, affair name
   (12px), doc number + product summary (11px mono). Value (bold tabular-nums,
   14px) anchored right with "Value" label (10px). This is correct hierarchy —
   client name dominates, number is subordinate.
   [Confirmed by code: `OrdersInFlight.tsx`, lines 173–207.]

2. **Chip row**: stage badge (11px, toned), ETA chip (10px), operational pills
   (10px, flex-wrap). All on one line, compact by width.
   [Confirmed by code: lines 214–238.]

3. **6-phase progress strip**: dot-connector visualization with color states
   (active dot in stage tone, done in neutral-900, pending as white border).
   [Confirmed by code: lines 247–295.]

4. **Phase labels**: 10px uppercase labels beneath each dot.
   [Confirmed by code: lines 275–295.]

**Confirmed: standing rule honored.** m076 (compact by width, not height) is
observed: metadata row is flex single-line with `flex-wrap` as the only overflow
escape. [Confirmed by code: `OrdersInFlight.tsx`, line 214, `flex items-center gap-1.5 flex-wrap`.]

**Confirmed: ETA pairing rule honored.** The `etaChipLabel` function always
produces an ETA or Delivered chip that sits adjacent to any delay pill, so
users never see a delay number without an ETA date.
[Confirmed by code: `OrdersInFlight.tsx`, lines 59–102, and the comment at line 163.]

**Standing rule preserved [Confirmed].** The 6-phase pipeline strip is kept
on every row and never simplified away. The phase names match the canonical
`ORDER_FLIGHT_PHASES` constant: `["Quote", "Task list", "Payment", "Production",
"Shipping", "Delivered"]`. [Confirmed by code: `lib/lifecycle.ts`, line 257–264.]

**Suspected UX concern.** On rows where no `affair_name` is set, the header
collapses to a two-line layout (client + doc number), which is compact. On rows
where `affair_name` is present, three lines appear before the chip row. With 8+
orders in flight, this height difference may create inconsistent row heights
that feel slightly uneven.
**Needs confirmation:** Observe rows with vs. without affair_name in the live UI.

**Suspected.** The `product_summary` field (line 189) is a concatenation string
rendered at 11px in a truncated line after the doc number. If product names are
verbose (e.g. "Solar Street Light SLX-VPL-26-030 · LED Floodlight FLD-200W"),
this line truncates and important context is lost.
**Needs confirmation:** Check how product_summary is generated and its typical
character count.

**Confirmed.** Empty state copy: "No orders in flight yet. Once a quotation is
marked **Won**, it'll show up here." Calm and instructional.
[Confirmed by code: `OrdersInFlight.tsx`, lines 128–136.]

---

## 3. Dashboard V2 (`/dashboard-v2`)

**Confirmed.** Dashboard V2 is labeled "Beta · V2" in the header. It is
experimental and non-destructive (its own route). The Operations tab shows
`ActionCenterV2`; the Business tab shows three KPI cards (pipeline value, won
value, active deal count) and a pointer to Forecast/Business.
[Confirmed by code: `app/(app)/dashboard-v2/page.tsx`.]

**Confirmed.** The V2 page title is "What needs you now" — action-oriented
framing. There is a paragraph explicitly inviting comparison with the classic
dashboard via an underline link.
[Confirmed by code: `dashboard-v2/page.tsx`, lines 41–50.]

**Confirmed.** The V2 business tab currently shows only 3 KPI cards and a brief
note that "We'll progressively decide what belongs here vs. the classic view."
This tab is explicitly incomplete.
[Confirmed by code: `dashboard-v2/page.tsx`, lines 126–178.]

**Suspected.** Having two dashboards in the nav simultaneously (Dashboard + V2)
without a clear "this one is the default" signal may cause navigational confusion,
especially for new users who encounter the "V2 ✦" label without context.
**Needs confirmation:** Intended retirement timeline for the classic dashboard.

---

## 4. Action Center (classic, `components/action-center/ActionCenter.tsx`)

### 4.1 Density and layout

**Confirmed.** The Action Center uses the "single-line title row" layout
(m076): title + role chip + context chips on one line left; SLA tag + amount +
issue magnitude + Open + Done buttons on the right. This is the most compact
arrangement consistent with legibility.
[Confirmed by code: `ActionCenter.tsx`, lines 143–209, and the block comment
at lines 122–128.]

**Confirmed.** The quiet footer carries subtitle, "Added Xd ago", and a
collapsible notes pane on one low-contrast line. This correctly suppresses
secondary information without hiding it.
[Confirmed by code: `ActionCenter.tsx`, lines 214–233.]

**Confirmed.** Issue-magnitude (`ageDays`) and card-age (`openedDaysAgo`) are
tracked separately. `ageDays` drives the red number on Urgent items; it is
shown in rose (urgent section) or neutral (other sections). The distinction is
documented in code comments.
[Confirmed by code: `lib/action-center.ts`, lines 119–130; `ActionCenter.tsx`, lines 181–192.]

**Confirmed.** The "Added Xd ago" label turns amber (`text-amber-700`) when a
card has been on the list for 7 or more days, giving a passive staleness signal
without being noisy.
[Confirmed by code: `ActionCenter.tsx`, lines 218–226.]

**Confirmed: standing rule honored.** Empty state copy: "Nothing needs you
right now. When a quote, task list or order needs action, it'll appear here —
and disappear once it's handled." Calm and reassuring.
[Confirmed by code: `ActionCenter.tsx`, lines 64–77.]

**Confirmed.** Empty sections are suppressed (`if (list.length === 0) return null`).
Sections that contain items render with a subtle colored left-border accent and
header dot.
[Confirmed by code: `ActionCenter.tsx`, lines 82–83, 88–89.]

### 4.2 Notes pane

**Confirmed.** The notes pane is a native `<details>/<summary>` element — no
client JS. Browser handles collapse state. Notes use server actions
(`addActionNote`, `deleteActionNote`) which trigger full-page revalidation.
[Confirmed by code: `ActionCenter.tsx`, `NotesPane` function, lines 241–280.]

**Confirmed.** The placeholder text for note input is richly specific: `"Quick
note — "Factory confirmed shipment", "Client informed", "Waiting supplier reply"…"`.
This guides micro-coordination usage without prescribing it.
[Confirmed by code: `ActionCenter.tsx`, line 272.]

**Suspected.** The notes pane opens inline below the card footer. With multiple
notes, the card expands significantly in height, which could break the "compact
by height" intent. There is no max-height or scroll constraint on the expanded
notes list.
**Needs confirmation:** Test a card with 5+ notes to assess height impact.

**Confirmed.** The emoji `💬` is used for note count display ("💬 3"). The
RULES_CANDIDATE.md style preference leans toward no emoji. This is a minor
inconsistency.
[Confirmed by code: `ActionCenter.tsx`, line 249.]
**Needs confirmation:** Owner decision on whether the notes count emoji should be
replaced with a plain text form ("3 notes").

### 4.3 Role chips

**Confirmed.** Each action card shows the role chip for the FIRST role in the
item's roles array (`a.roles[0] ?? "management"`). When an item escalates via
SLA aging to add roles, the chip still shows only the first role.
[Confirmed by code: `ActionCenter.tsx`, line 136.]

**Suspected UX concern.** An escalated item (e.g. deposit 14 days unpaid, now
visible to management) will still show the chip "Sales" rather than indicating
management visibility. A user who is a manager may not understand why a Sales-
labeled card is in their list.
**Needs confirmation:** Verify what an escalated item looks like in the running
UI from a management perspective.

---

## 5. Operations Page (`/operations`)

### 5.1 Page structure

**Confirmed.** The operations page layout (top to bottom):
1. Header with title "Production workspace" and inline KPIs (active · closed · archived · need attention)
2. Role Context Banner (RoleContextBanner)
3. Sales filter bar (technical roles only)
4. KPI strip: 4 compact tiles (Revenue, Balance, Alerts, Closed/Archived)
5. Orphan banner (only when relevant)
6. Action queue top 5 (only when alerts exist)
7. Scope tabs + search bar
8. Bottlenecks banner (only when relevant)
9. Main table (production orders)
10. Footer note
11. Compact operational events strip (3 columns, bottom)
[Confirmed by code: `app/(app)/operations/page.tsx`, layout structure.]

**Confirmed.** The KPI strip uses `max-w-screen-2xl`, and the main table uses
`overflow-x-auto` for wide tables. The table has 12 columns including Order,
Client, Sales, Status, Total, Deposit, Balance, Validated, Est. completion,
Delay, Alert, and an Open link.
[Confirmed by code: `operations/page.tsx`, lines 541–781.]

**Suspected.** With 12 table columns, horizontal scrolling is inevitable on
most monitors below 1400px wide. The column headers are all left-aligned except
Total/Deposit/Balance (right-aligned), but the sticky left border accent (3px
colored left border on the Order cell) may get lost when horizontally scrolled.
**Needs confirmation:** Test horizontal scroll behavior at 1280px viewport.

**Confirmed.** The "Est. completion" column shows the current deadline date and,
when it differs from the original, shows the original with a strikethrough below.
This correctly presents the delay as the relationship between current and original.
[Confirmed by code: `operations/page.tsx`, lines 992–1007.]

**Confirmed.** The "Delay" column renders `DelayBadge` component, sourced from
`lib/types.ts computeProductionDelay`. The badge is separated from the "Est.
completion" column, which means users see delay magnitude and ETA in adjacent
columns — not the same cell. This is a slight separation from the "always pair
+Nd with ETA" rule as observed in the OrdersInFlight strip, but the proximity
(adjacent columns) mitigates it.
[Confirmed by code: `operations/page.tsx`, lines 1008–1010.]

**Confirmed.** The action queue shows top 5 alerts above the table. Alerts are
compact one-liners: colored left-bar accent + order number + client + alert
message + badge. This is appropriately dense.
[Confirmed by code: `operations/page.tsx`, lines 601–645.]

**Confirmed.** The bottlenecks banner uses a bulleted list of three possible
conditions: (1) awaiting deposit >7d, (2) no deadline set, (3) past-due running.
It only renders when at least one condition exists. Copy is concrete and
actionable ("X orders awaiting deposit for over 7 days").
[Confirmed by code: `operations/page.tsx`, lines 691–723.]

**Confirmed.** Sales label in the Sales column shows `role·uuid-slice` format
(e.g. "sales·a3b4c5"). This is a technical identifier, not a human name. It is
compact but may not be recognizable if users have multiple salespeople.
[Confirmed by code: `operations/page.tsx`, lines 416–427.]
**Needs confirmation:** Whether display names (from m052 user_roles display columns)
are available or should be used here instead of the role·uuid pattern.

### 5.2 Compact events strip

**Confirmed.** The `CompactOperationalEvents` component sits at the bottom of
the page as an awareness layer. The code comment says it was moved from the top
to the bottom to put the table first, saving ~40% viewport on initial load.
[Confirmed by code: `operations/page.tsx`, lines 791–801.]

**Suspected.** With the events at the bottom, users who open `/operations` for
the event log context (e.g. after clicking a notification that used to route to
`/operations`) may not immediately see the events. The code comment at lines
97–99 confirms the old `?event=` drawer is gone from this page; clicking an
event row now navigates to the entity page. This is a behavior change from the
previous version.
**Needs confirmation:** Whether users who bookmarked event-based entry points
have been redirected appropriately.

---

## 6. Document Detail (`/documents/[id]`)

### 6.1 Header zone

**Confirmed.** Header layout: eyebrow label (document type) → affair name (if
set, 18px semi-bold) → doc number (mono, 14px if affair present, else doc-title
class) → version badge (if >1) → StatusBadge → reminder badge.
[Confirmed by code: `app/(app)/documents/[id]/page.tsx`, lines 543–581.]

**Confirmed.** Draft documents get a special amber panel ("Draft · work in
progress") instead of the lifecycle stepper. The panel has two CTAs: "Continue
editing" (solux-colored CTA) and "Mark as sent →" (amber bordered button).
[Confirmed by code: `documents/[id]/page.tsx`, lines 778–818.]

**Confirmed.** Non-draft documents show the 7-stage `WorkflowStepper`
(Quotation → Won → Task list → Validated → Production → Shipped → Delivered).
This is the detailed variant — 7 stages vs the 6-phase strip in OrdersInFlight.
[Confirmed by code: `documents/[id]/page.tsx`, lines 819–841; `WorkflowStepper.tsx`.]

**Suspected UX concern.** The 7-stage WorkflowStepper and the 6-phase
OrdersInFlight strip use different phase vocabulary. WorkflowStepper has:
Quotation, Won, Task list, Validated, Production, Shipped, Delivered.
OrdersInFlight has: Quote, Task list, Payment, Production, Shipping, Delivered.
The "Won" and "Validated" stages in WorkflowStepper map to transitions (not
phases) while "Payment" in OrdersInFlight is a phase. These are two different
representations of the same lifecycle at different granularities. This is a
design decision that works well operationally, but could confuse users who see
"Payment" on the dashboard and look for it on the document detail.
**Needs confirmation:** Whether a brief inline note ("Lifecycle stages — more
detail than the dashboard strip") would help, or whether the dual representation
is already clear to the target users.

### 6.2 Draft visibility

**Confirmed.** Draft quotations show a bold amber `border-2 border-amber-300`
panel that is visually distinct from all other states. The draft panel is the
first section below the header. It cannot be missed.
[Confirmed by code: `documents/[id]/page.tsx`, lines 784–817.]

**Confirmed.** The draft panel copy includes the full lifecycle path:
"Quotation → Won → Task list → Production → Shipped → Delivered". This helps
orient a user about where they are.
[Confirmed by code: `documents/[id]/page.tsx`, lines 793–798.]

**Suspected.** When a document is in `draft` state, the "Other status" row at
the bottom of the header zone (`DOC_STATUSES.filter(...)`) still exposes quick-
status buttons for all non-current statuses (including "Won", "Lost",
"Cancelled", "Sent", "Negotiating" for a draft). A draft can be won in one
click from the header. While technically a valid capability, this is a
non-obvious path.
**Needs confirmation:** Whether the draft panel's "Mark as sent" CTA and the
"Other status" quick-buttons serve different audiences or whether one should
be removed or de-emphasized.

### 6.3 Product lines table

**Confirmed.** The product lines table has 7 columns for non-admins (Product,
Configuration, Tier, Qty, Original, Discount, Unit, Total) and 8 for admins
(+ Margin). Column headers use 10px uppercase tracking-wider style.
[Confirmed by code: `documents/[id]/page.tsx`, lines 961–991.]

**Confirmed.** The Product cell renders the internal product name (semi-bold),
then optionally the client product name in italic (11px), then the category (12px
neutral-500), then a list of `config_values` entries filtered by visibility and
sentinel rules (11px neutral-600).
[Confirmed by code: `documents/[id]/page.tsx`, lines 1003–1051.]

**Confirmed.** The Configuration cell (`selected_options`) renders `key: value`
pairs at 12px with the key in neutral-500. The product cell already contains
`config_values` — these are two different data sources that both appear in
adjacent cells. The duplication risk depends on whether `selected_options` and
`config_values` overlap semantically.
[Confirmed by code: `documents/[id]/page.tsx`, lines 1053–1058.]
**Needs confirmation:** Whether `selected_options` and `config_values` carry
overlapping or complementary data in practice. If they overlap, combining them
into one cell or renaming "Configuration" would reduce cognitive load.

**Suspected.** A quotation with many product lines will create a very long table.
There is no pagination, virtualization, or expand/collapse on the table. For
orders with 10+ product lines (plausible for a large LED project), this table
will scroll extensively.
**Needs confirmation:** Typical product line count per quotation. If routinely
> 8 lines, consider a collapsible "Show all" approach.

### 6.4 Production status card (read-only, sales view)

**Confirmed.** When a production order exists, a read-only card appears in the
header zone. It links to the production order page and shows: production order
number (eyebrow), `ProductionOrderStatusBadge`, `DelayBadge`, and inline dates
for Production due / ETD / ETA.
[Confirmed by code: `documents/[id]/page.tsx`, lines 622–687.]

**Confirmed: delay + ETA pairing rule honored.** The inline production card
shows both the delay badge and the `current_production_deadline` date in the
same block. The user sees "+Nd" and the actual completion date together.
[Confirmed by code: `documents/[id]/page.tsx`, lines 638–680.]

**Suspected.** The production order card is positioned inside the left column
of the header zone, directly below the "Sales owner" field. On a document with
all fields present (affair name, PO reference, reminders badge, DocQuickActions,
sales owner selector, production card, "Other status" row), this header zone
can reach 300–400px of vertical height before the main content sections begin.
**Needs confirmation:** Measure the header zone height in a production-stage
document to verify whether it creates excessive scrolling before the product
table.

---

## 7. Production Order Detail (`/production/orders/[id]`)

### 7.1 Header zone

**Confirmed.** Header: breadcrumb eyebrow → status badge → deposit override
badge → delay badge → alert badge. Then affair name (doc-title) or PO number
(mono), then a compact row: Client · Sales · Quotation (link) · Task list (link).
[Confirmed by code: `app/(app)/production/orders/[id]/page.tsx`, lines 474–553.]

**Confirmed.** On a cancellation, a `CancellationBanner` with `tone="critical"`
appears. On delivered, `tone="muted"` with completion date.
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 562–580.]

**Confirmed.** The `RoleContextBanner` appears immediately below the header —
green for technical (can edit), amber for View-As simulation, neutral (read-only)
for sales. This is a good diagnostic strip.
[Confirmed by code: `production/orders/[id]/page.tsx`, line 557.]

### 7.2 Lifecycle stepper

**Confirmed.** A `WorkflowStepper` renders the same 7-stage lifecycle. Caption
"From quotation to delivery — click any past stage to jump back."
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 583–593.]

**Suspected.** The `WorkflowStepper` is present on both the document detail page
and the production order detail page, potentially showing the same lifecycle
state twice when navigating between the two pages. The stages themselves are
correctly differentiated by `buildLifecycleStages` for each entity context.
**Needs confirmation:** This is expected behavior given the pages serve
different primary users (sales vs. production team).

### 7.3 OrderOperationsStrip (top 5-card strip)

**Confirmed.** The `OrderOperationsStrip` shows 5 cards on one row (2 cols on
mobile, 5 on lg+): Initial ETA, Current ETA, Delay (factory/external split),
Payment, Shipping.
[Confirmed by code: `components/production/OrderOperationsStrip.tsx`.]

**Confirmed: delay labels — factory vs external split.** The Delay card
explicitly separates factory-attributable days (rose, "counts toward factory
KPI") from external-attributable days (amber, "does not affect factory KPI").
This is a first-class feature, correctly distinguished by color and label.
[Confirmed by code: `OrderOperationsStrip.tsx`, lines 162–222.]

**Confirmed: ETA pairing rule honored.** Initial ETA and Current ETA appear as
adjacent cards. The Current ETA card shows a sub-label ("In Nd" / "Due today" /
"Nd past"). Any delay seen on the Delay card is paired with both ETA cards
immediately to its left.
[Confirmed by code: `OrderOperationsStrip.tsx`, lines 91–114.]

**Suspected.** On a delivered order, the Current ETA card still shows the
`current_production_deadline` date (or "—" if not set), while actual completion
is shown elsewhere (in the delay timeline and header). A delivered order could
instead show "Actual completion: [date]" in the Current ETA card position. This
is a minor semantic mismatch.
**Needs confirmation:** What `current_production_deadline` contains on delivered
orders — whether it represents delivery date or the original production deadline.

### 7.4 Production Baseline section

**Confirmed.** The Production Baseline section shows 3 cells in a grid (Row 1):
Validation date, Working days, Production start date. Then a prominent "Initial
project completion" cell (Row 2) that is either pending (amber) or frozen
(emerald) depending on whether production is active.
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 690–862.]

**Confirmed.** The "Locked" badge shows the lock date, and an "Unlock baseline"
button (disabled, placeholder) is shown for admin users. The tooltip says "Admin
unlock — coming in the next phase."
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 700–748.]

**Confirmed.** When the baseline is not yet locked and the user is technical, a
working days edit form renders. The form has a clear note: "Editable until
deposit received or override fires."
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 863–912.]

**Suspected UX concern.** The "Unlock baseline" button is permanently disabled
with a `cursor-not-allowed` style and no action. For a user who legitimately
needs to unlock (e.g. a data-entry error), this affordance creates false
expectations. A better approach would be to hide the button entirely until the
feature is implemented, or to show a "Contact admin" message instead.
**Needs confirmation:** Timeline for implementing baseline unlock functionality.

### 7.5 Delay timeline section

**Confirmed.** The `DelayTimelineCard` shows the ETA cluster, delay summary
(factory vs external), an add-delay form (in-production only), timeline of
events, and a "Mark complete" CTA (in-production + `canEditStatus`).
[Confirmed by code: `components/production/DelayTimelineCard.tsx`, lines 1–61.]

**Confirmed.** Phase-aware copy: awaiting_start, in_production, completed,
closed each get distinct subtitle text explaining what the section means in that
phase.
[Confirmed by code: `DelayTimelineCard.tsx`, lines 86–95.]

**Suspected.** The `DelayTimelineCard` is positioned between the status workflow
section and the payments section. This placement is logical for the production
team (they update deadlines as part of production management). For a sales user
in read-only mode, the delay timeline card may feel overly detailed and
displace the payments and shipment sections which they care more about.
**Needs confirmation:** Whether sales users need to scroll past the full delay
timeline (with potentially many events) before reaching payment status.

### 7.6 Payments section

**Confirmed.** The payments section shows Deposit and Balance blocks side by
side (2-column grid). Each block has "Expected" and "Received" cells, a
"Received on" date, and a coverage pill (0% / partial / 100% received).
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 1053–1129.]

**Confirmed.** The production-gate status banner appears before the payment
blocks: green "Deposit terms met — production can start", amber "Production is
gated on the deposit", or amber "Production launched WITHOUT deposit" depending
on state.
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 990–1051.]

**Confirmed.** A balance reminder offset selector (No reminder / 7 / 10 / 15 /
21 / 30 days before ETA) is shown to technical roles. This is a proactive
operational configuration tool.
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 1197–1244.]

**Suspected.** The edit form for payments (deposit amount, date, balance amount,
date, payment notes) appears below the read-only display blocks for technical
users. This creates a long section where the same data appears twice: once as
read-only display and once as an edit form with `defaultValue`. A user who wants
to change the deposit amount must scroll past the display block to reach the
form.
**Needs confirmation:** Whether the dual display (read-only + edit form) creates
usability friction in practice, or whether the read-only display is useful for
quick reference.

### 7.7 Shipment section

**Confirmed.** The Shipment section shows a "Booked / Not booked" status pill
at the header. For technical roles: edit form with 10+ fields (ETD, ETA, BL
number, forwarder, HS code, vessel, voyage, packages, gross weight, net weight,
CBM, logistics notes). For non-technical: read-only grid of the same fields.
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 1246–1397.]

**Suspected.** The shipment form has many fields (10+ inputs) in a 3-column
grid. While comprehensive, this may be overwhelming compared to how the BL data
is used in practice. The "Logistics notes" textarea at the bottom is a freeform
fallback for anything not in the structured fields.
**Needs confirmation:** Which BL fields are routinely populated vs. left blank.
Consider a "Show less / Show all" toggle if most fields are empty 80%+ of the time.

### 7.8 Two-column cockpit layout

**Confirmed.** On `lg+` screens (≥1024px), the main content area switches to a
2-column layout: left column (minmax(0, 1fr)) for all sections, right column
(300px fixed) for the `LiveStatusSidebar`. On narrow screens, the sidebar is
hidden (`hidden lg:block`) and the top `OrderOperationsStrip` serves as the
KPI fallback.
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 608–1467.]

**Confirmed.** The `LiveStatusSidebar` is implemented as a separate component
(`components/production/LiveStatusSidebar.tsx`). It receives the same `liveStatus`
object as the `OrderOperationsStrip`, so the two never drift. Comment confirms:
"Single source of truth — both surfaces consume `liveStatus`."
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 393–425.]

---

## 8. Status Tags and Tone System

**Confirmed.** The app uses a consistent semantic tone palette across components:

| Tone | Color | Usage |
|------|-------|-------|
| danger | rose | Cancelled, factory delay, balance overdue, overdue production |
| warn | amber | Awaiting deposit, payment pending, ending soon, external delay, draft state |
| info | sky | In transit, booked, ready to ship, validated |
| success | emerald | Paid in full, delivered, on schedule, production complete |
| neutral | neutral | Default/unknown state, draft, archived |
| violet | violet | Shipment booked stage, admin badge |

[Confirmed by code: `lib/order-pills.ts` line 357–363; `lib/lifecycle.ts` line 52–56;
`StatusBadge.tsx` lines 9–34; `ActionCenter.tsx` CHIP_TONE lines 41–46.]

**Confirmed.** The `StatusBadge` for documents uses distinct styles per state:
- `draft`: white border, neutral text (not highlighted — correctly calm)
- `sent`: sky
- `negotiating`: amber
- `won`: solid emerald-500 background with white text (most prominent — correct)
- `lost`: red
- `cancelled`: neutral-50 with neutral-400 text (muted — correct)

[Confirmed by code: `StatusBadge.tsx`, lines 9–34.]

**Confirmed.** The `won` status uses a filled solid badge (not outline), which
gives it significantly more visual weight than the other statuses. This is
appropriate — "Won" is the success event that triggers the production workflow.

**Suspected UX concern.** The role badge in the nav uses `bg-solux-accent` for
sales, which is a yellowish/tan tone. If the solux brand accent conflicts with
the "warn" amber tone, a sales user's role badge may be semantically confusing
(reading as "warning" rather than "identity"). This depends on the exact hue
of `bg-solux-accent`.
**Needs confirmation:** Visual inspection of the nav role badge against the
amber tones used for warning states.

---

## 9. Product Block Readability

**Confirmed.** On the document detail page, each product line in the table has
a Product cell that combines:
- Product internal name (14px semi-bold)
- Client product name in italic (11px, only when present)
- Product category (12px neutral-500)
- Config values list (11px neutral-600, each as "key: value")

And a separate Configuration cell:
- selected_options pairs (12px, key in neutral-500)

[Confirmed by code: `documents/[id]/page.tsx`, lines 1002–1061.]

**Suspected.** The `config_values` (in Product cell) and `selected_options` (in
Configuration cell) are two separate data sources. In a fully-configured product
block, a user might see 4–6 entries in the Product cell and another 4–6 in the
Configuration cell, creating a very tall row. On a 10-product quotation, this
creates a table that is more like a list of blocks than a scannable grid.
**Needs confirmation:** Whether these two columns can be merged, or whether
`selected_options` is being phased out in favor of `config_values`.

**Confirmed.** Config values that are empty-string, null, or "false" are
filtered out. Values of "true" are rendered as "Yes".
[Confirmed by code: `documents/[id]/page.tsx`, lines 1021–1036.]

**Confirmed.** Custom option values (sentinel `"__custom__"`) are resolved to
their corresponding `cfg[customValueKey(k)]` value before display. The raw
sentinel string never reaches the user.
[Confirmed by code: `documents/[id]/page.tsx`, lines 1029–1032; `lib/types.ts`
`CUSTOM_OPTION_SENTINEL`, `customValueKey`.]

---

## 10. Configuration Blocks (factory vs. sales)

**Confirmed.** The factory overrides and extras added in m071 are separate data
from the sales `config_values`. On the document detail page, only sales
configuration is shown. Factory-specific data lives in the production task list
and is never displayed on the quotation view.
[Confirmed by code: `production/orders/[id]/page.tsx` `OrderConfigSummary` section,
lines 263–330; `documents/[id]/page.tsx` has no factory data.]

**Confirmed.** The production order detail includes an `OrderConfigSummary`
component that renders "what was ordered" from the task list lines, filtered to
`visible_in_task_list AND NOT internal_only AND field_scope != 'technical'`.
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 278–330.]

**Confirmed.** The `OrderConfigSummary` only shows sales-visible config fields;
technical values and factory overrides are explicitly excluded.
[Confirmed by code: `production/orders/[id]/page.tsx`, lines 301–309, comment:
"We exclude technical_values and factory_overrides entirely; those are operations
/ factory concerns, not Sales tracking."]

**Suspected.** The "Value + Context" mini-KPI section at the bottom of the main
content column (`production/orders/[id]/page.tsx`, lines 1400–1427) shows three
KPI tiles: Quotation value, Quotation status (as uppercase string), and Task list
status (as uppercase underscore string). The status values are raw enums
rendered with `toUpperCase()` and `replace(/_/g, " ")` — e.g. "IN_PRODUCTION"
→ "IN PRODUCTION". These should use the `PRODUCTION_ORDER_STATUS_LABEL` map
that exists in `lib/types.ts` for proper human-readable labels.
**Needs confirmation:** Whether "IN PRODUCTION" vs "In Production" is a
confirmed stylistic choice or an oversight.

---

## 11. Notification and Conversation Behavior

**Confirmed.** Clicking a notification routes the user to the entity page with
`?event=<id>` in the URL. The entity page's `EventDiscussionPanel` reads this
parameter and overlays the conversation drawer.
[Confirmed by code: `documents/[id]/page.tsx`, lines 83, 1299–1304;
`production/orders/[id]/page.tsx`, lines 97, 1474–1478.]

**Confirmed.** The drawer performs an entity-id safety check (`expectedEntityId`)
to ensure the event belongs to the entity being viewed.
[Confirmed by code: `production/orders/[id]/page.tsx`, line 1476.]

**Confirmed.** The notification bell (`components/NotificationBell.tsx`) is
driven by `getNotificationSummary` which computes `totalUnreadEvents` and
`items` (recent unread events).
[Confirmed by code: `Nav.tsx`, lines 68, 125–128.]

**Confirmed.** A soft-fail pattern is used: the notifications summary defaults
to `{0, []}` on missing migrations or DB errors. The nav never crashes due to
notification failure.
[Confirmed by code: `Nav.tsx`, lines 67–68 comment.]

**Confirmed: standing rule honored.** Notifications are role- and visibility-
scoped (RLS). Sales only see their own deals' activity.
[Confirmed by code: RULES_CANDIDATE.md rule 7.1; `lib/notifications.ts` design.]

---

## 12. View-As / Role Simulation UI

**Confirmed.** When simulating a role, the simulation banner appears above the
nav in amber (bright enough to be impossible to miss during development).
[Confirmed by code: `Nav.tsx`, lines 73–85.]

**Confirmed.** The RoleContextBanner component appears on both `/operations`
and `/production/orders/[id]` pages. It shows green for technical users
(reassurance that editing is available), amber when simulating (with a "Reset
View-As" button), or neutral (read-only notice for sales).
[Confirmed by code: `operations/page.tsx` line 527; `production/orders/[id]/page.tsx` line 557.]

**Confirmed: standing rule needs user decision.** RULES_CANDIDATE.md rule 1.7
[CONFIRM]: "Show a visible note that View-As does not reduce real privileges on
actions." The simulation banner in Nav.tsx currently says "Server actions still
use your real role." This text may be sufficient for developers but unclear to
a non-technical admin who uses View-As to preview what a sales user sees.
**Needs confirmation:** Whether the current banner copy is adequate or should be
reworded for clarity.

---

## 13. Summary Observations

### 13.1 Standing rules status

| Rule | Status |
|------|--------|
| Keep 6-phase flight strip | Confirmed preserved (OrdersInFlight.tsx) |
| Never simplify the strip away | Confirmed preserved |
| Pair +Nd with ETA at all times | Confirmed (etaChipLabel, OrderOperationsStrip) |
| Compact by width, not height (m076) | Confirmed (ActionCenter, OrdersInFlight) |
| Empty states calm/reassuring | Confirmed (ActionCenter, OrdersInFlight both) |
| Factory delay ≠ external delay labels | Confirmed (OrderOperationsStrip DelayCard) |

### 13.2 Items that need owner decisions (CONFIRM items)

1. **Two-dashboard coexistence**: Should "V2 ✦" remain in nav permanently, be
   promoted to default, or be retired? Needs a clear timeline.

2. **`selected_options` vs `config_values` duplication**: On the document detail
   product table, these two data sources occupy adjacent cells. Confirm whether
   this is intended or a migration artifact.

3. **Raw enum rendering in KPI tiles**: "IN PRODUCTION" vs "In Production" on
   production order detail. Confirm intentional or use `PRODUCTION_ORDER_STATUS_LABEL`.

4. **Notes pane emoji** (`💬`): Replace with plain text if emoji is not desired
   per house style.

5. **Sales column in Operations table**: `role·uuid-slice` format vs. display
   names (m052). Confirm which is appropriate for daily operational use.

6. **"Unlock baseline" disabled button**: Hide entirely or replace with a
   contact-admin message until the feature is implemented.

7. **Validation copy disambiguation** (RULES_CANDIDATE.md rule 1.6): The term
   "validation" is used for both advisory quote review (m068) and task-list
   factory approval. Both appear on different pages but share vocabulary. Confirm
   whether adding scope qualifiers ("Quotation review" vs. "Factory validation")
   is desired.

---

## 14. Elements That Should Be Fixed WITHOUT a Full Redesign

The following are concrete, low-risk improvements that do not require structural
changes, redesign, or new features:

### 14.1 Replace raw enum labels in KPI tiles
**Location:** `app/(app)/production/orders/[id]/page.tsx`, lines 1410–1427.
The "Quotation status" and "Task list status" tiles use `.toUpperCase()` +
`replace(/_/g, " ")` on raw enum strings. Replace with the already-existing
`DOC_STATUS_LABEL` and `PRODUCTION_ORDER_STATUS_LABEL` maps from `lib/types.ts`.
This is a one-line change per tile and removes all-caps raw enums from the UI.

### 14.2 Sales column display names in Operations table
**Location:** `app/(app)/operations/page.tsx`, `salesUserLabel` map (lines 403–427).
The `role·uuid-slice` pattern (e.g. "sales·a3b4c5") is not human-recognizable.
If user display names are available (from m052 user_roles or a display_name
column), use them. If not available, at minimum use the full 8-character UUID
slice instead of 6 to reduce collision probability.

### 14.3 Remove or replace the disabled "Unlock baseline" button
**Location:** `app/(app)/production/orders/[id]/page.tsx`, lines 738–748.
The `disabled` + `cursor-not-allowed` + `opacity-60` button creates a false
affordance. Replace with a `title="Contact admin to unlock"` span or remove
entirely until the feature is built. This removes an incomplete UI element
without any functional regression.

### 14.4 Add `aria-label` to icon-only controls
**Suspected gap.** The notes delete button in ActionCenter uses `aria-label="Delete
note"` (line 303) — correct. Verify other icon-only controls (ContextMenu
dots, conversation launcher, etc.) have equivalent labels.
[Confirmed correct in `ActionCenter.tsx` line 303; status of others:
**Needs confirmation**.]

### 14.5 Clarify the simulation banner wording for non-technical admins
**Location:** `components/Nav.tsx`, line 79.
Current: "Dev simulation active — UI is rendering as [role]. Server actions still
use your real role."
Suggested: "UI preview mode — showing as [role]. All saves and actions still run
under your real role ([realRole])."
This removes the "Dev" qualifier (implies developer-only tool) and makes the
real-role reference more prominent for a manager using View-As to preview
sales' view.

### 14.6 Emoji in notes count
**Location:** `components/action-center/ActionCenter.tsx`, line 249.
Change `💬 ${item.noteCount}` to `${item.noteCount} note${item.noteCount === 1 ? "" : "s"}`.
This aligns with the app's no-emoji tone convention and is a trivial string change.

### 14.7 Add `whitespace-nowrap` or min-width to "Added Xd ago" in ActionCenter
**Location:** `ActionCenter.tsx`, footer div (lines 214–228).
The `openedAgo` label and `sinceTitle` tooltip use standard text that may wrap
on narrow cards. Add `whitespace-nowrap shrink-0` to the "Added Xd ago" span
to prevent the date from wrapping mid-label.

---

## Appendix — Key Files Inspected

| File | Purpose |
|------|---------|
| `components/dashboard/OrdersInFlight.tsx` | 6-phase flight strip, order rows, ETA chip |
| `components/action-center/ActionCenter.tsx` | Classic Action Center rendering |
| `components/action-center/ActionCenterV2.tsx` | V2 Action Center (behavior-split) |
| `app/(app)/dashboard-v2/page.tsx` | Dashboard V2 layout |
| `app/(app)/operations/page.tsx` | Operations/production workspace |
| `app/(app)/documents/[id]/page.tsx` | Document detail page |
| `app/(app)/production/orders/[id]/page.tsx` | Production order cockpit |
| `components/production/OrderOperationsStrip.tsx` | 5-card KPI strip (PO detail) |
| `components/production/DelayTimelineCard.tsx` | Delay timeline visualization |
| `components/WorkflowStepper.tsx` | 7-stage lifecycle stepper |
| `components/StatusBadge.tsx` | Document status badge |
| `lib/lifecycle.ts` | 6-phase ORDER_FLIGHT_PHASES, computeOrderFlightStage |
| `lib/action-center.ts` | Action types registry, signals, materialize |
| `lib/order-pills.ts` | Operational pill system for orders |
| `components/Nav.tsx` | Navigation bar, simulation banner, role badge |
| `docs/current-implementation/RULES_CANDIDATE.md` | Standing rules source |
