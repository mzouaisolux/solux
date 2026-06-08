# SOLUX — Project Status Report

> Read-only status audit of the app vs the **May-30 documentation package** (`docs/audit-editable/`).
> **No code was changed to produce this.** Date: 2026-06-02. Method: 3 read-only reviewers cross-checked
> against current code + migrations + `OWNER_DECISIONS_LOG.md`. (One reviewer discrepancy reconciled: the
> BL `blIsFilled` forwarder/vessel fix **is** shipped — confirmed in code — so any doc still calling it a
> live bug is now *historical*.)

---

## 1–3. Documentation accuracy vs current code (per document)
No document is **wholesale** outdated — staleness is section-level. 9 are accurate; 7 are partially
outdated where shipped changes overtook them.

| Document | Verdict | What moved (sections now stale) |
|---|---|---|
| `README.md` | ✅ Accurate | — |
| `APP_OVERVIEW.md` | 🟡 Mostly accurate | The "BL key mismatch" note is now historical (fix shipped). |
| `DATABASE_MODEL.md` | ✅ Accurate | Migrations m070–m077 cited correctly (m077/m078 still PENDING apply). |
| `MODULES_AND_PAGES.md` | ✅ Accurate | Routes/gating unchanged. |
| `ORDER_LIFECYCLE.md` | ✅ Accurate | Status-guard work refined, didn't contradict it. |
| `USER_ROLES_AND_PERMISSIONS.md` | ✅ Accurate | Matrix/enforcement unchanged. |
| `OWNER_DECISIONS_LOG.md` | ✅ Accurate | It records *intent*; still valid (see §6). |
| `QUESTIONS_FOR_ME.md` | ✅ Accurate | Inputs to the decisions log; mostly still open. |
| `CAPABILITY_MATRIX.md` | ✅ Accurate | Seeds unchanged; ratification still pending. |
| `DRAFT_AND_EDITING_RULES.md` | 🟠 Partially outdated | §"Deleting quotations" — deletion is **no longer status-agnostic** (lockdown shipped); a status-machine-guards section is now **missing** (won-revert/reopen guards shipped). |
| `NOTIFICATIONS_AND_MESSAGES.md` | 🟠 Partially outdated | Bell "only fires on unread comments" is **false now** (fires on high/critical/actionable-medium event creation + unread entity_messages). BL action-kind key note + the §8 trigger table are stale. |
| `SHIPPING_AND_BL.md` | 🟠 Partially outdated | The whole "BL key mismatch bug" section + code snippet are now historical (fixed). `FreightType` now includes `40ft`. Consignee/Notify now surface on the PO page. |
| `PROBLEMS_AND_INCONSISTENCIES.md` | 🟠 Partially outdated | Items now **fixed**: BL key mismatch; bell-doesn't-fire-on-event-creation; sales-can-delete-won; won→draft revert. |
| `BUSINESS_RULES.md` | 🟠 Partially outdated | BL-bug rule + "bell only on comments" rule are now historical/satisfied. |
| `ROLE_PERMISSION_DECISIONS_NEEDED.md` | 🟠 Partially outdated | "Sales can delete a won quotation" is now **partially resolved** (delete lockdown). |
| `RULES_DRAFT_EDITABLE.md` | 🟠 Partially outdated | Inherits the deletion / bell / BL staleness from its source docs. |

**Completely outdated:** none. The four most-affected (to refresh first): `NOTIFICATIONS_AND_MESSAGES`,
`SHIPPING_AND_BL`, `DRAFT_AND_EDITING_RULES`, `PROBLEMS_AND_INCONSISTENCIES`.

---

