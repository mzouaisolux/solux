# Handover — Ops Dense redesign of the Task List page
**Session:** 2026-07-23 · **Branch:** `main` @ `f187916` (14 commits ahead of `origin/main`)
**Repo:** `~/dev/facturation` — the iCloud folder is a stale non-git copy, never code there.
**Scope:** presentation only. No business logic, no schema, no server action was changed.

> **Session 2 (same day) — §5 is DONE, and so is the §4 finishing list.**
> `PreValidationBoard` is split and its parts live in the rail: `e615762`
> (extract) → `cc7293e` (move) → `186696d` (style) → `c328bca` (dead CSS);
> see §9, which supersedes §5. Then `8c0af35` (resolve → links), `f1f681f`
> (MISSING badges), `741b5b2` (Save line on the header row), `f187916` (mini
> stepper); see §10.

---

## 1. Current state

### What the task is
The owner supplied an approved redesign of this page — `~/Downloads/PTL-SLX-AES-26-005 Ops Dense - standalone.html` — and asked for an **exact copy**, tab by tab, applied to the real page. It is a **declension**, not an inspiration: same components, same order, same rhythm.

> The reference is a **bundled artifact**, not plain HTML. Its design source is gzip+base64 inside `<script type="__bundler/manifest">`. To read it again:
> ```
> python3 -c "import re,json,base64,gzip;h=open('/Users/mehdizouai/Downloads/PTL-SLX-AES-26-005 Ops Dense - standalone.html',encoding='utf-8').read();t=json.loads(re.search(r'<script type=\"__bundler/template\"[^>]*>(.*?)</script>',h,re.S).group(1).strip());open('/tmp/ref-template.html','w').write(t)"
> ```
> Then the JSX logic is in the `<script type="text/x-dc">` block of that template.
> **Better:** open the artifact in a browser and click each tab — that is how the per-tab composition was established.

### Design tokens (extracted from the reference, now live)
| Token | Value | Use |
|---|---|---|
| accent | `#55ff7e` / deep `#0b7a39` / tint `rgba(85,255,126,.14)` | done · valid |
| ink | `#0f0f0f` | emphasis, active tab, primary button, Next-step card |
| text / muted | `#2a2a2c` · `#67646f` · `#aeaaba` | |
| lines | `#e7e7ea` (cards) · `#dcdde1` (controls) | |
| amber | `#e8870e`, deep `#9a5a00`, line `rgba(232,135,14,.42)` | **needs attention only, never decorative** |
| page bg | `#faf9f5` | |

Signatures: **no border-radius anywhere**, `font-variant-numeric: tabular-nums` on every figure, uppercase micro-eyebrows 10–11 px / 700–800 / `.06em`.

### Layout changes already implemented
1. **Sticky command bar** — identity, status, meta and page actions on one dense line. Was four stacked rows.
2. **KPI strip** — 5 cards (required fields · factory mappings · tilt angle · revision · quote terms), amber left-border when blocking, green when settled. **Sticky**, parked under the command bar.
3. **Tab bar** — 7 tabs replacing a ~10 000 px vertical stack. Active tab = ink. Sticky under the KPI strip.
4. **Two-column work area** — tabbed main + **sticky decision rail** (320 px), collapsing to one column under 1180 px.
5. **Tab composition reordered to match the reference exactly** (JSX blocks physically moved, see §2).
6. **Ink Next-step card moved into the rail** — was a full-width bar above the tabs.
7. **Density pass inside the panels** — square controls, 13 px fields, uppercase micro-labels, ink primary buttons, hairline tables.
8. **Sales configuration is now a 3-column grid** (was a stacked column) — the single biggest gain inside the Product tab.
9. **Options render as a chip row** (were stacked checkboxes).
10. **`.tl-secnav` hidden** — the old jump-link row duplicated the tab bar. Hidden, not deleted: its anchors still resolve.

### Measured result
| | Before | After |
|---|---|---|
| Page height, TLM, MAG-26-020 | ~10 500 px | **3 616 px** |
| Single tab | — | **~1 800 px** |

### Fidelity vs the reference
| Area | State |
|---|---|
| Tokens, typography, square corners, density | ✅ matches |
| Tab set, order, per-tab composition | ✅ matches |
| KPI strip | ✅ matches |
| Rail: Needs attention · Next step | ✅ present |
| Rail: **Pending issues · AI-extracted values** | ✅ **done in session 2 — see §9** |
| `MISSING` amber badges on empty required fields | ✅ real badge — see §10 |
| `resolve →` links in Needs attention | ✅ switch to the owning tab — §10 |
| Mini stepper in the header right | ✅ compact dot row — §10 |
| `Save line` ink button at panel top-right | ✅ on the header row — §10 |

