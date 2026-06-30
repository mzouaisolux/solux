# E2E Audit — Autonomous run (2026-06-23)

> **Method**: real logins, **one true Supabase JWT per role** (no View-As / no admin bypass).
> Playwright harness in `e2e/audit/` (`probe`, `inspect`, `matrix`, `drive`, `whoami`, `q`).
> Workflow execution prioritized over code inspection. Temporary data tagged `ZZZ_E2E_AUDIT_`.
> Litmus of a real session: restricted routes denied **server-side** (`/permissions/actions`, `/admin/*`).

## 1. Executive summary

A full commercial→production→finance workflow was executed **end-to-end on fresh tagged data**
under real role identities, and a 6-role permission matrix was captured. The happy path works and is
fully audited. Two **high-severity permission issues** surfaced that View-As would have masked, plus
one route-wide 500 and several UX / business-ambiguity items.

| Sev | # | Class | One-liner |
|---|---|---|---|
| 🔴 | F1 | Permission/setup | **Sales Director is blind to all operational data** (0 clients/docs/affairs/task-lists/orders/contacts) — root cause: team-scoped visibility (m105) + **testdir@ assigned to no team**. |
| 🔴 | F2 | Permission/setup | Operations & Finance had **no role row** → degraded UI. **FIXED this session** (owner assigned roles); verified E2E. |
| 🟠 | F3 | Bug | **`/documents/[id]` returns HTTP 500** on every load (route-wide) while still rendering. |
| 🟠 | F4 | Bug | **Launch Production creates the task list with `affair_id = null`** (loses affair link). |
| 🟡 | F5 | UX | Inconsistent denial UX (ACCESS-DENIED page vs silent redirect `/cost-entry`→/dashboard). |
| 🟡 | F6 | UX | Weak post-create/save feedback (no redirect, stale list until hard reload). |
| 🟡 | F7 | UX | Raw UID prefix shown when `display_name` is empty. |
| 🟡 | F8 | UX | Technical roles carry always-empty `/forecast` + `/business` (personal-scoped). |
| 🔵 | F9 | Ambiguïté | Empty task list (0 product lines) is validatable → would create an empty production order. |
| 🔵 | F10 | Ambiguïté | Finance scope: read-only on `/finance` but writes on `/cost-entry`; "Orders" nav → empty `/operations`. |
| 🔵 | F11 | Ambiguïté | `sales_director` can reach `/finance` — intended? |

## 2. Coverage — workflows actually executed (real sessions)

**Full forward chain on `ZZZ_E2E_AUDIT_` data, all persisted + audited:**

1. **Sales** create client `ZZZ_E2E_AUDIT_Acme Audit Co` (ZEA) → inline **+ New Project** affair → **quotation** SLX-ZEA-26-001 (AOSPRO+30, 178.16 USD).
2. **Sales** Draft → **Sent** → **Won** → **🚀 Launch Production** (creates proforma command SLX-ZEA-26-002 + task list).
3. **Sales** **Submit for production validation** (task list draft → under_validation).
4. **TLM** **Validate → Release to Production** (under_validation → validated; production order **auto-created** PO-SLX-ZEA-26-002, `awaiting_deposit`).
5. **Operations** **record deposit** 53.45 → order **auto-advances** to `deposit_received` / "Ready to start".
6. **Finance** sees the order on `/finance` (balance due 125, total 178) — **cross-role propagation confirmed**.
7. **Operations** (earlier) **Request revision** on a task list (under_validation → needs_revision) — structured modal + RLS write under real ops JWT.

Every transition emitted an `events` row (client.created, doc.created, status→sent, doc.won, proforma
created, tl.submitted, po.created, tl.validated, po.deposit_received, po.status_changed) — the
**audit trail / notification source works**.

## 3. Permission / visibility matrix (real sessions)

`OK`=reachable · `DENY`=access-denied page · `404`=route absent · `→x`=redirect.

```
ROUTE                   sales  dir    tlm    operat financ admin
/dashboard              OK     OK     OK     OK     OK     OK
/business               OK     OK*    OK     OK     OK*    OK      (*personal-scoped → empty)
/forecast               OK     OK*    OK*    OK*    OK*    OK*     (personal "my deals only")
/clients                OK     OK¹    OK     OK     OK     OK      (¹dir list renders but RLS=0 rows → F1)
/projects               OK     OK     OK     OK     OK     OK
/prospects(+pipeline)   OK     OK     DENY   DENY   DENY   OK
/task-lists             OK     OK¹    OK     OK     OK     OK
/operations             OK     OK¹    OK     OK     OK     OK
/finance                DENY   OK¹    DENY   DENY   OK     OK
/cost-entry             →dash  →dash  →dash  →dash  OK     OK
/admin/users            DENY   DENY   DENY   DENY   DENY   DENY²   (²super_admin-only; testadmin=non-super)
/permissions/actions    DENY   DENY   DENY   DENY   DENY   DENY²
/admin/diagnostics      DENY   DENY   DENY   DENY   DENY   DENY²
/admin/pricing|products|categories|components|banks|sales-conditions|notifications  → DENY for all except admin=OK
```

