# Session change manifest — 2026-06-29/30 (pilot fixes + Sprint-1 dashboards)

> **STATUS: NOT committed — and intentionally so (owner decision, 2026-06-30).**
> Priority is a clean, truthful git history. Any fix that cannot be isolated from the
> pre-existing "premium" WIP (~200 uncommitted files; 213 working-tree entries incl. this
> session) is **left uncommitted** and re-applied during the
> planned lotting. The working tree is **unchanged** this session — only read-only
> `git diff` / `git status` were run (no `git add`, no `git commit`, nothing staged).
> **Never create a commit whose message overstates its contents** — that rule is why the
> 3-commit plan was abandoned (most files are WIP-entangled; see §1–§2).
>
> Base: branch `freeze/core-metier`, HEAD `3c485a1` (= freeze `157e52c` + later owner commits;
> all diff sizes in §1 are measured against this HEAD). Verified after all changes:
> **tsc clean** (only pre-existing `lib/supabase/{middleware,server}.ts` implicit-any) ·
> **`npm run check:schema` ✅** · **`npm run e2e:regression` 23/23** · **`npm test` 247/247** ·
> real per-role login checks (dashboards + Orders-in-Flight + SR wizard create/edit).
>
> Planned lot order (handover roadmap): migrations → permissions/visibility → shell/UI →
> core (rebased) → CRM/Clients (F6) → CRM/Requests (flagged).

## 1. Commit-readiness verdict (verified per file)

✅ = diff is 100% mine, isolable, safe to stage alone (held only by owner decision).
⛔ = diff mixes my change with foreign WIP → **do NOT commit alone**; re-apply during lotting.

| File | Diff vs HEAD | Verdict | Fix(es) | Re-apply lot |
|---|---|---|---|---|
| components/NotificationBell.tsx | +1/−1 | ✅ clean | Polish (bell 9+) | shell/UI |
| components/feedback/Toaster.tsx | +3/−1 | ✅ clean | Polish (no ✓✓) | shell/UI |
| components/DocQuickActions.tsx | +10/−1 | ✅ clean | Polish (confirm Won) | shell/UI |
| app/(app)/projects/[id]/ProjectPricingCard.tsx | +14/−5 | ✅ clean | BUG-7 | CRM/Requests |
| components/reminders/QuotationRemindersSection.tsx | +6/−12 | ✅ clean | BUG-8 | shell/UI or documents |
| app/(app)/dashboard/ActionCenter.tsx | new file | ✅ clean but **INERT** w/o dashboard/page.tsx | Sprint-1 dashboards | shell/UI |
| lib/pdfFonts.ts | +32/−18 | ✅ clean | **Factory PDF font fix** (italic faces + safe weight/title mapping) — §G | Task Lists / core (shared PDF) |
| app/(app)/task-lists/[id]/ExportPdfButton.tsx | +47/−18 | ✅ clean | Factory PDF F3-safe dynamic import + feedback — §G | Task Lists / core |
| public/fonts/ArminGrotesk-Italic.otf | new asset | ✅ clean | italic body face (copy of "Armin Grotesk Italic.otf", no-space name) — §G | Task Lists / core (shared PDF) |
| public/fonts/ArminGrotesk-BlackItalic.otf | new asset | ✅ clean | black-italic face (copy of "Armin Grotesk Black Italic.otf") — §G | Task Lists / core (shared PDF) |
| app/(app)/clients/actions.ts | +259/−6 | ⛔ WIP | BUG-1 | CRM/Clients |
| app/(app)/clients/NewClientPanel.tsx | +50/−10 | ⛔ WIP | BUG-1 | CRM/Clients |
| app/(app)/projects/[id]/page.tsx | +669/−555 | ⛔ WIP | BUG-2, BUG-3 | CRM/Requests |
| app/(app)/projects/new/page.tsx | +206/−21 | ⛔ WIP | BUG-2 | CRM/Requests |
| app/(app)/projects/new/NewProjectForm.tsx | +354/−157 | ⛔ WIP | BUG-2 + S1-5 wizard | CRM/Requests |
| app/(app)/projects/actions.ts | +307/−8 | ⛔ WIP | BUG-2, BUG-9, FR→EN polish | CRM/Requests |
| app/(app)/task-lists/[id]/TaskLineEditor.tsx | +234/−52 | ⛔ WIP | BUG-6 + Task A SaveButton | Task Lists / core |
| app/(app)/task-lists/[id]/tasklist.css | +66/−3 | ⛔ WIP | Task A SaveButton CSS | Task Lists / core |
| app/(app)/task-lists/[id]/page.tsx | +130/−13 | ⛔ WIP | BUG-6 + S1-6 section nav | Task Lists / core |
| app/(app)/dashboard/page.tsx | +375/−2225 | ⛔ heavily WIP | Sprint-1 wiring + greeting | shell/UI |
| app/(app)/layout.tsx | +23/−7 | ⛔ WIP | Polish (remove Messages widget) | shell/UI |
| app/(app)/dashboard/OperationsTab.tsx | new WIP file | ⛔ WIP file | Orders-in-Flight fix | shell/UI |

