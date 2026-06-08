# Order Lifecycle — Editable Audit Document

> **How to use this file.** This is an editable source of truth for the
> order lifecycle. Every claim is grounded in the live code, with the
> distinction between confirmed facts and inferences made explicit.
> The owner should hand-edit this file as the implementation evolves.
>
> **Citation conventions:**
> - `[Confirmed by code]` — directly readable in the cited file/line.
> - `[Assumed from code]` — strongly implied by code structure; not a
>   single explicit statement.
> - `[Needs confirmation]` — referenced or expected but not provable from
>   the code read; requires a live test or owner clarification.
>
> **Primary sources read for this audit:**
> `lib/lifecycle.ts`, `lib/production-lifecycle.ts`, `lib/delays.ts`,
> `lib/types.ts`, `supabase/migrations/023_lifecycle_propagation.sql`,
> `app/(app)/task-lists/[id]/actions.ts`,
> `app/(app)/documents/[id]/actions.ts`,
> `app/(app)/production/orders/actions.ts`,
> `docs/current-implementation/ORDER_LIFECYCLE.md`,
> `docs/current-implementation/POTENTIAL_INCONSISTENCIES.md`,
> `docs/current-implementation/BUSINESS_RULES_DETECTED.md`.

---

## Owner Decisions (confirmed 2026-05-30)

> These decisions record the **TARGET / INTENDED behavior** as confirmed by the owner on
> 2026-05-30. They are **not yet implemented in code**. Each entry notes the gap between
> current (confirmed) behavior and the target. Canonical source:
> `docs/audit-editable/OWNER_DECISIONS_LOG.md` sections A and B.

### Decision A — Task-list creation on "Won": mandatory but NOT automatic

**Owner decision (confirmed 2026-05-30) — target behavior; not yet implemented.**

- Winning a quotation must **not** automatically create the production task list.
  This confirms current behavior (see §3.2, §9.5 — no auto-creation trigger exists in code).
- After a quotation is marked `won`, the app must **clearly surface a mandatory action:
  "Create Production Task List"**.
- If a won quotation has no linked task list, it must appear as an **alert / Action Center
  item** that persists until the task list is created.

**Gap vs. current behavior:** The flight-stage fallback "Deal won — task list not started
yet" (`lib/lifecycle.ts` line 354) is the only current indicator. No mandatory action
button nor Action Center alert has been confirmed in the audited code. See §9.5 and §12
item 3 for the corresponding open items (now resolved by this decision).

---

### Decision B — Won-quote editing: revise-only, with task-list diff/review control

**Owner decision (confirmed 2026-05-30) — target behavior; not yet implemented.**

- Once a quotation is `won`, it must **not** be edited directly in place.
- Any commercial change after `won` must go through a **new revision / new version**
  linked to the original quotation (versioning via migration m059 is the technical basis;
  see §8.3).
- **If no production task list exists yet:** the new revision becomes the active commercial
  version once validated.
- **If a production task list already exists:**
  - The app must detect and display the **differences** between the previous won version and
    the new revision.
  - Changes affecting production, configuration, quantity, shipping, deadlines, payment
    terms, or BL information must trigger a **review state** on the linked task list
    ("requiring review / update").
  - Operations or TLM must confirm whether the task list should be **updated, regenerated,
    or kept unchanged** before production continues.
  - The app must **not** silently overwrite the existing task list.
- The **previous won version must be preserved** for audit and history.
- A clear **"Create revision / Revise quote"** action must be accessible from the won
  quotation detail page.

**Gap vs. current behavior:** No in-place edit guard on `won` quotations was confirmed in
the audited code (§12 item 4 — open; now resolved by this decision). The revision model
(m059) exists at the DB layer but the review/diff state and task-list confirmation flow are
**not yet implemented**. See §8.3 for the versioning mechanics currently in the codebase.

**Cross-reference — production ORDER vs. task LIST auto-creation distinction:**
Production **orders** are auto-created by `ensureProductionOrderForTaskList`
(`app/(app)/task-lists/[id]/actions.ts` ~L639–645) when a task list reaches `validated`
or `production_ready`. Production task **lists** are NOT auto-created on win — they require
a manual `generateProductionTaskList` call. Decision B's revision/review flow applies to
the task list layer; the production order auto-creation hook fires as normal once the
(possibly revised) task list is validated.

---

## 1. The Three Entities

An "order" is the union of three linked rows, each with its own status
enum defined in `lib/types.ts`:

```
documents (quotation) ──► production_task_lists ──► production_orders
   DocStatus               ProductionTaskListStatus    ProductionOrderStatus
```

`lib/lifecycle.ts` is the **semantic layer** — instead of comparing raw
status strings inline, every component and server action uses helpers such
as `isDocActive`, `isTaskListCancelled`, `isPOTerminal`, etc.
`computeOrderFlightStage()` collapses all three entities into a single
operational stage for dashboards.

[Confirmed by code — `lib/lifecycle.ts` file header and module exports]

---

## 2. The Unified 6-Phase "Flight Strip"

### 2.1 Phase labels

`ORDER_FLIGHT_PHASES` is exported from `lib/lifecycle.ts` (line 257–264):