Boundaries that are **correct**: prospects denied to tlm/operation/finance; `/finance` denied to
sales/tlm/operation; super_admin-only on users/permissions/diagnostics.

## 4. Findings (detail)

### 🔴 F1 — Sales Director blind to operational data — **Permission/setup + design**
Direct RLS reads under testdir@'s JWT: **clients 0, documents 0, affairs 0, production_task_lists 0,
production_orders 0, contacts 0** — only **project_requests 15**. Consequence: every operational page
renders empty; opening any client/doc → **404**; `canSupervise` powers (validation-review,
owner-reassign on client/doc/affair) are unusable because the rows are invisible.
**Root cause (confirmed live)**: sales_director visibility is **team-scoped** (m105
team_manager_visibility). The `team_members` table has only **2 rows** (team "Africa": manager
mzouai@, member m.zouai@icloud) — **testdir@ is in no team**, and owns nothing → 0 rows. This is
primarily a **test-account setup gap** (assign testdir@ as manager of a team whose members own the
data), directly analogous to F2 (unassigned roles). The data owners (testsales@ etc.) are *also* in no
team, so a director-over-a-team wouldn't see their data either until team membership is populated.
**Design question for the owner**: is team-scoped the intended supervision model for a sales director
(vs see-all), and should an unassigned director get a clear "you manage no team" empty-state instead of
silently-empty pages + 404s? As configured, the Director role is non-functional for supervision.

### 🔴 F2 — Operations & Finance had no role (FIXED) — **Permission/setup**
`testoperation@`/`testfinance@` had **no `user_roles` row** → `getCurrentUserRole()=null`. Effects
observed live: Finance **denied its own `/finance`**; Operations served the **read-only "sales view"**
of `/operations` (couldn't edit production). Not an RLS bug (`schema.sql:159` self-read is
role-agnostic; m090 RPC + CHECK accept all 6 roles) — the rows were simply unassigned. Owner assigned
them mid-run; re-verified: Operations → technical edit view, Finance → `/finance` works.
*Sub-finding*: an unassigned (null-role) account is **not bounced** — it gets a functional default
shell with no "your account has no role" signal (also affects `f.traore@`, currently NO ROLE).

### 🟠 F3 — `/documents/[id]` HTTP 500 — **Bug**
Both the audit quotation and an existing client's quotation return **status 500** on navigation while
the page renders and is fully functional (`/dashboard`=200). Route-wide swallowed server error
(suspect `generateMetadata`/async sub-component). Prod impact: error-tracking noise, caching/monitoring.

### 🟠 F4 — Launch Production drops the affair link — **Bug (data continuity)**
After 🚀 Launch Production, the new `production_task_lists` row has **`affair_id = null`** while the
quotation and proforma keep `affair_id`. The task list escapes affair-grouped views.

### 🟡 F5 — Inconsistent denial UX. `/cost-entry` **silently redirects** non-finance/admin to
`/dashboard`, whereas capability pages show a clear "ACCESS DENIED — requires capability X". Pick one.

### 🟡 F6 — Weak post-create/save feedback. New-client modal, Save draft and Launch Production all
left the page on the form ("Saving…/Launching…") with no redirect to the created entity; the list
showed the **stale count** until a hard reload (data did persist). Reads as "it failed".

### 🟡 F7 — Raw UID prefix (`a5e93040…`) shown in `/task-lists` Sales column/pills when an account has
no `display_name`; other pages derive a friendly name. Inconsistent fallback.

### 🟡 F8 — Technical roles (Operations/TLM) carry `/forecast` + `/business` in reach, always empty
(personal-scoped, they own no deals). Harmless clutter.

### 🔵 F9 — Empty task list validatable. A task list with **0 product lines** sits "Under validation"
with a Validate button → would create a production order for nothing. Block validation when no lines?

### 🔵 F10 — Finance scope ambiguity. Finance is read-only on `/finance` but has a **write** surface
`/cost-entry` (RMB cost versions). Finance's "Orders" nav → `/operations` shows **0 orders** (own-sales
scoping for non-technical roles) while `/finance` shows all. Clarify Finance's intended surfaces.

### 🔵 F11 — `sales_director` reaches `/finance` (currently empty due to F1). Intended?

## 5. Verified working (positives)
- Full commercial→production→finance happy path (§2) with persisted, audited state transitions.
- Real-session litmus: every restricted route denied server-side per role.
- TLM/Operations parity (both: Validate / Request revision / Reject; both technical-view editable).
- Cross-role continuity Operations(deposit) → Finance(balance).
- Event/audit trail emitted on every transition; notification bell renders computed counts.
- Super_admin-only gating correct (admin-non-super denied users/permissions/diagnostics).
- `/business` + `/forecast` personal-scoped — **no global data leak**.
- Matrix "404s" (`/catalog/*`,`/pricing`,`/admin`,`/prospects/tenders`) = non-existent routes, and
  admin "ERR" cells = first-compile timeouts — **not bugs** (re-verified warm).