**9 files/assets are clean-committable**: the original 5 (NotificationBell, Toaster, DocQuickActions, ProjectPricingCard, QuotationRemindersSection) **plus the Factory-PDF fix** — `lib/pdfFonts.ts`, `ExportPdfButton.tsx`, and the two new `public/fonts/ArminGrotesk-{Italic,BlackItalic}.otf` assets (all 100% mine, isolable; see §G). ActionCenter.tsx is clean but inert until the WIP dashboard page is lotted. Everything else is WIP-blocked.

> ⚠ **The Factory-PDF fix (§G) is a genuine bug fix that also repairs the Quotation & Invoice PDFs** (shared `lib/pdfFonts.ts`). The 4 PDF files above are clean and could be committed as one focused "fix(pdf): register italic faces so PDF generation stops throwing" commit — held only by the owner's no-commit directive.

## 2. Files blocked by existing WIP — proof

- **NewClientPanel.tsx** — diff contains my BUG-1 error handling **AND** the WIP `trigger`/`deepLink` props refactor + conditional button render (CRM "premium" WIP).
- **layout.tsx** — my Messages-widget removal **AND** WIP `I18nProvider`/`getLocale` wrapping, `NoRoleNotice` import, `locale` prop, S1.5 no-role gate.
- **dashboard/page.tsx** — my ~15-line ActionCenter wiring + greeting **AND** the WIP dashboard rewrite (+375/−2225).
- **projects/[id]/page.tsx, projects/new/page.tsx, NewProjectForm.tsx, projects/actions.ts** — my BUG-2/3/9 + wizard **AND** the WIP CRM/Requests engine + form rewrite.
- **clients/actions.ts** — my ~20-line BUG-1 inside a +259-line WIP diff.
- **TaskLineEditor.tsx, task-lists/[id]/page.tsx** — my BUG-6 + WIP task-list rewrite.
- **OperationsTab.tsx** — a **new file created by the WIP**; the Orders-in-Flight fix lives inside it, so the fix cannot be staged without the whole WIP file. Re-apply the fix (§D) once OperationsTab is committed in the shell/UI lot.

## 3. Re-application plan (per lot, when the WIP is committed)

1. **shell/UI lot** — apply: Sprint-1 dashboards (§B, add `ActionCenter.tsx` + wire into `dashboard/page.tsx`), polish (§C), Orders-in-Flight fix (§D into `OperationsTab.tsx`). The 5 clean files (NotificationBell/Toaster/DocQuickActions/QuotationRemindersSection + ProjectPricingCard) can be committed verbatim.
2. **CRM/Clients lot** — apply BUG-1 (§A) into `clients/actions.ts` + `NewClientPanel.tsx`.
3. **Task Lists / core lot** — apply BUG-6 (§A) + S1-6 section nav (§E) into `TaskLineEditor.tsx` + `task-lists/[id]/page.tsx`.
4. **CRM/Requests lot** — apply BUG-2/3/7/9 + S1-5 wizard (§A, §B2) into the projects files.
   - ⚠ `projects/actions.ts` also contains the FR→EN polish line (§C) — keep it with this lot.

---

## A. Pilot bug-fixes

- **BUG-1 — duplicate client code crashed the app + lost the form.** ⛔ WIP-blocked (CRM/Clients lot)
  - `clients/actions.ts` → `createClientAction`: validation + insert errors now `return { error }` (not `throw`); unique-violation (`code 23505` / `/client_code|unique/`) → friendly message.
  - `clients/NewClientPanel.tsx`: `formError` state; action captures the returned `{error}` and shows it inline (modal + data preserved); cleared on close.

