# BUSINESS_RULES.md
## SOLUX — Editable Business Rules Source of Truth

> **How to use this file.**
> - This is the editable canonical reference. The owner can add notes, confirm
>   items, or strike out rules that no longer apply.
> - Each rule has: a one-line statement, a classification tag, related file paths,
>   related components/pages, and related DB fields.
> - Classification tags (EXACTLY ONE per rule):
>   - **Confirmed by code** — directly enforced or expressed in a cited file.
>   - **Assumed from code** — strongly implied by code/structure but no single
>     explicit enforcement point proves it.
>   - **Missing information** — referenced or expected but not provable from code;
>     needs a DB read or human confirmation.
>   - **Needs my confirmation** — owner must make an explicit product decision.
> - Rule IDs (A1, B1, …) are preserved from `BUSINESS_RULES_DETECTED.md` where
>   they existed; new rules from `RULES_CANDIDATE.md` carry an `RC-` prefix.
> - File paths are relative to the project root unless otherwise noted.
>
> Primary sources verified against: `lib/auth.ts`, `lib/permissions.ts`,
> `lib/visibility.ts`, `lib/lifecycle.ts`, `lib/production-lifecycle.ts`,
> `lib/delays.ts`, `lib/types.ts`, `lib/validation.ts`, `lib/bl.ts`,
> `lib/notifications.ts`, `lib/action-center.ts`, `lib/owner.ts`,
> `app/(app)/task-lists/[id]/actions.ts`, and the `supabase/migrations/`
> directory.

---

## A. Security and Access

---

### A1. All security decisions use the REAL role; UI rendering uses the EFFECTIVE role.

**Confirmed by code**

`getCurrentUserRole()` is explicitly documented: *"This function never reads the
View As cookie."* `getEffectiveRole()` is marked: *"Never use this for permission
checks. It only affects rendering."*

- **Related files:** `lib/auth.ts` (lines 11–46 `getCurrentUserRole`, lines 49–99
  `getEffectiveRole`); `lib/permissions.ts` (`hasCapability` calls
  `getCurrentUserRole`; `hasUiCapability` calls `getEffectiveRole`).
- **Related components/pages:** All server actions that gate mutations;
  `/view-as` page.
- **Related DB fields:** `user_roles.role`, `user_roles.super_admin`. Cookie:
  `solux_view_as_role`.

---

### A2. Only super-admins can simulate other roles (View-As).

**Confirmed by code**

`getEffectiveRole()`: non-super-admins always get `effectiveRole = realRole`;
the View-As cookie is read only when `isSuperAdmin === true`.

- **Related files:** `lib/auth.ts` (lines 65–98); `lib/types.ts`
  `VIEW_AS_ROLES`.
- **Related components/pages:** `/view-as` route.
- **Related DB fields:** `user_roles.super_admin` (boolean flag; the DB `role`
  column stays `"admin"` for RLS compatibility).

---

### A3. Physical DELETE of business records is super-admin only; regular admins must cancel or archive.

**Confirmed by code**

`requireSuperAdmin()` doc comment: *"Reserved for genuinely destructive
operations … Physical DELETE of business records (quotation / task list / PO)."*
Soft-delete model uses `archived_at` (m024) and status `cancelled`.

- **Related files:** `lib/auth.ts` (lines 144–151 `requireSuperAdmin`);
  `supabase/migrations/024_archived_at.sql`.
- **Related components/pages:** Any server action that issues a DELETE.
- **Related DB fields:** `archived_at` on `documents`, `production_task_lists`,
  `production_orders`.

---

### A4. Sales are isolated to their own clients and deals by default; no hardcoded client exceptions.

**Confirmed by code**

RLS policies added in m046, m058, m066 restrict `sales` role to records they
own. `lib/visibility.ts` legacy fallback: technical roles get `all: true`, sales
get `ownerIds: { self }`. The "no hardcoded client exceptions" constraint is
stated explicitly in the primary source.

- **Related files:** `lib/visibility.ts` (lines 91–95 legacy fallback);
  `supabase/migrations/046_data_isolation_hardening.sql`;
  `supabase/migrations/058_*.sql`; `supabase/migrations/066_*.sql`.
- **Related components/pages:** `/documents`, `/clients`, document list actions.
- **Related DB fields:** `clients.created_by`, `clients.sales_owner_id`,
  `documents.created_by`, `documents.sales_owner_id`.

---

### A5. The capability matrix gates actions only — not row visibility.

**Confirmed by code**

`lib/permissions.ts` header: *"App-level only. RLS policies on documents /
production_orders / etc. are NOT changed; the capability check happens in the
server action layer right before any mutation."* Capabilities have no effect on
SELECT.

- **Related files:** `lib/permissions.ts` (lines 9–12 architecture comment);
  `supabase/migrations/026_role_permissions.sql`.
- **Related DB tables:** `permissions`, `role_permissions`.
- **Related DB fields:** `role_permissions.permission_key`, `role_permissions.enabled`.

---

### A6. Visibility grants (lens/team/region) are enforced in application code only, not in database RLS.

**Confirmed by code**

