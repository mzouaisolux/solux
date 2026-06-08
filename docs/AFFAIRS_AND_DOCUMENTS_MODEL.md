# Affairs & Documents Model — Owner Decision Candidate

> **✅ DECISION LOCKED (2026-05-30).** Owner chose: **Affair = explicit container** (user-created,
> owned by a client, can group multiple distinct quotations/orders); **staged & additive** rollout;
> primary entity named **"Affair."** **Phase 1** (additive DB foundation — `affairs` table + nullable
> `affair_id` on documents/task-lists/orders + backfill, no RLS/UI/workflow change) is delivered as
> [`supabase/migrations/076_affairs_foundation.sql`](../../supabase/migrations/076_affairs_foundation.sql)
> — **apply manually in Supabase after a backup**, then run its POST-CHECK queries. Later phases
> (P2 code wiring → P5 retire customer-centric assumptions) are queued. The analysis below is the
> original (pre-decision) candidate writeup.

> **Status.** This is an **owner decision candidate** describing a **TARGET** model.
> It is **NOT implemented**. **Documentation only — no application code or schema is changed.**
> Sources verified read-only against the live code/migrations (cited inline).
>
> **Companion docs:** [`OWNER_DECISIONS_LOG.md`](./audit-editable/OWNER_DECISIONS_LOG.md)
> (Decision B = revise-only versioning; Decision F = restrict delete + archive-with-reason),
> [`DATABASE_MODEL.md`](./audit-editable/DATABASE_MODEL.md).

---

## 1. The target model (proposed)

```
Client
  └── Affair / Deal / Project            (1 client → many affairs)
        ├── quotation (V1)               (1 affair → many documents & records)
        ├── quotation revisions (V2, V3…)
        ├── proforma invoice
        ├── commercial invoice
        ├── order confirmation
        ├── production task list
        ├── production order
        ├── shipping / BL information
        ├── messages (conversation)
        └── events (operational timeline)
```

**Intent.**
- A **client** may have **many affairs**. An **affair** is the commercial container that groups *everything* about one project/deal.
- The client view should show **a list of affairs**, not a long flat list of isolated quotations/invoices/versions stacked under the client.
- **Cleanup is non-destructive.** Inactive commercial records are **closed / lost / abandoned / archived**, not deleted.
- **Archive reason is mandatory** (who, when, why) — consistent with Decision F.

> This is the **expected** structure. The sections below document the **current** structure and the gap.

---

## 2. Current implementation analysis

### 2.1 — Current structure detected in the code

The central commercial artifact is the **`documents`** table. A "document" is the quotation/proforma row; everything hangs off it.

| Element | Where | Notes |
|---|---|---|
| **Document** | `documents` table | central record. `type` ∈ **`quotation` \| `proforma`** (`lib/types.ts:850`, `DocType`). `status` ∈ draft/sent/negotiating/won/lost/cancelled. |
| **Client link** | `documents.client_id` | a document belongs to one client. |
| **Owner** | `documents.created_by`, `sales_owner_id` | effective owner = `sales_owner_id ?? created_by`. |
| **Affair label** | `documents.affair_name` (free text) | m056 (`056_document_affair_name.sql`). Comment: *"We work by PROJECTS / AFFAIRS, not by quotation codes."* NULL = unnamed. |
| **Version chain** | `documents.root_document_id`, `documents.version` | m059 (`059_quotation_versioning.sql`). |
| **Task list** | `production_task_lists` → `document_id`/`quotation_id` | one per won document. |
| **Production order** | `production_orders` → document/task list | created when a task list is validated. |
| **Shipping/BL** | `clients.bl_profile`, `documents` ports/incoterm, `production_orders.shipping_details` | split across 3 entities. |
| **Attachments** | `attachments.affair_id` | m060. **Affair-scoped** — see 2.2. |
| **Messages** | `entity_messages` (polymorphic `entity_type`/`entity_id`) | per-entity, **not** per-affair. |
| **Events** | `events` (polymorphic `entity_type`/`entity_id`) | per-entity, **not** per-affair. |

**Document types that exist today:** **`quotation`** and **`proforma`** only (`DocType` in `lib/types.ts:850`). **Commercial invoice** and **order confirmation** from the target model **do not exist** as document types.

### 2.2 — Does an Affair / Deal / Project entity already exist?

**No first-class entity exists** — there is **no `affairs`, `deals`, `projects`, `document_groups`, or `quotation_family` table** (verified: no such `create table` in `supabase/migrations/`).

**But the concept already exists, implemented implicitly and anchored on a document row:**

1. **`documents.root_document_id` is the de-facto affair key.** m059 comment, verbatim: *"`root_document_id` : the affair anchor = the id of V1. Every later version points to the same root. V1 itself has `root_document_id = NULL` (it IS the root)."* So **the affair = the root (V1) quotation document.**
2. **`documents.affair_name`** is a free-text **label** for that family (per-document, copied onto each version).
3. **`attachments.affair_id`** (m060) is **the only thing already affair-scoped** — and it stores the **root document id**, not a FK to an affairs table. Its RLS literally joins:
   `d.id = attachments.affair_id OR d.root_document_id = attachments.affair_id` (`060_attachments.sql`). Comment: *"Affair anchor = the root document id of the quotation family."*