```
Phase 0: Quote
Phase 1: Task list
Phase 2: Payment
Phase 3: Production
Phase 4: Shipping
Phase 5: Delivered
```

[Confirmed by code — `lib/lifecycle.ts` lines 257–264]

### 2.2 Full mapping table

`computeOrderFlightStage(o: OrderStageInput)` at `lib/lifecycle.ts`
lines 307–355 resolves the **most advanced** signal: production-order
status first (furthest along), then task-list status, then the
"won but nothing started" fallback.

The input type `OrderStageInput` uses `production_status` (an alias, not
the real DB column — see Section 9.1).

| Source status | Phase | Label | Tone | Context string |
|---|---|---|---|---|
| PO `delivered` | 5 | Delivered | emerald | "Order delivered to the customer." |
| PO `shipped` | 4 | In transit | violet | ETA if available, else "Shipped — in transit to destination." |
| PO `shipment_booked` | 4 | Shipment booked | violet | ETD if available, else "Shipment booked — awaiting departure." |
| PO `production_completed` | 4 | Production complete | emerald | "Manufacturing finished — preparing shipment." |
| PO `production_delayed` | 3 | Production delayed | red | "`delay_days`d behind schedule" or "Production behind schedule." |
| PO `in_production` | 3 | In production | amber (red if late) | "Manufacturing in progress" or "`delay_days`d behind baseline." |
| PO `production_scheduled` | 3 | Production approved | sky | "Approved — waiting for the factory slot." |
| PO `deposit_received` | 3 | Deposit received | sky | "Deposit in — production release pending." |
| PO `awaiting_deposit` | 2 | Awaiting deposit | amber | "Awaiting customer deposit before production release." |
| TL `production_ready` | 2 | Production ready | sky | "Validated — production order being created." |
| TL `validated` | 2 | Task list validated | sky | "Approved by the factory — releasing to production." |
| TL `under_validation` | 1 | Under task list review | amber | "Task list under review by the factory." |
| TL `needs_revision` | 1 | Needs revision | red | "Sent back to sales — clarification needed." |
| TL `draft` | 1 | Task list draft | neutral | "Sales is preparing the task list." |
| TL `cancelled` | 1 | Task list cancelled | neutral | "The task list was cancelled." |
| (won, nothing started) | 1 | Awaiting task list | neutral | "Deal won — task list not started yet." |

[Confirmed by code — `lib/lifecycle.ts` lines 307–355]

> **Non-obvious design choices (Confirmed by code):**
>
> - `production_completed` maps to **Phase 4 (Shipping)**, not Phase 3.
>   Once manufacturing is done, the order is operationally in the
>   shipping phase.
> - `deposit_received` maps to **Phase 3 (Production)**, not Phase 2
>   (Payment). Receiving the deposit advances the bar into Production.
>   These are intentional; change carefully.

---

## 3. Step-by-Step Lifecycle

### 3.1 Quotation / Document (`DocStatus`)

**Status flow:**

```
draft → sent → negotiating → won
                    │            └─► (task list phase begins — see §3.2)
                    └─► lost      (dead; triggers cascade)
  any → cancelled               (dead; triggers cascade)
```

**DB column:** `documents.status`
[Confirmed by code — `lib/types.ts` + CHECK constraint in `supabase/migrations/008_*/017_*`]

**Status sets:**

```typescript
DOC_ALIVE_STATUSES  = ["draft", "sent", "negotiating", "won"]
DOC_DEAD_STATUSES   = ["lost", "cancelled"]
DOC_PIPELINE_STATUSES = ["sent", "negotiating"]
DOC_TERMINAL_STATUSES = ["won", "lost", "cancelled"]
```

[Confirmed by code — `lib/lifecycle.ts` lines 63–80]

**Advisory validation loop (separate concept):** Migration m068 adds a
`validation_status` column (`none → pending → approved | rejected`) to
`documents`. This is an **advisory review only** — it never blocks sending
or winning a quotation. `lib/validation.ts` governs it. This is a
completely different concept from task-list workflow validation (see
Section 9.2). [Confirmed by code — `lib/validation.ts` header + states]

#### Status detail table

| Status | How created | Next action | Who can act | DB value |
|---|---|---|---|---|
| `draft` | `generateProductionTaskList` action called on `/documents/new`; new doc inserted with status `draft` | Sales clicks "Send" | Sales (`quotation.create` capability implied by RLS) | `"draft"` |
| `sent` | Sales sets status via `updateDocumentStatus` | Sales moves to negotiating | Sales (RLS scopes) | `"sent"` |
| `negotiating` | Sales sets status | Sales marks won or lost | Sales (RLS scopes) | `"negotiating"` |
| `won` | Sales sets status via `updateDocumentStatus` | TLM creates task list | Sales; no capability guard (RLS handles scope) [Confirmed by code — `app/(app)/documents/[id]/actions.ts` line 317–321: only `cancelled` requires `requireCapability`] | `"won"` |
| `lost` | Sales sets status | None — dead; cascade fires | Sales (RLS scopes) | `"lost"` |
| `cancelled` | Sales or owner via `updateDocumentStatus` or `cancelQuotation` | None — dead; cascade fires | Requires `quotation.cancel` capability [Confirmed by code — `app/(app)/documents/[id]/actions.ts` line 321] | `"cancelled"` |

