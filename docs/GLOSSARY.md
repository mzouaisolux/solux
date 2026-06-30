# Solux Hub — Business Glossary (canonical terms)

**Status:** living source of truth · started 2026-06-19 · owner-driven.
**Purpose:** one canonical term per business concept, so the **UI**, the
**documentation**, and our **conversations** all use the same words. When the
app's labels disagree with this file, **this file wins** — the UI is brought
into line during the (separate, later) label-harmonization / i18n pass.

> Scope priority (owner decision): lock the **commercial → operational
> workflow** first (this doc), then extend to prospects/tenders, finance,
> pricing, admin. Sections marked _(to extend)_ are intentionally light.

---

## 1. The core workflow chain (read this first)

```
Client
  └─ Project (affair)                ← the deal / opportunity container
       ├─ Service Request             ← (optional) a custom/tender intake that produces a quotation
       └─ Quotation (devis)           ← the priced offer sent to the client
            └─ [Won] → Launch Production
                 └─ Proforma           ← the production COMMAND (copy of the won quotation)
                      └─ Task List      ← the factory worksheet (production_task_lists)
                           ├─ Factory Mapping   ← config → factory instructions (autonomous, reusable)
                           ├─ Revision loop     ← TLM ↔ Sales clarification
                           └─ [Validated] → Production Order   ← production/shipping tracking
```

One affair → one **Project**. A won **Quotation** is the single source of
**revenue**. The **Proforma** it spawns is the *command*, **not** a second
deal — it never counts as revenue (see §4).

---

## 2. Entities — canonical terms

| Canonical (EN) | FR | Internal (table / type) | Definition | Do NOT call it |
|---|---|---|---|---|
| **Client** | Client | `clients` | The customer company. Has an owner (account owner). | account (ok as synonym in "account owner") |
| **Project** | Projet (affaire) | `affairs` | The deal/opportunity container under a client. Holds the quotation version family, the service request, attachments. Mandatory: every quotation/request attaches to one. | ~~Affair~~ (legacy term, being phased out in UI), ~~Opportunity~~ (reserve "Opportunity" for the prospect/tender pipeline stage only) |
| **Service Request** | Demande de service | `project_requests` | A structured custom/tender intake (e.g. a public-lighting tender) that is qualified, costed, then turned into a quotation. | ~~Project Request~~, ~~Project~~ (the residual "project" wording here is being removed) |
| **Quotation** | Devis | `documents` (`type = 'quotation'`) | The priced commercial offer sent to the client. The negotiation document. **Revenue = won quotations.** | ~~Invoice~~ |
| **Proforma** | Proforma / Commande | `documents` (`type = 'proforma'`) | The **production command**: a faithful copy of a **won** quotation, created in the background by **Launch Production**. Carries the production cycle via its task list. PDF header reads "PROFORMA INVOICE". Created as status `draft` on purpose (so it never double-counts as revenue). | a "won deal", a second quotation |
| **Command / Order** | Commande | (concept on the Proforma) | The business meaning of the Proforma: the confirmed order that drives production. "Order" (EN) = "Commande" (FR) = the proforma + its production order. The `Orders` nav module groups these. | — |
| **Task List** | Liste de tâches (production) | `production_task_lists` | The factory worksheet generated from the proforma. Sales drafts/enriches it; the production team validates it. Number format `PTL-<quotation number>`. | — |
| **Factory Mapping** | Mapping usine | `factory_mappings` (+ client presets + per-order overrides) | **Autonomous, reusable** rules that translate a commercial config value (e.g. Battery = 922Wh) into a factory instruction/part. Resolved in layers: **order override → client preset → global mapping → missing**. Lives independently of any single task list; reused automatically on future task lists. | — |
| **Production Order** | Ordre de production | `production_orders` | Created when a task list is validated. Tracks production deadlines, shipment, delivery. (Out of scope for the current revision/mapping work.) | — |
| **Affair (legacy)** | — | `affairs` | Same entity as **Project**. The word "Affair" is being retired from the UI in favour of "Project". | — |

---

## 3. Statuses — canonical labels

**Quotation** (`DOC_STATUS_LABEL`, `lib/types.ts`): `Draft → Sent → Negotiating → Won` (or `Lost` / `Cancelled`).
- A quotation is never edited in place after **Sent**; changes create a new **version** (V2, V3…) in the same Project.

