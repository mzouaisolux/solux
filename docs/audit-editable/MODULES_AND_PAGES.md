# Modules and Pages — All Routes

> **Audit note.** Grounded in a full glob of `app/(app)/**/page.tsx` and
> `app/api/**/route.ts`, with each file read and verified against the live
> code. Primary sources cross-checked: `docs/current-implementation/USER_ROLES.md`
> §6 (route gating) and `docs/current-implementation/PRODUCT_OVERVIEW.md` §2.
>
> Legend:
> - **[Confirmed by code]** — directly observed in the file(s) cited.
> - **[Assumed from code]** — inferred from imports/patterns; not explicitly stated.
> - **[Needs confirmation]** — not provable from code alone; owner should verify.
> - **REDIRECT STUB** — the page.tsx contains only `redirect()` with no content.

---

## Route inventory — full list

Total pages found: **37 page.tsx** + **2 route.ts** = 39 route handlers.

```
app/page.tsx                                      → REDIRECT STUB → /dashboard
app/login/page.tsx                                → /login
app/(app)/dashboard/page.tsx                      → /dashboard
app/(app)/dashboard-v2/page.tsx                   → /dashboard-v2
app/(app)/business/page.tsx                       → /business
app/(app)/operations/page.tsx                     → /operations
app/(app)/forecast/page.tsx                       → /forecast
app/(app)/clients/page.tsx                        → /clients
app/(app)/clients/[id]/page.tsx                   → /clients/[id]
app/(app)/clients/[id]/edit/page.tsx              → /clients/[id]/edit
app/(app)/documents/[id]/page.tsx                 → /documents/[id]
app/(app)/documents/new/page.tsx                  → /documents/new
app/(app)/task-lists/page.tsx                     → /task-lists
app/(app)/task-lists/[id]/page.tsx                → /task-lists/[id]
app/(app)/production/orders/page.tsx              → REDIRECT STUB → /operations
app/(app)/production/orders/[id]/page.tsx         → /production/orders/[id]
app/(app)/production/queue/page.tsx               → REDIRECT STUB → /task-lists
app/(app)/order-follow-up/page.tsx                → REDIRECT STUB → /operations
app/(app)/factory-mapping/page.tsx                → /factory-mapping
app/(app)/permissions/page.tsx                    → REDIRECT STUB → /permissions/actions
app/(app)/permissions/actions/page.tsx            → /permissions/actions
app/(app)/permissions/teams/page.tsx              → /permissions/teams
app/(app)/admin/users/page.tsx                    → /admin/users
app/(app)/admin/diagnostics/page.tsx              → /admin/diagnostics
app/(app)/admin/diagnostics/reset/page.tsx        → /admin/diagnostics/reset
app/(app)/admin/banks/page.tsx                    → /admin/banks
app/(app)/admin/banks/[id]/page.tsx               → /admin/banks/[id]
app/(app)/admin/categories/page.tsx               → /admin/categories
app/(app)/admin/categories/[id]/page.tsx          → /admin/categories/[id]
app/(app)/admin/products/page.tsx                 → /admin/products
app/(app)/admin/products/[id]/page.tsx            → /admin/products/[id]
app/(app)/admin/products/images/page.tsx          → /admin/products/images
app/(app)/admin/products/import/page.tsx          → /admin/products/import
app/(app)/admin/sales-conditions/page.tsx         → /admin/sales-conditions
app/(app)/admin/sales-conditions/[id]/page.tsx    → /admin/sales-conditions/[id]
app/(app)/admin/components/page.tsx               → /admin/components
app/(app)/admin/factory-mapping/page.tsx          → /admin/factory-mapping
app/api/attachments/[id]/download/route.ts        → /api/attachments/[id]/download
app/api/conversations/[entity_type]/[entity_id]/route.ts → /api/conversations/[entity_type]/[entity_id]
```

**Notable absence:** There is **no `/documents` list page** — `app/(app)/documents/` contains
only `[id]/` and `new/` sub-directories. Quotations are reached via `/clients/[id]`
(expandable rows per client) and via `/documents/new` (create). There is also **no
`/admin/permissions` page** — `app/(app)/admin/permissions/` is an empty directory
with no `page.tsx`. The `/view-as` directory has only `actions.ts`; the View-As
UI is a dropdown inside the Nav component (not a standalone route).

---

## Redirect stubs

| Route | Redirects to | Source |
|---|---|---|
| `/` | `/dashboard` | `app/page.tsx` — `redirect("/dashboard")` |
| `/order-follow-up` | `/operations` | `app/(app)/order-follow-up/page.tsx` — merged into `/operations` |
| `/production/orders` (list) | `/operations` (passes through `?scope` and `?q` params) | `app/(app)/production/orders/page.tsx` |
| `/production/queue` | `/task-lists` | `app/(app)/production/queue/page.tsx` |
| `/permissions` | `/permissions/actions` | `app/(app)/permissions/page.tsx` |

All five are **[Confirmed by code]**.

---

## Route details

---

### `/login`

| Field | Value |
|---|---|
| **File** | `app/login/page.tsx` |
| **Purpose** | Supabase email/password sign-in. |
| **Access** | Unauthenticated users only (the `app/(app)/layout.tsx` redirects authenticated users away from this path via the auth check). |
| **Main user actions** | Enter email + password → submit → server action `login` from `app/login/actions.ts`. |
| **Related components** | Inline form (no external component). `bg-solux` Tailwind class applied to submit button. |
| **Related DB tables** | None directly; Supabase Auth handles the session. |
| **Notes** | Page subtitle still reads "Quotation tool" — a stale label from the original spec. The app has grown far beyond that scope. **[Confirmed by code]** |

---

### `/`

**REDIRECT STUB** — `app/page.tsx` immediately redirects to `/dashboard` with no
content. **[Confirmed by code]**

---

