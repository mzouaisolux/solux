# Notifications & Messages — Editable Audit Doc

> **Scope.** This document covers every "notification-like" surface in SOLUX:
> the bell, the event/operations feed, the Action Center, the conversation
> drawer (entity messages), and render-time alerts + reminders.
>
> **Primary source:** `docs/current-implementation/NOTIFICATION_SYSTEM.md`.
> **Verified against:** `lib/notifications.ts`, `lib/events.ts`,
> `lib/events-shared.ts`, `lib/action-center.ts`, `lib/entity-messages.ts`,
> `lib/entity-messages-shared.ts`, `lib/conversation-context.ts`,
> `lib/reminders.ts`, `lib/operations-alerts.ts`,
> `components/dashboard/EventDiscussionPanel.tsx`,
> `components/dashboard/EventDiscussionDrawerClient.tsx`,
> `components/chat/ConversationDrawer.tsx`,
> `components/chat/ConversationLauncher.tsx`,
> `components/action-center/ActionCenter.tsx`.
>
> **Conventions:**
> - `[Confirmed by code]` — fact directly verifiable in the cited file/line.
> - `[Assumed from code]` — inference from code structure; plausible but not
>   directly witnessed in a running app.
> - `Needs confirmation` — requires owner / runtime verification.

---

## Owner Decisions (confirmed 2026-05-30)

> Source of truth: `docs/audit-editable/OWNER_DECISIONS_LOG.md` sections C and D.
> All items below describe **TARGET / INTENDED behavior; not yet implemented in code**.

### Decision C — Canonical discussion surface

**Target behavior:**
- `entity_messages` is the **canonical discussion surface** for all business entities (quotations, clients, task lists, production orders).
- `event_comments` must be used **only** to comment on a specific operational event (status change, delay, validation, payment, BL/shipping, production issue).
- From the user's perspective there must be **one main conversation area** per entity. Important operational events may appear inside or alongside that conversation as contextual system entries.
- If a notification is linked to an event comment, clicking it must open the related **entity page AND highlight/open the relevant event discussion in context**.

**Gap vs current behavior:**
- Currently `event_comments` (`EventDiscussionPanel`) and `entity_messages` (`ConversationDrawer`) coexist as two fully parallel, unlinked systems with no cross-reference in the UI (see section 7.3).
- The current bell click already opens the entity page with the event discussion drawer via `?event=<id>` (see section 2.4) — this aligns with the click-behavior portion of decision C; however the broader single-surface UX goal is not yet implemented.

### Decision D — Bell on event creation (not comments only)

**Target behavior:**
- **Critical event** created: must raise a bell notification immediately, even with zero comments.
- **High event** created: must raise a bell notification immediately, even with zero comments.
- **Medium event** created: raises a bell notification only if it requires action from the user's role.
- **Low / informational event:** does not raise a bell notification by default.
- **Any unread comment** on a visible event or entity discussion must raise a bell notification (retains current behavior).

**Gap vs current behavior:**
- `lib/notifications.ts` `getUnreadCommentCountsForUser` drives the bell exclusively from unread comments on events. A new `critical` or `high` event with no comments does **not** trigger the bell today (see section 7.1 and the Design note in section 2.1).
- The new event-creation triggers (Critical, High, and role-relevant Medium) require new logic in `lib/notifications.ts` or a new notification source — this has not been implemented.

---

## 1. Five notification-like surfaces (overview)

SOLUX has **five distinct surfaces** that surface operational signals. They are
**not integrated with each other** — they are parallel systems that sometimes
overlap visually.

