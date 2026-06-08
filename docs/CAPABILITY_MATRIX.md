# SOLUX — Default Role × Capability Matrix

> **Generated per Owner Decision I** (see
> [`docs/audit-editable/OWNER_DECISIONS_LOG.md`](./audit-editable/OWNER_DECISIONS_LOG.md),
> section I, confirmed **2026-05-30**).
>
> **Purpose.** Export the seeded `role_permissions` matrix into a human-readable
> form for owner review **before** it is ratified as business rule.

---

## ⚠️ Read this first — scope, status, and safety

- **This reflects SEEDED DEFAULTS reconstructed from the migration files**
  (`supabase/migrations/026, 033, 042, 053, 055, 064`). **The live database was
  NOT introspected.** The real, running matrix may differ if a super-admin has
  edited it through `/admin/permissions` (every cell is editable there). Any
  value that has not been confirmed against the live DB is therefore at best
  **Assumed from code** and ultimately **Needs owner confirmation**.
- **NO permission is changed by this document.** It is documentation only.
- Per **Owner Decision I**: the seeded permissions are a *technical baseline*,
  **not** final business rules. They must be reviewed in plain language and
  approved by the owner. **After owner review, the confirmed matrix becomes part
  of `/RULES.md`.**
- **Owner Decisions (confirmed 2026-05-30) are TARGET / INTENDED behavior and
  are NOT yet implemented in code.** Where this document references decisions
  A–I, treat them as the future target, and the "Current behavior" columns as
  what the code does today. Decision G is an *approved fix that has not been
  applied*.

### Tag legend (every row is tagged exactly one)

| Tag | Meaning |
|---|---|
| **Confirmed by code** | The seed migration explicitly sets this cell to this value; behavior is directly readable in the SQL. |
| **Assumed from code** | Inferred from how the seed propagates (e.g. operations mirroring TLM) or from a guard pattern, not from a literal per-cell line. |
| **Needs owner confirmation** | Business intent is unclear, or live-DB state is unknown, or it depends on an owner decision still pending. |
| **Potentially risky** | The seeded/observed behavior is broad, conflicts with an owner decision, or relies on a weak guard. Flagged for explicit owner attention. |

---

## How the matrix is built (source of truth in code)

- **Catalog table:** `permissions` (PK `key`). **Matrix table:** `role_permissions`
  (`role`, `permission_key`, `enabled`). Created in
  `supabase/migrations/026_permissions_matrix.sql`.
- **TypeScript capability union:** `lib/permissions.ts` →
  `export type Capability` lists **22 capability keys**.
- **Enforcement helpers:**
  - `lib/permissions.ts` → `hasCapability()` / `requireCapability()` — **real
    role**, used for server-action security gates (fail-closed: a DB read error
    returns an empty set → action denied).
  - `lib/permissions.ts` → `hasUiCapability()` — **effective role** (honors the
    View-As cookie), used only for nav/button visibility.
  - `lib/auth.ts` → legacy hardcoded gates still in use:
    - `requireAdmin()` → passes for `admin` or `super_admin`
      (`isAdminLike`, `lib/types.ts`).
    - `requireTaskListManagerOrAdmin()` → passes for `admin`, `super_admin`,
      `task_list_manager`, **or `operations`**.
    - `requireSuperAdmin()` → passes only when `user_roles.super_admin = true`.
  - `lib/types.ts` → `isAdminLike()` (`admin`/`super_admin`),
    `isTechnicalRole()` (`admin`/`super_admin`/`task_list_manager`/`operations`).
- **Roles (`lib/types.ts` → `Role`):** `admin`, `sales`, `task_list_manager`,
  `operations`, `super_admin`. **`super_admin` is virtual** — it is **not** a
  value of `user_roles.role` (the DB CHECK rejects it); it is the boolean
  `user_roles.super_admin`. Storable roles: `admin`, `sales`,
  `task_list_manager`, `operations`.

### Seed migrations that populate the matrix

