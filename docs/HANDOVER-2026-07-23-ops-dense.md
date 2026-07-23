# Ops Dense — design notes and incremental plan for the Task List page

**Status: NOT IMPLEMENTED.** On 2026-07-23 the page was restored to
`origin/main` (`1d4b01e`) after a large redesign drifted too far to review
safely. This file is no longer a record of what shipped — it is the notes and
the plan for redoing it **incrementally, one validated slice at a time**.

**Repo:** `~/dev/facturation` — the iCloud folder is a stale non-git copy.
**Reference:** `~/Downloads/PTL-SLX-AES-26-005 Ops Dense - standalone.html`.

---

## 1. Why the first attempt was rolled back

It was one big refactor: tab shell, KPI strip, decision rail, board split,
badges, stepper, revision overlay — all landing before the owner could judge
any single piece. Each commit was individually verified, but the page as a
whole was never validated against the reference by the person who owns it, so
the gap kept being discovered late and patched, which is drift.

**The rule for the next attempt: one slice, shown, accepted, then the next.**
No slice may depend on a later one to make sense.

Reverted in commit "restore the task-list page to origin/main". The work is
still in history (`3b4c9a0` … `9514d12`) and can be read for reference — but
it should be re-derived slice by slice, not cherry-picked wholesale.

---

## 2. Reading the reference

It is a bundled artifact, not plain HTML. To extract:

```bash
python3 -c "import re,json;h=open('/Users/mehdizouai/Downloads/PTL-SLX-AES-26-005 Ops Dense - standalone.html',encoding='utf-8').read();t=json.loads(re.search(r'<script type=\"__bundler/template\"[^>]*>(.*?)</script>',h,re.S).group(1).strip());open('/tmp/ref-template.html','w').write(t)"
```

The behaviour lives in the `<script type="text/x-dc">` block of that template.
**Read it — it is the spec, not just a picture.** What it defines:

| State | Default | Drives |
|---|---|---|
| `tab` | `product` | 8 tabs: product · industrial · lighting · branding · risks · **spares** · docs · activity |
| `revModal` | closed | the revision history overlay |
| `aiOpen` | **open** | AI-extracted values card collapses (`Hide ▴` / `Show ▾`) |
| `progOpen` | **open** | lighting programme collapses (`Collapse ▴` / `Expand ▾`) |
| `pendingOpen` | **closed** | pending issues add-form (`+ Add ▾` / `Hide ▴`) |

Also in the reference and easy to miss:
- each blocker has a **second line** naming the fields (`Sales configuration —
  Optic, CCT`) and a `go:` that switches tab;
- the KPI strip is **BLOCKING · LIGHTING · AI VALUES · REVISION · QUOTE
  TERMS** — not the current app's Required fields / Factory mappings / Tilt
  angle set;
- revisions are `Rev D in progress` / `Rev C validated` / `Rev B, A
  superseded`, each with a reason and a date.

### Design tokens
| Token | Value |
|---|---|
| accent | `#55ff7e` · deep `#0b7a39` · tint `rgba(85,255,126,.14)` |
| ink | `#0f0f0f` |
| text / muted | `#2a2a2c` · `#67646f` · `#aeaaba` |
| lines | `#e7e7ea` (cards) · `#dcdde1` (controls) |
| amber | `#e8870e` · deep `#9a5a00` · line `rgba(232,135,14,.42)` — **needs attention only, never decorative** |
| page bg | `#faf9f5` |

No border-radius anywhere · `font-variant-numeric: tabular-nums` on every
figure · uppercase micro-eyebrows 10–11 px / 700–800 / `.06em`.

---

## 3. Constraints that cost real time to discover

Keep these whatever the implementation order.

| Constraint | Why it bites |
|---|---|
| **`evaluateRelease` is the only release authority** | Any rail / KPI / badge must MIRROR it. A hand-rolled "needs attention" list drifted from the gate and silently omitted blocking action items, open revisions and empty task lists. |
| **`required` ≠ `required_for_production`** | The red asterisk uses `required`; the KPI and the gate use `required_for_production`. They do **not** coincide in the catalogue — badging the asterisk showed 3 badges against a KPI of 2. Whatever marks a field must call the same helper the count calls. **Also a data question worth raising:** on `7158d184`, `SOLAR PANEL *` is not required-for-production while `BATTERY` (no asterisk) is. |
| **`ConfigFieldInput` is shared with the quote builder** | Never edit it. Style it from outside (`.cfg-form > label`, `> .block`), or wrap it — and if you wrap it, every `.cfg-form > x` rule needs a `.cfg-form > .wrapper > x` twin or the 3-column grid breaks. |
| **A frozen task list must expose no write control** | Verify on `10ff8536-…`. Note two write controls exist there **already, on `origin/main`**: `Delete` on an attachment row (`AttachmentsPanel`) and `Reject` (`TaskListWorkflowActions`). Pre-existing, not caused by the redesign — but a real finding to settle separately. |
| **If panels become tabs, they must stay MOUNTED** | `display:none`, never conditional rendering: unmounting drops in-progress form input and breaks the anchors. |
| **A sticky offset chain is measured, not guessed** | Command bar 134 → KPI strip 229 → tab bar 287 → rail 295. The bar pinned at 0–134 is the **app header**, not this page's `.head`. Re-measure after any header change. |
| **An overlay rendered inside the sticky rail is painted over** | The sticky command bar / KPI strip / tab bar are their own stacking contexts. Portal to `<body>`; if the CSS is page-scoped, the portalled wrapper needs the page classes plus `display: contents`. |
| **`.po-premium .bg-solux` is `!important`** | Primary buttons are accent green page-wide. The reference's ink primary is a page-wide decision, not a per-button override. |
| **Blocks must be MOVED verbatim, never rewritten in passing** | Rewriting while relocating is how business behaviour breaks unnoticed here. |