### `/dashboard`

| Field | Value |
|---|---|
| **File** | `app/(app)/dashboard/page.tsx` |
| **Purpose** | Primary home dashboard; role-shaped overview of quotations, production KPIs, events, and the Action Center. |
| **Access** | All authenticated roles (EFFECTIVE role used). Sales sees their own data; technical roles see global data or a filtered view via `?sales=`. |
| **Main user actions** | View KPIs; toggle Operations / Business mode; filter by sales rep (`?sales=`); click through to `/documents/[id]`, `/production/orders/[id]`, `/operations`. |
| **Related components** | `components/dashboard/OperationsCockpit.tsx`, `components/dashboard/OrdersInFlight.tsx`, `components/dashboard/PipelineChart.tsx`, `components/dashboard/WinRateDonut.tsx`, `components/dashboard/ActivityFeed.tsx`, `components/dashboard/KpiCard.tsx`, `components/dashboard/SalesFilterBar.tsx`, `components/dashboard/DashboardModeShell.tsx`, `components/action-center/ActionCenter.tsx`, `components/OperationsAlertBadge.tsx`, `components/forecast/ForecastStrip.tsx`, `components/forecast/ManagementForecastPanel.tsx`, `components/reminders/MyRemindersPanel.tsx` |
| **Related DB tables** | `documents`, `document_lines`, `products`, `clients`, `production_orders`, `production_task_lists`, `quotation_reminders`, `events`, `event_comments`, `user_roles` |
| **Server actions called** | `getOperationsActions` (`lib/action-center.ts`), `listRecentCriticalEvents`, `listOperationsFeed`, `getUnreadCommentCountsForUser` (all `lib/events.ts`), `getSalesUsersForFilter`, `getDocIdsOwnedBySales` (`lib/sales-filter.ts`) |
| **Visible issues or unclear behavior** | (1) Comment in code notes that a PostgREST embed failure previously caused the entire `docs` query to silently return `[]`, making all KPIs show 0 — a defensive retry pattern is in place. **[Confirmed by code]** (2) `won_at` column does not exist; "won in last 90 days" uses the `date` field as a proxy. **[Confirmed by code]** (3) Sales filter uses effective scope, which means a super-admin simulating sales correctly sees only the simulated user's data — but the underlying DB session is still real. **[Confirmed by code]** |

---

### `/dashboard-v2`

| Field | Value |
|---|---|
| **File** | `app/(app)/dashboard-v2/page.tsx` |
| **Purpose** | Experimental "Action Center" dashboard. Beta label displayed. Non-destructive — lives alongside `/dashboard`. |
| **Access** | All roles (same as `/dashboard`, EFFECTIVE role). |
| **Main user actions** | Toggle between Operations tab (Action Center list) and Business tab (basic KPIs). |
| **Related components** | `components/action-center/ActionCenterV2.tsx`, `components/dashboard/KpiCard.tsx` |
| **Related DB tables** | `documents`, `production_orders`, `production_task_lists` (via `getActionCenterV2` and inline query) |
| **Server actions called** | `getActionCenterV2` (`lib/action-center.ts`) |
| **Visible issues or unclear behavior** | Explicitly marked "Beta · V2" in UI. Business tab shows only 3 KPIs (`pipeline`, `won`, `activeCount`) — much less than `/business`. No sales filter or event feed. Page comment says "We'll progressively decide what belongs here vs. the classic view." **[Confirmed by code]** |

---

### `/business`

| Field | Value |
|---|---|
| **File** | `app/(app)/business/page.tsx` |
| **Purpose** | Executive / management KPI overview. Shows confirmed revenue (won quotations only), operational pipeline, task list breakdown, and per-sales performance. |
| **Access** | All roles (EFFECTIVE). Technical roles see company-wide view; sales sees personal view. No explicit redirect guard in body — relies on query scoping. **[Assumed from code]** |
| **Main user actions** | Read KPIs; click through to `/production/orders` (redirects to `/operations`) and `/task-lists?status=<status>`. |
| **Related components** | Inline `KpiCard` (defined in same file), `components/TaskListWorkflow.tsx` (for `TaskListStatusBadge`) |
| **Related DB tables** | `documents`, `production_task_lists`, `production_orders`, `user_roles` |
| **Visible issues or unclear behavior** | Revenue shown only for status `won`; all other statuses excluded. Archived docs excluded. Per-sales table visible only to `isTechnicalRole` users. Revenue comparison uses USD as primary currency; mixed currencies shown separately with no conversion. **[Confirmed by code]** |

---

### `/operations`

| Field | Value |
|---|---|
| **File** | `app/(app)/operations/page.tsx` |
| **Purpose** | Unified operational workspace. Consolidates what was formerly on `/operations` and `/order-follow-up`. Lists all production orders with KPI strip, action queue (top 5 alerts), orphan banner, bottleneck banner, scope tabs (`?scope=active|all|archived`), free-text search (`?q=`), and a compact event feed at the bottom. |
| **Access** | All authenticated roles. Technical roles see edit controls; sales sees read-only. Sales filter available to technical roles via `?sales=`. |
| **Main user actions** | Search/filter orders; click row to go to `/production/orders/[id]`; sync orphans (if `task_list.sync_orphans` capability present); switch scope tabs. |
| **Related components** | `components/dashboard/CompactOperationalEvents.tsx`, `components/dashboard/SalesFilterBar.tsx`, `components/OperationsAlertBadge.tsx`, `components/OrderStageBadge.tsx`, `components/StartWithoutDepositButton.tsx` (DepositOverrideBadge), `components/ScopeTabs.tsx`, `components/RoleContextBanner.tsx` |
| **Related DB tables** | `production_orders`, `production_task_lists`, `documents`, `clients`, `events`, `event_comments`, `user_roles` |
| **Server actions called** | `syncOrphanProductionOrdersAction` (from `app/(app)/task-lists/[id]/actions.ts`), `listOperationsFeed`, `getCommentCountsForEvents`, `getUnreadCommentCountsForUser` (all `lib/events.ts`) |
| **Visible issues or unclear behavior** | (1) Visibility scope (`lib/visibility.ts` m067) applied — orders filtered by `canSeeRecord`; but RLS does not enforce lens grants at DB level. **[Confirmed by code]** (2) The `?event=<id>` query param used to open an inline drawer; that drawer was removed — clicks now route to entity pages. Old bookmarks with `?event=` silently ignored. **[Confirmed by code]** |