| Migration | What it seeds |
|---|---|
| `026_permissions_matrix.sql` | Base catalog (**19** capabilities) + matrix for **4 roles** (`super_admin`, `admin`, `task_list_manager`, `sales`). 76 rows. |
| `033_diagnostics_capability.sql` | Adds `admin.diagnostics`; seeds `super_admin=true`, others `false` (operations not present yet). |
| `042_operations_role.sql` | Adds the `operations` storable role; seeds its matrix by **mirroring `task_list_manager`** (`on conflict do nothing`). |
| `053_forecast_capability_and_ops_matrix.sql` | Adds `forecast.view_global` (`super_admin`+`admin`=true, rest false); **backfills `operations` again** by mirroring TLM. |
| `055_sales_delete_quotation.sql` | **Flips** `quotation.delete` to `true` for `sales` and `admin` (`do update`). |
| `064_factory_mapping_capability.sql` | Adds `factory_mapping.access`; `super_admin`/`admin`/`task_list_manager`/`operations`=true, `sales`=false. |

> **22-vs-21 catalog gap.** `lib/permissions.ts` declares **22** capability keys.
> The seeds insert: 19 (m026) + `admin.diagnostics` (m033) + `forecast.view_global`
> (m053) + `factory_mapping.access` (m064) = **22** rows in `permissions`. So the
> catalog *count* reconciles. **But two mismatches remain and need confirmation:**
> 1. **`operations` is never seeded by m026/m033 directly** — it only exists via
>    the *mirror-from-TLM* backfills (m042, m053). If those mirrors ran out of
>    order or after a manual edit, operations could be missing rows. **Live-DB
>    confirmation required.**
> 2. `lib/types.ts` (ProductionOrder comment, ~line 610) references a capability
>    **`production_order.unlock_baseline`** that is **NOT in the `Capability`
>    union and NOT seeded** in any migration. It appears to be aspirational. →
>    **Needs owner confirmation / potential dead reference.**

---

## 1. MASTER matrix — 22 capabilities × 5 roles

Cell values: **✅ granted**, **❌ denied**, **❔ unknown** (not seeded for that role
in code / live-DB unknown). Roles left→right: `sales`, `task_list_manager` (TLM),
`operations` (Ops), `admin`, `super_admin` (SA).

| # | Capability (key) | sales | TLM | Ops | admin | SA | Source / tag |
|---|---|:---:|:---:|:---:|:---:|:---:|---|
| 1 | `quotation.create` | ✅ | ✅ | ✅* | ✅ | ✅ | m026; Ops via mirror — **Assumed from code** |
| 2 | `quotation.cancel` | ✅ | ✅ | ✅* | ✅ | ✅ | m026; Ops via mirror — **Assumed from code** |
| 3 | `quotation.archive` | ❌ | ❌ | ❌* | ✅ | ✅ | m026; Ops via mirror — **Confirmed by code** (sales/TLM/admin), Ops **Assumed** |
| 4 | `quotation.delete` | ✅ | ❌ | ❌* | ✅ | ✅ | m026 then **m055 flips sales+admin→true** — **Potentially risky** (see §4 & Decision F) |
| 5 | `task_list.validate` | ❌ | ✅ | ✅* | ✅ | ✅ | m026; Ops via mirror — **Confirmed by code** / Ops **Assumed** |
| 6 | `task_list.reject` | ❌ | ✅ | ✅* | ✅ | ✅ | m026; Ops via mirror — **Confirmed by code** / Ops **Assumed** |
| 7 | `task_list.archive` | ❌ | ❌ | ❌* | ✅ | ✅ | m026; Ops via mirror — **Confirmed by code** / Ops **Assumed** |
| 8 | `task_list.delete` | ❌ | ❌ | ❌* | ❌ | ✅ | m026 (admin=false; SA only) — **Confirmed by code** |
| 9 | `task_list.sync_orphans` | ❌ | ✅ | ✅* | ✅ | ✅ | m026; Ops via mirror — **Confirmed by code** / Ops **Assumed** |
| 10 | `factory_mapping.access` | ❌ | ✅ | ✅ | ✅ | ✅ | **m064** (explicit per role incl. Ops) — **Confirmed by code** |
| 11 | `production_order.edit_status` | ❌ | ✅ | ✅* | ✅ | ✅ | m026; Ops via mirror — **Confirmed by code** / Ops **Assumed** |
| 12 | `production_order.edit_deadline` | ❌ | ✅ | ✅* | ✅ | ✅ | m026; Ops via mirror — **Confirmed by code** / Ops **Assumed** |
| 13 | `production_order.edit_payments` | ❌ | ✅ | ✅* | ✅ | ✅ | m026; Ops via mirror — **Confirmed by code** / Ops **Assumed** |
| 14 | `production_order.edit_shipment` | ❌ | ✅ | ✅* | ✅ | ✅ | m026; Ops via mirror — **Confirmed by code** / Ops **Assumed** |
| 15 | `production_order.set_timeline` | ❌ | ✅ | ✅* | ✅ | ✅ | m026; Ops via mirror — **Confirmed by code** / Ops **Assumed** |
| 16 | `production_order.start_without_deposit` | ❌ | ❌ | ❌* | ✅ | ✅ | m026; Ops via mirror — **Needs owner confirmation** (Decision H.10: exceptional, director/admin only) |
| 17 | `production_order.archive` | ❌ | ❌ | ❌* | ✅ | ✅ | m026; Ops via mirror — **Confirmed by code** / Ops **Assumed** |
| 18 | `production_order.delete` | ❌ | ❌ | ❌* | ❌ | ✅ | m026 (admin=false; SA only) — **Confirmed by code** |
| 19 | `forecast.view_global` | ❌ | ❌ | ❌ | ✅ | ✅ | **m053** (explicit per role incl. Ops) — **Confirmed by code** |
| 20 | `admin.manage_permissions` | ❌ | ❌ | ❌* | ❌ | ✅ | m026 (admin=false; SA only) — **Potentially risky** to grant; **Confirmed by code** |
| 21 | `admin.manage_users` | ❌ | ❌ | ❌* | ❌ | ✅ | m026 (admin=false; SA only) — **Confirmed by code** |
| 22 | `admin.diagnostics` | ❌ | ❌ | ❔ | ❌ | ✅ | **m033** seeds sales/TLM/admin=false, SA=true; **Ops never seeded by m033** → only via mirror — **Needs owner confirmation** |