| # | Surface | Module(s) | Persisted? | Primary purpose |
|---|---|---|---|---|
| 1 | **Notification bell** (top nav) | `lib/notifications.ts` | Derived (no own table) | Unread event-comments + "task lists awaiting review" aggregate |
| 2 | **Event log / Operations feed** | `lib/events.ts`, `lib/events-shared.ts` | Yes (`events`, `event_comments`, `event_reads`) | Immutable operational timeline with threaded discussion and status workflow |
| 3 | **Action Center** | `lib/action-center.ts` | Derived (+ `action_acks`, `action_notes` for state) | Live, prioritized to-do list derived from current DB state |
| 4 | **Conversation drawer** (entity messages) | `lib/entity-messages.ts`, `lib/conversation-context.ts` | Yes (`entity_messages`, `entity_message_reads`) | Contextual freeform discussion attached to any entity |
| 5 | **Reminders + render-time alerts** | `lib/reminders.ts`, `lib/operations-alerts.ts` | Reminders yes (`quotation_reminders`, m043); alerts no | Sales follow-up calendar (reminders); row-level status badges (alerts) |

These systems share no data. A comment in the event thread (surface 2) is
invisible in the entity conversation drawer (surface 4), and vice versa.

---

## 2. Surface 1 — Notification Bell (`lib/notifications.ts`)

### 2.1 What triggers bell items

**A. Unread event comments** [Confirmed by code — `lib/notifications.ts` lines
110–115, `getUnreadCommentCountsForUser`]:

- An event the user can see (RLS-scoped) has at least one comment from
  **another user** with `created_at > last_read_at` in `event_reads` (m045).
- Self-comments are excluded (`neq("user_id", userId)` at line 127).
- The bell counter reflects the count of such **events** (not individual
  comments). Items are sorted by `latestCommentAt` descending.

**B. "N task lists awaiting your review" aggregate** [Confirmed by code —
`lib/notifications.ts` `buildReviewNotification`, lines 287–318]:

- Queries `production_task_lists` where `status = 'under_validation'`.
- Produces a **single synthetic bell item** with count `N`, severity `high`,
  and `href: "/task-lists"` (the list page — not a specific task list).
- Only shown to **technical roles** (`isTechnicalRole(role)` check at line 80).
- Self-clears when all pending task lists are validated; no read-tracking.

> **Design note [Confirmed by code]:** A brand-new high/critical event with
> **no comments** does NOT raise the bell count. The bell is driven by unread
> *comments*, not by event creation. New events surface in the Operations
> feed (surface 2) and Action Center (surface 3) instead.

### 2.2 Who receives bell items

- **Unread comment items**: whoever can see the underlying event (RLS on
  `events` + `event_comments` from m046). Sales users see only their own
  deals; technical roles see everything. [Confirmed by code — comment in
  `lib/notifications.ts` lines 7–12]
- **Review aggregate**: `isTechnicalRole(role)` only — `task_list_manager`,
  `operations`, `admin`, `super_admin`. [Confirmed by code — line 80]
- There is no per-user targeting; visibility is purely role + RLS scoping.
  [Confirmed by code — no user_id filter in the registry]

### 2.3 Where bell items appear

[Confirmed by code — `lib/notifications.ts` lines 60–61]:

- Top nav bell dropdown.
- Shows up to **`MAX_PANEL_ITEMS = 10`** items; count caps at
  **`HARD_CAP_COUNT = 20`** (displayed as "20+").
- Each item shows: affair/project name (falls back to doc/PO/TL number, then
  `entity_type·uuid8`), client name, event-type label, event message, unread
  count, latest comment preview (truncated to 80 chars), and timestamp.

### 2.4 Click behavior — entity page + discussion drawer

[Confirmed by code — `lib/notifications.ts` lines 260–265,
`lib/events-shared.ts` `eventEntityHref`, lines 253–269]:

- **`href` construction**: `eventEntityHref(event) + "?event=<eventId>"`.
- `eventEntityHref` maps `entity_type` to its detail URL:
  - `document` → `/documents/:id`
  - `task_list` → `/task-lists/:id`
  - `production_order` → `/production/orders/:id`
  - `client` → `/clients/:id`
  - `system` → `null` (falls back to `/operations?event=<id>`)
