# Draft & Editing Rules — Audit Document

> **Scope.** This document audits the current edit/save/lock/delete rules for
> quotations (documents), client records, shipping/BL fields, and production
> order shipment details. It also surfaces the known unclear and risky
> behaviors. Every fact is grounded in the live code (read-only review).
>
> Tag conventions:
> - **[Confirmed by code]** — directly provable from cited files/lines.
> - **[Assumed from code]** — strongly implied by code structure, not a single
>   explicit rule.
> - **[Needs confirmation]** — the precise behavior is not provable from code
>   alone; owner must decide/verify.

---

## Owner Decisions (confirmed 2026-05-30)

> These decisions were confirmed by the owner on 2026-05-30 and recorded in
> [`OWNER_DECISIONS_LOG.md`](./OWNER_DECISIONS_LOG.md) (sections A, B, F).
> They describe **TARGET / INTENDED behavior and policy**.
> **None of these are yet implemented in code** — we are still in the
> documentation/clarification phase. Gaps vs current behavior are noted below.

### Decision A — Task list on "Won" (target; not yet implemented)

- Winning a quotation must **not** automatically create the production task list. (Matches current behavior — no auto-creation exists today.)
- After a quotation is marked `won`, the app must surface a mandatory, highly visible action: **"Create Production Task List"**.
- If a won quotation has no linked task list, it must appear as an **alert / Action Center item** until the task list is created.

**Gap vs current behavior:** The `DocQuickActions` component renders a "+ Task list" CTA for `won` status, but there is no Action Center alert / mandatory prompt enforcing creation. The action is available but not mandatory.

---

### Decision B — Won-quote editing: revise-only / new version (target; not yet implemented)

- Once a quotation is `won`, it must **not** be edited directly in place.
- Any commercial change after `won` must go through a **new revision / new version** linked to the original via `root_document_id` (versioning chain, m059).
- **If no production task list exists yet:** the new revision becomes the active commercial version once validated.
- **If a production task list already exists:**
  - The app must not silently overwrite the existing task list.
  - The app must detect and display **differences** between the previous won version and the new revision.
  - Changes affecting production, configuration, quantity, shipping, deadlines, payment terms, or BL information must trigger a **review state**.
  - The linked task list must be marked as **requiring review / update** before production continues.
  - Operations or task-list manager must confirm whether the task list should be **updated, regenerated, or kept unchanged**.
- The previous won version must remain **preserved for audit and history**.
- The **"Create revision / Revise quote"** action must be clear and accessible from the won quotation detail page.

**Gap vs current behavior:** The server action already blocks in-place edits of non-draft documents (`edit_of` path throws if `status !== "draft"`). However, the revision path (`?revise=<id>`) is accessible only via the 3-dot context menu on the won detail page — it is not prominently surfaced as the required path. No diff/review state or task-list impact control exists when a new revision is created for a won quote that has a linked task list. See section 3.2 below.

---

### Decision F — Deletion by status + Archive (target; not yet implemented)

**Deletion rules (target):**
- **Draft:** deletable by authorized users.
- **Sent / negotiating:** deletable only if **no downstream** production task list or production order exists.
- **Won (no linked task list yet):** deletion allowed only for **admin / super-admin**, with strong confirmation and preferably recorded in an audit log.
- **Won (linked task list or production order exists):** **blocked by default**; use cancellation or archive instead; cascade deletion of production data must not happen silently.

**Archive rules (target):**
- Archiving a quotation, task list, or production order must require the user to supply an **archive reason**.
- The archive action must store: archive reason, `archived_by`, `archived_at`, optional internal note/comment.
- Archived records must remain searchable/readable for history, be visually separated from active records, and must not appear in active workflow dashboards unless a filter is enabled.

**Gap vs current behavior (CONFIRMED CODE RISK — not yet aligned to Decision F):**
- Migration m057 (`057_documents_delete_owner.sql`) RLS policy allows any owner (`created_by = auth.uid()`) or admin/super-admin to DELETE a document **regardless of status** — including `won`, `sent`, `negotiating`. There is no status filter in the RLS policy or in the `deleteQuotation` server action.
- Migration m055 (`055_sales_delete_quotation.sql`) grants `quotation.delete` to the `sales` role, meaning sales reps can delete their own won quotations (and cascade-delete linked production orders via the FK CASCADE noted in `app/(app)/documents/[id]/actions.ts` lines 494–506).
- The `archiveQuotation` action does not currently require or store an archive reason, `archived_by`, or `archived_at` metadata beyond the timestamp. See section 4.3 and 7.3.

