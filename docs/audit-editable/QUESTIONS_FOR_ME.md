# Questions For Me — Owner Decisions Needed Before Final Rules

> **Note:** Top-priority ★ questions answered 2026-05-30 (see OWNER_DECISIONS_LOG.md).
> ✅ **ALL remaining questions resolved 2026-06-03** — each is stamped inline below as
> **RATIFIED** (confirmed-by-code rule, 19), **DECIDED** (owner decision, 48), or
> **CONFIRMED** (live-DB read, 3). No open items remain. The next phase is doc
> integration + the priority doc backlog (§10.2), then finalizing RULES.md.
> *Markers:* ✅ RATIFIED / ✅ DECIDED / ✅ CONFIRMED / ✅ ANSWERED (★, 2026-05-30).

> **What this is.** A single, grouped, numbered checklist of every concrete
> decision the **owner (you)** must make before `RULES.md` can be finalized.
> Each question is phrased so you can answer **yes/no** or **pick one**, and
> each cites the file/area it comes from.
>
> **How it was built.** Synthesized from every `[CONFIRM]` item in
> `docs/current-implementation/RULES_CANDIDATE.md`, every open item in
> `docs/current-implementation/MISSING_DOCUMENTATION.md`, all 16 items in
> `docs/current-implementation/POTENTIAL_INCONSISTENCIES.md`, and every
> "Needs confirmation" / `[Needs confirmation]` / `[CONFIRM]` marker found
> across the 11 sibling docs in `docs/audit-editable/` (≈100 markers total).
>
> **Audit-only.** Nothing here changes the application. Citations are
> relative to the project root. `[Confirmed by code]` = the cited behavior is
> verified in code; `[Assumed from code]` = inferred and itself needs your
> confirmation.
>
> **How to answer.** Write your decision inline after each item (e.g.
> `→ DECISION: yes` / `→ DECISION: option B`). Items are deliberately small so
> they map 1:1 onto rules.
>
> **Groups (fixed order):** 1) Business rules · 2) User roles ·
> 3) Order lifecycle · 4) UI/UX · 5) Database · 6) Shipping / BL ·
> 7) Notifications · 8) Pricing · 9) Documents.
>
> **★ = highest-leverage** (blocks multiple downstream rules or is a known
> behavioral hazard). Answer the ★ items first.

---

## 0. Top priority — answer these first (★)

These nine recur across multiple docs and gate the most rules.

- ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (A) — Manual creation, mandatory and highly visible; alert shown until task list is created.
  **★ A. Task list on Won** — ~~Should winning a deal **auto-create** the
  production task list, or stay a **manual** step?~~ *(see §3.1)*
- ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (B) — Revise-only / new version; direct editing blocked after won; task-list impact reviewed on revision.
  **★ B. Won quote editing** — ~~Once a quote is `won`, is it **editable in place**,
  **revise-only (new version)**, or **fully locked**?~~ *(see §9.1)*
- ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (C) — Entity messages are canonical; event comments for event-specific operational follow-up only.
  **★ C. Canonical discussion surface** — ~~Pick ONE: **event comments** or
  **entity messages** as the canonical "talk about this" surface.~~ *(see §7.4)*
- ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (D) — High/critical events raise bell even without a comment; medium only if action required; low/informational do not.
  **★ D. Bell on event creation** — ~~Should creating a high/critical **event**
  raise the bell, or keep bell = **unread comments only**?~~ *(see §7.1)*
- ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (E) — Must eventually be RLS-enforced; current app-level filtering is interim state, not final security model.
  **★ E. Visibility = security?** — ~~Should lens/team/region grants be enforced
  at **RLS (DB)**, or remain **advisory app-level only**?~~ *(see §1.3)*
- ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (F) — Won+no-task-list: admin-only with audit log; won+task-list/PO: blocked, use cancel/archive instead; archive requires a reason.
  **★ F. Owner delete at any status** — ~~Should an owner/admin be allowed to
  **delete a `won` quotation** and cascade-delete its production order?~~ *(see §9.2)*
- ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (G) — Approved fix (not yet applied); align to read `forwarder`/`vessel`; `forwarder` alone clears BL-missing alert.
  **★ G. `shipping_details` key fix** — ~~Approve aligning `blIsFilled` to read
  `forwarder`/`vessel` (the keys actually stored) so the BL action self-clears?~~ *(see §6.1)*
- ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.1–H.10) — Catalogue pricing with controlled override; discounts traced with approval tiers; tax-free; 2-decimal rounding; 30% deposit default; Africa 20-day balance reminder; 30/7-day validity windows; warranty by product; no-deposit requires explicit authorization.
  **★ H. Pricing & commission rules** — ~~Provide the intended pricing modes,
  discount, tax, rounding, and commission basis (today code-only, undocumented).~~ *(see §8 and §1.6/§1.7)*
- ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (I) — Do NOT ratify yet; export to human-readable CAPABILITY_MATRIX.md for owner review first.
  **★ I. Default role × capability matrix** — ~~Ratify the seeded defaults from
  `role_permissions` (m026/m053) as the intended matrix?~~ *(see §2.1)*

---

## 1. Business rules

1. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Real vs effective role.** Confirm the rule: **all** permission/security
   checks use the REAL role (`getCurrentUserRole`); only rendering uses the
   EFFECTIVE (View-As) role. Ratify as a binding rule?
   *(RULES_CANDIDATE §2.1 [CODE]; `lib/auth.ts`, `lib/view-as.ts`)*

2. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Capabilities gate actions, not visibility.** Confirm the rule: capabilities
   grant the ability to **act**, never row **visibility**. Ratify?
   *(RULES_CANDIDATE §2.2 [CODE])*

3. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (E) — Must eventually be RLS-enforced; current app-level filtering documented as interim state.
   **★ Is visibility a security boundary?** ~~Today lens/team/region grants are
   enforced **only in app code** (`lib/visibility.ts`); base RLS isolation +
   capabilities are the real controls. **Pick one:**
   (a) keep advisory app-level only and document the trust boundary, or
   (b) push scope predicates into **RLS** (Phase 2b).~~
   *(POTENTIAL_INCONSISTENCIES #5; DATABASE_MODEL §16.10; RULES_CANDIDATE §2.3 [CONFIRM]; m067 "NO existing table's RLS is changed")*

4. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **No hardcoded client exceptions.** Confirm the rule: sales see only their own
   clients/deals; **never** any hardcoded client allow-list. Ratify?
   *(RULES_CANDIDATE §2.4 [CODE])*

5. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Effective owner formula.** Confirm: effective owner =
   `sales_owner_id ?? created_by`. Ratify as the canonical ownership rule?
   *(RULES_CANDIDATE §2.5 [CODE])*

6. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.1) — Commission computed from finalized commercial basis, rounded to 2 decimals; see H.1 for pricing/override details. Sub-question (b) RESOLVED 2026-06-03 (live DB): `clients` has **no** commission columns; they live **only on `documents`** (m006), so there is no per-client pre-population — see §5.7. Sub-question (a) basis is covered by H.1/H.5 (finalized commercial basis, 2-decimal rounding).
   **★ Commission rules.** ~~Define how commission is computed and on what basis.
   Sub-questions: (a) Is it a percentage of `grand_total` or of margin?
   (b) Do per-client `clients.commission_*` columns exist and pre-populate a new
   quote, or do commission columns live **only on `documents`** (m006)?~~
   *(BUSINESS_RULES gap; PRODUCT_AND_PRICING_RULES §5.5 / item 2; RULES_CANDIDATE §2.7 [CONFIRM]; `lib/commission.ts`)*

7. ✅ DECIDED 2026-06-03 — Adopt the in-UI `ForecastMethodology` (probability bands, weighted value, quarter logic) as the canonical documented methodology.
   **★ Forecast methodology.** Confirm/define the probability bands, weighted
   value, and quarter logic shown by `ForecastMethodology`. Is the in-UI
   methodology the canonical one to write down?
   *(RULES_CANDIDATE §2.8 [CONFIRM]; `lib/forecast.ts`, m050)*

8. ✅ DECIDED 2026-06-03 — Only `production`/null delays are factory-attributable (ratified). Standard external defs: customs = port/clearance hold; supplier = component/raw-material lateness; client_waiting = awaiting customer info/approval/payment.
   **Delay-type taxonomy ownership.** `isFactoryDelay` = production/null is coded.
   Confirm the **business definition** of each external `DelayType`
   (customs vs supplier vs client_waiting) and that only production/null counts
   as factory-attributable. Ratify?
   *(MISSING_DOCUMENTATION §2.8; `lib/delays.ts` / delay model)*

9. ✅ DECIDED 2026-06-03 — Aligns with H.10 — sales cannot authorize alone; sales-manager/director or admin/super-admin may; store reason + approver + timestamp.
   **"Start without deposit" policy.** Who may authorize
   `production_order.start_without_deposit`, and what risk does it represent?
   (Capability gate exists; the policy is unwritten.)
   *(MISSING_DOCUMENTATION §2.7)*

10. ✅ DECIDED 2026-06-03 — Approve the current `LENS_STATUSES` mapping (production/finance/logistics) as-is.
   **Lens semantics sign-off.** Confirm what each lens
    (production / finance / logistics) **should** expose (`LENS_STATUSES`).
    Approve the current mapping?
    *(MISSING_DOCUMENTATION §2.10)*

11. ✅ DECIDED 2026-06-03 — Ratify the coded escalation thresholds as the baseline SLA; document rationale per stage; tunable later.
   **Action Center SLA rationale.** The escalation timings (`addRoles` in
    `ACTION_TYPES`) are coded; confirm the business rationale per stage so the
    thresholds can be ratified.
    *(MISSING_DOCUMENTATION §2.9; `lib/action-center.ts`)*

12. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Action Center scope guard.** Should Action Center notes / entity messages
    stay strictly **micro-coordination** (must NOT grow into a general chat
    system)? Ratify as a rule?
    *(RULES_CANDIDATE §7.6 [CONFIRM])*

---

## 2. User roles

1. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (I) — Do NOT ratify yet; generate CAPABILITY_MATRIX.md for owner review first; current seeded permissions are a technical baseline only.
   **★ Ratify the default role × capability matrix.** ~~Adopt the seeded defaults
   in `role_permissions` (m026 + m053 backfill) as the **intended** matrix?
   A human-readable export does not yet exist (proposed `CAPABILITY_MATRIX.md`).~~
   *(MISSING_DOCUMENTATION §1.5; USER_ROLES_AND_PERMISSIONS §8)*

2. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **TLM vs operations are identical by default — intended?** Verified that
   `task_list_manager` and `operations` have **identical** `production_order.*`
   defaults (edit_status/deadline/payments/shipment, set_timeline; neither has
   start_without_deposit/archive/delete). Confirm this parity is intentional.
   *(USER_ROLES_AND_PERMISSIONS §7.4 [Confirmed by migration])*

3. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Regular admin cannot manage users/permissions/diagnostics by default —
   intended?** m026 sets `admin.manage_users`, `admin.manage_permissions`,
   `admin.diagnostics` = **false** for `admin`; only `super_admin` gets them.
   An admin who opens `/admin/users` is redirected to `/dashboard`. Confirm this
   is the desired split (super-admin-only administration)?
   *(USER_ROLES_AND_PERMISSIONS §7.6 [Confirmed by migration])*