**Conclusion:** the app is **document-centric**, not **affair-centric**. The "affair" is a *property of the root quotation*, not its own object. There is **no** affair-level status, no affair-level ownership independent of the root document, and no affair record that survives if the root document is removed.

### 2.3 — How current documents are linked together

- **Versions of a quotation** → linked by `root_document_id` (all point to V1) + `version` (1, 2, 3…). Index `documents_root_idx` (m059).
- **Quotation → task list → production order** → FK chain off a **specific document** (the won version), via `production_task_lists.document_id` → `production_orders`. This is a per-document link, not an affair link.
- **Proforma vs quotation** → same `documents` table, distinguished by `type`. **Whether a proforma shares the source quotation's `root_document_id` (i.e. belongs to the same affair) is _Needs confirmation_** — it may be created as an independent document.
- **Attachments** → affair-level (`affair_id` = root document id). The one element already shared across versions + the task list of the same project.
- **Messages & events** → **per-entity** (`entity_type`/`entity_id`). A message on V1 is **not** visible on V2; a thread on the document is separate from the thread on its task list or production order. **Not** affair-level.

> **Net effect:** only *versions* and *attachments* are grouped today. Document type (proforma), downstream production records, messages, and events are linked to individual rows, not to a single affair container.

### 2.4 — How revisions are handled currently

- A revision is a **NEW `documents` row copied from the source**, with `root_document_id` → V1 and `version` incremented. **The original is never mutated** (m059 comment: *"a revision is a fresh draft document copied from the source, with the parties / lines / pricing editable"*).
- Numbering convention (app-handled): `V1 = SLX-BEN-26-014` (root keeps original number), `V2 = …-V2`, `V3 = …-V3`.
- The copy/revise logic lives in the document save/duplicate flow (`app/(app)/documents/new/actions.ts`; note: a `duplicateDocument` action is **duplicated** across `app/(app)/clients/actions.ts` and `app/(app)/dashboard/actions.ts` — drift risk, see PROBLEMS_AND_INCONSISTENCIES).
- **Forecast already dedupes to the latest version per affair** so V1+V2 don't double-count (`lib/forecast.ts:336-338`, *"keep only the latest version of an affair in the pipeline"*).

> **Good news:** this versioning foundation already matches **Decision B** (won quotes → revise-only / new version). The affair grouping it implies is exactly what a real Affair entity would formalize.

### 2.5 — What would need to change to support Client → Affair → Documents

This is a **significant data-model change** (new table + backfill + FK rewiring + UI). Outline:

1. **New `affairs` table** — e.g. `id`, `client_id` (FK), `name`, `status` (`open`/`won`/`lost`/`abandoned`/`archived`), `owner_id`, `archive_reason`, `archived_by`, `archived_at`, `created_by`, `created_at`. Archive reason **mandatory** when status = archived.
2. **Add `affair_id` (FK → affairs)** to `documents`, `production_task_lists`, `production_orders`, `attachments`, and ideally to `entity_messages`/`events` (or resolve affair via the entity) so the whole family rolls up to one affair.
3. **Backfill / migration** — each existing `root_document_id` family → one `affairs` row; `documents.affair_name` → `affairs.name`; repoint `attachments.affair_id` (currently the root document id) to `affairs.id`. Keep `root_document_id`/`version` for the version chain *within* an affair.
4. **Document types** — add `commercial_invoice` and `order_confirmation` to `DocType` if those are required (today only `quotation`/`proforma`).
5. **Affair-level status & lifecycle** — open → won/lost/abandoned/archived, independent of any single document's status; cleanup via close/archive (mandatory reason), **not** deletion.
6. **UI** — client page lists **affairs**; an **affair detail page** shows all its documents, versions, proforma/invoice, task list, production order, shipping/BL, messages, and events in one place. Messages/events become affair-scoped (or aggregate per-entity threads under the affair).
7. **Affair-level conversation** — so a discussion isn't fragmented across V1/V2/task-list/PO (ties to Decision C: entity_messages canonical).

> Because `root_document_id` and `attachments.affair_id` already encode the affair, much of step 3 is mechanical — but steps 1, 2, 5, 6 are real new architecture and should be a deliberate, staged migration (not a quick change).

### 2.6 — Risks of continuing without an Affair layer