---

## 1. Saving drafts — new quotation flow

### 1.1 Route entry point

`app/(app)/documents/new/page.tsx` accepts two optional query parameters:

| Parameter | Meaning |
|---|---|
| `?revise=<docId>` | Create a new version (V2, V3…) of an existing affair. Source is loaded read-only; the save creates a new `documents` row. |
| `?edit=<docId>` | Continue editing an existing draft in place. Source is loaded read-only; the save updates that same row. |
| (none) | Blank form — brand new quotation. |

Both `?revise` and `?edit` load identical initial state into `NewDocumentForm`; only the server action's save target differs. **[Confirmed by code]** — `app/(app)/documents/new/page.tsx` lines 22–88.

### 1.2 Initial status on save

Every new quotation (and every new revision) is inserted with `status: "draft"`. **[Confirmed by code]** — `app/(app)/documents/new/actions.ts` line 403:

```ts
status: "draft",
```

A fresh insert always starts as a draft; the UI must explicitly call `updateDocumentStatus` (or the "Mark as sent" button) to advance the status.

### 1.3 Capability gate

`saveDocument` calls `await requireCapability("quotation.create")` at the top of the function as the server-side security layer. **[Confirmed by code]** — `app/(app)/documents/new/actions.ts` line 121.

The "New quotation" button is also hidden in the UI via `hasUiCapability` for roles that lack the capability (defense-in-depth). **[Assumed from code]** — stated as a comment in that same file (lines 119–122).

### 1.4 Validation on save

- A client (`client_id`) and at least one product line are **required**; the action throws if either is missing. **[Confirmed by code]** — lines 130–131.
- Payment terms are normalized and validated (`validatePaymentTerms`). Production time is validated (`validateProductionTime`). **[Confirmed by code]** — lines 133–140.
- Advisory validation request (`request_validation: true`) is an optional flag that sets `validation_status: "pending"` after the save. It never blocks the save; it soft-fails if migration m068 is not applied. **[Confirmed by code]** — `maybeRequestValidation` function, lines 77–113, and the `ADVISORY` comment in the `SaveDocumentInput` type definition (lines 66–68).

---

## 2. Editing a draft in place (`?edit=<docId>`)

### 2.1 Current behavior

When `edit_of` is set in the save input, the server action:

1. Loads the target document and **verifies its status is `draft`**. If the status is anything other than `draft`, the action throws with the message:
   > "Only draft quotations can be edited in place. Use 'Create new version' to revise a sent or won quotation."
2. Updates the document row in place (number, status, and `created_by` are preserved; all other mutable fields are updated).
3. Deletes and replaces the document's lines and containers wholesale.
4. Emits a `doc.updated` event.

**[Confirmed by code]** — `app/(app)/documents/new/actions.ts` lines 217–341.

### 2.2 "Continue editing" entry point

The document detail page (`app/(app)/documents/[id]/page.tsx`) renders a **draft banner** when `doc.status === "draft"` (lines 783–817). This banner contains:

- A "Continue editing" button linking to `/documents/new?edit=<id>`.
- A "Mark as sent" button.

The `DocQuickActions` component (rendered on every status for the primary CTA area) also renders a "Continue editing" link for drafts. **[Confirmed by code]** — `components/DocQuickActions.tsx` lines 88–99.

### 2.3 Who can edit a draft

Edit-in-place uses the same `quotation.create` capability gate as a new document save. RLS on `documents` (m046/m057) scopes the UPDATE to the document's owner (`created_by = auth.uid()`) for non-technical roles. Technical roles (TLM/operations/admin/super-admin) can update any document visible to them. **[Confirmed by code]** — `saveDocument` capability gate (line 121) + RLS cited in `BUSINESS_RULES_DETECTED.md` A4/B7.

---

## 3. Editing a sent or won quotation (versioning)

### 3.1 Current behavior for sent / negotiating quotations

For a quotation with status `sent` or `negotiating`, the `DocQuickActions` component renders two buttons:

