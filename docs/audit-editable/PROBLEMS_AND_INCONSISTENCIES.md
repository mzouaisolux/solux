# PROBLEMS_AND_INCONSISTENCIES.md — SOLUX Consolidated Issue Register

> **What this document is.** A single, de-duplicated register of every problem,
> inconsistency, unclear behavior, disconnected feature, and risky behavior
> detected during the read-only audit. It synthesizes
> `docs/current-implementation/POTENTIAL_INCONSISTENCIES.md`,
> `docs/current-implementation/MISSING_DOCUMENTATION.md`, and the eleven
> editable audit docs (APP_OVERVIEW, MODULES_AND_PAGES,
> USER_ROLES_AND_PERMISSIONS, DATABASE_MODEL, BUSINESS_RULES, ORDER_LIFECYCLE,
> DRAFT_AND_EDITING_RULES, PRODUCT_AND_PRICING_RULES, SHIPPING_AND_BL,
> NOTIFICATIONS_AND_MESSAGES, UI_UX_AUDIT), each verified against the live code
> where practical.
>
> **This is AUDIT + DOCUMENTATION ONLY.** No application code was changed. Every
> "recommended next step" below is an *audit / clarify* action — confirm a fact,
> reproduce a behavior, or make a product decision. **No code fix is proposed or
> performed here.**
>
> **How to read each entry:**
> - **Severity** — Critical / High / Medium / Low (business + data-safety impact).
> - **Status** — **Confirmed** (the code condition is verified in a cited file)
>   or **Suspected** (the *behavioral consequence* is inferred and should be
>   reproduced before acting).
> - File paths are relative to the project root.
>
> **Severity rubric used here:**
> - **Critical** — can cause irreversible data loss, or a real security boundary
>   is weaker than the UI implies.
> - **High** — a feature is silently broken or a workflow can stall with no
>   alert; user-visible wrong behavior.
> - **Medium** — drift / duplication / unclear logic that will cause bugs or
>   confusion as the code evolves.
> - **Low** — cosmetic, hygiene, benign, or already-mitigated; document and move on.
>
> **Verification note.** Two claims from the upstream primary-source docs were
> found to be **out of date** when checked against the live tree and are flagged
> inline so the owner is not misled: (a) the `.bak` artifacts in item M-7 appear
> to have already been deleted; (b) the `DOC_TERMINAL_STATUSES` "divergence" in
> item M-12 does **not** exist — the two copies are currently identical.

---

## Owner decisions affecting this register (2026-05-30)

> **Source:** `docs/audit-editable/OWNER_DECISIONS_LOG.md` — all decisions confirmed 2026-05-30.
> These describe **TARGET / INTENDED behavior and policy**. None are yet implemented in code.
> Each decision is noted inline at the relevant issue below.

| Decision | Issue(s) affected | Summary |
|---|---|---|
| **C** | M-4 | `entity_messages` is the canonical discussion surface; `event_comments` only for specific operational events |
| **D** | M-5 | Bell must notify on high/critical event creation even with no comment |
| **E** | C-2 | Visibility enforcement must become a real RLS security boundary (progressive migration) |
| **F** | C-1 | Deletion restricted after `won`; archive-reason required on all archive actions |
| **G** | H-1 | Approved fix: align `blIsFilled` to read `forwarder`/`vessel` keys — NOT yet applied |

---

## Severity summary (at a glance)

> **Decision status (2026-06-03):** Every problem below now has a corresponding
> owner decision. The ★ critical/high items (C-1, C-2, H-1, H-2 …) were decided
> 2026-05-30 (see [OWNER_DECISIONS_LOG.md](./OWNER_DECISIONS_LOG.md)); all
> remaining medium/low items were ratified or decided 2026-06-03 and recorded
> inline in [QUESTIONS_FOR_ME.md](./QUESTIONS_FOR_ME.md). The *Status* column here
> still describes the **problem** (Confirmed / Suspected / Resolved-in-code), not
> the decision — consult QUESTIONS_FOR_ME.md for the chosen target behavior.

| ID | Severity | Status | Title |
|---|---|---|---|
| C-1 | Critical | Confirmed (code) / Suspected (policy) | Sales can DELETE a `won` quotation, cascade-deleting its production order |
| C-2 | Critical | Confirmed | Visibility grants (lens/team/region) are NOT enforced at the database (RLS) |
| H-1 | High | Confirmed (mismatch) / Suspected (effect) | BL "forwarder/vessel" key mismatch — BL Action Center card never self-clears |
| H-2 | High | Confirmed | "Won but no task list" can stall silently; task-list creation is manual |
| H-3 | High | Confirmed (config) / Suspected (env) | Action Center "Done" no-ops if m069 not applied / schema cache stale |
| H-4 | High | Confirmed | `duplicateDocument` is duplicated and the two copies diverge (dashboard drops `config_values`) |
| H-5 | High | Confirmed | `admin/products/images` and `admin/products/import` have NO in-body guard |
| H-6 | High | Suspected | `admin.diagnostics` capability may have no DB `permissions` row |
| M-1 | Medium | Confirmed | "Completed" is defined two different ways (date vs status) |
| M-2 | Medium | Confirmed | `production_status` / `task_list_status` are query aliases, not real columns |
| M-3 | Medium | Confirmed | Two unrelated concepts both called "validation" |
| M-4 | Medium | Confirmed | Two parallel discussion systems (`event_comments` vs `entity_messages`) |
| M-5 | Medium | Confirmed | Bell notifies on unread *comments*, not on event creation |
| M-6 | Medium | ✅ Stale (2026-06-03) | `FreightType` and `ContainerType` are now **identical** (`LCL\|20ft\|40ft\|40ft HC`) — divergence already fixed; decision: collapse to one shared type (QUESTIONS §5.3) |
| M-7 | Medium | Confirmed (dupes) / Needs confirmation (`.bak`) | Duplicate factory-mapping `actions.ts`/`MappingRow.tsx`; stray `.bak` files |
| M-8 | Medium | Confirmed | `regular admin` cannot reach `/admin/users`, `/permissions`, `/admin/diagnostics` by default |
| M-9 | Medium | Confirmed | `updateProductionOrderStatus` enforces no transition graph |
| M-10 | Medium | Confirmed | jsonb shapes (`shipping_details`, `bl_profile`, etc.) have no DB-level schema |
| M-11 | Medium | Confirmed | `action_acks.state` has no CHECK constraint |
| M-12 | Medium | Confirmed | `DOC_TERMINAL_STATUSES` is defined twice (constant duplication, currently in sync) |
| M-13 | Medium | Confirmed | Two free-text BL "notes" fields with no structural distinction |
| M-14 | Medium | ✅ Resolved (2026-06-03) | `clients` has **no** commission columns (live DB confirmed); commission lives only on `documents` (m006) — see §M-14 detail + QUESTIONS §5.7 |
| M-15 | Medium | Confirmed (absence) / Needs confirmation (intent) | Pricing, commission, forecast methodologies are undocumented |
| M-16 | Medium | Confirmed | `RUN_THIS_FIRST_production_setup.sql` bundles pre-m046 PO RLS |
| M-17 | Medium | Confirmed | No applied-migrations ledger (manual migrations → "Done button" class of bug) |
| M-18 | Medium | Suspected | `field_scope = 'technical'` write-enforcement gate not traced |
| L-1 | Low | Confirmed | "Task lists awaiting review" bell item is not a deep link |
| L-2 | Low | Confirmed | Migration `040` is missing from the sequence (benign) |
| L-3 | Low | Confirmed | Capability count 22 (code) vs "23" in older notes |
| L-4 | Low | Confirmed | Redirect stubs (`/`, `/production/*`, `/order-follow-up`, `/permissions`) |
| L-5 | Low | Confirmed (env) | iCloud Drive breaks `node_modules` / symlinks |
| L-6 | Low | Confirmed | `spec.md` is stale; "Quotation tool" label still in UI |
| L-7 | Low | Confirmed | Reserved/unused DB columns (`entity_messages.*`, `attachments.visible_*`) |
| L-8 | Low | Confirmed | No taxes/VAT, no FX conversion, no explicit rounding in pricing |
| L-9 | Low | Confirmed | UI shows raw enums (`IN PRODUCTION`), `role·uuid` instead of names, disabled "Unlock baseline", emoji |
| L-10 | Low | Confirmed | `emitEvent` call-site coverage not enumerated (best-effort, swallowed) |
| L-11 | Low | Needs confirmation | `validated_at` / `validated_by` written but possibly absent from the TS type |
| L-12 | Low | Needs confirmation | `shipment_booked` boolean column vs `shipment_booked` status may diverge |
| L-13 | Low | Suspected | `production_delayed` status is never auto-set when a deadline passes |

