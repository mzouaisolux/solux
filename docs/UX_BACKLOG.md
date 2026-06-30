# Solux ERP — UX Backlog (OFFICIAL · single source of truth)

> **Provenance.** This is the *UX & Product Design Review* performed during the
> 2026-06-29/30 sessions (real per-role logins; Sales/Director/Operations/TLM).
> It was lost in a context summarization and **recovered verbatim by the owner
> on 2026-06-30**. From now on **this file is the canonical UX backlog** — we
> execute it, we do not re-audit. Companion file: `docs/SESSION_CHANGES_2026-06-30.md`
> (the implementation manifest: what's coded + WIP/commit status).
>
> **Execution rule (owner).** One bounded business domain per sprint. A sprint is
> only "done" when it is implemented + verified with real user logins + regression
> green + committed. No parallel redesigns. Disciplined execution, not new ideas.

> Sections 1–4 (status map · sprint plan · new findings · removed items) are
> maintained at the top. The **verbatim audit** is frozen at the bottom as the
> reference of record — do not edit the appendix.

## 0. Working rules & roadmap (owner, 2026-06-30 — binding)

**This backlog is the official roadmap.** No new UX audits or roadmaps. Any new finding is appended here (§3). Each sprint: start from this backlog → complete its scope → update the backlog (✅/🟡/⬜) → leave it ready for the next. No parallel UX redesigns — one business domain to production quality at a time.

**Roadmap order (binding):** Sprint 2 **Service Requests** → Sprint 3 **Task Lists & Launch Production** → Sprint 4 **Operations** → Sprint 5 **Quotations & Orders** → Sprint 6 **Shell & consistency** (nav deferred). (Client Hub available separately.) Nothing outside the active sprint's domain is modified.

**Product-Designer principle:** preserve business logic, permissions, the workflow engine, and the data model — **improve only the UX**. Every change makes the ERP feel more like a polished commercial SaaS, less like an internal tool.

**Per-sprint Definition of Done:** ① real-user testing via genuine logins (no View-As / impersonation / shortcuts) · ② regression (`tsc` + `check:schema` + `e2e:regression`) · ③ this file updated (✅/🟡/⬜) · ④ short implementation summary · ⑤ a clean commit. Advance to the next sprint ONLY after complete + verified + committed.

> ⚠ **Commit baseline — OPEN DECISION (2026-06-30).** The working tree on `freeze/core-metier` (HEAD `3c485a1`) has **~219 uncommitted files** (foreign "premium" WIP). The Service-Request files carry 1000+-line foreign diffs (`projects/[id]/page.tsx` ≈ +511/−712, `NewProjectForm.tsx` heavily rewritten), so a **clean, isolated Sprint-2 commit is impossible** until that WIP is baselined. Until the owner decides — (A) authorize a one-time honestly-labeled "WIP baseline" commit so every future sprint commits clean, or (B) keep `SESSION_CHANGES_2026-06-30.md` as the commit ledger and lot later — the "clean commit" step is **tracked in the manifest, not executed**. The order matters: a baseline commit must happen **before** Sprint-2 edits to keep Sprint 2 clean.

## 1. Sprint-1 coverage map (verified in code 2026-06-30, files under ~/dev/facturation)

Legend: ✅ done · 🟡 partial · ⬜ untouched. Evidence = `file:line`.

| # | Audit item | Status | Done / remaining (evidence) |
|---|---|---|---|
| 1 | Director "Awaiting your decision" hero | ✅ | Director sees "Service requests to approve" + "Price requests" at the TOP (`ActionCenter.tsx:42-49`, `page.tsx:357`). Minor: header reads "Needs your action" — optional rename. |
| 2 | Sales "CRITICAL/NO NEXT ACTION" fixed | ✅ | Critical bucket = overdue actions/reminders, affairs with no next action, blocked quotes — all real actions (`dashboard-items.ts:263-277,318-341`). |
| 3 | Every dashboard = the 3 things, role-aware | ✅ | One `ActionCenter`, role-branched: Dir approvals+pricing, Sales generate/launch/draft, TLM review (`ActionCenter.tsx:27-76`). |
| 4 | Real-name greeting **+ account menu** | 🟡 | Greeting uses `user_profiles.display_name` first word (`page.tsx:287-292`) ✅. Account menu ⬜ — role badge not clickable; Sign out is a separate nav button (`Nav.tsx:182-207`). |
| 5 | Notifications: cap + group + deep-link | ✅ | Bell caps "9+" (`NotificationBell.tsx:78`); All/Alerts tabs (`110-125`); each item links to its entity (`141-168`). |
| 6 | TLM queue hero + de-dupe PTL + color | ✅ | "Awaiting your review (N)" hero (`task-lists/page.tsx:282-295`); PTL number already single (`366-369`); status color (`401-415`). |
| 7 | Split task-list page + required-empty + mapping up front | 🟡 | Sectioned + quick-nav done (S1-6) ✅. ⬜ no top "N fields needed before validation" summary; required flags per-line only (`TaskLineEditor.tsx:66-74`). |
| 8 | Mapping readiness at launch, not only at gate | ⬜ | Still surfaced ONLY at the Release modal (`TaskListWorkflow.tsx:704-801`). No flag at option-selection / launch. |
| 9 | SR form steps + Pole off + toggle helper | 🟡 | 4-step wizard ✅ + toggle helper text ✅ (`NewProjectForm.tsx:110-111,342`). ⬜ Pole still defaults ON (`:100`); ⬜ destination still a single "port/airport" field (`:395`). |
| 10 | Confirm Mark Won + chips in "⋯" menu | ✅ | `window.confirm` on Mark Won (`DocQuickActions.tsx:152`); raw chips collapsed into "Other status" row (`DocStatusActions.tsx:83-98`). |
| 11 | Flatten navigation | ⬜ | Still grouped under "Clients & Projects" etc.; Service Requests = 2 clicks (`navigation.ts:84-150`). (Owner-deferred.) |
| 12 | Localize FR/EN fully | 🟡 | Task-list detail now English; `srNeed` labels FR→EN (Sprint 1 §C). Full app sweep not verified. |
| 13 | Order lifecycle: hide proforma "draft" contradiction | ⬜ | Won order still shows "Draft — not sent" from the proforma (`WorkflowStepper.tsx:217-223`). |
| 14 | Auto-open generated quotation | ✅ | `generateQuotationFromProject` redirects to `/documents/new?edit=` (`projects/actions.ts:1228`). |
| 15 | Ops chips plain language + legend | 🟡 | Order chips already plain ("Awaiting deposit"…); cryptic delay chips ("Factory +4d…") + legend not addressed. |
| 16 | Merge the two Ops KPI strips | 🟡 | Two strips remain; 2nd ("Business snapshot") de-emphasized, not merged (`OperationsTab.tsx:333-370`). |
| 17 | Collapse SR-detail duplicate status surfaces | ⬜ | Badge + stepper + tracker + per-card "not requested" still coexist (`projects/[id]/page.tsx:259-349,570-676`). |
| 18 | Remove the "Messages" support bubble | ✅ | Global `ConversationLauncher` removed (`layout.tsx`, Sprint 1 §C). |
| 19 | Inline, form-preserving errors everywhere | 🟡 | Done for client-code (`NewClientPanel.tsx:45-47,174-176`). Not generalized (other create forms use toasts). |
| 20 | Skeletons + status color on dense tables | 🟡 | Color-coding on TLM queue ✅; skeleton loaders ⬜ (none in codebase). |

**Score: 8 ✅ · 8 🟡 · 4 ⬜.** Sprint 1 (Dashboards & notifications) **fully satisfies its core items** — #1, #2, #3, #5, plus greeting (#4a), bell, Messages bubble (#18), auto-open quote (#14), the "✓✓" fix, and Orders-in-Flight restored. Its *trailing edges* (#4b account menu, #15/#16 Ops refinements) are reassigned to the domain sprints below rather than left dangling.

---

## 2. Remaining work → focused UX sprints (one bounded business domain each)

Rule: a sprint is closed only when **implemented → verified with real per-role logins → regression green → committed**, before the next opens. Recommended order below; **Sprint 2 proposed = Service Requests** (small, completes a domain Sprint 1 began, lowest risk).

### Sprint 2 — Service Requests  *(recommended next)*
- **Objective:** finish the SR domain to production quality (Sprint 1 shipped the 4-step wizard; close the gaps).
- **Screens:** New SR wizard (`projects/new/NewProjectForm.tsx`), SR detail (`projects/[id]/page.tsx`).
- **Deliverables:** #9 Pole default **OFF** + destination split into **delivery city + optional port** (fixes the "Paris ≠ port" mental model); #17 collapse the duplicate status surfaces on SR detail (keep stepper + "Next step" as the single source; drop redundant per-card "pending/not requested"); #19 inline form-preserving errors on SR create/edit; #12 localize any residual FR/EN on these two screens.
- **Effort:** **M** (~1–1.5 d).
- **Main risks:** both files are heavily WIP-entangled (manifest) → changes land **WIP-blocked**; the wizard is already verified — must not regress create/edit; Pole-default change touches the downstream "pole → manual task-list item" path (BUG-9) — re-verify.
- **Validation plan:** real **Sales** login → create SR (Pole OFF, delivery city "Paris", request product + freight pricing), submit → **Director** request-info → **Sales** edit + resubmit; confirm no status contradiction, inline errors preserve input, downstream pole specs still carry. Then `tsc` + `check:schema` + `e2e:regression`.

### Sprint 3 — Task Lists & Production Launch  *(highest impact, highest risk)*
- **Objective:** finish turning the task-list domain from "wall of forms" into a focused, blocker-early experience (Sprint 1 did the sectioning).
- **Screens:** task-list detail (`task-lists/[id]/page.tsx`, `TaskLineEditor.tsx`), Launch-Production transition, factory-mapping readiness (`TaskListWorkflow.tsx`). (TLM queue T1 already done — verify only.)
- **Deliverables:** #7 a top **"N fields needed before validation"** summary that surfaces required-but-empty fields; #8 surface **factory-mapping readiness at launch / at option selection** (flag un-mapped options) — not only at the release gate; unify the per-line save UX (build on the new `SaveButton`); #12 finish localization; #20 skeleton loaders (keep color-coding).
- **Effort:** **H** (~2–3 d).
- **Main risks:** most WIP-entangled + most complex; large regression surface (validation gate, factory mapping, the just-shipped save-feedback); must not weaken the Release-gate guard.
- **Validation plan:** real **TLM** login → open a freshly launched list → see required-fields summary + mapping readiness **before** the gate; fill config; validate → release → production order created. Full gate suite after.

### Sprint 4 — Operations  *(owner roadmap order)*
- **Objective:** refine the already-good Ops dashboard + pricing (don't rebuild).
- **Screens:** Operations dashboard (`OperationsTab.tsx`, `OrdersInFlight.tsx`), Operations pricing entry (`projects/[id]` pricing cards / `O1`).
- **Deliverables:** #16 merge the two KPI strips into one; #15 plain-language **delay chips + a legend** ("4 days late at factory"); "Done" → quieter secondary **with undo**; O1 present the 3 inputs as an explicit sequence/checklist (① Cost ② Packing ③ Freight) + relabel "per container rate" + sensible incoterm default; Operations productivity polish.
- **Effort:** **M** (~1–2 d).
- **Main risks:** freight ⇐ packing is **intended** (owner) — present it as a sequence, do **not** "fix" it; KPI merge must not drop any number; `OperationsTab` carries the Orders-in-Flight WIP fix.
- **Validation plan:** real **Operations** login → dashboard scan (one KPI strip, legible chips) → price a request end-to-end (containers → optional attachment → prices).

### Sprint 5 — Quotations & Orders  *(final commercial polish)*
- **Objective:** make the money screens unambiguous and ship the final commercial polish (most of #10/#14 already done).
- **Screens:** quotation workflow + document (`documents/[id]/*`), order workflow + detail (`WorkflowStepper.tsx` + order page), proforma UX.
- **Deliverables:** #13 order lifecycle shows the **deal status (Won)** and hides/relabels the proforma's internal "Draft — not sent" on a live order; status consistency across quote↔proforma↔order; #19 inline errors on document forms; verify #10/#14 not regressed; final polish pass.
- **Effort:** **M** (~1–2 d).
- **Main risks:** status-machine guards (H1/H2/H3) + revenue recognition on Mark-Won — do not weaken; the proforma↔order linkage (`affair_id`) is subtle.
- **Validation plan:** real **Sales** login → won quote → open the order → no "mark won" contradiction; status changes remain safe/confirmed.

### Sprint 6 — Shell & consistency  *(cross-cutting; do last; nav is owner-deferred)*
- **Objective:** the global polish that legitimately spans every domain.
- **Screens:** nav/header (`Nav.tsx`, `navigation.ts`), all remaining dense tables, app-wide copy.
- **Deliverables:** #4b account menu (role badge → menu containing Sign out); #19 generalize the inline-error pattern app-wide; #12 final FR/EN sweep; #20 skeletons on remaining tables; **#11 flatten nav — DEFERRED** until real users report getting lost (owner decision).
- **Effort:** **M–H** (~2 d, excl. nav).
- **Main risks:** nav is high-blast-radius and explicitly deferred — don't touch without a real-user signal.
- **Validation plan:** all roles real login → account menu works; consistency spot-check per domain.

> **Also available (owner-ratified, outside the Top 20):** a **Client Hub** sprint executing `docs/CLIENT_HUB_UX_PROPOSAL.md` (simplify `/clients` list, open-alerts rollup, header→Hub, delete dead `AffairsExperimentalView`/`ClientCard`). Slot it whenever you want a Clients-domain pass.

---

## 3. New findings since the audit (now part of this backlog)
- **N1 [resolved 2026-06-30]** Factory Task-List PDF generation crashed in-browser ("Could not resolve font … fontWeight 200") — root cause was a missing italic font registration; fixed + verified (manifest §G, memory `pdf-font-generation-issue`).
- **N2 [done 2026-06-30]** Factory-instruction save feedback was too weak → reinforced to 3 layers (button ✓ + green toast + persistent timestamped badge) (manifest §F). Generalizes the audit's "better success messages".
- **N3 [resolved 2026-06-30]** "Orders in Flight" was empty after the dashboard refactor (joined won-quote→task-list by `quotation_id` instead of `affair_id`) — fixed (manifest §D).
- **N4 [open · low]** In the Factory PDF + likely the task-list ORDER SUMMARY, the joined config string can render a stray glyph / missing separator ("SES60-WB-W ●3.5SOLAR PANEL") — a character outside the font subset / a missing separator. Cosmetic; fold into Sprint 3.

## 4. Removed / reclassified (do NOT re-open)
- **BUG-4 (freight needs packing) — REMOVED.** Not a bug: Operations enters container count (+ optional attachment) → then prices. Intended workflow (owner).
- **BUG-5 (order blocked by missing mappings) — RECLASSIFIED → audit #8** ("warn on un-mapped configs early"). The blocker itself is resolved.
- **"run migration 043…" dev-message leak — REMOVED** (fixed as BUG-8). Kept only as a historical example of the "internal-tool" genre.



---

# APPENDIX — Verbatim audit (frozen reference of record)

## UX & Product Design Review — Solux ERP
Reviewed as a real employee: separate browser session per role, genuine email+password login, navigation by clicking only, real Sign-out between roles. Roles: Sales (testsales), Sales Director (testdir), Operations (testoperation), Task List Manager (testlm).

### Verdict (brutally honest)
The workflow engine is genuinely good — the Service-Request stepper, the "Next step — gated by status & role" panel, the pricing cockpit, and the Operations "Urgent" list are better than most ERPs. But the product reads as an internal tool, not a commercial SaaS. The recurring sins: dense tables with no hierarchy, cryptic chips with no legend, dashboards that cry "CRITICAL" with nothing to do (Sales) or say "all clear" while work is waiting (Director), robotic "Good day, Testdir" greetings, a 20+ notification pile, a leftover customer-support "Messages" bubble, mixed French/English, and "two clicks to reach anything." None of the core flows feel obvious to a first-day employee.

If Linear/Stripe/Notion designed this: every role would land on "here are the 3 things only you can move forward, click to act," and everything else would be progressive disclosure.

### A. Cross-session / real-login findings
- ✓ Dashboards refresh after login — fresh session showed current data; no stale data.
- ✓ Permissions enforced — menus differ correctly (Sales: no Catalog; Ops/TLM: Catalog; Finance/Admin hidden).
- ✓ Status visible after login — reflected live workflow state each login.
- ✓ Logout→login transitions — clean; real /login each sign-out.
- ✗ Notifications appear for the correct user / are useful — every role's bell shows "20+" on first login. Not a per-user signal, it's wallpaper. (X1)
- ✗ Landing page shows what's assigned to me — Director logs in → all-green dashboard while a Service Request waits for their approval. (D1 — highest priority)

### B. Screen-by-screen
**D1 — Sales Dashboard.** Hero titled "CRITICAL — HANDLE NOW (10)" yet every row reads "NO NEXT ACTION" and is just a lead. Greeting "Good day, Testsales" (raw login). Primary create actions missing (only "+ New quotation"). Redesign: rename "Needs you now", show only items with a real next action; demote action-less leads to "Leads to nurture (10)"; greet with real name; New client / New service request / New quotation as primary buttons; empty state "You're all caught up ☕". Priority: High.

**D2 — Director Dashboard (worst offender).** Defaults to "My items" which for a director is empty → "All deals progressing normally." Their real queue (SRs awaiting approval/pricing) is nowhere (only a tiny nav badge). Redesign: land on "Awaiting your decision" — approvals + pricing-ready as hero, one-click "Review →"; personal deals secondary. Priority: Critical.

**D3 — Operations Dashboard (the good one — keep, refine).** Strong KPI strip + "Urgent — blocking or overdue" with concrete actions. Problems: dense; cryptic chips ("Initial Jul06 · Current Aug03 · Factory +4d · External +24d · ESCALATED") no legend; two KPI strips ("Key numbers" + "Business snapshot") overlap; inline "✓ Done" on urgent rows (mis-click risk). Redesign: hover legend / plain chips; merge the two strips; "Done" quieter + undo. Priority: Medium.

**S1 — New Service Request form.** One long scroll; "Pole required" defaults ON; "Packing list"/"Freight cost estimate" greyed until Quantity exists (no explanation); freight destination labeled "Destination port/airport (e.g. Port of Cotonou)" — wrong for an inland city like Paris; only Client*/Affair* marked required. Redesign: progressive disclosure (Step 1 who & what, Step 2 what to price, Step 3 optional specs); Pole default off; split destination into delivery city + optional port; keep the live "what you're asking for" summary. Priority: High.

**S2 — Service Request detail (strong bones).** Stepper + "Next step — gated by status & role" + tracker is excellent — propagate everywhere. Problem: long; same statuses in 3 places (badge, stepper, tracker, + per-card pending/not-requested); at draft, cards read "not requested" while tracker reads "Pending". Redesign: collapse duplicate status surfaces into one; keep "Next step" as single source. Priority: Medium.

**O1 — Operations Pricing entry (cost / packing / freight).** Strong sequential reveal, per-step toasts, auto-totals, auto-advance. Problem: dependency freight ⇐ packing invisible until the amber dead-end; "Freight per unit for 40HQ" ambiguous; transport mode & incoterm default "—". Redesign: show 3 inputs as a checklist ("① Cost ② Packing ③ Freight — needs packing first"); relabel "Per container rate"; sensible incoterm default. Priority: Medium.

**Q1 — Quotation document.** Strong; "Draft · work in progress" lifecycle banner is right. Problem: status control is a row of chips (Sent/Negotiating/Lost/Cancelled) next to the primary "Mark as sent →" — easy mis-click; "Mark Won" has no confirmation (recognizes revenue + unlocks production); a "Won — Mark won to confirm" link sits beside the "Mark Won" button. Redesign: one primary action at a time; move raw chips into "⋯ Change status" menu; confirm "Mark won" with a 1-line modal. Priority: Medium.

**L1 — Launch Production → Task List.** After "🚀 Launch Production" you land on a very long task-list page; catalog config fields start empty (manual matching needed); mixed FR/EN ("Catégorie", "Demande spécifique"); two "Save line" buttons with separate save states. Redesign: split into tabs/steps (① Product config ② Pole ③ Risks & notes ④ Logistics); surface required-but-empty fields at top ("3 fields needed before validation"); show factory-mapping readiness here, not only at release gate; localize fully. Priority: High.

**T1 — Task Lists queue (TLM).** A 21-row dense table; the TLM's real job ("3 awaiting your review") is a thin banner with rows merely highlighted in the pile; the PTL number is printed twice per row. Redesign: lead with an "Awaiting your review (3)" card section, then "Everything else" collapsed; remove the duplicate number; add status color-coding. Priority: High.

**R1 — Order page.** Strong lifecycle + drawers. Problem: lifecycle widget shows "Quotation: Draft — not sent / WON: Mark won to confirm" next to a live production order (reflecting the internal proforma's draft) — reads as contradictory. Redesign: show the deal's status (Won); hide/label the proforma's internal draft ("Proforma (internal)"). Priority: Medium.

**N1 — Global navigation.** Everything under broad dropdowns ("Clients & Projects", "Task Lists", "Orders"); Service Requests = 2 clicks, hidden under "Clients & Projects". Redesign: flatten top nav to the real nouns (Clients · Service Requests · Quotations · Task Lists · Orders) or a Linear-style left rail with counts; make the role badge a real account menu (Sign out inside). Priority: Medium.

### C. Cross-cutting
- Visually heavy: Task-list (L1), TLM queue (T1), Operations dashboard (D3), SR detail (S2).
- Split: New SR form (2–3 steps); Task-list page (tabbed sections).
- Merge: the two Operations KPI strips; the multiple status surfaces on SR detail.
- Progressive disclosure: SR solar/pole/freight specs; task-list factory/risk/sticker sections; quotation status chips behind "⋯".
- Better defaults: Pole = off; incoterm/transport pre-selected; SR "Product pricing" stays on.
- Better empty states: Director "all clear" only when truly nothing assigned; Sales "leads" not masquerading as "critical".
- Better loading states: pending labels good; add skeletons on dense tables.
- Better success messages: drop the double "✓✓"; after "Generate quotation" auto-navigate to the new quote.
- Better error handling: generalize the inline, form-preserving client-code fix everywhere.
- Better notifications: cap, group by type, deep-link each.
- Better workflow transitions: the director→sales modification message is the model — every handoff should say who does what next, on the recipient's home screen.

### D. Top 20 UX improvements (ranked by impact)
Scales: Frustration↓ / Time saved / Risk↓ / Build complexity — L/M/H.

| # | Improvement | Frustration↓ | Time saved | Risk↓ | Complexity |
|---|---|---|---|---|---|
| 1 | Director lands on "Awaiting your decision" (approvals + pricing), not an empty "my items" | H | H | H | M |
| 2 | Fix Sales "CRITICAL/NO NEXT ACTION" — show only real actions; demote leads | H | M | M | M |
| 3 | Every dashboard = "the 3 things only you can move," role-aware (copy the Ops "Urgent" model) | H | H | H | M |
| 4 | Real-name greetings (Sam, not "Testsales") + account menu | M | L | L | L |
| 5 | Notifications: cap/group the "20+", deep-link each to its action | H | M | M | M |
| 6 | TLM queue → "Awaiting your review (3)" hero, rest collapsed; de-dupe PTL number | H | H | M | M |
| 7 | Split the Task-List page into steps/tabs; surface required-empty fields + mapping readiness up front | H | H | H | H |
| 8 | Surface factory-mapping readiness at launch, not only at the release gate | M | M | H | M |
| 9 | New SR form → 2–3 steps, Pole default off, enable service toggles with helper text | H | H | M | M |
| 10 | Confirm "Mark Won" + move status chips into "⋯" menu | M | L | H | L |
| 11 | Flatten navigation to the real nouns (−1 click to Service Requests) | M | M | L | M |
| 12 | Localize fully (kill mixed FR/EN like "Catégorie/Demande spécifique") | M | L | L | L |
| 13 | Order lifecycle: show deal status (Won), hide the proforma's internal draft contradiction | M | L | M | L |
| 14 | Auto-open the generated quotation after "Generate quotation" | M | M | L | L |
| 15 | Operations chips → plain language + a legend ("4 days late at factory") | M | M | M | M |
| 16 | Merge the two Operations KPI strips; one source of truth | L | L | L | L |
| 17 | Collapse duplicate status surfaces on SR detail (badge/stepper/tracker/cards) | M | L | L | M |
| 18 | Remove or rebrand the "Messages" support bubble | M | L | L | L |
| 19 | Inline, form-preserving errors everywhere (generalize the client-code fix) | M | M | H | M |
| 20 | Skeleton loaders + status color-coding on the dense tables | L | L | L | M |

If you do only five: #1, #2/#3, #6, #7, #9.

### E. Where it still feels "like an internal tool," not a product
- "Good day, Testdir" — greeting users by their database login is the #1 tell.
- "20+" notification bell identical for everyone.
- "CRITICAL — HANDLE NOW" with "NO NEXT ACTION" — internal logic leaking as UI.
- Director home screen green while work waits.
- Dense, ungrouped tables (21 task lists, duplicated PTL numbers).
- Cryptic chips ("Factory +4d · External +24d · ESCALATED") with no legend.
- Mixed French/English on the same screen.
- A leftover "Messages"/Intercom-style bubble in an internal ERP.
- Two-clicks-to-everything generic mega-menus.
- Every role sees a Sales and an Operations tab, one of which is dead weight.
- Raw status vocab surfaced ("waiting_factory_cost", "needs_revision") and the proforma's "draft" leaking onto a live order.

The hard part (the workflow model) is already excellent. The rest is information-hierarchy, copy, defaults, and "show me my work first."