**Task List** (`TASK_LIST_STATUS_LABEL`): `Draft → Under validation → (Needs revision ↔) → Validated → Production ready` (or `Cancelled`).
- `Needs revision` ↔ `Under validation` is the **revision loop** (§5).

**Service Request** (`PROJECT_REQUEST_STATUS_LABEL`): `Draft → Submitted → … → Quotation generated → Won / Lost / Cancelled`.
- ⚠️ A Service Request "Won" and a Quotation "Won" are different things — don't conflate them in reports.

---

## 4. Money — definitions (locked 2026-06-19)

- **Revenue / CA** = sum of **won Quotations** (`type='quotation' AND status='won'`). Proformas are **excluded** (they're commands, not deals) — enforced in `business/page.tsx`, `dashboard/OperationsTab.tsx`, `business/CommercialAnalytics.tsx`.
- A **Proforma can never be marked "Won"** (guard in `updateDocumentStatus`) — it would double-count the affair.
- **Win rate** = won quotations ÷ total quotations (proformas excluded).
- Finance/invoicing (balances, deposits, LC) is tracked on the **Proforma** and the production order — a separate concern from revenue.

---

## 5. Key flows (one line each)

- **New quotation:** Client → Project (existing or inline "+ New Project") → add products → save → `Sent` → `Won`.
- **Launch Production:** on a **won** quotation, one click creates the **Proforma** (command, draft) + **Task List**, then opens the task list. The commercial never handles proforma mechanics.
- **Revision loop:** the **Task List Manager** sends a task list back to Sales with a **structured reason** (category + message + field) → status `Needs revision`; **Sales** sees the reason, replies with a correction summary, and re-submits → status `Under validation`. Reasons + responses live in the entity conversation **and** the validation history.
- **Release to Production:** the TLM clicks **Validate** → "Release to Production?" confirmation. Release is **blocked** (server-side too) while any **factory mapping is missing** or a **revision is open**. On release, the **Production Order** is created.

---

## 6. Roles & supervision

| Canonical | FR | `Role` value | Scope |
|---|---|---|---|
| Super Admin | Super admin | `super_admin` | Everything. |
| Admin | Admin | `admin` | Admin/system + all workflows. |
| Sales Director | Directeur commercial | `sales_director` | **Supervises commercial workflows** — approve quotation validations, reassign owners — **without** technical/admin powers. |
| Sales | Commercial | `sales` | Owns clients/projects/quotations they create (RLS-scoped). Never sees factory mapping or factory cost. |
| Task List Manager | Resp. listes de production | `task_list_manager` | Validates task lists, factory mapping, production handoff. |
| Operations | Opérations | `operations` | Same operational scope as TLM. |
| Finance | Finance | `finance` | Read-only financial KPIs, balances, LC. |

**Role helpers** (`lib/types.ts`) — keep these distinct:
- `isAdminLike(role)` = admin · super_admin. (admin/system powers)
- `isTechnicalRole(role)` = isAdminLike · task_list_manager · operations. (production powers)
- `canSupervise(role)` = isAdminLike · **sales_director**. (commercial-supervision powers: approve quote validation, reassign deal/account/project owner)

---

## 7. Naming decisions (collisions resolved)

1. **"Project" used to mean three things** → now: **Project = affair** only. `project_requests` → **Service Request**; the prospect/tender entity keeps **Opportunity** for its pipeline only. (UI residuals being swept during label harmonization.)
2. **Proforma vs Command vs Order** → the *document* is the **Proforma**; its business role is **the command/order**. "Order" (EN) = "Commande" (FR). The `Orders` nav + Production Order use "Order".
3. **FR/EN UI strings** (a few validation messages are still in French) → to be routed through the i18n layer in the label-harmonization pass (deferred).

---

## 8. To extend later _(placeholders)_
- Prospects & Tenders (prospects, tenders, bid attributions, funders, tiers).
- Pricing (price lists, margins, cost entry, RMB factory cost).
- Finance (balance due date, LC expiry, commercial invoice / shipping doc).
- Admin (capability matrix, teams, sales conditions, banks).

> Related docs: `AFFAIRS_AND_DOCUMENTS_MODEL.md`, `CAPABILITY_MATRIX.md`, `LIFECYCLE_AUDIT.md`.
