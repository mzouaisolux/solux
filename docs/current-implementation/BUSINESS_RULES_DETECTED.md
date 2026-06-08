# Business Rules Detected — Current Implementation

> **Audit note.** Each rule is tagged:
> - **[Confirmed by code]** — directly enforced/expressed in a cited file.
> - **[Assumed from code]** — strongly implied by code/structure but not a single
>   explicit enforcement point.
> - **[Missing information]** — referenced or expected but not provable here;
>   needs confirmation.
>
> File paths and DB fields are cited per rule. Migration files are under
> `supabase/migrations/`.

---

## A. Security & access

**A1. All security decisions use the REAL role; UI uses the EFFECTIVE role.**
- **[Confirmed by code]** `lib/auth.ts` (`getCurrentUserRole` never reads the
  View-As cookie; `getEffectiveRole` honors it for super-admins only).
- DB fields: `user_roles.role`, `user_roles.super_admin`. Cookie:
  `solux_view_as_role`.

**A2. Only super-admins can simulate other roles (View-As).**
- **[Confirmed by code]** `lib/auth.ts getEffectiveRole` (non-super-admins get
  `effectiveRole = realRole`). Pages: `/view-as`.

**A3. Physical DELETE of business records is super-admin only; admins must
cancel or archive.**
- **[Confirmed by code]** `lib/auth.ts requireSuperAdmin` + its doc comment;
  soft-delete model in m024 (`archived_at`), cancellation via status.

**A4. Sales are isolated to their own clients/deals by default.**
- **[Confirmed by code]** RLS m046 / m058 / m066; `lib/visibility.ts` legacy
  fallback (sales = own, technical = all). Standing rule: **no hardcoded client
  exceptions**.
- DB fields: `clients.created_by`, `clients.sales_owner_id`,
  `documents.created_by`, `documents.sales_owner_id`.

**A5. Capability matrix gates actions only — not row visibility.**
- **[Confirmed by code]** `lib/permissions.ts` (30s cache, fail-closed),
  tables `permissions` + `role_permissions` (m026). Comment states RLS is
  unchanged by the matrix.

**A6. Visibility grants (lens/team/region) are enforced in app code, not RLS.**
- **[Confirmed by code]** `m067` header ("NO existing table's RLS is changed"),
  `lib/visibility.ts`. → Gap, see POTENTIAL_INCONSISTENCIES.md.

**A7. Effective owner = `sales_owner_id` ?? `created_by`.**
- **[Confirmed by code]** `lib/owner.ts effectiveOwnerId` (m066).

**A8. Technical roles (`task_list_manager`, `operations`) share the task-list /
production scope.**
- **[Confirmed by code]** `lib/auth.ts requireTaskListManagerOrAdmin`,
  `lib/types.ts isTechnicalRole`. Default split of `production_order.*`
  capabilities between them: **[Missing information]** (`role_permissions`).

---

## B. Quotation / document rules

**B1. A quotation IS a document; its status is one of draft/sent/negotiating/
won/lost/cancelled.**
- **[Confirmed by code]** `lib/types.ts DocStatus`; CHECK in m008/m017.

**B2. `lost` is treated as cancelled for downstream purposes.**
- **[Confirmed by code]** `lib/lifecycle.ts isDocCancelled` (lost ∨ cancelled);
  m023 trigger cascades `lost → cancelled` downstream.

**B3. Cancelling a quotation cascades to its task lists and production orders
(unless already cancelled/delivered).**
- **[Confirmed by code]** `supabase/migrations/023_lifecycle_propagation.sql`
  (triggers) + `lib/lifecycle.ts CASCADE_RULES` (mirror for confirm dialogs).

**B4. Advisory validation never blocks sending/winning a quote.**
- **[Confirmed by code]** `lib/validation.ts` header + states
  (pending/approved/rejected); m068. DB: `documents.validation_status`.