`supabase/migrations/067_visibility_scopes.sql` header states: *"NO existing
table's RLS is changed."* `lib/visibility.ts` implements an app-level engine
with an explicit legacy fallback. This is a known gap — the visibility layer
must NOT be treated as a security boundary. Base RLS isolation plus capabilities
remain the real controls.

- **Related files:** `lib/visibility.ts`; `supabase/migrations/067_visibility_scopes.sql`.
- **Related DB tables:** `access_grants`, `teams`, `team_members`.
- **Related components/pages:** Any page that queries through `getVisibilityScope`.

---

### A7. Effective owner = `sales_owner_id` ?? `created_by`.

**Confirmed by code**

`lib/owner.ts effectiveOwnerId()` implements this directly. Used by list pages
and the visibility engine to determine row ownership.

- **Related files:** `lib/owner.ts` (lines 19–24 `effectiveOwnerId`);
  `lib/visibility.ts` (region-expansion path, lines 141–144).
- **Related DB fields:** `clients.sales_owner_id`, `clients.created_by`,
  `documents.sales_owner_id`, `documents.created_by`.

---

### A8. Technical roles (`task_list_manager`, `operations`) share the task-list and production scope.

**Confirmed by code**

`requireTaskListManagerOrAdmin()` gates both roles identically. `isTechnicalRole()`
in `lib/types.ts` (line 26–28) returns true for `admin`, `super_admin`,
`task_list_manager`, and `operations`. The doc comment states: *"Operations is
treated identically to Task List Manager — same scope of 'operational reality'
responsibilities."*

- **Related files:** `lib/auth.ts` (lines 120–129 `requireTaskListManagerOrAdmin`);
  `lib/types.ts` (lines 25–28 `isTechnicalRole`).
- **Related components/pages:** Task list validate/reject actions; factory mapping
  pages; production order timeline edits.

---

### A9 (RC-2.3). Visibility grants are advisory until RLS-enforced; they must NOT be treated as a security boundary.

**Needs my confirmation** — owner must decide whether to accept app-level-only
enforcement or plan Phase 2b RLS push.

- **Related files:** `lib/visibility.ts`; `supabase/migrations/067_visibility_scopes.sql`.
- See also: POTENTIAL_INCONSISTENCIES.md §5.

---

### A10. Default `role_permissions` matrix (which role gets which capability by default).

**Missing information** — the seed data lives in m026 and m053 migrations and
must be read from the DB or migration SQL to produce a human-readable table.
Not yet exported to any doc.

- **Related files:** `supabase/migrations/026_role_permissions.sql`;
  `supabase/migrations/053_*.sql`; `lib/permissions.ts Capability` union.
- See also: MISSING_DOCUMENTATION.md §1 item 5.

---

## B. Quotation / Document Rules

---

### B1. A quotation IS a document; its `status` is one of `draft / sent / negotiating / won / lost / cancelled`.

**Confirmed by code**

`lib/types.ts DocStatus` union (lines 852–858) and `PRODUCTION_ORDER_STATUSES`
(lines 503–514). CHECK constraint enforces the set in m008/m017.

- **Related files:** `lib/types.ts` (`DocStatus`, `DOC_STATUSES`, `DOC_STATUS_LABEL`);
  `supabase/migrations/008_*.sql`; `supabase/migrations/017_*.sql`.
- **Related DB fields:** `documents.status`.

---

### B2. `lost` is treated as cancelled for all downstream purposes; m023 trigger cascades `lost → cancelled` on the task list and production order.

**Confirmed by code**

`lib/lifecycle.ts isDocCancelled()` (lines 82–84): returns `true` for both
`'cancelled'` and `'lost'`. m023 DB triggers propagate the cancellation to
linked entities.

- **Related files:** `lib/lifecycle.ts` (lines 56–67 `DOC_DEAD_STATUSES`,
  lines 82–84 `isDocCancelled`);
  `supabase/migrations/023_lifecycle_propagation.sql`.
- **Related DB fields:** `documents.status`.

---

### B3. Cancelling a quotation cascades to its task lists and production orders (unless already cancelled or delivered).

**Confirmed by code**

DB triggers in m023 (`trg_propagate_doc_cancellation`) are the source of truth.
`CASCADE_RULES` in `lib/lifecycle.ts` (lines 214–236) mirrors them for
confirmation dialogs. A `delivered` production order is never auto-cancelled.

- **Related files:** `lib/lifecycle.ts` (lines 200–236 `CASCADE_RULES`,
  `describeCascade`);
  `supabase/migrations/023_lifecycle_propagation.sql`.
- **Related components/pages:** Cancel-quotation server action; cancellation
  confirm dialogs.
- **Related DB fields:** `documents.status`, `production_task_lists.status`,
  `production_orders.status`.

---

### B4. Advisory validation never blocks sending or winning a quote.

**Confirmed by code**

`lib/validation.ts` header: *"It is ADVISORY: a quote can always be sent / won
regardless of state."* `VALIDATION_HELP` for `pending` state reads: *"Sending
isn't blocked."*

- **Related files:** `lib/validation.ts`; `supabase/migrations/068_*.sql`.
- **Related DB fields:** `documents.validation_status`
  (`pending | approved | rejected`; `null` = never requested).

---