### Dead CSS already in the file (pre-existing)
- `.ops-topbar` — matches no JSX.
- `.ops-card.next` / `.nx-title` — the JSX says `next-wrap`, so `.nx-meta` in
  the Revision card is styled by nothing.
- `select:required:invalid` — `ConfigFieldInput` sets no `required`, so this
  half never matched the product configuration.

---

## 4. What the page actually needs, worst first

Ranked by what the owner reacted to, not by implementation order.

1. **Revisions are invisible.** Everything already exists — `RevisionsPanel`
   carries the lineage, reasons, authors, the field-level diff and
   `openControlledRevision` with its capability gate and mandatory reason. It
   is simply rendered far down the page. The user cannot see how many
   revisions exist, when they were opened, or open a previous one. *This needs
   surfacing, not building.*
2. **The page says things two and three times.** On `5aed8777`: Generate
   Production PDF ×2, Send by Email ×2, and a readiness banner restating both
   the top-of-page counts and the board. Measured before the revert.
3. **~8 400 px of vertical stack.** Everything is always visible, so nothing
   is prioritised.
4. **Interactions are missing**, not just layout: the reference's collapsibles
   and its blocker → tab navigation.

---

## 5. Incremental plan

One slice per round. Each is independently shippable and independently
revertible; each ends with a screenshot for the owner **before** the next
starts.

| # | Slice | Touches | Owner sees |
|---|---|---|---|
| 1 | **Revision history reachable** — surface the existing `RevisionsPanel`: current rev, how many, when, open any previous one | `page.tsx` placement + a small card | The revision workflow working, on `5aed8777` (Rev A–D) |
| 2 | **Remove the duplications** — one home per action | `page.tsx` | PDF / Email / Excel once each; no banner echoing the counts |
| 3 | **Tokens + density only** — type scale, square corners, tabular figures, spacing. No structural change | `tasklist.css` | Same page, denser and calmer |
| 4 | **KPI strip** — the reference's five facts, mirroring `evaluateRelease` | `page.tsx` + css | The five facts pinned at the top |
| 5 | **Tabs** — 7 or 8 panels, mounted, anchors preserved | new `OpsTabs` + `page.tsx` | One click to any section |
| 6 | **Decision rail** — needs attention · next step · pending · AI values | `PreValidationBoard` split + `page.tsx` | The rail, with blocker → tab links |
| 7 | **Interactions** — `aiOpen`, `progOpen`, `pendingOpen`, blocker sub-lines | components | Collapsibles behaving like the reference |
| 8 | **Polish** — MISSING badges, Save line placement, mini stepper, Spare parts tab | components | The remaining reference details |

Slices 1 and 2 are pure wins with no visual risk — start there.

### Per-slice checklist
```bash
cd ~/dev/facturation
npx tsc --noEmit          # 0
npm test                  # 803/803
npm run e2e:regression    # 23/23
```
Then, in the browser, on `/task-lists/<id>`:
1. `7158d184-…` (Pre-Validation) — the slice does what it claims;
2. `5aed8777-…` (Final Validation, Rev A–D) — revisions and dossier actions;
3. `10ff8536-…` (frozen) — no NEW write control appears;
4. zero `pageerror`;
5. repeat 1 as `operations` (`sales` 404s on these three lists — it is not on
   those affairs; use a list that account owns).

Accounts: domain `solux-light.com`, password in `.env.e2e` (`E2E_PASSWORD`),
users `testlm@` / `testoperation@` / `testsales@` / `testdir@`.

---

## 6. Verification harness

`e2e/audit/*.tmp.*` are gitignored, so they live on disk only. The useful one
logs in for real and reports, per task list: tab count, rail cards, page
height, duplicate action buttons, write controls on the frozen list, whether
typing survives a tab switch, and `pageerror` count. Rebuild it from the login
pattern in `e2e/audit/cockpit-scan.ts` — it is 40 lines, and it caught every
regression in the reverted attempt, including two the eye missed.

Two techniques worth reusing:
- **Prove a refactor changed nothing**: capture the rendered DOM of the block
  before and after with `data-testid` stripped, and `diff` them. A byte-equal
  diff is proof that a "pure move" really was one.
- **Prove a moved block is verbatim**: assert the new HTML is an exact
  substring of the old.