**`isDocCancelled` treats both `lost` AND `cancelled` as cancelled.**
Migration m023's trigger cascades `lost → cancelled` on the task list and
PO. [Confirmed by code — `lib/lifecycle.ts` line 82–84 + m023 trigger line 45]

---

### 3.2 Production Task List (`ProductionTaskListStatus`)

**Entry point:** A user manually calls `generateProductionTaskList` on the
quotation detail page after the quotation is `won`. The task list is NOT
auto-created on win. The flight-stage fallback "Awaiting task list — Deal
won, task list not started yet" (lib/lifecycle.ts line 354) confirms this.
[Confirmed by code — `app/(app)/documents/[id]/actions.ts`
`generateProductionTaskList` function + the fallback label in
`lib/lifecycle.ts`]

> The `generateProductionTaskList` action checks for an existing task list
> first (`.maybeSingle()` select) and redirects to it if found — so it
> is idempotent: one task list per quotation. [Confirmed by code —
> `app/(app)/documents/[id]/actions.ts` lines 205–210]

**Initial status on creation:** `"draft"` (explicitly set in the INSERT
payload, line 267). [Confirmed by code]

**Status flow:**

```
draft → under_validation → validated → production_ready
            │      ▲
            ▼      │
       needs_revision (sales fixes and re-submits)
  any → cancelled (terminal)
```

**DB column:** `production_task_lists.status`
[Confirmed by code — `lib/types.ts` lines 388–414]

**Status sets:**

```typescript
TASK_LIST_ALIVE_STATUSES     = ["draft", "under_validation", "needs_revision", "validated", "production_ready"]
TASK_LIST_DEAD_STATUSES      = ["cancelled"]
TASK_LIST_PRODUCTION_STATUSES = ["validated", "production_ready"]   // PO should exist
TASK_LIST_LOCKED_FOR_SALES   = ["under_validation", "validated", "production_ready", "cancelled"]
TASK_LIST_TLM_QUEUE          = ["under_validation"]                 // TLM's actionable queue
TASK_LIST_TLM_QUEUE_BROAD    = ["under_validation", "validated", "production_ready"]
```

[Confirmed by code — `lib/types.ts` lines 421–455 + `lib/lifecycle.ts` lines 101–116]

#### Status detail table

| Status | How created | Which action moves to next | Role / auth guard | UI phase / label / tone | DB column value |
|---|---|---|---|---|---|
| `draft` | `generateProductionTaskList` action (INSERT with `status: "draft"`) | Sales submits via `submitForValidation` | Sales (no cap guard; RLS scopes) | Phase 1 / "Task list draft" / neutral | `"draft"` |
| `under_validation` | `submitForValidation` — allowed from `draft` or `needs_revision`; stamps `submitted_at` | TLM validates or rejects | Enters TLM queue (`TASK_LIST_TLM_QUEUE`); sales edit locked | Phase 1 / "Under task list review" / amber | `"under_validation"` |
| `needs_revision` | `requestRevision` — allowed from `under_validation`, `validated`, or `production_ready` | Sales re-submits via `submitForValidation` | Requires `task_list.validate` capability [Confirmed] | Phase 1 / "Needs revision" / red | `"needs_revision"` |
| `validated` | `validateTaskList` — allowed from `under_validation` only; stamps `validated_at` + `validated_by`; **auto-creates linked PO** | TLM marks production ready or sends back | Requires `task_list.validate` capability [Confirmed by code — `app/(app)/task-lists/[id]/actions.ts` line 692] | Phase 2 / "Task list validated" / sky | `"validated"` |
| `production_ready` | `markProductionReady` — allowed from `validated` or `under_validation` (fast-track); **auto-creates linked PO** | Ops/TLM creates/manages PO | Requires `task_list.validate` capability [Confirmed] | Phase 2 / "Production ready" / sky | `"production_ready"` |
| `cancelled` | `rejectTaskList` (allowed from any non-cancelled status) or cascade from document cancellation (m023 trigger) | None — terminal | Requires `task_list.reject` capability [Confirmed by code — `app/(app)/task-lists/[id]/actions.ts` line 749]; OR cascade via DB trigger (no app auth required) | Phase 1 / "Task list cancelled" / neutral | `"cancelled"` |

**Production order auto-creation:** When a task list transitions to
`validated` or `production_ready` (including via admin override with
`setTaskListStatus`), `ensureProductionOrderForTaskList` is called. This
function is idempotent (select-before-insert), creates the PO with status
`awaiting_deposit`, and numbers it `PO-<quote_number>`.
[Confirmed by code — `app/(app)/task-lists/[id]/actions.ts` lines 415–592,
639–645, 795–797]