- **Mark Won** — calls `updateDocumentStatus` to flip the status.
- **Edit → new version (Revise)** — links to `/documents/new?revise=<id>`.

A sent quotation is **never edited in place** — the comment in `DocQuickActions` is explicit: "the sent version is the record of what the client received." **[Confirmed by code]** — `components/DocQuickActions.tsx` lines 101–127.

The revision save path:
- Strips any existing `-V{n}` suffix from the source number to get the affair base number.
- Counts existing siblings and assigns the next version number (`-V2`, `-V3`, etc.).
- Resolves `root_document_id` from the source row (pointing to V1 of the affair).
- Inserts a new `documents` row with `status: "draft"`, the new number, and the versioning columns (`version`, `root_document_id`).

**[Confirmed by code]** — `app/(app)/documents/new/actions.ts` lines 344–446.

The 3-dot context menu on `app/(app)/documents/[id]/page.tsx` also exposes an "Edit → new version (revise)" link (line 739), available at all statuses.

### 3.2 Editing a won quotation — current vs expected

**Current behavior:** Once a quotation is `won`, the `DocQuickActions` component renders only the task-list CTA (either "+ Task list" or "→ Task list"). No "Continue editing" button appears; no "Edit → new version" quick action is shown on the primary CTA. The 3-dot context menu does expose "Edit → new version (revise)" as a secondary path. There is no runtime enforcement that blocks the save action itself from receiving `?edit=<wonId>` — but the server action checks `status !== "draft"` and would throw the error above.

**Expected behavior:** **[RESOLVED-by-owner — see OWNER_DECISIONS_LOG.md section B]** A `won` quotation must never be edited in place. Commercial changes must go through a new revision/version (the `?revise` path, `root_document_id` chain m059). The "Create revision / Revise quote" action must be prominently accessible from the won detail page (not only via the 3-dot menu). If a production task list already exists, the new revision must trigger a diff/review state and require ops/TLM confirmation before the task list is updated, regenerated, or kept unchanged. Implementation is **not yet applied** — the revision path exists but is not prominently surfaced and no task-list impact control or diff/review state exists today.

### 3.3 Versioning model (m059)

- `documents.version` integer, default 1.
- `documents.root_document_id` references `documents.id` (ON DELETE SET NULL). V1 has `root_document_id = NULL`; every later version points to the V1 row.
- The affair's versions panel (`components/documents/QuotationVersionsPanel`) appears on the document detail page.
- Forecast belongs to the **latest version** only; older versions show a "managed on latest version" notice.
- **[Confirmed by code]** — `supabase/migrations/059_quotation_versioning.sql`; `app/(app)/documents/[id]/page.tsx` lines 442–463.

---

## 4. Deleting drafts (and all quotations)

### 4.1 Capability grant — who can delete

Migration m055 (`055_sales_delete_quotation.sql`) sets `quotation.delete = true` for `sales` and `admin` roles. Super-admin inherits `admin` and is also enabled. **[Confirmed by code]** — m055 lines 28–31.

Prior to m055 the capability was super-admin only. After m055 the matrix is:
- `sales`: enabled
- `admin`: enabled
- `super_admin`: enabled (inherits admin)
- `task_list_manager` / `operations`: **[Needs confirmation]** — not visible in m055; default state not provable from the migration alone (depends on the initial seed in m026).

### 4.2 RLS scope — what the database allows

Migration m057 (`057_documents_delete_owner.sql`) replaced the documents DELETE policy with:

```sql
create policy "documents delete scoped" on documents for delete using (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role = 'admin' or coalesce(r.super_admin, false))
  )
);
```

This means:
- **Any authenticated user (including sales)** can DELETE their own documents (`created_by = auth.uid()`), regardless of the document's status (`draft`, `sent`, `won`, `lost`, `cancelled`).
- **Admin and super-admin** can DELETE any document.
- `task_list_manager` and `operations` can delete only their own documents (same as sales).

**[Confirmed by code]** — `supabase/migrations/057_documents_delete_owner.sql` lines 26–33.

### 4.3 Status-agnostic deletion

The RLS policy and the `deleteQuotation` server action impose no status filter. A sales rep can delete a `won` quotation (which has a linked task list and potentially a production order). The FK CASCADE from `production_orders` to `documents` (noted in the `deleteQuotation` comment, `app/(app)/documents/[id]/actions.ts` line 495) will physically delete the linked production order. **[Confirmed by code]** — action comment lines 494–506; m057 RLS policy.

