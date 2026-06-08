# Product Overview — Current Implementation

> **Audit note.** Describes what the application **currently does**, inferred
> from routes (`app/(app)/`), data model (`supabase/migrations/`), and the
> `lib/` domain logic. The original `spec.md` describes a much smaller "quotation
> tool"; the implementation has grown well beyond it (see
> MISSING_DOCUMENTATION.md → "spec drift"). Where behavior is implied but not
> directly proven by code, it is tagged **Assumed from code** / **Needs
> confirmation**.

---

## 1. What this product is

**SOLUX** is a solar/LED lighting company (brand confirmed by
`lib/bl.ts SOLUX_SHIPPER_DEFAULT` → "CHANGZHOU SOLUX TECHNOLOGY COMPANY LTD",
contact `vera@zr-light.com.cn`; the `solux` Tailwind accent; document codes like
`SLX-VPL-26-030`).

The application is an **internal operations platform** that takes an export
order from **quotation → factory task list → production → shipping → delivery**,
with role-based access, an operational notification/action layer, and a sales
forecast layer.

> The original `spec.md` scoped this as a "Quotation Tool" (generate quotations
> & proforma invoices, admin + sales roles only). The shipping live build is
> substantially larger: 4 real roles + super-admin, a three-entity lifecycle,
> production tracking, a visibility engine, an event log, and an Action Center.

---

## 2. Core capabilities (implemented, Confirmed by code)

### 2.1 Quotations / documents (`/documents`, `/clients`)
- Create, edit, version, and manage quotations (`documents` table).
- Per-line product configuration with pricing (`document_lines`,
  `lib/pricing.ts`), currency `USD`/`EUR`/`CNY`, payment mode
  (`deposit_balance`/`lc`/`hybrid`), incoterm, freight type, container plan
  (`document_containers`).
- **Quotation versioning** (m059): revisions form a `root_document_id` chain with
  incrementing `version`.
- **Affair name** (m056): a human project label distinct from the document code.
- **Advisory validation loop** (m068): sales can request a manager's review
  (`pending`→`approved`/`rejected`); **this never blocks sending or winning**.
- **Sales forecast** (m050): probability / expected close fields, surfaced on
  `/forecast`.
- **Reminders** (m043) and **attachments** (m060) attached to deals/affairs.

### 2.2 Clients (`/clients`, `/clients/[id]`)
- Client records with `client_code` (3 uppercase letters), country/address/VAT,
  phone country code, commission config.
- **Ownership** (m066): each client/deal has an effective owner
  (`sales_owner_id` ?? `created_by`), reassignable by management.
- **BL profile** (m054): a reusable Bill-of-Lading template per client
  (shipper / consignee / notify party / required documents / notes).

### 2.3 Production task lists (`/task-lists`, `/task-lists/[id]`)
- Created when a quotation is **Won**; holds the technical/production
  configuration and the **validation workflow** between Sales and
  Task-List-Manager/Operations.
- Per-line technical values, plus **factory overrides / extras** (m071) that the
  factory can adjust without touching the sales configuration.
- **Sticker requirements** (m061) and **risk flags** (m062).
- Statuses: `draft` → `under_validation` → (`needs_revision` ↺) → `validated` →
  `production_ready` (→ `cancelled`).

### 2.4 Production orders (`/production/orders/[id]`)
- Manufacturing + logistics tracking once a task list is `validated` /
  `production_ready`.
- **Payment tracking**: deposit / balance, with a "start without deposit"
  override (m025).
- **Baseline + delay model**: an `initial_production_deadline` is frozen at
  **production activation**; a live `current_production_deadline` is moved by an
  **additive delay-event log** (`production_deadline_changes`, m072–m074). Delays
  are **categorized** (factory vs external) so external delays don't inflate the
  factory KPI.
- **Shipping / BL execution** (m070): BL number, forwarder, vessel/voyage,
  weights, CBM, packages, HS code; plus ETD/ETA/booking columns.
- Status set (10): `awaiting_deposit` → `deposit_received` →
  `production_scheduled` → `in_production` → (`production_delayed`) →
  `production_completed` → `shipment_booked` → `shipped` → `delivered`
  (→ `cancelled`).

