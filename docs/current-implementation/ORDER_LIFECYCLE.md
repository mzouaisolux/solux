# Order Lifecycle — Current Implementation

> **Audit note.** Grounded in `lib/lifecycle.ts` (semantic layer +
> `computeOrderFlightStage`), `lib/production-lifecycle.ts` (baseline/delay),
> `lib/delays.ts`, `lib/types.ts` (raw enums), and
> `supabase/migrations/023_lifecycle_propagation.sql` (cancellation triggers).
> "Confirmed by code" = directly in those files. Step-transition **owners** are
> tagged Assumed-from-code where the gating role is inferred from
> `requireTaskListManagerOrAdmin` / capability keys rather than a single
> explicit map.

---

## 1. The three entities

An "order" is the union of three rows, each with its own status enum
(`lib/types.ts`):

```
documents (quotation) ──► production_task_lists ──► production_orders
   DocStatus               ProductionTaskListStatus    ProductionOrderStatus
```

`lib/lifecycle.ts` is the **semantic layer**: instead of comparing raw statuses
inline, the app asks `isDocActive`, `isTaskListCancelled`, `isPOTerminal`, etc.
`computeOrderFlightStage()` collapses all three into **one** operational stage.

---

## 2. The unified 6-phase "flight" strip (Confirmed by code)

`ORDER_FLIGHT_PHASES` (`lib/lifecycle.ts`):

```
0 Quote → 1 Task list → 2 Payment → 3 Production → 4 Shipping → 5 Delivered
```

`computeOrderFlightStage(o)` resolves the **most advanced** signal:
production-order status first, then task-list status, then "won but nothing
started". Mapping (verbatim from code):

| Source status | Phase | Label | Tone |
|---|---|---|---|
| PO `delivered` | 5 | Delivered | emerald |
| PO `shipped` | 4 | In transit | violet |
| PO `shipment_booked` | 4 | Shipment booked | violet |
| PO `production_completed` | 4 | Production complete | emerald |
| PO `production_delayed` | 3 | Production delayed | red |
| PO `in_production` | 3 | In production | amber / red if late |
| PO `production_scheduled` | 3 | Production approved | sky |
| PO `deposit_received` | 3 | Deposit received | sky |
| PO `awaiting_deposit` | 2 | Awaiting deposit | amber |
| TL `production_ready` | 2 | Production ready | sky |
| TL `validated` | 2 | Task list validated | sky |
| TL `under_validation` | 1 | Under task list review | amber |
| TL `needs_revision` | 1 | Needs revision | red |
| TL `draft` | 1 | Task list draft | neutral |
| TL `cancelled` | 1 | Task list cancelled | neutral |
| (won, nothing started) | 1 | Awaiting task list | neutral |

> **Note (Confirmed by code):** `production_completed` maps to **phase 4
> (Shipping)**, not phase 3 — once manufacturing is done the order is
> considered "in the shipping phase". And `deposit_received` maps to phase **3
> (Production)**, not phase 2 (Payment) — receiving the deposit advances the bar
> into Production. These are intentional but non-obvious; document carefully
> before changing.

---

## 3. Step-by-step lifecycle

### 3.1 Quotation / document (`DocStatus`)

```
draft → sent → negotiating → won
                    │            └─► (kicks off the task-list phase)
                    └─► lost      (dead)
  any → cancelled               (dead)
```

| Transition | Who (Assumed from code) | Notes |
|---|---|---|
| create `draft` | sales (`quotation.create`) | `/documents/new` |
| `draft → sent` | sales | "send" the quotation |
| `sent → negotiating` | sales | negotiation in progress |
| → `won` | sales | deal won (basis for task list) |
| → `lost` | sales | dead deal |
| → `cancelled` | sales owner / admin (`quotation.cancel`) | cascades down (see §5) |

- `DOC_ALIVE_STATUSES = [draft, sent, negotiating, won]`;
  `DOC_DEAD_STATUSES = [lost, cancelled]`;
  `DOC_PIPELINE_STATUSES = [sent, negotiating]`.
