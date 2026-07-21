# HANDOVER — Ops Dense Production-Order Cockpit (+ Factory Build Sheet PDF)

**Date:** 2026-07-16
**Repo:** `~/dev/facturation` (git) — **canonical**. NEVER work in the iCloud CWD copy (stale duplicate).
**Branch:** `packing-module/phase1` · **HEAD:** `9f0e0f5`
**Backend for dev:** LOCAL Supabase (Docker) at `http://127.0.0.1:54321`, env file `.env.development.local`. Dev server: `npm run dev` → `localhost:3000`.
**Primary test order:** `PO-SLX-AFR-26-002`, id `dc595d47-0174-4a69-a158-3fcb6c6b8004`, client **AFRICA ENERGY SARL (AFR)**, Benin.

---

## 0. Continue from here (read this first)

> **UPDATE 2026-07-21** — this snapshot is kept as written, but two things below
> are now out of date:
> * The cockpit work is **committed** (see §10 / §15 "uncommitted" — no longer true).
> * The §11 unused-code cleanup is **done**, and went slightly further:
>   `fmtLongDate` was dead too, and dropping `total` made `breakdown` dead, so
>   `initialDeadline` / `actualCompletion` / `breakdown` were removed from
>   `DelayTimelineCard`'s props **and** from the call site in `page.tsx`.
>   `npx tsc --noEmit` back to the healthy 14 pre-existing `e2e/` errors, 0 ours.
>
> Also settled on 2026-07-21, for the document-preview workstream:
> a PDF `<iframe src="/api/documents/…/pdf">` **never navigates** in the owner's
> Chrome (no load event, no network request — subframe navigation to a PDF is
> filtered browser-side). Previews now fetch the file and hand the iframe a
> `blob:` URL — see `components/documents/PreviewOverlay.tsx`.

The Production-Order detail page `/production/orders/[id]` was rebuilt into the owner's **"Ops Dense" single-screen tabbed cockpit**, made "copie conforme" of the owner's mockup HTML (`~/Downloads/PO-SLX-AFR-26-002 Ops Dense - standalone.html`). All 6 tabs match the mockup's layout. Everything compiles and the forms work.

**The work is UNCOMMITTED in the working tree** (5 modified files + 1 new file — see §10). Next session should:

1. **Optionally clean up now-unused code** (§11) — safe, low-risk, avoids Next-build eslint noise.
2. **Optional last-mile mockup polish** (§5) — a couple of micro-details remain (e.g. the small "ADD A DELAY EVENT" sub-label the mockup omits).
3. **Decide whether to commit** this cockpit work (the owner has been iterating live; ask before committing — see [[never-stash-facturation]] rule).
4. Keep testing against the **REAL** order via the owner's own Chrome (already logged in — the `mcp__claude-in-chrome__*` tools). The e2e storageStates (`e2e/.auth/*.json`) are **EXPIRED** — do not rely on them.

**Where we literally stopped:** just finished two owner-requested tweaks on the Production tab — (a) replaced the "Baseline" baseline-row cell with a **"Due completion"** cell, and (b) converted the delay form's "number of days" input into a **date picker** (pick the new due date; `days_added` is derived). Also cleaned up a **spurious +4d delay event** that got created during testing (fully reverted — see §6).

---

## 1. Overall project status

- **App:** SOLUX internal ERP / quotation+production tool (Next.js 14.2.35 App Router, Supabase, Tailwind + a scoped "premium" design system).
- **This workstream:** UI/UX redesign of the **Production Order cockpit** (`/production/orders/[id]`) into a dense, single-screen, tabbed "workspace", plus (earlier, likely committed as `1d7fc33`) a **compact "Factory Build Sheet" redesign of the Production Dossier PDF**.
- **State:** Ops Dense cockpit is functionally complete and matches the mockup across all tabs. Uncommitted. tsc clean (my files); 14 pre-existing errors live only in `e2e/*.tmp.ts` (missing `pg` types etc.) — not ours.

---

## 2. Current objective