- The destination page mounts an `EventDiscussionPanel`
  (`components/dashboard/EventDiscussionPanel.tsx`) that reads `?event=` and
  renders an `EventDiscussionDrawerClient` overlay.
- Result: the user lands on the full entity detail page **and** the event
  discussion thread is already open in a drawer on the right — operational
  context and conversation together.
- Closing the drawer calls `router.replace(pathname)` (removes `?event=`
  param), which causes the server component to re-render without the panel.
  [Confirmed by code — `EventDiscussionDrawerClient.tsx` lines 38–43]
- Safety check: the panel validates that `event.entity_id === expectedEntityId`
  (the entity in the URL) — prevents cross-entity event injection via URL
  crafting. [Confirmed by code — `EventDiscussionPanel.tsx` lines 58–61]

**Exception — the review aggregate item** [Confirmed by code — line 313]:
- `href: "/task-lists"` — navigates to the task list **list** page, not to
  any specific task list or its discussion panel. Does NOT carry `?event=`.
  This is the only bell item that is not a deep link to a specific entity.

---

## 3. Surface 2 — Event Log / Operations Feed (`lib/events.ts`)

### 3.1 What events are emitted

[Confirmed by code — `lib/events-shared.ts` `EventType`, lines 93–138]:

The full event type catalog:

| Domain | Event types |
|---|---|
| Production order | `po.created`, `po.status_changed`, `po.deadline_changed`, `po.delay_event_edited`, `po.delay_event_deleted`, `po.timeline_set`, `po.deposit_received`, `po.balance_received`, `po.deposit_override`, `po.shipment_updated`, `po.production_completed`, `po.cancelled` |
| Task list | `tl.submitted_for_validation`, `tl.validated`, `tl.production_ready`, `tl.needs_revision`, `tl.reopened`, `tl.cancelled`, `tl.deleted`, `tl.status_overridden`, `tl.header_changed` |
| Document | `doc.created`, `doc.updated`, `doc.status_changed`, `doc.won`, `doc.lost`, `doc.cancelled`, `doc.deleted`, `doc.validation_requested`, `doc.validation_approved`, `doc.validation_rejected` |
| Client | `client.created`, `client.updated`, `client.deleted` |
| Admin/system | `admin.permissions_changed`, `admin.user_role_changed`, `system.dev_reset` |
| Generic | `note.added` |

Default severity per type is declared in `lib/events.ts` `DEFAULT_SEVERITY`
(lines 53–96). The catalog is code-side only; the DB does not enforce the
enum — adding a new event type requires no migration.

**Which server actions actually call `emitEvent`**: the exact list of call
sites across the 20 `actions.ts` files was not enumerated in this audit pass.
**Needs confirmation** that every meaningful lifecycle transition (status
change, deadline change, deposit receipt, shipment update) emits the
corresponding event.

### 3.2 Event immutability

[Confirmed by code — `lib/events.ts` comment line 22; m022]:

`events` is an INSERT-only table. No UPDATE or DELETE is possible (RLS). The
event log is a permanent audit trail.

### 3.3 Severity and status ladders

[Confirmed by code — `lib/events-shared.ts`]:

- **Severity**: `low` | `medium` | `high` | `critical`
- **Status** (m039 + m044): `open` | `acknowledged` | `working` | `waiting` |
  `escalated` | `resolved`
- **`waiting_for`** (m044): `client` | `sales` | `operations` | `supplier` |
  `bank` | `management` | `other` — only meaningful when `status = 'waiting'`

### 3.4 Operations feed ordering

[Confirmed by code — `lib/events.ts` `listOperationsFeed`, lines 329–360]:

1. Severity (critical first, then high, medium, low)
2. Status rank: escalated > open > acknowledged > working > waiting > resolved
3. `created_at` descending (newer first within same bucket)