---

# CRITICAL

---

## C-1. Sales can DELETE a `won` quotation, cascade-deleting its production order

- **Description.** The `documents` DELETE RLS policy and the `deleteQuotation`
  server action impose **no status filter**. Any authenticated user can delete
  *their own* document at any status — including `won`. Because
  `production_orders → documents` is an FK with **ON DELETE CASCADE**, deleting a
  won quotation physically deletes the linked production order (and its delay
  history, payments, shipping_details). This is an irreversible data-loss path
  initiated by a non-privileged role.
- **Where it appears.** Document detail "Delete quotation" action; clients
  workspace; any surface exposing `deleteQuotation`. The confirm dialog warns
  "…will also remove any linked production order," but nothing blocks it.
- **Likely cause.** m055 granted `quotation.delete` to `sales` (and `admin`);
  m057 scoped DELETE RLS to `created_by = auth.uid()` (owner) or admin/super.
  Neither layer added a `status`/lifecycle guard, so the deletion is
  status-agnostic by construction.
- **Related files/components.**
  `app/(app)/documents/[id]/actions.ts` (`deleteQuotation`, comment ~lines
  494–506: notes the FK cascade), `supabase/migrations/055_sales_delete_quotation.sql`,
  `supabase/migrations/057_documents_delete_owner.sql` (RLS),
  `lib/permissions.ts` (`quotation.delete`).
- **Status.** **Confirmed** code path (capability + RLS both status-agnostic);
  **Suspected** that this is undesired (a product decision, not yet made).
- **Recommended next step (audit/clarify only).** Owner decision: should a `won`
  (or production-active) quotation be deletable by sales at all? Reproduce: as a
  sales-owned `won` deal with a live PO, confirm the PO row disappears on
  document delete. Document the intended policy before any guard is designed.
  Cross-ref: DRAFT_AND_EDITING_RULES.md §4.3 / §11 item 1.
- **-> Owner decision (F) confirmed 2026-05-30 — target behavior; not yet implemented.**
  Won quotations may not be freely deleted. Won + no task list: deletion by admin/super admin
  only, with strong confirmation and audit log. Won + task list or PO: blocked — use
  cancellation or archive instead. Cascade deletion of production data must not happen
  silently. Archive actions must record: archive reason, archived-by, archived-at, optional
  note. See OWNER_DECISIONS_LOG.md §F.

---

## C-2. Visibility grants (lens / team / region) are NOT enforced at the database (RLS)

- **Description.** The visibility engine (`lib/visibility.ts`, m067) filters rows
  in **application code only**. The `access_grants` scopes (`self / team /
  region / lens / all`) are never joined into any RLS policy. A narrow grant
  therefore restricts the UI but not the database: any path that bypasses
  `lib/visibility.ts` (a direct Supabase REST/RPC call, a future query that
  forgets to filter) can over-return rows beyond the intended scope.
- **Where it appears.** Any data path not routed through `canSeeRow` /
  `canSeeRecord` / `ownerAllowList`. Today all reads go through the app layer, so
  the gap is latent, not actively exploited.
- **Likely cause.** m067 was deliberately additive — its header states
  "NO existing table's RLS is changed here." Phase-2b RLS enforcement was
  planned but not implemented.
- **Related files/components.** `lib/visibility.ts`,
  `supabase/migrations/067_visibility_scopes.sql`, `/permissions/teams` admin UI.
- **Status.** **Confirmed** (by design, not yet completed).
- **Recommended next step (audit/clarify only).** Treat visibility as **advisory
  rendering, not a security control** until RLS enforces it. The real boundaries
  remain (a) base RLS sales-isolation (m046/m057/m058/m066) and (b) the
  capability matrix. Owner decision: push scope predicates into RLS (Phase 2b),
  or formally accept app-level-only and record the trust boundary. Cross-ref:
  POTENTIAL_INCONSISTENCIES.md §5; USER_ROLES_AND_PERMISSIONS.md §5.3 / §7.2;
  BUSINESS_RULES.md A6/A9.
- **-> Owner decision (E) confirmed 2026-05-30 — target behavior; not yet implemented.**
  Direction chosen: progressive RLS enforcement. Visibility restrictions must eventually be
  enforced at the database level through RLS — app-level filtering is interim/UX only.
  Current state documented as interim, not final security model. Target: UI filtering = UX;
  RLS filtering = real security. RLS changes must be progressive and tested with real user
  accounts. See OWNER_DECISIONS_LOG.md §E.

---

# HIGH

---

## H-1. BL "forwarder / vessel" key mismatch — BL Action Center card never self-clears

- **Description.** The "BL missing destination" Action Center item reads the
  wrong jsonb keys, so entering the forwarder/vessel on a production order does
  **not** clear the card. The data itself saves and reloads correctly on the
  order page — only the action's self-clear logic is wrong.
- **Where it appears.** `/operations` and `/dashboard-v2` Action Center; the
  `bl_missing_destination` card persists after a user fills forwarder + vessel.
- **Likely cause / exact mismatch (verified).**
  - `lib/shipping.ts` writes keys **`forwarder`** and **`vessel`**
    (`lib/shipping.ts:16–17`, also `:33–34`, `:62–63`).
  - `lib/action-center.ts blIsFilled()` iterates
    **`["bl_number", "forwarder_name", "vessel_name"]`** (`lib/action-center.ts:336`).
  The `_name`-suffixed keys are never written, so only `bl_number` — or a
  non-empty `bl_profile.consignee.company_name` — actually clears the card.
- **Related files/components.** `lib/action-center.ts` (`blIsFilled`, `blRequired`,
  `BL_STAGE_STATUSES`), `lib/shipping.ts` (`ShippingDetails`,
  `normalizeShippingDetails`), `production_orders.shipping_details` (m070).
- **Status.** **Confirmed** code mismatch; **Suspected** behavioral consequence
  (reproduce: fill only forwarder + vessel on a deposit-stage seller-ships order,
  confirm the card stays up).