`*` = value for **operations** is **not** an explicit per-cell seed; it is copied
from `task_list_manager` by the mirror backfills in m042 / m053
(`on conflict do nothing`). Treated as **Assumed from code**; confirm against the
live DB.

> **❔ on `admin.diagnostics` / operations:** m033 (which created the capability)
> predates the m042/m053 operations mirrors and only inserted rows for
> `super_admin`, `admin`, `task_list_manager`, `sales`. The later mirrors copy
> TLM's `admin.diagnostics=false` into operations — **if they ran**. Whether the
> operations row actually exists in the live DB is **unconfirmed**.

### Enabled-capability count per role (per seed)

| Role | Enabled (reconstructed) | Notes |
|---|:---:|---|
| `super_admin` | 22 | Everything. **Confirmed by code.** |
| `admin` | 16 | All except the 4 super-admin-only (`*.delete`, `admin.manage_*`) plus gains `quotation.delete` (m055) and `forecast.view_global` (m053), `factory_mapping.access` (m064). **Assumed from code** (recomputed across migrations). |
| `task_list_manager` | 9 | Production work; no archive/override/admin/global-forecast; +`factory_mapping.access`. **Assumed from code.** |
| `operations` | ≈9 | Mirrors TLM. **Assumed from code; live-DB confirmation required.** |
| `sales` | 3 | `quotation.create`, `quotation.cancel`, and (post-m055) `quotation.delete`. **Assumed from code.** |

> Counts are **reconstructed by replaying the migrations in order**, not read from
> the live DB. m026's own header comment (written before m053/m055/m064) cites
> different numbers (SA 19 / admin 14 / TLM 10 / sales 2) — those are now stale.
> **Needs owner confirmation against live DB.**

---

## 2. Per-role detail

> Throughout: **Current behavior** = what the code does today; **Target** = Owner
> Decision (confirmed 2026-05-30), **not yet implemented**.

### 2.1 `sales`

- **Accessible pages (current):** dashboard, documents (quotations/proforma),
  clients, forecast (own deals only — `forecast.view_global=false`,
  `app/(app)/forecast/page.tsx`), business, order-follow-up (read).
  **Restricted:** `/admin/*` (redirect via `app/(app)/admin/layout.tsx`,
  `isAdminLike(effectiveRole)`), `/permissions/*`, `/factory-mapping`
  (`isTechnicalRole` / `factory_mapping.access=false`), `/operations`,
  `/production` management. **Assumed from code.**