---

## 2. Architecture decisions

### Tabs are RSC-safe by construction
`OpsTabs` is a **client** component; the panels are rendered on the **server** and handed over as `children`. The client half never re-renders them — it only toggles which is visible.

**Panels stay MOUNTED** (`display:none`, not unmounted). Deliberate:
- in-progress form input survives a tab switch;
- browser in-page search still finds everything;
- the anchors the old jump-nav targeted still resolve.

**Constraint:** do not "optimise" this into conditional rendering. Unmounting would drop form state and break anchors.

### Blocks were MOVED, never rewritten
The tab composition was achieved by physically relocating JSX ranges with a Python script, verbatim. No JSX inside a moved block was edited. That is why every form, server action, permission gate and freeze rule is byte-identical to before the session.

**Constraint:** keep doing it this way. Rewriting a block to "clean it up" while moving it is how business behaviour silently breaks here.

### Left unchanged on purpose
| Component | Why |
|---|---|
| `ConfigFieldInput` | **shared with the quote builder** — restyled from outside via `.cfg-form > label / > .block`, never edited |
| `PreValidationBoard` | split in session 2 (§9); still exported whole as the fallback |
| `TaskListWorkflow`, `RevisionsPanel`, `LineLightingPanel`, `IndustrialFileEditor` | only restyled through scoped CSS |
| `evaluateRelease` | **the single release authority.** The rail and the KPI strip only mirror it |

### CSS is scoped, always
Everything lives under `.tl-detail.ops …`. Nothing outside this page can be affected. The `ops` class is added on the page root; removing it reverts the entire skin.

### Sticky offsets are measured, not guessed
Command bar 134 → KPI strip 95 → tab bar 229 → rail 295. Measured in a real browser. **If the command bar's height changes, re-measure and update all four**, otherwise elements overlap or float.

---

## 3. Files modified

| File | Role | What changed | More work expected |
|---|---|---|---|
| `app/(app)/task-lists/[id]/OpsTabs.tsx` | **new** — client tab bar + `OpsPanel` server wrapper | whole file | No, unless a tab is added |
| `app/(app)/task-lists/[id]/page.tsx` | Server component, ~1930 lines, renders the whole page | `ops` class on root · KPI strip added · JSX blocks reordered into 7 panels · Next-step moved into the rail · rail added | **Yes** — §5 moves board parts into the rail |
| `app/(app)/task-lists/[id]/tasklist.css` | Page-scoped stylesheet, now 2471 lines | Ops Dense skin appended in 9 blocks (shell, panels, layout, rail parity) | **Yes** — rail cards + polish |
| `docs/HANDOVER-2026-07-23-ops-dense.md` | this file | new | — |

**Untouched but central to read:** `components/PreValidationBoard.tsx` (432 lines), `lib/task-list-mapping-status.ts` (`evaluateRelease`).

---

## 4. Remaining work

### Major
1. ~~**Split `PreValidationBoard` into rail cards**~~ — **done, §9.**
2. ~~**Mini stepper in the header**~~ — **done, §10.**

### Small polish
3. ~~`MISSING` amber badge~~ — **done, §10.**
4. ~~`resolve →` links~~ — **done, §10** (delegated listener, nothing lifted into context).
5. ~~`Save line` at the panel's top-right~~ — **done, §10.**
6. Tilt preset chips: active chip should be **ink**, not green (`chipBase` in the reference).
7. `Spare parts` as its own tab — it lives inside `IndustrialFileEditor`; needs component surgery, low value.

---

## 5. Immediate next task — split `PreValidationBoard` into rail cards

### Goal
The reference's rail is, top to bottom: **Needs attention · Next step · Pending issues · AI-extracted values**. Today the last two (plus the blocking list) are inside one full-width `PreValidationBoard` sitting above the tabs, costing ~450 px before the user reaches any content.

### Components involved
- `components/PreValidationBoard.tsx` — 432 lines, `"use client"`, holds `useState(adding)`, `useState(error)`, `useTransition`, `useRouter`. Internal blocks, already commented:
  - L230 `{/* ---- Blocking errors ---- */}`
  - L257 `{/* ---- Pending issues (action items) ---- */}`
  - L358 `{/* ---- AI review ---- */}`
  - L414 `{/* ---- Warnings (non-blocking) ---- */}`
  - closes L430