---

### `/forecast`

| Field | Value |
|---|---|
| **File** | `app/(app)/forecast/page.tsx` |
| **Purpose** | Sales forecast workspace. Inline-editable table of active quotations (sent / negotiating) where sales sets probability, category, close date. KPI strip and breakdowns (by quarter, owner, country, family). |
| **Access** | All roles. `forecast.view_global` capability required for company-wide view (technical roles by default); sales sees own deals only. **[Confirmed by code]** |
| **Main user actions** | Edit forecast fields inline per quotation; view KPIs (weighted pipeline, committed, deal count). |
| **Related components** | `components/forecast/ForecastWorkspace.tsx`, `components/forecast/ForecastMethodology.tsx` |
| **Related DB tables** | `documents` (via `loadActiveQuotationsForForecast` in `lib/forecast-data.ts`), `user_roles` |
| **Visible issues or unclear behavior** | Only `sent` / `negotiating` status documents appear. Documents without probability set show as "unset" in the count. Owner labels resolved via `lib/user-display.ts` / `resolveOwnerLabels`. **[Confirmed by code]** |

---

### `/clients`

| Field | Value |
|---|---|
| **File** | `app/(app)/clients/page.tsx` |
| **Purpose** | Unified client-centric sales workspace. Each client row is expandable and shows quotation history inline. This is effectively the daily sales hub — there is no separate `/documents` list. |
| **Access** | All roles (RLS-scoped). Sales sees only clients they own or have quoted; technical roles see company-wide. Scope tabs: Active / All / Archived. |
| **Main user actions** | Browse/search clients; expand a client to see quotation history; create new client (via `NewClientPanel`); create new quotation from client row (if `quotation.create`). |
| **Related components** | `components/clients/NewClientPanel.tsx` (inline slide-in panel), `components/clients/ClientsWorkspaceList.tsx`, `components/ScopeTabs.tsx` |
| **Related DB tables** | `clients`, `documents` |
| **Visible issues or unclear behavior** | (1) Defensive select: if `archived_at` column missing (migration 031 not applied), falls back to legacy shape. **[Confirmed by code]** (2) Visibility scope m067 applied via `canSeeRow`. **[Confirmed by code]** |

---

### `/clients/[id]`

| Field | Value |
|---|---|
| **File** | `app/(app)/clients/[id]/page.tsx` |
| **Purpose** | Client workspace detail. Client identity + 4 KPI cards + quotation history table with inline status switcher per row, Won quick actions, context menu. BL summary section. Event timeline. |
| **Access** | All roles (RLS-scoped). `quotation.create` capability gates the "+ New quotation" CTA. |
| **Main user actions** | View client detail; switch quotation status inline; open document; duplicate; archive/unarchive client; view BL summary; open conversation drawer via `?event=`. |
| **Related components** | `components/StatusBadge.tsx`, `components/DocQuickActions.tsx`, `components/InlineStatusSwitcher.tsx`, `components/ContextMenu.tsx`, `components/ContextMenuActionItem.tsx`, `components/clients/ClientBlSummary.tsx`, `components/ScopeTabs.tsx`, `components/Timeline.tsx`, `components/dashboard/EventDiscussionPanel.tsx` |
| **Related DB tables** | `clients`, `documents`, `document_lines`, `events` |
| **Server actions called** | `deleteClientAction`, `archiveClientAction`, `unarchiveClientAction` (from `app/(app)/clients/[id]/actions.ts`) |
| **Visible issues or unclear behavior** | `?event=<uuid>` opens the `EventDiscussionPanel` overlay (conversation drawer entry point). `404` returned via `notFound()` if client not found. **[Confirmed by code]** |

---

### `/clients/[id]/edit`

| Field | Value |
|---|---|
| **File** | `app/(app)/clients/[id]/edit/page.tsx` |
| **Purpose** | Client edit form. Full field set including address, VAT, phone country code, BL profile, custom fields, and owner assignment. |
| **Access** | All authenticated users who can reach the client (RLS). Owner assignment visible only to `isTechnicalRole`. |
| **Main user actions** | Edit client fields; assign owner (if technical role); edit BL profile (`ClientBlEditor`); edit custom tax fields. |
| **Related components** | `components/forms/CountrySelect.tsx`, `components/forms/PhoneField.tsx`, `components/clients/ClientBlEditor.tsx`, `components/FocusOnLoad.tsx`, `components/OwnerAssignSelect.tsx` |
| **Related DB tables** | `clients`, `user_roles` (via `listAssignableOwners`) |
| **Server actions called** | `updateClientAction`, `assignClientOwner` (from `app/(app)/clients/actions.ts`) |
| **Visible issues or unclear behavior** | Defensive select: if `phone_country_code`, `address`, `vat_number`, `default_attention_to`, `bl_profile` columns missing (migration 036), falls back to legacy shape. **[Confirmed by code]** |

---

### `/documents` (list page)

**Does not exist.** There is no `app/(app)/documents/page.tsx`. Quotation lists are
surfaced via `/clients` (expandable rows per client) and `/clients/[id]` (client
workspace, scoped list). Users navigate to individual documents via `/documents/[id]`.
**[Confirmed by code — directory listing shows only `[id]/` and `new/` sub-dirs]**

