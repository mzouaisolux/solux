# User Roles and Permissions — Editable Audit Document

> **Document status:** Editable source of truth. All facts are grounded in the
> live code and migrations listed below. Edit freely; mark your changes with
> `[Owner note]` so future audits can distinguish code-derived facts from
> policy decisions.
>
> **Notation:**
> - `[Confirmed by code]` — directly verified in the cited file/line.
> - `[Assumed from code]` — strongly implied by structure, not explicitly stated.
> - `[Confirmed by migration]` — explicitly set in a numbered SQL migration.
> - `Needs confirmation` — cannot be determined from code alone; requires owner
>   input or DB inspection.
>
> **Primary sources verified:** `lib/auth.ts`, `lib/permissions.ts`,
> `lib/types.ts`, `lib/visibility.ts`, `lib/access-labels.ts`,
> `supabase/migrations/016_super_admin_flag.sql`,
> `supabase/migrations/026_permissions_matrix.sql`,
> `supabase/migrations/033_diagnostics_capability.sql`,
> `supabase/migrations/042_operations_role.sql`,
> `supabase/migrations/053_forecast_capability_and_ops_matrix.sql`,
> `supabase/migrations/055_sales_delete_quotation.sql`,
> `supabase/migrations/064_factory_mapping_capability.sql`,
> `supabase/migrations/067_visibility_scopes.sql`,
> `supabase/migrations/068_quotation_validation.sql`,
> `app/(app)/admin/layout.tsx`,
> `app/(app)/admin/users/page.tsx`,
> `app/(app)/admin/diagnostics/page.tsx`,
> `app/(app)/admin/products/images/page.tsx`,
> `app/(app)/admin/products/import/page.tsx`,
> `app/(app)/permissions/layout.tsx`,
> `app/(app)/permissions/actions/page.tsx`,
> `app/(app)/factory-mapping/page.tsx`,
> `app/(app)/forecast/page.tsx`,
> `app/(app)/operations/page.tsx`,
> `app/(app)/view-as/actions.ts`

---

## Owner Decisions (confirmed 2026-05-30)

> These decisions describe **TARGET / INTENDED behavior and policy**.
> They are **NOT yet implemented in code** — we are still in the documentation /
> clarification phase. Each decision is quoted or condensed faithfully from
> [OWNER_DECISIONS_LOG.md](./OWNER_DECISIONS_LOG.md), which is the canonical source.

### Decision E — Visibility must become a real RLS security boundary

**Owner decision (confirmed 2026-05-30) — target behavior; not yet implemented.**

From [OWNER_DECISIONS_LOG.md § E](./OWNER_DECISIONS_LOG.md):

> Team, region, lens, ownership, and role-based visibility must not remain only
> advisory at the application level in the long term. Application-level filtering
> may be used for UX/convenience, but sensitive data access must eventually be
> enforced at the **database level through RLS**. Current app-level visibility may
> remain temporarily, but must be documented as an **interim state**, not the final
> security model. **Target:** UI filtering = user experience; RLS filtering = real
> security. Any sensitive visibility restriction must be enforced by RLS before the
> app is considered production-secure.

**Gap vs current behavior:**
- Current state: all lens, team, and region scope enforcement is done in the
  application layer only (see Section 5.3 and 7.2). Database RLS is not updated
  for these grants.
- Target state: RLS must enforce the same visibility boundaries. App-level
  filtering may remain as a UX convenience layer but cannot be the sole guard.
- Migration must be **progressive and tested with real user accounts**, not
  View-As (which keeps the super-admin DB session and therefore does not test RLS
  correctly — see Section 7.3).
- App-level-only visibility filtering is documented here as **interim UX**, not
  the final security model.

### Decision I — Do not ratify the role_permissions matrix yet; produce CAPABILITY_MATRIX.md first

**Owner decision (confirmed 2026-05-30) — target behavior; not yet implemented.**

From [OWNER_DECISIONS_LOG.md § I](./OWNER_DECISIONS_LOG.md):

> Do **not** blindly ratify the seeded `role_permissions` matrix yet. First
> export it into a human-readable capability matrix for owner review.
> The current seeded permissions may be used as the **technical baseline** but
> must not be treated as final business rules until reviewed and approved by the
> owner. Generate a readable **`/docs/CAPABILITY_MATRIX.md`** showing, per role:
> accessible pages; visible entities; allowed actions; restricted actions; and
> all permission domains (admin, document, quotation, task-list,
> production-order, shipping/BL, pricing/discount, notification/message,
> delete/archive). The matrix must mark each entry: **Confirmed by code /
> Assumed from code / Needs owner confirmation / Potentially risky permission**.
> **No permission should be changed yet.** After owner review, the confirmed
> matrix becomes part of `/RULES.md`.