> Transform the long, vertical Production-Order page into a **premium ERP workspace on one screen**, matching the owner's "Ops Dense" mockup **exactly per tab** ("copie conforme"), while **keeping the exact SOLUX visual identity** and **not breaking any existing server-action form**.

The owner explicitly does NOT want a visual redesign of the identity — only the **disposition/layout** changed (dense tables, flat cards, tab navigator, persistent right rail). "Ce n'est pas juste changer des polices" — each tab was genuinely re-laid-out.

---

## 3. What has already been completed

### 3.1 Ops Dense cockpit shell
- **`components/production/OrderWorkspace.tsx`** (NEW, client component): the workspace shell.
  - Top **tab bar** (Production · Payment · Shipping · Documents · Order details · Activity) with a status dot + short status text per tab.
  - A **2-column grid**: left = the active tab's panel; right = a **persistent rail** (passed as the `rail` prop) that does NOT change when switching tabs.
  - Inactive panels stay **mounted** (`display:none`) so half-filled forms are never lost on tab switch.
  - Deep links: `?open=<id>` (initial) and `#area-<id>` (hashchange) select the owning tab. The rail "All N events →" link uses `#area-timeline` to jump to Activity.
  - Tone → dot color: complete `#0b7a39`, attention/blocked `#e8870e` (amber), idle `#aeaaba`.

### 3.2 Header / KPI / rail (in `page.tsx`)
- **Compact masthead** (`.ops-head`): eyebrow + order id + status pills + inline meta (Client · Sales · Quote · Task list) on the left; **inline mini lifecycle stepper** (dots) + "← All orders" on the right. The old full-width "ORDER LIFECYCLE" panel was removed (stepper is now inline in the header).
- **Dense KPI strip** (`.ops-strip`, 5 cells): Committed · Due · **Delay** (amber `attn` when >0) · **Payment** (amber `attn` when balance pending) · Shipping. Built inline from `liveStatus`.
- **Right rail** (`railNode`, persistent): **Needs Attention** (from `na.queue` = `computeNextAction`), **At a Glance** (Value / Deposit% / Produces / Baseline / Quotation / Task list), **Latest Activity** (`events.slice(0,4)` + "All N events →").

### 3.3 Per-tab "copie conforme"
- **Payment** — a **tranche table** (Deposit X% / Balance Y% × Expected · Received · Received-on · Due · Status with coverage pills) + a compact **"Record receipts"** 4-col form grid. Wired to `updateProductionOrderPayments` (unchanged `name=` fields).
- **Shipping** — the amber **BL-profile alert** (`ClientBlSummary`, already existed) + a **3 / 4 / 5-column** form grid (ETD·ETA·Forwarder / BL·Vessel·Voyage·HS / Cargo). Wired to `updateProductionOrderShipment`.
- **Order details** — a compact **item table** (Item · Ref · Configuration · Qty) + facts row (Value · Quotation · Task list · "View full task list →"). **`ProductLightingSetupCard` was MOVED here** (from the Production tab) per the owner.
- **Documents** — reuses `OrderDocumentsTab` (its checklist already matches the mockup: doc · REQUIRED/OPTIONAL · desc · Upload/Generate + "On file").
- **Production** — **two flat cards** matching the mockup:
  - **"Operational status"**: title + green dot + **inline status `<select>`** + helper + (right) Created/Updated. Then a **borderless baseline row** (`.po-baserow`): **Due completion** (was "Baseline") · Validation · Working days · Start · Initial completion·FROZEN · Unlock.
  - **"Delay tracking"**: title + **"+8d" big amber** + factory/external + (right) Baseline · Due · Actual, then the delay form + event timeline + "Mark production complete".
- **Activity** — the existing `Timeline` (16 events), flat.

### 3.4 Flat-card system
- **`components/production/CollapsibleSection.tsx`** — added a **`flat` prop** (+ `headerRight` slot). Flat mode = prominent title, **no "Close ^" collapse chrome, no hazard rail**, always-open. Applied to **all 7 workspace sections**. This was the single biggest fidelity fix (the owner: "c'est super différent" — the leftover collapse chrome + nested boxes were the culprit).