> **Needs confirmation:** Is there any other intended entry point for a standalone
> quotation list page? The current UX routes all quotation browsing through the
> client workspace.

---

### `/documents/[id]`

| Field | Value |
|---|---|
| **File** | `app/(app)/documents/[id]/page.tsx` |
| **Purpose** | Quotation / document detail view. Shows full quotation with product lines, pricing, lifecycle stepper (draft → sent → won/lost), forecast panel, validation panel, reminders, versioning history, event timeline, and production order link. |
| **Access** | All roles (RLS-scoped). Admin/TLM see additional fields (margin, cost). |
| **Main user actions** | View quotation details; change status (inline switcher); generate PDF (`GeneratePdfButton`); archive/unarchive; delete (if `quotation.delete`); request/approve/reject validation; add reminders; assign owner; open event conversation drawer (`?event=`). |
| **Related components** | `components/StatusBadge.tsx`, `components/DocQuickActions.tsx`, `components/WorkflowStepper.tsx`, `components/Timeline.tsx`, `components/forecast/ForecastPanel.tsx`, `components/documents/QuotationVersionsPanel.tsx`, `components/validation/ValidationPanel.tsx`, `components/reminders/QuotationRemindersSection.tsx`, `components/reminders/ReminderDueBadge.tsx`, `components/OwnerAssignSelect.tsx`, `components/ContextMenu.tsx`, `components/dashboard/EventDiscussionPanel.tsx`, `components/ProductionOrderBadges.tsx` |
| **Related DB tables** | `documents`, `document_lines`, `document_containers`, `clients`, `products`, `bank_accounts`, `sales_conditions`, `product_categories`, `options`, `prices_version`, `product_costs`, `events`, `production_task_lists`, `production_orders` |
| **Server actions called** | `updateDocumentStatus`, `archiveQuotation`, `unarchiveQuotation`, `deleteQuotation`, `assignDocumentOwner` (from `app/(app)/documents/[id]/actions.ts`) |
| **Visible issues or unclear behavior** | Defensive fallback for missing columns (`attention_to` m036, `affair_name` m056, etc.). **[Confirmed by code]** `404` via `notFound()` if document not found. |

---

### `/documents/new`

| Field | Value |
|---|---|
| **File** | `app/(app)/documents/new/page.tsx` |
| **Purpose** | Create a new quotation. Also handles `?revise=<docId>` (create a new version of an existing affair, m059) and `?edit=<docId>` (continue editing a draft in-place). |
| **Access** | All roles with `quotation.create` capability (gated in the component; server action enforces). |
| **Main user actions** | Select client; add product lines; set pricing, payment mode, incoterm, currency, containers; save as draft or submit. |
| **Related components** | `components/NewDocumentForm.tsx` (large client component) |
| **Related DB tables** | `documents`, `document_lines`, `document_containers`, `clients`, `products`, `options`, `prices_version`, `bank_accounts`, `sales_conditions`, `product_categories` |
| **Visible issues or unclear behavior** | Defensive double-fetch if full column set (m037/m056 affair fields) missing. **[Confirmed by code]** |

---

### `/task-lists`

| Field | Value |
|---|---|
| **File** | `app/(app)/task-lists/page.tsx` |
| **Purpose** | Task list directory. Lists all visible task lists with status filter tabs and a sales multi-select filter (technical roles only). TLM queue items (under_validation) surface at top with visual priority. |
| **Access** | All roles (RLS-scoped). Sales sees only their own linked task lists; TLM/admin see all. |
| **Main user actions** | Filter by status (`?status=<status>`); filter by sales owner (`?sales=<id,id,...>`); click row to open task list detail. |
| **Related components** | `components/TaskListWorkflow.tsx` (TaskListStatusBadge), `components/task-lists/SalesFilter.tsx` |
| **Related DB tables** | `production_task_lists`, `documents`, `clients` |
| **Visible issues or unclear behavior** | Visibility scope m067 applied via `canSeeRecord`. Limit 200 rows — no pagination. **[Confirmed by code]** |

---

### `/task-lists/[id]`

| Field | Value |
|---|---|
| **File** | `app/(app)/task-lists/[id]/page.tsx` |
| **Purpose** | Task list detail. Shows all configuration lines, sticker requirements, risk flags, factory extras, validation workflow, PDF/Excel export, event timeline, conversation drawer. |
| **Access** | All roles can view (RLS-scoped). Sales is locked out of editing once status is in `TASK_LIST_LOCKED_FOR_SALES` set (`under_validation`, `validated`, `production_ready`, `cancelled`). Technical roles edit technical values, validate/reject. |
| **Main user actions** | Edit technical values (technical roles); validate / reject / request revision (TLM/admin); edit sticker/risk configs; generate factory PDF; export Excel; delete (if `task_list.delete`); open event conversation (`?event=`). |
| **Related components** | `components/TaskListWorkflow.tsx` (TaskListWorkflowActions, TaskListStatusBadge), `components/documents/ProductSummaryCard.tsx`, `components/attachments/AttachmentsPanel.tsx`, `components/documents/StickerRequirementsEditor.tsx`, `components/documents/RiskFlagsEditor.tsx`, `components/documents/ValidationHistory.tsx`, `components/Timeline.tsx`, `components/DangerDeleteButton.tsx`, `components/dashboard/EventDiscussionPanel.tsx` |
| **Related DB tables** | `production_task_lists`, `task_list_lines`, `documents`, `clients`, `products`, `config_fields`, `factory_mappings`, `events`, `attachments` |
| **Server actions called** | `deleteTaskList`, `updateTaskListHeader` (from `app/(app)/task-lists/[id]/actions.ts`) |
| **Visible issues or unclear behavior** | `TaskLineEditor.tsx` is a local component in the same directory (not in `components/`). `ExportPdfButton` and `ExportExcelButton` are also co-located. `404` via `notFound()` if task list not found. **[Confirmed by code]** |