- `app/(app)/task-lists/[id]/page.tsx` — mounts it at **L1066**, guarded by `showPreValidationBoard`.

### Expected architecture
Export **three sibling client components from the same file**, sharing the props they already receive:
```
PreValidationBlockers   // L230 block  -> feeds the rail's "Needs attention"
PendingIssuesCard       // L257 block  -> rail card (owns `adding`/`error` state)
AiReviewCard            // L358 block  -> rail card
```
Keep `PreValidationBoard` exported and working — it is the fallback and keeps the diff reversible.

### Safest strategy (in this order, verifying between each)
1. **Extract without moving.** Split the JSX into the three components, still rendered by `PreValidationBoard` in the same order. Page output must be **identical**. Verify, commit.
2. **Move the mount.** In `page.tsx`, stop rendering `PreValidationBoard`; render the three components inside `<aside className="ops-aside">`, in reference order. Verify, commit.
3. **Style** them as `.ops-card` (`padding: 12px 16px 6px` header, `4px 16px 14px` body) with the amber variant for blockers.
4. **Delete nothing** until steps 1–3 are green.

### Pitfalls
- **State must not be duplicated.** `adding` / `error` belong to the pending-issues block only. If the split leaves a second `useState` driving the same form, the "+ Add" toggle desynchronises. One owner per state.
- **`router.refresh()` is called after every action item mutation.** Keep exactly one caller.
- **Warnings block (L414)** has no home in the reference rail. Do not silently drop it — fold it into Needs attention or keep it in the Risks tab.
- **`m178Live` fallback.** When m178 is unapplied the board renders an explicit banner instead of items. Preserve that path in the split, or pre-m178 databases show an empty card with no explanation.
- **The blocking list must keep mirroring `evaluateRelease`.** Never recompute blockers in the new card — pass them through.
- **Rail height.** Four cards in a 320 px sticky column may exceed the viewport. Give `.ops-aside` `max-height: calc(100vh - 310px); overflow-y: auto;` or the bottom card becomes unreachable.
- **Sticky offsets** — removing the full-width board changes nothing above it, so 134/229/295 stay valid. Re-measure if the command bar changes.

### Validation
- 7 tabs still present, correct composition, no JS error.
- The rail shows 4 cards in reference order.
- Adding an action item still works, and still blocks Final Validation when flagged `blocking`.
- A frozen task list still shows **no** write control.

---

## 6. Known risks

| Risk | Where | Guard |
|---|---|---|
| **Duplicated state** after the split | `adding` / `error` in the board | one owner per state; grep for `useState` after splitting |
| **Duplicated rendering** | rendering both `PreValidationBoard` and its parts | remove the old mount in the same commit as the new one |
| **Release gate divergence** | rail / KPI strip re-deriving blockers | mirror `evaluateRelease` only — it is the single authority |
| **Permissions** | `canCreate` / `canBlock` / `isTechnical` / `canReviewAi` must follow the split | verify as `operations` and `sales`, not just TLM |
| **Freeze** | a frozen list must expose no Save/Delete/Add | re-run the frozen-state check on `10ff8536-…` |
| **Hydration** | panels are server-rendered inside a client tab wrapper | never move server-only data fetching into `OpsTabs` |
| **Unnecessary rerenders** | `OpsTabs` re-renders on tab switch | children are `children` — they do not re-render. Do not pass panels as a prop array of elements built inline |
| **Sticky overlap** | four hard-coded offsets | re-measure after any header change |
| **Shared component** | `ConfigFieldInput` also serves the quote builder | never edit it; style from `.tl-detail.ops .cfg-form` |
| **`:invalid` styling** | amber tint on required-empty fields | it is a CSS approximation; a real badge needs markup |

---

## 7. Validation checklist

```bash
cd ~/dev/facturation
npx tsc --noEmit          # must exit 0
npm test                  # 802/802
npm run check:capabilities
npm run e2e:regression    # 23/23, real logins
```

Then, in a browser (dev server must already be running — **never** `npm run build` while `next dev` is up, they share `.next/`):