## 4. Implemented since the May-30 audit (all verified in code)
**Operational stabilization (4 batches):**
- **BL "missing" card fix** — `lib/action-center.ts` `blIsFilled` reads `forwarder`/`vessel`; self-clears (Decision G). ✅
- **Quotation deletion lockdown** — `deleteQuotation` blocks delete when a task list/PO exists; won-delete admin-only; UI gated. Migration **m078 PENDING apply**. ✅ (code)
- **Status-machine guards (H1/H2/H3)** — `updateDocumentStatus` blocks won→draft/sent revert + reopen-after-cancel; `DocStatusActions` confirms the cancel/lost cascade. ✅
- **Batch 1 (8 fixes):** PERM-2 (matrix self-lockout), PERM-3 (route 404→`/permissions/actions`), PERM-1 (`duplicateDocument` now gated + audited), M6 (`setProductionTimeline` enforces baseline lock), SHIP-1 (Consignee/Notify on PO page), SHIP-2 (BL save emits an event), SHIP-7 (`FreightType` +`40ft`), NOTIF-1 (review bell deep-link). ✅

**Notifications/comms (H7 + H8):** bell is now an operational **inbox** (event creation by severity, Decision D) + unread **project/order notes** (`entity_messages`, Decision C); Action Center card notes unified onto the canonical conversation. ✅

**Affairs module:** `affairs` table (**m076 APPLIED**) + writable `/affairs` workspace (create/assign/new-quote-in-project). Owner **paused** further expansion. m077 (affair status) PENDING. ✅

**Docs produced:** `LIFECYCLE_AUDIT.md`, `OPERATIONAL_STABILIZATION_ROADMAP.md`, `AFFAIRS_AND_DOCUMENTS_MODEL.md`, `CAPABILITY_MATRIX.md`, `ROLE_PERMISSION_DECISIONS_NEEDED.md`.

> ⚠️ The stabilization + H7/H8 code is `tsc`-clean but **not yet browser-tested by the owner**, and
> **m077 + m078 are not yet applied**.

## 5. Remaining — not implemented
- **Completion consistency (H5/H6 + M4/M5):** decided (status-led auto-stamp) but **not built** — `getLifecyclePhase` still keys completion only on `actual_completion_date`; post-production statuses aren't auto-stamped → false "production late" + re-offered "Mark complete" on shipped/delivered.
- **Deposit-without-deposit authorization (H4 / H.10):** `reason` still optional, no guarantee/approver capture — **decision still open**.
- **Pricing maturity (H.1, H.2, H.4–H.9):** price-list assignment, traceable overrides, discount approval/margin floors, currency conversion metadata, 2-dp rounding/reconciliation, offer validity, warranty-by-product — mostly **not built** (calc helpers exist). *Deferred workstream.*
- **Security — visibility → RLS (Decision E):** access-grant scaffold (m067) exists but enforcement is still **app-level**, not RLS.
- **Shipping/BL data model (SHIP-3/4/5):** structured shipping marks, actual container/seal numbers, canonical BL-instructions field — not built.
- **Notification durability (M16/M17):** audit-critical events still best-effort; reopen/TL-line events not emitted.
- **Archive-with-reason for documents (Decision F):** no `archive_reason` column on `documents` (affairs has one).
- **Affairs deep rollout (P3–P5):** mandatory-project workflow, affair-aware RLS — deferred to the Lead Manager design.
- **Commission + forecasting:** explicitly deferred.
- **`/admin/permissions`:** empty placeholder (real page is `/permissions/actions`).

## 6. OWNER_DECISIONS_LOG — shipped vs pending
| Decision | Rule (short) | Status |
|---|---|---|
| **B** | Won = revise-only / new version | ✅ Shipped |
| **C** | `entity_messages` = canonical conversation | ✅ Shipped |
| **D** | Bell fires on high/critical event creation | ✅ Shipped |
| **G** | BL forwarder sufficient (card self-clears) | ✅ Shipped |
| **H.3** | Tax-free export pricing | ✅ Effectively (no VAT logic) |
| **A** | TL not auto-created on Won, but mandatory + alerted | 🟡 Partial (Action-Center card; "mandatory" not hard-enforced) |
| **F** | Restrict delete after won + archive needs reason | 🟡 Partial (delete lockdown shipped, **m078 pending**; doc archive_reason not built) |
| **I** | Capability matrix for owner review | 🟡 Generated; **ratification pending** |
| **H.10/H.14** | No-deposit = exceptional + authorized | 🟡 Partial (override UX + columns; mandatory reason/guarantee/approval not enforced) — **policy still open (H4)** |
| **E** | Visibility must move to RLS | 🔴 Pending (app-level today) |
| **H.1/H.2/H.4–H.9** | Price lists, overrides, discounts, currency, rounding, validity, warranty | 🔴 Pending (deferred) |
| **"Production complete"** | Status-led, auto-stamp `actual_completion_date` | 🟢 **Decided, build queued (next)** |