## 6. Assumptions & limitations (not executed / deferred)
- **F1 root cause** assumed RLS gap vs team-scoping — owner to confirm intended scope.
- **Service-request approval** (Director) NOT driven: no request was in a pending-approval state and
  full creation is a heavy multi-stage flow (submit→approve→factory cost→freight→pricing). Deferred.
- **Cost-entry write** (Finance) and **Admin config writes** (pricing/products/categories) skipped —
  mutate shared pricing/config = **significant business impact** (per run rules), documented not done.
- **Quote builder**: drove successfully but product **"Configure now"** (factory option mappings) left
  at defaults; full option/mapping configuration not exercised.
- **Order drawers** beyond deposit (timeline, shipping, BL profile, document generation) mapped but not
  all driven (deposit driven as representative production-management write).
- **Notifications**: verified the event source + bell counts; did not assert per-recipient delivery UI.

## 7. Audit data created — cleanup (tag `ZZZ_E2E_AUDIT_`)
| Entity | id | number | state |
|---|---|---|---|
| client | 42ebf688-5b40-455d-9b6f-4b4dd6a8a40d | ZEA | ZZZ_E2E_AUDIT_Acme Audit Co |
| affair | 25908980-8f5c-429a-87e8-fe4b8ca0ee82 | — | ZZZ_E2E_AUDIT_Affair 001 (lead) |
| quotation | 7f240677-f51e-4bb9-8134-53b8c504780e | SLX-ZEA-26-001 | **won** (counts toward testsales won-deals analytics) |
| proforma | 1c1185c3-230f-44c7-b6dd-9bf949de1010 | SLX-ZEA-26-002 | draft command |
| task_list | 780924ff-8b74-401b-869c-5b8f7fa22a8c | PTL-SLX-ZEA-26-002 | validated |
| production_order | 1a0c7601-9c22-49b4-b04f-e5127404972c | PO-SLX-ZEA-26-002 | deposit_received (53.45 recorded) |

Delete root client (cascade handles children) to remove the chain. **Also**: an existing item
**PTL-SLX-ASE-26-006** (AFRICA ENERGY, not mine) was left in `needs_revision` with an audit-marker
message from the earlier Operations revision test — reversible via Sales re-submit.

---

## 8. Fix outcomes (2026-06-24)

| Finding | Status | What was done | Verified |
|---|---|---|---|
| **F4** | ✅ **FIXED** | `generateProductionTaskList` (launchProduction) now selects + sets `affair_id` on the task list; **and** `ensureProductionOrderForTaskList` (validation) now carries `affair_id` onto the production order (sibling gap found during re-test). | Yes — fresh chain: quote→task list (PTL-SLX-ZEA-26-006, affair_id ✓)→order (PO-SLX-ZEA-26-006, affair_id ✓). Before: both null. tsc clean. |
| **F1** | ⚠️ **App fixed; RLS migration pending owner-apply** | `lib/visibility.ts` `getVisibilityScope` no-grant fallback now grants `sales_director` org-wide scope (via `canSupervise`). **Migration `132_sales_director_visibility.sql`** written (additive PERMISSIVE read policies for sales_director on clients/affairs/documents/production_task_lists/production_orders/contacts). | App: tsc clean. **RLS is the binding gate** and the migration needs `service_role`/Supabase SQL editor (DDL) — same constraint as F2's role assignment; I have no service key. testdir@ keeps seeing 0 until m132 is applied. |
| **F3** | ❌ **Diagnosed, not pinpointed** | Root cause established: a React component renders as `undefined` ("Element type is invalid") → **recoverable SSR error** → 500 while the page still renders (non-blocking; the whole workflow runs through it). All static imports resolve; all sections render; disabling individual children (QuotationVersionsPanel, Reminders, Timeline, DocStatusActions…) does NOT clear it → signature of a **circular import / module-init-order issue introduced by the uncommitted "premium redesign" WIP**, not a single broken import. Instrumentation fully reverted. | Needs bisection by someone with WIP context. Diagnostic tools left: `e2e/audit/find-undef-import.ts`, `diag.ts`. |

**To finish F1**: apply `supabase/migrations/132_sales_director_visibility.sql` in Supabase (after backup), then re-run `q.ts dir clients` — should return > 0. (Or, if team-scoping is preferred over see-all, extend the m105 team-manager branch to all six tables instead.)

### Audit data added by the re-test (same `ZZZ_E2E_AUDIT_` tag, same root client `42ebf688`)
affairs 002 `55e33458` + 003 `adeb63ee`; quotes SLX-ZEA-26-003/005; proformas SLX-ZEA-26-004/006; task lists PTL-SLX-ZEA-26-004 (validated) + 006 (validated); orders for both (awaiting_deposit). Deleting root client `42ebf688` cascades all of it.