**Sales edit lock:** Once at `under_validation` (and above), sales cannot
edit lines, the header, sticker requirements, or risk flags unless the task
list is sent back to `needs_revision`. Technical roles (`task_list_manager`,
`operations`, `admin`, `super_admin`) can edit at any pre-terminal stage.
[Confirmed by code — `lib/types.ts` `TASK_LIST_LOCKED_FOR_SALES` + edit
guards in `app/(app)/task-lists/[id]/actions.ts` lines 79–87, 134–136,
205–209, 285–289]

**Factory overrides / extras (m071):** TLM can set per-line
`factory_overrides` (JSONB) and `factory_extras` at any pre-terminal stage.
These **never overwrite the sales configuration** — they layer on top at
read time. Priority: override > client_preset > global mapping > missing.
[Confirmed by code — `lib/types.ts` `resolveFactoryInstruction` +
`app/(app)/task-lists/[id]/actions.ts` lines 1063–1090]

**Admin escape hatch:** `setTaskListStatus` allows any status to be set
directly; gated by `task_list.validate` capability; also triggers the
auto-create hook. [Confirmed by code — lines 778–814]

---

### 3.3 Production Order (`ProductionOrderStatus`)

**Entry point:** Auto-created by `ensureProductionOrderForTaskList` when
the task list reaches `validated` or `production_ready`. Always starts
with status `awaiting_deposit`. [Confirmed by code — `app/(app)/task-lists/[id]/actions.ts` lines 507–514]

**Status flow:**

```
awaiting_deposit → deposit_received → production_scheduled → in_production
                                                                 │
                                              (production_delayed)│← delay event added
                                                                 ▼
                              production_completed → shipment_booked → shipped → delivered
  any → cancelled (terminal; never auto-cancels a delivered PO)
```

**DB column:** `production_orders.status`
[Confirmed by code — `lib/types.ts` lines 491–501]

**Status sets:**

```typescript
PO_ACTIVE_STATUSES   = ["awaiting_deposit", "deposit_received", "production_scheduled", "in_production", "production_delayed"]
PO_SHIPPING_STATUSES = ["production_completed", "shipment_booked", "shipped"]
PO_TERMINAL_STATUSES = ["delivered", "cancelled"]
PO_DEAD_STATUSES     = ["cancelled"]
PO_CLOSED_SUCCESS_STATUSES = ["delivered"]
```

[Confirmed by code — `lib/lifecycle.ts` lines 139–165]

#### Status detail table

| Status | How created / entered | Which action moves to next | Role / auth guard | UI phase / label / tone | DB column value | DB side effects |
|---|---|---|---|---|---|---|
| `awaiting_deposit` | Auto-created by `ensureProductionOrderForTaskList` when TL reaches `validated` / `production_ready` | Ops records deposit receipt or sets override | `production_order.edit_payments` capability [Assumed from code] | Phase 2 / "Awaiting deposit" / amber | `"awaiting_deposit"` | `deposit_received_at` = NULL, `deposit_override_at` = NULL |
| `deposit_received` | `updateProductionOrderStatus` with `production_order.edit_status` | Ops schedules production | Requires `production_order.edit_status` capability | Phase 3 / "Deposit received" / sky | `"deposit_received"` | `deposit_received_at` stamped; **baseline activates** |
| `production_scheduled` | `updateProductionOrderStatus` | Ops starts production | Requires `production_order.edit_status` capability | Phase 3 / "Production approved" / sky | `"production_scheduled"` | Timeline / `production_working_days` editable until activation |
| `in_production` | `updateProductionOrderStatus` | Ops tracks progress or records delay | Requires `production_order.edit_status` capability | Phase 3 / "In production" / amber (red if `delay_days > 0`) | `"in_production"` | Baseline locked if not already |
| `production_delayed` | `updateProductionOrderStatus` (ops moves to this; or implied when a delay event is added on `in_production`) | Ops resolves delay, moves back or forward | Requires `production_order.edit_status` capability | Phase 3 / "Production delayed" / red | `"production_delayed"` | A `production_deadline_changes` row must exist with signed `days_added` |
| `production_completed` | `updateProductionOrderStatus` | Ops books shipment | Requires `production_order.edit_status` capability | Phase 4 / "Production complete" / emerald | `"production_completed"` | Auto-stamps `actual_completion_date` if not already set [Confirmed — `app/(app)/production/orders/actions.ts` lines 124–128] |
| `shipment_booked` | `updateProductionOrderStatus` | Ops ships | Requires `production_order.edit_status` capability | Phase 4 / "Shipment booked" / violet | `"shipment_booked"` | `shipment_booked` boolean, `etd` expected to be set via `production_order.edit_shipment` |
| `shipped` | `updateProductionOrderStatus` | Ops marks delivered | Requires `production_order.edit_status` capability | Phase 4 / "In transit" / violet | `"shipped"` | `etd`, `eta` expected to be set |
| `delivered` | `updateProductionOrderStatus` | None — terminal success | Requires `production_order.edit_status` capability | Phase 5 / "Delivered" / emerald | `"delivered"` | Terminal — never auto-cancelled by upstream cascade |
| `cancelled` | `updateProductionOrderStatus` (manual) OR cascade from document/task-list cancellation via m023 DB trigger | None — terminal dead | Requires `production_order.edit_status` capability (manual); OR DB trigger fires automatically (no app auth gate) | Not in flight-strip (PO cancelled = no active order row) | `"cancelled"` | DB trigger inserts `events` row with severity `critical` |

