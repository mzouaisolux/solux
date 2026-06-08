# APP_OVERVIEW — SOLUX Internal Operations Platform

> **Audit status.** This is an editable source-of-truth document.
> Factual claims cite the exact source file (relative to project root).
> **[Confirmed by code]** = directly verifiable in the cited file.
> **[Assumed from code]** = inferred from structure/naming; not proven by a single line.
> **Needs confirmation** = requires owner input or live-DB read to settle.

---

## 1. What SOLUX Is

**SOLUX** is an internal operations platform for **Changzhou Solux Technology Company Ltd**, a Chinese solar/LED lighting exporter (`lib/bl.ts`, constant `SOLUX_SHIPPER_DEFAULT`; Tailwind accent token `solux`). It serves the company's internal team — Sales, Production, Operations, and Management — and tracks an export order from the moment a quotation is drafted all the way through factory production, shipping, and final delivery.

The platform replaced an out-of-date "Quotation Tool" spec (`spec.md`); the live implementation is substantially larger than that original scope and should be treated as the new baseline. See `docs/current-implementation/MISSING_DOCUMENTATION.md §0` for context on spec drift.

---

## 2. The Three-Entity Order Lifecycle

An "order" in SOLUX is not a single record — it is the union of **three linked entities**, each with its own status progression. [Confirmed by code: `lib/lifecycle.ts`, `lib/types.ts`]

```
documents (quotation)
    └──► production_task_lists
              └──► production_orders
```

| Entity | Table | Purpose |
|---|---|---|
| Quotation / document | `documents` | Commercial offer, pricing, client deal |
| Production task list | `production_task_lists` | Technical & factory configuration; validation workflow |
| Production order | `production_orders` | Manufacturing execution, payments, shipping, delivery |

Entities are linked by foreign keys (`task_lists.document_id`, `production_orders.task_list_id`). DB triggers (`supabase/migrations/023_lifecycle_propagation.sql`) propagate cancellations downward automatically. A **delivered** production order is never auto-cancelled by an upstream cancellation. [Confirmed by code]

---

## 3. The Unified 6-Phase "Flight" Strip

`lib/lifecycle.ts` defines `ORDER_FLIGHT_PHASES` and `computeOrderFlightStage()`, which collapse the three entities' raw statuses into **one operational stage** used by dashboards and the `OrdersInFlight` component (`components/dashboard/OrdersInFlight.tsx`). [Confirmed by code]

```
0 Quote  →  1 Task list  →  2 Payment  →  3 Production  →  4 Shipping  →  5 Delivered
```

Key mapping highlights (see `ORDER_LIFECYCLE.md §2` for the full table):

- Phase **1** covers task-list statuses (`draft`, `under_validation`, `needs_revision`, `validated`, `production_ready`) and "Won but nothing started yet."
- Phase **2** (`awaiting_deposit`) is the payment gate.
- Phase **3** begins as soon as the deposit is received (`deposit_received` advances into Production, not Payment — intentional).
- Phase **4** (Shipping) covers `production_completed` through `shipped` — once manufacturing is done, the order is considered in the shipping phase.
- Phase **5** (`delivered`) is the terminal success state.

> **Non-obvious mapping:** `production_completed` sits in phase 4 (Shipping), and `deposit_received` sits in phase 3 (Production). Both are intentional product decisions. [Confirmed by code]

---

## 4. Core Capability Areas

### 4.1 Quotations & Clients (`/documents`, `/clients`)

[Confirmed by code: `app/(app)/documents/`, `app/(app)/clients/`, `lib/pricing.ts`, `supabase/migrations/`]

- Create, edit, and manage quotations with per-line product/pricing configuration.
- Currencies: USD / EUR / CNY. Payment modes: `deposit_balance`, `lc`, `hybrid`. Incotems and freight types configurable.
- Container planning (`document_containers`), attachments (m060), and reminders (m043).
- **Quotation versioning** (m059): revisions form a `root_document_id` chain with incrementing `version`.
- **Affair name** (m056): a human project label distinct from the document code.
- **Advisory validation loop** (m068, `lib/validation.ts`): Sales can request a manager review (`none → pending → approved | rejected`). This is advisory only — it never blocks sending or winning a deal.
- **Sales forecast fields** (m050): probability / expected-close date, surfaced on `/forecast`.
- Client records with `client_code` (3 uppercase letters), country, BL profile (m054 — a reusable Bill-of-Lading template per client), ownership model (m066, `sales_owner_id ?? created_by`).

### 4.2 Production Task Lists & Validation (`/task-lists`, `/task-lists/[id]`)

[Confirmed by code: `app/(app)/task-lists/`, `lib/types.ts`, `lib/lifecycle.ts`]

- Created when a quotation is **Won**; holds the technical/production configuration for factory use.
- Status flow: `draft → under_validation → (needs_revision ↺) → validated → production_ready → cancelled`.
- **Sales are locked out** once a task list reaches `under_validation` (`TASK_LIST_LOCKED_FOR_SALES`, `lib/types.ts`).
- TLM / Operations validate or reject; rejection returns the task list to Sales for revision.
- **Factory overrides / extras** (m071): TLM/Operations can adjust factory configuration without touching the Sales commercial configuration (standing product rule: factory config never overwrites sales config).
- Sticker requirements (m061) and risk flags (m062).