**[RESOLVED-by-owner — see OWNER_DECISIONS_LOG.md section F]** Allowing sales to delete `won` quotations and cascade-delete linked production orders is **not** the desired behavior. Target rules: won quotations with a linked task list or production order must be **blocked from deletion** (use cancel/archive instead); won quotations with no linked task list yet may only be deleted by admin/super-admin with audit logging. **Current gap:** the m057 RLS policy and `deleteQuotation` action impose no status filter — this is **not yet aligned to Decision F**. The `quotation.delete` grant in m055 for the `sales` role also needs to be revisited against the status-based rules confirmed by the owner.

### 4.4 Application-layer gate

The `deleteQuotation` server action calls `await requireCapability("quotation.delete")` before proceeding. The UI "Delete quotation" button is hidden unless `hasUiCapability("quotation.delete")` returns true. **[Confirmed by code]** — `app/(app)/documents/[id]/actions.ts` line 503; `app/(app)/documents/[id]/page.tsx` lines 433–434.

---

## 5. Editing clients (`app/(app)/clients/[id]/edit/page.tsx`)

### 5.1 Who can access the edit page

The page uses `getEffectiveRole()` for UI decisions (owner assignment) but has no explicit role guard in the page body. Access is controlled by:

1. The `app/(app)` route-group layout guard (not audited here — layout file not inspected in this pass).
2. RLS on `clients` (m046/m058): only the record's owner (`created_by = auth.uid()` or `sales_owner_id = auth.uid()`) or technical roles can UPDATE a client row.

**[Assumed from code]** — page does not call `requireAdmin()` or a capability gate in-body; relies on layout + RLS.

### 5.2 Editable fields

The identity/contact form updates the following columns via `updateClientAction` (`app/(app)/clients/actions.ts` line 332):

- Core: `company_name`, `contact_name`, `email`, `phone_number`, `country`, `client_code`, `starting_sequence_number`, `custom_fields`.
- PDF export fields (m036): `address`, `vat_number`, `default_attention_to`, `phone_country_code`.

All are mutable at any time, with no lifecycle gate on the client record itself. **[Confirmed by code]** — `updateClientAction` payload (lines 349–370); the action redirects to `/clients` on success.

### 5.3 Client code constraint

`client_code` is validated client-side (UI: maxLength=3, uppercase style) and server-side via `clientCode()` helper which enforces the `^[A-Z]{3}$` regex and throws "Client code must be exactly 3 letters (e.g. ARL)" on violation. **[Confirmed by code]** — `app/(app)/clients/actions.ts` lines 180–188.

The DB also has a CHECK constraint `^[A-Z]{3}$` from m006. **[Confirmed by code]** — `BUSINESS_RULES_DETECTED.md` B7.

### 5.4 Account owner reassignment

`assignClientOwner` is exposed on the edit page for technical roles (`isTechnicalRole(effectiveRole)` check). It calls `getCurrentUserRole()` using the **real** role (not effective), so View-As cannot be used to bypass. **[Confirmed by code]** — `app/(app)/clients/actions.ts` lines 25–26; edit page lines 64–65.

---

## 6. Editing shipping / BL fields

### 6.1 Client BL profile (`ClientBlEditor` + `updateClientBlProfile`)

**Location:** `components/clients/ClientBlEditor.tsx` (client component) + `app/(app)/clients/actions.ts` `updateClientBlProfile` (server action).

**Current behavior:**
- The `ClientBlEditor` is a client-side React component managing local state for the full BL profile (shipper / consignee / notify / documents / notes) and serializes it to JSON on save.
- On save, it calls `updateClientBlProfile` which:
  1. Validates the payload is valid JSON.
  2. Passes it through `normalizeBlProfile` server-side for a complete, well-shaped blob.
  3. UPDATEs `clients.bl_profile` (jsonb column, m054).
  4. Emits a `client.updated` event.

**Access control:** RLS on `clients` (m046) already scopes who can write. No additional capability gate is applied at the action level — any user who can write the client can update its BL profile. **[Confirmed by code]** — `app/(app)/clients/actions.ts` lines 290–330.

