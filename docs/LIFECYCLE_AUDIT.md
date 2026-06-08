# SOLUX — Quotation → Order → Production → Shipping Lifecycle Audit

**Audit date:** 2026-06-01
**Type:** READ-ONLY audit. No code was modified, run, or built. Findings cite exact files (with line numbers where useful) and are marked **Confirmed** (verifiable in a cited file) or **Suspected** (inferred behavioural consequence).

This audit documents the **current** quotation→order→production→shipping lifecycle of the SOLUX app (Next.js 14 + Supabase) and surfaces material inconsistencies across four layers — **UI** (what the screens show/allow), **business-rules** (intended/owner rules), **DB** (schema, CHECK constraints, RLS, FK cascades), and **automation** (triggers, server-action side effects, derived/computed logic, `emitEvent`).

It reflects the current code **including two recent changes made this session:**

1. **The BL fix** — `lib/action-center.ts` `blIsFilled()` now reads `forwarder` / `vessel` (not `forwarder_name` / `vessel_name`), so entering forwarder/vessel correctly self-clears the "BL missing" action card.
2. **The deletion lockdown** — `deleteQuotation` in `app/(app)/documents/[id]/actions.ts` now blocks delete when a task list / production order exists and restricts won-delete to admins; migration `078_quotation_delete_lockdown.sql` tightens delete RLS.

An "order" in SOLUX is not one record. It spans three linked rows — **documents** (the quotation) → **production_task_lists** → **production_orders** — then shipping and delivery layered onto the production order. Each row has its own status enum. `lib/lifecycle.ts` is the semantic layer that collapses the three into a single user-facing strip.

---

## 1. Quick reference

### 1.1 The six-phase flight strip

`computeOrderFlightStage()` (`lib/lifecycle.ts:307-355`) resolves the three entity statuses into one 6-phase strip, choosing the **most-advanced** signal (PO status → TL status → "won, nothing started"):

| Phase | Label (typical) | Driven by |
|-------|-----------------|-----------|
| 0 | Quote | document not yet won |
| 1 | Task list (Awaiting task list) | won, no task list / TL in draft–needs_revision |
| 2 | Payment (awaiting deposit) | TL validated/production_ready; PO awaiting_deposit |
| 3 | Production | PO `deposit_received` … `in_production` |
| 4 | Shipping | PO `production_completed` / `shipment_booked` / `shipped` |
| 5 | Delivered | PO `delivered` |

Two mappings are intentionally non-obvious: `deposit_received` → phase 3 (Production), and `production_completed` → phase 4 (Shipping) (`lib/lifecycle.ts:322-333`).

### 1.2 The three status enums (plus a fourth, deliberately unsynced)

| Entity | Column | Values | Source |
|--------|--------|--------|--------|
| documents | `status` | draft, sent, negotiating, won, lost, cancelled | m008 + m017; `lib/types.ts:852` |
| production_task_lists | `status` | draft, under_validation, needs_revision, validated, production_ready, cancelled | m009 → m013; `lib/types.ts:382` |
| production_orders | `status` | awaiting_deposit, deposit_received, production_scheduled, in_production, production_completed, production_delayed, shipment_booked, shipped, delivered, cancelled | m018; `lib/types.ts:491` |
| affairs (project) | `status` | lead, opportunity, quotation, negotiation, won, in_production, shipped, completed, lost, abandoned | m077; **NOT auto-synced to the entity statuses** |

---

## 2. Current behavior by area

> This section describes what the code does today. It is kept separate from the inconsistency register in §3.

### 2.1 Status machine

`lib/lifecycle.ts` is the semantic layer; `computeOrderFlightStage()` collapses the three entity statuses into the 6-phase strip. **Transition enforcement differs sharply by entity:**

- **Task lists DO enforce a transition graph.** Every transition runs through `transition()` with an `allowedFrom` guard plus a capability gate (`app/(app)/task-lists/[id]/actions.ts:594-771`).
- **Documents and production orders do NOT.** `updateDocumentStatus` (`app/(app)/documents/[id]/actions.ts:308`) and `updateProductionOrderStatus` (`app/(app)/production/orders/actions.ts:102`) only validate the value against the enum (no `allowedFrom`); both UIs render every enum value as a freeform jump (`components/InlineStatusSwitcher.tsx`, `app/(app)/production/orders/[id]/page.tsx:634`).

Cancellation cascades via DB triggers in m023 (mirrored by `CASCADE_RULES`, `lib/lifecycle.ts:214`); `isDocCancelled` treats `lost == cancelled` and the trigger cascades `lost`→`cancelled` downstream. The `production_status` / `task_list_status` names used in dashboard/operations feeds are **JS query aliases** (e.g. `app/(app)/operations/page.tsx:943` maps `production_status: o.status`); the real columns are `status`.

### 2.2 Draft

A quotation is born as a **draft** via the shared builder at `app/(app)/documents/new` (`NewDocumentForm` + `actions.ts` `saveDocument`). The page accepts three query params: `?edit=<id>` (edit-in-place, drafts only), `?revise=<id>` (m059 versioning) and `?affair=<id>` (m076, create inside a project). `saveDocument` has three branches:

