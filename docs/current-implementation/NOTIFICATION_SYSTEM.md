# Notification System — Current Implementation

> **Audit note.** Grounded in `lib/notifications.ts` (the bell),
> `lib/events.ts` / `lib/events-shared.ts` (event log + routing),
> `lib/action-center.ts` (derived actions), `lib/entity-messages.ts` /
> `lib/conversation-context.ts` (discussion drawer), `lib/reminders.ts`,
> `lib/operations-alerts.ts`. The exact set of code locations that **emit**
> events (`emitEvent` call sites) was not fully enumerated this pass and is
> tagged **Needs confirmation**.

---

## 1. There are FIVE distinct "notification-like" surfaces (Confirmed by code)

| # | Surface | Module | Persisted? | Purpose |
|---|---|---|---|---|
| 1 | **Notification bell** (top nav) | `lib/notifications.ts` | derived | unread event-comments + "task lists awaiting review" |
| 2 | **Event log / Operations feed** | `lib/events.ts`, `events-shared.ts` | yes (`events`, `event_comments`, `event_reads`) | immutable operational timeline + discussion |
| 3 | **Action Center** | `lib/action-center.ts` | derived (+ `action_acks`, `action_notes`) | live to-do actions grouped by urgency |
| 4 | **Conversation drawer** (entity messages) | `lib/entity-messages.ts`, `conversation-context.ts` | yes (`entity_messages`) | contextual discussion per entity |
| 5 | **Reminders / row alerts** | `lib/reminders.ts`, `lib/operations-alerts.ts` | reminders persisted (m043); alerts render-time | sales follow-ups; render-time row badges |

These are **separate systems** that overlap visually. The bell and the event
feed are tightly linked (the bell is a read-state view over the feed); the
Action Center, conversation drawer, reminders, and operations alerts are
independent.

---

## 2. Notification bell (`lib/notifications.ts`)

### Triggers (what creates a bell item)
- **Unread event comments**: an event the user can see (RLS-scoped) has ≥1
  comment from **someone else** newer than the user's `last_read_at`
  (`getUnreadCommentCountsForUser`, m045). Self-comments are excluded.
- **"N task lists awaiting your review"** (aggregate): for **technical roles
  only** (`isTechnicalRole`), one item counting task lists in
  `status='under_validation'`. Self-clears on validation; not read-tracked.