### 3.5 Delay component flattened + date picker
- **`components/production/DelayTimelineCard.tsx`** — removed its **own bordered card wrapper** (was a card-in-card inside the flat CollapsibleSection), removed the "Delay timeline" eyebrow + the 3 EtaCell boxes + the "Completion" footer eyebrow. The +8d / baseline-due-actual summary now lives in the CollapsibleSection header (badge + `headerRight`) in `page.tsx`.
- **`components/production/DelayEventForm.tsx`** — replaced the **"Days" number input** with a **date picker** ("New completion due date"). It computes `days_added = round(newDate − current_due)` and submits it via a hidden `days_added` input, so the server action `updateProductionOrderDeadline` and the audit event shape are **unchanged**. Earlier date = recovery. Submit disabled until a valid (non-zero) date is picked.

### 3.6 Production Dossier PDF ("Factory Build Sheet") — earlier, likely committed (`1d7fc33`)
- `components/ProductionDossierPDF.tsx` rewritten (1716 → ~880 lines): core dropped **10 → 2 dense pages** (full package 33 → 25). One dense "Factory Build Spec" table per product (final instruction + Override/Missing chips), masthead band (no cover page), inline battery/tilt, dense finishing/lighting/spare-parts/transport/uploads. Pipeline (`dossier.ts`, `exportData.ts`, `pdf-merge.ts`) UNCHANGED. Sample PDFs on `~/Desktop/FADEL TEST/`. See memory [[production-dossier-pdf]].

---

## 4. Key architectural decisions

