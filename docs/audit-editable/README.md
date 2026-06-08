# SOLUX Audit — Editable Source of Truth (Index)

This folder contains the **editable** audit documentation for **SOLUX**, an internal
operations platform (Next.js 14 App Router + Supabase) for an LED/solar lighting
exporter. An "order" flows through three linked entities —
`documents` (quotation) → `production_task_lists` → `production_orders` — then
shipping → delivery, on top of role-based access, a capability matrix, an app-level
visibility engine, an immutable event log, an Action Center, entity-message threads,
quotation versioning, a baseline/delay model, and a sales forecast.

These 14 documents are the **working, hand-editable** versions the owner refines
before development resumes. They were produced by a **read-only, documentation-only
audit**: no application code was modified, and the app was not run or built.

**Status:** ✅ **All owner decisions complete.** Top-priority ★ decisions recorded 2026-05-30 (see OWNER_DECISIONS_LOG.md); the remaining ~70 questions in QUESTIONS_FOR_ME.md were resolved 2026-06-03 (19 ratified confirmed-by-code rules + 48 decided + 3 live-DB confirmations), all stamped inline in that file. The 3 live-DB checks (column names, `clients.commission_*` absence, `entity_messages` RLS) were verified against the running Supabase project. **Next:** integrate decisions into the topic docs + write the priority doc backlog (RUNBOOK → RLS_POLICIES → PRICING_AND_COMMISSION → JSONB_SHAPES → finalize RULES.md). Still doc-only — no code changed yet.

---

## Owner Decisions (confirmed 2026-05-30)

The owner confirmed all top-priority (★) questions on 2026-05-30. The canonical record is [OWNER_DECISIONS_LOG.md](./OWNER_DECISIONS_LOG.md). Decisions cover:

| ID | Topic | Key decision |
|----|-------|-------------|
| A | Task list on "Won" | Manual creation, mandatory; alert until task list is created. |
| B | Won-quote editing | Revise-only / new version; task-list review gate if production exists. |
| C | Canonical discussion surface | `entity_messages` main; `event_comments` for event-specific notes only. |
| D | Bell on event creation | High + critical events raise bell even without a comment. |
| E | Visibility = security? | RLS must become the real security boundary; app-level filtering is interim only. |
| F | Owner delete + archive | Delete blocked after won + linked production; archive requires a reason. |
| G | `shipping_details` key fix | `blIsFilled` must read actual stored keys (`forwarder`, `vessel`). Approved fix — NOT yet applied. |
| H.1–H.10 | Pricing (modes, discounts, VAT, currency, rounding, deposit, reminders, validity, warranty, no-deposit) | See OWNER_DECISIONS_LOG.md §H for full rules. |
| I | Capability matrix | Do not ratify seeded `role_permissions` yet; human-readable matrix must be reviewed first. |

**All decisions describe TARGET / INTENDED behavior and policy. Most are NOT yet implemented in code** — we are still in the documentation/clarification phase. Decision G is an approved fix that has NOT yet been applied. Each relevant topic doc marks resolved items as "Owner decision (confirmed 2026-05-30) — target behavior; not yet implemented".