- **Recommended next step (audit/clarify only).** Confirm the reproduction.
  Owner product decision: should `forwarder` (or `vessel`) **alone** clear the
  card, or should `bl_number` be required? (That decision determines the fix; do
  **not** rename the stored keys — data already uses `forwarder`/`vessel`.)
  Cross-ref: POTENTIAL_INCONSISTENCIES.md §1; SHIPPING_AND_BL.md §6 / §9.2;
  NOTIFICATIONS_AND_MESSAGES.md §7.4; DRAFT_AND_EDITING_RULES.md §6.2;
  BUSINESS_RULES.md E7.
- **-> Owner-APPROVED fix (G) confirmed 2026-05-30 — not yet applied.**
  `blIsFilled` must read the keys actually stored in `shipping_details` (`forwarder`,
  `vessel`). Minimum field to clear the BL-missing alert: `forwarder`. `bl_number` must
  NOT be mandatory for the first BL follow-up alert. Stored jsonb keys must not be renamed.
  Fix is approved but has not been applied — we remain in the documentation phase.
  See OWNER_DECISIONS_LOG.md §G.

---

## H-2. "Won but no task list" can stall silently; task-list creation is manual

- **Description.** A task list is **not** auto-created when a deal is won. A user
  must click to call `generateProductionTaskList` on the document detail page. If
  a sales rep wins a deal and moves on, the order silently sits at the flight-stage
  fallback "Awaiting task list — Deal won, task list not started yet" with no
  hard alert beyond an Action Center sensor.
- **Where it appears.** Document detail → task-list CTA; OrdersInFlight strip
  fallback (`lib/lifecycle.ts:354`).
- **Likely cause.** Deliberate manual gate (one task list per quotation,
  idempotent select-before-insert) with no automation on `doc.status → won`.
- **Related files/components.**
  `app/(app)/documents/[id]/actions.ts` (`generateProductionTaskList`),
  `lib/lifecycle.ts` (line 354 fallback), `lib/action-center.ts`
  (`won_no_tasklist` sensor — `waiting_me`, `auto_clear`).
- **Status.** **Confirmed** no auto-creation; **Suspected** that the
  `won_no_tasklist` sensor is the *only* safety net.
- **Recommended next step (audit/clarify only).** Confirm whether the
  `won_no_tasklist` Action Center item is sufficiently surfaced (which roles see
  it, after how many days it escalates). Owner decision: keep manual creation, or
  automate on win. Cross-ref: ORDER_LIFECYCLE.md §3.2 / §9.5 / §12 item 3;
  BUSINESS_RULES.md C1/H2.

---

## H-3. Action Center "Done" silently no-ops if m069 isn't applied / schema cache is stale

- **Description.** Clicking **Done** on a `resolution='manual'` card upserts
  `{state:'done'}` into `action_acks` (m069). If m069 is not applied, or the
  PostgREST schema cache is stale, the upsert fails with *"Could not find the
  'state' column of action_acks in the schema cache."* The `applyAcks` fallback
  path does not filter `done` items, so the card returns on reload.
- **Where it appears.** Any Action Center card with a Done button.
- **Likely cause.** Migrations are applied **manually**; the soft-fail logic
  intentionally swallows only the schema-missing error (correct), so a stale
  cache reverts to the no-`state` path.
- **Related files/components.**
  `app/(app)/dashboard-v2/actions.ts` (`markActionDone`,
  `isMissingActionAcksSchema`), `lib/action-center.ts` (`applyAcks`),
  `components/action-center/ActionCenter.tsx`,
  `supabase/migrations/069_action_acknowledgements.sql`.
- **Status.** **Confirmed** (observed error per upstream audit) — configuration,
  not a code defect.
- **Recommended next step (operator action, not code).** Apply m069 in Supabase
  and run `notify pgrst, 'reload schema';` (already the last line of the
  migration). See also M-17 (no applied-migrations ledger — this is that class of
  problem). Cross-ref: POTENTIAL_INCONSISTENCIES.md §2;
  NOTIFICATIONS_AND_MESSAGES.md §7.5.

---

## H-4. `duplicateDocument` is duplicated and the two copies diverge

- **Description.** Two server actions named `duplicateDocument` exist. The
  dashboard copy **drops `config_values`** on the copied lines; the clients copy
  preserves them. Duplicating the same source document produces a different
  result depending on which surface the user used.
- **Where it appears.** Clients workspace duplicate vs dashboard duplicate.
- **Likely cause.** Copy-paste when the action was needed on a second surface;
  the two implementations drifted.
- **Related files/components (verified locations).**
  `app/(app)/clients/actions.ts:55` (copies `config_values: l.config_values ?? {}`),
  `app/(app)/dashboard/actions.ts:7` (line insert payload omits `config_values`,
  ~line 83). Neither copy carries `affair_name` / `version` / `root_document_id`
  / advisory-validation columns; revalidation targets also differ.
- **Status.** **Confirmed** duplication and the `config_values` divergence.
- **Recommended next step (audit/clarify only).** Owner decision: is dropping
  per-line technical config on a dashboard-duplicate intended or a bug? Reproduce
  by duplicating a configured document from each surface and diffing the lines.
  Cross-ref: POTENTIAL_INCONSISTENCIES.md §8; DRAFT_AND_EDITING_RULES.md §9.

---

## H-5. `admin/products/images` and `admin/products/import` have NO in-body guard

- **Description.** Both pages render with **zero** in-body auth/capability checks
  — verified: a grep for `requireAdmin|requireCapability|getEffectiveRole|getCurrentUserRole|isAdminLike|redirect`
  returns nothing in either `page.tsx`. They rely entirely on the
  `app/(app)/admin/layout.tsx` `isAdminLike` redirect. If that single layout
  guard is ever changed, removed, or bypassed, these bulk-mutation routes (image
  upload, product import) are unprotected at the page level. This is the only
  pair of admin sub-pages lacking defense-in-depth; `/admin/users` and
  `/admin/diagnostics` correctly use *both* a layout guard *and* an in-body
  capability check.
- **Where it appears.** `/admin/products/images`, `/admin/products/import`.
- **Likely cause.** Trust in the admin layout guard; defense-in-depth omitted.
- **Related files/components.**
  `app/(app)/admin/products/images/page.tsx`,
  `app/(app)/admin/products/import/page.tsx`,
  `app/(app)/admin/layout.tsx` (the only guard today).
- **Status.** **Confirmed** (no in-body guard); **Suspected** exposure only if
  the layout guard changes (no bypass exists today).
- **Recommended next step (audit/clarify only).** Document the dependency on the
  layout guard as a known gap; recommend (do not implement) an in-body
  `requireAdmin()` / capability check as cheap insurance. Cross-ref:
  POTENTIAL_INCONSISTENCIES.md §12; MODULES_AND_PAGES.md (those routes) + §4;
  USER_ROLES_AND_PERMISSIONS.md §7.1.

---

## H-6. `admin.diagnostics` capability may have no DB `permissions` row

- **Description.** The `Capability` union in `lib/permissions.ts` includes
  `admin.diagnostics` (the 22nd key). The capability-seeding migrations (m026,
  m033, m053, m064) are accounted for, but DATABASE_MODEL.md §8.3/§16.9 flags a
  question of whether the `permissions` **catalog row** for `admin.diagnostics`
  actually exists in the live DB. Because `loadEnabledCapabilities` is
  **fail-closed**, if the row is missing then `hasCapability('admin.diagnostics')`
  could return false for everyone — making `/admin/diagnostics` and the dev-reset
  page unreachable via the capability check. (USER_ROLES_AND_PERMISSIONS.md §4
  reads m033 as adding the row; DATABASE_MODEL.md is less certain. The two
  audit docs disagree, so this needs a live read.)
