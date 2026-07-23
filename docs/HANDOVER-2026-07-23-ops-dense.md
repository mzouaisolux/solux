# Handover — Ops Dense redesign of the Task List page
**Session:** 2026-07-23 · **Branch:** `main` @ `f08ea13` (4 commits ahead of `origin/main`)
**Repo:** `~/dev/facturation` — the iCloud folder is a stale non-git copy, never code there.
**Scope:** presentation only. No business logic, no schema, no server action was changed.

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
| Rail: **Pending issues · AI-extracted values** | ❌ **missing — still full-width above the tabs** |
| `MISSING` amber badges on empty required fields | ❌ CSS approximation only (`:invalid`), no badge |
| `resolve →` links in Needs attention | ❌ text only, not links |
| Mini stepper in the header right | ❌ still a full-width card |
| `Save line` ink button at panel top-right | ❌ still inline in the form |

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
| `PreValidationBoard` | still whole; splitting it is the next task (§5) |
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
1. **Split `PreValidationBoard` into rail cards** — the last structural gap. Its three parts belong in the rail (§5).
2. **Mini stepper in the header** — the reference shows the 6-step lifecycle as a small dot row at the command bar's right. Currently a full-width `.flow` card. Needs a compact variant, not a second component.

### Small polish
3. `MISSING` amber badge next to the label of a required-but-empty field (the reference shows a real badge; today only the input is tinted via `:invalid`).
4. `resolve →` links in the rail's Needs attention, jumping to the owning tab — requires lifting the active tab into context (see the pitfall in §6).
5. `Save line` as an ink button at the Product panel's top-right, with the reference's caption "Changes are kept in memory until you click Save line".
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
