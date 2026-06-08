# Permission → Menu → Page → Action → RLS — System Audit

> Created **2026-06-04** after the Factory Mapping access bug.
> Updated **2026-06-04** after the Route-access (User Management) bug — see §7.
> Companion to [`CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md) (which documents
> *which* role gets *which* capability). This doc documents the **enforcement
> chain** — how a checked capability actually turns into visible menu + reachable
> page + allowed mutation + permitted DB row, and how to keep all four in sync.

> **Two bugs, same root cause — menu visibility and route access were computed
> from DIFFERENT logic.** §1–6 cover the first (menu link missing). §7 covers the
> second (menu shows, but a parent layout's hard-coded `isAdminLike` redirect
> blocked the route). The fix for both: every layer reads the SAME capability,
> and a blocked route shows **Access Denied**, never a silent dashboard redirect.

---

## 1. The bug we fixed

**Symptom.** `factory_mapping.access` was checked for `task_list_manager` in
`/permissions`, but a TLM user saw **no Factory Mapping menu entry** and couldn't
reach the tool from the nav.

**Root cause.** The only menu entry pointing at `/factory-mapping` lived inside the
**admin-only tab bar** (`app/(app)/admin/layout.tsx`), which is gated by
`isAdminLike(effectiveRole)`. A TLM is not admin-like → never sees the Admin
section → never sees the Factory Mapping tab. The *page* allowed the TLM; the
*menu* never offered it. The capability check and the menu link had **drifted
apart** with nothing keeping them bound.

**Secondary issues found in the same chain** — the one capability was tested four
different ways:

| Layer | Was | Problem |
|---|---|---|
| Menu | *no link* | TLM saw nothing |
| Page | `isTechnicalRole(role) \|\| hasUiCapability(...)` | the `isTechnicalRole` bypass ignored the matrix → unchecking the capability did nothing |
| Server action | `requireTaskListManagerOrAdmin()` (roles in code) | unchecking the capability did nothing |
| RLS (write) | `role in ('admin','task_list_manager')` | `operations` had the capability but was **blocked in the DB**; unchecking did nothing |

---

## 2. The corrected chain (all four layers read the SAME key)

```
  /permissions toggle  ──►  role_permissions.factory_mapping.access
          │
          ├─ MENU   components/Nav.tsx → NAVIGATION (lib/navigation.ts) → MegaMenu
          │         shown when hasUiCapability("factory_mapping.access")   [effective role]
          │
          ├─ PAGE   app/(app)/factory-mapping/page.tsx
          │         hasUiCapability("factory_mapping.access") else <AccessDenied/>   [effective role]
          │
          ├─ ACTION app/(app)/factory-mapping/actions.ts
          │         requireCapability("factory_mapping.access")             [REAL role]
          │
          └─ RLS    migration 088 → write policy joins role_permissions     [REAL role, DB-enforced]
```

- **UI layers** (menu, page) use `hasUiCapability` = **effective** role, so View-As
  stays faithful (a super-admin previewing as Sales sees exactly what Sales sees).
- **Enforcement layers** (action, RLS) use the **real** role — View-As can never
  grant a permission the user doesn't truly have.
- Toggle the cell off in `/permissions` and the link disappears, the page shows
  Access Denied, the action throws, and the DB rejects the write — **at every
  layer, immediately** (the action that saves the matrix calls
  `clearCapabilityCache()` + `revalidatePath("/", "layout")`).

### Files changed for the fix
- `lib/nav-capabilities.ts` *(new; later consolidated into `lib/navigation.ts`)* — central capability→nav-link registry.
- `components/Nav.tsx` — renders capability links from the registry (was: 2 hand-written links + a missing one).
- `components/AccessDenied.tsx` *(new)* — reusable amber denial panel (matches the error boundary).
- `app/(app)/factory-mapping/page.tsx` — pure capability gate + `<AccessDenied/>` (was: `isTechnicalRole` bypass + silent redirect).
- `app/(app)/factory-mapping/actions.ts` — `requireCapability("factory_mapping.access")` (was: `requireTaskListManagerOrAdmin()`).
- `app/(app)/admin/layout.tsx` — removed the duplicate Factory Mapping tab (now a first-class nav link).
- `supabase/migrations/088_factory_mapping_rls_capability.sql` *(new)* — write policy now matrix-driven.
- `tests/permissions-nav.test.ts` *(new)* — guards the registry invariant.

---

## 3. THE RULE (so this never recurs)

> **Any page whose ACCESS is gated by a capability MUST declare its menu item in
> the central nav config `lib/navigation.ts` (`NAVIGATION`), with
> `visibility: { kind: "capability", capability: "<the.same.key>" }`.**

> _Note (2026-06-04): the original `lib/nav-capabilities.ts` registry was
> consolidated into the richer `lib/navigation.ts` mega-menu config (categories ›
> groups › items). The invariant is unchanged — it's now one entry in `NAVIGATION`._

`components/Nav.tsx` resolves each capability via `hasUiCapability` (effective
role) on the server and `buildVisibleNavigation()` prunes anything the user can't
see; the client `MegaMenu` just renders the result. Because the menu and the page
read the **same key from the same place**, "checked in the matrix" can never again
mean "missing from the menu". Adding a new gated page = **add one item** to
`NAVIGATION`; the menu link appears automatically and hides when unauthorized.

When you introduce a new capability-gated page, wire **all four** layers and keep
them on the identical capability key:

1. **Menu** — add an item to `NAVIGATION` with `visibility: { kind: "capability", capability: "<key>" }`.
2. **Page** — `const ok = await hasUiCapability("<key>"); if (!ok) return <AccessDenied capability="<key>" />;`
3. **Action(s)** — `await requireCapability("<key>");` as the first line of every mutating server action.
4. **RLS** — if the table is written directly, gate the write policy on
   `role_permissions` for `<key>` (see migration 088 for the exact super-admin-aware pattern). Read policies can stay broad if a resolver needs them.

**Do NOT** gate access with `role === "admin"`, `isAdmin`, `isAdminLike`, or
`isTechnicalRole`. Those bypass the matrix and make the `/permissions` toggle
cosmetic. Use the capability everywhere.

---

## 4. Per-area audit (current state after the fix)

> "Page-access capability" = a capability that controls whether you can OPEN a
> whole page/section. "Action capability" = gates a button/mutation on a page you
> can already see (no dedicated menu entry needed).

| Area | Capability(ies) | Type | Menu binding | Page gate | Action gate | Status |
|---|---|---|---|---|---|---|
| **Factory mapping** | `factory_mapping.access` | page-access | ✅ registry | ✅ `hasUiCapability` + AccessDenied | ✅ `requireCapability` | ✅ **Fixed — full chain on one key** |
| **Permissions** | `admin.manage_permissions` | page-access | ✅ registry | ✅ `hasUiCapability` + AccessDenied | ✅ `requireCapability` | ✅ Consistent (own layout, not under `/admin`) |
| **Users** | `admin.manage_users` | page-access | ✅ registry | ✅ `hasUiCapability` + AccessDenied | ✅ `requireCapability` | ✅ **Fixed §7** — was blocked by the `/admin` layout's `isAdminLike` redirect |
| **Diagnostics** | `admin.diagnostics` | page-access (admin sub-tab) | ✅ `hasUiCapability` tab in admin layout | ✅ `hasUiCapability` + AccessDenied | ✅ `requireCapability` | ✅ Consistent (super-admin default; admin-like) |
| **Quotations / documents** | `quotation.create/cancel/archive/delete` | action | n/a — Clients/Business pages always visible | rows scoped by RLS/teams | ✅ `requireCapability` in document actions | ✅ Action-gated; no menu binding needed |
| **Task lists** | `task_list.validate/reject/archive/delete/sync_orphans` | action | "Task lists" always visible | RLS-scoped | ✅ `requireCapability` in task-list actions | ✅ Action-gated |
| **Production orders** | `production_order.*` | action | reached via task lists / operations | RLS-scoped | ✅ `requireCapability` | ✅ Action-gated |
| **Forecast (global)** | `forecast.view_global` | data-scope | "Forecast" always visible | page widens scope when capability is on | n/a | ✅ Capability scopes data, not page access |
| **Clients / Price lists** | *(none — no dedicated access capability)* | — | always visible | RLS / role checks | role/RLS | ⚠️ See §5 |

**Conclusion:** Factory Mapping was the **only** page-access capability missing its
menu binding. Quotations, task lists, and production orders are **action**
capabilities (buttons on already-visible pages) and are correctly enforced via
`requireCapability` — they were never affected by this bug. The fix plus the
registry rule closes the gap and prevents new page-access capabilities from
repeating it.

---

## 5. Known residual inconsistencies (flagged, not changed here)

These are pre-existing and **out of scope** for this fix (they need owner
decisions / migrations), but documented so they're not forgotten:

1. ~~`/admin/*` sub-pages are layout-gated only.~~ **RESOLVED in §7** — every
   `/admin/*` page now self-gates (capability or `isAdminLike`) and shows Access
   Denied; the layout is no longer the only guard. (Closes risk **C** in
   `CAPABILITY_MATRIX.md`.) Master-data pages remain admin-only by role because no
   dedicated capability exists for them — give them one + a `NAVIGATION`
   entry if they ever need to be matrix-configurable.
2. **`Cost entry`** nav link is gated by `isAdminLike(role) || role === "finance"`
   (hard-coded roles), not a capability. Fine today, but it can't be toggled in
   `/permissions`. Convert to a capability if finance access needs to be matrix-managed.
3. ~~Orphaned Factory Mapping copy.~~ **RESOLVED in §7** — `app/(app)/admin/factory-mapping/`
   (a stale duplicate of the canonical `/factory-mapping`, reachable by no nav link)
   was deleted.
4. **Legacy `requireTaskListManagerOrAdmin()` / `requireAdmin()`** still gate many
   non-factory actions. They work, but they're role-hard-coded. Migrating them to
   `requireCapability` (as we did for factory mapping) would make the whole
   app matrix-driven. Larger effort — recommend doing it module-by-module.

---

## 6. Manual validation checklist

Run after applying migration 088. For each role, sign in (or use **View-As** as a
super-admin) and verify menu + page + a write.

| Role | Expectation | Menu shows "Factory mapping"? | Open `/factory-mapping` | Save a mapping |
|---|---|:--:|---|---|
| **Super admin** | full access | ✅ yes | page renders | ✅ saves |
| **Admin** | full access | ✅ yes | page renders | ✅ saves |
| **Task List Manager** | access **if** `factory_mapping.access` checked | ✅ yes | page renders | ✅ saves |
| **Operations** | same as TLM (capability on by default) | ✅ yes | page renders | ✅ saves *(was blocked by RLS before m088)* |
| **Sales** | no access (capability off) | ❌ hidden | **Access Denied** panel | n/a |
| **Finance** | no access (capability off) | ❌ hidden | **Access Denied** panel | n/a |

**Toggle test (the real proof the chain is bound):**
1. As super-admin, open `/permissions/actions`, **uncheck** `factory_mapping.access`
   for **Task List Manager**, Save.
2. Sign in as a TLM (or View-As → Task list manager): the **menu link is gone**,
   `/factory-mapping` shows **Access Denied**, and a direct save attempt is rejected
   (action throws + RLS blocks).
3. Re-check it, Save → everything returns. Changes are immediate (cache cleared +
   layout revalidated on save).

**Automated guard:** `npm test` runs `tests/permissions-nav.test.ts`, which fails
if `factory_mapping.access` (or Permissions/Users) loses its registry entry.

---

## 7. Route-access fix — the User Management (and all `/admin/*`) bug

**Symptom (reported after §1 shipped).** With menu visibility now correct, granting
`admin.manage_users` to a Task List Manager made the **Users** menu link appear —
but clicking it **redirected to /dashboard** instead of opening the page.

**Root cause.** `/admin/users` lives under `app/(app)/admin/layout.tsx`, whose
**blanket gate** `if (!isAdminLike(effectiveRole)) redirect("/dashboard")` runs for
**every** `/admin/*` route. A TLM is not admin-like, so the layout bounced them
*before* the Users page (which gates correctly on `admin.manage_users`) could
render. Exactly the §1 pattern, one layer down: **menu used the capability, the
route used `isAdminLike`.** It also silently redirected instead of explaining.

**Fix (route guards aligned with the capabilities; no silent redirects).**
- **`app/(app)/admin/layout.tsx`** — replaced the blanket `isAdminLike` redirect.
  It now lets in anyone who is admin-like **or** holds an admin-section capability
  (`admin.manage_users` / `admin.diagnostics`), renders the master-data **tab bar
  for admin-like users only** (so a capability-only visitor isn't shown tabs they
  can't open), and shows **Access Denied** (not a dashboard redirect) when a user
  has no admin-section access at all.
- **Every `/admin/*` page now self-gates** and returns `<AccessDenied/>` instead of
  `redirect("/dashboard")`:
  - `users`, `diagnostics` → their own capability (`admin.manage_users` /
    `admin.diagnostics`), the SAME key the menu/tab uses.
  - `products`, `categories`, `sales-conditions`, `banks` → `isAdminLike`
    (master-data, no capability) → "Administrators only" Access Denied.
  - `components` → `isTechnicalRole` → Access Denied.
  - **`pricing`** → previously had **no page guard at all** (relied solely on the
    layout); added an `isAdminLike` self-gate. This was the one real leak the layout
    change would have exposed.
- **`/permissions`** layout + matrix page → `redirect("/dashboard")` replaced with
  `<AccessDenied capability="admin.manage_permissions" />`.
- **Deleted** the orphan `app/(app)/admin/factory-mapping/` duplicate.

**Net rule for route access (complements §3's menu rule):**
> A route's guard must use the **same capability** as its menu link, and a blocked
> route must render **Access Denied**, never silently redirect to /dashboard. Page
> guards (not just a parent layout) own access — so a parent layout can't override a
> per-page capability, and adding a new `/admin` page without its own guard can't
> silently inherit "admin-only".

### Manual validation — the user's cases

| Case | Role | `admin.manage_users` | Menu "Users" | Click / direct URL `/admin/users` |
|---|---|:--:|:--:|---|
| **A** | Task List Manager | **enabled** | ✅ appears | ✅ opens the page — **no dashboard redirect** |
| **B** | Task List Manager | disabled | ❌ hidden | **Access Denied** panel (not a dashboard redirect) |
| **C** | Sales | enabled for a module | ✅ appears | ✅ opens the correct page |
| **D** | Sales | disabled | ❌ hidden | direct URL → **Access Denied**, blocked cleanly |

Repeat the spirit of Cases A–D for any capability-gated page (Factory mapping,
Permissions, Users, Diagnostics): **menu and route must flip together.**

### All admin-related routes — verified

| Route | Guard (capability or role) | Blocked → |
|---|---|---|
| `/admin/users` (User Management) | `admin.manage_users` | Access Denied |
| `/admin/diagnostics` | `admin.diagnostics` | Access Denied |
| `/permissions/*` (Permissions, Roles/Teams) | `admin.manage_permissions` | Access Denied |
| `/admin/products` (Product Management) | `isAdminLike` | Access Denied |
| `/admin/pricing` (Pricing) | `isAdminLike` *(guard added)* | Access Denied |
| `/admin/categories` (Product Categories) | `isAdminLike` | Access Denied |
| `/admin/components` | `isTechnicalRole` | Access Denied |
| `/admin/sales-conditions`, `/admin/banks` | `isAdminLike` | Access Denied |
| `/factory-mapping` (Factory Mapping) | `factory_mapping.access` | Access Denied |
| `/task-lists`, `/operations`, `/clients`, `/business`, `/forecast` | always-visible; rows scoped by RLS/teams; actions by `requireCapability` | — |
| `/cost-entry` (Finance) | `isAdminLike \|\| role==="finance"` *(no capability — see §5.2)* | — |

> **Roles:** there is no standalone "Roles" page. Role *assignment* lives on
> `/admin/users` (dropdown) and role × capability mapping on `/permissions/actions`.