---

### `/production/orders` (list)

**REDIRECT STUB** — redirects to `/operations`, passing through `?scope` and `?q`
query params. Comment: "The previous split created visual duplication — two pages
listing the same production orders." **[Confirmed by code]**

---

### `/production/orders/[id]`

| Field | Value |
|---|---|
| **File** | `app/(app)/production/orders/[id]/page.tsx` |
| **Purpose** | Production order operational cockpit for a single order. Shows lifecycle stepper, timeline card, live status sidebar, payment tracking, deadline/delay model, shipping details, delay breakdown log, event timeline, conversation drawer. |
| **Access** | All roles (sales: read-only, scoped to their quotations; TLM/admin: full edit). |
| **Main user actions** | Update status (technical roles, `production_order.edit_status`); set timeline / deadline (`production_order.set_timeline`); update payments (`production_order.edit_payments`); update shipment (`production_order.edit_shipment`); start without deposit (`production_order.start_without_deposit`); mark production complete; update balance reminder offset; open event conversation (`?event=`). |
| **Related components** | `components/ProductionOrderBadges.tsx`, `components/WorkflowStepper.tsx`, `components/production/OrderOperationsStrip.tsx`, `components/production/DelayTimelineCard.tsx`, `components/production/LiveStatusSidebar.tsx`, `components/Timeline.tsx`, `components/CancellationBanner.tsx`, `components/StartWithoutDepositButton.tsx`, `components/MarkProductionCompleteButton.tsx`, `components/OperationsAlertBadge.tsx`, `components/dashboard/EventDiscussionPanel.tsx`, `components/RoleContextBanner.tsx`, `components/OrderConfigSummary.tsx` |
| **Related DB tables** | `production_orders`, `production_deadline_changes`, `documents`, `clients`, `production_task_lists`, `events` |
| **Server actions called** | `updateProductionOrderStatus`, `updateProductionOrderPayments`, `updateProductionOrderShipment`, `setProductionTimeline`, `updateBalanceReminderOffset` (from `app/(app)/production/orders/actions.ts`) |
| **Visible issues or unclear behavior** | (1) Sales is never redirected away — the page renders read-only for sales. **[Confirmed by code]** (2) `?event=<uuid>` opens the `EventDiscussionPanel` overlay. **[Confirmed by code]** (3) `404` via `notFound()` if order not found. |

---

### `/production/queue`

**REDIRECT STUB** — redirects to `/task-lists`. Comment: "The separate 'Review queue'
page was retired — its job now lives directly inside /task-lists." **[Confirmed by code]**

---

### `/order-follow-up`

**REDIRECT STUB** — redirects to `/operations`. Comment: "Consolidated into /operations
to eliminate visual duplication." **[Confirmed by code]**

---

### `/factory-mapping`

| Field | Value |
|---|---|
| **File** | `app/(app)/factory-mapping/page.tsx` |
| **Purpose** | Per-option factory instructions editor. Maps product dropdown option values to factory execution instructions. Only dropdown options covered (not text/number/checkbox fields). |
| **Access** | Gated in-body: `isTechnicalRole(role) \|\| hasUiCapability("factory_mapping.access")` — redirects to `/dashboard` if neither. **[Confirmed by code]** Sales cannot access. |
| **Main user actions** | View/edit factory mapping instructions per option value. |
| **Related components** | `components/factory-mapping/MappingRow.tsx` (co-located in `app/(app)/factory-mapping/`, not `components/`) |
| **Related DB tables** | `product_categories`, `config_fields`, `config_field_options`, `factory_mappings` |
| **Visible issues or unclear behavior** | This route lives **outside** `/admin` deliberately so TLM can reach it without the admin layout guard. Also has a mirror under `/admin/factory-mapping`. **[Confirmed by code]** |

---

### `/permissions`

**REDIRECT STUB** — redirects to `/permissions/actions`. **[Confirmed by code]**
The `/permissions/layout.tsx` provides the tab shell and gates on `admin.manage_permissions`.

---

### `/permissions/actions`

| Field | Value |
|---|---|
| **File** | `app/(app)/permissions/actions/page.tsx` |
| **Purpose** | Capability matrix editor. Grid of all 22 capability keys (rows) × 4 roles (columns). Checkboxes bound to `role_permissions.enabled`. Saving persists the full matrix, clears the capability cache, emits a high-severity audit event, and revalidates all routes. |
| **Access** | `admin.manage_permissions` capability (View-As faithful gate in layout + `requireCapability` in server action). **[Confirmed by code]** |
| **Main user actions** | Toggle capability checkboxes; submit to persist the full matrix. |
| **Related components** | `components/SubmitButton.tsx` (inline form) |
| **Related DB tables** | `permissions_catalog`, `role_permissions` |
| **Server actions called** | `updatePermissionsMatrix` (from `app/(app)/permissions/actions/actions.ts`) |
| **Visible issues or unclear behavior** | Two-layer gate: layout redirects via `hasUiCapability` (View-As faithful); action calls `requireCapability` (real role). Cache cleared immediately on save so changes take effect in current process. **[Confirmed by code]** |

---

### `/permissions/teams`

| Field | Value |
|---|---|
| **File** | `app/(app)/permissions/teams/page.tsx` |
| **Purpose** | Teams & Access visibility admin (m067). Two blocks: (1) create/edit teams, add members with role; (2) assign access grants to individual users (own / team / region / lens / all). |
| **Access** | `admin.manage_permissions` (gate in layout). **[Confirmed by code]** |
| **Main user actions** | Create team; add/remove team members; add/remove visibility grants per user. |
| **Related components** | `components/permissions/GrantForm.tsx` |
| **Related DB tables** | `teams`, `team_members`, `access_grants`, `user_roles` (via `listAssignableOwners`) |
| **Server actions called** | `createTeam`, `deleteTeam`, `addTeamMember`, `removeTeamMember`, `addGrant`, `removeGrant` (from `app/(app)/permissions/teams/actions.ts`) |
| **Visible issues or unclear behavior** | Visibility grants are app-level only (not RLS). The page itself notes: "The engine (lib/visibility.ts) reads these rows. Until a user has grants, they keep today's behavior." **[Confirmed by code]** |