Resolved events are included if `resolved_at >= now - recentResolvedHours`
(default 24h). Events older than `daysBack` (default 30 days) are excluded.

### 3.5 Who sees the feed

RLS-scoped (m046): sales see their own deals; technical roles see everything.
No further per-user targeting. [Confirmed by code — comment in `lib/notifications.ts` lines 7–12]

### 3.6 Event comments and read state

[Confirmed by code — `lib/events.ts`]:

- Comments: `event_comments` table (m044), threaded per event, oldest-first.
- Read state: `event_reads` table (m045), one row per `(user_id, event_id)`.
  `last_read_at` is compared to comment timestamps to compute unread counts.
- The drawer auto-marks an event read on open (via `markEventRead`).
  [Assumed from code — consistent with the `initialLastReadAt` snapshot taken
  before open in `EventDiscussionPanel.tsx` line 68]

---

## 4. Surface 3 — Action Center (`lib/action-center.ts`)

### 4.1 Architecture: SENSORS → REGISTRY → MATERIALIZE

[Confirmed by code — `lib/action-center.ts` header comment]:

The Action Center is **live-derived** — no stored feed. On every request:

1. **`gatherSignals`** reads multiple DB tables (task lists, validation
   requests, production orders, won deals, deadline changes) and emits neutral
   `Signal` objects.
2. **`ACTION_TYPES` registry** declares all policy: behavior, roles, section,
   priority, SLA stages. Policy changes = edit the registry entry.
3. **`materialize`** converts each signal into an `ActionItem` using the
   registry.
4. **`filterByRole`** drops items not relevant to the viewer's role.
5. **`applyAcks`** drops `state='done'` items, stamps acknowledger on
   `state='acknowledged'` items (m069).
6. **`attachNotes`** adds micro-notes from `action_notes` (m075).

### 4.2 Action kinds and their triggers

[Confirmed by code — `lib/action-center.ts` sensors section]:

| Kind | Trigger condition | Section | Resolution |
|---|---|---|---|
| `tl_validate` | Task list `status = 'under_validation'` | `waiting_me` → `urgent` (>3d) | `auto_clear` |
| `tl_clarify` | Task list `status = 'needs_revision'` | `waiting_me` | `auto_clear` |
| `doc_validate` | Document `validation_status = 'pending'` (m068) | `waiting_me` | `auto_clear` |
| `deposit` | PO `status = 'awaiting_deposit'` | `waiting_client` → `urgent` (>7d) | `manual` (Done button) |
| `production_late` | Factory slip > 0 days (factory `delay_type` only, m072) OR past current deadline while active | `urgent` | `manual` |
| `missing_deadline` | Active PO with no `current_production_deadline` | `info_missing` | `auto_clear` |
| `won_no_tasklist` | Won document with no linked task list | `waiting_me` | `auto_clear` |
| `bl_missing_destination` | Deposit-stage PO, seller-managed shipping, BL info not filled | `info_missing` | `auto_clear` |
| `info` | Recent `tl.validated`, `tl.production_ready`, `po.production_completed`, `po.shipment_updated` events | `waiting_client` | `auto_clear` |

**SLA escalation** [Confirmed by code — `ACTION_TYPES` registry, lines
187–256]:

- `tl_validate` >3d → `urgent`; >7d → also visible to `management`.
- `deposit` >7d → `urgent`; >14d → also visible to `management`.
- `production_late` with `ageDays` >14d → also visible to `management`.

Escalation means the item climbs into another role's Action Center view — not
a push notification.

### 4.3 Roles and visibility

[Confirmed by code — `lib/action-center.ts` `viewerScope`, lines 758–763]:

- `admin` / `super_admin` → see all kinds.
- `task_list_manager` → sees `tl_validate`, `tl_clarify`, and any kind whose
  `roles` includes `task_list_manager`.