- **edit_of** — UPDATE existing draft, guarded by `if src.status !== 'draft' throw` (lines 220-344); replaces `document_lines`/`document_containers` wholesale; never writes `affair_id` (so a draft's project link is preserved on edit).
- **revise_of** — INSERT a new `-V{n}` draft under the same affair root (lines 353-391), relying on the m076 trigger `affairs_inherit_from_root()` to inherit the affair via `root_document_id`.
- **default** — fresh insert.

Document duplication exists in two copies (`app/(app)/clients/actions.ts:55`, `app/(app)/dashboard/actions.ts:7`); only the clients one is wired (`ClientsWorkspaceList.tsx:766`). DB-side, the draft-only rule lives solely in the app action — documents UPDATE RLS (m046) is status-agnostic; only DELETE RLS (m078) is status-aware.

### 2.3 Won

When a quotation is marked **won**, **nothing is auto-created.** There is no DB trigger and no server-action side effect that spawns a task list or production order on win.

- The **task list** is created MANUALLY by sales clicking "+ Task list" (`DocQuickActions.tsx:75-85`) → `generateProductionTaskList` (`app/(app)/documents/[id]/actions.ts:194`), inserting a task list in status `draft`. The action center surfaces this as the sales to-do `won_no_tasklist` ("Create the production task list for this won deal", `lib/action-center.ts:241-245`).
- The **production order** IS auto-created, but only later: `ensureProductionOrderForTaskList` (`app/(app)/task-lists/[id]/actions.ts:415`) fires from `transition()` when a task list reaches `validated` or `production_ready`.

Won quotes are NOT edited in place (`edit_of` requires `status === 'draft'`); sent/won are revised into a new version (V2/V3) via `?revise=`. Cancellation from a won doc cascades via m023 triggers to task lists + POs (skipping cancelled/delivered POs). Deletion is locked down (`deleteQuotation`, `documents/[id]/actions.ts:525-549`; m078).

### 2.4 Production activation

Activation = first of **deposit fully received** (`updateProductionOrderPayments` auto-advance, `app/(app)/production/orders/actions.ts:583-640`) OR **admin override** (`startWithoutDeposit`, lines 1105-1212). At activation, three things stamp atomically: `status → deposit_received`, `baseline_locked_at = now` (m041), and `initial_production_deadline = current_production_deadline = addWorkingDays(start_date, production_working_days)`.

The Initial Project Completion is **frozen** (read from the stored column, never recomputed; `lib/production-lifecycle.ts:150-153`). Operational delay = `current − initial` (`computeBaselineDelay`, `lib/lifecycle.ts:220-233`). The live ETA is materialized as `current_production_deadline = initial + Σ days_added`, recomputed from the `production_deadline_changes` event stream on every add/edit/delete (`recomputeOrderDeadline`, `actions.ts:42-79`). Delay events (m072-074) carry `delay_type` + signed `days_added`; `isFactoryDelay` treats only `production` (and legacy NULL) as the factory KPI (`lib/delays.ts:79-82`).

### 2.5 Shipping / BL

Shipping has **NO single record** — data is split across three entities:

1. **Client:** `clients.bl_profile` jsonb (m054) holds shipper/consignee/notify parties + an export-document checklist + free-text notes, shaped only by `normalizeBlProfile` (`lib/bl.ts`).
2. **Quotation:** `documents.incoterm`, `freight_type`, `port_of_loading`, `port_of_destination` columns + container plan in `document_containers`. `freight_type` is auto-derived from containers (`legacyFreightType`, `app/(app)/documents/new/actions.ts:163`).
3. **Production order:** `production_orders.shipping_details` jsonb (m070) holds bl_number/forwarder/vessel/voyage/weights/cbm/packages/hs_code, shaped only by `normalizeShippingDetails` (`lib/shipping.ts`); ETD/ETA/shipment_booked/shipping_notes stay separate columns.

The Action Center drives a `bl_missing_destination` card: `blRequired()` fires for incoterm CFR/CIF/DDP/DDU or freight_type LCL; `blIsFilled()` self-clears it once `consignee.company_name` or `shipping_details.forwarder/vessel/bl_number` is set. **This session's fix** corrected `blIsFilled` to read `forwarder`/`vessel` (was `forwarder_name`/`vessel_name`).

### 2.6 Completion

"Completion" of a production order is defined **three** ways and is entirely app-layer driven (no DB trigger stamps it):

- **Phase** (`getLifecyclePhase`, `lib/production-lifecycle.ts:254-268`): "completed" ONLY when `actual_completion_date` is set; ignores `status`. Gates the Mark-Complete CTA.
- **Flight-stage** (`computeOrderFlightStage`, `lib/lifecycle.ts:322-323`; `WorkflowStepper buildLifecycleStages`, `:176-181`): "Production complete"/"done" purely on `status === 'production_completed'` (and the stepper marks Production "done" for any of production_completed/shipment_booked/shipped/delivered).
- **Pill** (`computeOrderPills`, `lib/order-pills.ts:108`): `completed = !!actual_completion_date || status === 'production_completed'`.

The two fields are kept in sync by two writers: `markProductionComplete` sets BOTH; `updateProductionOrderStatus` auto-stamps `actual_completion_date` only when flipping TO `production_completed` and only if not already set (`actions.ts:124-126`). Terminal PO statuses are `delivered`/`cancelled`; `PO_CLOSED_SUCCESS_STATUSES = [delivered]` (`lib/lifecycle.ts:139-148`). No DB CHECK links `status` to `actual_completion_date`.

### 2.7 Notifications

Five surfaces:

1. **Bell** (`lib/notifications.ts` `getNotificationSummary`) — items built ONLY from unread `event_comments` authored by others since the user's `event_reads.last_read_at`, plus one aggregate "N task lists awaiting review" for technical roles. It does NOT fire on event creation.
2. **Operations feed** (`listOperationsFeed`, `lib/events.ts:289`) — reads the immutable `events` table, ordered severity→status→recency.
3. **Action Center** (`lib/action-center.ts`) — derives live signals → materialize → filterByRole → applyAcks (`action_acks`/m069) → attachNotes. Kinds include tl_validate, tl_clarify, doc_validate, deposit, production_late, missing_deadline, won_no_tasklist, bl_missing_destination, info.
4. **Conversation drawer** — `entity_messages`, a separate table/drawer with no event/bell link.
5. **Reminders/alerts.**

Events are emitted by `emitEvent` (`lib/events.ts:126`), always called with `bestEffort: true`, so a failed insert is swallowed. Cancellation cascade events are written by the DB trigger (m023), not the server action. Posting a comment or an entity_message creates no targeted notification — the bell is purely pull-derived on next SSR render.

### 2.8 Task list

A task list is created from a won quotation (`app/(app)/documents/[id]/actions.ts:256-268`) with status `draft`, inheriting the quote number as `PTL-<num>`. The workflow enum is `draft → under_validation → needs_revision → validated → production_ready → cancelled`. The live DB CHECK (m013) matches the TS enum.

Transitions go through `transition()` (`app/(app)/task-lists/[id]/actions.ts:595-670`): validate `allowedFrom`, patch status, stamp `submitted_at` or `validated_at`+`validated_by`, auto-create the linked production order when landing on validated/production_ready (`ensureProductionOrderForTaskList`), and emit a `tl.*` event. Each public action is capability-gated (task_list.validate, task_list.reject, task_list.delete, task_list.archive, task_list.sync_orphans — **all seeded in m026/m053**). Sales edits are blocked once status is in `TASK_LIST_LOCKED_FOR_SALES` (under_validation/validated/production_ready/cancelled); technical roles (incl. operations) bypass via `isTechnicalRole`.

---

## 3. Consolidated inconsistency register

Ordered by severity (Critical → Low). Each entry uses the verifier's **corrected severity** and lists only findings the verifier judged **REAL**. Two findings the verifier judged `isReal=false` were dropped (see §3.x note). All recommendations are **clarify-only**: no code change is proposed in this audit.

---

### HIGH

#### H1. A won quotation can be reverted (won→draft/sent) and edited, with no guard
- **Layers in disagreement:** UI · business-rules · automation · DB
- **Severity:** High · **Confirmed** · **REAL**
- **What:** The "Other status" switcher on the won document page renders bare `<form action={updateDocumentStatus}>` buttons for every status except `won` and the current one (`app/(app)/documents/[id]/page.tsx:691-701`), including `draft` and `sent`. `updateDocumentStatus` (`documents/[id]/actions.ts:308`) only capability-gates the `cancelled` transition; it imposes NO guard on moving a won doc backward and does not check for an existing task list/PO. Reverting to `draft` re-enables edit-in-place (`documents/new/actions.ts:228` only requires `status === 'draft'`), letting commercial figures (lines, price, incoterm, ports) be rewritten AFTER a task list / PO was generated from the original won quote — silently de-syncing the quotation from the downstream production records that copied its lines. The m078 deletion lockdown protects DELETE but not this status-revert+edit backdoor.
- **Files:** `app/(app)/documents/[id]/page.tsx`, `app/(app)/documents/[id]/actions.ts`, `app/(app)/documents/new/actions.ts`
- **Clarify-only next step:** Ask the owner whether a won quotation (especially one with a linked task list/PO) should be revertible to draft/sent and re-editable. If not, audit whether `updateDocumentStatus` / the switcher should block won→draft (or won→anything-but-cancelled) when a task list or PO exists, mirroring the `deleteQuotation` guard.

#### H2. Reopening a lost/cancelled quotation does not un-cancel the cascaded task list / PO
- **Layers in disagreement:** business-rules · DB · automation · UI
- **Severity:** High · **Suspected** · **REAL**
- **What:** The m023 triggers fire ONLY on a transition INTO `cancelled`/`lost` (`propagate_document_cancellation` returns early otherwise) and cascade children to cancelled. Because document status is freeform (M1), a user can move a doc back from cancelled/lost to won/negotiating, but nothing reverses the children — the linked task list and PO stay cancelled. The order is then resurrected at the document layer while its production entities are dead, the exact inconsistency the cascade was built to prevent. `CASCADE_RULES` documents only the forward direction; there is no un-cancel path, and `InlineStatusSwitcher` renders all six statuses with no guard when the current status is cancelled/lost.
- **Files:** `supabase/migrations/023_lifecycle_propagation.sql`, `lib/lifecycle.ts:214`, `app/(app)/documents/[id]/actions.ts:308`, `components/InlineStatusSwitcher.tsx:92`
- **Clarify-only next step:** Reproduce: cancel a quotation with a live task list+PO, then switch the doc back to won; confirm children remain cancelled. Clarify with owner whether re-opening should be blocked or should restore children.

#### H3. Cancellation cascade from a won doc fires with no UI confirmation or cascade warning
- **Layers in disagreement:** UI · automation · business-rules
- **Severity:** High · **Confirmed** · **REAL**
- **What:** Cancelling a won quotation triggers a critical cascade (m023 `trg_propagate_doc_cancellation`: cancels every linked task list and every non-delivered PO). The codebase HAS the machinery to warn users — `CASCADE_RULES` + `describeCascade` (`lib/lifecycle.ts:214-241`, comment: "used in confirmation dialogs") and a dedicated `cancelQuotation` action that records a reason (`documents/[id]/actions.ts:380`) — but neither is wired into any UI (both are dead code, referenced only inside their defining files). In practice cancellation is issued through the unguarded "Other status" → "Cancelled" button (`page.tsx:694-700`) calling `updateDocumentStatus` with NO `confirmMessage` and NO cascade disclosure. A single misclick on a won deal silently cancels its task list and in-flight production order. (Contrast: Delete has a `confirmMessage` at `page.tsx:774`.)
- **Files:** `app/(app)/documents/[id]/page.tsx`, `app/(app)/documents/[id]/actions.ts`, `lib/lifecycle.ts`, `supabase/migrations/023_lifecycle_propagation.sql`
- **Clarify-only next step:** Clarify whether cancelling a won/in-production quotation should require an explicit confirm showing the cascade (`describeCascade` text already exists). Audit why `CASCADE_RULES`/`describeCascade`/`cancelQuotation` are dead while the unguarded path is live.

#### H4. start_without_deposit authorization (Decision H.10/H.14) is not enforced — reason optional, no approval/guarantee gate
- **Layers in disagreement:** business-rules · automation · UI · (DB schema gap)
- **Severity:** High · **Confirmed** · **REAL**
- **What:** Owner rule H.10/H.14 (`docs/audit-editable/OWNER_DECISIONS_LOG.md:231-240`, `BUSINESS_RULES.md:977`) requires starting-without-deposit to be exceptional and explicitly authorized — store reason, approved-by, approved-at, and a payment guarantee, with finance approval when risk is high, "must not be set casually." The code (`startWithoutDeposit`, `app/(app)/production/orders/actions.ts:1105-1212`) gates only on capability `production_order.start_without_deposit` (admin/super_admin per m026), treats reason as fully optional (`str(formData,'reason')` → null allowed; UI labels it "optional but recommended", `StartWithoutDepositButton.tsx:90`), records no separate approver/guarantee fields beyond `deposit_override_by/at`, and has no second-approval or finance step. The DB (m025) has no `payment_guarantee` or `finance_approved_by/at` columns. An admin can override with zero justification.
- **Note:** H.14 in `BUSINESS_RULES.md:977` is flagged "Needs my confirmation" — the full H.10 policy is not yet ratified, so remediation scope depends on owner sign-off. High severity reflects the genuine cash-flow/production risk H.10 describes.
- **Files:** `app/(app)/production/orders/actions.ts:1105-1169`, `components/StartWithoutDepositButton.tsx:33-100`, `docs/audit-editable/OWNER_DECISIONS_LOG.md:231-240`, `docs/audit-editable/BUSINESS_RULES.md:977`, `supabase/migrations/025_deposit_override.sql:26-33`
- **Clarify-only next step:** Confirm with owner whether reason must be mandatory and whether a distinct approver/guarantee capture or finance sign-off is required; confirm whether capability-only gating satisfies H.10.

#### H5. Two divergent definitions of "completed" can disagree on the same PO
- **Layers in disagreement:** UI · business-rules · automation · DB
- **Severity:** High · **Confirmed** · **REAL**
- **What:** `getLifecyclePhase` returns "completed" ONLY on `actual_completion_date` (`lib/production-lifecycle.ts:265`), while `computeOrderFlightStage` (`lib/lifecycle.ts:322`) and `WorkflowStepper buildLifecycleStages` (`:176-181`) show "Production complete"/"done" purely on `status === 'production_completed'`. The status chip strip renders every PRODUCTION_ORDER_STATUS as a one-click flip (`production/orders/[id]/page.tsx:634-668`), so an operator can flip FORWARD to `shipment_booked`/`shipped`/`delivered` directly from `in_production`, skipping `production_completed`, so `actual_completion_date` is never stamped. Result: dashboard/stepper show the order as shipped/delivered ("done"), yet `getLifecyclePhase` still returns "in_production", so the PO detail page still offers the "Mark production complete" CTA on an order that has already shipped — and clicking it regresses status from `shipped` back to `production_completed`. The two screens disagree about whether the same order is done.
- **Files:** `lib/production-lifecycle.ts`, `lib/lifecycle.ts`, `components/WorkflowStepper.tsx`, `app/(app)/production/orders/[id]/page.tsx`, `app/(app)/production/orders/actions.ts`, `components/MarkProductionCompleteButton.tsx`, `components/production/DelayTimelineCard.tsx`
- **Clarify-only next step:** Owner to confirm the single intended meaning of "production complete" (status vs `actual_completion_date`), and whether forward status jumps that bypass `production_completed` should be allowed at all.

#### H6. PO can hold status=production_completed with NULL actual_completion_date (and vice-versa) — no DB/trigger guarantees the pairing
- **Layers in disagreement:** DB · automation · business-rules · UI
- **Severity:** High · **Confirmed** · **REAL**
- **What:** Nothing at the DB layer ties `status` to `actual_completion_date` (m018 defines both independently; no migration trigger ever writes `actual_completion_date`). The pairing is enforced ONLY in two TS writers. So legacy/backfilled rows or a direct DB edit can be `production_completed` with NULL completion date, and the inverse is also reachable: `updateProductionOrderDeadline` (`actions.ts:265-267`) accepts `actual_completion_date` without touching `status`, so an order can carry a completion date while still `in_production`. Consequence: `order-pills` (`lib/order-pills.ts:108`) and `operations-alerts` (`lib/operations-alerts.ts:140-141`) and `computeOrderFlightStage` treat such rows as completed, while `getLifecyclePhase` returns the opposite — contradictory operational signals and a re-offered Mark-Complete CTA.
- **Files:** `supabase/migrations/018_production_orders.sql`, `app/(app)/production/orders/actions.ts`, `lib/production-lifecycle.ts`, `lib/lifecycle.ts`, `lib/order-pills.ts`, `lib/operations-alerts.ts`
- **Clarify-only next step:** Owner to clarify whether `status=production_completed` and `actual_completion_date` must always coexist, and whether `updateProductionOrderDeadline` should be allowed to stamp a completion date without flipping status. Quantify existing mismatched rows before deciding on a constraint/trigger.

#### H7. High/critical events never raise the bell unless someone comments
- **Layers in disagreement:** UI · automation · business-rules
- **Severity:** High · **Confirmed** · **REAL**
- **What:** The bell (`lib/notifications.ts`) is driven exclusively by unread `event_comments` plus the TLM review aggregate. `emitEvent` inserts an `events` row but creates NO comment and NO targeted notification. So operationally important transitions that DO emit events — e.g. `tl.validated`/`tl.production_ready` (which create the awaiting-deposit PO and hand the next step to Sales), `doc.validation_requested`/`doc.validation_rejected` (severity 'high'), `po.cancelled`/`doc.cancelled` (critical), `po.deadline_changed` (high) — produce zero bell signal for the people who need to act. A salesperson learns a task list was validated only via the Action Center deposit card or by visiting the feed, never via the bell. `NOTIFICATION_SYSTEM.md` §2/§7.1 acknowledge this.
- **Files:** `lib/notifications.ts`, `lib/events.ts`, `app/(app)/dashboard/event-actions.ts`, `docs/current-implementation/NOTIFICATION_SYSTEM.md`
- **Clarify-only next step:** Clarify whether event CREATION (by type/severity, e.g. high+ or `validation_requested`) should surface in the bell, or whether the bell is intentionally comments-only. Audit which transitions the team expects to be alerted on.

#### H8. Two discussion systems; only event_comments feeds the bell — entity_messages never notifies
- **Layers in disagreement:** UI · automation · business-rules
- **Severity:** High · **Confirmed** · **REAL**
- **What:** `event_comments` (tied to a specific event, opened via the bell's `?event=` drawer) and `entity_messages` (tied to an entity, opened via the global ConversationDrawer) are different tables and different drawers. Only `event_comments` is read by `getUnreadCommentCountsForUser`, so a message written in the entity_messages drawer raises NO bell count and no unread indicator anywhere for the recipient (`app/(app)/_actions/entity-messages.ts` design comment: posting "does NOT emit an event"). A user can hold an entire conversation in one system while the other party watches the wrong one. There is no cross-linking and no canonical-system rule.
- **Files:** `lib/entity-messages.ts`, `app/(app)/_actions/entity-messages.ts`, `lib/notifications.ts`, `components/chat/ConversationDrawer.tsx`, `docs/current-implementation/NOTIFICATION_SYSTEM.md`
- **Clarify-only next step:** Owner decision on which discussion mechanism is canonical and whether `entity_messages` should generate unread/bell signals. Document the intended use of each drawer.

---

### MEDIUM

#### M1. Document status is fully freeform — neither UI nor DB enforces the documented state machine
- **Layers in disagreement:** UI · business-rules · DB
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** `ORDER_LIFECYCLE.md` §3.1 documents a directed flow (draft→sent→negotiating→won; →lost; any→cancelled). In reality there is no enforcement: the DB CHECK (m017) only validates the value set, `updateDocumentStatus` has no `allowedFrom` guard (it only capability-gates `cancelled`), and `InlineStatusSwitcher` renders all six statuses as a freeform `<select>`. A user can jump cancelled→won, won→draft, lost→sent, etc. The documented arrows are advisory only — contrasting with task lists, which DO enforce `allowedFrom` in `transition()`. Illegal/backwards sales transitions are silently accepted and emit a normal `doc.status_changed` event.
- **Files:** `app/(app)/documents/[id]/actions.ts:308`, `components/InlineStatusSwitcher.tsx:92`, `supabase/migrations/017_extend_document_statuses.sql`, `docs/current-implementation/ORDER_LIFECYCLE.md`
- **Clarify-only next step:** Clarify with owner whether document transitions should be a true state machine (define legal edges) or remain freeform by design.

#### M2. Production-order status is fully freeform (any→any), unlike the task-list state machine
- **Layers in disagreement:** UI · business-rules · DB · automation
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** `updateProductionOrderStatus` explicitly states "no transition graph here — production teams sometimes need to skip steps" and only checks the enum; the PO detail page renders every one of the 10 statuses as a one-click "→ status" button for technical roles. A PO can jump awaiting_deposit→delivered, delivered→in_production (un-terminal a closed order), or shipped→awaiting_deposit. Only the auto-advance to `deposit_received` (on full deposit) and the dedicated `markProductionComplete` path apply any logic. The documented PO flow in `ORDER_LIFECYCLE.md` §3.3 is not enforced anywhere.
- **Files:** `app/(app)/production/orders/actions.ts:97`, `app/(app)/production/orders/[id]/page.tsx:634`, `supabase/migrations/018_production_orders.sql`, `docs/current-implementation/ORDER_LIFECYCLE.md`
- **Clarify-only next step:** Confirm with owner whether unrestricted PO status skipping is intended (the code comment claims it is). If so, document it as a rule; if not, decide which edges should be blocked.

#### M3. "Completed" is defined two ways and can diverge because of freeform PO status
- **Layers in disagreement:** business-rules · automation · UI
- **Severity:** Medium · **Suspected** · **REAL**
- **What:** `getLifecyclePhase` marks a PO "completed" only when `actual_completion_date` is set; `computeOrderFlightStage` shows phase-4 "Production complete" purely on `status === 'production_completed'`. `actual_completion_date` is auto-stamped only on two paths (`updateProductionOrderStatus` when it sets `production_completed`, and `markProductionComplete`). Because PO status is freeform, a technical user can click straight to `shipment_booked`/`shipped`/`delivered` from `in_production`, bypassing `production_completed` — the flight strip then shows phase 4/5 while `getLifecyclePhase` still returns "in_production". (Closely related to H5/H6; retained as a distinct observation of the flight-strip-vs-phase divergence.)
- **Files:** `lib/production-lifecycle.ts:254`, `lib/lifecycle.ts:307`, `app/(app)/production/orders/actions.ts:102`, `docs/current-implementation/POTENTIAL_INCONSISTENCIES.md`
- **Clarify-only next step:** Reproduce a jump `in_production→shipped` and compare the PO page lifecycle panel vs the Orders-in-flight strip. Clarify the single canonical "completed" definition with owner.

#### M4. Two divergent 'completed' notions — lifecycle phase (actual_completion_date) vs action-center (status='production_completed')
- **Layers in disagreement:** business-rules · automation · UI
- **Severity:** Medium · **Suspected** · **REAL**
- **What:** `getLifecyclePhase` keys completion on `actual_completion_date` (`lib/production-lifecycle.ts:265`); the action-center `production_late` sensor suppresses lateness on `status === 'production_completed'` (`lib/action-center.ts:600`), and post-production statuses like `shipment_booked`/`shipped` are neither terminal nor `production_completed`. An order at `status = "shipped"` with `actual_completion_date` set (the normal post-completion flow) will have `getLifecyclePhase` return "completed" while the action-center evaluates it as neither terminal nor `production_completed` — so the production sensor block is entered and `production_late`/`missing_deadline` signals could fire for an already-shipped order.
- **Files:** `lib/production-lifecycle.ts:254-268`, `lib/action-center.ts:579-600`, `app/(app)/production/orders/actions.ts:102-155`
- **Clarify-only next step:** Clarify the single canonical "production complete" signal and whether downstream statuses (shipped/delivered) should still count as completed; audit existing rows for `status='production_completed'` XOR `actual_completion_date` set.

#### M5. "Delivered" is a terminal success state but does not require/guarantee production completion
- **Layers in disagreement:** business-rules · UI · automation · DB
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** `PO_TERMINAL_STATUSES = [delivered, cancelled]` and `PO_CLOSED_SUCCESS_STATUSES = [delivered]` (`lib/lifecycle.ts:139-148`). An order can be flipped straight to `delivered` from the chip strip without ever passing `production_completed`, so `actual_completion_date` stays NULL. Surfaces then treat "delivered" via DIFFERENT signals: `OrdersInFlight` marks delivered if `production_status === delivered` OR `actual_completion_date` is set and renders "Delivered <actual_completion_date ?? eta>"; but `getLifecyclePhase` returns "in_production" for a delivered PO with no `actual_completion_date` (it treats only cancelled/archived as closed), so the PO detail still shows a live in-production timeline + Mark-Complete CTA alongside a "workflow closed" banner. The m023 cancellation cascade skip-list confirms `delivered` (not `production_completed`) is the protected terminal.
- **Files:** `lib/lifecycle.ts`, `lib/production-lifecycle.ts`, `components/dashboard/OrdersInFlight.tsx`, `app/(app)/production/orders/[id]/page.tsx`, `supabase/migrations/023_lifecycle_propagation.sql`
- **Clarify-only next step:** Owner to confirm whether reaching `delivered` should imply production complete (and back-stamp `actual_completion_date`), and whether `getLifecyclePhase` should treat `delivered` as a closed/terminal phase so the PO page stops offering Mark-Complete on delivered orders.

#### M6. Baseline lock is UI-only — setProductionTimeline can still mutate production_working_days after activation/lock
- **Layers in disagreement:** business-rules · automation · UI
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** After activation, `baseline_locked_at` is stamped and the UI hides the working-days edit form when `isBaselineLocked` is true (`page.tsx:863`). But `setProductionTimeline` (`actions.ts:730-865`) performs NO `isBaselineLocked` / `baseline_locked_at` check — it only requires capability `production_order.set_timeline` and unconditionally writes `production_working_days`. It guards only `initial_production_deadline` (written solely when not already set). m041 adds no CHECK/trigger/RLS to enforce the lock. A stale/crafted POST after activation can change `production_working_days` while the frozen `initial_production_deadline` stays put, desyncing the displayed "Working days" from the frozen Initial Project Completion. The "frozen" guarantee holds for the completion date but not for the inputs that produced it.
- **Files:** `app/(app)/production/orders/actions.ts:730-822`, `lib/production-lifecycle.ts:114-126`, `app/(app)/production/orders/[id]/page.tsx:863-911`
- **Clarify-only next step:** Confirm with owner that working_days must be hard-locked at activation; flag that the server action should reject edits when `isBaselineLocked`.

#### M7. production_late counts pure-external deadline drift as factory lateness via the overdueDays fallback
- **Layers in disagreement:** business-rules · automation
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** The factory-delay split correctly sums only `delay_type='production'` (and legacy NULL) into `factorySlip`, keeping external causes out of the factory KPI. But the lateness trigger is `lateBy = Math.max(factorySlip, overdueDays)` (`action-center.ts:620-628`), where `overdueDays` is simply `current_production_deadline < today`. `current_production_deadline` is the materialized ETA = initial + Σ **ALL** days_added including external ones (`recomputeOrderDeadline`, `actions.ts:42-79`). So an order whose ETA was pushed entirely by external delays (payment/shipping/customs), now past that pushed ETA while still in production, fires the `production_late` (factory) sensor with `overdueDays > 0` even though `factorySlip = 0` — exactly the KPI poisoning m072 set out to prevent.
- **Files:** `lib/action-center.ts:614-660`, `lib/delays.ts:79-82`, `app/(app)/production/orders/actions.ts:42-79`, `supabase/migrations/072_delay_categorization.sql:1-26`
- **Clarify-only next step:** Clarify with owner whether being past an externally-pushed ETA should count as factory lateness or surface as an external/amber signal; decide the intended semantics before any code change.

#### M8. Production order auto-creation timing diverges from where the UI implies the order "begins"
- **Layers in disagreement:** UI · automation · business-rules
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** The PO is auto-created by `ensureProductionOrderForTaskList` from `transition()` (`task-lists/[id]/actions.ts:643-645`), i.e. only when the TASK LIST reaches `validated`/`production_ready` (an operations/TLM action, not a sales/won action). Between win and TL validation there is no PO at all, while the order-flight bar shows "Awaiting task list"/phase 1 right after win. Additionally, `ensureProductionOrderForTaskList` can silently no-op/return null if the TL isn't yet validated, and the dedicated `syncOrphanProductionOrders` repair (`actions.ts:903`) exists precisely because this auto-create has historically produced a validated task list with NO linked PO — an inconsistency invisible in the UI.
- **Files:** `app/(app)/task-lists/[id]/actions.ts`, `components/WorkflowStepper.tsx`, `lib/lifecycle.ts`
- **Clarify-only next step:** Clarify the owner's intended PO-creation trigger point (currently TL validation, not win) and whether the gap between win and PO creation should be more explicit in sales-facing surfaces.

#### M9. Won-quote delete protection lives in two layers that can disagree at the edges
- **Layers in disagreement:** DB · automation · business-rules
- **Severity:** Medium · **Suspected** · **REAL**
- **What:** Deletion of a won/production-linked quotation is guarded in TWO places: the app action `deleteQuotation` blocks delete when any task list/PO exists and restricts won-delete to admins (`documents/[id]/actions.ts:525-549`), and m078 RLS restricts owner DELETE to draft/sent/negotiating while allowing admin/super_admin any status. The app action is the ONLY layer that checks downstream existence (m078 explicitly notes RLS "can't cheaply check downstream existence"). So an admin running DELETE outside the `deleteQuotation` action (raw SQL, the Supabase dashboard, a future bulk path) would satisfy RLS and trigger the `ON DELETE CASCADE` on `production_task_lists` (m009) and `production_orders` (m018), physically wiping production records — the exact outcome m078's comment warns about. The protection holds only as long as every delete funnels through `deleteQuotation`.
- **Files:** `app/(app)/documents/[id]/actions.ts`, `supabase/migrations/078_quotation_delete_lockdown.sql`, `supabase/migrations/009_families_config_and_task_lists.sql`, `supabase/migrations/018_production_orders.sql`
- **Clarify-only next step:** Clarify with owner whether the downstream-existence guard should also exist at the DB layer (e.g. a BEFORE DELETE trigger raising when a linked TL/PO exists). Audit whether any delete path other than `deleteQuotation` exists.

#### M10. A fourth status enum (affairs.status, m077) overlaps lifecycle vocabulary but is intentionally NOT synced to documents
- **Layers in disagreement:** business-rules · DB
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** m077 gives affairs an independent lifecycle (lead→opportunity→quotation→negotiation→won→in_production→shipped→completed, plus lost/abandoned). Several values collide semantically with `DocStatus` and `ProductionOrderStatus` (won, lost, in_production, shipped), but the migration is explicit that affair status is a one-time seed and is NOT kept in sync afterwards. The only write path is `setAffairStatus` (operator-triggered). This is by design, yet it creates a fourth, manually-maintained status surface that can drift arbitrarily from the document→task-list→PO truth (e.g. affair='completed' while its PO is still in_production), widening the "where is this order really" question the flight strip was meant to answer.
- **Files:** `supabase/migrations/077_affair_status_lifecycle.sql`, `supabase/migrations/076_affairs_foundation.sql`, `app/(app)/affairs/actions.ts`
- **Clarify-only next step:** Confirm with owner that affair status is meant to be operator-maintained and may legitimately disagree with the entity statuses; document the intended relationship (or lack thereof).

#### M11. Draft offers BOTH edit-in-place and "revise into new version" — the version model has no draft guard
- **Layers in disagreement:** UI · business-rules · automation
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** On a draft, the UI simultaneously offers "Continue editing" (`?edit=`, edit-in-place; `page.tsx:807`, correctly gated to draft) and "Edit → new version (revise)" (`?revise=`; `page.tsx:735-743`, NOT status-gated) plus "+ New version" in `QuotationVersionsPanel.tsx:89-93`. `saveDocument`'s `revise_of` path (`documents/new/actions.ts:353-391`) accepts a draft source (no status guard, unlike `edit_of`) and creates a second draft numbered `SLX-...-V2` while the original draft stays an unsent draft. Result: two parallel drafts for one affair that was never sent — V2 of something that has no V1 history, contradicting the m059 intent ("a client negotiates AFTER receiving a quotation").
- **Files:** `app/(app)/documents/[id]/page.tsx`, `components/documents/QuotationVersionsPanel.tsx`, `app/(app)/documents/new/actions.ts`, `supabase/migrations/059_quotation_versioning.sql`
- **Clarify-only next step:** Clarify with owner whether revising a DRAFT should be allowed at all; if not, audit where to add a status check (hide `?revise=` links + reject `revise_of` when `source.status === 'draft'`).

#### M12. Edit-in-place draft-only rule is enforced only in the app action, not in DB RLS
- **Layers in disagreement:** business-rules · DB · automation
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** `saveDocument` blocks editing a non-draft in place (`actions.ts:228`). But the documents UPDATE RLS policy (m046:325-335) is status-agnostic: any owner or technical role may UPDATE a document of ANY status, and `document_lines`/`document_containers` inherit the same scope (no `status='draft'` predicate). A direct PostgREST request (or any code path bypassing `saveDocument`) could mutate the lines/pricing of a sent or won quotation, bypassing the version-history rule the UI/action enforces. The draft-only invariant is app-action-deep only.
- **Files:** `app/(app)/documents/new/actions.ts`, `supabase/migrations/046_data_isolation_hardening.sql`
- **Clarify-only next step:** Audit whether the draft-immutability rule needs DB-level enforcement (e.g. a row-level UPDATE guard / trigger) or is acceptable as app-only. Clarify the threat model with owner.

#### M13. Duplicate skips the capability gate and audit event that the normal create path enforces
- **Layers in disagreement:** business-rules · automation
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** `saveDocument` gates creation with `requireCapability('quotation.create')` (`actions.ts:124`) and emits a `doc.created` event (`actions.ts:548`). Both `duplicateDocument` actions (`clients/actions.ts:55`, `dashboard/actions.ts:7`) insert a brand-new draft document with NO `requireCapability` check and NO `emitEvent` — so a duplicate-created quotation never appears in the events timeline/operations feed, and any role with RLS insert rights (`created_by = self`) can mint quotations via duplicate even if the create capability would normally deny it (RLS does not enforce the capability). Inconsistent gating + missing audit trail for a document-creating action.
- **Files:** `app/(app)/clients/actions.ts`, `app/(app)/dashboard/actions.ts`, `app/(app)/documents/new/actions.ts`
- **Clarify-only next step:** Clarify with owner whether duplicate must share `quotation.create` gating and emit `doc.created`; audit the capability/event gap as a parity item.

#### M14. shipping_details and bl_profile jsonb have NO DB-level validation — shape enforced only in app code
- **Layers in disagreement:** DB · automation · business-rules
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** Both `production_orders.shipping_details` (m070) and `clients.bl_profile` (m054) are bare jsonb columns with no CHECK/constraint/schema. Shape is enforced solely by `normalizeShippingDetails` (`lib/shipping.ts`) and `normalizeBlProfile` (`lib/bl.ts`) at read time. Any writer that bypasses these helpers (a script, an RPC, a future action, or a manual SQL/Supabase edit) can store arbitrary or misshaped keys, and readers will silently coerce or drop them. The BL action self-clear (`blIsFilled`) depends on exact key names in this unvalidated blob, so a key drift like the one just fixed (`forwarder_name` vs `forwarder`) recurs with zero DB or type-checker protection.
- **Files:** `supabase/migrations/070_shipping_bl_details.sql`, `supabase/migrations/054_client_bl_profile.sql`, `lib/shipping.ts`, `lib/bl.ts`, `lib/action-center.ts`
- **Clarify-only next step:** Clarify whether owner wants jsonb left schemaless (cheap to extend) or a guardrail added (a shared key-name constant reused by writer + `blIsFilled`, and/or a lightweight jsonb shape check).

#### M15. doc.lost cascade emits critical TL/PO cancellations while the parent doc.lost event is severity low
- **Layers in disagreement:** automation · DB · business-rules
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** `updateDocumentStatus` emits `doc.lost` with DEFAULT_SEVERITY 'low' (`events.ts:80`) — invisible to the dashboard "Recent critical events" widget and the high/critical filters. But the same status write fires the DB trigger `propagate_document_cancellation` (m023, which fires on `cancelled` OR `lost`), cancelling every linked task list and PO and inserting `tl.cancelled`/`po.cancelled` events at severity 'critical'. So marking a deal 'lost' silently kills its production and floods the feed with critical cancellations, while the originating action reads as a low-severity blip. (Note the asymmetry: the explicit `cancelQuotation` action passes severity 'critical', but the generic `updateDocumentStatus` 'lost' path does not.)
- **Files:** `app/(app)/documents/[id]/actions.ts`, `supabase/migrations/023_lifecycle_propagation.sql`, `lib/events.ts`
- **Clarify-only next step:** Clarify with owner whether 'lost' should cascade-cancel production at all (vs only 'cancelled'), and align the `doc.lost` event severity with the magnitude of its cascade.

#### M16. emitEvent is best-effort everywhere — swallowed failures leave silent gaps in the audit feed and bell
- **Layers in disagreement:** automation · DB
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** Every `emitEvent` call site in the four action files passes `bestEffort: true`. On insert failure `emitEvent` (`events.ts:142-159`) only `console.error`s and returns; the business mutation has already committed. A transition can succeed while producing NO events row — appearing in neither the operations feed nor (transitively) the bell, with no user-visible signal. The module docstring frames the event log as "the bedrock of what happened to this thing," yet that bedrock is allowed to silently drop rows. Contrast: m023's DB-trigger cascade events abort the transaction if they fail (durable), while all app-layer events are advisory.
- **Files:** `lib/events.ts`, `app/(app)/production/orders/actions.ts`, `app/(app)/task-lists/[id]/actions.ts`, `app/(app)/documents/[id]/actions.ts`
- **Clarify-only next step:** Clarify with owner which event types are audit-critical enough that emission failure should NOT be swallowed.

#### M17. emitEvent coverage gaps: several state-affecting transitions emit no event
- **Layers in disagreement:** automation · UI
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** Not every meaningful change produces an event. Confirmed gaps: (a) `eventTypeForTransition` returns null for the `draft` target, and `reopenForRevision` lands at `validated` (emitting `tl.validated`, not `tl.reopened`) — so the `tl.reopened` catalog type is effectively never emitted by the transition gateway; (b) task-list content edits (`updateRiskFlags`, `updateTaskListLine`/Technical/FactoryOverrides) change operational data with no event (only `updateStickerRequirements` emits `tl.header_changed`); (c) `updateProductionOrderShipment` only emits `po.shipment_updated` when booking/ETD/ETA changed — saving BL/consignee/forwarder/vessel details alone (`shipping_details`) emits nothing, so the very data the `bl_missing_destination` card watches changes invisibly to the feed.
- **Files:** `app/(app)/task-lists/[id]/actions.ts`, `app/(app)/production/orders/actions.ts`, `lib/events-shared.ts`
- **Clarify-only next step:** Owner to confirm the intended event-emission catalog vs the implemented call sites (especially reopen, shipping_details edits, TL line/risk edits). Decide whether `tl.reopened` should ever fire.

#### M18. operations role can edit the parent task list but not its LINES (RLS gap on production_task_list_lines)
- **Layers in disagreement:** UI · business-rules · DB
- **Severity:** Medium · **Confirmed** · **REAL**
- **What:** m046 widened the technical bucket to include `operations` on `production_task_lists`, `production_orders`, and `documents` — but did NOT touch the `production_task_list_lines` "task lines rw" policy, whose last definition (m012:118-149) grants access only to the doc creator OR roles in `('admin','task_list_manager')`. Meanwhile the app treats `operations` as a full technical role: `isTechnicalRole` returns true, the page renders the line editors and passes `technicalEditable={technical}`, and the line-edit actions gate on `requireTechnical()` (accepts operations). Consequence: an operations user (not the doc owner) sees the technical_values/factory_overrides/factory_extras editors and passes the app-layer check, but the UPDATE/INSERT is rejected by RLS at the DB — a confusing partial failure unique to operations.
- **Files:** `supabase/migrations/012_workflow_and_technical_fields.sql`, `supabase/migrations/046_data_isolation_hardening.sql`, `lib/types.ts`, `app/(app)/task-lists/[id]/page.tsx`, `app/(app)/task-lists/[id]/actions.ts`
- **Clarify-only next step:** Confirm with owner whether `operations` is intended to edit task-list line technical data. If yes, flag that the "task lines rw" policy needs `operations` added to match the m046 widening. Verify against the live policy before concluding.

---

### LOW

#### L1. FreightType union (LCL|20ft|40ft HC) omits the plain '40ft' that ContainerType and the DB CHECK both allow
- **Layers in disagreement:** business-rules · DB · automation
- **Severity:** Low (corrected from Medium) · **Confirmed** · **REAL**
- **What:** `lib/types.ts` `FreightType = 'LCL'|'20ft'|'40ft HC'` lacks the plain `'40ft'` present in `ContainerType` and in the `document_containers_container_type_check` (LCL,20ft,40ft,40ft HC). Since `documents.freight_type` is auto-derived as `validContainers[0].container_type` for a single container (via an `as any` cast), a single `'40ft'` container writes `freight_type='40ft'` — a value OUTSIDE the TS union. `documents.freight_type` has NO DB CHECK, so the out-of-union value persists silently. Current downstream consumers (PDF render, `blRequired` accepting `string|null`) handle it safely as a label, so runtime impact is limited.
- **Files:** `lib/types.ts`, `app/(app)/documents/new/actions.ts`, `supabase/migrations/004_logistics_and_contacts.sql`, `supabase/migrations/063_fix_container_type_check.sql`
- **Clarify-only next step:** Clarify with owner whether `freight_type` and `container_type` should share one vocabulary. Audit existing values for `'40ft'` to size the drift; decide whether to add `'40ft'` to the union or document the difference.

#### L2. blRequired LCL trigger reads documents.freight_type, which collapses to '40ft HC' on any multi-container quote — losing the LCL signal
- **Layers in disagreement:** business-rules · automation
- **Severity:** Low · **Suspected** · **REAL**
- **What:** `blRequired()` returns true when `freight_type === 'LCL'`, but `legacyFreightType` is hard-coded to `'40ft HC'` when there is more than one container (`documents/new/actions.ts:163-168`). So a quote whose container plan includes an LCL row alongside any other container persists `freight_type='40ft HC'`, not `'LCL'`. If incoterm is a non-shipping term (EXW/FOB), `blRequired` returns false and the BL/shipping-confirmation card never appears for that LCL shipment. Single-LCL-container quotes work; the gap is multi-row plans containing LCL (an atypical workflow).
- **Files:** `lib/action-center.ts`, `app/(app)/documents/new/actions.ts`
- **Clarify-only next step:** Clarify with owner whether LCL can co-exist with other container rows on one quote, and if so whether BL follow-up should still fire (deriving the LCL signal from the container rows directly rather than the collapsed `freight_type`).

#### L3. Shipping marks / case marks are not modeled anywhere in the shipping data
- **Layers in disagreement:** business-rules · UI · DB
- **Severity:** Low · **Confirmed** · **REAL**
- **What:** No `shipping_marks`/`case_marks` field exists in `BlProfile` (`lib/bl.ts`), `ShippingDetails` (`lib/shipping.ts`), or any migration. Shipping/case marks are a standard Bill-of-Lading element. The only place to record them today is free text: `bl_profile.notes` (client level) or `production_orders.shipping_notes` (order level) — unstructured and split between two notes fields with no guidance on which to use.
- **Files:** `lib/bl.ts`, `lib/shipping.ts`, `supabase/migrations/070_shipping_bl_details.sql`
- **Clarify-only next step:** Clarify with owner whether structured shipping marks are needed on the BL. If yes, decide its home (order `shipping_details` vs client `bl_profile`).

#### L4. No container↔order link: the actual loaded container(s) for a shipment are never recorded on the order
- **Layers in disagreement:** business-rules · DB · UI
- **Severity:** Low · **Confirmed** · **REAL**
- **What:** Containers are PLANNED on the quote (`document_containers`, m004) but `production_orders.shipping_details` has no container reference or field for the container/seal number actually loaded. The order records packages/cbm/weights but not which/how-many containers shipped, nor their numbers. The planned container set can diverge from what actually ships, with no order-side record to reconcile against. (`SHIPPING_PROCESS.md` independently labels this a suspected gap.)
- **Files:** `lib/shipping.ts`, `supabase/migrations/004_logistics_and_contacts.sql`, `supabase/migrations/070_shipping_bl_details.sql`
- **Clarify-only next step:** Clarify with owner whether actual container/seal numbers must be captured per shipment. If yes, audit adding it to `shipping_details`.

#### L5. Two free-text 'notes' surfaces (bl_profile.notes vs production_orders.shipping_notes) with no rule on which holds BL instructions
- **Layers in disagreement:** business-rules · UI
- **Severity:** Low · **Confirmed** · **REAL**
- **What:** There is no structured "BL instructions" field. The only free-text spaces are `bl_profile.notes` (client-level) and `production_orders.shipping_notes` (order-level). Two undelineated notes fields invite ambiguity: an operator may write critical BL/shipping instructions in one while a reader looks in the other. Neither is surfaced to `blIsFilled` or any automation, so instructions recorded there have no effect on the BL-readiness signal.
- **Files:** `lib/bl.ts`, `app/(app)/production/orders/actions.ts`
- **Clarify-only next step:** Clarify with owner which notes field is canonical for BL instructions and whether a dedicated structured field is wanted.

#### L6. Two duplicateDocument actions diverge — dashboard copy drops per-line config_values and is dead/unwired
- **Layers in disagreement:** UI · automation
- **Severity:** Low · **Confirmed** · **REAL**
- **What:** `duplicateDocument` exists twice. `clients/actions.ts:124-138` copies `config_values` onto each duplicated line; `dashboard/actions.ts:74-87` omits `config_values` entirely, so a duplicate made via that path would silently lose per-line configuration (product spec values). The dashboard copy is also not imported by any component (only the clients version is wired at `ClientsWorkspaceList.tsx`), making it stale duplicate logic that could be re-wired by mistake.
- **Files:** `app/(app)/dashboard/actions.ts`, `app/(app)/clients/actions.ts`, `app/(app)/clients/ClientsWorkspaceList.tsx`, `docs/current-implementation/POTENTIAL_INCONSISTENCIES.md`
- **Clarify-only next step:** Audit which `duplicateDocument` is canonical; confirm the dashboard copy is unused and flag for de-duplication. Clarify whether duplicates must carry `config_values`.

#### L7. A draft can be flagged 'pending validation', producing an 'Awaiting review' state on a quote that was never sent
- **Layers in disagreement:** UI · business-rules
- **Severity:** Low · **Suspected** · **REAL**
- **What:** The builder's "Request management validation" checkbox flows through to `maybeRequestValidation` on BOTH the fresh-insert and `edit_of` (draft) paths, setting `validation_status='pending'`. So a draft — which by the page's own banner "isn't in the order lifecycle" and hasn't been sent — can sit in "Awaiting review" and surface in the operations feed (`action-center.ts` queries pending docs with no status filter). The validation loop is advisory (never blocks send/win), but pairing a review request with an unsent draft is a semantic mismatch the UI does nothing to prevent or signal.
- **Files:** `app/(app)/documents/new/NewDocumentForm.tsx`, `app/(app)/documents/new/actions.ts`, `app/(app)/documents/[id]/page.tsx`
- **Clarify-only next step:** Clarify with owner whether requesting validation on a draft is intended; if reviews should apply only to sent quotes, audit where to constrain it.

#### L8. WorkflowStepper/UI presents 'Won → Task list' as one flow but the handoff is a separate manual step
- **Layers in disagreement:** UI · business-rules
- **Severity:** Low · **Confirmed** · **REAL**
- **What:** The lifecycle stepper labels the stage after Won as "Task list" with sub-text "Generate after Won", and the draft banner shows the chain "Quotation → Won → Task list → Production…" as a single-arrow visual that can read as auto-progression. In reality no task list is auto-created on win; sales must click "+ Task list" and the action center raises `won_no_tasklist`. The stepper wording is technically honest but the banner masks that a won deal sits inert until a human acts.
- **Files:** `components/WorkflowStepper.tsx`, `app/(app)/documents/[id]/page.tsx`, `lib/action-center.ts`, `docs/current-implementation/ORDER_LIFECYCLE.md`
- **Clarify-only next step:** Confirm with owner that task-list creation is intentionally manual (it is, per code). If so, flag for the doc author to state plainly in `ORDER_LIFECYCLE.md` §3.2 that Won does NOT auto-create the task list (removing the "Needs confirmation" tag).

#### L9. production_status / task_list_status are query aliases; the real column is status — a naming trap, not a live break
- **Layers in disagreement:** automation · UI
- **Severity:** Low · **Confirmed** · **REAL**
- **What:** `OrderStageInput` and the dashboard/operations rows use `production_status`/`task_list_status`, but `production_orders`/`production_task_lists` store `status`. Every current feed maps it in JS (e.g. `operations/page.tsx:943` `production_status: o.status`), so no live query is broken today. The hazard is latent: any new raw PostgREST/SQL query selecting `production_status` (no such column) would error, and any object literal that forgets the mapping yields null → `computeOrderFlightStage` silently falls back to task-list/won staging.
- **Files:** `lib/lifecycle.ts:285`, `app/(app)/operations/page.tsx:943`, `app/(app)/dashboard/page.tsx:607`, `docs/current-implementation/POTENTIAL_INCONSISTENCIES.md`
- **Clarify-only next step:** Clarify whether to rename the type field to `status` or centralize the SELECT/mapping. Document the alias contract at the query boundary.

#### L10. Legacy production_task_lists status default ('open') survives in m009 while the live CHECK is the m013 6-value enum
- **Layers in disagreement:** DB
- **Severity:** Low · **Confirmed** · **REAL**
- **What:** m009 creates `production_task_lists` with `status text not null default 'open'`; m013 drops that CHECK, remaps legacy values, and installs the 6-value enum — but does NOT reset the column DEFAULT. The app always inserts an explicit `status='draft'` (`documents/[id]/actions.ts:267`), so this is masked. However, any insert path that omits `status` would default to `'open'`, which now violates the m013 CHECK and fails. A latent schema/data-layer disagreement.
- **Files:** `supabase/migrations/009_families_config_and_task_lists.sql`, `supabase/migrations/013_validation_workflow_rename.sql`, `app/(app)/documents/[id]/actions.ts:267`
- **Clarify-only next step:** Verify in the live DB whether the column default is still `'open'`; if so, flag for a one-line default reset.

#### L11. Status-vocabulary drift is resolved at the live CHECK but legacy migrations remain a re-run hazard
- **Layers in disagreement:** DB · business-rules
- **Severity:** Low · **Confirmed** · **REAL**
- **What:** The live CHECK (m013) matches the TS 6-value enum and the `draft` insert / `transition()` targets. The residual risk is ordering/idempotency: m012 sets an INTERMEDIATE enum (sales_submitted/technical_review/sent_to_factory) that no longer exists in TS, and m013's file has a stray markdown code-fence (` ``` `) on lines 63-64 after COMMIT. If migrations are ever replayed out of order, or a tool chokes on the trailing fence, the constraint could land on a stale vocabulary that rejects current code's values.
- **Files:** `supabase/migrations/009_families_config_and_task_lists.sql`, `supabase/migrations/012_workflow_and_technical_fields.sql`, `supabase/migrations/013_validation_workflow_rename.sql`, `lib/types.ts`
- **Clarify-only next step:** Run the live constraint check (`\d production_task_lists`) to confirm it equals the 6-value enum, and ask the owner to remove the stray ` ``` ` fence at the end of `013_validation_workflow_rename.sql` so re-runs are clean.

#### L12. Two distinct workflows share the word 'validation' (doc advisory m068 vs task-list workflow)
- **Layers in disagreement:** UI · business-rules · DB
- **Severity:** Low · **Confirmed** · **REAL**
- **What:** Document advisory validation (m068, `documents.validation_status` pending/approved/rejected) is an ADVISORY review flag that never blocks anything. The task-list workflow validation (statuses under_validation/validated; capability `task_list.validate`; `validated_at`/`validated_by` stamps) is a HARD operational gate that auto-creates the production order. They share the word, the `ValidationHistory` component name, and 'validated' terminology, but are unrelated systems on different entities (the misnamed `ValidationHistory` under `documents/` renders only `tl.*` events on the task-list page). Risk is operator/comprehension confusion, not a functional break.
- **Files:** `supabase/migrations/068_quotation_validation.sql`, `app/(app)/task-lists/[id]/actions.ts`, `app/(app)/task-lists/[id]/page.tsx`, `lib/types.ts`, `docs/current-implementation/POTENTIAL_INCONSISTENCIES.md`
- **Clarify-only next step:** Clarify with owner a naming convention (e.g. "task-list approval" vs "quotation review") so the two flows are visibly distinct in UI labels and docs. Documentation/labeling decision only.

#### L13. Admin baseline unlock is documented as a capability but does not exist (disabled placeholder, undefined capability)
- **Layers in disagreement:** business-rules · DB · UI
- **Severity:** Low · **Confirmed** · **REAL**
- **What:** m041 and `lib/types.ts:610` both state the baseline can be unlocked by admins via capability `production_order.unlock_baseline`. That capability is NOT in the Capability union (`lib/permissions.ts:51-79`), NOT seeded in the m026 matrix, and the UI "Unlock baseline" button is a hard-disabled placeholder labelled "coming in the next phase" (`page.tsx:739-746`). Once a baseline is frozen at activation it is effectively permanent with no supported correction path, despite docs/comments promising a capability-gated admin unlock.
- **Files:** `supabase/migrations/041_baseline_locked_at.sql:24`, `lib/types.ts:608-611`, `lib/permissions.ts:51-79`, `app/(app)/production/orders/[id]/page.tsx:734-747`
- **Clarify-only next step:** Confirm with owner whether an admin baseline-unlock/correction path is actually required; if so it needs a real capability + action.

#### L14. isBaselineLocked safety net can lock the baseline before any completion date is stamped
- **Layers in disagreement:** UI · automation
- **Severity:** Low · **Suspected** · **REAL**
- **What:** `isBaselineLocked` falls back to `isProductionActive` when `baseline_locked_at` is unset. Activation stamps `initial_production_deadline` only when `production_working_days` is already set. If an order activates (deposit received / override) while `production_working_days` is NULL, the order becomes baseline-locked (active ⇒ locked) yet has NO `initial_production_deadline`, and the UI working-days edit form is hidden (`page.tsx:863`). Via the UI the technical user has lost the form, so an activated-without-working-days order shows a permanent "Waiting for deposit to activate" completion with no in-UI way to set the baseline.
- **Files:** `lib/production-lifecycle.ts:114-126`, `app/(app)/production/orders/actions.ts:608-617`, `app/(app)/production/orders/actions.ts:1157-1169`, `app/(app)/production/orders/[id]/page.tsx:842-911`
- **Clarify-only next step:** Clarify with owner whether activation should be blocked until `working_days` is set (so initial completion always stamps); audit for activated rows with NULL `production_working_days` / NULL `initial_production_deadline`.

#### L15. TLM 'task lists awaiting review' bell item deep-links to the list, not the entity/discussion
- **Layers in disagreement:** UI
- **Severity:** Low · **Confirmed** · **REAL**
- **What:** Every comment-derived bell item routes to the entity page with `?event=<id>` so the EventDiscussionPanel opens the thread (`notifications.ts:261-265`). The review aggregate item (`buildReviewNotification`, `:304-316`) instead sets `href:'/task-lists'` with no event context. The reviewer lands on an unfiltered list and must hunt for the under_validation rows — inconsistent with every other bell item and weaker than the available per-task-list deep link.
- **Files:** `lib/notifications.ts`
- **Clarify-only next step:** Owner/UX decision on whether the review item should deep-link to a filtered view or individual task lists.

---

### Resolved / not-an-inconsistency (recorded for completeness)

- **R1 — BL self-clear key mismatch (POTENTIAL_INCONSISTENCIES #1): RESOLVED this session.** `blIsFilled()` now reads `['bl_number','forwarder','vessel']` (`lib/action-center.ts:341`), matching what `updateProductionOrderShipment` writes and the `ShippingDetails` shape. The previously-documented bug (it read `forwarder_name`/`vessel_name`) no longer applies. **`SHIPPING_PROCESS.md` §7 and `POTENTIAL_INCONSISTENCIES.md` #1 are now STALE** and describe the pre-fix state — flag for a documentation update. (Consider a shared key-name constant so writer and reader can't drift again.)
- **R2 — actual_completion_date column name: CONFIRMED (no inconsistency).** The column is `actual_completion_date date` on `production_orders` (m018:68), matching `ProductionOrder.actual_completion_date: string|null` (`lib/types.ts:587`). No alternate spelling exists. The prior "needs-confirmation" item is resolved.

### Findings the verifier judged NOT real (dropped)

Two candidate findings from the investigation were judged `isReal=false` by verification against live code and are **excluded** from the register above:

1. **Action Center "Done" soft-fail (action_acks):** The claim that clicking "Done" silently no-ops and the card returns describes the **pre-fix** loose-regex behavior. Current `markActionDone` (`app/(app)/dashboard-v2/actions.ts`) uses a strict schema-only soft-fail (`isMissingActionAcksSchema`) that only swallows table/column-absent or schema-cache-miss errors (triggered only when m069 is unapplied or the PostgREST cache is stale immediately after applying). In a deployed environment with m069 applied, the upsert lands and the card is permanently cleared. Not a live inconsistency.
2. **`task_list.sync_orphans` / `task_list.delete` capabilities never seeded:** Factually incorrect. Both keys ARE inserted into the `permissions` catalog and seeded in the role matrix by m026 (`026_permissions_matrix.sql` lines 119-120, plus role rows for super_admin/admin/task_list_manager; m053 backfills `operations`). The actions resolve correctly for the intended roles. (Relatedly, the M8 "PO auto-create can silently no-op leaving the invariant unmet" candidate was downgraded: `ensureProductionOrderForTaskList` throws on real DB failures and the repair path's capability is seeded — the M8 entry retained above reflects only the genuine, narrower historical/orphan concern.)

---

## 4. Open questions for the owner

These need a decision before any broader lifecycle change is undertaken:

1. **Document & PO state machines (M1, M2):** Should document and production-order transitions be a true state machine with defined legal edges, or remain freeform by design? (The PO code comment claims freeform is intentional.)
2. **Won reversibility & re-edit (H1):** Should a won quotation — especially one with a linked task list/PO — be revertible to draft/sent and re-editable? If not, where should the guard live?
3. **Reopen after cancel/lost (H2):** Should re-opening a cancelled/lost quotation be blocked, or should it restore the cascaded children?
4. **Cancellation UX & cascade scope (H3, M15):** Should cancelling a won/in-production quotation require an explicit confirm showing the cascade? Should `lost` cascade-cancel production at all, or only `cancelled`? And should `doc.lost` severity match its cascade's magnitude?
5. **Start-without-deposit authorization (H4):** Must `reason` be mandatory? Is a distinct approver / payment-guarantee capture or finance sign-off required, per H.10? (H.14 is still flagged "Needs my confirmation.")
6. **Canonical "production complete" signal (H5, H6, M3, M4, M5):** Is completion defined by `status === production_completed` or by `actual_completion_date`? Must the two always coexist (DB constraint/trigger)? Should `delivered` imply production complete? Should forward jumps that bypass `production_completed` be allowed?
7. **Baseline immutability (M6, L13, L14):** Must `production_working_days` be hard-locked at activation server-side? Should activation be blocked until `working_days` is set? Is an admin baseline-unlock path actually required?
8. **Factory-lateness semantics (M7):** Should being past an externally-pushed ETA count as factory lateness, or surface as a separate external/amber signal?
9. **Bell scope & dual discussion systems (H7, H8):** Should event creation (by type/severity) raise the bell, or is it intentionally comments-only? Which discussion mechanism (`event_comments` vs `entity_messages`) is canonical, and should `entity_messages` generate unread/bell signals?
10. **Audit-log durability (M16, M17):** Which event types are audit-critical enough that emission failure should NOT be swallowed? Should `shipping_details` edits, TL line/risk edits, and reopen emit events?
11. **DB-level defense-in-depth (M9, M12, M14):** Should the downstream-existence delete guard, the draft-immutability rule, and the jsonb shape rules be enforced at the DB layer (triggers/constraints), or remain app-action-only?
12. **operations role on task-list lines (M18):** Is `operations` intended to edit task-list line technical data? If yes, the `production_task_list_lines` RLS policy needs `operations` added.
13. **affair status relationship (M10):** Confirm that affair status is operator-maintained and may legitimately disagree with the entity statuses; document the intended relationship.
14. **Shipping data model (L1–L5):** Should `freight_type` and `container_type` share one vocabulary? Are structured shipping/case marks and actual container/seal numbers required on the order? Which notes field is canonical for BL instructions?
15. **Versioning on drafts (M11):** Should revising a DRAFT be allowed at all, or only a sent quote?
16. **Duplicate parity (M13, L6):** Must `duplicateDocument` share `quotation.create` gating, emit `doc.created`, and carry `config_values`? Which of the two copies is canonical?