**Still-pending decisions:** H4 (deposit-override strictness), Decision I ratification, the ~22 open items
in `ROLE_PERMISSION_DECISIONS_NEEDED.md`, the pricing-policy specifics for when that workstream starts, and
the remaining `QUESTIONS_FOR_ME.md` items.

---

## A. Completion estimate
Honest breakdown (weight × maturity) rather than one number:

| Area | Maturity | Notes |
|---|---|---|
| Core lifecycle (quote→order→production→shipping) | ~85% | Functional + recently hardened; completion-consistency (H5/H6) is the open gap |
| Notifications / Action Center | ~85% | Inbox + notes shipped; durability (M16/M17) partial |
| Roles / permissions | ~75% | Works app-level; RLS (Decision E) pending; matrix unratified |
| Shipping / BL | ~65% | Consignee/Notify + BL event shipped; marks/containers/canonical notes pending |
| Affairs | ~50% | Container shipped; deep rollout paused |
| Security (RLS visibility) | ~40% | Scaffold only |
| Pricing / commission / forecasting | ~30% | Calc exists; traceability/approvals/validity/warranty pending |

**Headline: ~65% of the full envisioned product; ~80% of the operational MVP core.** The remaining 35% is
concentrated in pricing maturity, RLS security, and the deferred Affairs/commission/forecasting scope.

## B. Remaining major workstreams
1. **Lifecycle completion consistency** (H5/H6/M4/M5 — decided) + PO state-machine (M2).
2. **Payment authorization & reminders** (H4/H.10 deposit override; H.7 balance reminders).
3. **Pricing maturity** (H.1/H.2/H.4/H.5/H.6/H.8/H.9).
4. **Security: visibility → RLS** (Decision E).
5. **Shipping/BL data model** (SHIP-3/4/5).
6. **Notification durability** (M16/M17).
7. **Governance:** ratify capability matrix (I) + close role/permission decisions (incl. M18 operations RLS).
8. **Documentation refresh** (sync the 4 stale docs; then promote `RULES_DRAFT_EDITABLE` → `RULES.md`).
9. **Apply pending migrations** (m078 delete lockdown, m077 affair status).
10. *Deferred:* Affairs P3–P5, commission, forecasting.

## C. Recommended 2-week roadmap
**Week 1 — finish lifecycle hardening + clear debt**
- Build **H5/H6** (status-led completion + auto-stamp; suppresses M4 false-late + M5 mark-complete). *(decided, ready)*
- Make the **H4** deposit-override decision → implement the chosen strictness.
- **Apply m078 then m077** (after a backup) + run their post-checks.
- **Browser QA** the stabilization + H7/H8 work (not yet owner-tested).
- Refresh the 4 stale docs to current behavior.

**Week 2 — highest daily-value features + governance**
- **Shipping/BL data model** (SHIP-3/4/5) in one Shipment-editor pass.
- **Notification durability** (M16/M17 — audit-critical events non-best-effort; reopen/TL-line events).
- **Ratify the capability matrix** (Decision I) + close **M18** (operations task-list-line RLS).
- Scope **Decision E** (visibility → RLS) as the bridge into the larger security workstream.

*Explicitly NOT in the next 2 weeks:* pricing/commission/forecasting build-out and Affairs deep rollout —
revisit once the operational core + security are stable.