- `operations` → sees `production_late`, `missing_deadline`, and `info`.
- `sales` (default) → sees `tl_clarify`, `doc_validate` is management-only,
  `deposit`, `won_no_tasklist`, `bl_missing_destination`, `info`.
- Row-level visibility is further scoped by `lib/visibility.ts`
  `canSeeRecord`/`canSeeRow`.
- `management` role in the registry maps to `admin` + `super_admin` (no
  `management` role exists — see `viewerScope`). [Confirmed by code — line
  759: `role === "admin" || role === "super_admin"` returns `all: true`]

### 4.4 Display location

[Confirmed by code — `components/action-center/ActionCenter.tsx`]:

- **Classic view**: `/operations` page, grouped by `section` (Urgent /
  Waiting for me / Waiting on client / Info to complete).
- **V2 view**: `/dashboard-v2`, grouped by `behavior` (Action / Follow-up /
  Info) — `getActionCenterV2` function.
- Empty state shows a reassuring "Nothing needs you right now." message.

### 4.5 Click behavior

[Confirmed by code — `components/action-center/ActionCenter.tsx`]:

- Each card's title and **Open** button are `<Link href={a.href}>` to the
  entity's detail page.
- The `href` is the entity page directly (no `?event=` appended — Action
  Center cards do not open the event discussion drawer).
- **Done button** (only for `resolution='manual'` items): submits a form to
  `markActionDone` server action (`app/(app)/dashboard-v2/actions.ts`).
  Inserts/upserts `action_acks` with `state='done'`; the card is filtered out
  by `applyAcks` on the next load. [Confirmed by code — lines 201–209]
- **Notes pane**: `<details>` native collapsible; notes added/deleted via
  `addActionNote`/`deleteActionNote` server actions.

---

## 5. Surface 4 — Conversation Drawer / Entity Messages

### 5.1 Architecture

[Confirmed by code — `lib/entity-messages.ts`, `lib/conversation-context.ts`,
`components/chat/ConversationDrawer.tsx`]:

- **Globally mounted** in `app/(app)/layout.tsx` via `ConversationLauncher`.
- Context resolved from URL via `resolveConversationContext` (pure, no DB):
  only **detail routes** match — `/documents/:id`, `/task-lists/:id`,
  `/production/orders/:id`, `/clients/:id`.
  List pages, `/new` routes, and all other routes return `null` (drawer shows
  empty state).
- Data fetched via `/api/conversations/[entity_type]/[entity_id]` on drawer
  open.

### 5.2 What `entity_messages` contains

[Confirmed by code — `lib/entity-messages-shared.ts`]:

- One message per row: `entity_type`, `entity_id`, `user_id`, `message`,
  `message_kind`, `created_at`.
- `message_kind` is typed as `comment | request | reply | structured_reply`.
  **Only `comment` is used today** (Phase A1). The other kinds are reserved
  by m049 for future phases. [Confirmed by code — comment in
  `entity-messages-shared.ts` lines 38–45]
- `request_type`, `parent_message_id`, `resolved_at`, `resolved_by` columns
  exist in the schema but are unused. [Confirmed by code — same comment]

### 5.3 Who receives messages / RLS scoping

[Assumed from code — the conversation API route and entity_messages table RLS
were not read in this pass]:

Any user who can see the entity (via existing RLS) can see and post entity
messages. **Needs confirmation**: exact RLS policy on `entity_messages` (m049)
— does it inherit the same sales isolation as the parent entity, or is it
more permissive?

### 5.4 Read state (entity_message_reads)

[Confirmed by code — `lib/entity-messages.ts` `getLastReadForEntity`,
`getUnreadCountForEntity`]:

- `entity_message_reads` table: one row per `(user_id, entity_type, entity_id)`.
- `last_read_at` updated when the drawer opens (`markEntityRead` called
  immediately on fetch in `ConversationDrawer.tsx` line 91).
- Unread count computed in `getUnreadCountForEntity`: messages from OTHER users
  with `created_at > last_read_at`. Self-messages excluded.

