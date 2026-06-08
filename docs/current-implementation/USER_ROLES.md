# User Roles & Permissions — Current Implementation

> **Audit note.** Grounded in `lib/auth.ts`, `lib/permissions.ts`,
> `lib/types.ts`, `lib/visibility.ts`, `lib/access-labels.ts`, and the route /
> server-action gating observed across `app/(app)/`. Per-capability **default
> role assignments** live in the DB `role_permissions` matrix (seeded by `m026`
> / `m053`) and are **not** fully re-derived here — those are tagged
> **Needs confirmation**.

---

## 1. The two-layer security model (Confirmed by code)

The app deliberately separates **security** from **rendering**:

| Concept | Function | Reads View-As cookie? | Governs |
|---|---|---|---|
| **REAL role** | `getCurrentUserRole()` (`lib/auth.ts`) | **Never** | ALL security decisions |
| **EFFECTIVE role** | `getEffectiveRole()` (`lib/auth.ts`) | Yes (super-admin only) | UI rendering only |

- **REAL role** is read from `user_roles` and surfaces the virtual
  `super_admin` when `user_roles.super_admin = true` (the DB `role` column stays
  `admin` so RLS keeps working).
- **EFFECTIVE role** honors the `solux_view_as_role` cookie
  (`VIEW_AS_COOKIE`), but **only for super-admins**. Every other user's
  effective role equals their real role — they cannot simulate.
- Capability mirror (same split, `lib/permissions.ts`):
  - `hasCapability` / `requireCapability` → **REAL** role.
  - `hasUiCapability` → **EFFECTIVE** role.

> **Observed pattern (Confirmed by code):** **pages** guard with the EFFECTIVE
> role (so View-As previews work), while **mutating server actions** guard with
> the REAL role (so a super-admin in View-As mode still can't accidentally lose
> privileges, and a real sales user can never escalate). This is the correct
> security posture but means "what I see" and "what I can do" can differ during
> View-As.

> **Testing note (standing user rule):** to test role-based RLS / visibility,
> use a **real** account of that role — **not** View-As, which keeps the
> super-admin DB session.

---

## 2. The roles

`Role` (`lib/types.ts`): `admin`, `sales`, `task_list_manager`, `operations`,
`super_admin`.

- Four are real DB `user_roles.role` values: **admin, sales,
  task_list_manager, operations**.
- **`super_admin` is a boolean flag** (`user_roles.super_admin`, m016), surfaced
  by code as a virtual role. It is never stored in the `role` column.

### Role groupings (helpers in `lib/types.ts`)

- `isAdminLike(role)` → `admin` **or** `super_admin`.
- `isTechnicalRole(role)` → admin-like **or** `task_list_manager` **or**
  `operations`.
- `VIEW_AS_ROLES` → the set of roles a super-admin may simulate (defined in
  `lib/types.ts`; super_admin itself is not a simulation target). Exact list:
  **Needs confirmation against `lib/types.ts`** (expected: the four real roles).

### Auth guards (`lib/auth.ts`)

| Guard | Passes for | Used to gate |
|---|---|---|
| `requireAdmin()` | `isAdminLike` (admin, super_admin) | admin-level writes |
| `requireTaskListManagerOrAdmin()` | admin-like **or** task_list_manager **or** operations | technical_values edits, factory PDF, TLM/ops dashboards, component mappings |
| `requireSuperAdmin()` | `super_admin` flag only | **physical DELETE** of business records; reserved destructive ops |

---

## 3. Per-role summary

> Page reachability uses the EFFECTIVE role; the **actions** listed are gated by
> the REAL role and/or a capability key. Where a default capability assignment
> is not directly visible in code it is marked **Needs confirmation**.

### 3.1 `sales`
- **Intent (Assumed from code):** owns clients and quotations; isolated to their
  own accounts/deals by default.
- **Can (Confirmed by code / capability):**
  - Create/edit quotations (`quotation.create`).
  - Create/edit clients they own.
  - Delete their own quotations regardless of status (RLS m057; owner-delete
    capability `quotation.delete` per m055).
  - Request advisory validation on a quotation (m068).
  - Set forecast fields on their own deals (m050).
  - Add reminders, notes, attachments, entity messages on entities they can see.