- **Visible entities (current):** scoped by RLS to rows the user **owns**
  (`created_by = auth.uid()`) for documents/clients (m046, m058, m066). **Note:
  app-level visibility is NOT a security boundary today (Decision E).**
- **Allowed actions:** create quotation, cancel quotation, **delete own
  quotation any status** (m055 + RLS m057). **Confirmed by code.**
- **Restricted actions:** all task-list / production-order / admin / global
  forecast capabilities = denied. **Confirmed by code.**
- **Permission groups:**
  - admin: ❌ all (`admin.manage_*`, `admin.diagnostics`). **Confirmed.**
  - document: create ✅, cancel ✅. **Confirmed.**
  - quotation: create ✅ / cancel ✅ / archive ❌ / **delete ✅ (any status)**. **Potentially risky** vs Decision F.
  - task-list: all ❌. **Confirmed.**
  - production-order: all ❌. **Confirmed.**
  - shipping/BL: ❌ (`production_order.edit_shipment=false`). **Confirmed.**
  - pricing/discount: no dedicated capability key exists — pricing/discount is
    **not gated by the matrix** today (handled in document actions/UI).
    **Needs owner confirmation** (Decision H.2 wants approval tiers).
  - notification/message: no capability key; governed by RLS on
    `entity_messages` / `event_comments` (m049, m039). **Needs owner confirmation.**
  - delete/archive: delete ✅ (risky), archive ❌. **Mixed — see §4.**

### 2.2 `task_list_manager` (TLM)

- **Accessible pages (current):** dashboard, documents (technical scope),
  task-lists, production, operations, **`/factory-mapping`**
  (`factory_mapping.access=true`, m064 + `app/(app)/factory-mapping/page.tsx`),
  order-follow-up. **Restricted:** `/admin/*` (admin layout redirect — TLM is not
  `isAdminLike`), `/permissions/*`, global forecast. **Assumed from code.**
- **Visible entities:** production-scoped; broader read than sales on
  task-lists/production orders (technical role, m046). **Needs owner confirmation**
  on exact scope.
- **Allowed actions:** validate / reject / sync-orphan task lists; edit
  production-order status / deadline / payments / shipment / timeline; access
  factory mapping; create + cancel quotations. **Confirmed by code** (TLM cells),
  **gated also by** `requireTaskListManagerOrAdmin()`.
- **Restricted actions:** quotation archive/delete, task-list archive/delete,
  production-order archive/delete, `start_without_deposit`, all admin caps,
  `forecast.view_global`. **Confirmed by code.**
- **Permission groups:** admin ❌ · document create/cancel ✅ · quotation
  create/cancel ✅, archive/delete ❌ · task-list validate/reject/sync ✅,
  archive/delete ❌ · production-order edit_* ✅, archive/delete/override ❌ ·
  shipping/BL `edit_shipment` ✅ · pricing/discount — not matrix-gated
  (**Needs confirmation**) · notification/message — RLS only (**Needs
  confirmation**) · delete/archive ❌.

### 2.3 `operations` (Ops)

- **Identity:** storable role added in `m042`; **operationally identical to
  TLM** by design (`isTechnicalRole`, `requireTaskListManagerOrAdmin` both treat
  Ops = TLM). **Confirmed by code** (helpers).
- **Matrix:** **not seeded explicitly** — mirrors TLM via m042/m053 backfills
  (`on conflict do nothing`). So every Ops cell = the corresponding TLM cell,
  **assuming the backfill ran**. **Assumed from code; live-DB confirmation
  required** — including whether the `admin.diagnostics` row exists for Ops
  (m033 predates Ops; only the mirror would have added it).
- **Accessible pages / actions / groups:** **same as TLM (§2.2)**, with the
  above provenance caveat. `factory_mapping.access` and `forecast.view_global`
  ARE seeded explicitly for Ops (m064 = true, m053 = false). **Confirmed by code**
  for those two only.

### 2.4 `admin`