### 5.5 Click behavior / how drawer opens

[Confirmed by code — `components/chat/ConversationLauncher.tsx` referenced in
layout; `ConversationDrawer.tsx`]:

- A floating launcher button (likely in the bottom-right or accessible from
  the page) opens the drawer. The drawer slides in from the right.
- Closes on: X button, Escape key, or click on the backdrop.
- On send: optimistic UI append, then server action `postEntityComment`, then
  re-fetch + `router.refresh()` to update host page badges.

### 5.6 This is NOT the same as event comments

[Confirmed by code — structural separation]:

Entity messages (`entity_messages` table, `ConversationDrawer`) and event
comments (`event_comments` table, `EventDiscussionPanel`) are:

- Different tables with no FK relationship.
- Different drawers mounted independently.
- Different trigger paths: event comments open via bell + `?event=`; entity
  messages open via the global launcher.
- A message in one is **invisible in the other**. See section 7.

---

## 6. Surface 5 — Reminders and Render-Time Alerts

### 6.1 Quotation reminders (`lib/reminders.ts`, m043)

[Confirmed by code — `lib/reminders.ts`]:

- **Persisted**: `quotation_reminders` table (m043), one row per reminder.
- Scoped to a `document_id` and `user_id`.
- **Status**: `open` | `done` | `cancelled`. No notification push — purely
  calendar-based display.
- **Predicates** (pure, no DB): `isDue` (open AND `remind_at <= today`),
  `isOverdue` (open AND `remind_at < today`), `isUpcoming` (open AND
  `remind_at > today`).
- **Snooze presets**: +3 days, +1 week, +2 weeks, +1 month. [Confirmed by
  code — `SNOOZE_PRESETS` constant, lines 138–143]
- **Display**: surfaced as a "My reminders" panel on the dashboard (not
  verified which component renders this — `Needs confirmation`). Tone-colored
  date label via `dueToneClass`: rose (overdue), amber (today / ≤3 days),
  neutral (upcoming).
- No email, push, or cross-user notifications. [Confirmed by code — reminder
  data is purely read by the user who set it]

### 6.2 Operations alerts (`lib/operations-alerts.ts`)

[Confirmed by code — `lib/operations-alerts.ts`]:

- **Pure, render-time only, no persistence.** `computeOperationsAlert` returns
  a level based on current order state.
- **Alert levels** (highest-priority first):
  1. `overdue` — `current_production_deadline < today` while active
  2. `balance_due` — production completed but expected balance not received
  3. `delayed` — `current_deadline > initial_deadline` by at least 1 day
  4. `completion_approaching` — deadline within `COMPLETION_APPROACHING_DAYS = 10` days
  5. `awaiting_deposit` — status `awaiting_deposit` and expected deposit > 0
  6. `ok` — none of the above
- Terminal statuses (`delivered`, `cancelled`) always return `ok`.
- These are **row badges** on order lists — not clickable notifications.
  `highPriority: true` on overdue/balance_due/completion_approaching/delayed≥7d
  signals that the row should float to the top of order lists.

---

## 7. Missing / Inconsistent Behavior

This section documents confirmed design gaps, bugs, and inconsistencies. Each
item separates **Current behavior** (what the code does) from **Expected
behavior** (what one would expect or what may be intended).

---

### 7.1 Bell fires on unread COMMENTS, not on event creation

**Current behavior** [Confirmed by code — `lib/notifications.ts` `getUnreadCommentCountsForUser`]:
A new `high`- or `critical`-severity event with zero comments does not appear
in the bell. The bell count increments only when someone comments on a visible
event after the viewer's `last_read_at`.

**Expected behavior**: Many "alert" patterns expect the bell to fire when a
significant event is created (e.g. `po.cancelled`, `po.deadline_changed`), not
only when someone comments on it.