### 2.5 Factory mapping (`/factory-mapping`, `/admin/factory-mapping`)
- Configuration tool that maps product options to factory instructions
  (`factory_mappings`, m014). Resolution priority
  (`lib/types.ts resolveFactoryInstruction`):
  **override > client preset (m071) > mapping > missing**.
- **Factory-only**: visible to TLM / Operations / Super-Admin
  (`factory_mapping.access`, m064). Never overwrites the sales configuration
  (standing product rule).

### 2.6 Dashboards & operations
- `/dashboard`, `/dashboard-v2` — role-shaped overview (e.g. "Orders in flight",
  `components/dashboard/OrdersInFlight.tsx`, which collapses the 3 entities into
  one live stage via `lib/lifecycle.ts computeOrderFlightStage`).
- `/operations` — operations feed + **Action Center** (derived, prioritized
  to-dos).
- `/business` — management/exec KPIs.
- `/forecast` — sales forecast workspace (global view gated by
  `forecast.view_global`).

### 2.7 Collaboration & notifications
- **Event log** (`events`, m022+): immutable, polymorphic operational events with
  severity + status, threaded `event_comments` (m044) and per-user read state
  (m045).
- **Entity messages / conversation drawer** (`entity_messages`, m049): a
  contextual discussion thread per document / task list / production order /
  client, mounted globally and resolved from the URL.
- **Action Center** (`lib/action-center.ts`): live-derived operational actions
  (validate, clarify, deposit, production late, missing deadline, BL missing,
  …), grouped into urgent / waiting-on-me / waiting-on-client / info-missing,
  with acknowledge / done / notes.
- **Notification bell** (`lib/notifications.ts`): unread comment aggregation +
  "N task lists awaiting your review".

### 2.8 Administration
- `/admin/users` — role assignment, super-admin toggle, display names (m052).
- `/permissions`, `/admin/permissions` — capability matrix editor (m026), teams &
  access grants (m067).
- `/admin/diagnostics` — health checks / dev reset RPCs (m033–m035).
- Catalog admin: categories, products & images, banks, sales conditions.
- `/view-as` — super-admin role simulation.

---

## 3. Who uses it (roles)

`admin`, `sales`, `task_list_manager`, `operations`, and the virtual
`super_admin`. See USER_ROLES.md for the full breakdown. In short:

- **Sales** create quotations & manage their own clients/deals (isolated).
- **Task-list-manager / operations** validate task lists, configure factory
  instructions, and run production/shipping.
- **Admin** manages users, permissions, and catalog.
- **Super-admin** can simulate roles (View-As) and perform physical deletes.

---

## 4. Platform & architecture (Confirmed by code)

- **Next.js 14 App Router.** All app routes live under `app/(app)/`, guarded by
  the route-group layout. API routes: attachment download
  (`/api/attachments/[id]/download`) and conversations
  (`/api/conversations/[entity_type]/[entity_id]`).
- **Supabase**: Postgres + RLS + RPCs + Storage. Auth via Supabase Auth.
- **TypeScript + Tailwind.** Domain logic concentrated in `lib/` (pure,
  client+server-safe modules where possible; server-only modules import
  `@/lib/supabase/server`).
- **Migrations applied manually** in Supabase; idempotent; each ends with
  `notify pgrst, 'reload schema';`.

---

## 5. What it deliberately is NOT (Confirmed by code / comments)

- **Not an accounting system** (per `spec.md` objective and the absence of
  ledger/invoice-accounting tables).
- **Not a chat system** — `entity_messages` and Action Center notes are
  intentionally minimal "micro-coordination", not full messaging
  (`lib/action-center.ts`, `lib/entity-messages-shared.ts` comments).
- **File upload for BL documents is out of scope** in the current BL profile
  (`lib/bl.ts` comment).

---

## 6. Known high-level gaps (pointers)

- The data-visibility engine (m067) is **not yet enforced at the database (RLS)
  layer** — app-level only.
- The capability matrix governs **actions only**, not row visibility.
- Several routes are **redirect stubs** (`/`, `/order-follow-up`,
  `/production`, `/production/orders`, `/production/queue`, `/permissions`).
- Original `spec.md` is **out of date** relative to the implementation.

See MISSING_DOCUMENTATION.md and POTENTIAL_INCONSISTENCIES.md for detail.