| # | Risk | Severity |
|---|---|---|
| R1 | **The affair has no identity of its own — it IS the root document.** Deleting the V1 quotation breaks the family: later versions' `root_document_id` is `on delete set null` (m059) → orphaned versions; `attachments.affair_id` (= deleted root id) → dangling files. With today's status-agnostic `quotation.delete` (sales/admin, see §7.1 of ROLE_PERMISSION_DECISIONS_NEEDED), this is **reachable**. | **High** |
| R2 | **Client pages become flat, cluttered lists** of quotations/proformas/versions — the exact problem this model aims to fix. No grouping on the client detail page today (verified: no affair/version grouping in `clients/[id]/page.tsx`). | High |
| R3 | **`affair_name` is free text, duplicated per version** → drift: renaming V1's affair does not rename V2/V3; typos create "different" affairs that are really the same project. | Medium |
| R4 | **Proforma / invoice not reliably tied to the affair** (Needs confirmation) → scattered commercial documents under the client. | Medium |
| R5 | **Messages & events are per-entity, not affair-level** → conversation and history fragment across versions and across document/task-list/PO. Conflicts with the "one conversation per affair" intent (Decision C). | Medium |
| R6 | **No affair-level status** → you cannot cleanly mark a *project* as lost/abandoned/archived; you must juggle per-document statuses. Makes "archive with mandatory reason" (this doc + Decision F) hard to enforce at the right level. | Medium |
| R7 | **Reporting already relies on dedupe-by-root workarounds** (`lib/forecast.ts`) — fragile; every new surface must remember to dedupe, or it double-counts versions. | Medium |
| R8 | **The longer the app grows document-centric, the larger the eventual migration** (more rows, more FKs, more UI assuming "document = the unit"). | Medium |

---

## 3. Relationship to existing owner decisions

- **Decision B (revise-only / new version):** ✅ already supported by `root_document_id`/`version`. An Affair entity would make the version chain a child of the affair rather than a self-join on documents.
- **Decision F (restrict delete; archive with reason):** strongly reinforces this model. Mandatory archive reason is best enforced at the **affair** level (close the project) plus per-record. R1 above shows why unrestricted delete is especially dangerous *without* an affair entity.
- **Decision C (entity_messages canonical):** an Affair layer is the natural home for the "one conversation area per entity/affair" goal.
- **New requirement captured here:** affair cleanup states = **closed / lost / abandoned / archived**, with **mandatory archive reason** (who/when/why). Not implemented.

---

## 4. Owner decision candidate

> Confirm the direction; do **not** implement yet.

- **D-AFF-1 — Adopt a first-class `Affair` entity** (Client → Affair → Documents) as the target architecture? ▢ Owner decision: ____________
- **D-AFF-2 — Affair cleanup states** = open / won / lost / abandoned / archived, **archive reason mandatory**, **no destructive delete as the normal path**? ▢ Owner decision: ____________
- **D-AFF-3 — Document types to support under an affair:** quotation, revisions, proforma (exist) **+ commercial invoice, order confirmation (new)** — confirm the full set? ▢ Owner decision: ____________
- **D-AFF-4 — Migration is staged/non-breaking** (introduce `affairs`, backfill from `root_document_id`, rewire FKs, then UI), not a big-bang rewrite? ▢ Owner decision: ____________

### Needs confirmation (facts to verify before designing)
- Does a **proforma** currently share its source quotation's `root_document_id` (same affair), or is it independent? *(Needs confirmation — check the proforma creation path.)*
- Should **messages/events** become affair-scoped, or stay per-entity and merely *aggregate* under the affair view? *(Owner preference.)*
- Are **commercial invoice / order confirmation** actually needed as document types, or handled outside this app? *(Owner.)*
- Exact affair **status set** and whether `won`/`lost` live on the affair, the document, or both. *(Owner.)*

> Nothing here changes code, schema, or permissions. Once the direction is confirmed, the next step is a **staged migration design doc** — still before any implementation.

---

## Phase 2 decisions (confirmed 2026-06-01)

The owner confirmed the Phase-2 questions and the long-term architecture:

1. **Duplicate → same affair.** A duplicated quotation stays in the **same** affair (a duplicate is a revision / negotiation round / alternative config of the same opportunity, not a new project). → `duplicateDocument` copies the source's `affair_id`.
2. **Owner at affair level.** Ownership is defined on the **affair** (`affairs.owner_id`) and **inherited** by all related documents/orders/invoices/shipments. → owner assignment targets the affair; documents derive owner from it.
3. **Affair status is INDEPENDENT** of document status — its own lifecycle: **Lead → Opportunity → Quotation → Negotiation → Won → In Production → Shipped → Completed / Lost** (plus **Abandoned**; **archive** is a separate `archived_at` + reason flag). It must **not** auto-derive from individual documents. (Backfill sets a one-time initial value only.)
4. **Forecast / Business = latest active version per affair only.** Pipeline value & reporting must never double-count multiple quotation versions of one affair.
5. **Move / Merge cascades automatically.** Moving/merging a document into another affair carries its **task lists, production orders, attachments, notes, conversations, timeline events, and related records** with it — a fully consistent affair-centric structure.

**Long-term architecture (north star):** Affairs/Projects are **independent, first-class business entities** and the **primary object** of the system. Users will **create projects directly, before any quotation**. Quotations, orders, invoices, shipments, files, conversations, tasks and production records all link to an affair. **The project is NOT created by a quotation — the quotation belongs to the project.** (Phase 1's quotation-derived backfill is a one-time legacy migration; going forward, creation inverts: affair first, then documents within it.)