**Impact**: A cancelled PO with no comments will appear in the Operations feed
(surface 2) and possibly the Action Center (surface 3), but the bell stays at
zero. A user relying on the bell alone would miss it.

**Owner direction (confirmed 2026-05-30 — target behavior; not yet implemented):**
See `OWNER_DECISIONS_LOG.md` section D. The comment-only bell is **not** the
intended design. Critical and High events must raise the bell on creation even
with no comments; Medium raises it only if it requires action from the viewer's
role; Low/informational events do not raise the bell. The current
`lib/notifications.ts` implementation (comments-only) is a confirmed gap that
requires code changes to `lib/notifications.ts` — those changes have not yet
been applied.

---

### 7.2 "N task lists awaiting review" bell item is NOT a deep link

**Current behavior** [Confirmed by code — `lib/notifications.ts` line 313]:
`href: "/task-lists"` — navigates to the task list list page. No `?event=`
param.

**Expected behavior**: Like every other bell item, clicking this should
navigate to either (a) the specific task list when count = 1, or (b) a
filtered view. The current behavior forces the reviewer to manually find the
relevant list.

**Impact**: Minor UX inconsistency. The reviewer sees a count badge but cannot
one-click to the item.

**Recommended**: Acceptable as an aggregate. When count = 1, could deep-link
to `/task-lists/<id>`.

---

### 7.3 TWO parallel discussion systems with no cross-linking

**Current behavior** [Confirmed by code — structural separation]:

Two separate discussion mechanisms coexist with no relationship:

| | Event comments | Entity messages |
|---|---|---|
| Table | `event_comments` | `entity_messages` |
| Drawer | `EventDiscussionPanel` + `EventDetailDrawer` | `ConversationDrawer` |
| Trigger | Bell click + `?event=<id>` | Global launcher (URL-based context) |
| Scope | Tied to a specific operational **event** | Tied to the **entity** (doc / TL / PO / client) |
| Read-tracking | `event_reads` (m045) | `entity_message_reads` (m049) |

A user commenting in the entity conversation drawer is **invisible** to a user
reading the event discussion thread, and vice versa.

**Expected behavior**: A single canonical discussion surface, or at minimum
clear UI labeling of which thread is which and why each exists.

**Owner direction (confirmed 2026-05-30 — target behavior; not yet implemented):**
See `OWNER_DECISIONS_LOG.md` section C. `entity_messages` is the **canonical**
discussion surface for general coordination on any entity. `event_comments`
survives but is scoped strictly to event-specific operational comments. The
current UI showing two independent, unlabeled chat surfaces is a confirmed
gap. The target is a single main conversation area per entity; event discussions
appear as contextual entries within or alongside that surface. The UI consolidation
has not yet been implemented — `event_comments` and `entity_messages` still coexist
as fully separate, unlinked surfaces in the current code.

---

### 7.4 `bl_missing_destination` key mismatch — BL card does not self-clear

**Current behavior** [Confirmed by code — `lib/action-center.ts` `blIsFilled`,
lines 326–342]:

`blIsFilled` checks `shipping_details` for keys `forwarder_name` and
`vessel_name`. However, `lib/shipping.ts` `ShippingDetails` writes those same
fields as `forwarder` and `vessel` (without `_name` suffix).

**Consequence**: entering the forwarder or vessel name in the order form does
NOT clear the `bl_missing_destination` Action Center card. The card only
self-clears if:

- `bl_number` is set on `shipping_details`, OR
- `consignee.company_name` is filled in the client's `bl_profile`.

**Expected behavior**: filling `forwarder` or `vessel` should clear the card.

**Files**: `lib/action-center.ts` (`blIsFilled` ~line 336),
`lib/shipping.ts` (`ShippingDetails` type), `production_orders.shipping_details`
(m070).

**Confirmed bug** [Confirmed code mismatch; behavioral consequence assumed —
needs reproduction to confirm].

---