- **`isDocCancelled` treats `lost` AND `cancelled` as cancelled** — and m023's
  trigger cascades `lost → cancelled` on the task list + PO.
- **Advisory validation loop (m068, `lib/validation.ts`)** runs *alongside* the
  doc status: `none → pending → approved | rejected → (revise) → pending`. It is
  **advisory only — a quote can be sent/won regardless of validation state**.
  ⚠️ This "validation" is a different concept from **task-list** validation
  (§3.2) — see POTENTIAL_INCONSISTENCIES.md.

### 3.2 Production task list (`ProductionTaskListStatus`)

> **Trigger to enter this phase:** the document being **won**. The flight-stage
> fallback "Awaiting task list — Deal won, task list not started yet" implies
> the task list is **NOT auto-created on win** — a user creates it. Whether any
> path auto-creates it is **Needs confirmation**.

```
draft → under_validation → validated → production_ready
            │      ▲
            ▼      │
       needs_revision (back to sales)
  any → cancelled
```

| Transition | Who (Confirmed/Assumed) | Notes |
|---|---|---|
| create / edit `draft` | sales (configures), then submits | `TASK_LIST_LOCKED_FOR_SALES` once `under_validation`+ |
| `draft → under_validation` | sales requests review | enters `TASK_LIST_TLM_QUEUE` |
| `under_validation → validated` | TLM / operations (`task_list.validate`, `requireTaskListManagerOrAdmin`) | **Confirmed by code** (guard) |
| `under_validation → needs_revision` | TLM / operations (`task_list.reject`) | sent back to sales |
| `validated → production_ready` | TLM / operations | release to production |
| → `cancelled` | gated; cascades to PO | |

- `TASK_LIST_PRODUCTION_STATUSES = [validated, production_ready]` — the point at
  which a production order becomes usable (`OrdersInFlight.resolveOrderRowHref`,
  `lib/lifecycle.ts`).
- Factory **overrides/extras** (m071) edited here never overwrite the sales
  configuration (standing product rule).

### 3.3 Production order (`ProductionOrderStatus`)

```
awaiting_deposit → deposit_received → production_scheduled → in_production
                                                                 │
                                              (production_delayed)│
                                                                 ▼
                              production_completed → shipment_booked → shipped → delivered
  any → cancelled
```

| Transition | Who (Assumed from code → capability) | Notes |
|---|---|---|
| create (`awaiting_deposit`) | when TL is `validated`/`production_ready` | exact auto/manual creation **Needs confirmation** |
| record deposit → `deposit_received` | ops (`production_order.edit_payments`) | **activation** event |
| start without deposit | ops (`production_order.start_without_deposit`, m025) | sets `deposit_override_at`; **activation** event |
| set timeline / `production_scheduled` | ops (`production_order.set_timeline`) | stamps `initial_production_deadline` at activation |
| `→ in_production` | ops (`production_order.edit_status`) | |
| `→ production_delayed` | ops, or implied by deadline change | a delay event (m073) moves `current_production_deadline` |
| `→ production_completed` | ops | stamps `actual_completion_date` (Assumed) |
| `→ shipment_booked` | ops (`production_order.edit_shipment`) | |
| `→ shipped` | ops | ETD/ETA columns |
| `→ delivered` | ops | terminal success |
| `→ cancelled` | gated | terminal dead |

- `PO_ACTIVE_STATUSES = [awaiting_deposit, deposit_received,
  production_scheduled, in_production, production_delayed]`;
  `PO_SHIPPING_STATUSES = [production_completed, shipment_booked, shipped]`;
  `PO_TERMINAL_STATUSES = [delivered, cancelled]`;
  `PO_CLOSED_SUCCESS_STATUSES = [delivered]`.

---

## 4. Production baseline & delay model (Confirmed by code)

`lib/production-lifecycle.ts`:

- **Production start date** = `deposit_received_at` ?? date(`deposit_override_at`).
  NULL until production activates.