The capability matrix requested under decision I lives at **[`../CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md)** — note it is in `docs/` root, not in this folder.

---

## How to use this folder

- **This is the EDITABLE source of truth.** The owner edits these files (confirm,
  reword, strike, or add `[Owner note]` / policy decisions) **before development
  resumes**. Expect them to drift from the originals as decisions are made.
- **Current behavior is kept separate from expected behavior.** Each doc documents
  *only what the current implementation actually does*. Where the intended/expected
  behavior differs or is unknown, it is called out distinctly — never merged into
  the description of current behavior.
- **Verification tags.** Facts are marked **[Confirmed by code]** (directly
  verifiable in a cited file) or **[Assumed from code]** (inferred from
  structure/naming, not proven by a single line). Citations use exact file paths
  relative to the project root.
- **"Needs confirmation" marks open questions.** Anything that cannot be settled
  from code alone — requiring owner input or a live-DB read — is flagged this way.
  These are the items to resolve before finalizing the rulebook.
- **Canonical originals.** The original, code-grounded source documents that these
  editable versions are derived from live in
  [`docs/current-implementation/`](../current-implementation/). Treat those as the
  read-only baseline; treat the files in **this** folder as the ones you edit.
  (Note: the handoff files sometimes referenced elsewhere —
  `docs/HANDOFF_FOR_NEW_CHAT.md`, `docs/HANDOFF_SUMMARY.md`,
  `docs/PENDING_TASKS.md`, `docs/DO_NOT_BREAK.md`, and a top-level `RULES.md` —
  do **not** exist in this repository.)

---

## The 14 audit documents

| # | File | What it covers |
|---|------|----------------|
| 1 | [APP_OVERVIEW.md](./APP_OVERVIEW.md) | High-level overview of SOLUX: what the platform is, its tech stack, the core order flow, and the major subsystems. |
| 2 | [MODULES_AND_PAGES.md](./MODULES_AND_PAGES.md) | Every route and page (`app/(app)/**/page.tsx`) and API route (`app/api/**/route.ts`), with role gating and purpose per module. |
| 3 | [USER_ROLES_AND_PERMISSIONS.md](./USER_ROLES_AND_PERMISSIONS.md) | Roles, the capability matrix, route/visibility gating, and how permissions are enforced across the app. |
| 4 | [DATABASE_MODEL.md](./DATABASE_MODEL.md) | Tables, columns, and relationships reconstructed from `supabase/migrations/*.sql` and `lib/types.ts` (live DB not introspected). |
| 5 | [BUSINESS_RULES.md](./BUSINESS_RULES.md) | Cataloged business rules, each with a statement, classification tag, and related files / components / DB fields. |
| 6 | [ORDER_LIFECYCLE.md](./ORDER_LIFECYCLE.md) | The end-to-end order lifecycle across the three linked entities, plus the baseline/delay model and status transitions. |
| 7 | [DRAFT_AND_EDITING_RULES.md](./DRAFT_AND_EDITING_RULES.md) | Edit / save / lock / delete rules for quotations, client records, shipping/BL fields, and shipment details — including risky/unclear cases. |
| 8 | [PRODUCT_AND_PRICING_RULES.md](./PRODUCT_AND_PRICING_RULES.md) | Product catalog model, document line structure, pricing, discounts, commission, currencies, payment terms, and deposit/balance logic. |
| 9 | [SHIPPING_AND_BL.md](./SHIPPING_AND_BL.md) | Shipping process and Bill of Lading (BL) handling: fields, flow, and how shipping connects to delivery. |
| 10 | [NOTIFICATIONS_AND_MESSAGES.md](./NOTIFICATIONS_AND_MESSAGES.md) | Every notification-like surface: the bell, event/operations feed, Action Center, conversation drawer (entity messages), and render-time alerts/reminders. |
| 11 | [UI_UX_AUDIT.md](./UI_UX_AUDIT.md) | Read-only UI/UX audit of the current interface, observations, and usability findings drawn from components and pages. |
| 12 | [PROBLEMS_AND_INCONSISTENCIES.md](./PROBLEMS_AND_INCONSISTENCIES.md) | Consolidated, de-duplicated register of problems, inconsistencies, unclear behavior, and disconnected features found during the audit. |
| 13 | [QUESTIONS_FOR_ME.md](./QUESTIONS_FOR_ME.md) | Grouped, numbered checklist of every owner decision needed before the rulebook can be finalized, each phrased yes/no or pick-one. |
| 14 | [RULES_DRAFT_EDITABLE.md](./RULES_DRAFT_EDITABLE.md) | A first, **non-binding** editable draft of the SOLUX rulebook, synthesizing current behavior, detected issues, and the other audit docs for hand-editing. |

---

## Additional files in this folder

| File | What it covers |
|------|----------------|
| [OWNER_DECISIONS_LOG.md](./OWNER_DECISIONS_LOG.md) | **Canonical record** of the owner's confirmed top-priority (★) decisions, 2026-05-30. Source of truth for all resolved questions; all target-behavior rules are quoted here and referenced by the topic docs. |

## Related file at docs/ root

| File | What it covers |
|------|----------------|
| [`../CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md) | Human-readable role × capability matrix (decision I). Lives in `docs/` root, **not** in this folder. Marks each permission entry as Confirmed by code / Assumed from code / Needs owner confirmation / Potentially risky. Owner review of this matrix is required before permissions are finalized. |

---

*This index documents only what the current implementation does. It does not define
new features or change application behavior.*