### 7.5 Action Center "Done" depends on `action_acks.state` (m069) — soft-fails if not applied

**Current behavior** [Confirmed by code — `lib/action-center.ts` `applyAcks`,
lines 776–813]:

`markActionDone` upserts `{state:'done'}` into `action_acks`. If m069 has not
been applied (or if PostgREST schema cache is stale), the upsert fails with:

> *"Could not find the 'state' column of action_acks in the schema cache"*

The `applyAcks` function has a two-pass fallback: it first tries to select
`state`, and if that fails, falls back to selecting without `state` and maps
all rows to `state='acknowledged'`. **Done items are not filtered out** in this
fallback path — the card returns on next load.

**Expected behavior**: Clicking Done should persistently hide the card.

**Resolution** [Confirmed — operator action, not a code change]: Apply m069
in Supabase and run `notify pgrst, 'reload schema';` (already the last
statement in the migration).

---

### 7.6 No per-user notification targeting, no email/push, no preferences

**Current behavior** [Confirmed by code — all surfaces reviewed]:

No surface in SOLUX sends a notification to a **specific named user**. All
notifications are role-scoped or RLS-scoped.

- No email notifications.
- No push notifications.
- No in-app "notify user X" mechanism.
- No per-user mute / preferences / notification settings.

**Expected behavior**: Needs confirmation whether this is intentional for the
current phase or a known gap.

**Impact**: A sales user whose PO was cancelled and who is not actively
watching the Operations feed will only see the cancellation via:
- The bell (if someone comments on the cancellation event)
- The Action Center (only if a relevant action kind fires)
- The event timeline on the PO detail page

---

### 7.7 `emitEvent` call sites not fully enumerated

**Current behavior** [Needs confirmation]:

`emitEvent` is called with `bestEffort: true` from server actions — failures
are swallowed (console.warn only) so the main mutation succeeds regardless.

The exact set of server action call sites (`app/**/actions.ts`, 20 files total)
was not enumerated in this audit pass. It is not confirmed that every
meaningful lifecycle transition emits the expected event type.

**Expected behavior**: Every significant state change (status change, deadline
shift, deposit, BL update, validation decision) should emit a corresponding
event for the audit log and feed to reflect complete operational history.

**Needs confirmation**: Enumerate all `emitEvent` calls across the 20
`actions.ts` files and verify coverage against the `EventType` catalog in
`lib/events-shared.ts`.

---

## 8. Summary: Bell Trigger Map

For quick reference, here is what DOES and DOES NOT trigger the bell:

| Event | In bell? | Where it surfaces instead |
|---|---|---|
| Someone comments on an event you can see | YES | Bell + Operations feed |
| A new event is created (any severity, no comments yet) | NO | Operations feed, Action Center (if action kind matches) |
| Task list submitted for validation (technical role) | YES (review aggregate) | Bell + Operations feed |
| PO cancelled | NO (bell) | Operations feed (`critical` severity) |
| Deposit received | NO | Operations feed |
| Deadline changed | NO | Operations feed, Action Center (`production_late` if factory delay) |

---

## 9. Tables and Migrations Referenced

| Table | Migration | Purpose |
|---|---|---|
| `events` | m022 | Immutable event log |
| `events.status` columns | m039 | Event status workflow |
| `event_comments` | m044 | Threaded comments on events |
| `event_reads` | m045 | Per-user read state for bell |
| RLS hardening | m046 | Sales isolation on events |
| `entity_messages` | m049 | Entity-scoped conversation drawer |
| `quotation_reminders` | m043 | Sales follow-up reminders |
| `action_acks` | m069 | Done/acknowledged state for Action Center |
| `action_notes` | m075 | Micro-notes pinned to Action Center cards |
| `production_deadline_changes` | m072–m074 | Delay event log for `production_late` sensor |
| `shipping_details` JSONB shape | m070 | BL execution data on production orders |