- **Reuse existing server-action forms verbatim.** Every tab's editable content keeps the original `<form action={…}>` and input `name=`s. Only the *arrangement* changed. This is why saving still works and the audit trail is identical. **Never rename a form field or swap an action while re-laying-out.**
- **Flat cards via a `flat` prop on `CollapsibleSection`**, not by replacing the component everywhere. One prop flipped all 7 sections to the mockup's flat look with minimal churn.
- **Rail is a sibling of the tab panels, not inside them** — `OrderWorkspace` renders `{panels}` (left) + `{rail}` (right); the rail is passed once and is persistent.
- **Inactive panels: `display:none`, not unmount** — preserves in-progress form state.
- **Density via scoped CSS overrides** under `.po-premium .ops-main …` (compresses reused sections' padding/margins/fonts) rather than editing every child.
- **Design tokens are already shared** between the mockup and the app: Plus Jakarta Sans, `--canvas #eeeef0`, `--ink #0f0f0f`, `--line-2 #dcdde1`, Flash-Green `--green #55ff7e` / `--green-deep #0b7a39`, radius `0`. The mockup added exactly **one** colour: attention amber **`#e8870e`** (+ 10% tint) — now a token pair `--ops-amber` / `--ops-amber-bg`.
- **Date-picker delay input derives `days_added`** so the m073 "event-mode" action contract is untouched (see `updateProductionOrderDeadline` — it accepts `days_added` signed int OR legacy `current_production_deadline`).

---

## 5. Remaining tasks (priority order)

1. **Clean up now-unused code** (see §11) — low risk, avoids Next `next build` eslint failures on unused vars.
2. **Last-mile mockup polish (optional):**
   - Delay tracking still shows a small **"ADD A DELAY EVENT"** sub-eyebrow the mockup omits (form goes directly under the header in the mockup). Consider removing it in `DelayEventForm`.
   - Order details **config text** is functional but raw-ish (e.g. `OPTIONS BATTERY COVER`, `Spigot ( for pole Ø ) 89mm`) vs the mockup's clean `Battery cover`, `Spigot Ø 89 mm`. Improve the `configEntries` value formatting in `page.tsx` (the label→value join heuristic).
   - Documents header shows `0/7 required ready` (tab badge) while the section text says `0/9 ready` (incl. optional) — align the counter labels if desired.
3. **Re-run the full functional test** across ALL 6 tabs after the flat changes (only Production/Payment/Shipping/Order-details/Documents verified individually; do a clean pass on data accuracy + one save round-trip per editable tab, then REVERT — see §6).
4. **Commit** (ask owner first) — 5 modified + 1 new file.
5. **Consider a small `.env`-driven headless verify harness** for authenticated pages (the current flow relies on the owner's live Chrome).

---

## 6. Current bugs & known issues / gotchas

- **Test-data hygiene (IMPORTANT):** A **spurious `+4d shipping` delay event** was accidentally created on the test order during UI testing (probably a stray form submit while a "Days=4" value + a delay_type were set). It has been **fully reverted**:
  - deleted the `production_deadline_changes` row (`+4d`, `08-20→08-24`),
  - restored `production_orders.current_production_deadline` to `2026-08-20`,
  - deleted the matching `events` activity row (`po.deadline_changed` "Delay event +4d · shipping → ETA 2026-08-24"), activity count back to 16.
  - **Verified canonical:** `current_production_deadline: 2026-08-20`, `payment_notes: null`, `status: in_production`, 2 original delay events (`+5d production`, `+3d client_change`), 16 activity events.
  - **Lesson:** when driving forms in the live app, be careful — some inputs pre-fill; always re-query the DB after and revert any test mutation. Use the local Supabase **service_role** key (default `supabase start` demo key) for read/revert.
- **e2e storageStates expired** (`e2e/.auth/*.json`, created ~Jul 8–11) — all roles bounce to `/login`. Do **not** try to reuse them; use the owner's real Chrome, or (only with owner consent) `npm run e2e:bootstrap` to refresh (that logs in test accounts — a password-entry action, so ask first).
- **Chrome extension flakiness** — `mcp__claude-in-chrome__computer` (screenshots) intermittently disconnects; retry once. `javascript_tool` (DOM) is more reliable for verification.
- **1 residual `.po-toggle`** in the workspace comes from an inner component (ProductLightingSetupCard "Details" / a doc row), not the main cards — fine.
- **1 disabled button** in Production = "Mark production complete" (correctly gated: production not done) + "Unlock baseline" (intentional placeholder — Deliverable D not built).
- **KPI Payment `96,382.79` vs tranche Balance Expected `96,382.80`** — a 1-cent difference (two valid computations: `balanceRemaining = total − deposit` vs `expectedBalance = 75% × total`). Not a bug; flag if a reviewer notices.
- **14 pre-existing tsc errors** all in `e2e/**/*.tmp.ts` (missing `pg` decls, implicit any). Ignore — not ours. Our files: 0 new errors.

---

## 7. Business rules that must NEVER be broken

- **Affair/Project is mandatory** everywhere — never auto-create, defer, or weaken it ([[affair-mandatory-is-core]]).
- **Do not alter a server-action form's `action` or input `name=`** when re-styling — production saves + audit trail depend on them.
- **Real production data is real.** Any test mutation on `dc595d47-…` MUST be reverted (see §6). Deposit/balance/deadline/shipment changes fire events + KPIs.
- **Deposit gates production start**; only status setter / `markProductionComplete` stamp `actual_completion_date` (never the deadline editor). Delay events must carry a `delay_type` (factory vs external) so the factory KPI stays honest.
- **Freight/logistics never generates margin** (profitability), and costing stays invisible to Sales — general SOLUX rules (not touched here but respect them).
- **PDF CJK:** any `<Text>` that can carry Chinese must use `F.cjk` (Noto Sans SC) or it renders mojibake ([[pdf-cjk-font-support]]).

---

## 8. UX principles we've agreed on

- **Keep the exact SOLUX identity** — monochrome + Flash-Green, sharp corners (radius 0), Plus Jakarta Sans, bilingual where relevant. Simplify/re-arrange; do NOT redesign the look ([[keep-solux-design-language]]).
- **Ops Dense** = everything on **one screen**: compact header, dense KPI strip, tab bar switching the LEFT column, a **persistent right rail**. Minimal scrolling *between* sections (a click, not a scroll).
- **Flat cards** in the workspace — no collapse "Close ^" chrome, prominent titles, no nested boxes, no hazard stripe rail (attention = a thin amber left border).
- **Copie conforme**: match the owner's mockup per tab (tables/grids), not just fonts.
- **Attention colour** is the one addition: amber `#e8870e`; positive = green; blocked/attention shown via amber; idle = muted.
- **Feature done = visible in the real UI** on real data ([[feature-done-means-visible-ui]], [[verify-before-claiming]]).
- **Respond in French** to the owner ([[work-in-french]]).

---

## 9. Important workflows / how things connect

- **Data flow (page):** `page.tsx` (server component) fetches the order + related in parallel → computes `liveStatus`, `delayBreakdown`, `paymentState`, `docsReadiness`, `na = computeNextAction(...)`, `configLines`, `events` → renders header + KPI strip + `<OrderWorkspace tabs rail={railNode}>{6 panels}</OrderWorkspace>`.
- **Tab metadata** (`workspaceTabs`, computed pre-`return`): per-tab tone (complete/attention/blocked/idle) + short status, derived only from already-computed values (no new queries).
- **Delay editing:** `DelayEventForm` (date picker) → hidden `days_added` → `updateProductionOrderDeadline` (in `app/(app)/production/orders/actions.ts`) → updates `production_orders.current_production_deadline` + inserts a row in **`production_deadline_changes`** + emits an `events` activity row (`po.deadline_changed`).
- **Right rail "Needs Attention"** = `na.queue` (ranked). On this real order it shows only "On schedule" (`na.clear`) because nothing is outstanding — the mockup's 3 attention items were hypothetical mock data. This is correct behaviour.
- **Local Supabase access for verification:** `http://127.0.0.1:54321`, service_role = the default `supabase status` demo key (JWT `…EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU`). `events` table columns: `id, entity_type, entity_id, event_type, severity, payload, message, actor_id, created_at, status, …` (NO `type` column).

---

## 10. Files recently modified

**Uncommitted in the working tree (this cockpit work):**
| File | Change |
|---|---|
| `app/(app)/production/orders/[id]/page.tsx` | ~900-line diff: masthead, KPI strip, `OrderWorkspace` wiring, `workspaceTabs`, `railNode`, Payment tranche table, Shipping 3/4/5 grid, Order-details table + moved Lighting, flat sections, Operational-status header (inline select), borderless baseline row (Due completion cell), Delay badge/`headerRight`. |
| `app/(app)/premium.css` | +377 lines: `§ OPS DENSE` (grid, KPI, tabs, rail cards, flat-card title/attn, `.po-baserow`, `.dt-*` delay summary, density overrides, mini-stepper). |
| `components/production/CollapsibleSection.tsx` | +`flat` mode + `headerRight` slot. |
| `components/production/DelayTimelineCard.tsx` | flattened (removed own card + eyebrows + boxes). |
| `components/production/DelayEventForm.tsx` | Days number → date picker (derives `days_added`). |
| `components/production/OrderWorkspace.tsx` | **NEW / untracked** — the workspace shell. |

**Likely already committed on this branch (verify with `git status`):**
- `components/ProductionDossierPDF.tsx` — Factory Build Sheet PDF redesign (commit `1d7fc33` per notes).

**Deliverables on `~/Desktop/FADEL TEST/`:** `NOUVEAU_COMPACT_*.pdf` (dossier samples), `COMPARATIF_avant_apres.png`.

---

## 11. Potential technical debt

- **Now-unused code (tsc-clean but eslint-noisy):**
  - `page.tsx`: `DeadlineCell` (fn), `previewCompletionIfStartingNow` (var), `PRODUCTION_ORDER_STATUSES` (import) — no longer referenced after the baseline-row + status-select rework.
  - `DelayTimelineCard.tsx`: `TotalDelayChip`, `EtaCell` (inner fns), and `total` / `initialDeadline` / `actualCompletion` / `phaseCopy` — unused after flattening.
  - Earlier removed cleanly: `KpiTile`, `PaymentCell`, `OrderConfigSummary` import, `BALANCE_DUE_SOURCE_LABEL` import.
  - **Action:** delete these before `next build` if the project's eslint errors on `no-unused-vars`.
- **Density via broad utility overrides** (`.ops-main .p-4`, `.text-sm`, etc.) — scoped to `.ops-main` so contained, but future section content added there inherits the compaction. Watch for surprises.
- **`(order as any)` casts** are pervasive (Supabase types are loose) — runtime column errors (42703) are a known class ([[untyped-supabase-runtime-columns]]); run `npm run check:schema` if you add columns.
- **DelayTimelineCard is production-specific** (only used here) so the flatten was safe — but double-check no other importer before further edits.

---

## 12. Watch carefully before future changes

- **Never re-introduce the collapse chrome** in workspace sections — pass `flat` on every `CollapsibleSection` inside the tabs.
- **Preserve `name=` + `action`** on all forms (Payment, Shipping, Delay, Working-days, Reminder).
- **The order is REAL** — revert any test mutation and re-query the DB to confirm (§6).
- **`liveStatus.initialDeadline` vs `productionDue`** — "Initial completion" (frozen baseline, Aug 12) ≠ "Due completion" (current, Aug 20). Don't conflate them.
- **`totalDelayDays`** is computed once pre-`return` (= `liveStatus.factoryDelayDays + externalDelayDays`); the Delay badge and the KPI both read it.
- **Branch:** you're on `packing-module/phase1` (has uncommitted packing WIP too — migrations 173/174 local-only). Don't accidentally commit unrelated packing files.

---

## 13. Open questions & assumptions

- **Assumption:** the owner wants full mockup fidelity per tab; the remaining micro-details (Delay "ADD A DELAY EVENT" label, config-text formatting) are "nice to finish" but were left pending owner confirmation.
- **Open:** should the cockpit work be **committed** on `packing-module/phase1`, or split to its own branch? (Owner-decision; don't `git stash` — [[never-stash-facturation]].)
- **Open:** "Unlock baseline" is a disabled placeholder (Deliverable D — capability + admin RPC + audit). Is that in scope soon?
- **Assumption:** local Supabase is the dev source of truth; production data is NOT touched by localhost work.
- **Open:** the mockup's right-rail "Needs Attention" showed 3 items; real order shows only "On schedule". Confirm the owner is fine with data-driven rail content (it is correct).

---

## 14. Recommended next steps

1. `cd ~/dev/facturation && git status` — confirm the 6 files (5 M + 1 new `OrderWorkspace.tsx`), confirm branch `packing-module/phase1`.
2. Start dev (`npm run dev`) + open the order in the **owner's Chrome**; click through all 6 tabs.
3. Do the **cleanup** in §11 (remove unused fns/imports), `npx tsc --noEmit` (expect 14 pre-existing e2e errors, 0 new).
4. Optional polish (§5.2).
5. **Full functional re-test** (data accuracy vs local DB + one reversible save per editable tab; REVERT each). Then confirm the order is canonical (§6 values).
6. Ask the owner about committing; if yes, commit only the cockpit files (not packing WIP).

---

## 15. Quick reference

- **Order:** `dc595d47-0174-4a69-a158-3fcb6c6b8004` · PO-SLX-AFR-26-002 · AFRICA ENERGY SARL (AFR) · quotation `40352bf8-…` (SLX-AFR-26-002, sent, total 128 510.39 USD, deposit 25%) · task list `e97ddf57-…` (PTL-SLX-AFR-26-002, production_ready).
- **Canonical order state:** deadline `2026-08-20` (initial `2026-08-12`, +8d = 5 production + 3 client_change), deposit `32127.6` recv `2026-07-08` (100%), balance `0`, shipment_booked false, working days 25, 16 activity events.
- **Mockup file:** `~/Downloads/PO-SLX-AFR-26-002 Ops Dense - standalone.html` (inline-styled; click each tab button to see per-tab layout; render headless with Playwright + `file://`).
- **Local Supabase service_role key:** default demo key from `supabase status` (starts `eyJhbGci…`, ends `…EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU`).
- **Related memory:** `production-dossier-pdf`, `po-page-ux-audit-2026-07`, `keep-solux-design-language`, `verify-before-claiming`, `feature-done-means-visible-ui`, `untyped-supabase-runtime-columns`, `local-supabase-setup`, `never-stash-facturation`.