---

### `/admin/users`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/users/page.tsx` |
| **Purpose** | User management. Lists all rows in `user_roles`. Per user: role dropdown (4 assignable roles), super_admin toggle, display name. |
| **Access** | `admin.manage_users` capability (both `hasUiCapability` redirect gate and `requireCapability` real-role throw). **[Confirmed by code]** |
| **Main user actions** | Assign role; toggle super_admin; set display name. Self-edit disabled in forms. |
| **Related components** | `components/SubmitButton.tsx` |
| **Related DB tables** | `user_roles` |
| **Server actions called** | `setUserRole`, `toggleSuperAdmin`, `setUserDisplayName` (from `app/(app)/admin/users/actions.ts`) |
| **Visible issues or unclear behavior** | Users identified by 8-char UUID prefix — no email display. No "invite" flow. Last super-admin cannot be demoted (server action checks count). Self-edit disabled (server action also blocks it). **[Confirmed by code]** |

---

### `/admin/diagnostics`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/diagnostics/page.tsx` |
| **Purpose** | System health checks and lifecycle inspector. Three sections: (A) health counters (orphaned task lists/POs, lifecycle mismatches, users without roles); (B) lifecycle state machine diagram; (C) entity inspector (paste ID → see full cross-table state + event timeline). |
| **Access** | `admin.diagnostics` capability. Tab hidden from nav (route-only). **[Confirmed by code]** |
| **Main user actions** | View health counts; inspect specific entity by ID. |
| **Related components** | `app/(app)/admin/diagnostics/HealthSection.tsx`, `app/(app)/admin/diagnostics/LifecycleSection.tsx`, `app/(app)/admin/diagnostics/InspectorSection.tsx` (co-located, not in `components/`) |
| **Related DB tables** | `production_task_lists`, `production_orders`, `documents`, `clients`, `user_roles`, `events` |
| **Visible issues or unclear behavior** | Also gated by admin layout (`isAdminLike` check in `app/(app)/admin/layout.tsx`). The `admin.diagnostics` capability provides finer-grained control on top. **[Confirmed by code]** |

---

### `/admin/diagnostics/reset`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/diagnostics/reset/page.tsx` |
| **Purpose** | Development data reset. Wipes operational/business data (documents, task lists, production orders, events) while preserving infrastructure (auth, roles, permissions, products, config, factory mappings). Requires typing "RESET" to confirm. |
| **Access** | `admin.diagnostics` capability (same gate). Super-admin only by default. **[Confirmed by code]** |
| **Main user actions** | View live counts of what will be deleted; type "RESET" confirmation; submit. |
| **Related components** | `components/SubmitButton.tsx` |
| **Related DB tables** | All operational tables (via `admin_reset_execute` SECURITY DEFINER RPC — m033–m035) |
| **Server actions called** | `runDevResetAction` (from `app/(app)/admin/diagnostics/reset/actions.ts`) |
| **Visible issues or unclear behavior** | Goes through `admin_reset_execute` RPC which runs atomically in a transaction and bypasses RLS. Emits a single audit event after the wipe. Not reachable from nav tabs. **[Confirmed by code]** |

---

### `/admin/banks`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/banks/page.tsx` |
| **Purpose** | Bank accounts management. Lists all bank accounts grouped by currency. Create new account; delete; set default. |
| **Access** | `isAdminLike` redirect in body. Admin layout also gates. **[Confirmed by code]** |
| **Main user actions** | Create bank account; delete; set default account per currency. |
| **Related components** | Inline form |
| **Related DB tables** | `bank_accounts` |
| **Server actions called** | `createBankAccount`, `deleteBankAccount`, `setDefaultBankAccount` (from `app/(app)/admin/banks/actions.ts`) |

---

### `/admin/banks/[id]`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/banks/[id]/page.tsx` |
| **Purpose** | Edit a single bank account (all fields including `business_account_name` from m038). |
| **Access** | Admin layout gate. No in-body role check observed. **[Assumed from code — relies on layout guard]** |
| **Main user actions** | Edit bank account fields; save. |
| **Related components** | Inline form |
| **Related DB tables** | `bank_accounts` |
| **Server actions called** | `updateBankAccount` (from `app/(app)/admin/banks/actions.ts`) |
| **Visible issues or unclear behavior** | Defensive fallback if `business_account_name` column missing. **[Confirmed by code]** |

---

### `/admin/categories`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/categories/page.tsx` |
| **Purpose** | Product category list. Shows all categories with product count and field count. Create new category. |
| **Access** | `isAdminLike` redirect in body + admin layout. **[Confirmed by code]** |
| **Main user actions** | Create category; click through to category detail. |
| **Related components** | Inline |
| **Related DB tables** | `product_categories`, `products`, `config_fields` |
| **Server actions called** | `createCategory` (from `app/(app)/admin/categories/actions.ts`) |

---

### `/admin/categories/[id]`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/categories/[id]/page.tsx` |
| **Purpose** | Category detail editor. Shows all config fields with their options; create/edit/delete fields and options. |
| **Access** | Admin layout gate. No in-body role check observed. **[Assumed — relies on layout guard]** |
| **Main user actions** | Rename category; delete category; add/edit/reorder config fields; add/delete field options. |
| **Related components** | `app/(app)/admin/categories/[id]/FieldEditor.tsx` (co-located) |
| **Related DB tables** | `product_categories`, `config_fields`, `config_field_options`, `products` |
| **Server actions called** | `deleteCategory`, `renameCategory` (from `app/(app)/admin/categories/actions.ts`) |