- **Where it appears.** `/admin/diagnostics`, `/admin/diagnostics/reset`.
- **Likely cause.** Capability added across multiple migrations; seed-row
  presence not verifiable from code alone.
- **Related files/components.** `lib/permissions.ts`, `supabase/migrations/033_*.sql`,
  `supabase/migrations/026_*.sql`, the `permissions` table.
- **Status.** **Suspected** / **Needs confirmation** (requires a live
  `select key from permissions where key = 'admin.diagnostics'`).
- **Recommended next step (audit/clarify only).** Run that query in the target
  DB. Reconcile the seeded `permissions` rows against the 22-key `Capability`
  union. Cross-ref: DATABASE_MODEL.md §8.3 / §16.9;
  USER_ROLES_AND_PERMISSIONS.md §4 / §7.7.

---

# MEDIUM

---

## M-1. "Completed" is defined two different ways

- **Description.** `lib/production-lifecycle.ts getLifecyclePhase()` marks an
  order `completed` when `actual_completion_date` is set (regardless of status);
  `lib/lifecycle.ts computeOrderFlightStage()` shows "Production complete"
  (phase 4) on PO `status = 'production_completed'`. The two signals can disagree.
- **Where it appears.** Production-order lifecycle phase vs OrdersInFlight strip.
- **Mitigation (verified by audit).** `updateProductionOrderStatus` auto-stamps
  `actual_completion_date` when status is set to `production_completed`
  (`app/(app)/production/orders/actions.ts:124–128`), which reduces — but does
  not eliminate — divergence (the reverse case, or direct DB writes, can still
  desync them).
- **Related files/components.** `lib/production-lifecycle.ts` (`getLifecyclePhase`),
  `lib/lifecycle.ts` (`computeOrderFlightStage`),
  `app/(app)/production/orders/actions.ts`.
- **Status.** **Confirmed** two definitions; **Suspected** practical divergence.
- **Recommended next step (audit/clarify only).** Owner decision: choose ONE
  canonical "production is complete" rule; document which field is authoritative.
  Cross-ref: POTENTIAL_INCONSISTENCIES.md §11; ORDER_LIFECYCLE.md §4.6 / §9.3;
  BUSINESS_RULES.md D10/H8.

---

## M-2. `production_status` / `task_list_status` are query aliases, not real columns

- **Description.** The DB columns are `production_orders.status` and
  `production_task_lists.status`. Dashboard queries alias them
  (`status AS production_status`), and the shared types
  (`OrderStageInput.production_status`, `OrderInFlight.production_status`) use the
  alias name. A new query that selects `production_status` directly returns NULL
  (no such column) and silently maps to the "Awaiting task list" fallback — no
  runtime error.
- **Where it appears.** Any raw query feeding `computeOrderFlightStage`.
- **Related files/components.** `lib/lifecycle.ts` (`OrderStageInput`),
  `components/dashboard/OrdersInFlight.tsx`, the dashboard query layer.
- **Status.** **Confirmed** naming hazard.
- **Recommended next step (audit/clarify only).** Document the alias contract at
  the query boundary; consider centralizing the SELECT or renaming the type field
  to `status`. Cross-ref: POTENTIAL_INCONSISTENCIES.md §3; DATABASE_MODEL.md §13
  / §16.1; ORDER_LIFECYCLE.md §9.1; BUSINESS_RULES.md G9.

---

## M-3. Two unrelated concepts both called "validation"

- **Description.** Document **advisory validation** (m068; `none → pending →
  approved | rejected`; blocks nothing) and task-list **workflow validation**
  (`under_validation` / `validated`; blocks sales edits and gates PO creation)
  share the word "validation" but are entirely different systems.
- **Where it appears.** Document detail vs task-list detail; capability
  `task_list.validate` vs `validation_status`.
- **Related files/components.** `lib/validation.ts` (doc advisory), `lib/types.ts`
  (`ProductionTaskListStatus`), `lib/auth.ts` (`requireTaskListManagerOrAdmin`).
- **Status.** **Confirmed** terminology collision.
- **Recommended next step (audit/clarify only).** Owner decision on UI copy: e.g.
  doc = "Quotation review," task list = "Factory validation." Cross-ref:
  POTENTIAL_INCONSISTENCIES.md §6; ORDER_LIFECYCLE.md §9.2; UI_UX_AUDIT.md §13.2
  item 7; APP_OVERVIEW.md §8.

---

## M-4. Two parallel discussion systems with no cross-linking

- **Description.** `event_comments` (tied to an `event`, opened via the bell +
  `?event=`) and `entity_messages` (tied to an entity, opened via the global
  conversation launcher) are separate tables with separate drawers and separate
  read-state tables. A message in one is invisible in the other.
- **Where it appears.** Bell `?event=` drawer (`EventDiscussionPanel`) vs the
  global `ConversationDrawer`.
- **Likely cause.** Event comments (m044) predate entity messages (m049); both
  shipped.
- **Related files/components.** `lib/events.ts` / `EventDiscussionPanel.tsx` vs
  `lib/entity-messages.ts` / `components/chat/ConversationDrawer.tsx`.
- **Status.** **Confirmed** structural duplication; **Suspected** UX confusion.
- **Recommended next step (audit/clarify only).** Owner decision: pick a
  canonical discussion surface or clearly label "operational event thread" vs
  "entity chatter." Cross-ref: POTENTIAL_INCONSISTENCIES.md §7;
  NOTIFICATIONS_AND_MESSAGES.md §1 / §7.3; MISSING_DOCUMENTATION.md §3 item 2.
- **-> Owner decision (C) confirmed 2026-05-30 — direction chosen; not yet implemented.**
  `entity_messages` is the canonical discussion surface. `event_comments` remains only for
  comments on a specific operational event. The UI must present one main conversation area
  per entity; important events appear as contextual entries within or alongside it.
  Notification links to event comments must open the entity page and highlight the relevant
  event discussion in context. See OWNER_DECISIONS_LOG.md §C.

---

## M-5. The bell notifies on unread *comments*, not on event creation

- **Description.** The bell is a read-state view over `event_comments` (m045). A
  brand-new `high`/`critical` event with no comment (e.g. `po.cancelled`,
  `po.deadline_changed`) does **not** raise the bell count; it surfaces only in
  the Operations feed and (if a sensor matches) the Action Center.
- **Where it appears.** Top-nav bell.
- **Related files/components.** `lib/notifications.ts`
  (`getUnreadCommentCountsForUser`, `getNotificationSummary`).
- **Status.** **Confirmed**; **Suspected** product gap.
- **Recommended next step (audit/clarify only).** Owner decision: should event
  *creation* (for some severities/types) also ring the bell? Cross-ref:
  POTENTIAL_INCONSISTENCIES.md §13; NOTIFICATIONS_AND_MESSAGES.md §7.1 / §8;
  BUSINESS_RULES.md F7/H16.