- **Activation** = deposit fully received OR start-without-deposit override.
- **Initial Project Completion** = `start_date + production_working_days`
  (working days, weekends excluded via `lib/working-days.ts addWorkingDays`),
  **stamped once at activation** into the stored column
  `initial_production_deadline`, then **frozen** (read via
  `getInitialProjectCompletion`, never recomputed).
- **Baseline lock**: `baseline_locked_at` is stamped at activation; before
  activation `working_days` stays editable. `isBaselineLocked` also treats any
  active order as locked (legacy safety net).
- **Operational delay** = `current_production_deadline − initial_production_deadline`
  (`computeBaselineDelay`, equivalent to `computeProductionDelay` in
  `lib/types.ts`). NULL until activation.
- **Lifecycle phase** (`getLifecyclePhase`): `closed` (cancelled/archived) →
  `completed` (`actual_completion_date` set) → `in_production` (active) →
  `awaiting_start`.

### 4.1 Delay categorization (m072–m074, `lib/delays.ts`)
- Each delay is a **row in `production_deadline_changes`** with a `delay_type`
  and `days_added` (additive — never overwrite the deadline manually).
- `DelayType`: `production` | `payment` | `shipping` | `client_change` |
  `client_waiting` | `supplier` | `customs` | `other`.
- **Only `delay_type='production'` (or NULL legacy) counts toward the factory
  KPI** (`isFactoryDelay`). External delays surface amber but don't poison
  factory performance. `computeDelayBreakdown` → `{factoryDays, externalDays,
  latestType, changeCount}`.
- Delay events are **editable but audit-logged** (`updated_by`/`updated_at`,
  m074) — an explicit product decision over strict immutability.

> **May 2026 revision (Confirmed by code comment):** baseline locks at
> **production activation**, NOT at first `working_days` save. The old
> `validation_date + working_days` formula was wrong for the Solux workflow
> (production starts after deposit, not at validation).

---

## 5. Cancellation propagation (Confirmed by code — m023 + `CASCADE_RULES`)

DB triggers (`trg_propagate_doc_cancellation`,
`trg_propagate_task_list_cancellation`) are the **source of truth**;
`CASCADE_RULES` in `lib/lifecycle.ts` mirrors them for UI confirm dialogs:

| Cancel this | Also cancels | Skip if target already |
|---|---|---|
| document | every linked **task list** | `cancelled` |
| document | every linked **production order** | `cancelled`, `delivered` |
| task list | its **production order** | `cancelled`, `delivered` |

- A **delivered** PO is never auto-cancelled by an upstream cancellation.
- Cancellation fires regardless of which code path issued the status update
  (the trigger guarantees consistency even for direct SQL).

---

## 6. UI ↔ DB status inconsistencies (for the audit)

1. **`production_status` is a query alias, not a column.** The real column is
   `production_orders.status`. `OrderInFlight`/`OrderStageInput` use
   `production_status`; the DB stores `status`. Any raw query that selects
   `production_status` directly would fail — it must alias `status AS
   production_status`. **Confirmed by code** (`lib/lifecycle.ts`,
   `components/dashboard/OrdersInFlight.tsx`). See
   POTENTIAL_INCONSISTENCIES.md.
2. **Two different "validated/validation" meanings.** Documents have an
   *advisory* validation (`validation_status` pending/approved/rejected, m068);
   task lists have a *workflow* validation (`under_validation`/`validated`).
   They are unrelated but share the word "validation". **Confirmed by code.**
3. **"Completed" defined two ways.** `getLifecyclePhase` marks `completed` when
   `actual_completion_date` is set; `computeOrderFlightStage` shows
   "Production complete" on PO status `production_completed` (phase 4). A PO
   could in principle have one without the other. **Suspected** — reconcile.
4. **`deposit_received` advances the flight bar to Production (phase 3),** while
   `awaiting_deposit` sits at Payment (phase 2). Intentional but easy to
   misread as "payment phase still". **Confirmed by code.**
5. **Task-list creation on Won is not proven automatic.** The "Awaiting task
   list" fallback implies a manual step. **Needs confirmation.**