**Gap vs current state:**
- The 22-capability default matrix documented in Section 4.2 of this file
  reflects what the migrations seeded. It is the technical baseline only.
- It has **not** yet been reviewed or ratified as business policy.
- A human-readable review document must be produced at
  [`/docs/CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md) before any permission
  is changed or ratified.
- No capability in the `role_permissions` table should be altered until the owner
  has reviewed and confirmed the matrix.

---

## 1. The Two-Layer Security Model

[Confirmed by code — `lib/auth.ts`]

The app deliberately separates **security** (what a user can do) from
**rendering** (what a user sees). The two concepts use different functions and
must never be swapped.

| Concept | Function | Reads View-As cookie? | Governs |
|---|---|---|---|
| **REAL role** | `getCurrentUserRole()` | **Never** | ALL security decisions |
| **EFFECTIVE role** | `getEffectiveRole()` | Yes (super-admin only) | UI rendering only |

The same split applies in `lib/permissions.ts`:

| Check | Function | Uses which role? |
|---|---|---|
| Server-action enforcement | `hasCapability()` / `requireCapability()` | **REAL** role |
| UI button/link visibility | `hasUiCapability()` | **EFFECTIVE** role |

**How the REAL role is derived** [Confirmed by code — `lib/auth.ts` lines 22–46]:

1. `getCurrentUserRole()` queries `user_roles` for `(role, super_admin)`.
2. If `user_roles.super_admin = true`, it returns the virtual `"super_admin"` role. The DB column `user_roles.role` stays `"admin"` so RLS policies keep working unchanged.
3. The function **never** reads any cookie.

**How the EFFECTIVE role is derived** [Confirmed by code — `lib/auth.ts` lines 56–98]:

1. `getEffectiveRole()` calls `getCurrentUserRole()` first.
2. For non-super-admins, `effectiveRole` = `realRole` (no simulation possible).
3. For super-admins, it reads the `solux_view_as_role` cookie (`VIEW_AS_COOKIE = "solux_view_as_role"`). If the cookie value is a member of `VIEW_AS_ROLES` and is not already the real role, `effectiveRole` is set to the simulated role and `isSimulating` is returned as `true`.

**Security posture** [Assumed from code — route files]: Pages guard with the
EFFECTIVE role (so View-As previews work). Mutating server actions guard with
the REAL role (so a super-admin in View-As mode cannot accidentally lose
privileges, and a real sales user can never escalate). This produces the
intended behavior but means "what I see" and "what I can do" can diverge during
View-As — see Section 7 for the implications.

**Testing note** [Confirmed by code — confirmed in primary source doc]: To test
role-based RLS or visibility accurately, use a **real** account of that role.
View-As keeps the super-admin's DB session, so RLS-governed queries return
super-admin-scope data regardless of the simulated role.

---

## 2. Role Definitions

[Confirmed by code — `lib/types.ts` lines 9–14]

The `Role` union type is:

```ts
type Role = "admin" | "sales" | "task_list_manager" | "operations" | "super_admin";
```

Four of these are **real DB values** stored in `user_roles.role`:
`admin`, `sales`, `task_list_manager`, `operations`.

**`super_admin` is a virtual role** [Confirmed by migration — `016_super_admin_flag.sql`]:
stored as a boolean column `user_roles.super_admin`, not as a role value. The
DB `CHECK` constraint on `user_roles.role` explicitly rejects the string
`'super_admin'` [Confirmed by migration — `042_operations_role.sql` line 29:
`check (role in ('admin', 'sales', 'task_list_manager', 'operations'))`].

**Assignable roles** (usable in the `/admin/users` dropdown)
[Confirmed by code — `lib/types.ts` lines 70–80]:
`admin`, `operations`, `task_list_manager`, `sales`. Super-admin is a
separate toggle, not a dropdown value.

### 2.1 Role grouping helpers [Confirmed by code — `lib/types.ts` lines 17–28]

| Helper | Returns `true` for |
|---|---|
| `isAdminLike(role)` | `"admin"` or `"super_admin"` |
| `isTechnicalRole(role)` | admin-like **or** `"task_list_manager"` **or** `"operations"` |

### 2.2 VIEW_AS_ROLES [Confirmed by code — `lib/types.ts` lines 48–54]

```ts
export const VIEW_AS_ROLES: Role[] = [
  "super_admin",
  "admin",
  "operations",
  "task_list_manager",
  "sales",
];
```

**Important:** `VIEW_AS_ROLES` includes `"super_admin"` itself. The primary
source doc stated this was "expected: the four real roles" — that is **wrong**.
It is all five values including `super_admin`. In practice, selecting
`"super_admin"` in View-As is a no-op because `getEffectiveRole()` treats
`candidate === realRole` as "no simulation" [Confirmed by code — `lib/auth.ts`
line 82].

### 2.3 Auth guards [Confirmed by code — `lib/auth.ts` lines 104–151]

| Guard | Passes for | Used to gate |
|---|---|---|
| `requireAdmin()` | `isAdminLike` (admin, super_admin) | Admin-level writes (products, banks, categories, sales-conditions) |
| `requireTaskListManagerOrAdmin()` | admin-like **or** `"task_list_manager"` **or** `"operations"` | `technical_values` edits, factory PDF, TLM/ops dashboards, component mappings |
| `requireSuperAdmin()` | `super_admin` flag only | Physical DELETE of business records; permanently destructive ops |

---

## 3. Per-Role Summary

> Page reachability uses the EFFECTIVE role. Actions are gated by the REAL role
> and/or a capability key.

### 3.1 `sales`

**Intent** [Assumed from code]: Owns clients and quotations; isolated to their
own accounts/deals by default.

**Can** [Confirmed by code/migration]:
- Create quotations (`quotation.create` — m026 seeded `true` for `sales`).
- Cancel their own quotations (`quotation.cancel` — m026 seeded `true` for `sales`).
- Delete their own quotations (`quotation.delete` — m055 flipped to `true` for `sales`; RLS in m057 scopes DELETE to `created_by = auth.uid()`).
- Create and edit clients they own.
- Request advisory validation on a quotation (m068 — adds `validation_status` column; no new capability key, gated by existing RLS ownership).
- Set forecast fields on their own deals (`documents.probability`, m050).
- Add reminders, notes, attachments, and entity-message threads on entities they can see.

**Cannot** [Confirmed by code]:
- See other sales reps' clients or quotations by default (RLS isolation m046/m058/m066).
- Validate or reject task lists (`task_list.validate`, `task_list.reject` — m026 seeded `false` for `sales`).
- Edit `technical_values` on task lists (`requireTaskListManagerOrAdmin` throws).
- Edit production order status, deadline, payments, or shipment (all `production_order.*` capabilities seeded `false` for `sales` in m026).
- Access factory mapping (`factory_mapping.access` — m064 seeded `false` for `sales`).
- See the global forecast (`forecast.view_global` — m053 seeded `false` for `sales`).
- Access admin or permissions management surfaces.

**Task-list lock** [Confirmed by code — `lib/types.ts` lines 421–426]:
Sales cannot edit a task list once its status is in
`TASK_LIST_LOCKED_FOR_SALES`:

```ts
export const TASK_LIST_LOCKED_FOR_SALES: ProductionTaskListStatus[] = [
  "under_validation",
  "validated",
  "production_ready",
  "cancelled",
];
```

Editing is re-enabled only when the TLM bounces the task list back to
`needs_revision`.

**Default role_permissions matrix** [Confirmed by migration — m026 + m055]:

| Capability | Enabled |
|---|---|
| `quotation.create` | true |
| `quotation.cancel` | true |
| `quotation.archive` | false |
| `quotation.delete` | **true** (m055 override) |
| `task_list.*` (all 5) | false |
| `factory_mapping.access` | false |
| `production_order.*` (all 8) | false |
| `forecast.view_global` | false |
| `admin.*` (all 3) | false |

---

### 3.2 `task_list_manager` (TLM)

**Intent** [Assumed from code]: Technical reviewer and validator of production
task lists; owns factory configuration.

**Can** [Confirmed by migration — m026 + m064]:
- Create and cancel quotations (`quotation.create`, `quotation.cancel` — seeded `true`).
- Validate task lists (`task_list.validate` — seeded `true`).
- Reject task lists (`task_list.reject` — seeded `true`).
- Sync orphan task lists (`task_list.sync_orphans` — seeded `true`).
- Edit `technical_values` and factory config (passes `requireTaskListManagerOrAdmin`).
- Access Factory Mapping tool (`factory_mapping.access` — m064 seeded `true`).
- Edit production order status, deadline, payments, shipment, and timeline
  (`production_order.edit_status/edit_deadline/edit_payments/edit_shipment/set_timeline` — all seeded `true` in m026).
- Generate factory PDF (gated by `requireTaskListManagerOrAdmin`).
- See all task lists in the TLM actionable queue (`TASK_LIST_TLM_QUEUE = ["under_validation"]`).

**Cannot** [Confirmed by migration — m026]:
- Archive task lists (`task_list.archive` — seeded `false`).
- Delete task lists (`task_list.delete` — seeded `false`).
- Archive or delete production orders (`production_order.archive/delete` — seeded `false`).
- Use the deposit override (`production_order.start_without_deposit` — seeded `false`).
- Archive quotations (`quotation.archive` — seeded `false`).
- Access admin user/permission management surfaces (`admin.*` — all seeded `false`).
- Access global forecast (`forecast.view_global` — m053 seeded `false`).

**Default role_permissions matrix** [Confirmed by migration — m026 + m053 + m064]:

| Capability | Enabled |
|---|---|
| `quotation.create` | true |
| `quotation.cancel` | true |
| `quotation.archive` | false |
| `quotation.delete` | false |
| `task_list.validate` | true |
| `task_list.reject` | true |
| `task_list.archive` | false |
| `task_list.delete` | false |
| `task_list.sync_orphans` | true |
| `factory_mapping.access` | true |
| `production_order.edit_status` | true |
| `production_order.edit_deadline` | true |
| `production_order.edit_payments` | true |
| `production_order.edit_shipment` | true |
| `production_order.set_timeline` | true |
| `production_order.start_without_deposit` | false |
| `production_order.archive` | false |
| `production_order.delete` | false |
| `forecast.view_global` | false |
| `admin.manage_permissions` | false |
| `admin.manage_users` | false |
| `admin.diagnostics` | false |

---

### 3.3 `operations`

**Intent** [Confirmed by migration — m042]: Production planning, shipment
coordination, deadlines. Shares the full technical scope of `task_list_manager`
for access-guard purposes (passes `requireTaskListManagerOrAdmin`).

**Matrix** [Confirmed by migration — m042 + m053]: On creation (m042), the
`operations` role receives an exact mirror of the `task_list_manager` matrix.
Migration m053 backfills `operations` again for any capabilities that existed
before m042 was run (`ON CONFLICT DO NOTHING` prevents overwrites). The net
result: `operations` and `task_list_manager` have **identical** enabled
capability sets unless a super-admin manually diverges them via
`/permissions/actions`.

See the TLM matrix table above — `operations` defaults are identical.

**Visibility** [Confirmed by code — `lib/visibility.ts` lines 91–95]:
`isTechnicalRole` returns `true` for `operations`, so under the legacy
fallback (no access grants assigned), operations users see **all** rows.

---

### 3.4 `admin`

**Intent** [Assumed from code]: Full operational control of all entities; can
manage master data (products, categories, banks, sales conditions, components).
Cannot perform physical deletes or manage the permissions matrix by default.

**Can** [Confirmed by migration — m026 + m053 + m055 + m064]:

| Capability | Enabled |
|---|---|
| `quotation.create` | true |
| `quotation.cancel` | true |
| `quotation.archive` | true |
| `quotation.delete` | **true** (m055 override) |
| `task_list.validate` | true |
| `task_list.reject` | true |
| `task_list.archive` | true |
| `task_list.delete` | false |
| `task_list.sync_orphans` | true |
| `factory_mapping.access` | true |
| `production_order.edit_status` | true |
| `production_order.edit_deadline` | true |
| `production_order.edit_payments` | true |
| `production_order.edit_shipment` | true |
| `production_order.set_timeline` | true |
| `production_order.start_without_deposit` | true |
| `production_order.archive` | true |
| `production_order.delete` | false |
| `forecast.view_global` | true |
| `admin.manage_permissions` | **false** (super-admin only by default) |
| `admin.manage_users` | **false** (super-admin only by default) |
| `admin.diagnostics` | **false** (super-admin only by default) |

**Cannot by policy** [Confirmed by code — `requireSuperAdmin` comments in
`lib/auth.ts` lines 136–151]: physical DELETE of business records — that
requires `requireSuperAdmin()`. Admins are expected to **cancel** (set status)
or **archive** (`archived_at`) records instead.

**Cannot by default** [Confirmed by migration — m026]: manage permissions,
manage users, or access diagnostics. These are super-admin-only by default seed,
but can be toggled via the matrix.

---

### 3.5 `super_admin` (virtual)

**Storage** [Confirmed by migration — m016]: `user_roles.super_admin` boolean,
not in the `role` column. The DB column stays `"admin"` for RLS compatibility.

**Can** [Confirmed by migration — m026 + m033 + m053 + m064]:
Everything an `admin` can, **plus**:
- Physical DELETE of business records (`requireSuperAdmin` passes).
- View-As simulation of any other role (`/view-as/actions.ts`).
- Manage permissions matrix (`admin.manage_permissions` — seeded `true`).
- Manage users (`admin.manage_users` — seeded `true`).
- Access diagnostics (`admin.diagnostics` — seeded `true`).
- `task_list.delete` and `production_order.delete` (seeded `true`).

**Default matrix** [Confirmed by migration — m026 + m053 + m064]: All 22
capabilities enabled.

**View-As** [Confirmed by code — `app/(app)/view-as/actions.ts`]:
`setViewAsRole()` is server-action-gated: it calls `getCurrentUserRole()` and
throws if `isSuperAdmin` is `false`. The cookie expires in 24 hours.
`clearViewAsRole()` silently no-ops for non-super-admins.

---

## 4. The 22-Capability Catalog

[Confirmed by code — `lib/permissions.ts` lines 51–79; confirmed by migrations
m026, m033, m053, m064]

The `Capability` union type (verbatim from `lib/permissions.ts`):

```ts
export type Capability =
  // quotation
  | "quotation.create"
  | "quotation.cancel"
  | "quotation.archive"
  | "quotation.delete"
  // task list
  | "task_list.validate"
  | "task_list.reject"
  | "task_list.archive"
  | "task_list.delete"
  | "task_list.sync_orphans"
  // factory mapping (production configuration tool)
  | "factory_mapping.access"
  // production order
  | "production_order.edit_status"
  | "production_order.edit_deadline"
  | "production_order.edit_payments"
  | "production_order.edit_shipment"
  | "production_order.set_timeline"
  | "production_order.start_without_deposit"
  | "production_order.archive"
  | "production_order.delete"
  // forecast
  | "forecast.view_global"
  // admin
  | "admin.manage_permissions"
  | "admin.manage_users"
  | "admin.diagnostics";
```

**Count: 22 capabilities.** [Confirmed by code + migrations]

Capability addition history:
- m026: 19 capabilities (4 quotation, 5 task_list, 8 production_order, 2 admin)
- m033: +1 `admin.diagnostics` = **20**
- m053: +1 `forecast.view_global` = **21**
- m064: +1 `factory_mapping.access` = **22**

Note: The primary source doc `USER_ROLES.md` correctly states 22. Any reference
to "23 capabilities" elsewhere is erroneous.

### 4.1 Capability resolution

[Confirmed by code — `lib/permissions.ts` lines 82–134]

- Reads `role_permissions` table filtered by `(role, enabled = true)`.
- **30-second in-memory cache** per role. The cache is module-level (`Map<Role, CacheEntry>`).
- **Fail-closed**: if the DB read errors, `loadEnabledCapabilities` returns an empty `Set` so `requireCapability` denies the action.
- Cache is cleared explicitly via `clearCapabilityCache()` after the admin matrix save, for same-process immediate effect.
- **App-level only**: the capability check runs in the server action layer only. RLS is not altered by capabilities.

### 4.2 Complete default matrix by role

[Confirmed by migrations — m026, m042, m053, m055, m064, m033]

| Capability | super_admin | admin | task_list_manager | operations | sales |
|---|:---:|:---:|:---:|:---:|:---:|
| `quotation.create` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `quotation.cancel` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `quotation.archive` | ✓ | ✓ | — | — | — |
| `quotation.delete` | ✓ | ✓ (m055) | — | — | ✓ (m055) |
| `task_list.validate` | ✓ | ✓ | ✓ | ✓ | — |
| `task_list.reject` | ✓ | ✓ | ✓ | ✓ | — |
| `task_list.archive` | ✓ | ✓ | — | — | — |
| `task_list.delete` | ✓ | — | — | — | — |
| `task_list.sync_orphans` | ✓ | ✓ | ✓ | ✓ | — |
| `factory_mapping.access` | ✓ | ✓ | ✓ | ✓ | — |
| `production_order.edit_status` | ✓ | ✓ | ✓ | ✓ | — |
| `production_order.edit_deadline` | ✓ | ✓ | ✓ | ✓ | — |
| `production_order.edit_payments` | ✓ | ✓ | ✓ | ✓ | — |
| `production_order.edit_shipment` | ✓ | ✓ | ✓ | ✓ | — |
| `production_order.set_timeline` | ✓ | ✓ | ✓ | ✓ | — |
| `production_order.start_without_deposit` | ✓ | ✓ | — | — | — |
| `production_order.archive` | ✓ | ✓ | — | — | — |
| `production_order.delete` | ✓ | — | — | — | — |
| `forecast.view_global` | ✓ | ✓ | — | — | — |
| `admin.manage_permissions` | ✓ | — | — | — | — |
| `admin.manage_users` | ✓ | — | — | — | — |
| `admin.diagnostics` | ✓ | — | — | — | — |

> "✓" = enabled by default. "—" = disabled by default (toggleable via
> `/permissions/actions` by a super-admin). The matrix is live in the
> `role_permissions` DB table and can diverge from this table if edited.

> **Decision I (confirmed 2026-05-30 — not yet implemented):** This matrix is
> the **technical baseline** only. It must not be treated as final business
> policy until reviewed and approved by the owner via the human-readable
> capability review document. See [`../CAPABILITY_MATRIX.md`](../CAPABILITY_MATRIX.md)
> (to be produced) and the "Owner Decisions" section at the top of this file.
> No permission in `role_permissions` should be changed until the owner has
> reviewed and confirmed the matrix; the confirmed matrix will then become part
> of `/RULES.md`.

---

## 5. Visibility Engine ("Who Can See Which Rows")

[Confirmed by code — `lib/visibility.ts`; Confirmed by migration — m067]

Visibility (which **rows** appear) is separate from capabilities (which
**actions** are allowed). Visibility is resolved by `getVisibilityScope()`.

### 5.1 Scope types

A user's effective scope is the **union** of their active `access_grants` rows:

| Scope type | Effect |
|---|---|
| `"all"` | No row restriction — sees everything |
| `"self"` | Only records owned by `userId` |
| `"team"` | Records owned by any member of the named team |
| `"region"` | Records whose client belongs to the named region (resolved to owner IDs) |
| `"lens"` | Cross-owner, workflow-state-filtered slice: `production`, `finance`, or `logistics` |

Lens state filters [Confirmed by code — `lib/visibility.ts` lines 28–32]:

| Lens | Exposes |
|---|---|
| `production` | task lists with status `validated` or `production_ready`; all production orders |
| `finance` | documents with status `won`; all production orders |
| `logistics` | documents with status `won`; all production orders |

### 5.2 Legacy fallback [Confirmed by code — `lib/visibility.ts` lines 91–96]

When a user has **no** active grants, `getVisibilityScope` falls back:
- `isTechnicalRole` (admin-like, TLM, operations) → `scope.all = true` (sees everything).
- All other roles (sales) → `scope.ownerIds = { userId }` (sees own records only).

This preserves the pre-m067 behavior and ensures no lockout when grants have
not been assigned.

### 5.3 Enforcement boundary — app-level ONLY [Confirmed by code — m067 is additive]

**Critical limitation**: the visibility engine is enforced in application-layer
queries and components (`canSeeRow`, `canSeeRecord`, `canSeeOwner`,
`ownerAllowList`). Database-level RLS does **not** enforce lens, team, or region
scope grants. A direct DB or RPC call bypassing the application layer can
over-return rows. This is a known architectural gap documented in
`docs/current-implementation/POTENTIAL_INCONSISTENCIES.md`.

### 5.4 Manager-facing labels [Confirmed by code — `lib/access-labels.ts`]

The UI presents scope types with plain-English labels from `ACCESS_TYPES`:
- `"all"` → "Full visibility (everything)"
- `"region"` → "Region access"
- `"team"` → "Team access"
- `"lens"` → "Department access"
- `"self"` → "Own records only"

---

## 6. Accessible Pages by Role

> Reachability uses EFFECTIVE role. List pages are generally readable by all
> authenticated users with RLS-scoped data. Mutations are gated as described
> in Section 3. Route-level redirects use `redirect("/dashboard")` as the
> fallback for unauthorized access.

| Route | Who can reach it | Guard mechanism | Notes |
|---|---|---|---|
| `/dashboard`, `/dashboard-v2` | All authenticated | None (RLS-scoped widgets) | Role-shaped widgets; sales strip vs management panel |
| `/business` | Admin-like | [Needs confirmation — no guard verified in code] | Exec KPIs |
| `/operations` | All (data scoped by role) | `isTechnicalRole` check in page for sync action | Operations feed + Action Center |
| `/forecast` | All | `hasUiCapability("forecast.view_global")` controls global vs own view | Sales see own; management see all |
| `/clients`, `/clients/[id]` | All (RLS-scoped) | RLS on `clients` table | Sales see owned clients only |
| `/documents`, `/documents/[id]`, `/documents/new` | All (RLS-scoped) | RLS on `documents` table | |
| `/task-lists`, `/task-lists/[id]` | All to view; TLM/ops to validate | `requireTaskListManagerOrAdmin` in actions | Sales locked from edit once `under_validation`+ |
| `/production/orders/[id]` | Technical roles edit; others view if visible | Capability checks in actions | `/production`, `/production/orders`, `/production/queue` are redirect stubs |
| `/factory-mapping` | TLM / operations / admin-like OR `factory_mapping.access` | `isTechnicalRole(role) || hasUiCapability("factory_mapping.access")` [Confirmed — factory-mapping/page.tsx line 26] | Defensive dual-gate: role OR capability |
| `/admin/*` | Admin-like (`isAdminLike(effectiveRole)`) | `app/(app)/admin/layout.tsx` redirects non-admin to `/dashboard` | All admin sub-pages rely on layout guard |
| `/admin/users` | `admin.manage_users` capability | `hasUiCapability` + `requireCapability` both called [Confirmed — admin/users/page.tsx lines 44–46] | Defense-in-depth: layout guard + capability guard |
| `/admin/diagnostics` | `admin.diagnostics` capability | `hasUiCapability` + `requireCapability` both called [Confirmed — admin/diagnostics/page.tsx lines 46–47] | Diagnostics tab is conditionally shown in admin nav |
| `/admin/products/images` | Admin-like (layout only) | **No in-body guard** [Confirmed — admin/products/images/page.tsx] | Relies on admin layout redirect only |
| `/admin/products/import` | Admin-like (layout only) | **No in-body guard** [Confirmed — admin/products/import/page.tsx] | Relies on admin layout redirect only |
| `/permissions/*` | `admin.manage_permissions` capability | `hasUiCapability` in `/permissions/layout.tsx` [Confirmed] | Layout-level gate; `/permissions` root is redirect stub |
| `/permissions/actions` | `admin.manage_permissions` | `hasUiCapability` + `requireCapability` in page [Confirmed — permissions/actions/page.tsx] | Matrix editor |
| `/view-as` | super-admin | `requireSuperAdmin()` equivalent in `setViewAsRole` action [Confirmed — view-as/actions.ts] | Sets the View-As cookie; 24h expiry |
| `/`, `/order-follow-up` | Redirect stubs | N/A | |

---

## 7. Inconsistencies, Gaps, and Needs-Confirmation Items

### 7.1 Admin sub-pages lacking in-body role guard [Confirmed by code]

`app/(app)/admin/products/images/page.tsx` and
`app/(app)/admin/products/import/page.tsx` have **no in-body role guard** —
they rely entirely on the `app/(app)/admin/layout.tsx` guard. If the layout
guard is ever bypassed, removed, or modified, these pages would be exposed to
non-admin users. The pattern used on `/admin/users` and `/admin/diagnostics`
(both layout guard AND `hasUiCapability + requireCapability` in-body) is the
correct defensive approach.

**Risk**: Medium. No direct path around the layout guard exists today, but this
is not defense-in-depth.

### 7.2 Visibility not enforced at RLS [Confirmed by migration — m067 is additive] — direction resolved by Decision E

The lens, team, and region visibility scopes are enforced **only at the
application layer**. Row-Level Security policies on `documents`,
`production_orders`, and related tables are not updated to enforce these grants.
A direct DB or Supabase RPC call by a user with a narrow lens grant can
over-return rows beyond their intended scope.

**Risk**: Relevant if the app ever exposes direct DB access paths to users
(e.g., Supabase's REST API). Currently mitigated because all reads go through
the application layer.

**Resolved direction — Owner decision E (confirmed 2026-05-30; not yet implemented):**
RLS is the confirmed target security boundary. App-level visibility filtering is
explicitly classified as **interim UX only**, not the final security model.
Team, region, lens, ownership, and role-based visibility must eventually be
enforced at the database level through RLS before the app is considered
production-secure. Migration must be progressive and tested with real user
accounts (not View-As). See the "Owner Decisions" section above and
[OWNER_DECISIONS_LOG.md § E](./OWNER_DECISIONS_LOG.md) for the full rule.

### 7.3 View-As privilege divergence [Confirmed by code]

During View-As, a super-admin sees the UI rendered as the simulated role
(`hasUiCapability` returns simulated-role results) but ALL server actions still
run with super-admin capabilities (`requireCapability` uses the real role).
This is intentional and correct from a security standpoint, but it means a
super-admin testing in View-As mode will see actions fail that should succeed
(if the capability is not enabled for the simulated role) — but the
_opposite_ is also true: the super-admin will NOT be blocked from actions that
the simulated role cannot perform if they call the action directly (bypassing
the hidden button).

**Impact on testing**: View-As cannot be used to verify that a given role is
properly blocked from an action. Use a real account of that role for security
testing.

### 7.4 `production_order.*` capability split: TLM vs operations [Confirmed by migration — resolved]

The primary source doc flagged this as "Needs confirmation." After verifying
m026, m042, and m053, the answer is clear: **TLM and operations have identical
`production_order.*` capability defaults.** Both have `edit_status`,
`edit_deadline`, `edit_payments`, `edit_shipment`, and `set_timeline` enabled.
Neither has `start_without_deposit`, `archive`, or `delete` enabled by default.
These can be diverged by a super-admin via the matrix.

### 7.5 `VIEW_AS_ROLES` includes `super_admin` [Confirmed by code]

The `VIEW_AS_ROLES` constant in `lib/types.ts` is `["super_admin", "admin",
"operations", "task_list_manager", "sales"]`. This includes `"super_admin"`
itself. Selecting it in View-As is harmless (the code treats
`candidate === realRole` as no simulation), but it is slightly misleading in
the UI — a super-admin selecting "Super admin" in the View-As picker will see
no change. This may confuse future maintainers.

### 7.6 `admin.manage_permissions`, `admin.manage_users`, `admin.diagnostics` — admin cannot access by default [Confirmed by migration]

The m026 seed sets all three `admin.*` capabilities to `false` for `"admin"`.
Only `"super_admin"` gets them as `true`. This means a regular admin cannot:
- Edit the permissions matrix (`/permissions/actions`)
- Manage user roles (`/admin/users`)
- Access diagnostics (`/admin/diagnostics`)

This is confirmed intentional per migration comments, but it is a non-obvious
behavior: the `/admin/users` route is under `/admin/*` which requires
`isAdminLike`, but the page then requires `admin.manage_users` capability
which is disabled for `admin` by default. An admin who navigates to
`/admin/users` will be redirected to `/dashboard` by the page's
`hasUiCapability` check — even though the layout accepted them.

### 7.7 `operations` role missing from m033 diagnostics seed [Confirmed by migration]

Migration `033_diagnostics_capability.sql` seeds `admin.diagnostics` for only
four roles: `super_admin`, `admin`, `task_list_manager`, `sales`. The
`operations` role was added in m042 (after m033). The m053 backfill mirrors
TLM → operations for capabilities existing before m042, and m053 runs after
m033. However, m053's backfill uses `ON CONFLICT DO NOTHING` against the
`task_list_manager` rows. Since TLM has `admin.diagnostics = false`, operations
also gets `false` — but only after m053 runs. If only m033 and m042 were
applied (not m053), operations would have **no row** for `admin.diagnostics`.
The fail-closed behavior of `loadEnabledCapabilities` means missing rows are
treated as denied — so this is safe but architecturally messy.

### 7.8 Capability check migration (sub-step 3.B) partial [Assumed from code — `lib/permissions.ts` header comment]

The comment at the top of `lib/permissions.ts` (lines 27–29) states:
> "Sub-step 3.A scope (this commit): This file is created but NOT yet imported
> by any server action. Behavior of the app is unchanged."

This was the state when the file was committed. Grepping the codebase shows
`requireCapability` IS now used in several server action files (e.g.,
`permissions/actions/actions.ts`, `admin/users/page.tsx`, factory-mapping
actions). However, it is **not** confirmed that all legacy `requireAdmin` and
`requireTaskListManagerOrAdmin` calls in server actions have been replaced.
Both guard systems coexist. **Needs confirmation**: is the migration to
`requireCapability` complete, or do some actions still use the legacy guards
exclusively?

---

## 8. Quick Reference

### Role permissions at a glance

| Area | super_admin | admin | task_list_manager | operations | sales |
|---|:---:|:---:|:---:|:---:|:---:|
| Create quotation | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cancel quotation | ✓ | ✓ | ✓ | ✓ | ✓ |
| Delete quotation | ✓ | ✓ | — | — | ✓ (own only, RLS) |
| Archive quotation | ✓ | ✓ | — | — | — |
| Validate task list | ✓ | ✓ | ✓ | ✓ | — |
| Reject task list | ✓ | ✓ | ✓ | ✓ | — |
| Delete task list | ✓ | — | — | — | — |
| Factory mapping | ✓ | ✓ | ✓ | ✓ | — |
| Edit PO status/deadline/payments/shipment/timeline | ✓ | ✓ | ✓ | ✓ | — |
| Start PO without deposit | ✓ | ✓ | — | — | — |
| Archive PO | ✓ | ✓ | — | — | — |
| Delete PO | ✓ | — | — | — | — |
| Global forecast | ✓ | ✓ | — | — | — |
| Manage permissions matrix | ✓ | — | — | — | — |
| Manage users | ✓ | — | — | — | — |
| Diagnostics | ✓ | — | — | — | — |
| Physical DELETE (any entity) | ✓ | — | — | — | — |
| View-As simulation | ✓ | — | — | — | — |

### Security function usage

| Function | Location | Uses | When to call |
|---|---|---|---|
| `getCurrentUserRole()` | `lib/auth.ts` | DB `user_roles` only | Security decisions (never cookies) |
| `getEffectiveRole()` | `lib/auth.ts` | Real role + View-As cookie | Page rendering only |
| `requireAdmin()` | `lib/auth.ts` | `isAdminLike` check | Admin-level mutations (products, banks, etc.) |
| `requireTaskListManagerOrAdmin()` | `lib/auth.ts` | `isTechnicalRole` check | Technical data mutations |
| `requireSuperAdmin()` | `lib/auth.ts` | `isSuperAdmin` flag | Physical deletes |
| `hasCapability()` | `lib/permissions.ts` | Real role + DB matrix | Server-action enforcement |
| `hasUiCapability()` | `lib/permissions.ts` | Effective role + DB matrix | UI rendering (buttons, nav links) |
| `requireCapability()` | `lib/permissions.ts` | Calls `hasCapability` | First line of privileged server actions |
| `getVisibilityScope()` | `lib/visibility.ts` | DB access_grants + fallback | Row-level filtering in queries |