- **-> Owner decision (D) confirmed 2026-05-30 — direction chosen; not yet implemented.**
  Direction chosen: bell on high/critical event creation. Critical events must always raise a
  bell notification. High events must raise a bell notification. Medium events raise a bell
  only if they require action from the user/role. Low/informational events do not ring the
  bell by default. Any unread comment on a visible event or entity discussion also raises a
  bell. Current behavior (comments-only) is the gap vs this target. See
  OWNER_DECISIONS_LOG.md §D.

---

## M-6. `FreightType` lacks the plain `40ft` that `ContainerType` allows

- **Description (verified).** `FreightType` (`lib/types.ts:818`) =
  `"LCL" | "20ft" | "40ft HC"` — **no plain `40ft`**. `ContainerType`
  (`lib/types.ts:823`) and the `document_containers.container_type` CHECK (fixed
  in m063) = `"LCL" | "20ft" | "40ft" | "40ft HC"` — **includes `40ft`**. The
  quote's freight-type selector can never represent `40ft`, but a container row
  can.
- **Where it appears.** Freight selection on the quote vs the container plan.
- **Likely cause.** m063 widened the container CHECK to add `40ft`; the
  `FreightType` union was not aligned at the same time.
- **Related files/components.** `lib/types.ts` (both unions),
  `supabase/migrations/063_fix_container_type_check.sql`.
- **Status.** **Confirmed** divergence; behavioral impact **Suspected**
  (probably tolerable since the two vocabularies need not match — but confusing).
- **Recommended next step (audit/clarify only).** Owner decision: align the two
  vocabularies, or document the difference as intentional. Cross-ref:
  POTENTIAL_INCONSISTENCIES.md §4; SHIPPING_AND_BL.md §8;
  PRODUCT_AND_PRICING_RULES.md §3.3; DATABASE_MODEL.md §16.4.

---

## M-7. Duplicate factory-mapping action/component files (and stray `.bak` artifacts)

- **Description.** The factory-mapping editor exists at two routes, each with its
  own near-duplicate `actions.ts` and `MappingRow.tsx`. Verified present:
  `app/(app)/factory-mapping/{actions.ts,MappingRow.tsx,page.tsx}` and
  `app/(app)/admin/factory-mapping/{actions.ts,MappingRow.tsx,page.tsx}`. The two
  surfaces exist on purpose (TLM reaches the top-level route outside the admin
  layout; admins use the in-shell route), but the duplicated action logic can
  drift.
- **`.bak` correction (verified).** POTENTIAL_INCONSISTENCIES.md §9 and
  MISSING_DOCUMENTATION.md §1 item 8 list committed `.bak` files
  (`admin/factory-mapping/actions.ts.bak`, `page_full.tsx.bak`,
  `page_full.tsx.bak2`). A current `find` across the tree returned **no `.bak`
  files** — they appear to have already been deleted since the upstream docs were
  written. **Needs confirmation** that the owner removed them deliberately.
- **Related files/components.** The four files listed above; the two `page.tsx`
  both gate on `isTechnicalRole`.
- **Status.** **Confirmed** the action/component duplication still exists;
  **Needs confirmation** that the `.bak` artifacts are truly gone.
- **Recommended next step (audit/clarify only).** Confirm the `.bak` files are
  gone (they appear to be). Note the duplicated `actions.ts` as a drift risk;
  recommend (not implement) extracting one shared implementation, and confirm
  both surfaces share the same gating. Cross-ref: POTENTIAL_INCONSISTENCIES.md §9;
  MODULES_AND_PAGES.md §6; MISSING_DOCUMENTATION.md §1 item 8.

---

## M-8. A regular `admin` cannot reach `/admin/users`, `/permissions`, or `/admin/diagnostics` by default

- **Description.** m026 seeds `admin.manage_users`, `admin.manage_permissions`,
  and `admin.diagnostics` to **`false`** for the `admin` role (super-admin only).
  The `/admin/*` layout admits an admin (`isAdminLike`), but the page then
  requires the specific capability and redirects to `/dashboard`. Net effect: an
  admin who clicks "Users" is bounced — the layout accepted them but the page
  rejected them. Non-obvious and easy to misread as a bug.
- **Where it appears.** `/admin/users`, `/permissions/*`, `/admin/diagnostics`.
- **Related files/components.** `supabase/migrations/026_role_permissions.sql`,
  `app/(app)/admin/users/page.tsx`, `app/(app)/permissions/layout.tsx`,
  `app/(app)/admin/diagnostics/page.tsx`, `lib/permissions.ts`.
- **Status.** **Confirmed** (per the seed + the two-gate route pattern);
  intentional per migration comments.
- **Recommended next step (audit/clarify only).** Document this as expected
  behavior (admins are *operational*; user/permission management is super-admin
  only by default, toggleable via `/permissions/actions`). Cross-ref:
  USER_ROLES_AND_PERMISSIONS.md §7.6; MODULES_AND_PAGES.md (admin routes).

---

## M-9. `updateProductionOrderStatus` enforces no transition graph

- **Description.** The status update action accepts **any** valid
  `ProductionOrderStatus` value — no ordering/transition graph is enforced (the
  DB CHECK validates the enum, not the sequence). The in-code comment explains
  production teams "sometimes need to skip steps (e.g. mark cancelled)." A PO can
  therefore jump backward or skip stages.
- **Where it appears.** `/production/orders/[id]` status control.
- **Related files/components.** `app/(app)/production/orders/actions.ts`
  (`updateProductionOrderStatus`, ~lines 97–103).
- **Status.** **Confirmed**; intentional flexibility (documented), but worth
  recording as "no guardrails."
- **Recommended next step (audit/clarify only).** Owner decision: is unrestricted
  status setting desired, or should some transitions be blocked/warned? Cross-ref:
  ORDER_LIFECYCLE.md §3.3 (note on transition graph) / §10.1 / §12 items 2 & 6.

---

## M-10. jsonb shapes have no DB-level schema

- **Description.** Several business-critical jsonb columns have **no DB CHECK / no
  JSON schema / no trigger** — their shape is enforced only in `lib/`. A direct
  SQL write can store an arbitrary shape. Affected: `production_orders.shipping_details`
  (m070), `clients.bl_profile` (m054), `production_task_lists.sticker_requirements`
  (m061) and `risk_flags` (m062), `documents.payment_terms` (m002/m019),
  `production_task_list_lines.factory_overrides` / `factory_extras` (m071),
  `client_technical_presets.mapping` / `extras` (m071).
- **Where it appears.** Any direct DB access; resilience of normalizers
  (`normalizeShippingDetails`, `normalizeBlProfile`, `normalizePaymentTerms`).
- **Related files/components.** `lib/shipping.ts`, `lib/bl.ts`, `lib/payment.ts`,
  `lib/types.ts` (`resolveFactoryInstruction`), the cited migrations.
- **Status.** **Confirmed**.
- **Recommended next step (audit/clarify only).** Produce a `JSONB_SHAPES.md`
  documenting each shape + invariants (already recommended in
  MISSING_DOCUMENTATION.md §5). Decide whether DB-level validation is wanted.
  Cross-ref: DATABASE_MODEL.md §4.2 / §16.2 / §16.6; MISSING_DOCUMENTATION.md §4
  item 2; SHIPPING_AND_BL.md §2.1 / §4.1.

---

## M-11. `action_acks.state` has no CHECK constraint