### 4.3 Production Orders — Baseline/Delay/Payments/Shipping (`/production/orders/[id]`)

[Confirmed by code: `app/(app)/production/orders/[id]/`, `lib/production-lifecycle.ts`, `lib/delays.ts`]

- Activated once a task list is `validated` or `production_ready`.
- **Payment tracking**: deposit / balance fields; a "start without deposit" override (m025, `production_order.start_without_deposit`).
- **Baseline & delay model**:
  - `initial_production_deadline` is frozen at production activation (the moment the deposit is received or the override is set). Never recomputed. [Confirmed by code: `lib/production-lifecycle.ts`]
  - `current_production_deadline` is moved by an additive delay-event log (`production_deadline_changes`, m072–m074).
  - Delay types: `production | payment | shipping | client_change | client_waiting | supplier | customs | other`. Only `production` (or NULL legacy) delays count toward the **factory KPI** (`isFactoryDelay`, `lib/delays.ts`).
- **Shipping / BL execution** (m070): BL number, forwarder, vessel/voyage, weights, CBM, packages, HS code, ETD/ETA, booking columns.
- Full 10-status progression: `awaiting_deposit → deposit_received → production_scheduled → in_production → (production_delayed) → production_completed → shipment_booked → shipped → delivered` (plus `cancelled`).

### 4.4 Factory Mapping (`/factory-mapping`, `/admin/factory-mapping`)

[Confirmed by code: `app/(app)/factory-mapping/`, `lib/types.ts resolveFactoryInstruction`, m014, m064]

- Maps product options to factory instructions (`factory_mappings` table).
- Resolution priority: **override > client preset (m071) > mapping > missing**.
- Access gated behind `factory_mapping.access` capability — visible to TLM / Operations / Super-Admin only (m064).
- Deliberately separated from the sales configuration surface; Sales never see this.

### 4.5 Dashboards, Operations Feed & Business Intelligence

[Confirmed by code: `app/(app)/dashboard/`, `app/(app)/dashboard-v2/`, `app/(app)/operations/`, `app/(app)/business/`, `app/(app)/forecast/`, `lib/action-center.ts`]

- `/dashboard` and `/dashboard-v2`: role-shaped overview — the "Orders in flight" widget (`components/dashboard/OrdersInFlight.tsx`) collapses all three entities into one live flight stage.
- `/operations`: operations feed + **Action Center** — live-derived, prioritized to-do list grouped into urgent / waiting-on-me / waiting-on-client / info-missing. Action types include: validate task list, clarify, record deposit, production late, missing deadline, BL missing, etc.
- `/business`: management/exec KPIs (admin-like access).
- `/forecast`: sales forecast workspace. Global view gated by `forecast.view_global`; Sales see their own deals only.

### 4.6 Collaboration & Notifications

[Confirmed by code: `lib/events.ts`, `lib/entity-messages-shared.ts`, `lib/notifications.ts`, `lib/action-center.ts`, m022, m044, m045, m049]

- **Immutable event log** (`events` table, m022+): polymorphic operational events with severity and status. Supports threaded `event_comments` (m044) and per-user read state (m045).
- **Entity message threads** (`entity_messages`, m049): a contextual discussion thread per document / task list / production order / client. Mounted globally, resolved from the current URL. This is intentionally minimal micro-coordination, not a full chat system.
- **Notification bell** (`lib/notifications.ts`): unread comment count + "N task lists awaiting your review" summary.
- **Action Center acknowledgement / done / notes** state: actions can be acknowledged, marked done (manual resolution), or annotated, persisted to `action_acks` (m069).

### 4.7 Administration

[Confirmed by code: `app/(app)/admin/`, `app/(app)/permissions/`, `lib/auth.ts`, `lib/permissions.ts`]

- `/admin/users`: role assignment, super-admin flag, display names (m052).
- `/permissions`, `/permissions/actions`, `/permissions/teams`: capability matrix editor (m026), access grants / teams (m067).
- `/admin/diagnostics`, `/admin/diagnostics/reset`: health checks and dev-reset RPCs (m033–m035).
- Catalog admin: categories, products & images, banks, sales conditions.
- `/view-as`: super-admin can simulate another role for UI preview (the View-As cookie `solux_view_as_role`). Security note: mutations always use the real role — not the simulated one.

---

## 5. The Five Roles (One-Line Summary)

[Confirmed by code: `lib/auth.ts`, `lib/types.ts`, `lib/permissions.ts`]

| Role | Summary |
|---|---|
| `sales` | Owns clients and quotations; isolated to their own deals by default; cannot access factory or admin surfaces. |
| `task_list_manager` | Validates / rejects task lists; configures factory instructions; technical read access. |
| `operations` | Shares TLM technical scope plus production-order operational edits (status, deadline, payments, shipment). |
| `admin` | Full capability matrix access plus user/permission/catalog management; cannot physical-delete records. |
| `super_admin` | Virtual role (boolean flag, not a DB `role` value); everything admin can do, plus physical deletes and View-As simulation. |

