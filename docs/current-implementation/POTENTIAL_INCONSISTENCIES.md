# Potential Inconsistencies — Current Implementation

> **Audit note.** Each item lists: **Description**, **Where it appears**,
> **Likely cause**, **Files/components**, **Confirmed vs Suspected**, and a
> **Recommended next step**. "Confirmed" = the code condition is verified;
> "Suspected" = the *behavioral consequence* is inferred and should be reproduced
> before acting. **No code is changed by this audit.**

---

## 1. `shipping_details` key mismatch breaks BL action self-clear  ⚠️ highest-value

- **Description.** The Action Center's "BL missing" item checks the wrong jsonb
  keys, so entering the forwarder/vessel on an order does not clear the action.
- **Where it appears.** `/operations` and `/dashboard-v2` Action Center; the
  "BL missing destination" card stays up after a user fills forwarder/vessel.
- **Likely cause.** Two modules disagree on the `shipping_details` shape:
  - `lib/shipping.ts` `ShippingDetails` writes **`forwarder`**, **`vessel`**.
  - `lib/action-center.ts` `blIsFilled()` (line ~336) reads
    **`forwarder_name`**, **`vessel_name`**.
  Only `bl_number` (or a filled client consignee company) actually clears it.
- **Files/components.** `lib/action-center.ts` (`blIsFilled`, `blRequired`),
  `lib/shipping.ts`, `production_orders.shipping_details` (m070).
- **Confirmed vs Suspected.** **Confirmed** code mismatch; **Suspected**
  behavioral bug (reproduce: fill only forwarder+vessel, confirm card stays).
- **Recommended next step.** Align the keys (read `forwarder`/`vessel` in
  `blIsFilled`). Add a tiny shared constant for the key names so they can't
  drift again. Do **not** rename the stored keys (data already uses
  `forwarder`/`vessel`).

---

## 2. Action Center "Done" silently no-ops when m069 isn't applied

- **Description.** Clicking **Done** fails with *"Could not find the 'state'
  column of action_acks in the schema cache"* and the card returns on reload.
- **Where it appears.** Action Center cards with a Done button
  (`resolution='manual'`).
- **Likely cause.** `action_acks.state` (m069) not applied, or PostgREST schema
  cache stale. `markActionDone` upserts `{state:'done'}`; the action only
  swallows **schema-missing** errors, so a stale cache returns the card.
- **Files/components.** `app/(app)/dashboard-v2/actions.ts`
  (`markActionDone`, `isMissingActionAcksSchema`),
  `components/action-center/ActionCenter.tsx`,
  `supabase/migrations/069_action_acknowledgements.sql`.
- **Confirmed vs Suspected.** **Confirmed** (observed error screenshot).
- **Recommended next step.** **Operator action, not a code change**: apply m069
  in Supabase and run `notify pgrst, 'reload schema';` (already at the bottom of
  the migration). The soft-fail logic is intentionally strict and correct.

---

## 3. `production_status` is a query alias, not a real column

- **Description.** UI types use `production_status` / `task_list_status`, but the
  DB columns are `production_orders.status` / `production_task_lists.status`.
- **Where it appears.** Any raw query feeding `OrderInFlight` /
  `computeOrderFlightStage`.
- **Likely cause.** Convenient aliasing (`status AS production_status`) in
  dashboard queries; the alias name leaked into shared types.
- **Files/components.** `components/dashboard/OrdersInFlight.tsx`,
  `lib/lifecycle.ts` (`OrderStageInput.production_status`), the dashboard query
  layer.
- **Confirmed vs Suspected.** **Confirmed** naming hazard (a new query that
  forgets the alias would break or read `null`).
- **Recommended next step.** Document the alias contract at the query boundary;
  consider renaming the type field to `status` or centralizing the SELECT.

---

## 4. `FreightType` vs `ContainerType` value mismatch (`40ft`)

- **Description.** `FreightType` lacks the plain `40ft` that `ContainerType` /
  `document_containers.container_type` allows.
- **Where it appears.** Freight selection on the quote vs container plan.
- **Likely cause.** The container CHECK was fixed in m063 to add `40ft`, but the
  `FreightType` union was not aligned.
- **Files/components.** `lib/types.ts` (`FreightType` = `LCL|20ft|40ft HC`,
  `ContainerType` = `LCL|20ft|40ft|40ft HC`),
  `supabase/migrations/063_fix_container_type_check.sql`.