- **Description (verified).** m069 declares `state text not null default
  'acknowledged'` (line 31) and a defensive `add column if not exists state …`
  (line 37) — but **no `CHECK (state in (...))`**. Only `'acknowledged'` and
  `'done'` are written by the app; the allowed set is code-enforced, not
  DB-enforced.
- **Where it appears.** `action_acks` table.
- **Related files/components.** `supabase/migrations/069_action_acknowledgements.sql`,
  `lib/action-center.ts` (`applyAcks`), `app/(app)/dashboard-v2/actions.ts`.
- **Status.** **Confirmed**.
- **Recommended next step (audit/clarify only).** Document that the value set is
  code-enforced. Optionally recommend (not implement) a CHECK. Cross-ref:
  MISSING_DOCUMENTATION.md §4 item 4; DATABASE_MODEL.md §10.7 / §16.3.

---

## M-12. `DOC_TERMINAL_STATUSES` is defined twice (duplication; currently in sync)

- **Description (verified, with correction).** The constant
  `DOC_TERMINAL_STATUSES` is exported from **both** `lib/lifecycle.ts:63` and
  `lib/types.ts:882`. Both are currently `["won", "lost", "cancelled"]` —
  **identical**. BUSINESS_RULES.md B10 states that `won` is in the lifecycle.ts
  copy but *not* the types.ts copy; that is **inaccurate** as of this audit
  (both include `won`). The real issue is the duplication itself: two
  independent definitions of the same constant can silently diverge in future.
- **Where it appears.** Anywhere either module's terminal-status set is consumed.
- **Related files/components.** `lib/lifecycle.ts` (lines 63–80,
  `DOC_TERMINAL_STATUSES` / `DOC_DEAD_STATUSES` / `DOC_ALIVE_STATUSES`),
  `lib/types.ts` (lines 876–886, `DOC_ACTIVE_STATUSES` / `DOC_TERMINAL_STATUSES`).
- **Status.** **Confirmed** duplication; **Confirmed** currently in sync.
- **Recommended next step (audit/clarify only).** Note the duplicated constant as
  a drift hazard; correct the inaccurate "divergence" claim in BUSINESS_RULES.md
  B10. Recommend (not implement) a single source of truth. Cross-ref:
  BUSINESS_RULES.md B10.

---

## M-13. Two free-text BL "notes" fields with no structural distinction

- **Description.** Two unstructured notes spaces can hold BL/shipping
  instructions, with no rule on which the forwarder should consult:
  `clients.bl_profile.notes` (client level) and `production_orders.shipping_notes`
  (order level). There is no structured "BL instructions" / "shipping marks"
  field anywhere (see also M-15-adjacent shipping gaps).
- **Where it appears.** Client BL editor vs order Shipping/BL section.
- **Related files/components.** `lib/bl.ts` (`BlProfile.notes`), `lib/shipping.ts`,
  `production_orders.shipping_notes` column.
- **Status.** **Confirmed** (both exist; no structural distinction).
- **Recommended next step (audit/clarify only).** Owner decision: define which
  notes field is authoritative for the forwarder, and whether to add structured
  shipping marks / BL instructions. Cross-ref: SHIPPING_AND_BL.md §7.1 / §7.2;
  BUSINESS_RULES.md E6/H17; DATABASE_MODEL.md §15.

---

## M-14. `clients.commission_*` columns referenced but not found in migrations

- **Description.** `docs/current-implementation/DATABASE_STRUCTURE.md` references
  `clients.commission_*` columns, but the pricing audit found commission columns
  only on **`documents`** (m006), not on `clients`, in any reviewed migration. If
  the client columns do not exist, any "pre-populate quotation commission from a
  client default" expectation is unmet; if they do exist, the read path was not
  found.
- **Where it appears.** Commission configuration on clients vs documents.
- **Related files/components.** `supabase/migrations/006_*.sql`,
  `lib/commission.ts`, `clients` table.
- **Status.** ✅ **RESOLVED 2026-06-03** (live DB read via PostgREST, anon key).
  `clients` has **no** commission columns — probed `commission_percentage`,
  `commission_amount`, `commission_rate`, `commission_visible`,
  `commission_description`, `default_commission_percentage`, `commission_pct`; all
  return `42703 column does not exist`. Commission columns live **only on
  `documents`** (m006: `commission_percentage`, `commission_amount`,
  `commission_visible`, `commission_description` — all confirmed present). There is
  **no** per-client commission pre-population. **Action:** correct
  `DATABASE_STRUCTURE.md` to drop the `clients.commission_*` reference.
- **Recommended next step (audit/clarify only).** Done — see QUESTIONS_FOR_ME.md
  §5.7 / §1.6(b). Cross-ref: PRODUCT_AND_PRICING_RULES.md §5.5
  / §13 item 2; DATABASE_MODEL.md §5.1; BUSINESS_RULES.md H5.

---

## M-15. Pricing, commission, and forecast methodologies are undocumented

- **Description.** Three business-logic areas with real money/forecasting impact
  have **no canonical written rules** (code exists; intent is not captured):
  pricing modes/overrides/rounding/discounts (`lib/pricing.ts`, m001); commission
  computation and base (`lib/commission.ts`, m006); forecast probability bands /
  weighting / quarter logic (`lib/forecast.ts`, m050; a `ForecastMethodology`
  component exists in UI).
- **Where it appears.** Quote builder pricing, PDF commission, `/forecast`.
- **Related files/components.** `lib/pricing.ts`, `lib/commission.ts`,
  `lib/forecast.ts`, `components/forecast/ForecastMethodology.tsx`.
- **Status.** **Confirmed** absence of docs; **Needs confirmation** of intended
  rules (owner).
- **Recommended next step (audit/clarify only).** Owner to confirm intended
  pricing/commission/forecast rules; capture in a `PRICING_AND_COMMISSION.md` and
  forecast methodology doc. Cross-ref: MISSING_DOCUMENTATION.md §2 items 1–3;
  PRODUCT_AND_PRICING_RULES.md §13; BUSINESS_RULES.md H5–H7.

---

## M-16. `RUN_THIS_FIRST_production_setup.sql` bundles pre-m046 production-order RLS

- **Description.** The convenience bundle (verified present at
  `supabase/migrations/RUN_THIS_FIRST_production_setup.sql`) concatenates
  m018–m023 including the **original** `production_orders` RLS from m018, which
  predates the m046 isolation hardening. Re-running the bundle **after** m046
  could regress isolation, depending on the exact drop/create-policy ordering.
- **Where it appears.** Only when an operator runs the bundle.
- **Related files/components.** `supabase/migrations/RUN_THIS_FIRST_production_setup.sql`,
  `supabase/migrations/046_data_isolation_hardening.sql`.
- **Status.** **Confirmed** the bundle contains m018 policies; **Suspected** that
  re-running it after m046 regresses isolation (needs ordering verification).
- **Recommended next step (audit/clarify only).** Verify the policy
  drop/create ordering; add a do-not-run-after-m046 warning to the bundle (or
  regenerate it). Cross-ref: POTENTIAL_INCONSISTENCIES.md §10.

---

## M-17. No applied-migrations ledger (manual migration process)

- **Description.** 76 migrations are applied **manually** in Supabase, each
  ending with `notify pgrst, 'reload schema';`. No doc/table records which
  migrations are live in each environment. This is the root enabler of the
  "Done button" failure (H-3) and the defensive soft-fail patterns scattered
  through the codebase.
