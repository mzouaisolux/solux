# RULES_CANDIDATE.md — FIRST DRAFT (not final)

> **This is a DRAFT for review, not the final `RULES.md`.** It is assembled from
> behavior **observed in code** (see the other files in
> `docs/current-implementation/`). Items marked **[CONFIRM]** need an owner
> decision before they become binding rules; items marked **[CODE]** already
> reflect enforced behavior. Nothing here changes the application.
>
> When ratified, move the agreed rules into a top-level `RULES.md` and delete the
> [CONFIRM]/[CODE] tags.

---

## 1. UI / UX rules

1. **[CODE]** Every entity detail page (document / task list / production order /
   client) must expose its contextual discussion. *(Today: global
   `ConversationDrawer` resolves the entity from the URL.)*
2. **[CONFIRM]** Pick ONE canonical discussion surface (event comments vs entity
   messages) and route all "talk about this" UX through it.
3. **[CODE]** The Orders-in-flight strip is a first-class operational view; keep
   the 6-phase pipeline **Quote → Task list → Payment → Production → Shipping →
   Delivered** and never simplify it away. *(Standing user instruction.)*
4. **[CODE]** A delay number is never shown without the resulting ETA — always
   pair "+Nd" with the current ETA. *(Standing user instruction; ETA chip in
   `OrdersInFlight`.)*
5. **[CODE]** Compact/dense by width, not height (Action Center & Orders-in-flight
   metadata are single-line). *(Standing user instruction, m076.)*
6. **[CONFIRM]** Document copy must disambiguate the two "validation" concepts
   (doc review vs task-list validation).
7. **[CONFIRM]** Show a visible note that View-As does not reduce real
   privileges on actions.
8. **[CONFIRM]** Every redirect-stub route must have a documented destination or
   be removed (`/`, `/order-follow-up`, `/production*`, `/permissions`).