Full breakdown: `docs/current-implementation/USER_ROLES.md`.

---

## 6. Platform & Architecture

[Confirmed by code: project structure, `supabase/migrations/`, `lib/supabase/`]

- **Next.js 14 App Router.** All authenticated routes under `app/(app)/` (35 `page.tsx` files confirmed; the primary doc cited 44 routes including layouts and API routes). Route-group layout provides the shared guard. API routes: attachment download (`/api/attachments/[id]/download`) and entity conversations (`/api/conversations/[entity_type]/[entity_id]`).
- **Supabase**: PostgreSQL + Row-Level Security (RLS) + Remote Procedure Calls (RPCs) + Storage + Supabase Auth. Migrations are **applied manually** in Supabase Studio; each migration file ends with `notify pgrst, 'reload schema';` to refresh the PostgREST schema cache. 76 migration files as of this audit.
- **TypeScript + Tailwind CSS.** Domain logic concentrated in `lib/` (45 modules); pure modules are safe for both client and server; server-only modules import `@/lib/supabase/server`.
- **Server Actions** in `app/**/actions.ts` files (approx. 20 files). Mutations always guard with the real role (`getCurrentUserRole`), never the View-As simulated role.
- **Visibility engine** (`lib/visibility.ts`, m067): app-level only — RLS does **not** yet enforce lens/team scopes. The DB-level enforcement is tracked as a pending gap. [Confirmed by code]

---

## 7. What SOLUX Deliberately Is NOT

[Confirmed by code / source comments]

- **Not an accounting system.** There are no ledger or invoice-accounting tables. The platform tracks payments in the context of production orders, not as a general accounts-receivable/payable ledger. (Per `spec.md` objective.)
- **Not a chat system.** `entity_messages` and Action Center notes are intentional "micro-coordination" — contextual comments on a record, not a general messaging platform. (`lib/entity-messages-shared.ts`, `lib/action-center.ts` comments.)
- **BL file upload is out of scope.** The BL profile stores template text fields (shipper, consignee, notify party, required documents). Attaching physical BL documents is explicitly marked out of scope. (`lib/bl.ts` comment.)

---

## 8. Current vs Expected Behavior Notes

| Area | Current behavior | Expected / Intended | Source |
|---|---|---|---|
| Visibility enforcement | App-level only; RLS does not enforce lens/team grants | DB-level RLS enforcement planned but not yet applied | m067 additive; `lib/visibility.ts` |
| Route stubs | `/order-follow-up` → `/operations`; `/production/queue` → `/task-lists`; `/production/orders` → `/dashboard` (role-shaped) | Stubs exist to preserve old bookmarks; redirects are intentional | `app/(app)/order-follow-up/page.tsx`, `app/(app)/production/queue/page.tsx`, `app/(app)/production/orders/page.tsx` |
| Advisory validation vs task-list validation | Two unrelated workflows share the word "validation" — document advisory (`pending/approved/rejected`) vs task-list workflow (`under_validation/validated`) | Distinct concepts; naming is a known source of confusion | `lib/validation.ts`, `lib/types.ts` |
| `production_status` alias | `production_status` is a query alias, not a real column; the DB stores `status` on `production_orders` | Components that need this must alias `status AS production_status` | `lib/lifecycle.ts`, `components/dashboard/OrdersInFlight.tsx` |
| BL action self-clear | `lib/action-center.ts blIsFilled()` reads `forwarder_name`/`vessel_name`; `lib/shipping.ts` writes `forwarder`/`vessel` — key mismatch | Keys should be aligned so filling forwarder+vessel clears the BL action | `lib/action-center.ts`, `lib/shipping.ts` |

---

## 9. Needs Confirmation

The following items cannot be settled from code alone and require owner input or a live DB read:

1. **Default capability matrix** — which role gets which of the 22 capability keys by default. Lives in `role_permissions` rows seeded by m026 / m053; no human-readable export exists.
2. **`production_order.*` capability split between `task_list_manager` and `operations`** — do both roles get production-order edit capabilities by default, or only `operations`?
3. **Task-list creation trigger on Won** — is it manually created by a user after a deal is Won, or is there an automated creation path? The "Awaiting task list" flight-stage fallback implies manual, but no explicit confirmation.
4. **Production order creation trigger** — is the production order created automatically when a task list reaches `validated`/`production_ready`, or is there a manual creation step?
5. **`VIEW_AS_ROLES` exact list** — the set of roles a super-admin may simulate (expected: the four real roles; confirm against `lib/types.ts`).
6. **Route count discrepancy** — `PRODUCT_OVERVIEW.md` states 44 routes; the live `find` returns 35 `page.tsx` files. The difference is likely layout files, error boundaries, loading files, and the `_actions` directory — confirm the exact inventory if the count matters for documentation.
7. **`spec.md` status** — whether the original spec file should be archived or removed, now that `docs/current-implementation/` is the baseline.