### B5. Quotation versioning: a revision shares `root_document_id` and increments `version`; downstream surfaces deduplicate to the latest version per affair.

**Confirmed by code**

m059 adds `root_document_id` and `version` columns. `lib/forecast.ts` dedupes
on latest version per affair (tasks #47–48 per primary source). The `affair_name`
field (m056) provides a human project label.

- **Related files:** `supabase/migrations/059_quotation_versioning.sql`;
  `lib/forecast.ts`; `supabase/migrations/056_affair_name.sql`.
- **Related DB fields:** `documents.root_document_id`, `documents.version`,
  `documents.affair_name`.

---

### B6. Owner (and admin) can delete a quotation regardless of its status.

**Confirmed by code**

RLS m057 allows the owner to DELETE. Capability `quotation.delete` (m055) is
the app-layer gate. The exact interaction between RLS ownership check and the
capability is: **Assumed from code** (both exist; the combined effect needs
operator confirmation).

- **Related files:** `supabase/migrations/057_*.sql`;
  `supabase/migrations/055_*.sql`; `lib/permissions.ts Capability`.
- **Related DB fields:** `documents.created_by`, `documents.sales_owner_id`.

---

### B7. `client_code` is exactly three uppercase letters.

**Confirmed by code**

CHECK constraint `^[A-Z]{3}$` in m006.

- **Related files:** `supabase/migrations/006_*.sql`.
- **Related DB fields:** `clients.client_code`.

---

### B8. Currency is one of `USD / EUR / CNY`; payment mode is one of `deposit_balance / lc / hybrid`.

**Confirmed by code**

`lib/types.ts Currency` (line 791) and `PaymentMode` (line 931).
DB-level CHECK constraints in m005, m002, and m019.

- **Related files:** `lib/types.ts` (`Currency`, `PaymentMode`);
  `supabase/migrations/005_*.sql`; `supabase/migrations/019_*.sql`.
- **Related DB fields:** `documents.currency`, `documents.payment_mode`.

---

### B9 (RC-4.1). New quotations start as `draft`; valid forward transitions are `draft → sent → negotiating → won / lost`.

**Confirmed by code**

Enforced by the `DocStatus` enum (lib/types.ts lines 852–866) and the CHECK
constraint in migrations. Transition ownership is `sales` (assumed from
`quotation.create` capability).

- **Related files:** `lib/types.ts` (`DocStatus`, `DOC_ACTIVE_STATUSES`,
  `DOC_TERMINAL_STATUSES`); `lib/lifecycle.ts`.
- **Related DB fields:** `documents.status`.

---

### B10. Whether a won quotation is editable in place or must be revised (versioned).

**Needs my confirmation** — the code does not enforce a read-only gate on `won`
documents. The flight-stage comment says "Deal won — task list not started yet",
implying the quote itself stays queryable; but whether sales can still EDIT its
fields (price, lines) post-win is a product decision not enforced in code.

- **Related files:** `lib/lifecycle.ts`; `lib/types.ts DOC_TERMINAL_STATUSES`
  (note: `won` IS included in terminal statuses in `lib/lifecycle.ts` but NOT in
  `lib/types.ts DOC_TERMINAL_STATUSES` — these two definitions differ, see
  POTENTIAL_INCONSISTENCIES.md §11).
- **Related DB fields:** `documents.status`.

---

## C. Task List Rules

---

### C1. A task list is created from a Won quotation; the production order is auto-created when the task list flips to `validated`.

For the TASK LIST creation: **Assumed from code** — `lib/lifecycle.ts
computeOrderFlightStage()` has a final fallback "Deal won — task list not
started yet" (line 354), implying a manual creation step after Won. No
DB trigger or server action auto-creates the task list on win was found.

For the PRODUCTION ORDER creation: **Confirmed by code** — `lib/types.ts`
(lines 483–489) comment: *"Auto-created when a task list flips to 'validated';
one per task list."* Confirmed by `ensureProductionOrderForTaskList()` in
`app/(app)/task-lists/[id]/actions.ts` (lines 415–566), called at transition
to `validated` (line 644).

- **Related files:** `lib/lifecycle.ts` (line 354 fallback);
  `app/(app)/task-lists/[id]/actions.ts` (`ensureProductionOrderForTaskList`,
  transition function, line 644); `lib/types.ts` (lines 483–489);
  `supabase/migrations/020_backfill_production_orders.sql`.
- **Related components/pages:** `/task-lists/[id]`; `/production/orders/[id]`.
- **Related DB fields:** `production_task_lists.status`,
  `production_orders.task_list_id`.

---

### C2. Task lists become locked for sales edits once submitted for review.

**Confirmed by code**

`lib/types.ts TASK_LIST_LOCKED_FOR_SALES` (lines 421–426) = `[under_validation,
validated, production_ready, cancelled]`. Sales can only edit again when the
TLM bounces it back to `needs_revision`.

- **Related files:** `lib/types.ts` (lines 421–426 `TASK_LIST_LOCKED_FOR_SALES`).
- **Related components/pages:** Task list edit form / submit-for-review action.
- **Related DB fields:** `production_task_lists.status`.

---

### C3. Only `task_list_manager`, `operations`, and `admin`-level roles can validate or reject task lists.

**Confirmed by code**

`lib/auth.ts requireTaskListManagerOrAdmin()` gates these transitions.
Capabilities `task_list.validate` and `task_list.reject` (defined in
`lib/permissions.ts`).

- **Related files:** `lib/auth.ts` (lines 120–129);
  `lib/permissions.ts` (`Capability` union).
- **Related components/pages:** Task list validate / reject server actions.
- **Related DB fields:** `production_task_lists.status`.

---

### C4. A task list is "production-ready" (eligible for a production order) at status `validated` OR `production_ready`.

**Confirmed by code**

`lib/lifecycle.ts TASK_LIST_PRODUCTION_STATUSES` (lines 113–116) = `[validated,
production_ready]`. Used by `components/dashboard/OrdersInFlight.tsx
resolveOrderRowHref`.

- **Related files:** `lib/lifecycle.ts` (lines 113–116);
  `components/dashboard/OrdersInFlight.tsx`.
- **Related DB fields:** `production_task_lists.status`.

---

### C5. Factory overrides and extras never overwrite the sales configuration; resolution priority is override > client_preset > mapping > missing.

**Confirmed by code**

`lib/types.ts resolveFactoryInstruction()` (lines 281–350) implements the exact
priority in code. m071 adds `factory_overrides` and `factory_extras` columns on
`production_task_list_lines`. Described as a "standing product rule."

- **Related files:** `lib/types.ts` (lines 252–350 `resolveFactoryInstruction`);
  `supabase/migrations/071_factory_overrides.sql`.
- **Related DB fields:** `production_task_list_lines.factory_overrides`,
  `production_task_list_lines.factory_extras`.

---

### C6. Factory mapping access is restricted to `task_list_manager`, `operations`, and `super_admin` via the `factory_mapping.access` capability.

**Confirmed by code**

Capability `factory_mapping.access` defined in `lib/permissions.ts` (line 63).
Migration m064 seeds the `role_permissions` rows.

- **Related files:** `lib/permissions.ts` (line 63);
  `supabase/migrations/064_factory_mapping_access.sql`.
- **Related components/pages:** `/factory-mapping`; `/admin/factory-mapping`.

---

### C7 (RC-5.3). Custom option values are stored as the sentinel `"__custom__"` in `config_values`; config fields opt into custom via `allow_custom_value`.

**Confirmed by code**

`lib/types.ts CUSTOM_OPTION_SENTINEL` (line 150) = `"__custom__"`.
`resolveConfigValue()` (lines 161–171) handles display — the sentinel must
never leak to end users or PDFs.

- **Related files:** `lib/types.ts` (lines 148–176).
- **Related DB fields:** `document_lines.config_values`,
  `config_fields.allow_custom_value`.

---

### C8. Per-line technical fields required before task list submission.

**Needs my confirmation** — the code defines `technical_values` on task list
lines and a `technical` scope on config fields, but there is no explicit
validation rule in code that lists which technical fields are required before
`draft → under_validation`. This is a product decision.

- **Related files:** `lib/types.ts` (`ConfigFieldScope`, `ProductionTaskListLine`);
  `supabase/migrations/071_factory_overrides.sql`.
- **Related DB fields:** `production_task_list_lines.technical_values`,
  `config_fields.field_scope`.

---

## D. Production Order Rules

---

### D1. Production "activates" when the deposit is fully received OR when a start-without-deposit override fires.

**Confirmed by code**

`lib/production-lifecycle.ts getProductionStartDate()` (lines 57–66): returns
`deposit_received_at` first, then the date portion of `deposit_override_at`.
`isProductionActive()` (lines 73–77) returns true when `getProductionStartDate
!== null`.

- **Related files:** `lib/production-lifecycle.ts` (lines 57–88);
  `supabase/migrations/025_deposit_override.sql`.
- **Related DB fields:** `production_orders.deposit_received_at`,
  `production_orders.deposit_override_at`, `production_orders.deposit_override_by`,
  `production_orders.deposit_override_reason`.

---

### D2. The Initial Project Completion is stamped ONCE at production activation (`start_date + production_working_days`) and then frozen.

**Confirmed by code**

`lib/production-lifecycle.ts getInitialProjectCompletion()` (lines 150–153) reads
the stored `initial_production_deadline` column — never recomputes.
`computeInitialProjectCompletionForActivation()` (lines 184–198) is the
one-time write path. May 2026 revision comment confirms: baseline locks at
activation, not at first `working_days` save.

- **Related files:** `lib/production-lifecycle.ts` (lines 94–198);
  `supabase/migrations/041_baseline_lock.sql`.
- **Related DB fields:** `production_orders.initial_production_deadline`,
  `production_orders.production_working_days`, `production_orders.baseline_locked_at`.

---

### D3. The baseline locks at activation, NOT at first `working_days` save.

**Confirmed by code**

`lib/production-lifecycle.ts isBaselineLocked()` (lines 114–126): locked when
`baseline_locked_at` is set OR when `isProductionActive()` is true (legacy safety
net). The May 2026 revision comment in the source explicitly corrects the old
`validation_date + working_days` formula.

- **Related files:** `lib/production-lifecycle.ts` (lines 94–126).
- **Related DB fields:** `production_orders.baseline_locked_at`.

---

### D4. Operational delay = `current_production_deadline − initial_production_deadline` (in calendar days).

**Confirmed by code**

Both `lib/production-lifecycle.ts computeBaselineDelay()` (lines 220–233) and
`lib/types.ts computeProductionDelay()` (lines 732–744) implement `current −
initial` in milliseconds converted to days. They are functionally identical.

- **Related files:** `lib/production-lifecycle.ts` (lines 220–233);
  `lib/types.ts` (lines 732–744).
- **Related DB fields:** `production_orders.current_production_deadline`,
  `production_orders.initial_production_deadline`.

---

### D5. Deadlines move by additive delay events, never by overwriting `current_production_deadline` directly.

**Confirmed by code**

`production_deadline_changes.days_added` (m073) is the signed delta per event.
`lib/delays.ts addDaysIso()` (lines 161–167) computes the new date from
`current + days_added`. Described as an "Explicit product decision."

- **Related files:** `lib/delays.ts` (lines 92–167);
  `supabase/migrations/073_deadline_days_added.sql`.
- **Related DB fields:** `production_deadline_changes.days_added`,
  `production_deadline_changes.new_date`, `production_deadline_changes.previous_date`.

---

### D6. Only `delay_type = 'production'` (or NULL legacy) counts toward the factory KPI; external delays surface but do not inflate it.

**Confirmed by code**

`lib/delays.ts isFactoryDelay()` (lines 79–82): `t == null || t === "production"`.
`computeDelayBreakdown()` (lines 133–157) splits changes into `factoryDays` vs
`externalDays`. Legacy NULL rows are treated as `production` for KPI stability;
operators can re-tag.

- **Related files:** `lib/delays.ts` (lines 78–157);
  `supabase/migrations/072_delay_type.sql`.
- **Related DB fields:** `production_deadline_changes.delay_type` (`production |
  payment | shipping | client_change | client_waiting | supplier | customs | other`).

---

### D7. Delay events are editable but audit-logged (not strictly immutable).

**Confirmed by code**

m074 adds `updated_by` and `updated_at` columns to `production_deadline_changes`.
The primary source notes this is an "Explicit product decision over strict
immutability."

- **Related files:** `supabase/migrations/074_deadline_change_audit.sql`.
- **Related DB fields:** `production_deadline_changes.updated_by`,
  `production_deadline_changes.updated_at`.

---

### D8. Payment state derives from deposit/balance received versus expected amounts from quotation payment terms.

**Confirmed by code**

`lib/types.ts computeProductionPaymentState()` (lines 665–700) computes one of:
`no_terms / awaiting_deposit / deposit_received / partial_balance / paid_in_full /
no_deposit_required`. 1-cent epsilon tolerance for rounding. Expected deposit
computed from `paymentTerms.deposit_percent` and `paymentMode`.

- **Related files:** `lib/types.ts` (lines 622–713).
- **Related DB fields:** `production_orders.deposit_received_amount`,
  `production_orders.balance_received_amount`; `documents.payment_mode`,
  `documents.payment_terms`.

---

### D9. A `delivered` production order is never auto-cancelled by an upstream cancellation.

**Confirmed by code**

`lib/lifecycle.ts CASCADE_RULES` (lines 214–236): `skipIfStatusIn` includes
`"delivered"` for both document→PO and task_list→PO cascades. The DB trigger
in m023 matches this logic.

- **Related files:** `lib/lifecycle.ts` (lines 214–236);
  `supabase/migrations/023_lifecycle_propagation.sql`.
- **Related DB fields:** `production_orders.status`.

---

### D10. "Completed" is defined two different ways in two modules.

**Confirmed by code** (inconsistency, not a rule — document for owner resolution)

`lib/production-lifecycle.ts getLifecyclePhase()` (line 265) marks an order
`completed` when `actual_completion_date` is set. `lib/lifecycle.ts
computeOrderFlightStage()` (line 323) shows "Production complete" on PO
status `production_completed` (phase 4). A PO could have status
`production_completed` without `actual_completion_date`, or vice versa.

- **Related files:** `lib/production-lifecycle.ts` (lines 254–268);
  `lib/lifecycle.ts` (lines 307–355).
- **Needs my confirmation:** Define ONE canonical rule for "production is
  complete" and align both modules.
- **Related DB fields:** `production_orders.actual_completion_date`,
  `production_orders.status`.

---

## E. Shipping and Bill of Lading Rules

---

### E1. Shipping data is split across three entities: parties on the client BL profile, ports/incoterm/containers on the quotation, and BL execution on the production order.

**Confirmed by code**

`lib/shipping.ts` and `lib/bl.ts` headers describe this architecture.
`lib/bl.ts BlProfile` type (lines 55–62) covers parties. m054 stores the BL
profile per client. m070 stores `shipping_details` (BL execution) on the
production order.

- **Related files:** `lib/bl.ts`; `lib/shipping.ts`;
  `supabase/migrations/054_bl_profile.sql`;
  `supabase/migrations/070_shipping_details.sql`.
- **Related DB fields:** `clients.bl_profile` (jsonb, m054);
  `documents.port_of_loading`, `documents.port_of_discharge`, `documents.incoterm`;
  `document_containers`; `production_orders.shipping_details` (jsonb, m070).

---

### E2. Default shipper is the Solux factory and is prefilled on every client BL profile.

**Confirmed by code**

`lib/bl.ts SOLUX_SHIPPER_DEFAULT` (lines 69–76): `"CHANGZHOU SOLUX TECHNOLOGY
COMPANY LTD"`, contact `vera@zr-light.com.cn`. `normalizeBlProfile()` backfills
this when a profile has no shipper.

- **Related files:** `lib/bl.ts` (lines 68–76, `normalizeBlProfile`).
- **Related DB fields:** `clients.bl_profile` (jsonb — `shipper` key).

---

### E3. BL/destination follow-up applies only for seller-ships incoterms (CFR/CIF/DDP/DDU) or LCL freight.

**Confirmed by code**

`lib/action-center.ts blRequired()` and `SHIPPING_INCOTERMS` constant
determine when BL tracking is required.

- **Related files:** `lib/action-center.ts` (`blRequired`, `SHIPPING_INCOTERMS`).
- **Related DB fields:** `documents.incoterm`, `documents.freight_type`.

---

### E4. Consignee can prefill from the client; notify party can prefill from the consignee.

**Confirmed by code**

`lib/bl.ts BlConsignee.same_as_client` (line 23) and
`BlNotify.same_as_consignee` (line 36) flags enable these prefill shortcuts.

- **Related files:** `lib/bl.ts` (lines 22–41).
- **Related DB fields:** `clients.bl_profile` (jsonb — `consignee`, `notify` keys).

---

### E5. The BL document checklist tracks required export documents with optional per-document cost; file upload is intentionally out of scope.

**Confirmed by code**

`lib/bl.ts BL_DOCUMENT_CATALOG` and the comment: *"File upload is intentionally
out of scope for now."*

- **Related files:** `lib/bl.ts` (lines 80+, `BL_DOCUMENT_CATALOG`,
  `blDocumentCostByCurrency`).
- **Related DB fields:** `clients.bl_profile` (jsonb — `documents` array).

---

### E6. Shipping marks and structured BL instructions fields are not modeled; only free-text notes exist.

**Confirmed by code**

Confirmed by absence in `lib/bl.ts`, `lib/shipping.ts`, and migrations.
The `bl_profile` schema includes `notes: string | null` as the only
free-form field.

- **Related files:** `lib/bl.ts` (`BlProfile` type); `lib/shipping.ts`.
- **Needs my confirmation:** Decide whether to add structured shipping marks
  and BL instruction fields in a future migration.

---

### E7. `shipping_details` key names are inconsistent between modules (confirmed bug).

**Confirmed by code** (inconsistency)

`lib/shipping.ts ShippingDetails` uses keys `forwarder` and `vessel`.
`lib/action-center.ts blIsFilled()` reads `forwarder_name` and `vessel_name`.
This means entering the forwarder/vessel on an order does NOT clear the
"BL missing destination" action-center card.

- **Related files:** `lib/action-center.ts` (`blIsFilled`); `lib/shipping.ts`
  (`ShippingDetails`).
- **Needs my confirmation:** Align to `forwarder` / `vessel` in `blIsFilled`
  (do NOT rename stored keys). See POTENTIAL_INCONSISTENCIES.md §1.
- **Related DB fields:** `production_orders.shipping_details` (jsonb, m070).

---

### E8. `FreightType` lacks the plain `40ft` that `ContainerType` allows.

**Confirmed by code** (inconsistency)

`lib/types.ts FreightType` (line 818) = `"LCL" | "20ft" | "40ft HC"` — missing
`"40ft"`. `ContainerType` (line 823) = `"LCL" | "20ft" | "40ft" | "40ft HC"`.

- **Related files:** `lib/types.ts` (lines 817–823);
  `supabase/migrations/063_fix_container_type_check.sql`.
- **Needs my confirmation:** Are freight-type and container-type vocabularies
  intentionally different, or should they align?
- **Related DB fields:** `documents.freight_type`, `document_containers.container_type`.

---

## F. Notification and Collaboration Rules

---

### F1. The bell notifies a user when an event they can see has unread comments from someone else; technical roles also receive a task-list review aggregate.

**Confirmed by code**

`lib/notifications.ts getNotificationSummary()` (lines 71–278): steps 1–3
aggregate events with unread comments. `buildReviewNotification()` (lines 287–318)
adds the TLM/ops aggregate for `under_validation` task lists. New events without
comments do NOT raise the bell.

- **Related files:** `lib/notifications.ts`; `lib/events.ts`
  (`getUnreadCommentCountsForUser`).
- **Related DB tables:** `events`, `event_comments`, `event_reads`.

---

### F2. Clicking a notification opens the entity page AND overlays the discussion drawer via `?event=<id>`.

**Confirmed by code**

`lib/notifications.ts` (lines 261–265): href is built as
`${entityHref}?event=${e.id}`. The entity page reads the param and mounts
`EventDiscussionPanel`.

- **Related files:** `lib/notifications.ts` (lines 261–265);
  `lib/events-shared.ts eventEntityHref`.
- **Related components/pages:** `EventDiscussionPanel`; all entity detail
  pages.

---

### F3. Events are immutable; status changes and replies are new rows/comments.

**Confirmed by code**

`lib/events.ts` header: *"Every critical workflow action emits an event."*
m022 defines `events` as INSERT-only. `emitEvent()` always inserts.

- **Related files:** `lib/events.ts` (INSERT-only pattern);
  `supabase/migrations/022_events.sql`.
- **Related DB tables:** `events`, `event_comments`.

---

### F4. Action Center items are derived live and auto-clear when the condition resolves; `resolution='manual'` items offer Acknowledge or Done.

**Confirmed by code**

`lib/action-center.ts` architecture comment: sensors → registry → materialize.
m069 `action_acks.state` stores `'acknowledged' | 'done'`. `resolution=
'auto_clear'` items vanish when the underlying condition is resolved.

- **Related files:** `lib/action-center.ts`; `supabase/migrations/069_action_acknowledgements.sql`;
  `app/(app)/dashboard-v2/actions.ts` (`markActionDone`).
- **Related DB tables:** `action_acks`.
- **Related DB fields:** `action_acks.state`.

---

### F5. Action Center notes and entity messages are intentionally micro-coordination, not a general chat system.

**Confirmed by code**

`lib/action-center.ts` header: *"Visibility (which ROWS) stays in
lib/visibility.ts; the registry controls which KINDS a role sees."*
m075 `action_notes` table; `lib/entity-messages-shared.ts` header
limits scope.

- **Related files:** `lib/action-center.ts` (header);
  `lib/entity-messages-shared.ts`; `supabase/migrations/075_action_notes.sql`.
- **Related DB tables:** `action_notes`, `entity_messages`.

---

### F6. Entity-message threads attach to entity detail routes only (not list pages or `/new` routes).

**Confirmed by code**

`lib/conversation-context.ts` resolves the entity from the URL; only entity
detail routes (e.g. `/documents/[id]`, `/task-lists/[id]`,
`/production/orders/[id]`, `/clients/[id]`) have valid entity IDs in the path.

- **Related files:** `lib/conversation-context.ts`.
- **Related components/pages:** `components/chat/ConversationDrawer.tsx`.

---

### F7. Whether event creation (not just unread comments) should raise the bell.

**Needs my confirmation** — currently the bell ONLY triggers on unread comments
(step 1–3 in `getNotificationSummary`). A new high-severity event with no
comment does not ring the bell. This may be a gap for critical operational events.
See POTENTIAL_INCONSISTENCIES.md §13.

- **Related files:** `lib/notifications.ts`.

---

## G. Implementation Discipline Rules

---

### G1. Every migration is idempotent and ends with `notify pgrst, 'reload schema';`.

**Confirmed by code**

Observed in every migration inspected (m067, m069, m070, m075, etc.).

- **Related files:** `supabase/migrations/*.sql`.

---

### G2. Semantic status questions go through `lib/lifecycle.ts`, not inline `status === 'cancelled'`.

**Confirmed by code**

`lib/lifecycle.ts` header (lines 1–27): explicit instruction — *"If you find
yourself writing `status === 'cancelled'` inline in a server action or page,
please reach for the helpers here instead."*

- **Related files:** `lib/lifecycle.ts`.

---

### G3. Pure (client+server-safe) logic is split from server-only modules.

**Confirmed by code**

Rationale documented in `lib/entity-messages-shared.ts` split vs
`lib/entity-messages.ts`. `lib/production-lifecycle.ts` header: *"All functions
here are pure — no Supabase, no `next/headers`. Safe to import from client AND
server."*

- **Related files:** `lib/entity-messages-shared.ts`; `lib/entity-messages.ts`;
  `lib/production-lifecycle.ts`; `lib/delays.ts`; `lib/types.ts`.

---

### G4. Soft-fail only on schema-missing errors; real errors (RLS/permission) must surface.

**Confirmed by code**

`app/(app)/dashboard-v2/actions.ts isMissingActionAcksSchema` and
`isMissingActionNotesSchema`: strict pattern-matched on the exact column-missing
error string. All other errors propagate.

- **Related files:** `app/(app)/dashboard-v2/actions.ts`.

---

### G5. The canonical order stage is computed by ONE function (`computeOrderFlightStage`); components must not re-derive stage inline.

**Confirmed by code**

`lib/lifecycle.ts computeOrderFlightStage()` (lines 307–355) is the single
source of truth. The 6-phase pipeline `Quote → Task list → Payment → Production
→ Shipping → Delivered` is defined in `ORDER_FLIGHT_PHASES` (line 257).
Standing user instruction per primary source.

- **Related files:** `lib/lifecycle.ts` (lines 257–355).
- **Related components/pages:** `components/dashboard/OrdersInFlight.tsx`.

---

### G6. A delay number is never shown without the resulting ETA — always pair "+Nd" with the current ETA.

**Confirmed by code**

`lib/lifecycle.ts computeOrderFlightStage()` (lines 325–327): delay context
always appends current ETA when available. Stated as a "Standing user
instruction" in the primary source.

- **Related files:** `lib/lifecycle.ts` (lines 325–327).
- **Related components/pages:** `components/dashboard/OrdersInFlight.tsx`.

---

### G7. Migrations are applied manually in Supabase; never assume a migration is live until confirmed in the target environment.

**Confirmed by code**

Documented in `PRODUCT_OVERVIEW.md` §4 and `lib/visibility.ts` header (soft-fail
to legacy if m067 isn't applied). The `isMissingActionAcksSchema` pattern exists
specifically because m069 might not be applied.

- **Related files:** `lib/visibility.ts` (soft-fail comment);
  `app/(app)/dashboard-v2/actions.ts` (schema-missing patterns).

---

### G8. Capability count: 22 keys in `lib/permissions.ts`; DB catalog may differ.

**Confirmed by code** (inconsistency to resolve)

`lib/permissions.ts Capability` union (lines 52–79) has exactly **22** keys.
Prior audit notes referenced 23 DB catalog rows. A stale row may exist.

- **Related files:** `lib/permissions.ts`; `permissions` table (m026).
- **Needs my confirmation:** Reconcile the `permissions` catalog rows against
  the `Capability` union.

---

### G9. Query aliases that rename columns must be centralized; downstream types must not drift from DB columns.

**Confirmed by code** (known issue)

`production_orders.status` is aliased as `production_status` in dashboard queries;
`lib/lifecycle.ts OrderStageInput` uses `production_status` as a field name. A
new query without the alias would return `null` for this field silently.
See POTENTIAL_INCONSISTENCIES.md §3.

- **Related files:** `lib/lifecycle.ts` (`OrderStageInput`);
  `components/dashboard/OrdersInFlight.tsx`.

---

## Summary: Missing Information / Needs Confirmation

The following items cannot be resolved from code alone and require owner input
before finalizing `RULES.md`.

| # | Item | Classification | Related files |
|---|------|---------------|---------------|
| H1 | Default `role_permissions` matrix — which role gets which capability | **Missing information** | `supabase/migrations/026_role_permissions.sql`; `lib/permissions.ts` |
| H2 | Whether winning a deal auto-creates the task list (or requires a manual step) | **Needs my confirmation** | `lib/lifecycle.ts` (line 354 fallback); task-list creation server action |
| H3 | Whether a won quotation is editable in place or revise-only (versioned) | **Needs my confirmation** | `lib/types.ts DOC_TERMINAL_STATUSES`; document edit server actions |
| H4 | `emitEvent` call-site map — which transitions emit which `EventType` | **Missing information** | `app/**/actions.ts` (20 files); `lib/events.ts` |
| H5 | Commission calculation rules | **Missing information** | `lib/commission.ts`; `clients.commission_*` DB fields |
| H6 | Pricing rules (modes, overrides, rounding, discounts) | **Missing information** | `lib/pricing.ts`; `supabase/migrations/001_advanced_pricing.sql` |
| H7 | Forecast methodology (probability bands, weighting, quarter logic) | **Missing information** | `lib/forecast.ts`; `supabase/migrations/050_*.sql` |
| H8 | One canonical definition of "production completed" (reconcile `actual_completion_date` vs status `production_completed`) | **Needs my confirmation** | `lib/production-lifecycle.ts getLifecyclePhase`; `lib/lifecycle.ts computeOrderFlightStage` |
| H9 | `shipping_details` key alignment (`forwarder` vs `forwarder_name`) | **Needs my confirmation** | `lib/action-center.ts blIsFilled`; `lib/shipping.ts ShippingDetails` |
| H10 | `FreightType` vs `ContainerType` vocabulary alignment | **Needs my confirmation** | `lib/types.ts`; `supabase/migrations/063_fix_container_type_check.sql` |
| H11 | Capability count discrepancy (22 in code vs DB catalog) | **Needs my confirmation** | `lib/permissions.ts`; `permissions` table |
| H12 | Per-line technical fields required before task-list submission | **Needs my confirmation** | `lib/types.ts ConfigFieldScope`; task-list validation action |
| H13 | Deposit / balance policy (default %, balance due trigger, `no_deposit_required` meaning) | **Needs my confirmation** | `lib/types.ts computeExpectedDeposit`; `supabase/migrations/048_*.sql` |
| H14 | `start_without_deposit` authorization policy (who may approve, risk accepted) | **Needs my confirmation** | `lib/permissions.ts production_order.start_without_deposit`; m025 |
| H15 | Delay-type taxonomy business definitions (per `DelayType` value) | **Needs my confirmation** | `lib/delays.ts DELAY_TYPE_CONTEXT` (code-only today) |
| H16 | Whether event creation (not just comments) should trigger the notification bell | **Needs my confirmation** | `lib/notifications.ts` |
| H17 | Structured shipping marks and BL instructions fields (add or keep free-text only) | **Needs my confirmation** | `lib/bl.ts BlProfile`; `lib/shipping.ts` |

---

*Last updated by code audit: 2026-05-30. Verified against codebase at
`/Users/mehdizouai/Library/Mobile Documents/com~apple~CloudDocs/IA MEHDI CLAUDE/APP FACTURATION/`.*