- **Accessible pages (current):** everything under `/admin/*`
  (`isAdminLike(effectiveRole)` passes — `app/(app)/admin/layout.tsx`) **except**
  the conditional **Diagnostics** tab (hidden unless `admin.diagnostics`, which
  is false for admin) and **except `/admin/permissions`** (gated by
  `admin.manage_permissions` in `app/(app)/permissions/layout.tsx` → admin
  redirected). Plus all non-admin pages. Global forecast ✅
  (`forecast.view_global=true`). **Assumed/Confirmed by code** as noted.
- **Visible entities:** broad (admin/technical RLS scope, m046). **Needs owner
  confirmation** on exact breadth.
- **Allowed actions:** all quotation (incl. **delete**, m055), all task-list
  except permanent `task_list.delete`, all production-order except permanent
  `production_order.delete`, `start_without_deposit`, factory mapping, global
  forecast. **Assumed from code** (recomputed across migrations).
- **Restricted actions:** `task_list.delete`, `production_order.delete`,
  `admin.manage_permissions`, `admin.manage_users`, `admin.diagnostics`
  (all super-admin-only). **Confirmed by code.**
- **Permission groups:** admin ❌ (manage/diagnostics) · document ✅ · quotation
  create/cancel/archive/**delete** ✅ · task-list validate/reject/sync/archive ✅,
  delete ❌ · production-order edit_*/archive/override ✅, delete ❌ · shipping/BL
  ✅ · pricing/discount — not matrix-gated (**Needs confirmation**) ·
  notification/message — RLS (**Needs confirmation**) · delete/archive: archive ✅,
  permanent deletes ❌ (except quotation, which it CAN delete via m055 — note the
  inconsistency).

### 2.5 `super_admin` (SA)

- **Identity:** virtual (`user_roles.super_admin=true`); only role that can use
  **View-As** and pass `requireSuperAdmin()`. **Confirmed by code.**
- **Accessible pages:** everything, including `/admin/permissions`
  (`admin.manage_permissions`), `/admin/users` (`admin.manage_users`),
  `/admin/diagnostics` (`admin.diagnostics`). **Confirmed by code.**
- **Allowed actions:** **all 22 capabilities = ✅**, including permanent deletes
  and matrix/user management. **Confirmed by code.**
- **Restricted actions:** none in the matrix. **Confirmed by code.**
- **Permission groups:** all ✅.

---

## 3. Owner Decisions (confirmed 2026-05-30) bearing on this matrix

> All TARGET behavior — **not yet implemented**. Source:
> `docs/audit-editable/OWNER_DECISIONS_LOG.md`.

- **Decision I (this document):** Do **not** ratify the seeded matrix yet; export
  it (done here) for review. No permission changed. After review → `/RULES.md`.
- **Decision F (delete/archive):** Deletion must be **restricted after a
  quotation is won**; won + linked task list/PO → deletion **blocked by default**
  (cancel/archive instead); archive must capture **archive reason, archived_by,
  archived_at, optional note**. → Conflicts with the current
  `quotation.delete`-any-status behavior (see §4, item A).
- **Decision E (visibility = security):** team/region/lens/ownership/role
  visibility must become **RLS-enforced**; current app-level filtering is an
  **interim** state only. → Every "visible entities" note above is app-level and
  **not** a security boundary yet.
- **Decision H.10 (`no_deposit_required`):** exceptional; sales **cannot** approve
  alone; manager/director/admin approval required. → Maps to
  `production_order.start_without_deposit` (admin/SA only today — consistent in
  direction, but the approval-trail/finance gate is **not implemented**).
- **Decision H.2 (discounts):** approval tiers (sales limit → manager → admin
  override). → **No matrix capability exists** for pricing/discount gating today.
- **Decision G (`shipping_details` key fix):** **approved, NOT applied.** Affects
  `production_order.edit_shipment` workflows / BL-missing alert; documented for
  awareness only.

---

## 4. Flagged risks (require explicit owner attention)