9. **[CODE]** Empty/clear states stay calm and reassuring (Action Center "Nothing
   needs you right now"; Orders-in-flight empty copy). Preserve this tone.

---

## 2. Business-logic rules

1. **[CODE]** All permission/security checks use the **REAL** role
   (`getCurrentUserRole`); only rendering uses the **EFFECTIVE** role.
2. **[CODE]** Capabilities gate **actions**; they do **not** grant row
   visibility.
3. **[CONFIRM]** Visibility grants (lens/team/region) are currently advisory
   (app-level). Until enforced at RLS, they must NOT be treated as a security
   boundary — base RLS isolation + capabilities are the real controls.
4. **[CODE]** Sales see only their own clients/deals by default; **no hardcoded
   client exceptions** ever.
5. **[CODE]** Effective owner = `sales_owner_id` ?? `created_by`.
6. **[CONFIRM]** Define pricing rules (modes, overrides, rounding, discounts) —
   currently code-only (`lib/pricing.ts`).
7. **[CONFIRM]** Define commission rules — currently code-only
   (`lib/commission.ts`).
8. **[CONFIRM]** Define forecast methodology (probability, weighting, quarters).

---

## 3. Order-lifecycle rules

1. **[CODE]** The canonical order stage is computed by **one** function
   (`computeOrderFlightStage`); components must not re-derive stage inline.
2. **[CODE]** Status semantics go through `lib/lifecycle.ts` helpers — never
   inline `status === 'cancelled'`.
3. **[CODE]** `lost` is treated as cancelled downstream; cancellation cascades
   via DB triggers (m023): document → task lists → production orders, skipping
   already cancelled/delivered targets.
4. **[CODE]** A **delivered** production order is never auto-cancelled by an
   upstream cancellation.
5. **[CONFIRM]** Specify whether winning a deal **auto-creates** the task list or
   requires a manual step.
6. **[CONFIRM]** Specify whether a **won** quotation is editable or revise-only
   (versioned).
7. **[CONFIRM]** Single canonical definition of "completed" (reconcile
   `actual_completion_date` vs status `production_completed`).

---

## 4. Draft rules (quotation drafts)

1. **[CODE]** New quotations start as `draft`; only the sales pipeline statuses
   (`draft → sent → negotiating → won/lost`) are valid forward transitions.
2. **[CODE]** Advisory validation (`pending/approved/rejected`) never blocks
   sending or winning a draft.
3. **[CODE]** Revisions create a new version sharing `root_document_id`;
   downstream surfaces show only the latest version per affair.
4. **[CONFIRM]** Whether a draft can be deleted by its owner at any status
   (today: owner/admin can delete — m055/m057). Confirm this is desired.

---

## 5. Product-block / configuration rules

1. **[CODE]** Factory configuration (overrides/extras) must **never** overwrite
   the sales configuration. Resolution order is override > client preset >
   mapping > missing.
2. **[CODE]** Factory mapping is **factory-only** (TLM / Operations /
   Super-Admin via `factory_mapping.access`).
3. **[CODE]** Custom option values are represented by the sentinel
   `"__custom__"` (`CUSTOM_OPTION_SENTINEL`); config fields opt into custom via
   the allow-custom flag (m010).
4. **[CONFIRM]** Document the per-line technical fields and which are required
   before a task list may be submitted for validation.

---

## 6. Shipping / BL rules

1. **[CODE]** Shipping data is intentionally split: **parties** on the client BL
   profile (m054), **ports/incoterm/containers** on the quote, **BL execution**
   on the order (`shipping_details`, m070).
2. **[CODE]** Default shipper is the Solux factory and is prefilled on every
   client BL profile.
3. **[CODE]** BL/destination follow-up applies only to seller-ships incoterms
   (CFR/CIF/DDP/DDU) or LCL freight.
4. **[CONFIRM → fix]** `shipping_details` key names must be consistent across
   modules — `blIsFilled` reads `forwarder_name`/`vessel_name` but data is stored
   as `forwarder`/`vessel`. Align before this becomes a rule.
5. **[CONFIRM]** Decide whether to model **shipping marks** and a **structured BL
   instructions** field (today: only free-text notes).
6. **[CODE]** jsonb shapes (`shipping_details`, `bl_profile`) are normalized on
   read; any new field must be added to the normalizer to round-trip.

---

## 7. Notification rules

1. **[CODE]** Notifications are role- and visibility-scoped (RLS) — a user only
   sees notifications for entities they can see.
2. **[CODE]** Clicking a notification opens the entity page **and** overlays the
   relevant discussion (`?event=`).
3. **[CONFIRM]** Decide whether **event creation** (not just unread comments)
   should raise the bell.
4. **[CODE]** Events are immutable; "changes" are new rows/comments.
5. **[CODE]** Action Center items are derived from live conditions; only
   `resolution='manual'` items get a **Done** action; auto-clear items vanish
   when the condition resolves.
6. **[CONFIRM]** Action Center notes / entity messages stay **micro-coordination**
   — they must not grow into a general chat system.

---

## 8. DB-consistency rules

1. **[CODE]** Every migration is idempotent and ends with
   `notify pgrst, 'reload schema';`.
2. **[CONFIRM]** Maintain an **applied-migrations ledger** per environment
   (prevents the m069 "Done button" stale-schema class of issue).
3. **[CONFIRM]** jsonb contracts must be documented in one place
   (`JSONB_SHAPES.md`) and changed only via their normalizer.
4. **[CONFIRM]** Reconcile enum vocabularies that should match
   (`FreightType` vs `ContainerType`) and the capability catalog (22 in code vs
   DB count).
5. **[CONFIRM]** Decide whether `action_acks.state` should get a DB CHECK
   constraint (`'acknowledged' | 'done'`).
6. **[CONFIRM]** Regenerate or guard `RUN_THIS_FIRST_production_setup.sql` so it
   can't regress post-m046 RLS.
7. **[CODE]** Query aliases that rename columns (`status AS production_status`)
   must be centralized/documented so downstream types don't drift from columns.

---

## 9. Implementation-discipline rules

1. **[CODE]** Pure logic (client+server-safe) lives in `lib/*`; server-only
   modules (importing `@/lib/supabase/server`) are kept separate, and shared
   types are split out (e.g. `entity-messages-shared.ts`).
2. **[CODE]** Soft-fail ONLY on schema-missing errors; RLS/permission/other
   errors must surface (never silently swallow a failed mutation).
3. **[CONFIRM → fix]** No duplicated server actions — extract one shared
   implementation (`duplicateDocument`, factory-mapping actions) and delete
   `.bak` artifacts.
4. **[CODE]** Migrations applied manually in Supabase; never assume a migration
   is live until confirmed in the target environment.
5. **[CODE]** Never pipe remote scripts to bash without review; never use View-As
   to test RLS (use a real account of that role).
6. **[CONFIRM]** Add defense-in-depth in-body guards to admin sub-pages that
   currently rely solely on the layout guard.

---

## Appendix — sources

Every rule traces to a file in `docs/current-implementation/`:
`PRODUCT_OVERVIEW.md`, `USER_ROLES.md`, `DATABASE_STRUCTURE.md`,
`ORDER_LIFECYCLE.md`, `SHIPPING_PROCESS.md`, `NOTIFICATION_SYSTEM.md`,
`BUSINESS_RULES_DETECTED.md`, `MISSING_DOCUMENTATION.md`,
`POTENTIAL_INCONSISTENCIES.md` — which in turn cite `lib/*` and
`supabase/migrations/*`.