| # | Check |
|---|---|
| 1 | `/task-lists/7158d184-0fac-40bb-9727-5794d8cea6ba` (Pre-Validation) — 7 tabs, each with its reference composition |
| 2 | `/task-lists/10ff8536-017f-4269-983c-4a8c31e98eb2` (frozen) — **no Save / Delete / Add anywhere** |
| 3 | Switch tabs with text typed in a field — the text must survive |
| 4 | Scroll 700 px — command bar, KPI strip and tab bar all stay pinned, none overlapping |
| 5 | Repeat #1 as `operations` and `sales` — no access regression |
| 6 | Zero `pageerror` in the console |

Test accounts: domain `solux-light.com`, shared password in `.env.e2e` (`E2E_PASSWORD`), users `testlm@` / `testoperation@` / `testsales@` / `testdir@`.

---

## 8. Prompt for the next session

See the block at the end of this document.

---

## 9. Session 2 — the rail split, as built (supersedes §5)

### What shipped
Four commits, one per step of §5's strategy, each verified before the next.

| Commit | Step | What it does |
|---|---|---|
| `e615762` | 1 · extract | `PreValidationBoard.tsx` exports four sibling components; the board still composes them, the mount in `page.tsx` is untouched |
| `cc7293e` | 2 · move | Old full-width mount deleted, parts mounted in `<aside className="ops-aside">`, same commit so nothing renders twice |
| `186696d` | 3 · style | Stylesheet block 10, `.tl-detail.ops .ops-aside` only |
| `c328bca` | 4 · clean | `.ops-attn-item` / `.ops-attn-ok`, dead once the markup changed |

### Exports now available from `components/PreValidationBoard.tsx`
```
computeBlockers(signals, items)      // the itemised gate — ONE implementation
aiFieldsNeedingReview(aiFields)
PreValidationBlockers                // L230 block
PendingIssuesCard                    // L257 block — owns adding/error/busy
AiReviewCard                         // L358 block — owns its own confirm transition
PreValidationWarnings                // L414 block
PreValidationBoard                   // still exported: fallback, keeps the diff reversible
```

### Decisions worth knowing
- **Needs attention no longer re-derives anything.** It used to hand-roll four
  of the gates in `page.tsx`; it now renders `PreValidationBlockers`, so
  blocking action items, an open revision, an empty task list and missing
  factory programming appear in the rail too. It still only mirrors —
  `evaluateRelease` remains the only authority that gates.
- **Warnings** are folded under Needs attention, separated by a hairline. The
  reference rail has no slot for them; dropping them was not an option.
- **Rail order** is the reference's: Needs attention · Next step · Pending
  issues · AI-extracted values, with Revision kept last.
- **`showPreValidationBoard` still guards** Pending issues and AI values, so
  outside the collaborative phase no write control is mounted at all.
- **The rail scrolls internally** — 5 cards measure 1127 px against a 590 px
  column. `max-height: calc(100vh - 310px)`, lifted again under 1180 px.
- **Amber is conditional now**: `:has()` drops the card to a neutral hairline
  when the gate is clear. Written as an override, so a browser without `:has()`
  keeps today's always-amber card rather than losing the accent.
- **The moved JSX was never edited.** The card headers duplicate each block's
  own title, so the inner titles are hidden in CSS — except Pending issues,
  where only the label is hidden and the row is lifted onto the header line
  (that is what the `pending-wrap` class is for).

### Proof collected
```
tsc --noEmit             0
npm test                 803/803
check:capabilities       PASS (52 catalogued, 0 orphan)
e2e:regression           23/23, real logins
```
Browser, TLM + operations on `7158d184`: 7 tabs, 5 rail cards in reference
order, page height 2900 → **2450 px**, 0 `pageerror`, 0 `console.error`,
typing survives a tab switch. Step 1 was proven by diffing the rendered board
DOM before/after with `data-testid` stripped: **identical, 5876 B, empty
diff**. Step 2 was proven by checking each relocated block is a byte-exact
substring of the pre-move board HTML (1746 / 1258 / 1900 B). Sticky stack at
scrollY 700: KPI 134→229, tabs 229→287, rail 295→885, no overlap. Frozen
`10ff8536`: 0 add-item, 0 confirm-ai, no Pending/AI card.

Harness: `e2e/audit/ops-rail-verify.tmp.ts` (fingerprint + frozen + typing),
`ops-rail-shot.tmp.mjs` (screenshots + rail metrics), `ops-final-checks.tmp.mjs`
(`:has()` behaviour + sticky stack). All `*.tmp.*`, so **gitignored** — they
live on disk only. Re-create them from this description if they are gone.