- **Where it appears.** Whole deployment process.
- **Related files/components.** `supabase/migrations/*.sql`; the soft-fail
  patterns in `lib/visibility.ts`, `app/(app)/dashboard-v2/actions.ts`, list
  pages (defensive column fallbacks).
- **Status.** **Confirmed** (process gap, not code defect).
- **Recommended next step (audit/clarify only).** Add a simple applied-migrations
  checklist/table per environment, and a `RUNBOOK.md`. Cross-ref:
  MISSING_DOCUMENTATION.md §1 item 6 / §4 item 7 / §5 item 1; BUSINESS_RULES.md
  G1/G7.

---

## M-18. `field_scope = 'technical'` write-enforcement gate not traced

- **Description.** Config fields carry a `field_scope` of `sales` or `technical`;
  `technical` fields are meant to be editable only by TLM/operations/admin. The
  exact server-action/RLS gate that blocks a sales user from writing a
  `technical`-scoped field was **not traced** in the audit — enforcement is
  assumed to be at the UI/server-action layer, not the DB.
- **Where it appears.** Task-list technical config editing.
- **Related files/components.** `lib/types.ts` (`ConfigFieldScope`,
  `ProductionTaskListLine`), task-list line server actions.
- **Status.** **Suspected** / **Needs confirmation**.
- **Recommended next step (audit/clarify only).** Trace the write path for
  `field_scope = 'technical'` and confirm sales cannot write those fields.
  Cross-ref: PRODUCT_AND_PRICING_RULES.md §2.4 / §13 item 10; BUSINESS_RULES.md
  C8.

---

# LOW

---

## L-1. "Task lists awaiting review" bell item is not a deep link

- **Description.** Unlike every other bell item (which uses `?event=`), the
  review aggregate links to `/task-lists` (the list page), forcing the reviewer
  to find the item.
- **Related files/components.** `lib/notifications.ts` (`buildReviewNotification`,
  `href:"/task-lists"`, ~line 313).
- **Status.** **Confirmed**; minor UX inconsistency.
- **Recommended next step (audit/clarify only).** Acceptable as an aggregate;
  optionally deep-link when count === 1. Cross-ref: POTENTIAL_INCONSISTENCIES.md
  §14; NOTIFICATIONS_AND_MESSAGES.md §7.2.

---

## L-2. Migration `040` is missing from the sequence (benign)

- **Description (verified).** The sequence jumps `039_event_status_comments.sql`
  → `041_baseline_locked_at.sql`; no `040_*.sql` exists.
- **Related files/components.** `supabase/migrations/`.
- **Status.** **Confirmed**; benign (no migration was ever numbered 040).
- **Recommended next step (audit/clarify only).** None required; note it so
  nobody hunts for a "lost" migration. Cross-ref: POTENTIAL_INCONSISTENCIES.md
  §15; DATABASE_MODEL.md (header) / §16.5.

---

## L-3. Capability count: 22 (code) vs "23" in older notes

- **Description (verified).** The `Capability` union in `lib/permissions.ts` has
  exactly **22** keys (grep-confirmed). Prior notes referenced "23." The DB
  catalog count is the open question (see also H-6 on `admin.diagnostics`).
- **Related files/components.** `lib/permissions.ts`, `permissions` table (m026).
- **Status.** **Confirmed** the union = 22; DB catalog count **Needs confirmation**.
- **Recommended next step (audit/clarify only).** Reconcile `permissions` rows
  against the 22-key union; remove/add the odd one out. Cross-ref:
  POTENTIAL_INCONSISTENCIES.md §16; USER_ROLES_AND_PERMISSIONS.md §4;
  BUSINESS_RULES.md G8/H11.

---

## L-4. Redirect stubs (intentional, preserve old bookmarks)

- **Description (verified).** Five `page.tsx` files contain only `redirect()`:
  `/` → `/dashboard`; `/order-follow-up` → `/operations`; `/production/orders`
  (list) → `/operations` (passes `?scope`/`?q`); `/production/queue` →
  `/task-lists`; `/permissions` → `/permissions/actions`.
- **Related files/components.** The five `app/(app)/.../page.tsx` stub files.
- **Status.** **Confirmed**; intentional.
- **Recommended next step (audit/clarify only).** Document the intended
  destinations so the stubs aren't mistaken for dead routes. Cross-ref:
  MODULES_AND_PAGES.md (Redirect stubs) / §5; APP_OVERVIEW.md §8;
  MISSING_DOCUMENTATION.md §3 item 1.

---

## L-5. iCloud Drive breaks `node_modules` / symlinks

- **Description.** The project lives under an iCloud Drive path
  (`…/com~apple~CloudDocs/…`); iCloud sync is known to corrupt `node_modules`
  and symlinks. This is an environment/build constraint, not a code defect, but
  it materially affects anyone trying to run the app.
- **Where it appears.** Local install/build (out of scope for this audit, which
  does not run the app).
- **Status.** **Confirmed** (environment constraint).
- **Recommended next step (audit/clarify only).** Capture in a `RUNBOOK.md`
  (work outside iCloud, or exclude `node_modules` from sync). Cross-ref:
  MISSING_DOCUMENTATION.md §1 item 6 / §5 item 1.

---

## L-6. `spec.md` is stale; "Quotation tool" label still in the UI

- **Description.** `spec.md` describes a small admin+sales "Quotation Tool"; the
  live app has 5 roles, a three-entity lifecycle, production tracking, a
  visibility engine, an event log, and an Action Center. The login page subtitle
  still reads "Quotation tool."
- **Related files/components.** `spec.md`, `app/login/page.tsx` (stale subtitle).
- **Status.** **Confirmed**.
- **Recommended next step (audit/clarify only).** Treat
  `docs/current-implementation/` (and these editable docs) as the baseline;
  archive or clearly mark `spec.md` as historical; decide whether to update the
  login subtitle. Cross-ref: MISSING_DOCUMENTATION.md §0; APP_OVERVIEW.md §1;
  MODULES_AND_PAGES.md (`/login`).

---

## L-7. Reserved / unused DB columns

- **Description.** Columns exist but are not surfaced/enforced by current UI:
  `entity_messages.request_type` / `parent_message_id` / `resolved_at` /
  `resolved_by` and the non-`comment` `message_kind` values (reserved for a
  future structured-request phase); `attachments.visible_sales` / `visible_ops` /
  `visible_factory` / `visible_client` (stored but not enforced — access is by
  affair ownership); `action_acks.note` (the primary note surface is
  `action_notes`, m075). Confirm none are silently expected to be live.
- **Related files/components.** `lib/entity-messages-shared.ts`, m049, m060, m069,
  m075.
- **Status.** **Confirmed** (present and unused).
- **Recommended next step (audit/clarify only).** Document these as
  reserved-not-live so they are not assumed functional. Cross-ref:
  DATABASE_MODEL.md §14; MISSING_DOCUMENTATION.md §4 item 5;
  NOTIFICATIONS_AND_MESSAGES.md §5.2.

---

## L-8. No taxes/VAT, no FX conversion, no explicit rounding in pricing

- **Description.** The pricing stack has **no** tax/VAT column or calculation, **no**
  currency-conversion (a USD tier price on an EUR document is used as-is), and
  **no** explicit rounding (full floating-point stored; `.toFixed(2)` is display
  only). Each may be intentional for an export business, but none is documented.
