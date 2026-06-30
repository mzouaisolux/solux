# SOLUX — Redesign handoff (read this first)

Context for continuing the "apply the offline HTML mockups to the live app" work.
**Start the new conversation from `~/dev/facturation` and read this file first.**

---

## 0. The #1 rule (the user insisted on this)
When the user gives an HTML mockup, the live page must be **EXACTLY like the mockup** —
a **faithful structural reconstruction**, NOT a "skin" (don't just wrap the existing
markup in `.solux-pro` and recolor it). Rewrite the markup section-by-section to match
the mockup's structure, while preserving 100% of the data/logic (server actions, forms,
props, conditionals).
**And: YOU verify it before saying "done"** — the user does not want to re-check each time.

---

## 1. Where to work (critical)
- **Canonical repo: `/Users/mehdizouai/dev/facturation`** (git-tracked, clean). The dev
  server runs from here; this is what `localhost:3000` serves. **Always edit here.**
- There is a STALE non-git duplicate at `~/Library/Mobile Documents/.../APP FACTURATION`
  (iCloud). **Do NOT edit it.** (A whole session was lost editing the wrong copy.)
- The user reviews everything with `cd ~/dev/facturation && git diff` and can revert with
  `git checkout -- <file>`.

## 2. The design system (already in `app/globals.css`, scoped under `.solux-pro`)
- The app `<body>` is **already** the grey canvas `#EEEEF0` + a 2px green top line.
  White cards float on it. (Don't re-paint the canvas; `.sx-page` is a no-op.)
- Font: **Plus Jakarta Sans** via `--font-jakarta` (already loaded in `app/layout.tsx`).
- Tokens live in the `.solux-pro { --sx-*: ... }` block: `--sx-ink #0f0f0f`,
  `--sx-canvas #eeeef0`, **`--sx-card #ffffff`** (MUST stay defined — see gotchas),
  `--sx-green #55ff7e`, `--sx-green-deep #0b7a39`, `--sx-amber #e8870e`,
  `--sx-amber-deep #9a5a00`, `--sx-line #e7e7ea`, `--sx-line-2 #dcdde1`,
  `--sx-mute #67646f`, `--sx-mute-2 #aeaaba`, `--sx-shadow ...`.
- Reusable classes (all scoped `.solux-pro`):
  - Layout: `.sx-page`, `.sx-wrap`, `.card`, `.sec`, `.sechead`, `.sx-detail`.
  - Buttons: `.sx-btn` (base), `.sx-btn-go` (green CTA), `.sx-btn-ink` (dark),
    `.sx-btn-sm`, `.sx-btn-danger`; links `.sx-link` (green), `.sx-muted-link`.
  - Text: `.eyebrow` (overridden to mute), `.sx-eyebrow`, `.sx-micro`/`.px-micro`.
  - Forms: scoped `input[type=...]`, `select`, `textarea` are **square** automatically;
    `.spec-list`/`.spec-row`, `.fgrid`/`.fcol`/`.fl`/`.req`, `.savebar`.
  - Data: `.meta`/`.meta-grid`/`.px-meta-grid`, `table.sx-list`, `table.px-grid`
    (`.num`, `.thincell`, `.px-pname`, `.px-sku`, `.px-cellprice .mg`, `.px-rowlink`,
    `tr.sel` green), `.px-sbadge` (`.published/.draft/.archived/.ok/.thin/.missing`).
  - Pricing: `.px-banner`, `.px-tabs`/`.px-tab`, `.px-filterbar`, `.px-toolbar`/`.px-tact`
    (`.pub/.neutral/.del`)/`.px-selcount`, `.px-notice.amber`, `.px-preview`, `.px-collap`,
    `.px-editrow`, `.px-chip`/`.px-chips`/`.px-assignform`, `.px-recent-row`/`.px-dot`,
    `.px-settings-grid`, `.px-flabel`, `.px-muteit`, `.px-sub`.
  - Dashboard: `.sx-stab`, `.sx-bucket`, `.sx-tile`, `.sx-argrid`, `.sx-bgrid`,
    `.sx-sectitle`, activity `.sx-act-*`.
  - **Compat skin** (for big inline-Tailwind subtrees): inside `.solux-pro`, `rounded-*`
    → square, `border-neutral-*` → `--sx-line`. (`rounded-full` is left alone.)
- **Naming to avoid collisions:** prefix NEW classes with `px-` (or `sx-`) and scope them
  `.solux-pro .px-foo {}`. Use `--sx-*` tokens, never bare `--ink` (those are the dev
  premium system's globals).

## 3. The mockup file format (how to decode)
The HTML files are a "bundler" format. The real page is a JSON string in
`<script type="__bundler/template">`. Decode:
```python
import json, re
data = open('FILE.html').read()
html = json.loads(re.search(r'<script type="__bundler/template">(.*?)</script>', data, re.S).group(1).strip())
open('/tmp/mockup.html','w').write(html)   # then read its <style> + body
```

## 4. Workflow per mockup
1. Decode the mockup → read its CSS (`<style>`) + body structure.
2. Find the live page(s) under `app/(app)/...`.
3. Port any NEW mockup classes into globals.css under `.solux-pro` (px-/sx- prefixed,
   `--sx-*` tokens). Keep braces balanced.
4. **Rewrite the live markup to match the mockup exactly**, preserving all data/logic.
5. Verify (section 5), then tell the user to **HARD REFRESH**.

## 5. Verification (MANDATORY — the user wants you to check, not them)
```bash
cd ~/dev/facturation
node_modules/.bin/tsc --noEmit 2>&1 | grep '<your files>'   # expect 0 NEW errors
# (10 pre-existing errors in lib/supabase/middleware.ts + server.ts — IGNORE them)
python3 -c "s=open('app/globals.css').read(); print('balanced' if s.count('{')==s.count('}') else 'UNBALANCED')"
# Confirm the dev server actually serves your new CSS (pages need auth, CSS doesn't):
html=$(curl -s http://localhost:3000/login)
href=$(echo "$html" | grep -oE '/_next/static/css/[^"]+\.css' | head -1)
curl -s "http://localhost:3000$href" | grep -c 'your-new-class'   # >0 = live
```

## 6. Gotchas / lessons (these cost real time this session)
- **Hard refresh.** Next dev + the browser cache the global CSS. A normal `Cmd+R` keeps
  showing the OLD design → "I see no change". The fix is **`Cmd+Shift+R`** (or an incognito
  window). Restarting `npm run dev` is NOT enough; the browser cache is the culprit.
- **`--sx-card` must be `#ffffff`.** If undefined, `.card { background: var(--sx-card) }`
  is invalid → cards are transparent → grey-on-grey "unicolore" everywhere.
- **Offline previews lie if the body is white.** A near-white preview body hides the
  transparent-card bug. If you build a preview to check, set body `background:#EEEEF0`
  (the real dev canvas). Better: use the served-CSS check above.
- Pricing pages need **admin** role; you can't curl the rendered HTML (auth) — curl the CSS.
- Don't kill the user's running dev server without asking.

## 7. Status so far
- **Projects** — FULL reconstruction: `app/(app)/projects/page.tsx` (dashboard/list),
  `[id]/page.tsx` (detail, incl. compact Activity footer + m098 freight preserved),
  `new/page.tsx` + `new/NewProjectForm.tsx` (create form). Components:
  `ProjectStatusBadge`, `ProjectActionsWidget`, `lib/project-status-colors.ts`,
  `[id]/ProjectPricingCard.tsx`. Mockups: `solux-projects-offline(-2).html`.
- **Pricing** — FULL reconstruction: `app/(app)/admin/pricing/page.tsx` (main: banner +
  create form + recent + settings), `library/page.tsx` + `library/LibraryTable.tsx`,
  `[id]/page.tsx` (detail), `CreatePriceListForm.tsx`, `PricingActionsClient.tsx`.
  Mockup: `solux-pricing-offline.html`.
- **Quotation editor** (`app/(app)/documents/new/page.tsx` + `NewDocumentForm.tsx`,
  ~2550 lines) — only a **SKIN** so far (wrapped in `.solux-pro` + compat). ⚠️ If the user
  wants it exact, it still needs a real section-by-section reconstruction.
  Mockup: `solux-quotation-editor-offline.html`.
- **Task lists** (`app/(app)/task-lists/[id]`) already had a "premium" redesign by the user
  (not mine) — leave unless asked.

## 8. Next likely targets (mockups the user mentioned)
- **Cost entry** and **Admin** pages (the user said "Still on my list: Cost entry and Admin").
- Re-do the **quotation editor** as a real reconstruction if asked.