### Observations, deliberately NOT acted on (out of the presentation scope)
1. **The frozen list still exposes two write controls** — `Delete` (attachment
   row, `AttachmentsPanel`) and `Reject` (`TaskListWorkflowActions`, in the
   Next-step card). **Identical at `f08ea13`**, i.e. pre-session, so this is
   not a regression from the split — but check #2 of §7 does not actually
   hold today. Fixing it means touching permissions, not presentation.
2. **`sales` gets a 404** on both subject task lists. Also identical at
   `f08ea13` — the account is not on those affairs. Not an access regression;
   re-run check #5 against a list that account owns.
3. **Primary buttons are accent green, not ink.** `.po-premium .bg-solux` sets
   it with `!important` page-wide; "Validate →" and "Add" get the same
   treatment. The reference's ink primary is a page-wide change, not a
   per-button override.
4. **Two orphan CSS rules predate this session**: `.ops-topbar` (no JSX uses
   it — the pinned command bar is the app header) and `.ops-card.next` /
   `.nx-title` (the JSX says `next-wrap`). Side effect: `.nx-meta` in the
   Revision card is styled by `.ops-card.next .nx-meta` and therefore gets no
   styling at all.

### Next
§4 item 2 — the mini stepper — is now the largest structural gap, followed by
the `MISSING` badges and the `resolve →` links (which need the active tab in
context, see §6).


---

## 10. Session 2 — the finishing list (§4 items 2-5)

| Commit | Item | How |
|---|---|---|
| `8c0af35` | `resolve →` links | `OpsTabs` delegates a click listener on `document`, walks the anchor target up to its `[data-ops-panel]`, activates that tab, then scrolls. Nothing lifted into context, no panel unmounted — so §6's pitfall does not apply. Anchors outside a panel keep native behaviour. |
| `f1f681f` | `MISSING` badges | `TaskLineEditor` wraps each field in `.cfg-field` and renders the badge there. `ConfigFieldInput` is still untouched. |
| `741b5b2` | `Save line` | The whole block moved onto the `.cfg-line` header row; the duplicate "Unsaved changes" chips moved with it instead of being shown twice. |
| `f187916` | Mini stepper | `.flow.mini`, a CSS variant of the same markup and the same `deriveFlowSteps()` data. |

### The one thing to know about the MISSING badges
The badge calls `isRequiredFieldEmpty()`, extracted from `countRequiredEmpty`'s
loop and now used by both, so a badge shows **if and only if** the KPI counted
that field. That means it follows `required_for_production`, **not** the
`required` flag behind the red asterisk — and in the catalogue the two do not
coincide. On `7158d184` the badges land on BATTERY and SPIGOT while
`SOLAR PANEL *`, `OPTIC *` and `CCT *` carry an asterisk and no badge.

That reads oddly, and it is a **data question, not a UI one**: either those
asterisked fields should be `required_for_production`, or the badged ones
should not carry an asterisk. Badging the asterisk instead would have shown 3
badges against a KPI of 2 — exactly the divergence this page forbids. Worth
raising with whoever owns the category config.

### Things that moved and were re-measured
- Sticky stack after the header grew: KPI 134→229, tab bar 229→287, rail
  295→985 at scrollY 700, no overlap. The bar pinned at 0-134 is the **app
  header**, not this page's `.head`, which is why growing `.head` changed
  nothing. (Related: `.ops-topbar` in the stylesheet matches no JSX at all.)
- Two full-width rules had to be undone for the compact stepper: `flex: 1`
  (labels collided) and the `top: 6.5px` connector (struck the labels through
  once the row was 14px tall).
- Page height, TLM on `7158d184`: 2900 → 2450 (rail split) → **2314px**.

### Verified after the finishing list
```
tsc 0 · 803/803 · e2e:regression 23/23
TLM + operations: 7 tabs, 5 rail cards, 0 pageerror, 0 console.error, typing survives
FROZEN 10ff8536: 0 Save line, empty caption, 0 add-item, 0 confirm-ai
resolve → : 5/5 links switch to the right tab, target visible
MISSING   : KPI "2 still empty" vs exactly 2 badges; clears live on selection
```
The two pre-existing findings from §9 still stand: the frozen list's `Delete`
and `Reject`, and `sales` 404ing on both subject lists.
