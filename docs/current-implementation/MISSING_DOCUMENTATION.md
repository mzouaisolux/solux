# Missing Documentation — Current Implementation

> **Audit note.** What is **not** documented (or not knowable from code alone)
> and should be captured before finalizing `RULES.md`. Separated into
> **Technical**, **Business-logic**, **UI/UX**, and **Database** gaps. Items are
> phrased so the owner can fill them in; each notes whether the gap is "no
> source of truth" or "needs human confirmation".

---

## 0. Overarching gap — `spec.md` is stale

- `spec.md` describes a small "Quotation Tool" (admin + sales only; generate
  quotations & proforma). The live app has **5 roles**, a **three-entity
  lifecycle**, production tracking, a visibility engine, an event log, and an
  Action Center. **There is no up-to-date product spec.**
- **Action:** treat `docs/current-implementation/` as the new baseline; retire
  or clearly mark `spec.md` as historical.

---

## 1. Technical gaps

1. **`emitEvent` call-site map is undocumented.** We don't have a list of which
   transitions emit which `EventType`. → enumerate every `emitEvent(...)` call
   and the trigger. *(no doc; derivable from code by grep)*
2. **Server-action inventory is partial.** A complete table of every server
   action, its file, its role/capability gate, and what it revalidates is not
   maintained. The routes/actions map agent produced a draft; it should be
   captured as a doc. *(needs a generated reference)*
3. **RPC contracts undocumented.** `next_*_number`, `add_working_days`,
   `delete_client_safe`, `admin_*`, `list_assignable_owners`, etc. have no
   signature/precondition/return doc. *(derivable from migrations)*
4. **RLS policy matrix undocumented.** No single doc states, per table, the
   SELECT/INSERT/UPDATE/DELETE policies and who they admit. Especially needed
   for `production_orders` after m046. *(needs DB introspection)*
5. **Capability → role default matrix not exported.** Lives in
   `role_permissions` seeds (m026/m053); no human-readable copy. *(needs DB read)*
6. **Build/run constraints undocumented.** Known constraint: iCloud Drive breaks
   `node_modules`/symlinks; migrations are applied **manually** in Supabase and
   must end with `notify pgrst, 'reload schema';`. These should live in a
   CONTRIBUTING/RUNBOOK. *(known; not written down)*
7. **No test/QA documentation.** How to test role-based RLS with **real**
   accounts (not View-As), seed data, smoke checks. *(process knowledge only)*
8. **Stray `.bak` files** in `app/(app)/admin/factory-mapping/` are undocumented
   artifacts. *(hygiene)*

---

## 2. Business-logic gaps

1. **Pricing rules** (`lib/pricing.ts`, m001 advanced pricing) — modes,
   manual overrides, rounding, discounts. **Not audited / not documented.**
   *(needs owner confirmation of intended rules)*
2. **Commission rules** (`lib/commission.ts`, `clients.commission_*`) — how
   commission is computed and on what basis. **Not documented.** *(needs owner)*
3. **Forecast methodology** (`lib/forecast.ts`, m050) — probability bands,
   weighted value, quarter logic. A `ForecastMethodology` component exists in UI;
   the rules should be written down. *(partly in UI; needs canonical doc)*
4. **Task-list creation trigger.** Is it manual after Won, or automated? **Needs
   confirmation.**
5. **Quotation immutability after Won.** Can a won quote still be edited, or only
   revised (versioned)? **Needs confirmation.**
6. **Deposit / balance policy.** Default deposit %, when balance is due
   (`balance_reminder_days_before_eta`, m048), what "no_deposit_required" means
   operationally. *(partly in `lib/types.ts`; intent needs owner)*
7. **"Start without deposit" policy.** Who may authorize it
   (`production_order.start_without_deposit`), and what risk it represents. *(gate
   known; policy not written)*
8. **Delay-type taxonomy ownership.** Which `DelayType` values are
   factory-attributable is encoded (`isFactoryDelay` = production/null), but the
   *business definitions* of each external type (customs vs supplier vs
   client_waiting) are undocumented. *(needs owner)*
9. **SLA thresholds for the Action Center.** Escalation timings (`addRoles`) are
   in `ACTION_TYPES` but the business rationale per stage isn't documented.
10. **Lens semantics** (production/finance/logistics) — what each lens *should*
    expose is partly in `LENS_STATUSES`; the business intent needs owner sign-off.

---

## 3. UI / UX gaps

1. **Page-by-page UX spec.** No doc describes each page's purpose, primary
   actions, empty/loading/error states. (Several routes are redirect stubs: `/`,
   `/order-follow-up`, `/production`, `/production/orders`, `/production/queue`,
   `/permissions` — their intended destinations should be documented.)
2. **Two discussion surfaces** (event comments vs entity messages) — no UX
   guidance on which to use when. *(see POTENTIAL_INCONSISTENCIES.md #7)*
3. **Notification expectations.** Users aren't told the bell triggers on unread
   *comments* (not on event creation). Needs an explicit "how notifications
   work" note for end users.
4. **Orders-in-flight phase semantics.** Why `deposit_received` sits in
   Production and `production_completed` sits in Shipping should be documented
   for the team reading the strip.
5. **View-As caveat.** During View-As, actions still run with real privileges —
   needs a visible UX note so testers aren't misled.
6. **Role-specific dashboards.** What each role sees on `/dashboard` vs
   `/dashboard-v2` vs `/business` vs `/operations` is not documented.

---

## 4. Database gaps

1. **No generated schema doc.** Column-level inventory for catalog tables
   (products, categories, factory_mappings, banks, sales terms) is **Needs
   confirmation** — this audit reconstructed core tables from migrations, not a
   live `\d`.
2. **jsonb shapes are code-only.** `shipping_details` (m070), `bl_profile`
   (m054), `sticker_requirements` (m061), `risk_flags` (m062),
   `factory_overrides`/`factory_extras` (m071) have **no DB-level schema** —
   their contracts live only in `lib/`. Document each shape + invariants.
3. **Exact column names to confirm:** `actual_completion_date`,
   `production_working_days` vs `working_days`, `submitted_at` on task lists
   (used by `buildReviewNotification`). **Needs confirmation.**
4. **`action_acks.state` has no CHECK constraint** (only `'acknowledged'` /
   `'done'` used in code) — undocumented that the allowed values are
   code-enforced, not DB-enforced.
5. **DB fields unused in UI** (candidate list): reserved `entity_messages`
   columns (`request_type`, `parent_message_id`, `resolved_at`, `resolved_by`,
   non-`comment` `message_kind`). Confirm none are silently expected.
6. **UI fields without a clear DB home:** "shipping marks", structured "BL
   instructions" (only free-text `notes`/`shipping_notes` exist), container link
   on the order. *(see SHIPPING_PROCESS.md)*
7. **Migration ledger.** No doc records which migrations are applied in each
   environment (they're applied manually). A simple applied-migrations table or
   checklist would prevent the m069 "Done button" class of problem.

---

## 5. Suggested docs to add next (priority order)

1. **RUNBOOK.md** — migrations process, schema reload, iCloud/node_modules
   caveat, how to test RLS with real accounts.
2. **RLS_POLICIES.md** — per-table policy matrix (post-m046).
3. **CAPABILITY_MATRIX.md** — role × capability defaults exported from
   `role_permissions`.
4. **PRICING_AND_COMMISSION.md** — owner-confirmed pricing & commission rules.
5. **JSONB_SHAPES.md** — every jsonb contract + invariants.
6. Then finalize **RULES.md** from `RULES_CANDIDATE.md`.