4. ✅ DECIDED 2026-06-03 — Reconcile the capability catalog to the 22-key `Capability` union (resolve the 22-vs-23 / `admin.diagnostics` row).
   **Capability count: 22 vs 23.** The `Capability` union has **22** keys;
   prior notes referenced 23 in the DB catalog, and `admin.diagnostics` may have
   **no DB row** (m026/m053/m064 seed 21). Should the catalog be reconciled to
   the union (add/remove the odd one out)?
   *(POTENTIAL_INCONSISTENCIES #16; DATABASE_MODEL §16.9; MISSING_DOCUMENTATION §1.5)*

5. ✅ DECIDED 2026-06-03 — Target full migration to `requireCapability`; retire legacy `requireAdmin` / `requireTaskListManagerOrAdmin`.
   **Finish the `requireCapability` migration?** Both guard systems coexist —
   `requireCapability` is used in some actions, legacy `requireAdmin` /
   `requireTaskListManagerOrAdmin` in others. Should we treat **full migration
   to `requireCapability`** as the target rule?
   *(USER_ROLES_AND_PERMISSIONS §7.8 [Needs confirmation])*

6. ✅ DECIDED 2026-06-03 — Add a route guard: admin + super_admin + a designated finance/exec capability (so a non-admin exec can be granted access later).
   **`/business` route guard.** No in-code guard was verified for `/business`
   (exec KPIs). Which roles should see it, and should a guard be required?
   *(USER_ROLES_AND_PERMISSIONS line 512 [Needs confirmation])*

7. ✅ DECIDED 2026-06-03 — Add in-body capability checks to `admin/products/images` and `admin/products/import` (defense-in-depth).
   **Defense-in-depth on admin sub-pages.** `admin/products/images` and
   `admin/products/import` rely on the **layout guard only** (no in-body role
   check). Add an in-body `requireAdmin()`/capability check as cheap insurance?
   *(POTENTIAL_INCONSISTENCIES #12; RULES_CANDIDATE §9.6 [CONFIRM])*

8. ✅ DECIDED 2026-06-03 — Drop `super_admin` from `VIEW_AS_ROLES` (no-op selection).
   **View-As scope.** `VIEW_AS_ROLES` includes `super_admin` itself (a no-op
   selection). Keep it in the picker, or drop it to avoid confusing maintainers?
   *(USER_ROLES_AND_PERMISSIONS §7.5 [Confirmed by code])*

---

## 3. Order lifecycle

1. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (A) — Keep manual; after won, show mandatory "Create Production Task List" alert until task list is created.
   **★ Auto-create task list on Won?** ~~Verified: `generateProductionTaskList`
   (`app/(app)/documents/[id]/actions.ts:194`) has **no `status === 'won'` gate**
   — it only checks "already linked", then creates; it is invoked manually from
   the UI. **Decide:** (a) keep manual, or (b) auto-create on the `won`
   transition. Also: should a "Create Task List" button be gated to `won`?~~
   *(ORDER_LIFECYCLE §12.1/§12.3; RULES_CANDIDATE §3.5 [CONFIRM]; MISSING_DOCUMENTATION §2.4)*

2. ✅ DECIDED 2026-06-03 — Status is canonical — status='production_completed' is the source of truth; actual_completion_date is stamped on that transition (audit timestamp); getLifecyclePhase must read status. Aligns with ratified 3.8.
   **Single canonical "completed" definition.** Two definitions disagree:
   `getLifecyclePhase` calls a PO `completed` when `actual_completion_date` is
   set, while `computeOrderFlightStage` shows "Production complete" on status
   `production_completed`. **Pick the canonical signal** (status vs date) and
   have both derive from it.
   *(POTENTIAL_INCONSISTENCIES #11; ORDER_LIFECYCLE §12; DATABASE_MODEL §16.7; RULES_CANDIDATE §3.7 [CONFIRM])*

3. ✅ DECIDED 2026-06-03 — Keep the status change MANUAL; add an Action Center 'production overdue' sensor when current_production_deadline passes. No silent auto-flip.
   **Auto-set `production_delayed`?** Is there meant to be a cron/trigger/job that
   flips a PO to `production_delayed` when `current_production_deadline` passes,
   or is it **always manual**? (No background job found.)
   *(ORDER_LIFECYCLE §12.2 [Needs confirmation])*

4. ✅ DECIDED 2026-06-03 — Allow `production_delayed → in_production` (delays can resolve).
   **`production_delayed` reversible?** Once `production_delayed`, may the PO go
   back to `in_production`? (`updateProductionOrderStatus` allows free-form
   transitions; the flow diagram implies forward-only.) Confirm intended.
   *(ORDER_LIFECYCLE §12.6 [Needs confirmation in practice])*

5. ✅ DECIDED 2026-06-03 — Set the `shipment_booked` boolean atomically with the `'shipment_booked'` status transition (rule).
   **`shipment_booked` boolean ↔ status sync.** Should the boolean
   `production_orders.shipment_booked` always be set **atomically** with the
   status transition to `'shipment_booked'`? Make it a rule?
   *(ORDER_LIFECYCLE §12.5 [Needs confirmation])*

6. ✅ DECIDED 2026-06-03 — Link the task list to the SPECIFIC won version (current behavior, by quotation_id). The won version is the commercial truth.
   **Versioning → task-list linkage.** When a quote is versioned (m059) and a
   later version is the one Won, should the task list link to **that specific
   version** (current behavior — links by `quotation_id`) or to the **root
   affair**? Confirm intended.
   *(ORDER_LIFECYCLE §12.7; line 596 [Needs confirmation])*

7. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Cancellation cascade rules — ratify.** Confirm as binding: `lost` is treated
   as cancelled downstream; cancellation cascades document → task lists → POs
   (m023), **skipping** already cancelled/delivered targets; a **delivered** PO is
   never auto-cancelled. Ratify all three?
   *(RULES_CANDIDATE §3.3/§3.4 [CODE]; ORDER_LIFECYCLE)*

8. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **One stage function — ratify.** Confirm: order stage is computed by **one**
   function (`computeOrderFlightStage`); components must not re-derive stage
   inline; status semantics always go through `lib/lifecycle.ts` (never inline
   `status === 'cancelled'`). Ratify as discipline rules?
   *(RULES_CANDIDATE §3.1/§3.2 [CODE])*

9. ✅ DECIDED 2026-06-03 — Add an Action Center sensor that fires when a doc is `won` with no task list (implements decision A).
   **Won-but-no-task-list alert?** Should an Action Center sensor fire when a doc
   is `won` but no task list exists yet? (Not currently confirmed to exist.)
   *(ORDER_LIFECYCLE §12.3 [Needs confirmation])*

---

## 4. UI/UX

1. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Orders-in-flight strip — never simplify.** Confirm the 6-phase pipeline
   (Quote → Task list → Payment → Production → Shipping → Delivered) stays a
   first-class view and is never collapsed. Ratify as a standing rule?
   *(RULES_CANDIDATE §1.3 [CODE — standing instruction])*

2. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Delay always paired with ETA.** Confirm: a "+Nd" delay is **never** shown
   without the resulting ETA chip. Ratify?
   *(RULES_CANDIDATE §1.4 [CODE]; `OrdersInFlight`)*

3. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Dense by width, not height.** Confirm: Action Center & Orders-in-flight
   metadata stay single-line (compact by width). Ratify (m076)?
   *(RULES_CANDIDATE §1.5 [CODE])*

4. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Calm empty states.** Confirm: empty/clear states stay calm/reassuring
   ("Nothing needs you right now"). Preserve as a rule?
   *(RULES_CANDIDATE §1.9 [CODE])*

5. ✅ DECIDED 2026-06-03 — Rename UI copy so document review vs task-list validation read differently.
   **Disambiguate the two "validation" words.** Approve renaming in **UI copy**
   so document **review** (m068 pending/approved/rejected) and task-list
   **validation** (`under_validation`/`validated`) read differently?
   *(POTENTIAL_INCONSISTENCIES #6; RULES_CANDIDATE §1.6 [CONFIRM])*

6. ✅ DECIDED 2026-06-03 — STRENGTHEN the banner wording, e.g. 'Dev simulation — your real permissions are unchanged; security checks still use your true role.'
   **View-As caveat note — wording.** A banner notes View-As doesn't reduce real
   privileges. Is the **current copy adequate**, or should it be strengthened
   (e.g. "Dev simulation" phrasing)? Approve as-is or revise?
   *(UI_UX_AUDIT lines 52, 726 [CONFIRM], 730; RULES_CANDIDATE §1.7 [CONFIRM])*

7. ✅ DECIDED 2026-06-03 — DOCUMENT destinations as-is (no removals). Confirmed in code: / → /dashboard; /order-follow-up → /operations; /production/orders → /operations (params passed through); /production/queue → /task-lists; /permissions → /permissions/actions. /production is a bare directory (no stub); /production/orders/[id] is the canonical PO detail.
   **Redirect-stub destinations.** Each redirect stub must have a documented
   destination or be removed: `/`, `/order-follow-up`, `/production`,
   `/production/orders`, `/production/queue`, `/permissions`. Provide the
   intended destination for each (or mark for removal).
   *(RULES_CANDIDATE §1.8 [CONFIRM]; MISSING_DOCUMENTATION §3.1)*

8. ✅ DECIDED 2026-06-03 — OWNER DECISION: keep /dashboard (classic) as CANONICAL and RETIRE /dashboard-v2. Redirect /dashboard-v2 → /dashboard; preserve old bookmarks / event-based links via redirects where possible.
   **Classic dashboard retirement.** Is there an intended **retirement timeline**
   for `/dashboard` (classic) vs `/dashboard-v2`? And should bookmarks to old
   event-based entry points be redirected/preserved?
   *(UI_UX_AUDIT lines 147, 303 [Needs confirmation])*

9. ✅ DECIDED 2026-06-03 — ADOPT proposed mapping. /dashboard = role-scoped home for everyone (sales: own pipeline/deals/reminders; TLM+operations: production queue + their actions; admin/super: org-wide). /operations = TLM, operations, admin, super_admin. /business = admin, super_admin, finance/exec cap only (per 2.6).
   **Role-specific dashboard scope.** Document what each role should see on
   `/dashboard` vs `/dashboard-v2` vs `/business` vs `/operations`. Provide the
   intended per-role content.
   *(MISSING_DOCUMENTATION §3.6)*

10. ✅ DECIDED 2026-06-03 — Add a brief inline note explaining the deposit→Production / completion→Shipping phase placement.
   **Orders-in-flight phase placement copy.** Should the strip explain **why**
    `deposit_received` sits under Production and `production_completed` under
    Shipping (a brief inline note for the team)? Yes/no.
    *(MISSING_DOCUMENTATION §3.4; UI_UX_AUDIT line 336 [Needs confirmation])*

11. ✅ DECIDED 2026-06-03 — Design the line editor for routinely 10–25 product lines per quotation.
   **Quotation line-count ergonomics.** Is there a typical max product-line count
    per quote we should design the editor around (e.g. routinely 10+)? Provide a
    number so the layout can be confirmed.
    *(UI_UX_AUDIT lines 117, 389 [Needs confirmation])*

12. ✅ DECIDED 2026-06-03 — Standardize status-label casing and merge the duplicated columns the audit flagged.
   **Casing/label consistency.** Approve standardizing status labels
    (e.g. "IN PRODUCTION" vs "In Production") and merging duplicated columns flagged
    in the audit? Yes/no (cosmetic but rule-able).
    *(UI_UX_AUDIT lines 638, 680 [Needs confirmation])*

---

## 5. Database

1. ✅ DECIDED 2026-06-03 — Adopt a per-environment applied-migrations ledger/checklist.
   **Adopt an applied-migrations ledger?** Migrations are applied **manually** in
   Supabase. Should we maintain a per-environment applied-migrations checklist to
   prevent the m069 "Done button" stale-schema class of problem? Yes/no.
   *(RULES_CANDIDATE §8.2 [CONFIRM]; MISSING_DOCUMENTATION §4.7; POTENTIAL_INCONSISTENCIES #2)*

2. ✅ DECIDED 2026-06-03 — Add a DB CHECK constraint for `action_acks.state` in {acknowledged, done}.
   **`action_acks.state` CHECK constraint.** Allowed values (`'acknowledged'`,
   `'done'`) are **code-enforced only** (no DB CHECK). Add a DB CHECK constraint?
   Yes/no.
   *(RULES_CANDIDATE §8.5 [CONFIRM]; MISSING_DOCUMENTATION §4.4; DATABASE_MODEL)*

3. ✅ DECIDED 2026-06-03 — Premise stale — the two unions are already identical (LCL|20ft|40ft|40ft HC). COLLAPSE to one shared type (e.g. ShippingUnitType) to prevent future drift; document it.
   **`FreightType` vs `ContainerType` (`40ft`).** `ContainerType` allows `40ft`
   (added m063) but `FreightType` does not. **Align the vocabularies**, or
   **document the difference as intentional**? Pick one.
   *(POTENTIAL_INCONSISTENCIES #4; RULES_CANDIDATE §8.4 [CONFIRM]; DATABASE_MODEL)*

4. ✅ DECIDED 2026-06-03 — Document every jsonb contract in one `JSONB_SHAPES.md`; change only via its normalizer.
   **jsonb shapes — single source of truth.** Should every jsonb contract
   (`shipping_details` m070, `bl_profile` m054, `sticker_requirements` m061,
   `risk_flags` m062, `factory_overrides`/`factory_extras` m071) be documented in
   one place (`JSONB_SHAPES.md`) and changed **only via its normalizer**?
   Approve this rule?
   *(RULES_CANDIDATE §6.6/§8.3 [CODE/CONFIRM]; MISSING_DOCUMENTATION §4.2; DATABASE_MODEL §16.6)*

5. ✅ DECIDED 2026-06-03 — Centralize/document the SELECT alias boundary (consider renaming the type field to `status`).
   **Query-alias contract.** Aliases that rename columns
   (`status AS production_status`, `status AS task_list_status`) leaked into
   shared types. Approve **centralizing/documenting** the SELECT boundary (and
   possibly renaming the type field to `status`)?
   *(POTENTIAL_INCONSISTENCIES #3; RULES_CANDIDATE §8.7 [CODE]; DATABASE_MODEL)*

6. ✅ CONFIRMED 2026-06-03 (live DB read via PostgREST, anon key) — all four verified:
   (a) `production_orders.actual_completion_date` **exists**; (b)
   `production_orders.production_working_days` **exists** and residual plain
   `working_days` **does NOT exist** (clean); (c) `production_task_lists.submitted_at`
   **exists**; (d) `production_task_lists.validated_at` **and** `validated_by`
   **both exist** — they are stamped by `validateTaskList` and are real columns;
   the `ProductionTaskList` TS type is simply missing them (type gap, not a schema gap).
   ~~**Confirm exact column names (live `\d`).** This audit reconstructed columns
   from migrations, not a live schema. Please confirm against
   `information_schema`: (a) `actual_completion_date`; (b)
   `production_working_days` (no residual plain `working_days`); (c) whether
   `submitted_at` exists on task lists (used by `buildReviewNotification`);
   (d) whether `validated_at` / `validated_by` exist (stamped by `validateTaskList`
   but absent from the `ProductionTaskList` type).~~
   *(DATABASE_MODEL §16.7/§16.8; ORDER_LIFECYCLE §12.8; MISSING_DOCUMENTATION §4.3)*

7. ✅ CONFIRMED 2026-06-03 (live DB read) — **`clients` has NO commission columns.**
   Probed `commission_percentage`, `commission_amount`, `commission_rate`,
   `commission_visible`, `commission_description`, `default_commission_percentage`,
   `commission_pct` — all return `42703 column does not exist`. Commission columns
   live **only on `documents`** (m006: `commission_percentage`, `commission_amount`,
   `commission_visible`, `commission_description`, both confirmed present). There is
   no per-client commission pre-population from `clients.*`. **Resolves M-14** in
   PROBLEMS_AND_INCONSISTENCIES.md and sub-question 1.6(b).
   ~~**`clients.commission_*` existence.** Do commission columns exist on `clients`
   (referenced by DATABASE_STRUCTURE.md) or only on `documents` (m006)? Confirm
   via live DB.~~
   *(PRODUCT_AND_PRICING_RULES item 2; DATABASE_MODEL)*

8. ✅ DECIDED 2026-06-03 — REGENERATE the bundle to current policies so it is safe to run on a fresh DB without reintroducing pre-m046 PO RLS.
   **`RUN_THIS_FIRST_production_setup.sql` post-m046.** The bundle concatenates
   m018–m023 incl. pre-m046 PO RLS. Should we **add a "do not run after m046"
   warning** or **regenerate** it to current policies? Pick one.
   *(POTENTIAL_INCONSISTENCIES #10; RULES_CANDIDATE §8.6 [CONFIRM])*

9. ✅ DECIDED 2026-06-03 — Document the unused reserved `entity_messages` columns as reserved-for-future.
   **Reserved `entity_messages` columns.** Confirm that the unused reserved
   columns (`request_type`, `parent_message_id`, `resolved_at`, `resolved_by`,
   non-`comment` `message_kind`) are **not** silently expected by any surface and
   may be documented as reserved-for-future. Yes/no.
   *(MISSING_DOCUMENTATION §4.5)*

10. ✅ DECIDED 2026-06-03 — Document the benign 039→041 migration-number gap.
   **Migration 040 gap.** Numbering jumps 039 → 041 (benign; no migration was
    ever 040). OK to just **document the gap** so nobody hunts for it? Yes/no.
    *(POTENTIAL_INCONSISTENCIES #15)*

---

## 6. Shipping / BL

1. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (G) — Approved fix (not yet applied); read `forwarder`/`vessel`; do not rename stored keys; `forwarder` alone clears BL-missing alert; `bl_number` not mandatory for first alert.
   **★ Approve the `shipping_details` key alignment.** ~~`blIsFilled` reads
   `forwarder_name`/`vessel_name` but data is stored as `forwarder`/`vessel`, so
   entering forwarder/vessel does **not** clear the "BL missing" Action Center
   card. Approve changing `blIsFilled` (`lib/action-center.ts` ~line 336) to read
   `forwarder`/`vessel` (do **not** rename stored keys)? And a follow-on policy
   question: should `forwarder` alone clear the card, or should `bl_number` be
   required?~~
   *(POTENTIAL_INCONSISTENCIES #1 — highest-value; RULES_CANDIDATE §6.4 [CONFIRM→fix]; SHIPPING_AND_BL §11.5)*

2. ✅ DECIDED 2026-06-03 — Add a shipping-marks field AND a structured BL-instructions field on the CLIENT BL PROFILE only (one standing set per client, reused on every order).
   **★ Model shipping marks + structured BL instructions?** Today only free-text
   `notes`/`shipping_notes` exist. Should we add a dedicated **shipping marks**
   field and a **structured BL instructions** field? Yes/no (and where —
   order vs client profile)?
   *(RULES_CANDIDATE §6.5 [CONFIRM]; MISSING_DOCUMENTATION §4.6; SHIPPING_AND_BL §11.4, line 408)*

3. ✅ DECIDED 2026-06-03 — INTENTIONAL — the quote container plan is sufficient; no order-level container reference added.
   **Container reference on the order — gap or intentional?** `production_orders`
   has **no container link**; the quote's container plan is the only record. Is
   the missing order-level container reference a **gap to fill** or an
   **intentional decision** (quote plan is sufficient)?
   *(SHIPPING_AND_BL §11.4; POTENTIAL/DB notes)*

4. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Shipping data split — ratify.** Confirm the intended split: **parties** on
   the client BL profile (m054), **ports/incoterm/containers** on the quote,
   **BL execution** on the order (`shipping_details`, m070); default shipper =
   the Solux factory, prefilled on every client profile; BL/destination follow-up
   applies only to seller-ships incoterms (CFR/CIF/DDP/DDU) or LCL freight.
   Ratify all of this?
   *(RULES_CANDIDATE §6.1/§6.2/§6.3 [CODE]; SHIPPING_AND_BL)*

5. ✅ DECIDED 2026-06-03 — Keep quote shipping fields EDITABLE after Won (no hard lock). NOTE: reconcile with decision B — if a task list already exists, editing shipping fields still triggers B's review-state flow (editable ≠ uncontrolled).
   **Quote shipping fields lock after Won?** Are ports, incoterm, freight type,
   and containers on the quotation still editable once the document is `won` and a
   task list exists? Should they **lock**? Decide.
   *(SHIPPING_AND_BL §11.3; ties to §9.1)*

6. ✅ DECIDED 2026-06-03 — ALWAYS editable by sales, including after shipments are booked (sales own their clients' BL profile).
   **BL profile editable mid-shipment?** Should sales (who can write their own
   clients) be able to update the BL profile **at any time, including after
   shipments are in flight**, or should it lock once a shipment is booked?
   *(DRAFT_AND_EDITING_RULES line 215 [Needs confirmation])*

---

## 7. Notifications

1. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (D) — High/critical events raise bell even without a comment; medium only if action required; low/informational do not; any unread comment also raises bell.
   **★ Bell on event creation?** ~~Today the bell is a read-state view over
   `event_comments` (m045): a new high/critical **event** with no comment does
   **not** raise the bell. Should event **creation** also notify (add an
   unread-events signal), or keep bell = unread comments only?~~
   *(POTENTIAL_INCONSISTENCIES #13; NOTIFICATIONS_AND_MESSAGES §7 line 429; RULES_CANDIDATE §7.3 [CONFIRM])*

2. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Notification scoping — ratify.** Confirm: notifications are role- and
   visibility-scoped (RLS) — a user only sees notifications for entities they can
   see; clicking one opens the entity page **and** overlays the discussion
   (`?event=`); events are **immutable** (changes = new rows/comments). Ratify?
   *(RULES_CANDIDATE §7.1/§7.2/§7.4 [CODE])*

3. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Action Center Done semantics — ratify.** Confirm: only `resolution='manual'`
   items get a **Done** action; auto-clear items vanish when the condition
   resolves. Ratify?
   *(RULES_CANDIDATE §7.5 [CODE])*

4. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (C) — Entity messages are canonical; event comments only for event-specific operational follow-up; one main conversation area per entity in the UI.
   **★ Canonical discussion surface.** ~~Two parallel systems exist: `event_comments`
   (m044, bell `?event=` drawer / `EventDiscussionPanel`) and `entity_messages`
   (m049, global `ConversationDrawer`). **Pick the canonical surface**, or
   formally delineate "operational event thread" vs "entity chatter". Which is
   it?~~
   *(POTENTIAL_INCONSISTENCIES #7; NOTIFICATIONS_AND_MESSAGES line 474; RULES_CANDIDATE §1.2 [CONFIRM])*

5. ✅ DECIDED 2026-06-03 — INTENTIONAL for this phase — in-app, role/visibility-scoped only. Log email/push/per-user targeting as a future enhancement (not scheduled now).
   **No email/push/per-user targeting — intended for now?** No surface notifies a
   **named user**; there is no email, no push, no per-user preferences. Is this
   intentional for the current phase, or a gap to schedule?
   *(NOTIFICATIONS_AND_MESSAGES §7.6 line 542 [Needs confirmation])*

6. ✅ DECIDED 2026-06-03 — Deep-link the 'Task lists awaiting review' bell item when count === 1, else keep the aggregate.
   **Review-aggregate deep link.** The "Task lists awaiting review" bell item
   links to `/task-lists` (the list), unlike every other item (`?event=`). Leave
   as an aggregate, or deep-link when `count === 1`?
   *(POTENTIAL_INCONSISTENCIES #14)*

7. ✅ DECIDED 2026-06-03 — Adopt a completeness rule: every significant state change emits a corresponding event.
   **`emitEvent` coverage.** The full set of `emitEvent` call sites across the 20
   `actions.ts` files was not enumerated. Do you want a **completeness rule** —
   every significant state change (status, deadline, deposit, BL, validation
   decision) must emit a corresponding event? Yes/no.
   *(NOTIFICATIONS_AND_MESSAGES §7.7 lines 555/568 [Needs confirmation]; MISSING_DOCUMENTATION §1.1)*

8. ✅ CONFIRMED 2026-06-03 (read from m049; m076 does not alter it) — **RLS on
   `entity_messages`:**
   - **SELECT:** `admin` / `task_list_manager` / `operations` / `super_admin` → full
     visibility; `sales` → only threads on entities they own, scoped via
     `documents.created_by` (documents directly; task_list/production_order joined
     through `quotation_id`; client via `documents.client_id`).
   - **INSERT:** `with check (user_id = auth.uid() and auth.role() = 'authenticated')`
     — author-only; entity-visibility is enforced server-side by the action layer
     (mirrors `event_comments` post-m046).
   - **UPDATE:** author (`user_id = auth.uid()`) OR technical roles
     (admin/TLM/operations/super) — the latter to resolve requests.
   - **DELETE:** `admin` / `super_admin` only (destructive — audit trail).
   - Sibling `entity_message_reads`: each user manages **only their own** row
     (self-scoped on all four verbs).
   ~~**`entity_messages` RLS policy.** Confirm the exact RLS policy on
   `entity_messages` (m049) — who may read/write a thread. Please state the
   intended policy.~~
   *(NOTIFICATIONS_AND_MESSAGES line 323 [Needs confirmation])*

---

## 8. Pricing

> Pricing is entirely **code-only and undocumented** (`lib/pricing.ts`, m001).
> These answers become the pricing section of `RULES.md`.

1. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.1) — Catalogue/price-list by default; multiple price lists; director assigns default per user/region/client; manual override visible and traceable.
   **★ Pricing modes & overrides.** ~~Define the intended pricing modes, when a
   **manual override** is allowed, and who may override.~~
   *(MISSING_DOCUMENTATION §2.1; RULES_CANDIDATE §2.6 [CONFIRM])*

2. ✅ DECIDED 2026-06-03 — Highest effective_date wins (most recent active price); make the query ordering explicit/deterministic.
   **"Latest price" tie-break.** When multiple `prices_version` rows exist for the
   same (product, tier), which is the **active** price? `buildTierPriceMap` keeps
   the first row from the caller's query, but that ordering isn't visible. State
   the intended rule (e.g. highest `effective_date`).
   *(PRODUCT_AND_PRICING_RULES item 1, lines 92/98 [Needs confirmation])*

3. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.2) — Line-level and document-level discounts; traced with approval tiers; margin warning below threshold; no silent below-threshold discounts.
   **Discounts.** ~~Define the discount rules (line-level vs document-level, caps,
   who may apply). Currently no documented discount logic.~~
   *(MISSING_DOCUMENTATION §2.1; RULES_CANDIDATE §2.6)*

4. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.3) — Always tax-free; export sales only; show "VAT / Tax: 0" or "Tax-free export sale" as needed.
   **★ Tax / VAT.** ~~No tax calculation exists anywhere. Is **zero tax** intentional
   (export business, no domestic VAT), or a gap to fill? Confirm.~~
   *(PRODUCT_AND_PRICING_RULES item 3 line 684 [Needs confirmation])*

5. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.4) — One primary currency per document (USD/EUR/CNY); conversion allowed but explicit, traceable, and locked per document version; rate locked once saved/sent.
   **Currency / conversion.** ~~Prices appear entered in one currency (likely USD).
   How should pricing behave when the document currency is **EUR or CNY** — single
   currency per document with manual entry, or conversion? State the rule.~~
   *(PRODUCT_AND_PRICING_RULES item 4 lines 425/688 [Needs confirmation])*

6. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.5) — 2-decimal rounding on all monetary values; balance absorbs rounding difference so totals reconcile exactly.
   **Rounding policy.** ~~No explicit rounding is applied to `grand_total`,
   commission, or deposit (only `.toFixed(2)` on display). Should a **rounding
   convention** be enforced at compute/storage, or is float storage acceptable?~~
   *(PRODUCT_AND_PRICING_RULES item 5 lines 346/692 [Needs confirmation])*

7. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.6) — 30% is the confirmed standard default; payment terms remain editable per deal; non-standard terms require visibility and management approval.
   **★ Default deposit 30%.** ~~The builder initializes to **30%** deposit. Is 30%
   the standard business default, or an arbitrary value to change?~~
   *(PRODUCT_AND_PRICING_RULES item 6 lines 485/696 [Needs confirmation])*

8. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.7) — Default enabled: Africa = 20 days, other regions = 15 days; editable by authorized users.
   **Balance reminder default.** ~~`balance_reminder_days_before_eta` is nullable.
   Should a default be enforced for all new orders (e.g. 15 days)? Provide the
   number or confirm "leave null".~~
   *(PRODUCT_AND_PRICING_RULES item 7 line 700; m048)*

9. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.8) — Confirmed: product prices 30 days, freight/transport 7 days; both editable; distinction between product and freight validity must be displayed clearly.
   **Offer validity windows.** ~~DB defaults are **30 days** (products) and
   **7 days** (transport). Do these match your standard commercial terms?~~
   *(PRODUCT_AND_PRICING_RULES item 8 lines 565/704 [Needs confirmation])*

10. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.9) — Warranty selectable by product (e.g. 3y, 5y, longer for special offers); prefilled from product config; manual changes traced; locked per document version.
    **Warranty standard.** ~~Values 3 / 5 / 10 years appear in a migration comment.
    Is there a **standard warranty** offered to most clients (which value)?~~
    *(PRODUCT_AND_PRICING_RULES item 9 line 707 [Needs confirmation])*

11. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (H.10) — Exceptional condition only; sales user cannot approve alone; requires sales manager/director or admin approval; reason, approved-by, and approved-at must be stored; UI must clearly mark the order as a no-deposit exception.
    **`no_deposit_required` meaning.** ~~What does `no_deposit_required` mean
    operationally, and who may set it? Define.~~
    *(MISSING_DOCUMENTATION §2.6; `lib/types.ts`)*

---

## 9. Documents

1. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (B) — Revise-only / new version; direct editing blocked after won; "Create revision" action must be clear and accessible from won detail page; previous won version preserved for audit.
   **★ Won quotation: editable, revise-only, or locked?** ~~The server action
   blocks in-place edits of non-draft documents, **but** the revise (`?revise`)
   path is always reachable via the 3-dot menu at any status, and no edit guard
   was found on `won` price fields. **Pick one:** (a) in-place editable,
   (b) revise-only / versioned (recommended by code), (c) fully locked. Also:
   should the "Edit → new version" path be **prominent** on the `won` detail page?~~
   *(DRAFT_AND_EDITING_RULES lines 109/245; ORDER_LIFECYCLE §12.4; SHIPPING_AND_BL §11.3; RULES_CANDIDATE §3.6 [CONFIRM]; MISSING_DOCUMENTATION §2.5)*

2. ✅ ANSWERED 2026-05-30 — see OWNER_DECISIONS_LOG.md (F) — Delete restricted after won; won+no-task-list admin-only with audit log; won+task-list/PO blocked — use cancellation or archive instead; cascade deletion of production data must not happen silently; archive requires reason.
   **★ Owner delete at any status?** ~~Today owner/admin **can delete** a document at
   any status (m055/m057), including `won`, and the confirm message warns it
   "will also remove any linked production order" — yet there is **no capability
   or RLS check** preventing deletion after Won/production. **Is delete-at-any-
   status desired**, or should delete be blocked once `won`/a task list/PO
   exists?~~
   *(DRAFT_AND_EDITING_RULES line 159; RULES_CANDIDATE §4.4 [CONFIRM])*

3. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Draft pipeline transitions — ratify.** Confirm: new quotes start `draft`;
   only `draft → sent → negotiating → won/lost` are valid forward transitions;
   advisory validation (`pending/approved/rejected`) **never** blocks send/win;
   revisions share `root_document_id` and downstream surfaces show only the
   latest version per affair. Ratify all four?
   *(RULES_CANDIDATE §4.1/§4.2/§4.3 [CODE]; DRAFT_AND_EDITING_RULES)*

4. ✅ DECIDED 2026-06-03 — YES at Won — require validation_status='approved' before the won transition (add the gate to updateDocumentStatus). Validation stays advisory for draft→sent→negotiating.
   **Promote advisory validation to a blocking gate?** Document validation is
   deliberately **advisory** today. Should any transition (e.g. `sent` or `won`)
   ever **require** `validation_status = 'approved'`? Yes/no (if yes, it must be
   added to `updateDocumentStatus`).
   *(DRAFT_AND_EDITING_RULES line 340 [Needs confirmation])*

5. ✅ DECIDED 2026-06-03 — Archived quotations are truly read-only (no status changes, no revisions) — consistent with F.
   **Archived quotations read-only?** Should archived quotations be **truly
   read-only** (no status changes, no revisions)? Yes/no.
   *(DRAFT_AND_EDITING_RULES line 258 [Needs confirmation])*

6. ✅ DECIDED 2026-06-03 — Confirm intentional: sales cannot edit a cancelled task list.
   **Cancelled task list immutable for sales — intended?** `cancelled` is in
   `TASK_LIST_LOCKED_FOR_SALES`, so sales cannot edit a cancelled TL. Is this
   **intentional** (cancelled TL should be immutable) or incidental? Confirm.
   *(DRAFT_AND_EDITING_RULES line 290 [Needs confirmation])*

7. ✅ DECIDED 2026-06-03 — EXTRACT one shared implementation; keep the CLIENTS behavior (copies per-line config_values); each surface revalidates its own path. The dashboard version dropping config_values is a data-loss bug.
   **De-duplicate `duplicateDocument` — and which behavior wins?** Two definitions
   exist (`app/(app)/clients/actions.ts:55` and
   `app/(app)/dashboard/actions.ts:7`) and they **behave differently** depending
   on the surface used. Approve extracting one shared implementation — and which
   behavior is the **correct** one to keep (numbering / ownership / which fields
   copy)?
   *(POTENTIAL_INCONSISTENCIES #8; DRAFT_AND_EDITING_RULES line 319; RULES_CANDIDATE §9.3 [CONFIRM→fix])*

8. ✅ DECIDED 2026-06-03 — Merge to one shared factory-mapping action (after confirming shared gating) and delete the committed `.bak` files.
   **De-duplicate factory-mapping actions + delete `.bak` files.** Two
   factory-mapping action files exist (`app/(app)/factory-mapping/actions.ts`,
   `app/(app)/admin/factory-mapping/actions.ts`) plus committed `.bak` /
   `page_full.tsx.bak(2)` artifacts. Approve merging to one shared action (after
   confirming both surfaces share gating) and deleting the `.bak` files?
   *(POTENTIAL_INCONSISTENCIES #9; RULES_CANDIDATE §9.3 [CONFIRM→fix]; MISSING_DOCUMENTATION §1.8)*

9. ✅ DECIDED 2026-06-03 — Require ALL 'technical'- and 'both'-scoped config fields resolved on every line (no missing values, no unresolved __custom__ sentinels) before a task list may be submitted for validation. Schema-driven, no hardcoded list.
   **Per-line required technical fields before TL validation.** Which per-line
   technical fields must be present before a task list may be **submitted for
   validation**? Provide the required-field list.
   *(RULES_CANDIDATE §5.4 [CONFIRM]; PRODUCT_AND_PRICING_RULES item 10 line 711)*

10. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Factory config never overwrites sales config — ratify.** Confirm: factory
    overrides/extras must **never** overwrite the sales configuration; resolution
    order is **override > client preset > mapping > missing**; factory mapping is
    factory-only (TLM / Operations / Super-Admin); custom values use the
    `"__custom__"` sentinel. Ratify?
    *(RULES_CANDIDATE §5.1/§5.2/§5.3 [CODE]; PRODUCT_AND_PRICING_RULES)*

---

## 10. Cross-cutting / housekeeping (optional but useful)

1. ✅ DECIDED 2026-06-03 — Mark `spec.md` historical; `docs/current-implementation/` is the baseline.
   **Retire/mark `spec.md` as historical?** `spec.md` describes a tiny
   admin+sales "Quotation Tool" and is stale vs the live 5-role, three-entity app.
   Approve marking it **historical** and treating `docs/current-implementation/`
   as the baseline?
   *(MISSING_DOCUMENTATION §0)*

2. ✅ DECIDED 2026-06-03 — APPROVE as proposed: RUNBOOK.md, RLS_POLICIES.md, (CAPABILITY_MATRIX.md already done), PRICING_AND_COMMISSION.md, JSONB_SHAPES.md, then finalize RULES.md.
   **Approve the priority doc backlog?** Proposed next docs (priority order):
   `RUNBOOK.md` (migrations/schema-reload/iCloud caveat/RLS testing),
   `RLS_POLICIES.md`, `CAPABILITY_MATRIX.md`, `PRICING_AND_COMMISSION.md`,
   `JSONB_SHAPES.md`, then finalize `RULES.md`. Approve this order?
   *(MISSING_DOCUMENTATION §5)*

3. ✅ RATIFIED 2026-06-03 (confirmed-by-code; blessed as binding rule).
   **Implementation-discipline rules — ratify.** Confirm as binding:
   pure logic in `lib/*` vs server-only modules kept separate (shared types split
   out); **soft-fail only on schema-missing errors** (never swallow RLS/permission
   failures); migrations idempotent and ending with
   `notify pgrst, 'reload schema';`; never use View-As to test RLS (use a real
   account); never pipe remote scripts to bash without review. Ratify all?
   *(RULES_CANDIDATE §9.1/§9.2/§9.4/§9.5 and §8.1 [CODE])*

---

*Last synthesized against the audit docs and code on 2026-05-30. Sources:
`docs/current-implementation/{RULES_CANDIDATE,MISSING_DOCUMENTATION,POTENTIAL_INCONSISTENCIES}.md`
and all 11 docs in `docs/audit-editable/`. To refresh: re-grep those files for
"Needs confirmation" / `[CONFIRM]` and re-fold new items into the matching group.*