- **Cannot (Confirmed by code):**
  - See other sales reps' clients/quotations by default (RLS isolation m046 /
    m058 / m066). **No hardcoded client exceptions** (standing rule).
  - Validate/reject task lists; edit `technical_values`
    (`requireTaskListManagerOrAdmin`).
  - Edit production order status/deadline/payments/shipment.
  - Access factory mapping (`factory_mapping.access`).
  - See the global forecast (`forecast.view_global`).
  - Access admin / permissions surfaces.
- **Task-list visibility:** once a task list is `under_validation` / `validated`
  / `production_ready` / `cancelled` it is **locked for sales**
  (`TASK_LIST_LOCKED_FOR_SALES`, `lib/types.ts`).

### 3.2 `task_list_manager` (TLM)
- **Intent:** technical reviewer / validator of task lists.
- **Can (Confirmed by code):**
  - Validate / reject task lists (`task_list.validate`, `task_list.reject`;
    `requireTaskListManagerOrAdmin`).
  - Edit `technical_values` and factory config; factory mapping access
    (`factory_mapping.access`, m064).
  - Generate factory PDF / technical surfaces.
  - See all task lists in the TLM queue (`TASK_LIST_TLM_QUEUE = [under_validation]`).
- **Production orders:** shares the technical scope; **Needs confirmation**
  whether TLM has the full `production_order.*` edit capabilities by default vs
  `operations` (the matrix decides — `role_permissions`).
- **Cannot:** admin user/permission management; physical deletes.

### 3.3 `operations`
- **Intent (Confirmed by code, m042 + `requireTaskListManagerOrAdmin`):**
  production planning, shipment, deadlines — **shares the task-list-manager
  technical scope**.
- **Can:** everything TLM can for task lists, plus the production-order
  operational edits (status / deadline / payments / shipment / timeline) —
  subject to the `production_order.*` capabilities in `role_permissions`
  (defaults **Needs confirmation**).
- **Visibility:** technical role → sees all rows under the legacy visibility
  fallback (`lib/visibility.ts`).

### 3.4 `admin`
- **Can:** all `quotation.*`, `task_list.*`, `production_order.*`,
  `factory_mapping.access`, `forecast.view_global`, and the `admin.*`
  capabilities (`manage_permissions`, `manage_users`, `diagnostics`) — subject
  to the matrix. `isAdminLike` passes `requireAdmin`.
- **Cannot (by policy):** physical DELETE of business records — that requires
  `requireSuperAdmin()`. Admins are expected to **cancel** (status) or
  **archive** (`archived_at`) instead.

### 3.5 `super_admin` (virtual)
- **Can:** everything an admin can, **plus** physical deletes
  (`requireSuperAdmin`), **plus View-As simulation** of other roles.
- It is the only role that can change `effectiveRole ≠ realRole`.

---

## 4. Capability catalog (`lib/permissions.ts`)

The `Capability` union has **22 keys** (verbatim):

```
quotation.create | quotation.cancel | quotation.archive | quotation.delete
task_list.validate | task_list.reject | task_list.archive | task_list.delete |
  task_list.sync_orphans
factory_mapping.access
production_order.edit_status | production_order.edit_deadline |
  production_order.edit_payments | production_order.edit_shipment |
  production_order.set_timeline | production_order.start_without_deposit |
  production_order.archive | production_order.delete
forecast.view_global
admin.manage_permissions | admin.manage_users | admin.diagnostics
```

- **Resolution:** `lib/permissions.ts` reads the `role_permissions` matrix with
  a **30-second in-memory cache**, **fail-closed** (on error, capability is
  denied).
- **Matrix scope:** governs **app-level gating only** — it does **not** alter
  RLS. A capability grant lets the UI/action run, but the DB row must still pass
  RLS.
- **Default matrix (which role gets which key): Needs confirmation** — stored in
  `role_permissions`, seeded by `m026` and backfilled for `operations` in
  `m053`. The lists in §3 are the **intent inferred from route gating**, tagged
  Assumed where not directly seeded in code.