- **BUG-2 — Sales couldn't edit a returned/draft Service Request.** ⛔ WIP-blocked (CRM/Requests lot)
  - `projects/actions.ts` → new `updateProjectRequest(formData)` (requireCapability `project.create`, `.eq("status","draft")`; updates spec/config fields; redirect to detail).
  - `projects/new/page.tsx`: `?edit=<id>` → load request, build full `initial` + `editId`; "Edit service request" header.
  - `projects/new/NewProjectForm.tsx`: `ProjectFormInitial` extended; `editId`/`isEdit`; state seeded from `initial`; uncontrolled inputs get defaultValue/defaultChecked; action branches create vs update; client+affair locked in edit; "Save changes" button.
  - `projects/[id]/page.tsx`: "Edit request" link in the draft owner-action block.

- **BUG-3 — Director's modification note was invisible to Sales.** ⛔ WIP-blocked (CRM/Requests lot)
  - `projects/[id]/page.tsx`: compute latest `pr.info_requested` note → "Changes requested by … : <note>" banner on the draft; activity timeline renders `e.message` for info_requested/rejected (was a static label).

- **BUG-6 — task-list production config blank with no guidance.** ⛔ WIP-blocked (Task Lists lot)
  - `task-lists/[id]/TaskLineEditor.tsx`: new `salesSpec` prop → "From the service request — match these specs" panel above the Sales config fields (non-manual lines). (Deliberately NOT auto-mapping free-text→catalog enums — would risk wrong builds.)
  - `task-lists/[id]/page.tsx`: pass `salesSpec={task.original_sales_request}`.

- **BUG-7 — "Approve pricing" first click did nothing (pre-hydration).** ✅ CLEAN (ProjectPricingCard.tsx)
  - `projects/[id]/ProjectPricingCard.tsx`: `mounted` gate; `PricingSubmit` disabled until hydrated.

- **BUG-8 — dev "run migration 043" message leaked into the quotation UI.** ✅ CLEAN (QuotationRemindersSection.tsx)
  - `components/reminders/QuotationRemindersSection.tsx`: missing table → `return null` (no internal notice).

- **BUG-9 — pole specs not carried into the manual task-list item.** ⛔ WIP-blocked (CRM/Requests lot)
  - `projects/actions.ts` → `generateQuotationFromProject`: `poleName` composed from `pole_height` + `arm_length` + `pole_notes` (carries through quote → proforma → task-list manual item → factory export).

> NOTE: **BUG-4** (freight needs packing) is NOT a bug — intended workflow (owner). **BUG-5** (factory-mapping discovered only at the release gate) = UX improvement, not done.

## B. Sprint-1 — action-first dashboards (lot: shell/UI) ⛔ page.tsx WIP-blocked; ActionCenter.tsx clean-but-inert

- `dashboard/ActionCenter.tsx` (**new, ✅ clean**): role-aware "Needs your action" hero. Director = Service requests to approve + Price requests; TLM/Operations = Task lists needs your review; Sales = Ready to generate quotation + Won→launch production + Draft SRs, plus a collapsed "Waiting". Queries workflow tables directly (RLS-scoped). Empty state = "You're all caught up". **Inert until wired in `dashboard/page.tsx`.**
- `dashboard/page.tsx` (⛔ WIP): render `<ActionCenter role={effectiveRole ?? ""} />` above the tabs; greeting from `user_profiles.display_name` (first word; query keyed on `user_id`); subtitle clarified; Sales "CRITICAL — HANDLE NOW" bucket relabeled "Needs attention — plan a next step" (amber, not red).

## B2. Sprint-1 — Service Request wizard (S1-5) (lot: CRM-Requests) ⛔ WIP-blocked

- `projects/new/NewProjectForm.tsx`: long form → **4-step wizard** (① General → ② Services → ③ Configuration → ④ Review) with step indicator + Back/Next. All fields stay **mounted** (only current step shown via `display:none`) so the single `<form>` still submits complete FormData. Native `required` (client/freight) replaced by **per-step JS validation** (`canLeaveStep0/1`); server actions remain the backstop. `onKeyDown` blocks Enter-submit on non-final steps. Works for create AND edit. Verified via real login (created "Wizard Test 30 Juin"; edited qty 150→175).

## C. Polish (lot: shell/UI)

- `components/NotificationBell.tsx` (✅): badge caps at **"9+"** (was 20+).
- `components/feedback/Toaster.tsx` (✅): strip a leading ✓ so success toasts aren't **✓✓**.
- `components/DocQuickActions.tsx` (✅): `window.confirm` before **Mark Won**.
- `layout.tsx` (⛔ WIP): removed the global floating "Messages" `ConversationLauncher` (import + mount).
- `projects/actions.ts` (⛔ WIP, `generateQuotationFromProject` `srNeed`): FR→EN ("Category:", "IoT required", "Specific request:").
- Auto-open generated quote: already works (`generateQuotationFromProject` redirects to `/documents/new?edit=<id>`; `ActionForm` re-throws the redirect) — no change needed.