- **Related files/components.** `lib/pricing.ts`, `lib/commission.ts`,
  `app/(app)/documents/new/actions.ts`, `documents` / `document_lines`.
- **Status.** **Confirmed** (the absences); intent **Needs confirmation**.
- **Recommended next step (audit/clarify only).** Owner confirmation of each:
  taxes excluded by design? single pricing currency? floating-point acceptable?
  Cross-ref: PRODUCT_AND_PRICING_RULES.md §4.5 / §4.6 / §6 / §13 items 3–5.

---

## L-9. UI polish gaps (raw enums, `role·uuid`, disabled button, emoji)

- **Description.** Cosmetic/UX issues that need no redesign: production-order KPI
  tiles render raw enums (`IN PRODUCTION`) instead of the `*_STATUS_LABEL` maps;
  the Operations "Sales" column shows `role·uuid-slice` instead of display names
  (m052 exists); the "Unlock baseline" button is permanently disabled
  (false affordance); the Action Center note count uses a `💬` emoji against a
  no-emoji house style; two dashboards (`Dashboard` + `V2 ✦`) coexist in nav with
  no "default" signal.
- **Related files/components.** `app/(app)/production/orders/[id]/page.tsx`
  (KPI tiles, Unlock button), `app/(app)/operations/page.tsx` (`salesUserLabel`),
  `components/action-center/ActionCenter.tsx` (emoji), `components/Nav.tsx`.
- **Status.** **Confirmed** (all observed in source).
- **Recommended next step (audit/clarify only).** Owner decisions per
  UI_UX_AUDIT.md §13.2 / §14 (which are explicitly "fix without redesign"
  candidates — **not** to be implemented under this documentation-only audit).
  Cross-ref: UI_UX_AUDIT.md §10 / §13.2 / §14.

---

## L-10. `emitEvent` call-site coverage not enumerated

- **Description.** `emitEvent` is called `bestEffort: true` — failures are
  swallowed (console.warn) so the primary mutation succeeds. The full set of call
  sites across the 20 `actions.ts` files was not enumerated, so it is not
  confirmed that every meaningful lifecycle transition emits its expected
  `EventType`. A missing emit silently produces an incomplete audit trail/feed.
- **Related files/components.** `lib/events.ts` (`emitEvent`),
  `lib/events-shared.ts` (`EventType` catalog), `app/**/actions.ts` (20 files).
- **Status.** **Confirmed** swallow behavior; coverage **Needs confirmation**.
- **Recommended next step (audit/clarify only).** Enumerate all `emitEvent`
  calls and diff against the `EventType` catalog. Cross-ref:
  NOTIFICATIONS_AND_MESSAGES.md §3.1 / §7.7; MISSING_DOCUMENTATION.md §1 item 1;
  BUSINESS_RULES.md H4.

---

## L-11. `validated_at` / `validated_by` written but possibly absent from the TS type

- **Description.** `validateTaskList` stamps `validated_at` and `validated_by` on
  the task-list row, but ORDER_LIFECYCLE.md §12 item 8 notes these may not appear
  in the exported `ProductionTaskList` type in `lib/types.ts`. If a migration
  added the columns without a matching type update, type-level consumers won't
  see them.
- **Related files/components.** `app/(app)/task-lists/[id]/actions.ts`
  (`validateTaskList`), `lib/types.ts` (`ProductionTaskList`), m015.
- **Status.** **Needs confirmation** (type vs DB column reconciliation).
- **Recommended next step (audit/clarify only).** Confirm the columns exist
  (m015) and whether the TS type includes them. Cross-ref: ORDER_LIFECYCLE.md §12
  item 8; DATABASE_MODEL.md §3.1.

---

## L-12. `shipment_booked` boolean column vs `shipment_booked` status may diverge

- **Description.** `production_orders` has both a boolean `shipment_booked` column
  and a `shipment_booked` PO status value. `computeOrderFlightStage` reads the
  boolean for a context string. Whether the boolean is always set atomically with
  the status transition is unverified — they could desync.
- **Related files/components.** `lib/types.ts` (`ProductionOrder.shipment_booked`),
  `lib/lifecycle.ts` (`computeOrderFlightStage`),
  `app/(app)/production/orders/actions.ts` (`updateProductionOrderShipment` /
  `updateProductionOrderStatus`).
- **Status.** **Confirmed** both exist; sync **Needs confirmation**.
- **Recommended next step (audit/clarify only).** Confirm whether the boolean and
  the status are kept in lockstep. Cross-ref: ORDER_LIFECYCLE.md §10.2 / §12
  item 5.

---

## L-13. `production_delayed` status is never auto-set when a deadline passes

- **Description.** `production_delayed` exists in the PO enum and can be set
  manually, but no cron/trigger/background job promotes `in_production` →
  `production_delayed` when `current_production_deadline` passes. The
  `production_late` Action Center item and the render-time `overdue` alert are
  derived signals; neither writes the status. So an overdue order may remain
  `in_production` while alerts fire elsewhere.
- **Related files/components.** `app/(app)/production/orders/actions.ts`
  (`updateProductionOrderStatus`), `lib/action-center.ts` (`production_late`),
  `lib/operations-alerts.ts` (`overdue`).
- **Status.** **Suspected** (no auto-set found in code read; needs confirmation
  there is no trigger/cron).
- **Recommended next step (audit/clarify only).** Confirm there is no background
  mechanism; owner decision whether `production_delayed` should auto-set.
  Cross-ref: ORDER_LIFECYCLE.md §10.1 / §12 item 2;
  NOTIFICATIONS_AND_MESSAGES.md §6.2.

---

# Cross-cutting "Needs confirmation" (carried forward from the source docs)

These are open questions that recur across the audit and gate finalizing
`RULES.md`. They are not separate defects but should be resolved by the owner /
a live DB read:

1. **Default capability matrix in the live DB** — reconcile `role_permissions`
   rows against the 22-key `Capability` union (see H-6, L-3).
2. **Task-list creation trigger on Won** — confirmed manual in code; confirm no
   automation is intended (see H-2).
3. **Quotation editability after Won** — code blocks in-place edit of non-draft
   docs, but the `?revise` path is always reachable; owner to set the policy
   (see C-1, DRAFT_AND_EDITING_RULES.md §3.2 / §7).
4. **`clients.commission_*` existence** in the live DB (see M-14).
5. **`admin.diagnostics` permissions row** existence in the live DB (see H-6).
6. **jsonb shapes** — capture invariants in `JSONB_SHAPES.md` (see M-10).
7. **`emitEvent` coverage** across all 20 action files (see L-10).
8. **Versioning ↔ task-list linkage** — when a revised version is won, does the
   task list link to the won version or the root? `generateProductionTaskList`
   links by `quotation_id` (the specific doc UUID) — confirm this is intended
   (ORDER_LIFECYCLE.md §8.3 / §12 item 7).
9. **`entity_messages` RLS** — confirm it inherits the same sales isolation as
   the parent entity (NOTIFICATIONS_AND_MESSAGES.md §5.3).

---

*End of PROBLEMS_AND_INCONSISTENCIES.md. Documentation-only synthesis; no code
changed. Verified against the codebase at
`/Users/mehdizouai/Library/Mobile Documents/com~apple~CloudDocs/IA MEHDI CLAUDE/APP FACTURATION/`
on 2026-05-30.*