---

## 5. Visibility / "who can see which rows" (`lib/visibility.ts`, m067)

Distinct from capabilities (which gate **actions**), visibility gates **which
rows** a user can see.

- A user's scope is the **union of their `access_grants`**:
  `self` | `team` | `region` | `lens(production|finance|logistics)` | `all`.
- **Legacy fallback (Confirmed by code):** until grants are assigned, technical
  roles (admin-like / TLM / operations) see **all**; sales see **own**. This
  preserves today's behavior.
- **Lens statuses** (`LENS_STATUSES`): production → task lists in
  `[validated, production_ready]`; finance → documents in `[won]`; logistics →
  documents in `[won]`.
- **Enforcement layer:** **app-level only.** `getVisibilityScope`, `canSeeRow`,
  `canSeeRecord`, `canSeeOwner`, `ownerAllowList` are used in queries/components.
  **DB-level RLS does NOT yet enforce lens/team scopes** (additive m067). →
  See POTENTIAL_INCONSISTENCIES.md.
- Manager-facing labels for grants: `lib/access-labels.ts` (`ACCESS_TYPES`,
  `LENS_INFO`, `visibilitySummary`, `grantChipLabel`).

---

## 6. Accessible pages by role (from route gating)

> Reachability via EFFECTIVE role; list pages mostly readable by all
> authenticated users with RLS-scoped data. Mutations gated as in §3.

| Route | Who (effective) | Notes |
|---|---|---|
| `/dashboard`, `/dashboard-v2` | all | role-shaped widgets (sales strip vs management panel) |
| `/business` | management (admin-like) | exec KPIs |
| `/operations` | technical roles | operations feed + Action Center |
| `/forecast` | all; global view needs `forecast.view_global` | sales see own |
| `/clients`, `/clients/[id]` | all (RLS-scoped) | sales see owned |
| `/documents`, `/documents/[id]`, `/documents/new` | all (RLS-scoped) | |
| `/task-lists`, `/task-lists/[id]` | all to view; TLM/ops to validate | sales locked once `under_validation`+ |
| `/production/orders/[id]` | technical roles edit; others view if visible | `/production`, `/production/orders`, `/production/queue` are redirect stubs |
| `/factory-mapping` | TLM / operations / super-admin (`factory_mapping.access`) | "factory only" config |
| `/admin/*` (users, permissions, diagnostics, banks, categories, products, sales-conditions, factory-mapping, components) | admin-like; permissions/users/diagnostics via `admin.*` | some admin sub-pages rely on the layout guard only (see below) |
| `/permissions`, `/permissions/actions`, `/permissions/teams` | admin (`admin.manage_permissions`) | `/permissions` root is a redirect stub |
| `/view-as` | super-admin | sets the View-As cookie |
| `/`, `/order-follow-up` | redirect stubs | |

---

## 7. Unclear / missing / inconsistent permissions

- **Per-capability default matrix not visible in code** — `role_permissions`
  seeding is the source of truth; this audit cannot assert exact defaults.
  **Needs confirmation.** (e.g. does `task_list_manager` get
  `production_order.edit_*` by default, or only `operations`?)
- **Page guard vs action guard split** — admin sub-pages
  `admin/products/images` and `admin/products/import` reportedly have **no
  in-body role guard**; they rely solely on the `app/(app)/admin` layout guard.
  If the layout guard ever changes, these would be exposed. **Confirmed by code
  (routes map); recommend a defense-in-depth in-body check.**
- **Visibility not enforced at RLS** — a user with a narrow lens grant still
  relies on app-level filtering; a direct DB/RPC path could over-return. **
  Confirmed (m067 additive).**
- **`production_order.*` capability ownership between TLM and operations** is
  ambiguous from code alone. **Needs confirmation.**
- **View-As divergence** — during View-As, a super-admin sees a role's UI but
  retains real privileges on actions. Intended, but can surprise testers who
  expect actions to be blocked. **Confirmed by code.**