## D. Orders-in-Flight fix (lot: shell/UI) — separate pre-existing bug ⛔ WIP file

- `dashboard/OperationsTab.tsx`: "Orders in flight" was empty because it joined won **quotations** → task lists by `quotation_id`, but task lists are created from the **proforma** (20/21 task-list `quotation_id`s point to proformas). **Re-apply:** join on **`affair_id`** (shared by the won quote via m124 and the task list via F4): add `affair_id` to the docs select (+ the archived_at fallback select); build `taskListByAffair` from `production_task_lists.affair_id IN (won affair ids)`; `ordersForFlight = wonDocs.filter(d => d.affair_id && taskListByAffair.has(d.affair_id))`; look up `tl` by `d.affair_id`. Verified: section showed 5 active orders. NOT introduced by Sprint 1.

## E. Sprint-1 — Task List section nav (S1-6) (lot: Task Lists / core) ⛔ WIP-blocked

## F. Factory Instructions — stronger save feedback (Task A) (lot: Task Lists / core) ⛔ WIP-blocked

- `task-lists/[id]/TaskLineEditor.tsx` + `tasklist.css`: module-level **`SaveButton`** for the per-field "Save · Order only" / "Save · For client" actions (field rows **and** additional factory fields). Click → spinner **"Saving…"** (disabled, blocks double-clicks) → green **"✓ Saved"** → back to the label; inline error on failure. The four save handlers (`saveFieldForOrder/Client`, `saveExtraForOrder/Client`) await the server action directly so the button drives its own state.

- **REINFORCED 2026-06-30 (owner: "je veux quelque chose de mieux, plus sûr que l'action est valide").** The save confirmation is now **three independent layers** so a save can never feel uncertain — and a failed save can never look successful:
  1. **Button** — `✓ Saved` held ~2.4 s (was 1.8 s), pop animation, stays visually active (not dimmed) while saving/saved.
  2. **Green success toast** — `pushToast("Saved to this order" / "Saved for this client", "success")` via the existing global `Toaster` (emerald, ✓, 4 s, bottom-right). On failure a **red error toast** fires in addition to the inline error.
  3. **Persistent timestamped badge** — the row badge was **un-demoted** from muted grey to a clear green pill **`✓ Saved to this order · HH:MM`** that **stays until the field is edited again** (`savedRows` now stores `{mode, at}`; new shared `SavedBadge` component; new `.fi-saved` pill + `fi-saved-in` entry animation). The user can glance back any time and see the value was committed, and when.
  - New dep: `import { pushToast } from "@/components/feedback/toast-store"` (Toaster already mounted at `layout.tsx:66`). Still ⛔ WIP-blocked — same files carry BUG-6 + the WIP task-list rewrite.
  - **Verified via real TLM login** (testlm) on task list `PTL-SLX-TQX-26-002`: clicked `Save · Order only` → captured the full lifecycle (`btn:"✓ Saved"`, `toast:"✓ Saved to this order"`, `badge:"✓ Saved to this order · 02:09 PM"`), badge **persisted** at +4.3 s after button reverted; screenshot confirms green button + green pill + green toast. tsc clean (no new errors), regression 23/23.

## G. Factory Task List PDF — RESTORED + root cause fixed ✅ (clean, lot: Task Lists / core)

**It was never removed.** `ExportPdfButton` + `components/FactoryPDF.tsx` exist and the page renders the Export PDF + Excel buttons — but **gated to status `validated`/`production_ready` + technical role** (TLM/Operations/Admin), as a small top-right header button. So it's invisible before validation / to non-technical roles → "disappeared" = discoverability, not deletion.

**Already on-brand.** `FactoryPDF` already uses the shared `components/pdf/theme` (same `BrandHeader`, `DocTitle`, `SectionHeader`, palette, fonts, 1.2 cm grid as the Invoice/Quotation PDFs). No redesign needed — it's already in the same design family. Verified visually (both pages render branded; see below).