> **Note on transition graph:** `updateProductionOrderStatus` does NOT
> enforce a transition graph — it accepts any valid status value. The
> comment in the action states: "production teams sometimes need to skip
> steps (e.g. mark cancelled)." The DB CHECK constraint enforces the enum
> but not the ordering. [Confirmed by code —
> `app/(app)/production/orders/actions.ts` lines 97–103]

---

## 4. Production Baseline and Delay Model

All functions below are pure (client + server safe) — no Supabase, no
React. Source: `lib/production-lifecycle.ts`.

### 4.1 Production start date

```typescript
getProductionStartDate(po) → string | null
```

Returns `deposit_received_at` if set; otherwise the date portion of
`deposit_override_at`; otherwise `null` (production not yet started).

**Precedence:** `deposit_received_at` wins over `deposit_override_at` when
both are set (e.g. admin started without deposit, then deposit landed
afterwards — the deposit_received_at is the cleaner anchor).

[Confirmed by code — `lib/production-lifecycle.ts` lines 57–66]

### 4.2 Production activation

**Activation** occurs when `getProductionStartDate` returns non-null:
- Normal path: deposit fully received → `deposit_received_at` is stamped.
- Override path: ops uses `start_without_deposit` escape hatch (m025,
  capability `production_order.start_without_deposit`) → `deposit_override_at`
  and `deposit_override_by` / `deposit_override_reason` are stamped.

`isProductionActive(po)` — true once either field is set.
`isStartedWithoutDeposit(po)` — true if override fired but deposit still not in.

[Confirmed by code — `lib/production-lifecycle.ts` lines 72–88]

### 4.3 Baseline lock

```typescript
isBaselineLocked(po) → boolean
```

