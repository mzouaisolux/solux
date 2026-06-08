# Operational Stabilization Roadmap

> Generated 2026-06-01 from a read-only 4-area review (lifecycle · permissions · shipping/BL ·
> notifications) on top of `docs/LIFECYCLE_AUDIT.md`. Ranked by **daily-usage impact ÷ effort**,
> respecting dependencies and readiness. **No code was changed to produce this.**
>
> **Already fixed (not re-listed):** #1 BL "missing" card key bug (`action-center.ts` forwarder/vessel) ·
> #2 quotation deletion lockdown (Decision F, + pending m078) · #4 status-machine guards H1/H2/H3
> (`DocStatusActions` + `updateDocumentStatus`).
>
> Effort key: **S** ≈ ≤1h · **M** ≈ half-day · **L** ≈ multi-day.

## Recommended first move
**PERM-2** — the permissions matrix can permanently lock out the super-admin in one accidental save, and
there is **no in-app recovery** (you'd need raw DB access). Tiny, one obviously-correct behavior, no
business decision. It's the safety floor — do it first, then sweep the other S-effort ready wins.

---

## A. Ready to fix now (no owner decision needed)
These enforce already-decided rules or fix pure correctness/parity. Suggested execution order:

| # | ID | Area | Impact | Effort | Daily symptom → fix |
|---|----|------|--------|--------|---------------------|
| 1 | **PERM-2** | perms | High | S | A super-admin can uncheck `super_admin:admin.manage_permissions` and save → the only UI that re-enables it is gone forever. **Fix:** in `updatePermissionsMatrix` (`app/(app)/permissions/actions/actions.ts`) force the super_admin management row to stay enabled before the upsert (line ~100); render that column disabled+checked. |
| 2 | **SHIP-1** | ship | High | S | Consignee + Notify Party aren't shown on the production order, so ops copies them by hand from another tab to build the BL packet. **Fix:** render the existing `components/clients/ClientBlSummary.tsx` in the Shipment section of `production/orders/[id]/page.tsx` (client `bl_profile` already available) + "Edit BL parties →" deep-link. No migration. |
| 3 | **PERM-1** (=M13) | perms | High | S | `duplicateDocument` (clients/actions.ts:55, dashboard/actions.ts:7) skips the `quotation.create` gate and emits no `doc.created` audit event — a common daily action with no trail. **Fix:** add `requireCapability('quotation.create')` + emit an event, mirroring `saveDocument`; consolidate the two copies. |
| 4 | **SHIP-2** (⊂M17) | ship | High | S | Saving BL number / forwarder / vessel / weights emits **no** event (only booking/ETD/ETA do) — the BL packet is filled in silently, no feed/audit. **Fix:** in `updateProductionOrderShipment` extend the prev-select to `shipping_details`, diff it, push changed BL keys into `changedFields` (or emit `po.bl_updated`). |
| 5 | **H7** | notif | High | M | The bell only counts unread **comments** — high/critical event *creation* (TL validated, validation requested, deadline changed, cancellation) raises nothing, so people who must act aren't alerted. Decision D already says it should. **Fix:** add an event-creation source to `getNotificationSummary`, RLS-scoped, deduped via event_reads. *(Do with H8.)* |
| 6 | **H8** | notif | High | M | The **canonical** `entity_messages` chat (Decision C) never raises the bell — a colleague's message notifies no one. **Fix:** aggregate unread entity_messages into the bell (read-state plumbing already exists); verify RLS parity so counts can't leak across sales isolation. *(One pass with H7.)* |
| 7 | **M6** | lifecycle | Med | S | Baseline "lock" is UI-only — `setProductionTimeline` still overwrites `production_working_days` after activation, so a stale re-save silently corrupts the delay baseline. **Fix:** guard with the existing `isBaselineLocked()` helper server-side. |
| 8 | **PERM-3** | perms | Med | S | Permission-denied messages link to `/admin/permissions`, which 404s (real page is `/permissions`). **Fix:** string fix in `lib/permissions.ts:205` + `app/(app)/error.tsx:105`. |
| 9 | **NOTIF-1** | notif | Low | S | The TLM "N task lists awaiting review" bell item dumps you on the full list instead of the queue. **Fix:** deep-link to `/task-lists/<id>` (count 1) or `?status=under_validation` (count >1) in `buildReviewNotification`. |
| 10 | **SHIP-7** | ship | Low | S | `FreightType` union omits `40ft` that `ContainerType`/DB allow → a 40ft container writes an out-of-union value (`as any`). **Fix:** add `40ft` to the union in `lib/types.ts`. |

**Natural batches:** ① safety+parity S-wins → PERM-2, PERM-3, PERM-1, M6, NOTIF-1, SHIP-7. ② shipping
S-wins → SHIP-1, SHIP-2. ③ notification bell (M) → H7 + H8 together (shared merged unread model).

---

## B. Needs your decision first
Each carries the precise question. **High leverage:** one ruling on "what does *production complete*
mean" collapses **H5 + H6 + M4 + M5** into a single `getLifecyclePhase` change.

### B1. Completion-divergence cluster (decide once → fixes 4)
- **H5** (High, M) — Forward status jumps skip `production_completed`; dashboards say "done" while the PO
  page re-offers a Mark-Complete that *regresses* a shipped/delivered order.
- **H6** (Med, M) — DB never pairs `status=production_completed` with `actual_completion_date`; the two
  can diverge (reachable via forward jumps and `updateProductionOrderDeadline`).
- **M4** (Med, S) — Action Center fires "production late" on an already-shipped order (suppression keys
  only on `status==='production_completed'`).
- **M5** (Med, S) — A `delivered` PO with no `actual_completion_date` still shows a live in-production
  timeline + Mark-Complete CTA.
- **❓Question:** Is "production complete" defined by `status === production_completed` or by
  `actual_completion_date`? Must the two always coexist? May ops jump `in_production → shipped/delivered`
  directly (skipping `production_completed`), or must it always pass through (stamping the date)? Do
  downstream shipping statuses count as production-complete for lateness?

### B2. Other lifecycle / state-machine
- **M2** (Med, M) — PO status is fully freeform (any→any chip strip); a misclick can un-terminal a
  delivered order or rewind it. **❓** Is unrestricted skipping intended? At least confirm backward/
  un-terminal jumps? Which edges to block (keeping →cancelled)?
- **M8** (Med, M) — PO auto-create at TL validation can silently no-op → a validated task list with no
  production order, invisible until an admin runs orphan-sync. **❓** Raise a persistent alert? Hard-fail
  the validation transition if the PO can't be created?
- **M7** (Med, S) — "Production late" counts purely-external ETA drift (payment/shipping/customs) as
  factory lateness, poisoning the factory KPI. **❓** Should past-an-external-ETA fire the factory alert
  at all, or surface as a separate external/amber signal?
- **M1** (Low, M) — Document inline switcher still allows backward/illegal sales transitions (dangerous
  paths already guarded by #4). **❓** True state machine, or freeform by design? *(Decide with M2.)*

### B3. Permissions policy
- **M18** (High, S) — `operations` users see the task-list line editors but RLS rejects the save (silent
  partial failure). **❓** May `operations` edit task-list line technical data? *(Almost certainly yes —
  `isTechnicalRole`/`requireTaskListManagerOrAdmin` already include operations everywhere else; then add
  `operations` to the `production_task_list_lines` RLS policy.)*
- **PERM-6** (Med, S) — No daily-workflow role can manage users (`admin.manage_users` is super-admin-only;
  Users tab hidden from admins) → onboarding bottlenecks on one account. **❓** Should regular admins
  manage users/roles? *(If yes, grant the capability AND relax the `admin_set_user_role` RPC together.)*
- **PERM-4** (Med, S) — `operations` capability rows exist only via fragile migration-order TLM mirroring;
  a future capability could under-seed it (fails closed). **❓** Should operations mirror task_list_manager
  exactly, or own a distinct subset? *(Then convert to an explicit idempotent seed; live-DB check first.)*
- **PERM-5** (Med, S) — `production_order.unlock_baseline` is referenced in code/docs but never defined or
  seeded (the documented unlock escape hatch does nothing). **❓** Add a real admin unlock capability, or
  delete the stale references?
- **PERM-7** (Low, M) — View-As can't preview capability-gated *edit* pages (guards use the effective
  admin-like role). **❓** Faithful read-only role simulation, or accept View-As as nav-preview + test with
  real accounts (Decision E)?

### B4. Shipping / BL data model (decide together; one Shipment-editor pass)
- **SHIP-3** (Med, M) — Shipping marks / case marks not modeled (jammed into ambiguous notes). **❓**
  Structured field? Per-shipment on the order, or reusable per-client default?
- **SHIP-4** (Med, M) — No place for actual container / seal numbers. **❓** Capture per shipment?
  Pre-seed rows from the quote's planned container plan?
- **SHIP-5** (Med, S) — Two undelineated notes fields (`bl_profile.notes` vs order `shipping_notes`); no
  canonical home for BL instructions. **❓** Which is canonical, and how to relabel the other?
- **SHIP-6** (Low, M) — An LCL row mixed with FCL rows loses the LCL signal → "BL missing" card may never
  fire. **❓** Can LCL legitimately co-exist with full-container rows? *(Then derive the signal from the
  container rows.)*

### B5. Notification durability
- **M17** (Med, M) — Reopen looks like fresh validation; TL line/risk edits emit nothing (BL slice already
  carved out as SHIP-2). **❓** Which transitions are audit-worthy? *(More valuable once H7 lands.)*
- **M16** (Med, M) — All event emission is best-effort; a swallowed failure permanently drops the row from
  feed **and** bell. **❓** Which event types must NOT fail silently (cancellation/deadline/validation set)?

---

## Dependency notes
- **H7 + H8** → build in one pass (single merged unread bell model).
- **H5 / H6 / M4 / M5** → one canonical-completion decision, then a shared `getLifecyclePhase` change.
- **M1 + M2** → decide the state-machine question together.
- **SHIP-3 / SHIP-4 / SHIP-5 (/ SHIP-1)** → one Shipment-editor extension once the model is decided.
- **PERM-6** → matrix seed + RPC gate must change in lockstep.