**Needs confirmation:** Whether sales (who can write their own clients) should be able to freely update the BL profile at any time, including after shipments are in flight.

**Advisory:** `lib/bl.ts` contains a header comment that "File upload for BL documents is out of scope" — consistent with the absence of file upload in `ClientBlEditor`. **[Confirmed by code]** — `BUSINESS_RULES_DETECTED.md` E5; `PRODUCT_OVERVIEW.md` section 5.

### 6.2 Production order shipment/BL fields (`updateProductionOrderShipment`)

**Location:** `app/(app)/production/orders/actions.ts` `updateProductionOrderShipment` (lines 932–1005); form rendered on `app/(app)/production/orders/[id]/page.tsx`.

**Current behavior:**
- `updateProductionOrderShipment` calls `await requireCapability("production_order.edit_shipment")` as the first line — this is the server-side gate. **[Confirmed by code]** — line 934.
- The action updates two separate patches:
  1. Core scheduling fields: `shipment_booked` (bool), `etd`, `eta`, `shipping_notes` on the `production_orders` row.
  2. BL execution details (m070): `bl_number`, `forwarder`, `vessel`, `voyage`, `gross_weight`, `net_weight`, `cbm`, `packages`, `hs_code` stored as a single `shipping_details` jsonb blob.
- If updating `shipping_details` fails because the column is missing (`/shipping_details|column .* does not exist/i`), the error is silently swallowed — the core shipment save still completes. **[Confirmed by code]** — lines 982–984.

**Gating:** Only roles with `production_order.edit_shipment` capability can call this action. The production order detail page renders the shipment form only for technical roles (`isTechnicalRole(effectiveRole)`, page comment: "Visible to: sales (read-only); TLM, admin editable"). **[Confirmed by code]** — page.tsx header comment lines 82–84; `hasUiCapability("production_order.edit_shipment")` controls form rendering.

**Known key-name mismatch (pre-existing issue):** `updateProductionOrderShipment` writes `shipping_details.forwarder` and `shipping_details.vessel`, but `lib/action-center.ts` `blIsFilled()` reads `forwarder_name` and `vessel_name`. Entering forwarder/vessel on an order does NOT clear the Action Center "BL missing" card; only `bl_number` (or a filled client consignee) actually clears it. **[Confirmed by code]** — `POTENTIAL_INCONSISTENCIES.md` item 1.

---

## 7. Editing finalized documents

### 7.1 Won quotations — current behavior

**Current behavior:** There is no hard edit lock on `won` quotations at the application or database layer other than:
- The `edit_of` path in `saveDocument` throws if the document's status is not `draft` (covers attempts via the builder form).
- The `DocQuickActions` component does NOT render "Continue editing" or "Edit → new version" in the primary CTA for `won` status; those quick actions are absent.
- The 3-dot context menu on `/documents/[id]` exposes "Edit → new version (revise)" at all statuses (no status gate on that menu item).

**[Needs confirmation]** — Whether a `won` quotation should:
- Be completely read-only (no revisions allowed once won),
- Allow revisions only via the explicit "Create new version" path (current: accessible via 3-dot menu),
- Or be treated identically to `sent`/`negotiating` (fully revisable). The code does not enforce a specific policy here.

### 7.2 Sent / negotiating quotations — current behavior