### ROOT CAUSE (definitively diagnosed, not guessed)
The browser threw **"Could not resolve font for Armin Grotesk, fontWeight 200"** and aborted the whole PDF. Earlier hypotheses (unparseable `UltraLight.otf`, the Akzidenz byte-dup, a `@react-pdf` version skew `font@2.5.2` vs a nested `4.0.8`, dev-server HMR, stale `.next`) were **all red herrings** — ruled out by instrumenting the live font store in the browser:
- Registration **succeeds**: at render time the store holds `{Armin Grotesk:[200,400,600,900], Akzidenz Extended:[300]}` and `getFont({weight:200})` returns the right face.
- The throw comes from **one specific call**: `getFont(fontFamily:"Armin Grotesk", fontWeight:200, fontStyle:"italic")`. `@react-pdf/font` resolves **strictly by `fontStyle` with NO italic→normal fallback** — and **no italic face was ever registered**, so the italic lookup hits an empty source list and throws. `FactoryPDF.tsx:226,233` use `fontStyle:"italic"` (warning text + factory-mapping hints), so every Factory PDF crashed. (Node `render` never hit it because Node was never the failing path.)

### THE FIX (`lib/pdfFonts.ts`)
1. **Register italic variants** (the actual fix): `{ ArminGrotesk-Italic.otf @ 400 italic }` + `{ ArminGrotesk-BlackItalic.otf @ 900 italic }`. Italic weights nearest-match (so weight-200 italic → regular italic). The real italic files existed in `public/fonts/` but with **spaces** in their names ("Armin Grotesk Italic.otf") — copied to no-space names (`ArminGrotesk-Italic.otf`, `ArminGrotesk-BlackItalic.otf`) to keep URLs robust, consistent with the other faces.
2. **Cleaner, unique-file weight mapping** (defensive, avoids the mislabeled/dup files): each `(family,weight)` now uses a **unique** parseable file — `200→Thin`, `400→Regular`, `600→SemiBold`, `900→Black`; weight 100 (unused) dropped; the "Akzidenz Extended" title (whose file is the byte-dup of UltraLight) points to the distinct `Armin_Grotesk_Normal.otf`. `UltraLight.otf` is excluded entirely.

`ExportPdfButton.tsx`: kept the **F3-safe** dynamic import of `@react-pdf/renderer` + `FactoryPDF` inside the click handler + spinner→"✓ Downloaded" feedback + "📄 Factory PDF" label. (All temporary diagnostics removed.)

### VERIFIED (real login, real data, dev server restarted)
TLM `testlm@solux-light.com` → validated task list `PTL-SLX-TQX-26-002` → click 📄 Factory PDF → **88 KB, 2-page PDF downloads, no error**. Rendered both pages (Chrome inline viewer):
- Page 1: SOLUX brand header, "FACTORY TASK LIST PTL-SLX-TQX-26-002 · INTERNAL · NOT FOR CUSTOMER", metadata grid (client / country / order ref / created / status VALIDATED / shipping / created-by / reviewed-by), ORDER SUMMARY table, category cards (CCT, OPTIC) with **italic** FINAL FACTORY INSTRUCTION + NOTES.
- Page 2: Battery / Controller / SOLAR PANEL / Spigot cards, then the **manual Pole item** with full SPECIFICATIONS (height 10 m, arm 1.5 m, hot-dip, thickness 4 mm, wind load 150 km/h, spigot Ø 76 mm) flagged "Manual item — no catalog configuration", + "PAGE 2 OF 2" footer.

### Bonus: also fixes Quotation & Invoice PDFs
They share `lib/pdfFonts.ts` and use a subset of the now-registered faces (body 200/400/600 + title 300, no italic), so the same fix unblocks them. Verdict on these 4 PDF files/assets: **✅ clean / isolable** (see verdict table).

### Owner action (still recommended, not blocking)
`public/fonts/AkzidenzGrotesk-LightExtended.otf` is a byte-dup of `ArminGrotesk-UltraLight.otf` (mislabeled). Drop the **real** Akzidenz-Grotesk BQ Light Extended (+ a valid UltraLight) and the `⚠`-commented lines in `pdfFonts.ts` show exactly what to restore (`200→UltraLight`, title→Akzidenz).

## E. Sprint-1 — Task List section nav (S1-6) (lot: Task Lists / core) ⛔ WIP-blocked
- `task-lists/[id]/page.tsx`: added a **section quick-nav** (jump links: Sales request · Product · Production · Risks · Logistics · Activity) above the content, plus anchor `id`s on each section `<h2>` (`tl-request` / `tl-product` / `tl-production` / `tl-risks` / `tl-logistics` / `tl-activity`) with `scrollMarginTop`. **Additive only** — no render-logic or role-gating change (chose this over a risky full tab-rewrite). Poles are manual line-items inside Product config, so there is no separate "Pole" section to anchor. Non-sticky (avoids overlap with the app header). Verified via real TLM login: nav present, all 6 anchors resolve, page renders intact. The page was already WIP-laden (+102/−8) → now +130/−13.