**A. `quotation.delete` allows delete regardless of status — conflicts with
Decision F. — Potentially risky.**
- **Current:** m055 grants `quotation.delete=true` to `sales` + `admin`; the
  server action `deleteQuotation` (`app/(app)/documents/[id]/actions.ts`, ~l.502)
  calls only `requireCapability("quotation.delete")` with **no status check**;
  RLS (m057, `app/(app)/documents/[id]/.../057_documents_delete_owner.sql`) is
  **explicitly status-agnostic** ("drafts, sent, negotiating, **won**, lost,
  cancelled are all deletable by their owner") and the FK cascade can delete a
  linked production order. A sales rep can therefore permanently delete a **won**
  quotation (and cascade its PO).
- **Target (Decision F):** won quotations must not be freely deleted; won + linked
  task list/PO → blocked; prefer cancel/archive. **Not yet implemented.**

**B. `action_acks` RLS is fully permissive — `using (true)` for all operations.
— Potentially risky.**
- `supabase/migrations/069_action_acknowledgements.sql`: `select/insert/update/
  delete` policies are all `to authenticated using (true) with check (true)`. Any
  authenticated user can read/insert/update/delete **any** acknowledgement,
  cross-team. Intentional as a "shared operational signal", but it is **not**
  scoped — confirm this is acceptable under Decision E. **Needs owner confirmation.**

**C. `/admin/*` sub-pages rely on the layout guard only. — Potentially risky.**
- `app/(app)/admin/layout.tsx` redirects non-`isAdminLike` users, but the
  sub-pages (`/admin/products`, `/admin/categories`, `/admin/components`,
  `/admin/banks`, `/admin/sales-conditions`, `/admin/factory-mapping`) have **no
  page-level role gate of their own** — they trust the layout. Their *server
  actions* do call guards (`requireAdmin`/`requireTaskListManagerOrAdmin`), so
  mutations are protected; but **read access to these admin pages depends solely
  on the layout**. By contrast `/admin/permissions`, `/admin/diagnostics`,
  `/factory-mapping`, and `/forecast` add their own capability gate. **Needs owner
  confirmation** that layout-only read-gating is acceptable.

**D. `admin.diagnostics` — the 22-vs-21 / operations seeding gap. — Needs owner
confirmation.**
- Catalog has 22 keys and 22 rows reconcile overall, **but** `operations` is never
  seeded by m026/m033 directly; its rows (incl. `admin.diagnostics`) exist **only**
  if the m042/m053 TLM-mirror backfills ran. The live presence of the operations
  `admin.diagnostics` row is **unverified** (shown ❔ in the master table).

**E. `production_order.unlock_baseline` referenced but not defined. — Needs owner
confirmation.**
- `lib/types.ts` (~l.610) names capability `production_order.unlock_baseline`,
  which is **absent from the `Capability` union and from every seed**. Likely a
  stale/aspirational reference. Confirm intent (add it, or remove the comment).

**F. App-level visibility is not a security boundary. — Potentially risky (per
Decision E).**
- All "visible entities" rows above describe **app-level** filtering. Decision E
  makes RLS the real boundary the **target**; today direct API/route access could
  over-return for roles whose UI merely hides data. **Not yet implemented.**

**G. `start_without_deposit` lacks the approval trail Decision H.10 requires. —
Needs owner confirmation.**
- Seeded to admin/SA only (direction matches), but no
  reason/approved_by/approved_at/finance-gate enforcement exists yet. **Not yet
  implemented.**

---

## 5. Verification checklist (for the live DB — NOT done here)

To turn "Assumed from code" rows into "Confirmed", run (read-only) against the
live DB and reconcile with this document:

```sql
-- Catalog size (expect 22)
select count(*) from permissions;

-- Full matrix, per role
select role, permission_key, enabled
  from role_permissions
 order by role, permission_key;

-- Enabled count per role
select role, count(*) filter (where enabled) as enabled_count
  from role_permissions group by role order by enabled_count desc;

-- Does operations exist at all, and does it mirror TLM?
select
  (select count(*) filter (where enabled) from role_permissions where role='operations') as ops_enabled,
  (select count(*) filter (where enabled) from role_permissions where role='task_list_manager') as tlm_enabled;

-- Is the operations admin.diagnostics row present?
select role, enabled from role_permissions
 where permission_key='admin.diagnostics' order by role;
```

> Until this is done and reviewed by the owner, **no value here is final** and
> **no permission is changed**. Per Decision I, the confirmed result then becomes
> part of `/RULES.md`.