Sent and negotiating quotations cannot be edited in place (the builder's `edit_of` path enforces `status === "draft"` only). They can be revised into a new version. **[Confirmed by code]** — `saveDocument` lines 225–229; `DocQuickActions` lines 101–127.

### 7.3 Archived quotations — current behavior

Archived quotations (`archived_at IS NOT NULL`) can still be viewed and status-changed via `updateDocumentStatus`. The archive/unarchive actions are gated by `quotation.archive` capability. There is no enforcement that prevents an archived quotation from being revised or having its status toggled. **[Confirmed by code]** — `archiveQuotation` / `unarchiveQuotation` in `app/(app)/documents/[id]/actions.ts`; page hides the `ValidationPanel` when `doc.archived_at` is set (line 537).

**[Needs confirmation]** — Whether archived quotations should be truly read-only (no status changes, no revisions).

---

## 8. Task-list lock for sales (`TASK_LIST_LOCKED_FOR_SALES`)

### 8.1 Definition

```ts
// lib/types.ts lines 421–426
export const TASK_LIST_LOCKED_FOR_SALES: ProductionTaskListStatus[] = [
  "under_validation",
  "validated",
  "production_ready",
  "cancelled",
];
```

**[Confirmed by code]** — `lib/types.ts` line 421.

### 8.2 Where the lock is enforced

The lock is checked in:
- `app/(app)/task-lists/[id]/actions.ts`: multiple server actions (`updateRiskFlags`, `updateTaskListLine`, `updateTaskListHeader`, `addTaskListLine`) check `TASK_LIST_LOCKED_FOR_SALES.includes(currentStatus)` and throw for non-technical roles. **[Confirmed by code]** — lines 79, 135, 206, 286.
- `app/(app)/task-lists/[id]/page.tsx`: `lockedForSales = TASK_LIST_LOCKED_FOR_SALES.includes(status)` + `salesCanEdit = technical || !lockedForSales` drives whether the edit UI is rendered. **[Confirmed by code]** — lines 110–111.

### 8.3 Who the lock applies to

The lock is bypassed for **technical roles** (`isTechnicalRole(role)` = admin / super_admin / task_list_manager / operations). Sales is the only role blocked. The "lock" is enforced at the server action level (role check) and in the page render (UI hidden for sales when locked). **[Confirmed by code]** — `updateRiskFlags` lines 78–86; page line 111.

### 8.4 Unclear behavior

**[Needs confirmation]** — `cancelled` is included in `TASK_LIST_LOCKED_FOR_SALES`. This means sales cannot edit a cancelled task list. Whether this is intentional (a cancelled TL should be immutable) or incidental (sales just can't do anything useful on a cancelled TL anyway) is not documented in code comments.

---

## 9. Duplicate `duplicateDocument` server action

### 9.1 Description

Two separate files both export a function named `duplicateDocument`:

| File | Used by |
|---|---|
| `app/(app)/clients/actions.ts` line 55 | Clients workspace (client row expand, duplicate button) |
| `app/(app)/dashboard/actions.ts` line 7 | Dashboard (duplicate from dashboard rows) |

**[Confirmed by code]** — both files audited directly.

### 9.2 Differences between the two copies

| Aspect | `clients/actions.ts` | `dashboard/actions.ts` |
|---|---|---|
| `config_values` on lines | Copied (`config_values: l.config_values ?? {}`) | NOT copied (`config_values` field absent from the line insert payload — line 83) |
| After save | `redirect(\`/documents/${inserted!.id}\`)` | `redirect(\`/documents/${inserted!.id}\`)` (same) |
| Revalidation | `/clients`, `/dashboard` | `/dashboard` only |
| `affair_name`, `version`, `root_document_id` | NOT copied (not present in insert) | NOT copied |
| Advisory validation columns | NOT copied | NOT copied |

The **`config_values` omission** in `dashboard/actions.ts` is a confirmed divergence: duplicating a document from the dashboard will produce a copy without the per-line technical config values, while duplicating from the clients page retains them. **[Confirmed by code]** — `dashboard/actions.ts` line 83 vs `clients/actions.ts` line 135.

**[Needs confirmation]** — Whether this behavioral difference is intentional or a bug. The divergence means two duplicate operations on the same source document produce different results depending on which surface is used.

---

## 10. Advisory validation — never blocks send/win

### 10.1 Current behavior

The advisory validation loop (m068) sets `documents.validation_status` to `pending` / `approved` / `rejected`. It is:

- **Never checked** before `updateDocumentStatus` advances the document to `sent`, `won`, or any other status. No capability gate or status check in `updateDocumentStatus` reads `validation_status`. **[Confirmed by code]** — `app/(app)/documents/[id]/actions.ts` `updateDocumentStatus` (lines 308–370).
- **Never checked** inside `saveDocument` (the save completes regardless). **[Confirmed by code]** — `app/(app)/documents/new/actions.ts` lines 115–574.
- The comment at the top of `saveDocument`'s `request_validation` input field explicitly says: "Never blocks the save; soft-fails if m068 isn't applied yet." **[Confirmed by code]** — lines 66–68.

### 10.2 Who can review

- Any authenticated user who can see the document may **request** validation (`canRequestValidation = true` — hardcoded in the page, line 535).
- Only `isAdminLike(role)` (admin / super_admin) may **review** (approve/reject). **[Confirmed by code]** — `reviewValidation` action line 625; page line 534.

### 10.3 Expected behavior

**[Needs confirmation]** — Whether the advisory validation loop should ever be promoted to a **blocking** gate (e.g., a `sent` or `won` transition requiring `validation_status = 'approved'`). Current design is deliberately advisory; if a harder gate is desired it must be added to `updateDocumentStatus`.

---

## 11. Summary of needs-confirmation items

| # | Item | Risk level | Status |
|---|---|---|---|
| 1 | Sales can delete `won` quotations (and cascade-delete linked production orders) — current RLS (m055/m057) not aligned to Decision F. | High | **RESOLVED-by-owner (F)** — target: blocked if TL/PO exists; admin-only + audit if no TL yet. **Not yet implemented.** |
| 2 | `task_list_manager` / `operations` roles' default grant for `quotation.delete` — not visible from the migrations audited; needs DB verification. | Medium | Needs confirmation |
| 3 | Whether a `won` quotation should be completely read-only, revision-only, or freely revisable via the 3-dot menu. | Medium | **RESOLVED-by-owner (B)** — revise-only (new version); revise CTA must be prominent; task-list diff/review required if TL exists. **Not yet implemented.** |
| 4 | Whether archived quotations should be truly read-only (no status changes, no revisions). | Low | Needs confirmation |
| 5 | `cancelled` in `TASK_LIST_LOCKED_FOR_SALES` — intentional immutability or incidental? | Low | Needs confirmation |
| 6 | `duplicateDocument` in `dashboard/actions.ts` drops `config_values` on lines — confirmed divergence from `clients/actions.ts`; intentional or bug? | Medium | Needs confirmation |
| 7 | Advisory validation never blocks send/win — is this the permanent design, or should a hard gate be added for certain transitions? | Low | Needs confirmation |
| 8 | Whether sales reps should be able to update a client's BL profile at any time (including while shipments are in flight). | Low | Needs confirmation |

---

## 12. File reference index

| File | Relevance |
|---|---|
| `app/(app)/documents/new/page.tsx` | New document + revision + edit-in-place entry point |
| `app/(app)/documents/new/actions.ts` | `saveDocument` — all save paths (new, edit_of, revise_of) |
| `app/(app)/documents/[id]/page.tsx` | Document detail, draft banner, 3-dot menu, won CTA |
| `app/(app)/documents/[id]/actions.ts` | `updateDocumentStatus`, `deleteQuotation`, `archiveQuotation`, advisory validation actions |
| `components/DocQuickActions.tsx` | Primary CTA per status (Continue editing, Mark Won, Revise, Task list) |
| `app/(app)/clients/[id]/edit/page.tsx` | Client edit form entry point |
| `app/(app)/clients/actions.ts` | `updateClientAction`, `updateClientBlProfile`, `duplicateDocument` (clients copy) |
| `components/clients/ClientBlEditor.tsx` | BL profile editor (client component) |
| `app/(app)/production/orders/[id]/page.tsx` | Production order detail (shipment form gating) |
| `app/(app)/production/orders/actions.ts` | `updateProductionOrderShipment`, `updateProductionOrderStatus`, etc. |
| `app/(app)/dashboard/actions.ts` | `duplicateDocument` (dashboard copy — diverges from clients copy) |
| `app/(app)/task-lists/[id]/actions.ts` | `TASK_LIST_LOCKED_FOR_SALES` enforcement in server actions |
| `app/(app)/task-lists/[id]/page.tsx` | `lockedForSales` / `salesCanEdit` UI gate |
| `lib/types.ts` lines 421–425 | `TASK_LIST_LOCKED_FOR_SALES` constant definition |
| `lib/permissions.ts` lines 51–79 | `Capability` union — all 22 capability keys |
| `lib/validation.ts` | Advisory validation state machine |
| `supabase/migrations/055_sales_delete_quotation.sql` | Grants `quotation.delete` to `sales` + `admin` |
| `supabase/migrations/057_documents_delete_owner.sql` | RLS DELETE policy — owner or admin/super-admin |
| `supabase/migrations/059_quotation_versioning.sql` | `root_document_id` + `version` columns |