True when `baseline_locked_at` is stamped, OR when `isProductionActive` is
true (safety net for legacy rows where the column wasn't yet stamped).

**Revised semantics (May 2026 — Confirmed by code comment in
`lib/production-lifecycle.ts` lines 96–113):**

> The baseline locks at **production activation** (deposit received OR
> override), NOT at the first `working_days` save. Before activation,
> ops needs to revise `production_working_days` for commercial
> communication / planning; after activation the field is frozen.

`baseline_locked_at` is stamped at activation by the payment actions.
[Confirmed by code — `lib/production-lifecycle.ts` lines 114–126]

### 4.4 Initial Project Completion (frozen baseline)

```typescript
getInitialProjectCompletion(po) → string | null
```

Returns the stored `initial_production_deadline` column directly — never
recomputes on the fly. NULL until activation.

**Write path:** `computeInitialProjectCompletionForActivation(po)` is called
at activation:

```
initial_production_deadline = production_start_date + production_working_days
                              (calendar working days, weekends excluded via addWorkingDays)
```

Once stamped, this column is **frozen** — it is never overwritten.
[Confirmed by code — `lib/production-lifecycle.ts` lines 128–198]

> The OLD formula (`validation_date + working_days`) was wrong for the
> Solux workflow because production starts after deposit (not at
> validation). The column `production_validation_date` still exists as
> an operational anchor but is NOT the baseline start date.
> [Confirmed by code comment — `lib/production-lifecycle.ts` line 146]

### 4.5 Operational delay

```typescript
computeBaselineDelay(po) → number | null
```

```
current_production_deadline − initial_production_deadline   (calendar days)
```

Positive = behind schedule. Zero = on track. Negative = ahead of schedule.
NULL until activation (no frozen baseline to compare against).

Functionally identical to `computeProductionDelay` in `lib/types.ts`
lines 732–745.
[Confirmed by code — `lib/production-lifecycle.ts` lines 220–233]

### 4.6 Lifecycle phase for a production order

```typescript
getLifecyclePhase(po) → ProductionLifecyclePhase
```

| Phase returned | Condition |
|---|---|
| `"closed"` | `status === "cancelled"` OR `archived_at` set |
| `"completed"` | `actual_completion_date` set (regardless of status) |
| `"in_production"` | `isProductionActive` true (deposit/override in) |
| `"awaiting_start"` | none of the above (pre-activation) |

[Confirmed by code — `lib/production-lifecycle.ts` lines 254–268]

> **Inconsistency:** `getLifecyclePhase` marks `completed` when
> `actual_completion_date` is set; `computeOrderFlightStage` shows
> "Production complete" on PO status `production_completed` (phase 4).
> A PO could have status `production_completed` without
> `actual_completion_date` (or vice versa). See Section 9.3.

---

## 5. Delay Event Model

Source: `lib/delays.ts`, migrations m072–m074.

### 5.1 How deadlines move

Deadlines move by **additive events**, never by overwriting the stored date
directly. Each deadline change is a row in `production_deadline_changes`
with a signed `days_added` field. The materialized column
`current_production_deadline` is recomputed as:

```
current_production_deadline = initial_production_deadline + Σ days_added
```

`recomputeOrderDeadline` in `app/(app)/production/orders/actions.ts`
(lines 42–79) performs this recomputation after every insert, edit, or
delete of a delay event, keeping the materialized column in lockstep.

[Confirmed by code — `app/(app)/production/orders/actions.ts` lines 42–79]

### 5.2 Delay types

```typescript
type DelayType =
  | "production"     // Factory responsibility — counts toward factory KPI
  | "payment"        // Project held by unreceived payment
  | "shipping"       // Carrier, vessel, or forwarder
  | "client_change"  // Customer added/changed scope mid-project
  | "client_waiting" // Awaiting client confirmation or approval
  | "supplier"       // Upstream component / supplier delay
  | "customs"        // Customs, certification, or external authority
  | "other";         // External / operational (non-factory)
```

[Confirmed by code — `lib/delays.ts` lines 21–29]

**Factory KPI rule:** Only `delay_type = 'production'` (or NULL for legacy
rows, which backfill as `'production'`) counts toward the factory
performance indicator. External delays surface in amber but do NOT poison
factory KPIs.

```typescript
isFactoryDelay(t) → t == null || t === "production"
```

[Confirmed by code — `lib/delays.ts` lines 79–81]

### 5.3 Delay breakdown computation

```typescript
computeDelayBreakdown(changes) → { factoryDays, externalDays, latestType, changeCount }
```

Each event contributes its signed `days_added` to either the factory or
external bucket. Recovery events (negative `days_added`) reduce the bucket
they were attributed to.

Falls back to `(new_date − previous_date)` diff when `days_added` is NULL
(pre-m073 rows not yet backfilled).

[Confirmed by code — `lib/delays.ts` lines 133–158]

### 5.4 Delay events are editable but audit-logged

Delay event rows can be edited in place (`updateDelayEvent` action, gated
by `production_order.edit_deadline`). Migration m074 adds `updated_at` /
`updated_by` columns to track edits. This is an explicit product decision
over strict immutability.

[Confirmed by code — `app/(app)/production/orders/actions.ts` lines 346–420
+ migration m074 description in `BUSINESS_RULES_DETECTED.md` §D7]

### 5.5 Requiring a delay type

Non-initial deadline changes **require a `delay_type`** — the action throws
`"Pick a delay type — production / payment / shipping / client / supplier /
customs / other."` if the field is missing.
[Confirmed by code — `app/(app)/production/orders/actions.ts` lines 253–256]

---

## 6. Cancellation Propagation

**Source of truth: DB triggers** in
`supabase/migrations/023_lifecycle_propagation.sql`.
`CASCADE_RULES` in `lib/lifecycle.ts` mirrors the triggers for UI
confirmation dialogs.

### 6.1 Cascade table

| Cancel this | Also cancels | Skip if target already |
|---|---|---|
| `documents` (status → `cancelled` or `lost`) | every linked `production_task_lists` | `cancelled` |
| `documents` (status → `cancelled` or `lost`) | every linked `production_orders` | `cancelled` or `delivered` |
| `production_task_lists` (status → `cancelled`) | its linked `production_orders` | `cancelled` or `delivered` |

[Confirmed by code — `supabase/migrations/023_lifecycle_propagation.sql`
lines 53–117 (doc → TL), lines 91–117 (doc → PO), lines 146–180 (TL → PO);
`lib/lifecycle.ts` `CASCADE_RULES` lines 214–236]

### 6.2 Key rules

- A **delivered PO is never auto-cancelled** by any upstream cancellation.
  Once goods have shipped, the order is operationally closed.
  [Confirmed by code — m023 trigger `WHERE status NOT IN ('cancelled', 'delivered')`]

- Cancellation triggers fire on every UPDATE to the status column, regardless
  of which code path issues the write (server action, admin SQL, etc.). This
  is guaranteed at the DB layer.
  [Confirmed by code — `lib/lifecycle.ts` file header + m023]

- The triggers also insert `events` rows (severity `critical`) for the cascade
  so the audit log captures every auto-cancellation.
  [Confirmed by code — m023 lines 67–83 (TL event), lines 100–117 (PO event)]

- Migration m023 includes a **backfill section** (lines 197–277) that
  retroactively fixed rows that were inconsistent before the triggers existed.
  [Confirmed by code — m023 lines 197–277]

- Only the `cancelled` transition on a document requires the `quotation.cancel`
  capability. Setting status to `lost`, `won`, `sent`, or `negotiating` is gated
  only by RLS (the document must be the user's own). The cascade fires for `lost`
  too, without the capability check, because the trigger fires on the DB-level
  status write.
  [Confirmed by code — `app/(app)/documents/[id]/actions.ts` lines 317–323]

### 6.3 `isDocCancelled` semantics

```typescript
isDocCancelled(status) → status === "cancelled" || status === "lost"
```

Both `lost` and `cancelled` are treated as cancelled for all downstream
lifecycle logic. [Confirmed by code — `lib/lifecycle.ts` line 82–84]

---

## 7. Soft Archive vs. Cancel vs. Delete

These are three distinct operations:

| Operation | Table column | Who can | Reversible | Cascades |
|---|---|---|---|---|
| Cancel | `status = 'cancelled'` | Role-gated (see above) | No (status is terminal) | Yes — via m023 triggers |
| Archive | `archived_at` timestamptz | Admin (gated per entity) | Yes — `unarchiveTaskList` etc. | No — archiving TL does NOT archive its PO |
| Delete | Physical DELETE | Super-admin only (`requireCapability("task_list.delete")`) | No | N/A |

[Confirmed by code — `app/(app)/task-lists/[id]/actions.ts` lines 819–881
(delete), 1000–1061 (archive); `lib/auth.ts requireSuperAdmin` pattern]

---

## 8. Related Concepts Not in This Document

### 8.1 Payment tracking

Payment state is a computed concept separate from the PO `status` column.
`computeProductionPaymentState` in `lib/types.ts` (lines 665–700) derives:

```
no_terms → awaiting_deposit → deposit_received → partial_balance → paid_in_full
                                    OR → no_deposit_required
```

This derives from `deposit_received_amount` vs `computeExpectedDeposit`
(percent of quotation total). It is NOT the same as the PO status field.

### 8.2 Quotation advisory validation

Migration m068 + `lib/validation.ts` — a separate `validation_status`
column on `documents` with states `none | pending | approved | rejected`.
This is advisory only, never blocks status transitions. Entirely separate
from task-list workflow validation.

### 8.3 Quotation versioning

Migration m059 — revisions share `root_document_id` with incrementing
`version`. The `generateProductionTaskList` function uses the EXACT
document that was linked (not necessarily the latest version).
[Needs confirmation — whether winning a revised version creates a task
list linked to the revision vs. the root.]

---

## 9. UI vs. DB Inconsistencies

### 9.1 `production_status` is a query alias, not a real DB column

**Current behavior:** The DB column is `production_orders.status`. The
type `OrderStageInput` in `lib/lifecycle.ts` (line 289) uses the field name
`production_status`. Similarly `OrderInFlight` in dashboard queries uses
`production_status` as an alias (`status AS production_status`).

**Expected behavior / risk:** Any raw query that selects `production_status`
without the alias will return `null` (no column by that name), silently
breaking `computeOrderFlightStage`. A new query writer who forgets the alias
will not get a runtime error — just a NULL that maps to the "Awaiting task
list" fallback.

**Files:** `lib/lifecycle.ts` `OrderStageInput.production_status`;
`components/dashboard/OrdersInFlight.tsx`.

[Confirmed by code — naming hazard; behavioral impact Suspected]

### 9.2 Two unrelated concepts both called "validation"

**Current behavior:**
- `documents.validation_status` (m068) = advisory review: `none → pending → approved | rejected`
- `production_task_lists.status` includes `under_validation` / `validated` = workflow gate

They are completely separate systems. One blocks nothing; the other blocks sales edits and creation of the PO.

**Risk:** Operator confusion — "validation" appears in both contexts with
different consequences.

**Files:** `lib/validation.ts` (doc advisory); `lib/types.ts`
`ProductionTaskListStatus` (TL workflow); `lib/auth.ts`
`requireTaskListManagerOrAdmin`.

[Confirmed by code — confirmed terminology collision]

### 9.3 "Completed" defined two different ways

**Current behavior:**
- `getLifecyclePhase` in `lib/production-lifecycle.ts` (line 265) marks an
  order `completed` when `actual_completion_date` is set.
- `computeOrderFlightStage` in `lib/lifecycle.ts` (line 322) shows
  "Production complete" (phase 4) on PO `status = 'production_completed'`.

These can disagree:
- Status `production_completed` set without `actual_completion_date` → flight strip says "Production complete" but `getLifecyclePhase` says `in_production`.
- Conversely, `actual_completion_date` set while status is still `in_production` → `getLifecyclePhase` says `completed` but flight strip says "In production".

However, `updateProductionOrderStatus` **auto-stamps** `actual_completion_date`
when setting status to `production_completed` (if not already set).
[Confirmed by code — `app/(app)/production/orders/actions.ts` lines 124–128]

This auto-stamp reduces (but does not eliminate) the divergence. The reverse
case (date set without status change) remains possible via direct DB writes
or other paths.

**Files:** `lib/production-lifecycle.ts getLifecyclePhase`;
`lib/lifecycle.ts computeOrderFlightStage`;
`app/(app)/production/orders/actions.ts updateProductionOrderStatus`.

[Confirmed: two definitions exist; partial mitigation via auto-stamp;
full divergence risk Suspected for non-standard update paths]

### 9.4 `deposit_received` advances the flight bar to Phase 3 (Production), not Phase 2 (Payment)

**Current behavior:** PO status `deposit_received` maps to Phase 3 in the
flight strip, while `awaiting_deposit` maps to Phase 2. This is intentional:
receiving the deposit is the production-release trigger.

**Risk:** Easy to misread as "still in the payment phase." Document clearly
before any UI redesign.

[Confirmed by code — `lib/lifecycle.ts` line 333 (`awaiting_deposit → phaseIndex 2`),
line 331 (`deposit_received → phaseIndex 3`)]

### 9.5 Task-list creation on "Won" is manual, not automatic

**Current behavior:** The flight-stage fallback "Deal won — task list not
started yet" (lib/lifecycle.ts line 354) and the explicit action
`generateProductionTaskList` (app/(app)/documents/[id]/actions.ts) confirm
that no trigger or server action auto-creates a task list on doc.status →
'won'.

A user must click a button on the document detail page to call
`generateProductionTaskList`.

**Risk:** If a sales rep wins a deal and moves on, the task list is never
created and the order silently stays at "Awaiting task list" with no alert.

[Confirmed by code — no auto-creation trigger exists in the code read.
**Action Center alert — RESOLVED by Decision A (2026-05-30):** The owner
has confirmed that a persistent Action Center alert MUST fire on a won
quotation that has no linked task list, and a mandatory "Create Production
Task List" action must be surfaced. This is target behavior; not yet
implemented. See the "Owner Decisions" section at the top of this document.]

---

## 10. Unclear / Ambiguous Statuses

### 10.1 `production_delayed` — when exactly is it set?

The status `production_delayed` exists in the PO enum. `updateProductionOrderStatus`
allows setting it manually (no transition graph). However, there is no
automatic promotion from `in_production` to `production_delayed` when a
delay event is logged. The Action Center action `production_late` is a
derived item based on `current_production_deadline < today` while the order
is in production — but this does not write the status.

[Needs confirmation: is there any background job, cron, or trigger that
auto-sets `production_delayed` when the deadline passes? Or is it purely
a manual status?]

### 10.2 `shipment_booked` boolean vs. `shipment_booked` status

The `production_orders` table has both:
- `status = 'shipment_booked'` (the PO status enum)
- `shipment_booked` (a boolean column, `lib/types.ts` line 588)

`computeOrderFlightStage` checks `o.shipment_booked` (boolean) in the
context string for `production_completed` (line 322–323):
`"Finished — shipment booked."` vs `"Manufacturing finished — preparing shipment."`.

[Confirmed: both exist; [Needs confirmation]: are they kept in sync by the
`edit_shipment` action, or can they diverge?]

---

## 11. Orphan Production Orders — Safety Net

`syncOrphanProductionOrders` (capability `task_list.sync_orphans`) scans
for task lists at `validated`/`production_ready` without a linked PO and
creates the missing POs. This is an admin repair tool in case the
`ensureProductionOrderForTaskList` hook silently fails (e.g. RPC missing,
RLS issue, column missing before a migration is applied).

[Confirmed by code — `app/(app)/task-lists/[id]/actions.ts` lines 882–988]

---

## 12. Needs Confirmation — Open Items

The following items could not be confirmed from the code alone and require
a live test or owner clarification:

1. **Task list creation — user journey:** Which exact UI element on the
   document detail page calls `generateProductionTaskList`? Is there a
   "Create Task List" button gated by `status === 'won'`? [Needs confirmation]

2. **`production_delayed` auto-set:** Is there any mechanism (cron, trigger,
   background job) that automatically sets PO status to `production_delayed`
   when `current_production_deadline` passes? Or is it always manual?
   [Needs confirmation]

3. **Action Center alert for "won but no task list":** Does any Action Center
   sensor fire when a document is `won` but no task list has been created?
   **RESOLVED — Decision A (confirmed 2026-05-30):** Target behavior requires a
   persistent Action Center alert AND a mandatory "Create Production Task List"
   action. Not yet implemented in code; `lib/action-center.ts` not fully audited.

4. **Quote becomes read-only after `won`:** Is there any edit guard on the
   quotation document once it reaches `won` (preventing price changes
   after the deal is signed)?
   **RESOLVED — Decision B (confirmed 2026-05-30):** Target behavior: no in-place
   edits on a won quotation; all commercial changes must go through a new revision /
   new version. The previous won version is preserved for audit. A "Revise quote"
   action must be accessible from the won quotation detail page. Not yet implemented
   in code — no in-place edit guard was confirmed in the audited code paths.

5. **`shipment_booked` boolean sync:** Is the boolean `production_orders.shipment_booked`
   always set atomically with the status transition to `'shipment_booked'`?
   [Needs confirmation]

6. **`production_delayed` transition back:** Once at `production_delayed`,
   can the order go back to `in_production`? The transition table allows
   free-form status changes via `updateProductionOrderStatus` but the flow
   diagram implies forward-only. [Needs confirmation in practice]

7. **Versioning + task list linkage:** When a quotation is versioned (m059),
   does the task list link to the specific version that was won, or to the
   root? [Needs confirmation — `generateProductionTaskList` links by
   `quotation_id`, which is the specific document's UUID]

8. **`validated_at` / `validated_by` columns:** `validateTaskList` stamps
   `validated_at` and `validated_by` on the task list row. Are these columns
   part of `ProductionTaskList` type in `lib/types.ts`? They appear in the
   action's patch object but are not in the exported type. [Needs confirmation
   — check if migration added them without a matching type update]

---

*Last verified against code: 2026-05-30.
To update: re-read the primary source files listed at the top of this document,
then update the relevant sections and the "Last verified" date.*