---

### `/admin/products`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/products/page.tsx` |
| **Purpose** | Product catalog list. All products with SKU, cost, tier prices (including future-dated). Create new product. |
| **Access** | `isAdminLike` redirect in body + admin layout. **[Confirmed by code]** |
| **Main user actions** | Create product; click through to product detail. |
| **Related components** | Inline |
| **Related DB tables** | `products`, `product_costs`, `prices_version` |
| **Server actions called** | `createProduct` (from `app/(app)/admin/products/actions.ts`) |

---

### `/admin/products/[id]`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/products/[id]/page.tsx` |
| **Purpose** | Product edit. All product fields, options, price versions, cost. |
| **Access** | Admin layout gate. No in-body role check observed. **[Assumed — relies on layout guard]** |
| **Main user actions** | Edit product metadata; add/delete options; add/delete price version; update cost. |
| **Related components** | Inline |
| **Related DB tables** | `products`, `options`, `prices_version`, `product_costs`, `product_categories` |
| **Server actions called** | `updateProduct`, `deleteProduct`, `addOption`, `deleteOption`, `addPriceVersion`, `deletePriceVersion` (from `app/(app)/admin/products/actions.ts`) |

---

### `/admin/products/images`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/products/images/page.tsx` |
| **Purpose** | Bulk upload product images. Maps uploaded images to products by SKU. |
| **Access** | **LAYOUT GUARD ONLY.** No in-body role check. Relies entirely on `app/(app)/admin/layout.tsx` (`isAdminLike` check). **[Confirmed by code — page.tsx has no auth/capability check]** |
| **Main user actions** | Select images; map to product by SKU; upload to Supabase Storage. |
| **Related components** | `app/(app)/admin/products/images/ImagesUploadClient.tsx` (co-located client component) |
| **Related DB tables** | `products`; Supabase Storage bucket for images |
| **Visible issues or unclear behavior** | **Security note:** if the admin layout guard changes, this page would be reachable by non-admin roles without any in-body protection. Defense-in-depth in-body check is absent. **[Confirmed by code]** |

---

### `/admin/products/import`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/products/import/page.tsx` |
| **Purpose** | Bulk product import (presumably CSV/spreadsheet). |
| **Access** | **LAYOUT GUARD ONLY.** The page.tsx has absolutely no auth check — not even `getEffectiveRole()` is called. Relies entirely on the admin layout. **[Confirmed by code — page.tsx body is just `return <ImportClient />`]** |
| **Main user actions** | Upload and import product data. |
| **Related components** | `app/(app)/admin/products/import/ImportClient.tsx` (co-located client component) |
| **Related DB tables** | `products`, `options`, `prices_version` (Needs confirmation — depends on ImportClient implementation) |
| **Visible issues or unclear behavior** | **Security note:** Same gap as `/admin/products/images` — no defense-in-depth. If the admin layout guard is bypassed or changed, this route is fully unprotected at the page level. **[Confirmed by code]** |

---

### `/admin/sales-conditions`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/sales-conditions/page.tsx` |
| **Purpose** | Sales conditions library. Lists reusable T&C paragraphs appended to quotations. Create; delete; set default. |
| **Access** | `isAdminLike` redirect in body + admin layout. **[Confirmed by code]** |
| **Main user actions** | Create sales condition; delete; set default. |
| **Related components** | Inline |
| **Related DB tables** | `sales_conditions` |
| **Server actions called** | `createSalesCondition`, `deleteSalesCondition`, `setDefaultSalesCondition` (from `app/(app)/admin/sales-conditions/actions.ts`) |

---

### `/admin/sales-conditions/[id]`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/sales-conditions/[id]/page.tsx` |
| **Purpose** | Edit a sales condition (title + rich-text content + default flag). |
| **Access** | Admin layout gate. No in-body role check observed. **[Assumed — relies on layout guard]** |
| **Main user actions** | Edit title and content; save. |
| **Related components** | Inline |
| **Related DB tables** | `sales_conditions` |
| **Server actions called** | `updateSalesCondition` (from `app/(app)/admin/sales-conditions/actions.ts`) |

---

### `/admin/components`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/components/page.tsx` |
| **Purpose** | Component mappings editor. Dictionary of commercial name → internal factory reference, used by TLM to translate simplified sales descriptions into production references during task list enrichment. |
| **Access** | `isTechnicalRole` check in body (redirects to `/admin/products` if not); admin layout also gates admin-likes. **[Confirmed by code]** |
| **Main user actions** | Create component mapping; edit (inline); delete; filter by category. |
| **Related components** | Inline |
| **Related DB tables** | `component_mappings` |
| **Server actions called** | `createComponentMapping`, `deleteComponentMapping`, `updateComponentMapping` (from `app/(app)/admin/components/actions.ts`) |
| **Visible issues or unclear behavior** | Unusual gate: `isTechnicalRole` means TLM and operations can access this, not just admin-like. The redirect goes to `/admin/products` (not `/dashboard`) for non-technical roles, which itself is admin-gated — an unnecessary double redirect. **[Confirmed by code]** |

---

### `/admin/factory-mapping`

| Field | Value |
|---|---|
| **File** | `app/(app)/admin/factory-mapping/page.tsx` |
| **Purpose** | Same content as `/factory-mapping` but embedded under the `/admin` tab shell. Allows admin users to manage factory mappings via the admin nav. |
| **Access** | `isTechnicalRole` check in body (redirects to `/admin/products` if not); admin layout gates admin-likes. **[Confirmed by code]** |
| **Main user actions** | View/edit factory mapping instructions per product option value. |
| **Related components** | `app/(app)/admin/factory-mapping/MappingRow.tsx` (co-located) |
| **Related DB tables** | `product_categories`, `config_fields`, `config_field_options`, `factory_mappings` |
| **Visible issues or unclear behavior** | Near-duplicate of `/factory-mapping`. Both exist: the top-level route is for TLM who lack the admin layout access; the admin route appears in the admin tab bar for admin-level users. **[Confirmed by code]** |