> ⚠️ A brand-new high-severity **event with no comments does NOT appear in the
> bell** — the bell is driven by unread *comments*, not by event creation. New
> events surface in the Operations feed (#2) / Action Center (#3) instead.
> **Confirmed by code; worth flagging as a design subtlety.**

### Recipients
- Whoever can **see** the underlying event (RLS on `events`/`event_comments`,
  m046). Sales → their deals; technical roles → everything (legacy visibility).
- The review aggregate → technical roles only.

### Display location
- Bell dropdown in the top nav. Panel shows up to **`MAX_PANEL_ITEMS = 10`**;
  the count caps at **`HARD_CAP_COUNT = 20`** ("20+").
- Each item leads with the **affair / project name** (falls back to doc/PO/TL
  number, then a short id), client name, event-type label, message, unread
  count, and latest comment preview (~80 chars).
- Sorted by latest unread comment time (desc).

### Click behavior — opens BOTH the page AND the discussion (Confirmed by code)
- `href = eventEntityHref(event) + "?event=<eventId>"`.
- `eventEntityHref` (`lib/events-shared.ts`): `document → /documents/:id`,
  `task_list → /task-lists/:id`, `production_order → /production/orders/:id`,
  `client → /clients/:id`, `system → null`.
- The destination page mounts an **`EventDiscussionPanel`**
  (`components/dashboard/EventDiscussionPanel.tsx` +
  `EventDiscussionDrawerClient.tsx`) that reads `?event=` and **overlays the
  discussion drawer** — so the user lands on full operational context **and**
  the conversation thread together.
- **Fallback**: `system` events (no entity page) → `/operations?event=<id>`.

---

## 3. Event log / Operations feed (`lib/events.ts`)

- **`events` is immutable / append-only** (m022; INSERT-only). Polymorphic:
  `entity_type` (document / task_list / production_order / client / system),
  `entity_id`.
- **Severity ladder**: low / medium / high / critical (`DEFAULT_SEVERITY` per
  event type).
- **Status ladder**: open / acknowledged / working / waiting / escalated /
  resolved (m039).
- **Feed ordering** (`listOperationsFeed`): severity → status rank
  (escalated > open > acknowledged > working > waiting > resolved) → recency.
- **Comments** (`event_comments`, m044) are threaded; **read state**
  (`event_reads`, m045) is per-user and drives the bell.
- **Emission**: `emitEvent` is **best-effort** (failures swallowed so the main
  action still succeeds). **Which transitions emit which events is Needs
  confirmation** — the `EventType` catalog exists (`events-shared.ts`) but the
  call sites weren't enumerated here.

---

## 4. Action Center (`lib/action-center.ts`)

- **Live-derived** (no stored feed): `gatherSignals` (sensors over task lists,
  validation requests, orders, won deals, deadline changes) → `materialize`
  (registry `ACTION_TYPES`) → `filterByRole` → `applyAcks` → `attachNotes`.
- **Action kinds**: `tl_validate`, `tl_clarify`, `doc_validate`, `deposit`,
  `production_late`, `missing_deadline`, `won_no_tasklist`,
  `bl_missing_destination`, `info`.
- **Sections**: `urgent` / `waiting_me` / `waiting_client` / `info_missing`.
  SLA-based escalation widens the target roles over time (`addRoles`).
- **Recipients**: role-filtered (`filterByRole`); RLS scopes the source rows.
- **Display location**: `/operations` and `/dashboard-v2`
  (`components/action-center/ActionCenter.tsx`), single-line dense cards (m076).
- **Click behavior**: each card's **Open** link → the entity page (`a.href`);
  cards also carry inline context chips, an "Added Xd ago" footer, and a
  **NotesPane** (m075, `action_notes`).
- **Acknowledge / Done** (m069, `action_acks`): items with
  `resolution='manual'` show a **Done** button (`markActionDone`,
  `app/(app)/dashboard-v2/actions.ts`); `state='done'` hides them until the
  condition recurs. `state='acknowledged'` dims but keeps them.
  - `production_late` only counts **factory** slip (`isFactoryDelay`).
  - `bl_missing_destination` clears via `blIsFilled` — **but reads the wrong
    `shipping_details` keys** (`forwarder_name`/`vessel_name` vs stored
    `forwarder`/`vessel`). See §7 + POTENTIAL_INCONSISTENCIES.md.

> The Action Center is a **to-do list**, not a notification feed: items appear
> because a *condition* is true and disappear when it resolves (or is marked
> Done). It does **not** notify a specific user by name; it targets roles.

---

## 5. Conversation drawer / entity messages (`entity_messages`, m049)

- **Globally mounted** drawer (`components/chat/ConversationDrawer.tsx` +
  `ConversationLauncher.tsx`) in `app/(app)/layout.tsx`.
- **Context** is resolved from the URL (`resolveConversationContext`): only the
  **detail** routes `/documents/:id`, `/task-lists/:id`,
  `/production/orders/:id`, `/clients/:id` (not list pages, not `/new`).
- **API**: `/api/conversations/[entity_type]/[entity_id]`.
- Only `message_kind='comment'` is used today; `request` / `reply` /
  `structured_reply` / `parent_message_id` / `request_type` /
  `resolved_at` / `resolved_by` are **reserved by m049 but unused**
  (`lib/entity-messages-shared.ts`).

> **Two discussion mechanisms coexist:** **event comments** (#2, tied to a
> specific operational `event`, opened via the bell's `?event=` drawer) and
> **entity messages** (#5, tied to the *entity* regardless of any event, opened
> via the global drawer). They are **different tables and different drawers**.
> This is a real source of confusion — see §7.

---

## 6. Reminders & render-time alerts

- **Quotation reminders** (`lib/reminders.ts`, m043): sales follow-ups with
  status `open`/`done`/`cancelled`, `isDue`/`isOverdue`/`isUpcoming`, snooze
  presets (+3d/+1w/+2w/+1mo). Persisted (`quotation_reminders`).
- **Operations alerts** (`lib/operations-alerts.ts`): **render-time only, no
  persistence** — `computeOperationsAlert` returns a level
  (`ok`/`awaiting_deposit`/`completion_approaching`/`overdue`/`delayed`/
  `balance_due`) with precedence overdue > balance_due > delayed >
  completion_approaching > awaiting_deposit; `COMPLETION_APPROACHING_DAYS = 10`.
  These are row badges, not clickable notifications.

---

## 7. Missing / inconsistent behavior (for the audit)

1. **Bell only fires on unread comments, not on event creation.** A new
   high/critical event with no comments will not raise the bell count. **
   Confirmed; likely a gap** for "I want to be alerted when X happens" without
   someone commenting.
2. **Two parallel discussion systems** (event comments vs entity messages) with
   two different drawers. No cross-linking; a user could comment in one and miss
   the other. **Confirmed; needs a product decision** on which is canonical.
3. **The "task lists awaiting review" bell item deep-links to `/task-lists`
   (the list), not to a specific task list or its discussion** — unlike every
   other bell item which uses `?event=`. Minor inconsistency. **Confirmed.**
4. **`bl_missing_destination` auto-clear key mismatch** — `blIsFilled` reads
   `shipping_details.forwarder_name`/`vessel_name`, but the data is stored as
   `forwarder`/`vessel`. The BL action won't self-clear on forwarder/vessel
   entry (only on `bl_number` or a filled client consignee). **Suspected bug.**
5. **Action Center "Done" depends on `action_acks.state`** (m069). If m069
   isn't applied (or PostgREST schema cache is stale), Done **soft-fails** and
   the card returns on revalidate — the actions code only swallows
   schema-missing errors (`isMissingActionAcksSchema`). This produced the
   observed *"Could not find the 'state' column of action_acks in the schema
   cache"* symptom. **Confirmed; resolution is to apply m069 + reload schema —
   a deferred operator action, not a code change.**
6. **No per-user notification targeting / preferences.** Notifications are
   role- and visibility-scoped; there is no "notify user X", no email/push, no
   mute/preferences. **Confirmed absent — Needs confirmation whether intended.**
7. **`emitEvent` call sites not enumerated** — cannot assert that every
   meaningful transition (status change, deadline change, deposit, shipment)
   emits an event. **Needs confirmation.**
