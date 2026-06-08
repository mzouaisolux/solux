# RULES_DRAFT_EDITABLE.md — SOLUX

> # ⚠️ THIS IS AN EDITABLE DRAFT — NOT BINDING ⚠️
>
> **This document is a FIRST EDITABLE DRAFT of the SOLUX rulebook. It is NOT final
> and NOT binding. Nothing here changes the application.** It is a synthesis of the
> current implementation, the detected inconsistencies, and the existing audit
> documentation — assembled so the **owner can hand-edit it** (confirm, reword,
> strike, or promote each rule) **before any development continues**. When the
> owner has ratified a section, the agreed rules can be moved into a top-level
> `RULES.md` and the tags below removed.
>
> **Do not treat any `[CONFIRM]` or `[FIX]` item as settled.** They are open
> questions and known bugs, surfaced here precisely so they get an explicit
> decision rather than being silently locked in.

---

## How to read this document

Every rule carries exactly **one** tag:

| Tag | Meaning | What the owner does with it |
|---|---|---|
| **`[CODE]`** | Already-enforced behavior. Provable in cited code/migrations. | Confirm it is the **intended** rule (code can be right and still not be what you want). |
| **`[CONFIRM]`** | Needs an owner decision. The code is silent, ambiguous, or deliberately advisory. | Make a product decision; then it becomes a real rule. |
| **`[FIX]`** | A consistency fix is required **before** this can be a rule. The code currently contradicts itself or has a confirmed bug. | Approve the fix; the rule is blocked until then. |
| **`[OWNER-CONFIRMED 2026-05-30]`** | The owner made the product decision (see [Owner Decisions](#owner-decisions-confirmed-2026-05-30) and `OWNER_DECISIONS_LOG.md`). The behavior already exists in code; this records the intended rule. | Treat as ratified policy. |
| **`[OWNER-CONFIRMED · target — not yet implemented]`** | The owner made the decision, but it describes **TARGET / INTENDED** behavior that is **NOT yet built**. The cited code still reflects the old/current behavior. | Schedule the work; do not assume it is live. |
| **`[FIX · approved, not applied]`** | An approved bug fix (Decision G) that has **NOT** been applied — we are still in the documentation phase, no code change exists yet. | The fix is authorized; the rule is blocked until the code change lands. |

Notation inside rule text follows the audit convention:
`[Confirmed by code]` = directly verified in a cited file; `[Assumed from code]` =
inferred from structure. File paths are relative to the project root.

**Sources synthesized:** `docs/current-implementation/RULES_CANDIDATE.md` (the
prior first draft) plus the editable audit docs in `docs/audit-editable/`
(`BUSINESS_RULES.md`, `USER_ROLES_AND_PERMISSIONS.md`, `DRAFT_AND_EDITING_RULES.md`,
`PRODUCT_AND_PRICING_RULES.md`, `SHIPPING_AND_BL.md`, `NOTIFICATIONS_AND_MESSAGES.md`,
`UI_UX_AUDIT.md`, `MODULES_AND_PAGES.md`, `DATABASE_MODEL.md`, `ORDER_LIFECYCLE.md`,
`APP_OVERVIEW.md`) and the `docs/current-implementation/` source docs, all of which
cite `lib/*` and `supabase/migrations/*`.

> **Note on handoff files.** The handoff/notes files sometimes referenced
> elsewhere (`docs/HANDOFF_FOR_NEW_CHAT.md`, `docs/HANDOFF_SUMMARY.md`,
> `docs/PENDING_TASKS.md`, `docs/DO_NOT_BREAK.md`, top-level `RULES.md`) **do not
> exist** in this repository. The contents below were reconstructed from code and
> the audit docs, not from those files. There is also **no
> `PROBLEMS_AND_INCONSISTENCIES.md`** in `docs/audit-editable/`; the inconsistency
> source used is `docs/current-implementation/POTENTIAL_INCONSISTENCIES.md`.

---

## Owner Decisions (confirmed 2026-05-30)

> **The owner has confirmed decisions A–I on the top-priority questions.** The
> **canonical, exact wording lives in [`OWNER_DECISIONS_LOG.md`](./OWNER_DECISIONS_LOG.md)**
> (sections A, B, C, D, E, F, G, H.1–H.10, I); the summaries below condense it.
>
> **IMPORTANT — these are TARGET / INTENDED behavior and policy. MOST ARE NOT YET
> IMPLEMENTED IN CODE.** We are still in the documentation/clarification phase.
> Nothing here authorizes a code change. Where a rule below is already enforced in
> code, it is tagged `[OWNER-CONFIRMED 2026-05-30]`; where it is target behavior not
> yet built, it is tagged `[OWNER-CONFIRMED · target — not yet implemented]`.
> **Decision G is an APPROVED fix that has NOT been applied** (`[FIX · approved, not
> applied]`). The "Current behavior" cited in each rule is what the code does **today**.

| Dec. | Topic | Confirmed decision (target) — condensed | Affected rules |
|---|---|---|---|
| **A** | Task list on "Won" | Winning a quote must **not** auto-create the production task list. After `won`, the app shows a **required, highly visible "Create Production Task List"** action; a won quote with no linked task list surfaces as an Action Center alert until created. | §5.18 (new); §11.7 |
| **B** | Won-quote editing | A `won` quote is **never edited in place** — changes go through a **new revision/version**. If a task list already exists, the app must **show the differences**, drive a **review state**, mark the task list as *requiring review/update*, and let operations decide update/regenerate/keep. Prior won version preserved for audit. | §5.14 (retagged); §5.19 (new); §11.8 |
| **C** | Canonical discussion surface | **`entity_messages` is the canonical discussion surface**; **`event_comments` only** for event-specific operational comments. One main conversation area per entity; events appear as contextual system entries. | §1.8 (retagged); §9.6, §9.12 (new) |
| **D** | Bell on event creation | The bell is **not** limited to unread comments. **Critical + High events** raise the bell even with no comment; **Medium** only if it needs action from the user/role; **Low/informational** does not; **any unread comment** still raises it. | §9.2 (retagged), §9.8 (retagged) |
| **E** | Visibility = security? | Visibility (team/region/lens/ownership/role) must become a **real security boundary enforced by RLS**. App-level filtering = UX only; **RLS = real security**. Current app-level visibility is an **interim** state, documented as such; migration may be progressive and tested with **real accounts, not View-As**. | §2.7 (retagged); §11 note |
| **F** | Delete restriction + Archive | **Draft** deletable by authorized users. **Sent/negotiating** deletable only if **no downstream** task list / production order. `won` **not freely deleted**: with no task list → admin/super-admin only + strong confirm + audit log; with a task list/PO → **blocked**, cancel/archive instead, no silent cascade. **Archive requires a reason** (reason, archived by/at, optional note); archived records stay searchable, visually separated, out of active dashboards. | §5.15 (retagged), §5.16 (retagged), §5.20 (new); §4.4 |
| **G** | `shipping_details` key fix | **Approved fix — NOT applied.** Align `blIsFilled` to the keys actually stored (`forwarder`/`vessel`); **do not rename stored jsonb keys**. The "BL missing" item self-clears when required fields are filled; minimum to clear = **`forwarder`**; `bl_number` must **not** be mandatory for the first BL alert. | §3.6 (retagged), §8.4 (retagged); §11.9 |
| **H.1** | Pricing modes / price lists | Price-list/catalogue pricing by default with controlled manual override. Support **multiple price lists**; a director can assign a default list to a **sales user / region / country / client**. On creation, propose by **priority: client → sales-user → region/country → company default**. Override must be **visible & traceable** (original, list, overridden price, reason, by, at). | §7.14 (new) |
| **H.2** | Discounts / Remises | Allow **line- and document-level** discounts; display original/discount/discounted/final; store type, value, reason, by, at. **Approval tiers** (sales up to a limit; manager/director larger; admin override); above an internal threshold → *requiring approval*. **Margin warning** if below minimum margin — never silently allow below the safety threshold. | §7.3 (retagged), §7.15 (new) |
| **H.3** | Tax / VAT | Always **tax-free**. Do not auto-calculate/add VAT; show "Tax-free export sale" / "VAT 0" when needed; hide/zero any tax field. | §7.10 (retagged) |
| **H.4** | Currency / conversion | **One primary currency per document**; conversion explicit, traceable, **locked per document version** (no live-rate drift after save; revision may keep or re-rate). Store source/target/rate/date/source/by/at. Large orders may show the rate + an **exchange-rate adjustment clause** (configurable threshold). **Bank account by currency** (USD→USD, EUR→EUR, CNY→CNY), default matches currency. | §7.6 (retagged), §7.11 (retagged), §7.16 (new) |
| **H.5** | Rounding / Arrondis | Round monetary amounts to **2 decimals at document level** (0.005↑). Round each line → sum → apply document discount → grand total → round. **Balance = grand total − deposit** (balance **absorbs** rounding so totals reconcile). Store exchange rate with more precision than 2 decimals. | §7.12 (retagged), §7.17 (new) |
| **H.6** | Default deposit | Default **30% / 70%**, editable per deal. Support 30/70, 25/75, 20/80, 100% pre-production, deposit+L/C, L/C at sight, L/C 30/60/90, no-deposit (only if authorized). Risky terms need approval or a risk warning. | §7.18 (new) |
| **H.7** | Balance reminder | Default reminder before shipment/production completion: **Africa = 20 days**, **others = 15 days** (unless configured), editable. Applies when a balance is due before shipment, order in production, balance not received. Visible in Action Center, order page, finance follow-up. | §7.19 (new) |
| **H.8** | Offer validity | Product price validity **30 days**; transport/freight validity **7 days**; both editable. Distinguish product vs transport vs full-quotation validity; show offer-valid-until / freight-valid-until dates. | §7.20 (new) |
| **H.9** | Warranty standard | Warranty selectable **per product** (e.g. 3y / 5y / 10y; custom only if approved). Prefill from product config; commercial change allowed but visible/traceable (original, selected, by, at, reason); warranty stored with the document version — later product changes never alter old quotes. | §7.21 (new) |
| **H.10** | No deposit required | `no_deposit_required` is an **exceptional** condition needing explicit authorization (trusted/strategic/L-C/bank-backed, director/admin decision). A normal sales user **cannot** set it alone; store reason, approved by/at, guarantee, internal comment; UI clearly flags the no-deposit exception. | §7.22 (new) |
| **I** | Role × capability matrix | **Do not blindly ratify** the seeded `role_permissions` yet. The seed is a **technical baseline**, not final business rule, until owner-reviewed. A readable **[`/docs/CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md)** has been generated (per role: pages, entities, actions, restrictions, admin/document/quotation/task-list/PO/shipping/pricing/notification/delete-archive permissions), each entry tagged *Confirmed by code / Assumed from code / Needs owner confirmation / Potentially risky*. **No permission changes yet**; after review the confirmed matrix moves into `/RULES.md`. | §4.7 (annotated), §4.14 (new) |

---

## Section index

1. [UI / UX rules](#1-ui--ux-rules)
2. [Business logic rules](#2-business-logic-rules)
3. [Database consistency rules](#3-database-consistency-rules)
4. [Role and permission rules](#4-role-and-permission-rules)
5. [Draft / order lifecycle rules](#5-draft--order-lifecycle-rules)
6. [Product block rules](#6-product-block-rules)
7. [Pricing rules](#7-pricing-rules)
8. [Shipping / BL rules](#8-shipping--bl-rules)
9. [Notification rules](#9-notification-rules)
10. [Implementation discipline rules](#10-implementation-discipline-rules)
11. [Things that must NOT be redesigned or rebuilt](#11-things-that-must-not-be-redesigned-or-rebuilt)
12. [Appendix — open "Needs confirmation" register](#12-appendix--open-needs-confirmation-register)

---

## 1. UI / UX rules

**1.1 `[CODE]`** The **6-phase Orders-in-flight pipeline** is a first-class
operational view and must never be simplified away. The canonical phases are
`Quote → Task list → Payment → Production → Shipping → Delivered`.
*[Confirmed by code: `ORDER_FLIGHT_PHASES` in `lib/lifecycle.ts:257-264`; rendered
per order row in `components/dashboard/OrdersInFlight.tsx`.]* (Standing user
instruction; see also §11.1.)

**1.2 `[CODE]`** A delay number is **never shown without its resulting ETA** —
every "+Nd" is paired with the current ETA (or a "Delivered" chip).
*[Confirmed by code: `etaChipLabel` and the comment in
`components/dashboard/OrdersInFlight.tsx:59-102,163`; the delay/ETA pairing is
also honored on the production order card (`app/(app)/documents/[id]/page.tsx:638-680`)
and the `OrderOperationsStrip` (`components/production/OrderOperationsStrip.tsx`).]*

**1.3 `[CODE]`** **Compact by width, not by height** (m076). Action Center and
Orders-in-flight metadata stay single-line, with `flex-wrap` as the only overflow
escape. *[Confirmed by code: `components/dashboard/OrdersInFlight.tsx:214`;
`components/action-center/ActionCenter.tsx:122-128,143-209`.]*

**1.4 `[CODE]`** **Factory delay vs external delay must remain visually
distinguished.** The Delay card separates factory-attributable days ("counts
toward factory KPI", rose) from external days ("does not affect factory KPI",
amber). *[Confirmed by code: `components/production/OrderOperationsStrip.tsx:162-222`;
backed by `lib/delays.ts isFactoryDelay`.]*

**1.5 `[CODE]`** **Empty / cleared states stay calm and reassuring.** Action
Center: "Nothing needs you right now…"; Orders-in-flight: "No orders in flight
yet. Once a quotation is marked **Won**, it'll show up here." Preserve this tone.
*[Confirmed by code: `components/action-center/ActionCenter.tsx:64-77`;
`components/dashboard/OrdersInFlight.tsx:128-136`.]*

**1.6 `[CODE]`** Every entity **detail** page (document / task list / production
order / client) exposes a contextual discussion drawer; the global
`ConversationLauncher`/`ConversationDrawer` resolves the entity from the URL.
List pages and `/new` routes have no thread. *[Confirmed by code:
`lib/conversation-context.ts`; `components/chat/ConversationDrawer.tsx`;
`app/(app)/layout.tsx`.]*

**1.7 `[CODE]`** The **role badge** is always visible in the top nav when a role
is set, color-coded per role; the **simulation banner** appears above the nav
only while View-As is active. *[Confirmed by code: `components/Nav.tsx:74-84,162-210`.]*

**1.8 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision C)
**`entity_messages` is the canonical discussion surface; `event_comments` is for
event-specific operational comments only.** **Target/Expected behavior:** there is
**one main conversation area per entity** (quotation / client / task list /
production order), backed by `entity_messages`; `event_comments` are used **only**
to comment on a specific operational event (status change, delay, validation
request, payment/BL/production issue, Action Center event). The UI must not present
two competing chat systems — important events appear as **contextual system
entries** inside/alongside the entity conversation. A notification on an event
comment opens the related entity page and highlights that event discussion in
context. *(Target — not yet implemented.)*
**Current behavior:** two parallel systems coexist and a message in one is invisible
in the other. *([Confirmed by code] the duplication: `lib/events.ts`/`EventDiscussionPanel.tsx`
vs `lib/entity-messages.ts`/`components/chat/ConversationDrawer.tsx`; see
`PROBLEMS_AND_INCONSISTENCIES.md §7` and `NOTIFICATIONS_AND_MESSAGES.md §7.3`.)*
Canonical decision text: `OWNER_DECISIONS_LOG.md` §C. (See also §9.6, §9.12.)

**1.9 `[CONFIRM]`** **Disambiguate the two "validation" concepts in UI copy**
(document advisory **review** m068 vs task-list factory **validation**). Decide on
scope qualifiers like "Quotation review" vs "Factory validation".
*(See `POTENTIAL_INCONSISTENCIES.md §6`; `UI_UX_AUDIT.md §13.2 item 7`.)*

**1.10 `[CONFIRM]`** **Two dashboards in the nav** (`/dashboard` + "V2 ✦"
`/dashboard-v2`). Decide whether V2 stays permanently, becomes the default, or is
retired — and give it a timeline. *[Confirmed by code: `components/Nav.tsx:103`;
`app/(app)/dashboard-v2/page.tsx`.]*

**1.11 `[CONFIRM]`** **View-As clarity for non-technical admins.** Confirm whether
the current banner ("Dev simulation active … Server actions still use your real
role") adequately communicates that View-As does **not** reduce real privileges,
or should be reworded (e.g. "UI preview mode — all saves still run under your real
role"). *[Confirmed by code: `components/Nav.tsx:79`; `UI_UX_AUDIT.md §12, §14.5`.]*

**1.12 `[CONFIRM]`** **Redirect-stub routes need a documented destination or
removal.** `/`, `/order-follow-up`, `/production`, `/production/orders`,
`/production/queue`, `/permissions` (root) are redirect stubs.
*(See `USER_ROLES_AND_PERMISSIONS.md §6`; `MODULES_AND_PAGES.md`.)*

**1.13 `[FIX]`** **Human-readable status labels in KPI tiles.** The "Quotation
status" and "Task list status" tiles on the production order page render raw enums
via `.toUpperCase()` + underscore-replace (e.g. "IN_PRODUCTION" → "IN PRODUCTION")
instead of the existing `DOC_STATUS_LABEL` / `PRODUCTION_ORDER_STATUS_LABEL` maps.
Align to the label maps. *[Confirmed by code:
`app/(app)/production/orders/[id]/page.tsx:1400-1427`; `UI_UX_AUDIT.md §14.1`.]*
*(Low-risk, no redesign.)*

**1.14 `[CONFIRM]`** **Disabled "Unlock baseline" button** on the production order
page is a permanent dead affordance (`cursor-not-allowed`, "coming in the next
phase"). Decide: hide it, or replace with a "contact admin" message, until the
feature exists. *[Confirmed by code:
`app/(app)/production/orders/[id]/page.tsx:738-748`; `UI_UX_AUDIT.md §14.3`.]*

**1.15 `[CONFIRM]`** **Operations "Sales" column shows `role·uuid-slice`**
(e.g. "sales·a3b4c5"), not a human name. Decide whether to use display names
(if available from `user_roles`, m052) or keep the technical identifier.
*[Confirmed by code: `app/(app)/operations/page.tsx:403-427`; `UI_UX_AUDIT.md §14.2`.]*

**1.16 `[CONFIRM]`** **House style: emoji.** The notes count uses `💬 N`. Decide
whether to keep it or use plain text ("N notes") to match the no-emoji leaning
noted in the prior draft. *[Confirmed by code:
`components/action-center/ActionCenter.tsx:249`; `UI_UX_AUDIT.md §14.6`.]*

---

## 2. Business logic rules

**2.1 `[CODE]`** **All permission/security checks use the REAL role**
(`getCurrentUserRole()`, never reads the View-As cookie). **Only UI rendering uses
the EFFECTIVE role** (`getEffectiveRole()`, honors the cookie for super-admins
only). *[Confirmed by code: `lib/auth.ts` (`getCurrentUserRole` lines ~22-46,
`getEffectiveRole` lines ~56-98); `lib/permissions.ts` — `hasCapability` uses real,
`hasUiCapability` uses effective.]* (See also §4.1 and §11.2.)

**2.2 `[CODE]`** **Capabilities gate actions, not row visibility.** The capability
matrix is checked in the server-action layer immediately before a mutation; it does
**not** alter RLS or SELECT scope. *[Confirmed by code: `lib/permissions.ts` header
(lines ~9-12); tables `permissions` + `role_permissions` (m026).]*

**2.3 `[CODE]`** **Effective owner = `sales_owner_id ?? created_by`.**
*[Confirmed by code: `lib/owner.ts effectiveOwnerId` (m066).]*

**2.4 `[CODE]`** **Sales see only their own clients/deals by default, with NO
hardcoded client exceptions, ever.** *[Confirmed by code: RLS m046/m058/m066;
`lib/visibility.ts` legacy fallback (technical = all, sales = own). Standing rule.]*

**2.5 `[CODE]`** **Semantic status questions go through `lib/lifecycle.ts`
helpers** — never inline `status === 'cancelled'`. `lost` is treated as cancelled
downstream. *[Confirmed by code: `lib/lifecycle.ts` header instruction;
`isDocCancelled` returns true for `lost ∨ cancelled`.]*

**2.6 `[CODE]`** **The canonical order stage is computed by ONE function**
(`computeOrderFlightStage`); components must not re-derive stage inline.
*[Confirmed by code: `lib/lifecycle.ts:307-355`.]*

**2.7 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision E)
**Visibility (team / region / lens / ownership / role) must become a REAL security
boundary enforced by RLS.** **Target/Expected behavior:** UI filtering = user
experience/convenience; **RLS filtering = real security**. Any sensitive visibility
restriction must be enforced by RLS **before the app is considered
production-secure**. Migration may be progressive, but the app-level-only state is
an **interim** state and must be documented as such — **not** the final security
model. RLS changes must be tested with **real user accounts, not View-As**.
*(Target — not yet implemented.)*
**Current behavior:** visibility grants (lens/team/region) are **app-level only**;
m067 changed no table's RLS, so they must **NOT** currently be treated as a security
boundary — base RLS isolation + capabilities are the only real controls today.
*([Confirmed by code] the gap: m067 header "NO existing table's RLS is changed";
`lib/visibility.ts`. See `PROBLEMS_AND_INCONSISTENCIES.md §5`,
`USER_ROLES_AND_PERMISSIONS.md §5.3/§7.2`.)* Canonical decision text:
`OWNER_DECISIONS_LOG.md` §E. (See §11 note.)

**2.8 `[CONFIRM]`** **Define commission rules as policy.** Code computes commission
on the **subtotal (items + freight)**, adds it on top of the grand total, treats it
as paid out of the seller's margin (display only), and gates PDF visibility via
`show_commission_in_pdf`. Confirm these as the intended business rules.
*[Confirmed by code: `lib/commission.ts:13-18`; `documents.commission_*` (m006);
`PRODUCT_AND_PRICING_RULES.md §5`.]* See also §7.

**2.9 `[CONFIRM]`** **Define forecast methodology** (probability bands, weighting,
quarter logic). Present in code but not audited as policy.
*([Missing information] `lib/forecast.ts`; `documents.probability` (m050).)*

**2.10 `[CONFIRM]`** **`clients.commission_*` columns — exist or not?** A database
doc references them, but migration m006 adds commission columns to `documents`
only. Confirm whether per-client commission defaults exist and, if so, how they
pre-populate a quotation. *(See `PRODUCT_AND_PRICING_RULES.md §5.5, §13 item 2`.)*

---

## 3. Database consistency rules

**3.1 `[CODE]`** **Every migration is idempotent and ends with
`notify pgrst, 'reload schema';`.** *[Confirmed by code: every migration inspected,
e.g. m067, m069, m070, m075.]* (See §11.6.)

**3.2 `[CODE]`** **Migrations are applied MANUALLY in Supabase; never assume one is
live** until confirmed in the target environment. Soft-fail paths exist precisely
because a migration may not be applied. *[Confirmed by code: `lib/visibility.ts`
soft-fail to legacy if m067 absent; `app/(app)/dashboard-v2/actions.ts`
schema-missing patterns; `APP_OVERVIEW.md`.]* (See §11.7.)

**3.3 `[CODE]`** **Soft-fail ONLY on schema-missing errors.** RLS / permission /
other errors must surface — never silently swallow a failed mutation. The
schema-missing matchers are strict and intentional. *[Confirmed by code:
`isMissingActionAcksSchema` / `isMissingActionNotesSchema` in
`app/(app)/dashboard-v2/actions.ts`.]*

**3.4 `[CODE]`** **Query aliases that rename columns must be centralized /
documented** so downstream types do not drift from real columns. The dashboard
aliases `production_orders.status AS production_status`, and the alias name leaked
into `OrderStageInput`; a new query that forgets the alias reads `null` silently.
*[Confirmed by code: `lib/lifecycle.ts` `OrderStageInput.production_status`;
`POTENTIAL_INCONSISTENCIES.md §3`.]*

**3.5 `[CODE]`** **jsonb shapes are normalized on read AND write; any new field
must be added to the normalizer to round-trip.** Applies to `bl_profile`
(`normalizeBlProfile`), `shipping_details` (`normalizeShippingDetails`), and
`payment_terms` (`normalizePaymentTerms`). *[Confirmed by code: `lib/bl.ts`,
`lib/shipping.ts`, `lib/payment.ts`.]*

**3.6 `[FIX · approved, not applied]`** (Decision G) **`production_orders.shipping_details`
key names must agree across modules.** **Owner-approved fix (NOT yet applied — still
in the documentation phase, no code change exists):** align the **reader** to the
keys actually stored, `forwarder` / `vessel` (do **NOT** rename the stored jsonb
keys — data already uses them, renaming would break existing records). Add a shared
key constant so they can't drift again. Minimum field to clear the BL-missing alert
= **`forwarder`**; `bl_number` must **not** be mandatory for the first BL alert.
**Current behavior (the bug):** `blIsFilled()` reads `forwarder_name` /
`vessel_name` but the data is stored as `forwarder` / `vessel`.
*[Confirmed by code: `lib/action-center.ts:336` vs `lib/shipping.ts:16-17`;
`PROBLEMS_AND_INCONSISTENCIES.md §1`, `SHIPPING_AND_BL.md §6`.]* Canonical decision
text: `OWNER_DECISIONS_LOG.md` §G. (Cross-listed as §8.4; do-not-rename invariant in §11.9.)

**3.7 `[FIX]` / `[CONFIRM]`** **`FreightType` vs `ContainerType` vocabulary
divergence.** `FreightType = LCL | 20ft | 40ft HC` (no plain `40ft`);
`ContainerType = LCL | 20ft | 40ft | 40ft HC` (m063 added `40ft`). Decide whether
the two vocabularies should match (then align `FreightType`) or are intentionally
different (then document it). *[Confirmed by code: `lib/types.ts`; m063;
`POTENTIAL_INCONSISTENCIES.md §4`.]*

**3.8 `[CONFIRM]`** **Reconcile the capability catalog count.** The
`lib/permissions.ts Capability` union has **22** keys *(verified directly)*; prior
notes referenced "23" DB catalog rows. Reconcile `permissions` table rows against
the union and remove/add the odd one out. *(See
`USER_ROLES_AND_PERMISSIONS.md §4`; `POTENTIAL_INCONSISTENCIES.md §16`.)*

**3.9 `[CONFIRM]`** **`action_acks.state` DB CHECK constraint.** Decide whether to
add a CHECK (`'acknowledged' | 'done'`) to harden the value space (m069).
*(See `POTENTIAL_INCONSISTENCIES.md` / `RULES_CANDIDATE.md §8.5`.)*

**3.10 `[CONFIRM]`** **Maintain an applied-migrations ledger per environment.**
This prevents the m069 "Done button" stale-schema class of issue. *(See
`POTENTIAL_INCONSISTENCIES.md §2`; `RULES_CANDIDATE.md §8.2`.)*

**3.11 `[CONFIRM]`** **Document jsonb contracts in one place** (e.g. a
`JSONB_SHAPES.md`) and change them only via their normalizer.
*(See `RULES_CANDIDATE.md §8.3`.)*

**3.12 `[FIX]`** **`RUN_THIS_FIRST_production_setup.sql` bundles pre-m046 PO RLS.**
The convenience bundle concatenates m018–m023 (original `production_orders` RLS),
which predates the m046 isolation hardening; re-running it after m046 may regress
isolation. Add a "do not run after m046" warning or regenerate it.
*[Confirmed: bundle contains m018 policies. `POTENTIAL_INCONSISTENCIES.md §10`.]*

**3.13 `[CODE]` (benign)** **Migration `040` is intentionally absent** (numbering
jumps 039 → 041). No migration was ever numbered 040 — do not hunt for a "lost"
one. *[Confirmed: `supabase/migrations/`; `POTENTIAL_INCONSISTENCIES.md §15`.]*

---

## 4. Role and permission rules

**4.1 `[CODE]`** **Two-layer security model (REAL vs EFFECTIVE).** Security =
REAL role (`getCurrentUserRole` / `hasCapability` / `requireCapability`);
rendering = EFFECTIVE role (`getEffectiveRole` / `hasUiCapability`). They must
never be swapped. *[Confirmed by code: `lib/auth.ts`, `lib/permissions.ts`.]*
(See §11.2 — must not be redesigned.)

**4.2 `[CODE]`** **`super_admin` is a virtual role** stored as the boolean
`user_roles.super_admin`; the DB `role` column stays `"admin"` for RLS
compatibility, and the role CHECK rejects the literal `'super_admin'`.
*[Confirmed by code/migration: m016; m042 line 29 CHECK; `lib/auth.ts`.]*

**4.3 `[CODE]`** **Only super-admins can simulate roles (View-As)**, and the
cookie is read for super-admins only. *[Confirmed by code: `lib/auth.ts
getEffectiveRole`; `app/(app)/view-as/actions.ts` throws if not super-admin.]*

**4.4 `[CODE]`** **Physical DELETE of business records is super-admin only**;
admins must cancel (status) or archive (`archived_at`). *[Confirmed by code:
`lib/auth.ts requireSuperAdmin` + comment; soft-delete model m024.]*

**4.5 `[CODE]`** **Technical roles (`task_list_manager` + `operations`) share the
task-list / production scope** and pass `requireTaskListManagerOrAdmin`
identically; `isTechnicalRole` = admin-like ∨ TLM ∨ operations. Their default
`production_order.*` matrices are **identical** (verified across m026/m042/m053).
*[Confirmed by code/migration: `lib/auth.ts`, `lib/types.ts`;
`USER_ROLES_AND_PERMISSIONS.md §3.2/§3.3/§7.4`.]*

**4.6 `[CODE]`** **The capability catalog is the 22-key `Capability` union**
(4 quotation, 5 task_list, 1 factory_mapping, 8 production_order, 1 forecast,
3 admin). Capability resolution reads `role_permissions` (enabled only), caches
30s per role, and is **fail-closed** (DB error → empty set → deny).
*[Confirmed by code (verified directly): `lib/permissions.ts:51-79,82-134`.]*

**4.7 `[CODE]`** **Default permission matrix (as seeded).** This is the seeded
baseline; a super-admin can diverge it live via `/permissions/actions`. Notable
defaults: `quotation.delete` = true for `sales` + `admin` (m055);
`task_list.delete` and `production_order.delete` = **super-admin only**;
`production_order.start_without_deposit`, `quotation.archive`, `task_list.archive`,
`production_order.archive`, `forecast.view_global` = admin-like only; all
`admin.*` (manage_permissions / manage_users / diagnostics) = **super-admin only
by default** (a plain `admin` cannot reach these pages without a matrix change).
*[Confirmed by migration: m026/m033/m042/m053/m055/m064; full table in
`USER_ROLES_AND_PERMISSIONS.md §4.2`.]*
> **Owner Decision I (confirmed 2026-05-30) — governance gate over this matrix.**
> This seeded matrix is the **technical baseline only**; per Decision I it must
> **NOT** be treated as final business rule until the owner reviews it in plain
> language. The readable export now lives at [`/docs/CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md).
> **No permission is changed by this decision.** After owner review the confirmed
> matrix moves into `/RULES.md`. Several of the defaults above also need
> reconciliation with Decisions B/F/H.10 (e.g. won-quote deletion vs `quotation.delete`,
> archive-with-reason vs `*.archive`, no-deposit approval vs
> `production_order.start_without_deposit`) — those reconciliations are documentation
> targets, **not yet implemented**. See §4.13 and `OWNER_DECISIONS_LOG.md` §I.

**4.8 `[CODE]`** **Account-owner reassignment uses the REAL role.**
`assignClientOwner` calls `getCurrentUserRole()` so View-As cannot bypass it; it
is offered to technical roles only. *[Confirmed by code:
`app/(app)/clients/actions.ts:25-26`; `DRAFT_AND_EDITING_RULES.md §5.4`.]*

**4.9 `[FIX]`** **Add defense-in-depth in-body guards to admin sub-pages that rely
solely on the layout guard.** `admin/products/images` and `admin/products/import`
have no in-body `requireAdmin()` / capability check; `/admin/users` and
`/admin/diagnostics` (which do both) are the correct pattern.
*[Confirmed by code: `USER_ROLES_AND_PERMISSIONS.md §7.1`;
`POTENTIAL_INCONSISTENCIES.md §12`.]*

**4.10 `[CONFIRM]`** **Default `quotation.delete` for `task_list_manager` /
`operations`** is not provable from the migrations audited (depends on the m026
seed for those roles). Verify in the DB and record the intended value.
*(See `DRAFT_AND_EDITING_RULES.md §4.1, §11 item 2`.)* **Now in scope of the
Decision I matrix-review gate (§4.13) — to be confirmed there, not ratified
blindly; the live DB was not introspected. No permission change yet.**

**4.11 `[CONFIRM]`** **Finish (or formally stop) the `requireCapability`
migration.** Both the legacy guards (`requireAdmin`,
`requireTaskListManagerOrAdmin`) and the capability guards coexist. Decide whether
all privileged actions should move to `requireCapability`, or the dual system
stays. *(See `USER_ROLES_AND_PERMISSIONS.md §7.8`.)*

**4.12 `[CONFIRM]`** **`VIEW_AS_ROLES` includes `super_admin`** (a harmless no-op
when selected). Decide whether to drop it from the picker to avoid confusing
maintainers. *[Confirmed by code: `lib/types.ts`;
`USER_ROLES_AND_PERMISSIONS.md §7.5`.]*

**4.13 `[CODE]` (discipline)** **Never use View-As to test RLS / visibility.**
View-As keeps the super-admin's DB session, so RLS-scoped queries return
super-admin-scope data. Use a real account of the target role.
*[Confirmed by code/source: `USER_ROLES_AND_PERMISSIONS.md §1, §7.3`.]*

**4.14 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision I)
**The seeded `role_permissions` matrix must be owner-reviewed via
`/docs/CAPABILITY_MATRIX.md` before it is ratified — and NO permission changes yet.**
**Target/Expected behavior:** the seeded permissions are a **technical baseline**,
not final business rules, until reviewed in plain language and approved by the owner.
The readable export [`/docs/CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md) shows,
per role: accessible pages; visible entities; allowed/restricted actions; admin,
document, quotation, task-list, production-order, shipping/BL, pricing/discount,
notification/message, and delete/archive permissions — each entry tagged
**Confirmed by code / Assumed from code / Needs owner confirmation / Potentially
risky**. After owner review, the confirmed matrix becomes part of `/RULES.md`.
*(This is a review gate; **no permission has been or should be changed**; the live
DB was not introspected.)*
**Current behavior:** the seeded matrix (§4.7) is enforced as-is, editable live by a
super-admin; it has not yet been reviewed/ratified as business policy. Canonical
decision text: `OWNER_DECISIONS_LOG.md` §I.

---

## 5. Draft / order lifecycle rules

**5.1 `[CODE]`** **Every new quotation (and every revision) starts as `draft`.**
The valid forward sales path is `draft → sent → negotiating → won / lost`; advance
is explicit. *[Confirmed by code: `app/(app)/documents/new/actions.ts:403`
(`status: "draft"`); `DocStatus` union and CHECK (m008/m017).]*

**5.2 `[CODE]`** **Edit-in-place is for `draft` only.** `saveDocument` throws if
`edit_of` targets a non-draft ("Only draft quotations can be edited in place. Use
'Create new version' to revise…"). A draft edit replaces its lines/containers
wholesale and emits `doc.updated`. *[Confirmed by code:
`app/(app)/documents/new/actions.ts:217-341` (status check ~225-229).]*

**5.3 `[CODE]`** **A `sent`/`negotiating` quotation is never edited in place — it
is revised into a new version.** "The sent version is the record of what the client
received." *[Confirmed by code: `components/DocQuickActions.tsx:101-127`.]*

**5.4 `[CODE]`** **Quotation versioning shares `root_document_id` and increments
`version`.** A revision strips any `-V{n}` suffix, counts siblings, assigns the
next `-V{n}`, points `root_document_id` at V1, and starts as `draft`. Downstream
surfaces (and the forecast) dedupe to the **latest** version per affair.
*[Confirmed by code: `app/(app)/documents/new/actions.ts:344-446`; m059;
`lib/forecast.ts`.]*

**5.5 `[CODE]`** **Advisory validation never blocks send/win.** `validation_status`
(`pending/approved/rejected`, m068) is informational only; `updateDocumentStatus`
and `saveDocument` never read it. Any authenticated viewer may **request**;
only admin-like may **review**. *[Confirmed by code: `lib/validation.ts` header;
`app/(app)/documents/[id]/actions.ts updateDocumentStatus`;
`DRAFT_AND_EDITING_RULES.md §10`.]*

**5.6 `[CODE]`** **A production order is auto-created when its task list flips to
`validated`** (`ensureProductionOrderForTaskList`); one per task list. A task list
is "production-ready" at status `validated` or `production_ready`.
*[Confirmed by code: `app/(app)/task-lists/[id]/actions.ts:415-566,644`;
`lib/types.ts:483-489`; `lib/lifecycle.ts TASK_LIST_PRODUCTION_STATUSES`.]*

**5.7 `[CODE]`** **Task lists lock for sales** once status ∈
`TASK_LIST_LOCKED_FOR_SALES = [under_validation, validated, production_ready,
cancelled]`; sales can edit again only when a TLM bounces it to `needs_revision`.
Technical roles bypass the lock. *[Confirmed by code: `lib/types.ts:421-426`;
enforced in `app/(app)/task-lists/[id]/actions.ts` and the page render.]*

**5.8 `[CODE]`** **Cancellation cascades via DB triggers** (m023): document → task
lists → production orders, skipping any target already `cancelled` or `delivered`.
A **delivered** production order is never auto-cancelled. `CASCADE_RULES` mirrors
this for the confirm dialogs. *[Confirmed by code: m023;
`lib/lifecycle.ts:214-236`.]*

**5.9 `[CODE]`** **Production "activates" when the deposit is fully received OR a
start-without-deposit override fires.** Override is admin-only, flips
`awaiting_deposit → deposit_received`, emits a HIGH event, and does **not** alter
the received-amount fields. *[Confirmed by code: `lib/production-lifecycle.ts:57-88`;
m025.]*

**5.10 `[CODE]`** **The baseline (Initial Project Completion = `start_date +
production_working_days`) is stamped ONCE at activation and frozen** (it locks at
activation, not at first `working_days` save). *[Confirmed by code:
`lib/production-lifecycle.ts` `getInitialProjectCompletion`,
`computeInitialProjectCompletionForActivation`, `isBaselineLocked`; m041.]*

**5.11 `[CODE]`** **Deadlines move by additive delay events, never by overwriting.**
`production_deadline_changes.days_added` (m073) is the authoritative signed delta;
the new date is computed `current + days_added`. Operational delay =
`current_production_deadline − initial_production_deadline`.
*[Confirmed by code (verified directly): `lib/delays.ts:91-167`;
`lib/production-lifecycle.ts computeBaselineDelay`.]* (See §11.4.)

**5.12 `[CODE]`** **Only `delay_type='production'` (or legacy NULL) counts toward
the factory KPI**; external delays surface but don't inflate it. Delay events are
**editable but audit-logged** (`updated_by`/`updated_at`, m074) — a deliberate
choice over strict immutability. *[Confirmed by code (verified directly):
`lib/delays.ts isFactoryDelay`, `computeDelayBreakdown`; m072/m074.]*

**5.13 `[CONFIRM] / [FIX]`** **Single canonical definition of "completed."**
`getLifecyclePhase` calls an order `completed` when `actual_completion_date` is
set; `computeOrderFlightStage` shows "Production complete" on status
`production_completed`. These can disagree. Pick one rule and derive both from it.
*[Confirmed by code: `lib/production-lifecycle.ts:254-268` vs
`lib/lifecycle.ts:307-355`; `POTENTIAL_INCONSISTENCIES.md §11`.]*

**5.14 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision B)
**A `won` quotation is REVISE-ONLY — never edited in place.** **Target/Expected
behavior:** any commercial change after `won` must be made through a **new revision /
new version** linked to the original; the previous won version is **preserved for
audit/history**; the **Create revision / Revise quote** action is clear and
accessible from the won quotation detail page. (Task-list impact control when a
production task list already exists is specified in §5.19.) *(Target — not yet
implemented.)*
**Current behavior:** code blocks in-place edits of non-draft docs, but the
`?revise` path stays reachable from the 3-dot menu at any status, and there is no
read-only gate on `won`. *(Note: `won` is in `DOC_TERMINAL_STATUSES` in
`lib/lifecycle.ts` but **not** in `lib/types.ts DOC_TERMINAL_STATUSES` — two
differing definitions to reconcile.)* *[Confirmed by code:
`DRAFT_AND_EDITING_RULES.md §3.2, §7.1`; `BUSINESS_RULES.md B10`.]* Canonical
decision text: `OWNER_DECISIONS_LOG.md` §B. (See §5.19, §11.8.)

**5.15 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision F, HIGH risk)
**Deletion is restricted by lifecycle status; sales must NOT freely cascade-delete a
`won` quote's production order.** **Target/Expected behavior:** **Draft** may be
deleted by authorized users; **sent/negotiating** only if **no downstream** task
list or production order exists. Once `won`, a quote is **not freely deleted**: with
**no linked task list yet** → deletion allowed only for **admin / super-admin**, with
strong confirmation, preferably recorded in an **audit log**; with a **linked task
list or production order** → deletion is **blocked by default** (use cancellation or
archive; **no silent cascade** of production data). *(Target — not yet implemented.)*
**Current behavior:** RLS (m057) lets **any owner** DELETE their own document at any
status; the FK cascade then physically removes the linked production order, with no
status/lifecycle guard. *[Confirmed by code: `app/(app)/documents/[id]/actions.ts:494-506`;
m057; `DRAFT_AND_EDITING_RULES.md §4.3, §11 item 1`.]* Canonical decision text:
`OWNER_DECISIONS_LOG.md` §F. (Reconcile with the `quotation.delete` default in §4.7.)

**5.16 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision F)
**Archiving must require an archive reason and separate the record from active
workflow.** **Target/Expected behavior:** when a quotation, task list, or production
order is archived, the user must provide an **archive reason**; the archive action
stores **archive reason, archived by, archived at, optional internal note**.
Archived records remain **searchable/readable for history**, are **visually
separated** from active records, and do **not** appear in active workflow dashboards
unless a filter is enabled. (Archiving must not be silent.) *(Target — not yet
implemented; the full archive rule is restated at §5.20.)*
**Current behavior:** an archived quotation can still be status-changed and revised;
the page only hides the validation panel; no archive reason is captured.
*[Confirmed by code: `app/(app)/documents/[id]/actions.ts` archive/unarchive;
`DRAFT_AND_EDITING_RULES.md §7.3`.]* Canonical decision text:
`OWNER_DECISIONS_LOG.md` §F. (See §5.20.)

**5.17 `[CONFIRM]`** **Is `cancelled` in `TASK_LIST_LOCKED_FOR_SALES` intentional?**
It means sales cannot edit a cancelled task list — confirm whether that immutability
is desired or incidental. *[Confirmed by code: `lib/types.ts:421-426`;
`DRAFT_AND_EDITING_RULES.md §8.4`.]*

**5.18 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision A)
**Winning a quote must NOT auto-create the production task list; creation is manual,
mandatory, and highly visible.** **Target/Expected behavior:** after a quotation is
marked `won`, the app must clearly show a **required action: "Create Production Task
List"**; if a won quotation has **no linked task list**, it must appear as an
**alert / Action Center item until the task list is created**. (Rationale: avoid
creating production task lists too early when commercial / payment / configuration /
shipping details are not fully ready, while preventing won deals from being
forgotten.) *(Target — not yet implemented.)*
**Current behavior:** a production order is auto-created when a **task list** flips
to `validated` (§5.6), but the **task list itself is not auto-created on win** —
there is no required-action prompt or "won without task list" alert. *[Confirmed by
code: `app/(app)/task-lists/[id]/actions.ts` (production-order creation); absence of
any on-win task-list creation; `DRAFT_AND_EDITING_RULES.md`.]* Canonical decision
text: `OWNER_DECISIONS_LOG.md` §A. (Do-not-auto-create invariant in §11.7.)

**5.19 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision B)
**Revising a `won` quote when a production task list already exists must drive a
controlled review — never a silent overwrite.** **Target/Expected behavior:**
- **If no production task list exists yet:** the new revision becomes the active
  commercial version once validated.
- **If a production task list already exists:** the app must **not silently
  overwrite** it; it must **detect and display the differences** between the previous
  won version and the new revision; changes affecting **production, configuration,
  quantity, shipping, deadlines, payment terms, or BL information** must trigger a
  **review state**; the linked task list must be marked as **requiring review /
  update** before production continues; operations / the task-list manager must
  confirm whether the task list should be **updated, regenerated, or kept unchanged**.
*(Target — not yet implemented.)*
**Current behavior:** revisions share `root_document_id` and increment `version`
(§5.4) and downstream surfaces dedupe to the latest version, but there is **no
diff/review-state mechanism** linking a new revision to an existing task list.
*[Confirmed by code: `app/(app)/documents/new/actions.ts:344-446`; absence of any
revision-vs-task-list diff; `DRAFT_AND_EDITING_RULES.md`.]* Canonical decision text:
`OWNER_DECISIONS_LOG.md` §B. (Do-not-edit-won-in-place invariant in §11.8.)

**5.20 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision F)
**Archiving a quotation, task list, or production order requires an archive reason
and stores full archive metadata.** **Target/Expected behavior:** the archive action
must store **archive reason, archived by, archived at, optional internal
note/comment**; archived records remain **searchable/readable for history**, are
**visually separated** from active records, and **do not appear in active workflow
dashboards** unless a filter is enabled. The correct disposition for a committed
(`won` / in-production) order is usually **cancel / archive, not destructive
deletion** (§5.15); archiving must not be silent. *(Target — not yet implemented.)*
**Current behavior:** archive/unarchive toggles `archived_at` only; no reason or
metadata is captured, and archived records are not consistently separated from
active workflow. *[Confirmed by code: `app/(app)/documents/[id]/actions.ts`
archive/unarchive; soft-delete model m024; `DRAFT_AND_EDITING_RULES.md §7.3`.]*
Canonical decision text: `OWNER_DECISIONS_LOG.md` §F.

---

## 6. Product block rules

**6.1 `[CODE]`** **Factory configuration (overrides/extras) must NEVER overwrite the
sales configuration.** Resolution priority is **override > client_preset > mapping
> missing**. *[Confirmed by code: `lib/types.ts resolveFactoryInstruction` (~252-350);
`factory_overrides` / `factory_extras` on `production_task_list_lines` (m071);
`client_technical_presets` (m071).]* Standing product rule (see §11.3).

**6.2 `[CODE]`** **Factory mapping is factory-only** — TLM / Operations / Super-Admin
via the `factory_mapping.access` capability (m064). Pages `/factory-mapping`
(ops) and `/admin/factory-mapping` use a defensive role-OR-capability gate.
*[Confirmed by code: `lib/permissions.ts:63`; `app/(app)/factory-mapping/page.tsx:26`.]*

**6.3 `[CODE]`** **Sales config and factory config are separated on display.** The
quotation view shows only sales `config_values`. The production order's
`OrderConfigSummary` shows only sales-visible fields
(`visible_in_task_list AND NOT internal_only AND field_scope != 'technical'`) and
**explicitly excludes** `technical_values` and `factory_overrides`.
*[Confirmed by code: `app/(app)/production/orders/[id]/page.tsx:278-330` + comment.]*

**6.4 `[CODE]`** **Custom option values use the sentinel `"__custom__"`**
(`CUSTOM_OPTION_SENTINEL`), with the free text stored at
`config_values["${field}__custom"]`. The sentinel is always resolved for display
and must never leak to users or PDFs. Custom is opt-in per field via
`allow_custom_value` (m010, dropdown only). *[Confirmed by code: `lib/types.ts:148-176`;
`PRODUCT_AND_PRICING_RULES.md §2.3`.]*

**6.5 `[CODE]`** **Config fields have a scope (`sales` | `technical`).** `sales`
fields appear on the quotation builder; `technical` fields appear in the task
list's technical section and are editable only by technical roles. Empty/null/
`false` config values are filtered from display; `true` renders as "Yes".
*[Confirmed by code: `lib/types.ts ConfigFieldScope`;
`app/(app)/documents/[id]/page.tsx:1021-1036`.]*

**6.6 `[CODE]`** **"Configure now / configure later" is a UI affordance only — not a
data state.** The configurator collapses config by default; there is no DB flag for
"unconfigured"; `config_values` is simply empty/partial until filled.
*[Confirmed by code: `components/ProductConfigurator.tsx:683-739`;
`PRODUCT_AND_PRICING_RULES.md §2.3`.]*

**6.7 `[CONFIRM]`** **Define which per-line technical fields are REQUIRED before a
task list may be submitted for validation** (`draft → under_validation`). Code
defines `technical_values` and the `technical` scope but enforces no required-field
list. *(See `BUSINESS_RULES.md C8`; `PRODUCT_AND_PRICING_RULES.md §13 item 10`.)*

**6.8 `[CONFIRM]`** **Confirm the `field_scope = 'technical'` write-enforcement
gate.** The exact server action / RLS that prevents sales from writing technical
fields was not traced; enforcement appears to be UI + server-action level, not DB.
*(See `PRODUCT_AND_PRICING_RULES.md §2.4, §13 item 10`.)*

**6.9 `[CONFIRM]`** **`selected_options` vs `config_values` overlap.** On the
document line table these render in adjacent cells from two data sources; confirm
whether they overlap (and should merge) or are complementary.
*(See `UI_UX_AUDIT.md §9`.)*

---

## 7. Pricing rules

**7.1 `[CODE]`** **Tier pricing is authoritative; `products.base_price` is
deprecated** (always inserted as `0`, never used in calculations). Auto unit price =
`tierPrice(product, tier) + Σ option price_modifiers`; if no tier price exists,
return `null` and warn — **no fallback to `base_price`**.
*[Confirmed by code: `lib/pricing.ts:11-34`;
`app/(app)/admin/products/actions.ts:63`.]*

**7.2 `[CODE]`** **Pricing mode is per line (`auto` | `manual`).** `manual` lets the
user type `original_unit_price` (seeded from the standard price on switch). The
document-level `manual_pricing` flag is true if **any** line is manual.
*[Confirmed by code: `document_lines.pricing_mode`;
`components/ProductConfigurator.tsx:368`; `NewDocumentForm.tsx:579`.]*

**7.3 `[CODE]`** **Discounts are per line only** (no document-level discount).
`percentage`: `original × (1 − value/100)`; `fixed`: `original − value`; both
clamped to ≥ 0; null/≤0 = none. Line total = `unit_price × quantity` (post-discount).
*[Confirmed by code: `lib/pricing.ts:36-46`; `document_lines.discount_type` CHECK.]*
> **Owner Decision H.2 (confirmed 2026-05-30) — target, not yet implemented.**
> Target adds **document-level** discounts alongside line-level, plus approval tiers,
> margin warning, and full traceability — see **§7.15**. The current line-only model
> is the **current behavior**.

**7.4 `[CODE]`** **Grand total formula.**
`items_total = Σ line.total_price`; `freight_total = Σ containerLineTotal(c)`
(LCL adds `wooden_box_cost`); `subtotal = items + freight`;
`commission = commissionAmount(subtotal)`; `grand_total = subtotal + commission`,
stored in `documents.total_price`. *[Confirmed by code:
`app/(app)/documents/new/actions.ts:146-157`; `lib/logistics.ts containerLineTotal`.]*

**7.5 `[CODE]`** **Commission is computed on the subtotal (items + freight), added
on top of the grand total**, and is treated (display-only) as paid out of the
seller's margin. PDF visibility is gated by `show_commission_in_pdf` (false → the
PDF receives `commission_amount = 0`). *[Confirmed by code: `lib/commission.ts:13-18`;
`app/(app)/documents/[id]/page.tsx:381-384`.]* (Promote to policy via §2.8.)

**7.6 `[OWNER-CONFIRMED 2026-05-30]`** (Decision H.4, partial — already in code)
**Currencies are `USD | EUR | CNY`; bank account is selected by document currency;
switching currency auto-selects that default account.** The owner confirms
**one primary currency per document** and **bank details depend on the document
currency** (USD doc → USD account, EUR → EUR, CNY → CNY), default matching the
currency, with the option to select another **authorized** account.
*[Confirmed by code: `lib/types.ts Currency`; m005; `NewDocumentForm.tsx:270-289`.]*
> **Note:** the *conversion / FX, rate-locking, and adjustment-clause* portions of
> Decision H.4 are **target — not yet implemented**; see **§7.16**.

**7.7 `[CODE]`** **Payment terms (`PaymentMode` = `deposit_balance | lc | hybrid`)
are normalized per mode and validated.** `deposit_balance`: `deposit_percent`
0–100 + `balance_condition`; `lc`: `lc_type` (+`lc_days` if usance);
`hybrid`: `deposit_percent` + `lc_days` ∈ {30,60,90,120}. Irrelevant keys are
stripped on save. *[Confirmed by code: `lib/payment.ts normalizePaymentTerms`,
`validatePaymentTerms`.]*

**7.8 `[CODE]`** **Expected deposit/balance and the payment state machine.**
`lc` → expected deposit 0; `deposit_balance`/`hybrid` →
`total × deposit_percent/100`; `expectedBalance = max(0, total − expectedDeposit)`.
State ∈ `no_terms / no_deposit_required / awaiting_deposit / deposit_received /
partial_balance / paid_in_full`, with a 1-cent epsilon tolerance.
*[Confirmed by code: `lib/types.ts:638-700`.]*

**7.9 `[CONFIRM]`** **"Latest price" tie-break.** When multiple `prices_version`
rows exist for a (product, tier), `buildTierPriceMap` keeps the **first row the
query returns**; the ordering lives at the call site, not in `lib/pricing.ts`.
Confirm the intended active-price rule and ensure callers order
`valid_from desc`. *(See `PRODUCT_AND_PRICING_RULES.md §1.4, §13 item 1`.)*

**7.10 `[OWNER-CONFIRMED 2026-05-30]`** (Decision H.3) **Always tax-free — no
VAT/tax anywhere in the pricing stack; this is intentional (export-only).**
**Confirmed rule:** quotations, proforma invoices, and export documents are
**tax-free by default**; the app must **not** auto-calculate or add VAT/tax.
**Current behavior** already adds no tax — this matches the decision.
*[Confirmed by code: absence of any tax field in the pricing stack;
`PRODUCT_AND_PRICING_RULES.md §4.5`.]*
> **Target — not yet implemented:** explicit display affordances ("VAT / Tax: 0",
> "Tax-free export sale", "VAT not applicable for export") and hiding/zeroing any
> residual tax field. Canonical decision text: `OWNER_DECISIONS_LOG.md` §H.3.

**7.11 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision H.4)
**Currency conversion is allowed but must be explicit, traceable, and locked per
document version.** **Target/Expected behavior:** each document has **one primary
currency**; prices may live in a base currency (normally USD) but the final total is
displayed in the document currency; on conversion the app stores **source currency,
target currency, exchange rate, rate date, rate source, converted by, converted at**;
once saved/sent the rate is **locked for that version** (no silent live-rate drift),
and a revision may keep the original rate or apply a new one. Full FX detail
(rate display, adjustment clause, bank-by-currency) is consolidated in **§7.16**.
*(Target — not yet implemented.)*
**Current behavior:** no FX — tier prices (likely entered in USD) are used as-is
regardless of document currency; there is no conversion, rate storage, or locking.
*[Confirmed by code: absence of FX in `lib/pricing.ts`; `PRODUCT_AND_PRICING_RULES.md §6`.]*
Canonical decision text: `OWNER_DECISIONS_LOG.md` §H.4.

**7.12 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision H.5)
**Round monetary amounts to 2 decimals at document level, with explicit calculation
order; the balance absorbs rounding.** **Target/Expected behavior:** all monetary
values (unit prices, line totals, subtotal, discounts, grand total, deposit, balance,
commission, conversion results) show **2 decimals**; calculate with sufficient
internal precision then round (standard 0.005↑); **round each line → sum rounded line
totals → apply document discount → grand total → round**; **balance = grand total −
deposit** so the balance **absorbs any rounding difference** and totals reconcile
exactly; the **exchange rate is stored with more precision than 2 decimals**. (Detail
restated in **§7.17**.) *(Target — not yet implemented.)*
**Current behavior:** no explicit rounding policy — prices/commission/deposit are
stored as full floats; only the display calls `.toFixed(2)`.
*[Confirmed by code: full-float storage; `PRODUCT_AND_PRICING_RULES.md §4.6`.]*
Canonical decision text: `OWNER_DECISIONS_LOG.md` §H.5. (See §7.17.)

**7.13 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decisions H.6–H.9)
**The commercial defaults are now confirmed policy** (they were developer defaults).
The owner has set: **deposit 30%** (§7.18, H.6); **offer validity 30 days (products)
/ 7 days (transport)** (§7.20, H.8); **warranty selectable per product** with common
3y/5y/10y values (§7.21, H.9); and a **default balance reminder** of **20 days
(Africa) / 15 days (others)** — replacing the nullable, no-standard
`balance_reminder_days_before_eta` (§7.19, H.7). Each is **editable** per the
referenced rule. *(Targets — not yet implemented; see §7.18–§7.21.)*
**Current behavior:** these were unconfirmed developer defaults — 30% deposit;
offer validity 30/7; warranty common values 3/5/10; `balance_reminder_days_before_eta`
nullable (no standard, not region-aware). *[Confirmed by code:
`PRODUCT_AND_PRICING_RULES.md §7.4, §8.4, §9, §13 items 6-9`.]* Canonical decision
text: `OWNER_DECISIONS_LOG.md` §H.6–§H.9.

**7.14 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision H.1)
**Catalogue / price-list pricing by default, with controlled manual override;
management assigns the default price list and the app proposes it by priority.**
**Target/Expected behavior:** product prices default from the **active product price
list**; support **multiple price lists** (high, medium, low, distributor, regional,
special-project); a **director/authorized manager** can assign a default price list
to a **sales user, region, country/market, or specific client**. On quotation
creation, propose the default by **priority: (1) client-specific → (2) sales-user
assigned → (3) region/country assigned → (4) company default**. A line may use the
default catalogue price, a selected tier/price-list price, a client-specific price,
or a **manual override** — and a manual override must be **visible and traceable**,
storing **original price, selected price list, overridden price, override reason (if
required), overridden by, overridden at**. *(Target — not yet implemented.)*
**Current behavior:** pricing is per-line `auto | manual` over a single tier-price
map (§7.1, §7.2); there is **no concept of multiple assignable price lists** or
priority resolution, and override metadata beyond `original_unit_price` is not stored.
*[Confirmed by code: `lib/pricing.ts`; `document_lines.pricing_mode`;
`PRODUCT_AND_PRICING_RULES.md §1`.]* Canonical decision text: `OWNER_DECISIONS_LOG.md` §H.1.

**7.15 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision H.2)
**Discounts are allowed but controlled, visible, and traceable, with approval tiers
and a margin warning.** **Target/Expected behavior:** support **line-level and
document-level** discounts; clearly display original unit price, discount % or
amount, discounted unit price, total discount, final line total, final document
total; store per discount **type (percentage/fixed), value, reason, discounted by,
discounted at**. **Approval:** sales user up to an approved limit; sales
manager/director approves larger; admin/super-admin can override — limits
configurable later, and until then discounts above an internal threshold are marked
**requiring approval**. **Margin warning:** if a discount brings the quote below the
minimum accepted margin, show a warning or **require manager approval** — never
silently allow a price below the commercial safety threshold. *(Target — not yet
implemented.)*
**Current behavior:** discounts are **line-only** (§7.3), with no document-level
discount, no approval workflow, no configurable limits, and no margin/safety-threshold
check. *[Confirmed by code: `lib/pricing.ts:36-46`; `document_lines.discount_type`.]*
Canonical decision text: `OWNER_DECISIONS_LOG.md` §H.2.

**7.16 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision H.4 — FX detail)
**Currency conversion: explicit, traceable, rate locked per version; large orders may
carry an exchange-rate adjustment clause; bank account follows the document currency.**
**Target/Expected behavior:**
- The **user chooses** whether the rate appears on the quotation/proforma/invoice.
- **Large / high-risk orders** may show the rate used, its date, and an **exchange-rate
  adjustment clause**: if the rate moves significantly between
  quotation/deposit/production/shipment/final payment, SOLUX can **adjust the final
  amount or request a price revision** (configurable threshold; may apply before
  production launch or final shipment). Mark a quote as **exchange-rate protected**,
  **adjustment-clause included**, or **fixed-rate**.
- **Bank account by currency:** available bank details depend on the document currency
  (USD→USD, EUR→EUR, CNY→CNY); the user may select another **authorized** account, with
  the default matching the currency (the currency↔bank default already exists, §7.6).
- Rate locking and per-version storage are specified in §7.11.
*(Target — not yet implemented, except the currency↔bank default of §7.6.)*
**Current behavior:** no FX, no rate storage/locking, no adjustment clause; only the
currency-to-default-bank selection exists. *[Confirmed by code: §7.6; absence of FX in
`lib/pricing.ts`; `PRODUCT_AND_PRICING_RULES.md §6`.]* Canonical decision text:
`OWNER_DECISIONS_LOG.md` §H.4.

**7.17 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision H.5 — detail)
**2-decimal document-level rounding; line→sum→document-discount→grand-total order;
balance absorbs the rounding difference.** **Target/Expected behavior:** as summarized
in §7.12 — round each line total to 2 decimals, sum the rounded line totals, apply any
document discount, compute the grand total and round to 2 decimals (avoiding
sum-of-lines vs document-total discrepancies); the **deposit** is rounded to 2 decimals
and the **balance = grand total − deposit absorbs** any residual difference;
**commission** is taken from the finalized commercial basis rounded to 2 decimals; a
**converted amount** is rounded to 2 decimals in the target currency while the exchange
rate is stored with more precision. *(Target — not yet implemented.)*
**Current behavior:** full-float storage, display-only `.toFixed(2)` (§7.12).
Canonical decision text: `OWNER_DECISIONS_LOG.md` §H.5.

**7.18 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision H.6)
**Default deposit 30% / balance 70%, editable per deal; non-standard terms must be
visible and controlled.** **Target/Expected behavior:** prefill **deposit 30% /
balance 70%**; keep payment terms editable, supporting **30/70, 25/75, 20/80, 100%
before production, deposit + L/C, L/C at sight, L/C 30/60/90 (if approved), no-deposit
(only if explicitly authorized — see §7.22)**. Non-standard terms must be visible and
traceable; risky terms (low deposit, delayed balance, long credit) require management
approval or at least a **risk warning**. *(Target — not yet implemented as a 30%
prefill + approval/warning flow.)*
**Current behavior:** payment terms exist (`deposit_balance | lc | hybrid`, §7.7) with
an editable `deposit_percent`, but there is **no 30% default prefill** and **no
approval / risk-warning** for non-standard terms. *[Confirmed by code:
`lib/payment.ts`; `lib/types.ts:638-700`.]* Canonical decision text:
`OWNER_DECISIONS_LOG.md` §H.6.

**7.19 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision H.7)
**A balance-before-shipment reminder is created by default, region-adaptive: Africa
20 days, others 15 days, editable.** **Target/Expected behavior:** for orders with a
balance due before shipment, create a default reminder **before the expected shipment
/ production-completion date** — **Africa = 20 days**, **other regions = 15 days**
(unless another regional rule is configured), editable by authorized users. Applies
when the payment term includes a balance before shipment, the order is in production,
and the balance is not yet received. Visible in the **Action Center, the order detail
page, and the finance / payment follow-up area**. *(Target — not yet implemented.)*
**Current behavior:** `balance_reminder_days_before_eta` is **nullable with no default
and no region logic**; reminders/alerts are separate non-push surfaces (§9.7).
*[Confirmed by code: `PRODUCT_AND_PRICING_RULES.md §9`; `lib/reminders.ts`,
`lib/operations-alerts.ts`.]* Canonical decision text: `OWNER_DECISIONS_LOG.md` §H.7.

**7.20 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision H.8)
**Offer validity windows are distinguished: product prices 30 days, transport/freight
7 days, both editable.** **Target/Expected behavior:** distinguish **product price
validity, transport price validity, and full quotation validity** (if different);
defaults **product 30 days / freight 7 days**, editable; allow shorter/longer validity
manually for large projects, tenders, unstable markets, special discounts, or
FX-sensitive quotes; display **offer-valid-until** and **freight-valid-until** dates,
plus an exchange-rate clause when applicable. *(Target — not yet implemented as
distinct product-vs-freight windows.)*
**Current behavior:** offer-validity defaults of 30 (products) / 7 (transport) exist as
unconfirmed developer defaults, not clearly split or surfaced as separate
valid-until dates. *[Confirmed by code: `PRODUCT_AND_PRICING_RULES.md §8.4`.]*
Canonical decision text: `OWNER_DECISIONS_LOG.md` §H.8.

**7.21 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision H.9)
**Warranty is selectable per product; prefilled from product config; changes are
visible/traceable and frozen onto the document version.** **Target/Expected behavior:**
support a **warranty duration at product level** with a per-product default (e.g. 3y,
5y, 10y; custom only if approved); **prefill** the warranty from product config when a
product is added to a quote; allow a commercial change but make special extensions
**visible/traceable**, storing on manual change **original product warranty, selected
warranty, changed by, changed at, reason (if needed)**; the warranty is **stored with
the document version** so later product-warranty changes do **not** alter old
quotations. *(Target — not yet implemented.)*
**Current behavior:** warranty exists with common values 3/5/10 as developer defaults,
not modeled as a per-product default with prefill + change-audit + version freeze.
*[Confirmed by code: `PRODUCT_AND_PRICING_RULES.md §7.4`.]* Canonical decision text:
`OWNER_DECISIONS_LOG.md` §H.9.

**7.22 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision H.10)
**`no_deposit_required` is an exceptional condition requiring explicit authorization
— never set casually by a normal sales user.** **Target/Expected behavior:** by
default every order requires a deposit before production (usually 30%, §7.18).
`no_deposit_required` means SOLUX agrees to start without a deposit and is allowed
**only** in exceptional cases (trusted long-term customer, strategic project, public
tender with confirmed financing, L/C or bank-backed, internal management decision,
special director/admin agreement). **Authorization:** a sales user **cannot approve
alone**; a sales manager/director may request/approve per permissions; admin/super-
admin can approve; finance approval may be required if risk is high. If selected,
store **reason, approved by, approved at, payment guarantee/alternative security (if
any), internal comment**, and the UI must clearly flag the order as a **no-deposit
exception**. *(Target — not yet implemented as an approval-gated exception.)*
**Current behavior:** a `no_deposit_required` payment state exists (§7.8) and a
`production_order.start_without_deposit` override is admin-only at production
activation (§5.9), but there is **no approval workflow, justification capture, or
exception flag** at quotation time. *[Confirmed by code: `lib/types.ts:638-700`;
`lib/production-lifecycle.ts:57-88`; m025; default matrix §4.7.]* Canonical decision
text: `OWNER_DECISIONS_LOG.md` §H.10.

---

## 8. Shipping / BL rules

**8.1 `[CODE]`** **Shipping data is intentionally split across three entities:**
**parties** on the client BL profile (`clients.bl_profile`, m054); **ports /
incoterm / freight / containers** on the quotation (`documents` + `document_containers`);
**BL execution** on the production order (`shipping_details` jsonb, m070 — plus
`etd`/`eta`/`shipment_booked`/`shipping_notes` as separate columns).
*[Confirmed by code: `lib/shipping.ts`/`lib/bl.ts` headers; m054/m070;
`SHIPPING_AND_BL.md §1`.]*

**8.2 `[CODE]`** **Default shipper is the Solux factory** ("CHANGZHOU SOLUX
TECHNOLOGY COMPANY LTD") and is backfilled onto every client BL profile that has no
shipper. *[Confirmed by code: `lib/bl.ts SOLUX_SHIPPER_DEFAULT`,
`normalizeBlProfile`.]*

**8.3 `[CODE]`** **BL / destination follow-up applies only to seller-ships
incoterms (CFR/CIF/DDP/DDU) or LCL freight;** `EXW`/`FOB` raise no BL action.
The BL sensor fires only for PO statuses in `BL_STAGE_STATUSES`
(`deposit_received`, `production_scheduled`, `in_production`, `production_delayed`,
`production_completed`). *[Confirmed by code: `lib/action-center.ts blRequired`,
`SHIPPING_INCOTERMS`, `BL_STAGE_STATUSES`.]*

**8.4 `[FIX · approved, not applied]`** (Decision G) **Align the `shipping_details`
reader keys.** **Owner-approved fix (NOT yet applied):** change the reader to
`forwarder`/`vessel` (the keys actually stored); **do not rename the stored jsonb
keys**. Per Decision G the **minimum field to clear the BL-missing alert is
`forwarder`**, and **`bl_number` must NOT be mandatory** for the first BL follow-up
alert (the BL number may only arrive later, though it should still be stored when
available). The "BL missing" Action Center item should self-clear once the required
BL/shipping fields are filled. **Current behavior (the bug):** `blIsFilled` reads
`forwarder_name`/`vessel_name`; data is stored as `forwarder`/`vessel`, so entering
the forwarder/vessel does **not** clear the "BL missing" card (only `bl_number` or a
filled consignee company does). *[Confirmed by code (verified directly):
`lib/action-center.ts:336` vs `lib/shipping.ts:16-17`;
`PROBLEMS_AND_INCONSISTENCIES.md §1`, `SHIPPING_AND_BL.md §6`.]* (Same fix as §3.6;
do-not-rename invariant §11.9.) Canonical decision text: `OWNER_DECISIONS_LOG.md` §G.
*(The earlier open `[CONFIRM]` — whether `forwarder` alone clears the card vs keeping
`bl_number` required — is now **resolved by Decision G: `forwarder` alone clears it**.)*

**8.5 `[CODE]`** **Consignee/notify prefill shortcuts.** Consignee can prefill from
the client (`same_as_client`); notify can mirror the consignee
(`same_as_consignee`, which hides the notify fields). All BL-profile fields
round-trip correctly via `normalizeBlProfile`. *[Confirmed by code: `lib/bl.ts`;
`components/clients/ClientBlEditor.tsx`; `SHIPPING_AND_BL.md §2, §5`.]*

**8.6 `[CODE]`** **The BL document checklist tracks required export docs + optional
per-document cost; file upload is intentionally out of scope** (files would use the
separate `attachments` system, m060). *[Confirmed by code: `lib/bl.ts
BL_DOCUMENT_CATALOG`, header comment.]*

**8.7 `[CODE]`** **`shipping_details.forwarder`/`vessel` etc. DO save and reload
correctly on the order page** — the bug in §8.4 is only the Action Center
self-clear, not data loss. *[Confirmed by code: `lib/shipping.ts:56-71`;
`SHIPPING_AND_BL.md §4.5, §6.1`.]*

**8.8 `[CONFIRM] / [FIX]`** **`FreightType` lacks the plain `40ft` that
`ContainerType` allows** (see §3.7). Decide align-or-document.

**8.9 `[CONFIRM]`** **Model shipping marks and/or structured BL instructions?**
Today neither exists; only free text in `bl_profile.notes` (client) **and**
`production_orders.shipping_notes` (order) — two unstructured notes fields whose
roles are ambiguous. *[Confirmed by code: absence in `lib/bl.ts`/`lib/shipping.ts`;
`SHIPPING_AND_BL.md §7.1, §7.2`.]*

**8.10 `[CONFIRM]`** **Container-to-order link is absent.** Containers are planned
on the quote (`document_containers`), but the order has no container reference.
Decide whether to record the actually-used container on the order or accept the
quote plan as sufficient. *[Confirmed by code: `ShippingDetails` has no container
field; `SHIPPING_AND_BL.md §7.3`.]*

**8.11 `[CONFIRM]`** **Quote-level shipping editability after `won`.** Whether
ports/incoterm/freight/containers stay editable once the document is `won` / a task
list exists was not verified. *(See `SHIPPING_AND_BL.md §3.5, §11 item 3`.)*

**8.12 `[CONFIRM]`** **Should sales freely edit a client's BL profile at any time,
including while shipments are in flight?** The action has no extra capability gate
beyond client-write RLS. *(See `DRAFT_AND_EDITING_RULES.md §6.1`;
`SHIPPING_AND_BL.md §2.8`.)*

---

## 9. Notification rules

**9.1 `[CODE]`** **Notifications are role- and visibility-scoped (RLS).** A user
sees only notifications for entities they can see; there is **no per-user
targeting, no email, no push, no preferences** today. *[Confirmed by code:
`lib/notifications.ts` header; `NOTIFICATIONS_AND_MESSAGES.md §2.2, §7.6`.]*

**9.2 `[CODE]` → superseded by `[OWNER-CONFIRMED · target — not yet implemented]`**
(Decision D) **The bell must fire on high/critical event CREATION, not only on
unread comments.** **Target/Expected behavior (Decision D):** **Critical** and
**High** events raise a bell notification **even if no comment exists yet**;
**Medium** events raise the bell **only if** they require action from the user or the
user's role; **Low / informational** events do **not** by default; and **any unread
comment** on a visible event/entity discussion still raises the bell. (Detail at
§9.8.) *(Target — not yet implemented.)*
**Current behavior:** the bell fires on **unread event COMMENTS from other users**,
plus a synthetic "N task lists awaiting your review" aggregate for technical roles; a
brand-new event with no comments does **not** raise the bell. *[Confirmed by code:
`lib/notifications.ts` (`getUnreadCommentCountsForUser`, `buildReviewNotification`).]*
Canonical decision text: `OWNER_DECISIONS_LOG.md` §D. (See §9.8.)

**9.3 `[CODE]`** **Clicking a (deep-linkable) notification opens the entity page AND
overlays the relevant event discussion via `?event=<id>`**, with an
`entity_id === expectedEntityId` safety check; closing the drawer strips the param.
*[Confirmed by code: `lib/notifications.ts:260-265`; `lib/events-shared.ts
eventEntityHref`; `EventDiscussionPanel.tsx`.]*

**9.4 `[CODE]`** **Events are immutable** (`events` is INSERT-only, m022).
"Changes" are new rows/comments. *[Confirmed by code: `lib/events.ts`; m022.]*
(See §11.5.)

**9.5 `[CODE]`** **Action Center items are derived live** (sensors → registry →
materialize → role-filter → acks → notes). Items **auto-clear** when their
condition resolves; only `resolution='manual'` items (e.g. `deposit`,
`production_late`) get a **Done** action. SLA aging escalates an item into another
role's view (not a push). *[Confirmed by code: `lib/action-center.ts`;
`action_acks` (m069); `NOTIFICATIONS_AND_MESSAGES.md §4`.]*

**9.6 `[CODE]`** **Action Center notes & entity messages are micro-coordination —
not a chat system.** `entity_messages.message_kind` is typed for future kinds but
only `comment` is used today (m049); `action_notes` are short pins (m075).
*[Confirmed by code: `lib/action-center.ts attachNotes`;
`lib/entity-messages-shared.ts`.]* (Keep this scope — see §11.)
> **Owner Decision C (confirmed 2026-05-30) — target, not yet implemented.**
> Decision C designates **`entity_messages` as the canonical entity-discussion
> surface** (one main conversation area per entity), with **`event_comments` reserved
> for event-specific operational comments**. This elevates the *role* of
> `entity_messages` but does **not** turn it into a full chat system — the
> micro-coordination scope above still holds. The single-surface rule is stated at
> §1.8 and §9.12. `action_notes` remain short pins. Canonical text:
> `OWNER_DECISIONS_LOG.md` §C.

**9.7 `[CODE]`** **Reminders and render-time alerts are separate, non-push
surfaces.** `quotation_reminders` (m043) are a personal sales follow-up calendar
(`open/done/cancelled`, snooze presets); `lib/operations-alerts.ts` produces
**render-time** row badges (`overdue / balance_due / delayed /
completion_approaching / awaiting_deposit / ok`) with no persistence.
*[Confirmed by code: `lib/reminders.ts`; `lib/operations-alerts.ts`.]*

**9.8 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision D)
**Yes — high/critical event CREATION must raise the bell, by severity.**
**Target/Expected behavior:** the bell must **not** be limited to unread comments.
- **Critical event:** must raise a bell notification.
- **High event:** must raise a bell notification.
- **Medium event:** raises a bell **only if** it requires action from the user or the
  user's role.
- **Low / informational event:** does **not** raise a bell by default.
- **Any unread comment** on a visible event or entity discussion must raise a bell.
So e.g. `po.cancelled` / `po.deadline_changed` (high/critical) must raise the bell
even with no comment. *(Target — not yet implemented; requires an event-severity
model wired into the bell.)*
**Current behavior:** a cancelled PO with no comments shows in the feed/Action Center
but leaves the bell at zero (the bell counts unread comments only, §9.2). *(See
`PROBLEMS_AND_INCONSISTENCIES.md §13`; `NOTIFICATIONS_AND_MESSAGES.md §7.1`.)*
Canonical decision text: `OWNER_DECISIONS_LOG.md` §D.

**9.9 `[CONFIRM]`** **Keep the review aggregate as a non-deep-link, or deep-link
when count = 1?** Today "N task lists awaiting review" links to `/task-lists`
(the list), unlike every other bell item. *(See `POTENTIAL_INCONSISTENCIES.md §14`;
`NOTIFICATIONS_AND_MESSAGES.md §7.2`.)*

**9.10 `[CONFIRM]`** **Confirm `emitEvent` coverage.** The exact call sites across
the 20 `actions.ts` files were not enumerated; `emitEvent` runs best-effort
(failures are swallowed). Verify every meaningful transition emits its event.
*(See `NOTIFICATIONS_AND_MESSAGES.md §3.1, §7.7`.)*

**9.11 `[CONFIRM]`** **Confirm `entity_messages` RLS scoping (m049).** Whether
entity-message visibility inherits the parent entity's sales isolation or is more
permissive was not read this pass. *(See `NOTIFICATIONS_AND_MESSAGES.md §5.3`.)*
**(Becomes more important under Decision C — §9.12 — since `entity_messages` is the
canonical surface; confirm its isolation as part of that work. Not yet implemented.)**

**9.12 `[OWNER-CONFIRMED · target — not yet implemented]`** (Decision C)
**One main conversation area per entity, backed by `entity_messages`; event comments
are event-scoped only; notifications route into the right context.**
**Target/Expected behavior:** the **main place to discuss** a quotation, client, task
list, production order, or business entity must be **`entity_messages`**;
**`event_comments` are used only** to comment on a specific operational event (status
change, delay, validation request, payment/BL/production issue, Action Center event).
The UI must **avoid two competing chat systems** — from the user's perspective there
is **one main conversation area**, with important events shown as contextual system
entries inside/alongside it. If a notification is linked to an **event comment**,
clicking it should open the related entity page and **highlight/open the relevant
event discussion in context**. *(Target — not yet implemented.)*
**Current behavior:** two parallel systems coexist (event comments vs entity
messages); a notification deep-link already opens the entity page and overlays the
event discussion via `?event=<id>` (§9.3), but the "one canonical surface" principle
is not enforced. *[Confirmed by code: §1.8 duplication; `lib/notifications.ts:260-265`;
`NOTIFICATIONS_AND_MESSAGES.md §7.3`.]* Canonical decision text:
`OWNER_DECISIONS_LOG.md` §C. (See §1.8, §9.6.)

---

## 10. Implementation discipline rules

**10.1 `[CODE]`** **Pure logic vs server-only is kept separate.** Client+server-safe
modules (`lib/types.ts`, `lib/lifecycle.ts`, `lib/production-lifecycle.ts`,
`lib/delays.ts`, `lib/payment.ts`, `lib/pricing.ts`, `lib/*-shared.ts`) import no
Supabase / `next/headers`; server-only modules are separate, with shared types
split out (e.g. `entity-messages-shared.ts`). *[Confirmed by code: module headers.]*

**10.2 `[CODE]`** **Soft-fail ONLY on schema-missing errors; all other errors
surface.** (Same discipline as §3.3.) *[Confirmed by code:
`app/(app)/dashboard-v2/actions.ts`.]*

**10.3 `[CODE]`** **Migrations are manual + idempotent + end with the PostgREST
reload.** Never assume a migration is live until confirmed. (Same as §3.1/§3.2.)
*[Confirmed by code: `supabase/migrations/*`.]*

**10.4 `[CODE]`** **Security never travels through View-As or remote scripts.** Use
the REAL role for all gates; never pipe remote scripts to bash without review;
never use View-As to test RLS. *[Confirmed by code/source: `lib/auth.ts`;
`USER_ROLES_AND_PERMISSIONS.md §1, §7.3`; `APP_OVERVIEW.md`.]*

**10.5 `[FIX]`** **De-duplicate `duplicateDocument`.** Two definitions exist
(`app/(app)/clients/actions.ts:55` and `app/(app)/dashboard/actions.ts:7`), and
they have **already diverged**: the dashboard copy drops `config_values` on the
copied lines. Extract one shared implementation and have both call it.
*[Confirmed by code: `DRAFT_AND_EDITING_RULES.md §9`;
`POTENTIAL_INCONSISTENCIES.md §8`.]* **`[CONFIRM]`**: whether the
`config_values` drop was intentional (assume bug unless told otherwise).

**10.6 `[FIX]`** **De-duplicate factory-mapping actions and delete `.bak`
artifacts.** Two action files (`app/(app)/factory-mapping/actions.ts`,
`app/(app)/admin/factory-mapping/actions.ts`) plus committed `.bak`/`.bak2` files.
Extract one shared implementation (confirm both surfaces share gating) and remove
the backups. *[Confirmed by code: `POTENTIAL_INCONSISTENCIES.md §9`.]*

**10.7 `[CONFIRM]`** **Centralize the `status AS production_status` alias contract**
(see §3.4) — document it at the query boundary or rename the type field to `status`.
*(See `POTENTIAL_INCONSISTENCIES.md §3`.)*

**10.8 `[CONFIRM]`** **Decide on standing operational hygiene docs**: an
applied-migrations ledger (§3.10), a `JSONB_SHAPES.md` (§3.11), and a
capability-catalog reconciliation (§3.8) — all flagged as candidates the owner may
choose to adopt.

---

## 11. Things that must NOT be redesigned or rebuilt

> These are load-bearing architectural decisions. Treat them as **frozen**: edits
> should refine wording, not relax the constraint. Each is enforced in code today.

**11.1 — Keep the 6-phase Orders-in-flight pipeline.** `Quote → Task list →
Payment → Production → Shipping → Delivered`, rendered on every order row and
computed by the single `computeOrderFlightStage`. Do not collapse, reorder, or
"simplify" it. *[Confirmed by code: `ORDER_FLIGHT_PHASES` `lib/lifecycle.ts:257-264`;
`components/dashboard/OrdersInFlight.tsx`.]* (Standing user instruction.)

**11.2 — Keep the REAL-vs-EFFECTIVE role security model.** Security decisions use
the REAL role; only rendering uses the EFFECTIVE role. View-As must never widen or
narrow what a server action is allowed to do. Do not "unify" the two into one role
lookup. *[Confirmed by code: `lib/auth.ts`; `lib/permissions.ts`.]*

**11.3 — Keep factory overrides NEVER overwriting sales config.** The
override > client_preset > mapping > missing resolution chain, and the rule that
factory/technical data never mutates or is shown in place of the sales
configuration, are intentional. *[Confirmed by code: `lib/types.ts
resolveFactoryInstruction`; m071.]*

**11.4 — Keep additive delay events.** Deadlines move only by appending signed
`days_added` events; never overwrite `current_production_deadline` directly. The
factory-vs-external split and the audit-logged-but-editable model are deliberate.
*[Confirmed by code: `lib/delays.ts`; m072/m073/m074.]*

**11.5 — Keep events immutable.** `events` is INSERT-only; status changes and
replies are new rows/comments. Do not add UPDATE/DELETE paths to the event log.
*[Confirmed by code: `lib/events.ts`; m022.]*

**11.6 — Keep manual, idempotent migrations.** Every migration is hand-applied in
Supabase, written to be re-runnable, and ends with `notify pgrst, 'reload schema';`.
Do not introduce an automated migration runner that assumes migrations are live, and
do not drop the idempotency/reload convention. *[Confirmed by code:
`supabase/migrations/*`.]*

**11.7 — Do NOT auto-create the production task list on "Won".** (Decision A.)
Winning a quote must surface a **required, visible "Create Production Task List"
action** and an Action-Center alert until the list exists — it must **not** silently
generate the task list. Do not "helpfully" auto-create it on the win transition.
*(Owner decision A — target behavior; see §5.18. The existing auto-creation is of the
**production order** from a **validated task list**, §5.6 — that is a different step.)*

**11.8 — Do NOT edit a `won` quote in place.** (Decision B.) Commercial changes after
`won` go through a **new revision/version**; the previous won version is preserved for
audit. When a production task list already exists, changes must run through a
**diff + review state** (never a silent task-list overwrite). Do not add an in-place
edit path for `won`. *(Owner decision B — target behavior; see §5.14, §5.19.)*

**11.9 — Do NOT rename the stored `shipping_details` jsonb keys.** (Decision G.) The
approved fix aligns the **reader** to the keys already stored (`forwarder`/`vessel`);
renaming the stored keys would break existing records. Keep the jsonb contract stable
and add a shared key constant instead. This sits alongside the general rule that jsonb
shapes change only via their normalizer (§3.5). *(Owner decision G — approved fix, not
yet applied; see §3.6 / §8.4.)*

> **Adjacent invariants worth preserving (owner to confirm as "frozen"):** the
> three-entity shipping split (§8.1); the live-derived Action Center with auto-clear
> + manual-Done (§9.5); micro-coordination scope for notes/messages (§9.6); the
> baseline locked-once-at-activation model (§5.10); capabilities-gate-actions /
> RLS-gates-visibility separation (§2.2). These are `[CODE]`-confirmed and should
> not be casually redesigned, but are listed here for explicit owner sign-off.

> **Note on Decision E (security target) vs the frozen items.** The **REAL-vs-EFFECTIVE
> role model (§11.2)** and the **capabilities-gate-actions / RLS-gates-visibility
> separation (§2.2)** stay frozen. Decision E does **not** relax them — it states that
> the broader **visibility boundary (team/region/lens/ownership) must graduate from
> advisory app-level filtering into RLS** (the real security layer), tested with real
> accounts not View-As (§2.7). That migration is **target — not yet implemented**;
> until then, base RLS isolation + capabilities remain the only real controls.

---

## 12. Appendix — open "Needs confirmation" register

A consolidated list of every `[CONFIRM]` / `[FIX]` above, for the owner to work
through. (Sources: the `docs/audit-editable/` docs and
`docs/audit-editable/PROBLEMS_AND_INCONSISTENCIES.md`.)

> **Update 2026-05-30 — several entries are now resolved by Owner Decisions A–I**
> (see the [Owner Decisions](#owner-decisions-confirmed-2026-05-30) table and
> `OWNER_DECISIONS_LOG.md`). The map below shows what is resolved; the original tables
> are kept for traceability with the resolved rows annotated **[RESOLVED → …]**.
> **All resolutions are TARGET behavior; most are NOT yet implemented in code** (G is
> an approved fix not yet applied), so the underlying work still stands.

### Resolved by Owner Decisions (2026-05-30)

| Register item | Decision | Now at | Status |
|---|---|---|---|
| F1 (`shipping_details` key mismatch) | **G** | §3.6 / §8.4 | Approved fix — **not applied** |
| C1 (one canonical discussion surface) | **C** | §1.8, §9.12 | Target — not yet implemented |
| C9 (visibility → RLS) | **E** | §2.7 | Target — not yet implemented |
| C20 (`won`: editable / revise-only / read-only) | **B** | §5.14, §5.19 | Target — not yet implemented (revise-only) |
| C21 (sales deleting a `won` quote cascades the PO) | **F** | §5.15 | Target — not yet implemented (restricted) |
| C22 (archived quotations read-only / archive reason) | **F** | §5.16, §5.20 | Target — not yet implemented |
| C28 (tax/VAT exclusion) | **H.3** | §7.10 | Confirmed (tax-free); display affordances pending |
| C29 (currency conversion / FX) | **H.4** | §7.11, §7.16 | Target — not yet implemented |
| C30 (rounding policy) | **H.5** | §7.12, §7.17 | Target — not yet implemented |
| C31 (deposit % / validity / warranty / balance reminder defaults) | **H.6–H.9** | §7.13, §7.18–§7.21 | Target — not yet implemented |
| C36 (event creation raises the bell) | **D** | §9.8, §9.2 | Target — not yet implemented |
| *(plus the matrix-review gate)* | **I** | §4.14, [`CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md) | Review gate — **no permission changes** |
| *(plus task-list-on-win)* | **A** | §5.18 | Target — not yet implemented |
| *(plus new price-list / discount-approval pricing)* | **H.1, H.2, H.10** | §7.14, §7.15, §7.22 | Target — not yet implemented |

> **Still open** (no owner decision in A–I): F2–F8 fixes, and `[CONFIRM]` items
> C2–C8, C10–C19, C23–C27, C32–C35, C37–C39. These remain to be worked through.

### Confirmed bugs / consistency fixes (`[FIX]`)

| # | Item | Where | Rule |
|---|---|---|---|
| F1 **[RESOLVED → Decision G; approved, not applied]** | `shipping_details` key mismatch (`forwarder_name`/`vessel_name` vs `forwarder`/`vessel`) — BL card never self-clears. **Fix approved; `forwarder` alone clears the alert, `bl_number` not required; do not rename stored keys.** | `lib/action-center.ts:336`, `lib/shipping.ts:16-17` | §3.6 / §8.4 |
| F2 | `FreightType` missing plain `40ft` that `ContainerType` allows | `lib/types.ts`; m063 | §3.7 / §8.8 |
| F3 | `RUN_THIS_FIRST_production_setup.sql` bundles pre-m046 PO RLS | bundle vs m046 | §3.12 |
| F4 | Raw enum labels in PO KPI tiles ("IN PRODUCTION") | `app/(app)/production/orders/[id]/page.tsx:1400-1427` | §1.13 |
| F5 | Admin sub-pages lack in-body guard (`products/images`, `products/import`) | those pages | §4.9 |
| F6 | Duplicate `duplicateDocument` (and divergent `config_values` drop) | `clients/actions.ts:55`, `dashboard/actions.ts:7` | §10.5 |
| F7 | Duplicate factory-mapping actions + committed `.bak` files | `factory-mapping/actions.ts` (×2), `.bak`/`.bak2` | §10.6 |
| F8 | "Completed" defined two ways (`actual_completion_date` vs status) | `lib/production-lifecycle.ts` vs `lib/lifecycle.ts` | §5.13 |

### Owner product decisions (`[CONFIRM]`)

| # | Item | Rule |
|---|---|---|
| C1 **[RESOLVED → Decision C; target, not yet implemented]** | Canonical surface = **`entity_messages`**; `event_comments` for event-specific comments only | §1.8, §9.12 |
| C2 | Disambiguate the two "validation" terms in copy | §1.9 |
| C3 | Two-dashboard fate (keep / default / retire V2) | §1.10 |
| C4 | View-As banner wording for non-technical admins | §1.11 |
| C5 | Redirect-stub routes: destination or removal | §1.12 |
| C6 | "Unlock baseline" disabled button: hide / message | §1.14 |
| C7 | Operations "Sales" column: display names vs `role·uuid` | §1.15 |
| C8 | Emoji in notes count (house style) | §1.16 |
| C9 **[RESOLVED → Decision E; target, not yet implemented]** | Visibility grants → **RLS is the security target**; app-level is interim | §2.7 |
| C10 | Confirm commission rules as policy | §2.8 / §7.5 |
| C11 | Define forecast methodology | §2.9 |
| C12 | `clients.commission_*` — exist? how do they pre-populate? | §2.10 |
| C13 | `action_acks.state` CHECK constraint | §3.9 |
| C14 | Applied-migrations ledger | §3.10 |
| C15 | `JSONB_SHAPES.md` single contract doc | §3.11 |
| C16 | Reconcile capability catalog (22 vs "23") | §3.8 |
| C17 | Default `quotation.delete` for TLM / operations *(now in scope of the Decision I matrix-review gate, §4.14 — confirm there; no permission change yet)* | §4.10 |
| C18 | Finish or formally stop `requireCapability` migration | §4.11 |
| C19 | Drop `super_admin` from `VIEW_AS_ROLES` picker? | §4.12 |
| C20 **[RESOLVED → Decision B; target, not yet implemented]** | `won` quotation: **revise-only** (new version); diff + review state if a task list exists | §5.14, §5.19 |
| C21 **[RESOLVED → Decision F; target, not yet implemented]** | Sales deleting a `won` quote cascade-deletes the PO — **restricted/blocked**; cancel or archive instead | §5.15 |
| C22 **[RESOLVED → Decision F; target, not yet implemented]** | Archived records require an **archive reason** + metadata; searchable, separated | §5.16, §5.20 |
| C23 | `cancelled` in `TASK_LIST_LOCKED_FOR_SALES` intentional? | §5.17 |
| C24 | Required technical fields before task-list submission | §6.7 |
| C25 | `field_scope='technical'` write-enforcement gate adequate? | §6.8 |
| C26 | `selected_options` vs `config_values` overlap | §6.9 |
| C27 | "Latest price" tie-break ordering | §7.9 |
| C28 **[RESOLVED → Decision H.3]** | Tax/VAT exclusion **intentional (tax-free export)**; display affordances pending | §7.10 |
| C29 **[RESOLVED → Decision H.4; target, not yet implemented]** | Currency conversion / FX: explicit, traceable, **rate locked per version**; adjustment clause; bank-by-currency | §7.11, §7.16 |
| C30 **[RESOLVED → Decision H.5; target, not yet implemented]** | Rounding: **2 decimals at document level**; balance absorbs the difference | §7.12, §7.17 |
| C31 **[RESOLVED → Decisions H.6–H.9; target, not yet implemented]** | Defaults: **30% deposit**; validity **30d/7d**; **warranty per product**; balance reminder **Africa 20d / others 15d** | §7.13, §7.18–§7.21 |
| C32 | Model shipping marks / structured BL instructions? | §8.9 |
| C33 | Container-to-order link: add or accept gap | §8.10 |
| C34 | Quote shipping fields editable after `won`? *(Partly informed by Decision B: shipping changes after `won` go via revision + review state, §5.19; the field-level editability gate is still open.)* | §8.11 |
| C35 | Sales editing client BL profile while shipping in flight? | §8.12 |
| C36 **[RESOLVED → Decision D; target, not yet implemented]** | Event **creation** raises the bell — **yes for high/critical** (medium if action-needed; low none) | §9.8, §9.2 |
| C37 | Review aggregate: deep-link when count = 1? | §9.9 |
| C38 | Confirm `emitEvent` coverage across 20 actions files | §9.10 |
| C39 | Confirm `entity_messages` RLS scoping (m049) | §9.11 |

---

*Draft assembled by code audit on 2026-05-30. Verified read-only against the
codebase at the project root. This is an **editable, non-binding** working draft —
edit, confirm, and ratify before promoting any rule into a top-level `RULES.md`.*