**B5. Quotation versioning: a revision shares `root_document_id` and increments
`version`; surfaces dedupe to the latest version per affair.**
- **[Confirmed by code]** m059; `lib/forecast.ts` dedupe (tasks #47–48).
  DB: `documents.root_document_id`, `documents.version`.

**B6. Owner (and admin) can delete a quotation regardless of status.**
- **[Confirmed by code]** RLS m057; capability `quotation.delete` (m055).

**B7. `client_code` is exactly three uppercase letters.**
- **[Confirmed by code]** CHECK regex `^[A-Z]{3}$` (m006). DB: `clients.client_code`.

**B8. Currency is one of USD/EUR/CNY; payment mode one of
deposit_balance/lc/hybrid.**
- **[Confirmed by code]** `lib/types.ts Currency`, `PaymentMode`; m005/m002/m019.

---

## C. Task list rules

**C1. The task list is created from a Won quotation (not auto-created on win).**
- **[Assumed from code]** `lib/lifecycle.ts` fallback "Deal won — task list not
  started yet". Auto-creation path: **[Missing information]**.

**C2. Task lists become locked for sales once submitted for review.**
- **[Confirmed by code]** `lib/types.ts TASK_LIST_LOCKED_FOR_SALES =
  [under_validation, validated, production_ready, cancelled]`.

**C3. Only TLM/operations/admin validate or reject task lists.**
- **[Confirmed by code]** `lib/auth.ts requireTaskListManagerOrAdmin`;
  capabilities `task_list.validate` / `task_list.reject`.

**C4. A task list is "production-ready" for an order at status validated or
production_ready.**
- **[Confirmed by code]** `lib/lifecycle.ts TASK_LIST_PRODUCTION_STATUSES`,
  `components/dashboard/OrdersInFlight.tsx resolveOrderRowHref`.

**C5. Factory overrides/extras never overwrite the sales configuration.**
- **[Confirmed by code]** `lib/types.ts resolveFactoryInstruction` priority
  (override > client_preset > mapping > missing); m071 (`factory_overrides`,
  `factory_extras` on `production_task_list_lines`). Standing product rule.

**C6. Factory mapping is factory-only (TLM/Operations/Super-Admin).**
- **[Confirmed by code]** capability `factory_mapping.access` (m064); pages
  `/factory-mapping`, `/admin/factory-mapping`.

---

## D. Production order rules

**D1. Production "activates" when the deposit is fully received OR a
start-without-deposit override fires.**
- **[Confirmed by code]** `lib/production-lifecycle.ts` (`getProductionStartDate`,
  `isProductionActive`, comments). DB: `deposit_received_at`,
  `deposit_override_at` (m025).

**D2. The Initial Project Completion is stamped once at activation
(`start_date + working_days`) and then frozen.**
- **[Confirmed by code]** `lib/production-lifecycle.ts getInitialProjectCompletion`
  reads the stored `initial_production_deadline`; `computeInitialProjectCompletionForActivation`
  is the write path. DB: `initial_production_deadline`,
  `production_working_days`, `baseline_locked_at` (m041).

**D3. The baseline locks at activation, NOT at first working_days save.**
- **[Confirmed by code]** `lib/production-lifecycle.ts isBaselineLocked` + the
  May-2026 revision comment.

**D4. Operational delay = current_production_deadline − initial_production_deadline.**
- **[Confirmed by code]** `lib/production-lifecycle.ts computeBaselineDelay` ≡
  `lib/types.ts computeProductionDelay`.

**D5. Deadlines move by additive delay events, never by overwriting.**
- **[Confirmed by code]** `production_deadline_changes.days_added` (m073);
  `lib/delays.ts`. Explicit product decision.

**D6. Only `delay_type='production'` (or NULL legacy) counts toward the factory
KPI; external delays surface but don't poison it.**
- **[Confirmed by code]** `lib/delays.ts isFactoryDelay`,
  `computeDelayBreakdown`. DB: `production_deadline_changes.delay_type` (m072).

**D7. Delay events are editable but audit-logged.**
- **[Confirmed by code]** m074 (`updated_by`, `updated_at`). Explicit product
  decision over strict immutability.

**D8. Payment state derives from deposit/balance vs expected amounts.**
- **[Confirmed by code]** `lib/types.ts computeExpectedDeposit/Balance`,
  `computeProductionPaymentState` (no_terms/awaiting_deposit/deposit_received/
  partial_balance/paid_in_full/no_deposit_required).

---

## E. Shipping / BL rules

**E1. Shipping data is split across client (parties), quote (ports/incoterm/
containers) and order (BL execution).**
- **[Confirmed by code]** `lib/shipping.ts` header; `lib/bl.ts`; m054/m070;
  `documents.port_of_*`, `incoterm`, `document_containers`.

**E2. Default shipper is the Solux factory and is prefilled on every client BL
profile.**
- **[Confirmed by code]** `lib/bl.ts SOLUX_SHIPPER_DEFAULT`, `normalizeBlProfile`
  backfill.

**E3. BL/destination follow-up applies only for seller-ships incoterms
(CFR/CIF/DDP/DDU) or LCL freight.**
- **[Confirmed by code]** `lib/action-center.ts blRequired`,
  `SHIPPING_INCOTERMS`.

**E4. Consignee can prefill from the client; notify can prefill from consignee.**
- **[Confirmed by code]** `lib/bl.ts` `BlConsignee.same_as_client`,
  `BlNotify.same_as_consignee`.

**E5. BL document checklist tracks required export docs + optional cost; file
upload is out of scope.**
- **[Confirmed by code]** `lib/bl.ts BL_DOCUMENT_CATALOG`,
  `blDocumentCostByCurrency`, header comment.

**E6. Shipping marks and structured BL instructions are not modeled.**
- **[Confirmed by code]** absence in `bl.ts`/`shipping.ts`/migrations. → see
  SHIPPING_PROCESS.md.

---

## F. Notification / collaboration rules

**F1. A user is notified (bell) when an event they can see receives an unread
comment from someone else; technical roles also get a review aggregate.**
- **[Confirmed by code]** `lib/notifications.ts`. New events without comments
  do **not** raise the bell. DB: `events`, `event_comments`, `event_reads`.

**F2. Clicking a notification opens the entity page AND overlays the discussion
drawer (`?event=`).**
- **[Confirmed by code]** `lib/notifications.ts` href builder +
  `eventEntityHref` (`events-shared.ts`) + `EventDiscussionPanel`.

**F3. Events are immutable; status/replies are new rows/comments.**
- **[Confirmed by code]** m022; `lib/events.ts` (INSERT-only).

**F4. Action Center items are derived live and disappear when the condition
resolves; "follow-up" items can be acknowledged or marked Done.**
- **[Confirmed by code]** `lib/action-center.ts`; m069 (`action_acks.state`).

**F5. Action Center notes are micro-coordination, not a chat system.**
- **[Confirmed by code]** `lib/action-center.ts attachNotes`, m075
  (`action_notes`); header comments.

**F6. Entity-message threads attach to detail routes only (not list pages /
`/new`).**
- **[Confirmed by code]** `lib/conversation-context.ts`.

---

## G. Implementation-discipline rules (observed conventions)

**G1. Migrations are idempotent and end with `notify pgrst, 'reload schema';`.**
- **[Confirmed by code]** every migration inspected (e.g. m067, m069, m070).

**G2. Semantic status questions go through `lib/lifecycle.ts`, not inline
`status === 'cancelled'`.**
- **[Confirmed by code]** `lib/lifecycle.ts` header instruction.

**G3. Pure (client+server-safe) logic is split from server-only modules (which
import `@/lib/supabase/server`).**
- **[Confirmed by code]** `lib/entity-messages-shared.ts` vs
  `lib/entity-messages.ts` split rationale.

**G4. Soft-fail only on schema-missing; real errors (RLS/permission) must
surface.**
- **[Confirmed by code]** `app/(app)/dashboard-v2/actions.ts`
  `isMissingActionAcksSchema` / `isMissingActionNotesSchema` (strict patterns).

---

## H. Rules referenced but NOT provable here ([Missing information])

- Default `role_permissions` matrix (which role gets which capability).
- Whether winning a deal auto-creates the task list.
- Whether a quotation becomes read-only once `won` / in production.
- Exact `emitEvent` call sites (which transitions log events).
- Commission calculation rules (`lib/commission.ts`, `clients.commission_*`) —
  present but not audited this pass.
- Pricing rules (`lib/pricing.ts`, advanced pricing m001) — present but not
  audited this pass.