---

### `/admin/diagnostics` (see above under `/admin/diagnostics`)

---

### `/api/attachments/[id]/download`

| Field | Value |
|---|---|
| **File** | `app/api/attachments/[id]/download/route.ts` |
| **Purpose** | On-demand attachment download. Verifies auth; loads attachment row (RLS-scoped); mints a short-lived Supabase Storage signed URL; redirects to it. Returns a clean "File unavailable" HTML page on failure. |
| **Access** | Authenticated users only. RLS policy (m060) allows uploader, affair owner, and technical roles. **[Confirmed by code]** |
| **Main actions** | `GET` only. |
| **Related DB tables** | `attachments`; Supabase Storage (`ATTACHMENTS_BUCKET` from `lib/attachments.ts`) |
| **Visible issues or unclear behavior** | Method: only `GET` handler defined — no `POST/PUT/DELETE`. Signed URL is always fresh (no expiry race). **[Confirmed by code]** |

---

### `/api/conversations/[entity_type]/[entity_id]`

| Field | Value |
|---|---|
| **File** | `app/api/conversations/[entity_type]/[entity_id]/route.ts` |
| **Purpose** | Conversation thread API. Returns full `entity_messages` thread (oldest→newest, with author labels), unread count, entity title, and current user ID for the floating ConversationLauncher drawer. |
| **Access** | Authenticated users only (RLS does the row-level scoping). |
| **Main actions** | `GET` only. |
| **Related DB tables** | `entity_messages` (m049), `user_roles` |
| **Supported entity types** | `document`, `task_list`, `production_order`, `client` **[Confirmed by code]** |
| **Visible issues or unclear behavior** | Soft-fails if m049 not applied (returns empty messages + 0 unread). Invalid `entity_type` returns `400`. Missing `entity_id` returns `400`. **[Confirmed by code]** |

---

## Cross-cutting structural notes

### 1. No `/documents` list page

**[Confirmed by code]** — `app/(app)/documents/` has no `page.tsx`. All quotation
browsing is via `/clients` (expandable rows per client). Users who bookmark a
quotation directly reach it at `/documents/[id]`. There is no way to list all
quotations independently of a client from the UI.

> **Needs confirmation:** Is a standalone quotation list page planned or
> intentionally omitted? The `/clients` page currently serves as the de-facto
> quotation browser.

### 2. No `/view-as` page route

`app/(app)/view-as/` has only `actions.ts` — no `page.tsx`. View-As simulation is
exposed via the `ViewAsSwitcher` dropdown in the Nav component
(`components/ViewAsSwitcher.tsx`), which calls `setViewAsRole` / `clearViewAsRole`
server actions. There is no standalone `/view-as` page. **[Confirmed by code]**

### 3. No `/admin/permissions` page

`app/(app)/admin/permissions/` is an empty directory with no files. The
permissions matrix is under `/permissions/actions` (not under `/admin`). The admin
layout tab bar links to `/factory-mapping` for factory config but does not include
a permissions tab. **[Confirmed by code]**

### 4. `admin/products/images` and `admin/products/import` — layout guard only

Both pages have **no in-body role check**. They depend entirely on
`app/(app)/admin/layout.tsx` (`isAdminLike` redirect). If the layout guard were
bypassed (e.g., a future layout restructure or direct API call), these routes
would be unprotected at the page level. **[Confirmed by code — both page.tsx files
have zero auth calls]**

### 5. Redirect stub summary

Five redirect stubs exist [all Confirmed by code]:
- `/` → `/dashboard`
- `/order-follow-up` → `/operations`
- `/production/orders` (list) → `/operations` (with passthrough of `?scope`, `?q`)
- `/production/queue` → `/task-lists`
- `/permissions` → `/permissions/actions`

### 6. `/factory-mapping` vs `/admin/factory-mapping` — duplication

The same mapping editor exists at two routes. The top-level `/factory-mapping`
is outside the admin layout so TLM can access it; `/admin/factory-mapping` is
inside the admin tab shell for admin users. Both use `isTechnicalRole` for their
body guard. **[Confirmed by code]**

### 7. `production` directory has no top-level page

`app/(app)/production/` has no `page.tsx` — only `orders/` and `queue/`
subdirectories. Both are redirect stubs. **[Confirmed by code]**

### 8. ConversationLauncher is a global persistent component

`components/chat/ConversationLauncher.tsx` is mounted in the root layout
(`app/(app)/layout.tsx`) and persists across all routes. It maps the current URL
to an entity and renders the floating chat button. **[Confirmed by code]**

---

## Needs confirmation

1. **No `/documents` list page** — Is a standalone quotation list intended to
   be absent permanently, or is one planned? Currently the only way to browse
   quotations is through `/clients`.

2. **`/admin/products/images` and `/admin/products/import` have no in-body
   auth guard** — Intentional (rely solely on the admin layout)? Recommend
   adding defense-in-depth in-body checks.

3. **`/admin/permissions` empty directory** — Is this a leftover placeholder
   or was it once used? It currently has no files.

4. **`production_order.*` capability defaults between TLM and operations** —
   Which capabilities does each role hold by default? The `role_permissions`
   seed (m026 / m053) is the source of truth; this cannot be confirmed from
   route code alone.

5. **`/business` has no explicit redirect guard for non-admin roles** — All
   roles can render it (scoped to personal view for non-technical). Is this
   intentional (personal view is useful for all), or should certain roles be
   excluded?