- **Confirmed vs Suspected.** **Confirmed** divergence; behavioral impact
  **Suspected** (likely fine if freight ≠ container, but confusing).
- **Recommended next step.** Decide whether freight and container vocabularies
  should match; align or document the intentional difference.

---

## 5. Visibility grants (lens/team/region) are not enforced at the DB (RLS)

- **Description.** A narrow lens/team grant is enforced only in app code; a
  direct DB/RPC path could over-return rows.
- **Where it appears.** Any data path that bypasses `lib/visibility.ts`
  filtering.
- **Likely cause.** m067 was deliberately additive ("NO existing table's RLS is
  changed") with an app-level engine + legacy fallback.
- **Files/components.** `lib/visibility.ts`,
  `supabase/migrations/067_visibility_scopes.sql`.
- **Confirmed vs Suspected.** **Confirmed** (by design, not yet completed).
- **Recommended next step.** Plan Phase 2b: push scope predicates into RLS, or
  accept app-level-only and document the trust boundary. Until then, treat
  visibility as advisory, **not** a security control (capabilities + base RLS
  isolation remain the real controls).

---

## 6. Two unrelated concepts both called "validation"

- **Description.** Document **advisory validation** (m068,
  pending/approved/rejected) and task-list **workflow validation**
  (`under_validation`/`validated`) share the word but are different systems.
- **Where it appears.** Document detail vs task-list detail; capability
  `task_list.validate` vs `validation_status`.
- **Likely cause.** Independent features adopting the same noun.
- **Files/components.** `lib/validation.ts` (doc), `lib/types.ts`
  (`ProductionTaskListStatus`), `lib/auth.ts requireTaskListManagerOrAdmin`.
- **Confirmed vs Suspected.** **Confirmed** terminology collision.
- **Recommended next step.** Rename one in UI copy (e.g. doc = "review", TL =
  "validation") to avoid operator confusion.

---

## 7. Two parallel discussion systems

- **Description.** `event_comments` (tied to an `event`) and `entity_messages`
  (tied to an entity) are separate tables with separate drawers.
- **Where it appears.** Bell `?event=` drawer (`EventDiscussionPanel`) vs the
  global `ConversationDrawer`.
- **Likely cause.** Event comments (m044) predate the entity-message thread
  (m049); both shipped.
- **Files/components.** `lib/events.ts` / `EventDiscussionPanel.tsx` vs
  `lib/entity-messages.ts` / `components/chat/ConversationDrawer.tsx`.
- **Confirmed vs Suspected.** **Confirmed** structural duplication; **Suspected**
  UX confusion (a message in one is invisible in the other).
- **Recommended next step.** Pick a canonical discussion surface, or clearly
  delineate "operational event thread" vs "entity chatter".

---

## 8. Duplicate `duplicateDocument` server action

- **Description.** Two definitions of `duplicateDocument`.
- **Where it appears.** Clients list duplicate vs dashboard duplicate.
- **Likely cause.** Copy when the action was needed in a second place.
- **Files/components.** `app/(app)/clients/actions.ts:55`,
  `app/(app)/dashboard/actions.ts:7`.
- **Confirmed vs Suspected.** **Confirmed** duplication; **Suspected** drift
  risk (logic could diverge — e.g. numbering, ownership, RLS).
- **Recommended next step.** Extract one shared implementation (e.g. under
  `app/(app)/_actions/`) and have both call it.

---

## 9. Duplicate `factory-mapping/actions.ts` + stray `.bak` files committed

- **Description.** Two factory-mapping action files, plus backup files committed
  to the tree.
- **Where it appears.** `/factory-mapping` (ops) and `/admin/factory-mapping`.
- **Likely cause.** Operations + admin copies; `.bak` files left from manual
  edits.
- **Files/components.** `app/(app)/factory-mapping/actions.ts`,
  `app/(app)/admin/factory-mapping/actions.ts`,
  `app/(app)/admin/factory-mapping/actions.ts.bak`,
  `…/page_full.tsx.bak`, `…/page_full.tsx.bak2`.
- **Confirmed vs Suspected.** **Confirmed** (files exist).
- **Recommended next step.** De-duplicate the action; delete `.bak` artifacts
  (code hygiene). Confirm both surfaces share gating before merging.

---

## 10. `RUN_THIS_FIRST_production_setup.sql` bundles pre-m046 PO RLS

- **Description.** The convenience bundle concatenates m018–m023, including the
  **original** `production_orders` RLS from m018 — which predates the m046
  isolation hardening.
- **Where it appears.** Only when an operator runs the bundle.
- **Likely cause.** The bundle was frozen at m023 and not updated when m046
  changed PO policies.
- **Files/components.** `supabase/migrations/RUN_THIS_FIRST_production_setup.sql`,
  `046_data_isolation_hardening.sql`.
- **Confirmed vs Suspected.** **Confirmed** the bundle contains m018 policies;
  **Suspected** that re-running it **after** m046 could regress isolation
  (depends on the exact `drop/create policy` ordering — needs verification).
- **Recommended next step.** Add a warning to the bundle ("do not run after
  m046") or regenerate it to include current policies. Verify policy
  definitions before relying on it.

---

## 11. "Completed" defined two different ways

- **Description.** `getLifecyclePhase` calls an order `completed` when
  `actual_completion_date` is set; `computeOrderFlightStage` shows "Production
  complete" on status `production_completed`.
- **Where it appears.** Production order page vs Orders-in-flight strip.
- **Likely cause.** Two modules modeling completion from different fields.
- **Files/components.** `lib/production-lifecycle.ts getLifecyclePhase`,
  `lib/lifecycle.ts computeOrderFlightStage`.
- **Confirmed vs Suspected.** **Confirmed** two definitions; **Suspected** they
  can disagree (status `production_completed` without `actual_completion_date`,
  or vice-versa).
- **Recommended next step.** Define one canonical "completed" rule and have both
  modules derive from it.

---

## 12. Some admin sub-pages rely on the layout guard only

- **Description.** `admin/products/images` and `admin/products/import`
  reportedly have no in-body role guard.
- **Where it appears.** Those admin sub-routes.
- **Likely cause.** Trust in the `app/(app)/admin` layout guard.
- **Files/components.** `app/(app)/admin/products/*` (per routes map).
- **Confirmed vs Suspected.** **Confirmed** (routes map); **Suspected** exposure
  only if the layout guard changes.
- **Recommended next step.** Add a defense-in-depth in-body
  `requireAdmin()`/capability check (cheap insurance).

---

## 13. Bell notifies on unread *comments*, not on event creation

- **Description.** A new high/critical event with no comment doesn't raise the
  bell.
- **Where it appears.** Top-nav bell.
- **Likely cause.** Bell is a read-state view over `event_comments` (m045), by
  design.
- **Files/components.** `lib/notifications.ts`.
- **Confirmed vs Suspected.** **Confirmed**; **Suspected** to be a product gap
  (users may expect to be alerted on the event itself).
- **Recommended next step.** Decide whether event creation should also notify;
  if so, add an unread-events signal alongside unread-comments.

---

## 14. "Task lists awaiting review" bell item is not a deep link

- **Description.** Unlike every other bell item (which uses `?event=`), the
  review aggregate links to `/task-lists` (the list).
- **Files/components.** `lib/notifications.ts buildReviewNotification`
  (`href:"/task-lists"`).
- **Confirmed vs Suspected.** **Confirmed**; minor UX inconsistency.
- **Recommended next step.** Acceptable as an aggregate; optionally deep-link
  when count === 1.

---

## 15. Migration `040` is missing from the sequence

- **Description.** Numbering jumps 039 → 041.
- **Files/components.** `supabase/migrations/`.
- **Confirmed vs Suspected.** **Confirmed**; **benign** (no migration was ever
  numbered 040).
- **Recommended next step.** None required; note it so nobody hunts for a "lost"
  migration.

---

## 16. Capability count discrepancy (22 vs "23")

- **Description.** The `lib/permissions.ts` `Capability` union has **22** keys;
  prior notes referenced "23" capabilities in the DB catalog.
- **Files/components.** `lib/permissions.ts`, `permissions` table (m026).
- **Confirmed vs Suspected.** **Confirmed** the union = 22; **Suspected** the DB
  catalog may have an extra/legacy row.
- **Recommended next step.** Reconcile the `permissions` catalog rows against the
  `Capability` union; remove or add the odd one out. **Needs confirmation.**
