# Role & Permission Decisions Needed — Owner Confirmation

> **Purpose.** A focused checklist of the **permission decisions still open**, drawn
> from [`docs/CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md) and
> [`docs/audit-editable/OWNER_DECISIONS_LOG.md`](./audit-editable/OWNER_DECISIONS_LOG.md).
> Only items that **need an owner decision** are listed — already-settled permissions are omitted.
>
> **Status / safety:**
> - **Documentation only. No permission is changed. No application code is modified.**
> - The capability values below are **reconstructed from seed migrations** (m026/033/042/053/055/064),
>   **not read from the live database**. A super-admin may have edited the matrix via `/admin/permissions`,
>   so several items also need a **live-DB read** to confirm (flagged as such).
> - Owner decisions referenced (A–I) are **target behavior, not yet implemented**.
>
> **How to use.** Fill in the `▢ Owner decision:` line under each item. Once answered, we update
> `CAPABILITY_MATRIX.md`, promote the result into `/RULES.md`, and only then plan any code change.
>
> **Legend:** each item notes **Current behavior**, **Conflict with owner decisions**,
> **Recommended target behavior**, and **Code change needed later?** A rough **Priority** is given to help triage.

---

## 1. Sales permissions

### 1.1 — Sales can delete a *won* quotation (any status) · Priority: **High**
- **Current behavior:** `quotation.delete = true` for `sales` (migration m055). The action `deleteQuotation` (`app/(app)/documents/[id]/actions.ts`, ~l.502) checks only `requireCapability("quotation.delete")` with **no status check**; RLS (m057) is explicitly status-agnostic and a FK cascade can also remove the linked production order. → full detail in **§7.1**.
- **Conflict with owner decisions:** **Yes — Decision F** (no free deletion after "won"; block if downstream task list/PO exists).
- **Recommended target behavior:** Sales may delete only `draft` (and `sent`/`negotiating` if no downstream). Won quotations: not deletable by sales → cancel/archive.
- **Code change needed later?** **Yes** (status guard in the action + RLS).
- ▢ **Owner decision:** ______________________

### 1.2 — Sales pricing & discount authority is ungated · Priority: **High**
- **Current behavior:** There is **no pricing or discount capability key**; pricing/discounts are handled in document actions/UI and are **not gated by the permission matrix**. A sales user can set any price/discount with no approval. → see **§6**.
- **Conflict with owner decisions:** **Yes — Decision H.2** (discount approval tiers + margin warning) and **H.1** (controlled override).
- **Recommended target behavior:** Define a sales discount ceiling; discounts above it require manager/director approval; below-margin prices are blocked or require approval.
- **Code change needed later?** **Yes** (new capability/limit + approval flow + UI).
- ▢ **Owner decision:** ______________________

### 1.3 — Sales visibility is app-level "own rows" only · Priority: **Medium**
- **Current behavior:** Sales see only rows they own (`created_by`), but the filtering is **app-level**, not a database security boundary. → see **§8.1**.
- **Conflict with owner decisions:** **Yes — Decision E** (visibility must become RLS-enforced).
- **Recommended target behavior:** Confirm sales = own clients/deals only, and make it RLS-enforced (progressively).
- **Code change needed later?** **Yes** (RLS policies).
- ▢ **Owner decision:** ______________________

---

## 2. Task List Manager (TLM) permissions

### 2.1 — TLM holds the full production-order edit set · Priority: **Medium**
- **Current behavior:** TLM has validate/reject/sync task lists **and** all production-order edits (status, deadline, payments, shipment, timeline) + factory mapping (m026/m064; also gated by `requireTaskListManagerOrAdmin()`). ~9 capabilities enabled.
- **Conflict with owner decisions:** None directly — but it overlaps heavily with Operations (see §3.1).
- **Recommended target behavior:** Confirm whether TLM *should* perform all production-order edits, or whether some (e.g. payments, shipment) belong to Operations only.
- **Code change needed later?** **Only if** you choose to split TLM vs Ops responsibilities.
- ▢ **Owner decision:** ______________________

### 2.2 — TLM visible scope is assumed, not confirmed · Priority: **Medium**
- **Current behavior:** TLM gets a broad technical read scope (m046), exact breadth **assumed from code**.
- **Conflict with owner decisions:** Tied to **Decision E** (app-level → RLS).
- **Recommended target behavior:** Confirm exactly what TLM may see (all task lists/orders? all clients?) and enforce via RLS.
- **Code change needed later?** **Yes** if scope is tightened/RLS-enforced.
- ▢ **Owner decision:** ______________________

---

## 3. Operations permissions

### 3.1 — Operations is a *copy of* TLM (should it be?) · Priority: **High**
- **Current behavior:** `operations` is **not seeded explicitly** — its matrix rows are **mirror-copied from TLM** by backfills (m042/m053, `on conflict do nothing`). By design `isTechnicalRole` / `requireTaskListManagerOrAdmin` treat Ops = TLM. Only `factory_mapping.access` (m064=true) and `forecast.view_global` (m053=false) are set explicitly for Ops.
- **Conflict with owner decisions:** None stated — but this is the long-standing open question of TLM vs Ops responsibility split.
- **Recommended target behavior:** Decide: keep Ops = TLM (identical), **or** split duties (e.g. Ops owns payments/shipment/timeline; TLM owns validation). If split, seed Ops explicitly instead of mirroring.
- **Code change needed later?** **Yes if** you split them (explicit seed + possibly new guards).
- ▢ **Owner decision:** ______________________

### 3.2 — Are Operations' permission rows actually present in the live DB? · Priority: **Medium**
- **Current behavior:** Because Ops rows exist only via the mirror backfills, their live presence is **unverified** — especially `admin.diagnostics` for Ops (the capability was created in m033 *before* Ops existed; shown `❔ unknown` in the matrix).
- **Conflict with owner decisions:** None — this is a verification gap.
- **Recommended target behavior:** Read the live `role_permissions` to confirm Ops has the expected rows; then mark them Confirmed.
- **Code change needed later?** **No** — needs a **read-only live-DB check**, not a code change.
- ▢ **Owner decision:** ______________________

---

## 4. Admin permissions

### 4.1 — Admin can delete quotations but nothing else permanent (inconsistent) · Priority: **High**
- **Current behavior:** Admin has `quotation.delete = true` (m055) but is **denied** `task_list.delete` and `production_order.delete` (super-admin only). So admin can permanently delete a quotation — including a **won** one, cascading to its PO — yet cannot delete the PO directly.
- **Conflict with owner decisions:** **Yes — Decision F** (won quotations not freely deletable; prefer cancel/archive).
- **Recommended target behavior:** Align admin quotation deletion with F (block on won/with-downstream; allow only the no-task-list case, audited). Confirm admin keeps **no** permanent task-list/PO delete.
- **Code change needed later?** **Yes** (status guard).
- ▢ **Owner decision:** ______________________

### 4.2 — Admin catalog sub-pages are read-gated by the layout only · Priority: **Medium**
- **Current behavior:** `/admin/products`, `/admin/categories`, `/admin/components`, `/admin/banks`, `/admin/sales-conditions`, `/admin/factory-mapping` have **no page-level role guard** — they trust `app/(app)/admin/layout.tsx`. Their *server actions* are still guarded, so mutations are safe; only **read access** depends on the layout. → see **§8.3**.
- **Conflict with owner decisions:** Indirect — **Decision E** (defense-in-depth / real boundaries).
- **Recommended target behavior:** Confirm whether layout-only read-gating is acceptable, or add an in-body `requireAdmin()`/capability check to each sub-page.
- **Code change needed later?** **Yes if** you want page-level guards added.
- ▢ **Owner decision:** ______________________

### 4.3 — Dangling capability `production_order.unlock_baseline` · Priority: **Medium**
- **Current behavior:** `lib/types.ts` (~l.610) references a capability `production_order.unlock_baseline` that is **not in the `Capability` union and not seeded anywhere**. It does nothing today.
- **Conflict with owner decisions:** None — but baseline-unlock is an override-level power (admin/super-admin territory, like `start_without_deposit`).
- **Recommended target behavior:** Decide: (a) make it a real capability granted to admin/super-admin, or (b) remove the stale reference.
- **Code change needed later?** **Yes** (add capability + seed, or delete the reference).
- ▢ **Owner decision:** ______________________

### 4.4 — `start_without_deposit` has no approval trail · Priority: **High**
- **Current behavior:** `production_order.start_without_deposit` is enabled for **admin / super-admin only** (direction matches policy), but there is **no** reason/approved-by/approved-at/finance-gate enforcement.
- **Conflict with owner decisions:** **Partial — Decision H.10** (exceptional; requires authorization + audit trail). Direction OK; controls missing.
- **Recommended target behavior:** Keep admin/super-admin-only, and add the required approval + audit fields (reason, approved_by/at, guarantee, comment) and a visible "no-deposit exception" flag.
- **Code change needed later?** **Yes** (audit fields + UI + possibly finance approval).
- ▢ **Owner decision:** ______________________

---

## 5. Super Admin permissions

### 5.1 — Confirm super-admin-only powers stay super-admin-only · Priority: **Low (confirmation only)**
- **Current behavior:** Super-admin has **all 22 capabilities**, including permanent deletes (`task_list.delete`, `production_order.delete`), `admin.manage_permissions`, `admin.manage_users`, `admin.diagnostics`, and is the only role that can use **View-As**.
- **Conflict with owner decisions:** None — consistent with the existing "physical delete = super-admin only" rule.
- **Recommended target behavior:** Confirm this stays the final policy: physical deletes and permission/user management remain super-admin-only.
- **Code change needed later?** **No** (confirmation only).
- ▢ **Owner decision:** ______________________

### 5.2 — View-As keeps real privileges (testing caveat) · Priority: **Low (process)**
- **Current behavior:** During View-As, a super-admin sees another role's UI but **keeps real privileges on actions** (security uses the REAL role).
- **Conflict with owner decisions:** Tied to **Decision E** ("test with real accounts, not View-As").
- **Recommended target behavior:** Confirm the rule: never use View-As to validate role-level access; use real accounts of each role.
- **Code change needed later?** **No** (process/documentation rule).
- ▢ **Owner decision:** ______________________

---

## 6. Pricing / discount — missing permissions

### 6.1 — No pricing capability exists (price lists, overrides) · Priority: **High**
- **Current behavior:** Pricing is **not represented in the permission matrix** at all. No capability controls who selects a price list or overrides a price.
- **Conflict with owner decisions:** **Yes — Decision H.1** (catalogue/price-list pricing; assignment by manager; traceable override).
- **Recommended target behavior:** Introduce pricing capabilities, e.g. *assign price list* (manager/director), *override line price* (with audit), and the default-price-list assignment model.
- **Code change needed later?** **Yes** (new capabilities + price-list model + override audit — large).
- ▢ **Owner decision:** ______________________

### 6.2 — No discount capability / approval tiers · Priority: **High**
- **Current behavior:** Discounts are ungated; any user editing a quotation can apply any discount, with no approval and no margin guard.
- **Conflict with owner decisions:** **Yes — Decision H.2** (sales limit → manager → admin override; margin warning).
- **Recommended target behavior:** Add discount-approval capabilities/limits per role and a below-minimum-margin block or approval requirement.
- **Code change needed later?** **Yes** (capabilities + approval flow + margin logic + UI).
- ▢ **Owner decision:** ______________________

---

## 7. Delete / archive permissions

### 7.1 — `quotation.delete` ignores status and cascades to production · Priority: **High (most important)**
- **Current behavior:** `quotation.delete = true` for `sales` + `admin` (m055). `deleteQuotation` (`app/(app)/documents/[id]/actions.ts` ~l.502) does a capability check **only — no status check**. RLS m057 is explicitly status-agnostic ("draft, sent, negotiating, **won**, lost, cancelled all deletable by owner"), and the FK cascade can delete a **linked production order**. So a won deal — possibly already in production — can be permanently destroyed.
- **Conflict with owner decisions:** **Yes — Decision F** (deletion restricted after won; blocked if a task list/PO exists; cancel/archive instead; no silent cascade).
- **Recommended target behavior:** Draft → deletable; sent/negotiating → deletable only if no downstream; **won → not freely deletable**; won + linked task list/PO → **blocked** (use cancel/archive); won + no task list → admin/super-admin only, strong confirmation, audited; never silently cascade-delete production data.
- **Code change needed later?** **Yes** (status checks in the action **and** in RLS; remove/guard the cascade).
- ▢ **Owner decision:** ______________________

### 7.2 — Archive has no reason / audit metadata · Priority: **High**
- **Current behavior:** Soft-archive exists (`archived_at`, m024/m031), but there is **no archive reason / archived_by / note** captured, and archive is not the enforced alternative to deletion.
- **Conflict with owner decisions:** **Yes — Decision F** (archive must store reason, archived_by, archived_at, optional note; archived records searchable and visually separated).
- **Recommended target behavior:** Make archive (not delete) the standard path for committed records; require an archive reason and capture the audit fields; keep archived records searchable but out of active dashboards by default.
- **Code change needed later?** **Yes** (schema fields + UI + filters).
- ▢ **Owner decision:** ______________________

### 7.3 — Permanent deletes are super-admin only (confirm) · Priority: **Low (confirmation only)**
- **Current behavior:** `task_list.delete` and `production_order.delete` are denied to everyone except super-admin.
- **Conflict with owner decisions:** None — consistent with Decision F's "cancel/archive, not destructive deletion".
- **Recommended target behavior:** Confirm this remains the policy.
- **Code change needed later?** **No** (confirmation only).
- ▢ **Owner decision:** ______________________

---

## 8. RLS / visibility security concerns

### 8.1 — Visibility is enforced in app code, not the database · Priority: **High**
- **Current behavior:** Team/region/lens/ownership/role filtering is **app-level only** (lib/visibility.ts). A direct API/route/RPC call could return more than the UI shows. Capabilities + base RLS isolation are the only real controls today.
- **Conflict with owner decisions:** **Yes — Decision E** (visibility must become a real RLS-enforced boundary; app-level is interim only).
- **Recommended target behavior:** Push team/region/lens/ownership predicates into RLS **progressively**, tested with **real accounts** (not View-As). Document app-level filtering as interim UX only.
- **Code change needed later?** **Yes** (RLS policies, staged + tested).
- ▢ **Owner decision:** ______________________

### 8.2 — `action_acks` is fully open to any authenticated user · Priority: **Medium**
- **Current behavior:** `action_acks` RLS (m069) is `using (true) with check (true)` for select/insert/update/delete — **any** logged-in user can read/insert/update/delete **anyone's** Action-Center acknowledgements, across teams. Intentional as a "shared operational signal," but unscoped.
- **Conflict with owner decisions:** Indirect — **Decision E** (real boundaries).
- **Recommended target behavior:** Confirm this is acceptable as a shared signal, **or** scope it (e.g. by team/visibility).
- **Code change needed later?** **Yes if** you choose to scope it.
- ▢ **Owner decision:** ______________________

### 8.3 — Admin sub-pages depend on the layout guard for read access · Priority: **Medium**
- **Current behavior:** See §4.2 — catalog admin sub-pages have no in-body guard; read access relies solely on `app/(app)/admin/layout.tsx`. (Server actions are still guarded.)
- **Conflict with owner decisions:** Indirect — defense-in-depth under **Decision E**.
- **Recommended target behavior:** Decide whether to add page-level guards as cheap insurance.
- **Code change needed later?** **Yes if** guards are added.
- ▢ **Owner decision:** ______________________

### 8.4 — Whole matrix needs a live-DB confirmation · Priority: **Medium**
- **Current behavior:** Every "Assumed from code" row (and the Ops mirror, §3.2) is reconstructed from migrations; the live `role_permissions` was never read. A super-admin may have changed it via `/admin/permissions`.
- **Conflict with owner decisions:** None — verification gap.
- **Recommended target behavior:** Run the read-only checklist in `CAPABILITY_MATRIX.md` §5 against the live DB and reconcile.
- **Code change needed later?** **No** — **read-only live-DB query**, then update the matrix.
- ▢ **Owner decision:** ______________________

---

## Quick index of open decisions

| # | Item | Group | Conflicts decision | Code change later |
|---|------|-------|--------------------|-------------------|
| 1.1 | Sales delete won quotation | Sales | F | Yes |
| 1.2 | Sales discount authority ungated | Sales | H.1/H.2 | Yes |
| 1.3 | Sales visibility app-level only | Sales | E | Yes |
| 2.1 | TLM full production edit set | TLM | — | If split |
| 2.2 | TLM visible scope unconfirmed | TLM | E | Maybe |
| 3.1 | Operations = copy of TLM? | Ops | — | If split |
| 3.2 | Ops rows exist in live DB? | Ops | — | No (DB read) |
| 4.1 | Admin delete-quotation inconsistency | Admin | F | Yes |
| 4.2 | Admin sub-pages layout-only read | Admin | E (indirect) | If guarded |
| 4.3 | `unlock_baseline` dangling capability | Admin | — | Yes |
| 4.4 | `start_without_deposit` no approval trail | Admin | H.10 | Yes |
| 5.1 | SA-only powers stay SA-only | Super Admin | — | No |
| 5.2 | View-As keeps real privileges | Super Admin | E | No |
| 6.1 | No pricing capability | Pricing | H.1 | Yes |
| 6.2 | No discount capability/tiers | Pricing | H.2 | Yes |
| 7.1 | quotation.delete ignores status + cascade | Delete/Archive | F | Yes |
| 7.2 | Archive has no reason/audit | Delete/Archive | F | Yes |
| 7.3 | Permanent deletes SA-only (confirm) | Delete/Archive | — | No |
| 8.1 | Visibility not RLS-enforced | RLS/Visibility | E | Yes |
| 8.2 | `action_acks` fully open | RLS/Visibility | E (indirect) | If scoped |
| 8.3 | Admin sub-pages read-gating | RLS/Visibility | E (indirect) | If guarded |
| 8.4 | Matrix needs live-DB confirmation | RLS/Visibility | — | No (DB read) |

> Nothing in this file changes permissions or code. Fill in the `▢ Owner decision:` lines;
> once settled, the confirmed answers update `CAPABILITY_MATRIX.md` and feed `/RULES.md`.
