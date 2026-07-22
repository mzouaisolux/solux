# Engineering Handover — Task-List Workflow, Terminology & Lighting Architecture
**Session date:** 2026-07-21 → 2026-07-22
**Repo:** `~/dev/facturation` (canonical git repo — **not** the iCloud copy)
**Migrations delivered:** m176 → m181 (then m182 → m183, see below)

---

## ⚡ STATUS — updated end of 2026-07-22, read this first

Everything this document lists as "pending" in its original form **has since been
done**. Current reality:

| | |
|---|---|
| **Branch** | `main` @ `eeeaf97` — the feature branch was fast-forward-merged and pushed. `packing-module/phase1` still exists on origin, one commit behind |
| **Cloud migrations** | **ALL applied** — 173 → 183, `db:migrate` reports **0 pending** |
| **Vercel Production** | ✅ **Ready** on `eeeaf97`, live at `solux-hub-seven.vercel.app` |
| **Freeze (m179)** | now DB-enforced in production, and **hardened by m182 + m183** |

A QA campaign ran after this handover was written and found real defects, all
since fixed. Read **`docs/QA-CAMPAIGN-2026-07-22.md`** alongside this file — it
supersedes §8 (remaining work) and parts of §9 (known issues).

What that campaign changed, in one line each:
- **m182** — closed 3 ways the Final Validation freeze could be bypassed (delete the task list, sneak a content change alongside a status change, rewrite a revision snapshot).
- **m183** — froze the attachments captured in a validated revision snapshot.
- **Per-line lighting was broken in production** (`line-lighting.ts` selected `current_rev` unguarded) — fixed, and m179 landing fixed the root cause too.
- **Factory export dropped the whole configuration of SR-derived lines** (`exportData.ts` never selected the line's own `category_id`) — fixed.
- **D1 / D2 / P1-2 / P1-3** — silent data loss in the line editor, a bypassed confirm guard, a disabled SR backfill, and optional lines painted as errors — all fixed.

⚠️ Sections 1 → 7 (architecture, root causes, design decisions) remain accurate
and are still the best introduction to this feature set. Sections 8 → 12 are
annotated below where they went stale.

---

## 1. Project overview

**Project:** SOLUX quotation / production tool (`solux-quotation-tool`) — a Next.js 14 (App Router) + Supabase application covering the full commercial-to-factory lifecycle:

```
Client → Service Request (SR) → Pricing → Quotation → Proforma
      → Production Task List → Production Order → Shipping
```

**Stack:** Next.js 14.2.35 (App Router, server actions), Supabase (Postgres + RLS + Storage), TypeScript strict, `@react-pdf/renderer` (generated PDFs), `pdf-lib` (PDF merge), `unpdf` (server PDF text), `pdfjs-dist` (browser thumbnails), Anthropic SDK (document extraction). Tests: `node --test` on pure modules only (no DB).

**Main objectives of this session** (all owner-driven, delivered in order):
1. Stop tracking a build artifact polluting every diff.
2. Fix AI extraction of the solar-panel tilt angle (audit → root cause → fix).
3. Centralize fixed translations (EN/中文/FR) under an admin, replacing scattered hardcoded vocabulary.
4. Unblock the **broken production build** (Vercel red).
5. Add a real **Pre-Validation → Final Validation** workflow with freeze + controlled revisions.
6. Refactor Lighting Setup from **one-per-order** to **per-product-line**, with a configurable rule engine.
7. Give Service Requests the **complete cost configuration** (product options + pole finish).

---

## 2. Current architecture

### 2.1 Task-list workflow state machine (unchanged DB values, new business meaning)

```
draft → under_validation ⇄ needs_revision → validated → production_ready
                                                      ↘ cancelled
```

**Key decision (owner, 2026-07-21):** the requested three stages already existed. Rather than migrate enum values (which would ripple through RLS, queues, notifications, exports, e2e), the **DB values are unchanged** and only the *business identity* evolved:

| DB value | Renders as | Meaning |
|---|---|---|
| `under_validation` | **Pre-Validation** | Collaborative phase: TLM ⇄ factory ⇄ engineering ⇄ study lab ⇄ sales |
| `validated` | **Final Validation** | Official approval — **immutable** (m179 hard freeze) |

Labels live in `lib/types.ts` → `TASK_LIST_STATUS_LABEL`.

### 2.2 The release gate — one source of truth

`lib/task-list-mapping-status.ts` → `evaluateRelease()` is the **only** authority on "can this task list be released?". It is called server-side by `validateTaskList` and `markProductionReady`, and the Pre-Validation board renders **exactly the same signals** (never a second source of truth).

Blocking reasons, in priority order:
1. status not allowed
2. `lineCount === 0`
3. **m178** open blocking action items
4. open revision request
5. missing factory mappings
6. **m176** tilt conflict pending
7. **m159** pole-drawing checkpoint pending
8. **m180** required programming missing/unreviewed

### 2.3 Final Validation freeze (m179) — enforced at the DATABASE

Three Postgres triggers make `validated` / `production_ready` task lists immutable:

| Trigger | Table | Effect |
|---|---|---|
| `tl_freeze_guard` | `production_task_lists` | Only workflow columns (`status`, stamps, `current_rev`, archive) may change |
| `tl_lines_freeze_guard` | `production_task_list_lines` | No insert/update/delete |
| `lighting_freeze_guard` | `product_lighting_setups` | Locked while any task list of the command is frozen |

**Proven with raw SQL** — a direct `UPDATE` is rejected with *"Final Validation freeze: this task list (Rev B) is immutable"*. App-level `assertNotFrozen()` exists too, for friendlier errors, but the DB is the guarantee.

### 2.4 Revision lineage (m179)

`task_list_revisions` stores an immutable **snapshot** (task row + lines + lighting setup + attachment metadata, including every AI extraction and manual correction) per revision:

```
Rev A validated → [controlled revision, reason required] → Rev B in_progress
   → full Pre-Validation cycle → Rev B validated, Rev A superseded (never deleted)
```

`production_task_lists.current_rev` is the permanent version identifier. `openControlledRevision()` is the **only** exit from a frozen state — `requestRevision` / `requestRevisionWithReason` were deliberately restricted to `under_validation` to close the uncontrolled escape.

**Important architectural consequence:** because lines are inside the snapshot and under the freeze trigger, **anything stored on a line automatically inherits revision history, immutability and diffing.** This is why m180 put per-line lighting on the line.

### 2.5 Terminology (m177)

`lib/terminology.ts` holds a 130-term catalog (`TERM_DEFAULTS`) that is **both** the built-in fallback **and** the m177 seed. The `terminology` table overrides it. Resolution order:

```
validated DB row → built-in default → English → the key itself
```

A `draft` row is **never rendered** (falls back to English) — half-finished Chinese must not reach a factory. Unknown status is treated as unvalidated (fail-safe).

### 2.6 Per-line lighting (m180)

```
product_lighting_setups (per COMMAND)   ← the STUDY anchor: documents + AI extraction
        │  automatic mode populates from here
        ▼
production_task_list_lines.lighting     ← per LINE: the actual factory programming
```

Each line's blob carries **FINAL values** (what the factory programs) beside the study's **RECOMMENDED values** (preserved verbatim). Automatic mode is **never read-only** — the TLM edits freely; an edit marks `review: "adjusted"` and the recommendation stays visible.

### 2.7 Programming applicability rules (m180)

`lighting_programming_rules` + `lib/lighting/programming-rules.ts` decide per line: **required / optional / not_applicable**. Matchers (ANDed when populated): product family, product, SKU glob, controller text, config predicates. Precedence: `priority` → specificity → strictness.

**Default when no rule matches: `optional`** (constant `DEFAULT_OUTCOME`). This was my documented decision after the owner dismissed the question — chosen so nothing regresses or blocks on day one.

### 2.8 Key design decisions (and why)

| Decision | Rationale |
|---|---|
| Keep enum values, relabel | Avoids rippling through RLS/queues/notifications/exports/e2e for zero functional gain |
| Freeze via DB triggers, not just app code | "Validated information must never be silently overwritten" must hold against raw SQL and future code paths |
| Per-line lighting on the LINE (not a new table) | Inherits m179 snapshot + freeze + diff for free |
| Departments as metadata, not roles | Factory/study lab have no logins; TLM is their proxy. Real logins can come later without rework |
| Source-priority ranking in code, not the model | Deterministic and testable; the model only finds and classifies candidates |
| Terminology catalog = fallback AND seed | The two can never diverge |
| pdf.js worker as static asset | pdf.js's own documented deployment model — not a webpack hack |

---

## 3. Work completed during this session

### 3.1 Git hygiene
`tsconfig.tsbuildinfo` untracked; `.gitignore` gained `*.tsbuildinfo` (glob chosen over the literal path to also catch iCloud conflict copies, matching the existing `.next*` convention).

### 3.2 Tilt AI extraction — audit + fix (m176)

**The reported problem:** "the AI doesn't extract the tilt angle."
**The actual finding:** it extracted it correctly and then **silently discarded it**. Chain:
1. SR wizard makes tilt mandatory
2. Task-list creation seeds tilt from the SR
3. → the column is never NULL
4. The m159 auto-fill only wrote `where solar_panel_tilt_angle is null`
5. → the guard never matched; the UI whispered *"the task list already has a value, so it was kept"*

**Delivered:**
- **Conflict flagging** (owner decision: hard flag, never silent overwrite). Disagreement → `resolution: "pending"`, production untouched, drawing checkpoint + release blocked until a human clicks Accept/Keep.
- **Full provenance** — value, unit, source document, page, **verbatim source sentence**, confidence, model, extraction date, ambiguity, all candidates, resolution + who/when, `manually_modified_after`.
- **`tilt_source_page` made possible.** It was structurally unanswerable: `pdf-text.ts` merged pages and stripped form-feeds, so the model was asked to cite a page from input with no page markers. Added an **opt-in `pageMarkers` mode** (invoice-import path untouched).
- **Vocabulary expanded**: Mounting/Installation/Fixed Tilt, Panel Inclination, Array/Module Tilt, the French set, and Chinese (光伏板倾角 / 太阳能板倾角 / 组件倾角 / 安装角度), plus explicit exclusions (latitude, azimuth, beam angle, roof pitch, graph points, rejected scenarios).
- **Source priority moved out of the model** into deterministic code.

**Verified against 3 real Energy Studies** (from `~/Downloads`):

| Study | Tilt | Source sentence | Page | Confidence |
|---|---|---|---|---|
| Parakou SSLXPRO40 | 15° | `INCLINAISON PANNEAU SOLAIRE 15` | 6 | 0.97 |
| DOKUY | 15° | `ANGLE D'INCLINAISON: 15 °` | 4 | 0.97 |
| Energy Study 45W RV3 | **30°** | `INCLINAISON PANNEAU SOLAIRE 30` | 6 | 0.97 |

(The third returning 30° proves real reading, not pattern-defaulting.)

**Second bug found by live testing:** the "AI Extracted Parameters" panel listed Power/Hours/Program/Presence but **never tilt** — so a study that plainly stated one looked like the AI had missed it. Fixed (`c63630e`).

### 3.3 Centralized terminology (m177)

**Audit finding:** nothing was machine-translated (the premise was inverted). But 36 terms were centralized while **69 were hardcoded inline** in the dossier PDF — and drift had already happened **on the English side**:

- `数量` → "Qty" ×3 **and** "Quantity" ×1
- `备注` → "Note" ×2 **and** "Notes" ×2
- `运输方式` → "Shipping" **and** "Shipping method"

**Delivered:** 130-term catalog with stable keys, `terminology` table + admin (search, category filter, needs-validation filter, per-term audit), the fallback chain, and `terminology.manage` capability (super_admin + admin + TLM).

> ⚠️ **The dossier-PDF migration is NOT on `packing-module/phase1`.** See §9.1.

### 3.4 Production build unblocked (root-caused, not patched)

`npm run build` was **red before this session started** (proven by building `2891ec2` in a throwaway worktree — byte-identical failure). Three stacked failures:

1. **pdf.js worker** (`5ff7f8c`, `49c4407`) — `DocPreview.tsx` used `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`, which makes webpack emit the worker as a raw asset; Next 14's minifier then parses emitted `.mjs` **in script mode**, where the v6 ESM worker's syntax is illegal:
   ```
   static/media/pdf.worker.min.cd6fc86d.mjs from Terser
     x 'import.meta' cannot be used outside of module code.
   ```
   Production-only by construction (dev never minifies). **The legacy build is equally ESM** — downgrading fixes nothing (verified). Fixed by serving the worker as a static asset, refreshed by `scripts/copy-pdf-worker.mjs` on postinstall/predev/prebuild, gitignored.
   *Alternative evaluated and rejected:* `new Worker(new URL(...), {type:"module"})` + `workerPort` **does build** (verified in a scratch worktree) but funnels parallel renders through one shared worker.
2. **e2e type error** (`c2bbabd`) — cherry-picked from the background task that had already fixed it.
3. **Scratch files gating the build** (`3898e41`) — 12 errors across 10 `e2e/audit/*.tmp.ts`; `.gitignore` already declares that pattern disposable. Excluded from tsconfig.

**Also fixed:** `middleware.ts` excluded `js` but not `mjs` — the worker was **307-redirected to `/login`** in production. `pdfjs-dist` pinned to exact `6.1.200`.

### 3.5 Pre-Validation board + action items (m178)

Dashboard on every task list in the collaborative phase: **blocking errors** (the release gate, itemised with jump links), **pending issues** (action items with department/assignee/due date/blocking flag), **AI review** list, **warnings** (risk flags).

### 3.6 Final Validation freeze + revisions (m179)

See §2.3–2.4. **Behaviour changes (deliberate):** technical roles can no longer quick-edit a validated list; the reasoned bounce-to-sales no longer works from frozen states.

### 3.7 AI review states (phase 2)

`confirmed` (explicit button) / `corrected` (**detected server-side at save**, never self-reported) / unreviewed. Stored in the existing `ai_extracted.review` map — **no migration**.

**Bug caught by live testing that unit tests missed:** `normalizeLightingProgram` rebuilds period objects with a different key order than the stored AI blob, so naive `JSON.stringify` equality stamped `corrected` with identical values. Fixed with canonical fixed-key projection + regression test.

### 3.8 Per-line lighting + rules (m180)

See §2.6–2.7. Includes explicit **"Apply to all eligible lines"** (one-time copy, never a link), **newer-study detection** with explicit import, and mode switching that archives the outgoing state.

### 3.9 SR complete cost configuration (m181)

**Audit finding:** SRs captured only 5 fixed product fields while the quotation runs a full per-category config engine; and pole finish vocabulary (C3/C4/C5, galvanization, coating, colour) **existed nowhere in the system**.

**Delivered:** `config_values` (same `config_fields` vocabulary as the quotation, scoped to the selected family) + `pole_spec` (surface treatment, finish, colour). On quotation generation the SR values **merge over** the legacy fallback pairs onto the product line, so factory mappings resolve downstream. The pole finish one-liner rides the pole line **name** (m135 convention) so it survives to the factory export.

---

## 4. Files modified

### 4.1 New files

| File | Purpose |
|---|---|
| `lib/tilt-provenance.ts` | m176 — provenance shape, source-priority ranking, conflict resolution |
| `lib/terminology.ts` | m177 — 130-term catalog (fallback + seed), resolver, `makeTerms()` |
| `lib/terminology-server.ts` / `-client.ts` | Loaders (server components / browser PDF generation) |
| `lib/task-list-action-items.ts` | m178 — departments, statuses, normalizer, gate helpers |
| `lib/task-list-revisions.ts` | m179 — snapshot shape, rev labels (A…Z, AA), **field diff** |
| `lib/task-list-revisions-server.ts` | m179 — snapshot builder, `recordValidationRevision`, `openRevisionRecord` |
| `lib/lighting/ai-review.ts` | Phase 2 — confirmed/corrected detection |
| `lib/lighting/line-setup.ts` | m180 — per-line model, validation, status, transitions |
| `lib/lighting/programming-rules.ts` / `-server.ts` | m180 — rule resolver + loaders |
| `lib/pole-spec.ts` | m181 — pole finish vocabulary + formatter |
| `scripts/copy-pdf-worker.mjs` | Copies pdf.js worker to `public/` |
| `app/(app)/admin/terminology/{page,actions,TerminologyEditor}` | Terminology admin |
| `app/(app)/admin/lighting-rules/{page,actions}` | Programming-rules admin |
| `app/(app)/task-lists/[id]/action-items.ts` | m178 server actions |
| `app/(app)/task-lists/[id]/line-lighting.ts` | m180 server actions |
| `components/PreValidationBoard.tsx` | m178 dashboard |
| `components/RevisionsPanel.tsx` | m179 freeze banner + lineage + diff |
| `components/LineLightingPanel.tsx` | m180 per-line programming UI |
| `supabase/migrations/176…181*.sql` | See §5 |
| `tests/{tilt-provenance,terminology,task-list-action-items,task-list-revisions,lighting-ai-review,line-lighting,pole-spec}.test.ts` | 60+ new tests |

### 4.2 Modified files

| File | Why |
|---|---|
| `.gitignore` | `*.tsbuildinfo`, `/public/pdf.worker.min.mjs` |
| `package.json` / `package-lock.json` | pdfjs pinned; postinstall/predev/prebuild hooks |
| `tsconfig.json` | Exclude `**/*.tmp.ts`, `**/*.tmp.mjs` |
| `middleware.ts` | Add `mjs` to static-asset exclusions (worker was 307ing to /login) |
| `lib/types.ts` | Status labels → Pre-Validation / Final Validation |
| `lib/capabilities.ts` | `terminology.manage`, `lighting_rules.manage` + module labels |
| `lib/navigation.ts` | Admin → Terminology, Admin → Programming rules |
| `lib/task-list-mapping-status.ts` | `evaluateRelease` gained 2 blocking inputs |
| `lib/import/pdf-text.ts` | Opt-in `pageMarkers` mode |
| `lib/lighting/extract-energy-study.ts` | Candidate-based tilt extraction, multilingual prompt |
| `lib/lighting/types.ts` | Extraction + provenance type extensions |
| `lib/production-dossier.ts` | Banner on `DOSSIER_SECTIONS`. ⚠️ **Correction (QA 2026-07-22):** an earlier version of this row claimed the enum title dicts were "removed (moved to terminology)". That is **false on this branch** — `PACKAGING_VERSION_TITLES` / `MANUAL_BRAND_TITLES` / `MANUAL_LANGUAGE_TITLES` are still exported and consumed (6 references). §8 P2 is the accurate account. `lib/terminology-server.ts` / `-client.ts` are imported by nothing: m177 is admin-only today. |
| `components/ProductionDossierPDF.tsx` | Per-line programming block |
| `components/documents/IndustrialFileEditor.tsx` | Tilt conflict banner + provenance evidence |
| `components/lighting/ProductLightingSetupForm.tsx` | Tilt row in AI panel; conflict-aware messaging |
| `components/affairs/DocPreview.tsx` | Static worker URL |
| `app/(app)/lighting/actions.ts` | Conflict recording, AI confirm, freeze awareness |
| `app/(app)/task-lists/[id]/actions.ts` | Freeze asserts, snapshots, `openControlledRevision`, gates |
| `app/(app)/task-lists/[id]/page.tsx` | Board + revisions panel + per-line panel wiring |
| `app/(app)/task-lists/[id]/exportData.ts` | Per-line lighting + requirement |
| `app/(app)/task-lists/[id]/dossier.ts` | Terminology dictionary into the PDF |
| `app/(app)/projects/{actions,new/NewProjectForm,new/page,[id]/page}.tsx` | m181 SR cost configuration |
| `e2e/audit/aospro-recon.ts` | Type fix (cherry-picked) |

---

## 5. Database

| Migration | Adds | Cloud status |
|---|---|---|
| `176_tilt_ai_provenance.sql` | `production_task_lists.tilt_ai_provenance` (jsonb) | ✅ **applied** |
| `177_terminology.sql` | `terminology` table (130-row seed) + `terminology.manage` capability | ✅ **applied** |
| `178_task_list_action_items.sql` | `task_list_action_items` table + index + RLS | ✅ **applied** |
| `179_task_list_revisions_freeze.sql` | `task_list_revisions` table, `production_task_lists.current_rev`, **3 freeze triggers** | ✅ **applied** |
| `180_line_lighting_and_rules.sql` | `production_task_list_lines.lighting` (jsonb), `lighting_programming_rules` table, `lighting_rules.manage` | ✅ **applied** |
| `181_sr_cost_configuration.sql` | `project_requests.config_values`, `project_requests.pole_spec` | ✅ **applied** |
| `182_freeze_hardening.sql` | DELETE guard on task lists, removes the status-change bypass, `tl_revision_freeze_guard` | ✅ **applied** |
| `183_attachment_freeze.sql` | `attachment_freeze_guard` — freezes attachments named in a finalised revision snapshot | ✅ **applied** |

> ✅ **All migrations are applied in cloud** (verified 2026-07-22: REST probes on
> every object + `npm run db:migrate` reporting **0 pending**, 180 recorded).
> The packing migrations 173/174 and the bank-charges 175 were applied too, so
> the packing module is now live — still gated `superAdminOnly`.
>
> The original text of this section warned that m178/m179 were missing and that
> the freeze was therefore not DB-enforced. **That is no longer true.** The
> freeze is enforced and hardened; see `docs/QA-CAMPAIGN-2026-07-22.md` §3 for
> the four bypasses that were found and closed, with their SQL proofs.
>
> A read-only verification script lives at `supabase/verify_freeze_prod.sql` —
> paste it in the Supabase SQL editor to re-check the freeze at any time. It
> wraps its write tests in `BEGIN … ROLLBACK`, so it mutates nothing.

**Local (`127.0.0.1:54322`, Docker Supabase): all applied as well.**

### Two databases — the trap that cost time

```
.env.development.local  → http://127.0.0.1:54321   ← LOCAL Docker, what `next dev` uses
.env.local              → https://brqhcqaagzfiozzamzon.supabase.co  ← CLOUD
```

Next.js gives `.env.development.local` **higher priority in dev**. Migrations applied in the Supabase SQL editor land in **cloud**; the local dev app does not see them. `npm run db:migrate` reads `.env.local` (cloud) — so **local drifts silently**. This caused a full misdiagnosis session (PGRST205 while the migration "was applied").

---

## 6. Backend

### 6.1 New capabilities

| Key | Granted to | Gates |
|---|---|---|
| `terminology.manage` | super_admin, admin, task_list_manager | Admin → Terminology |
| `lighting_rules.manage` | super_admin, admin, task_list_manager | Admin → Programming rules |

`npm run check:capabilities` passes (52 catalogued, 52 used, 0 orphans).

### 6.2 New server actions

**`app/(app)/task-lists/[id]/actions.ts`**
`openControlledRevision(formData)` — the only exit from a frozen task list. Requires a ≥5-char reason; captures a baseline snapshot for pre-m179 lists; creates Rev N as `in_progress`; transitions back to Pre-Validation.

**`app/(app)/task-lists/[id]/action-items.ts`** — `createTaskListActionItem`, `setTaskListActionItemStatus`, `deleteTaskListActionItem`

**`app/(app)/task-lists/[id]/line-lighting.ts`** — `saveLineLighting`, `confirmLineLighting`, `autoPopulateLineLighting`, `setLineLightingMode` (manual→automatic requires `confirm=1`), `applyLightingToEligibleLines`

**`app/(app)/lighting/actions.ts`** — `confirmLightingAiField`; `extractEnergyStudyAction` now returns a `TiltOutcome` discriminated union; `aiFindTiltAction` persists provenance

**Admin** — `saveTerm`/`deleteTerm`, `saveProgrammingRule`/`deleteProgrammingRule`

### 6.3 Business-logic invariants worth preserving

- **Never write into a frozen task list.** `assertNotFrozen()` at every edit gate; DB triggers are the backstop.
- **Every mode switch / study import archives the outgoing state** before mutating.
- **Apply-to-all is a copy** — `JSON.parse(JSON.stringify(...))`, `source.kind = "copy"`, never a link.
- **`evaluateRelease` is the only release authority** — the board renders it, never re-implements it.
- **Draft terminology is never rendered** — falls back to English.
- **Defensive migration pattern:** every new read/write catches the missing-column/table error and degrades. Follow this for anything new.

---

## 7. Frontend

### 7.1 New components

- **`PreValidationBoard`** — blocking errors, pending issues (inline add form), AI review list with ack chips, warnings
- **`RevisionsPanel`** — freeze banner, "Open controlled revision…" with mandatory reason, lineage list, expandable field diff
- **`LineLightingPanel`** — per-line rows with status chips (`✅ Complete` / `⚠ Needs review` / `❌ Missing programming` / `N/A`), inline editor (mode selector, recommended-vs-final, stage editor with motion-sensor boost, apply-to-all, newer-study import)

### 7.2 Navigation additions

```
Admin → Terminology          (/admin/terminology)       [terminology.manage]
Admin → Programming rules    (/admin/lighting-rules)    [lighting_rules.manage]
```

### 7.3 SR wizard (`/projects/new`)

New **"Product options"** section (per-category, rendered only when the selected family has fields) and pole finish fields (surface treatment / galvanization / colour) inside the pole step. Both round-trip in edit mode via hidden JSON inputs.

---

## 8. Remaining work (priority order)

> **This section is superseded.** P0, P1 and P3 are DONE (migrations applied,
> branch merged into `main` and pushed, frozen task lists no longer render any
> Save / Delete / Add control). The live backlog is in
> **`docs/QA-CAMPAIGN-2026-07-22.md` §4** — that campaign also found ~30 places
> where the original spec was never built, which matter more than what is left
> below. P2, P4, P5, P6 remain open and are restated accurately here.

### ~~P0 — Apply missing cloud migrations~~ ✅ DONE
All migrations 173 → 183 are applied in cloud; `db:migrate` reports 0 pending.

### ~~P1 — Push the branch~~ ✅ DONE
Fast-forward-merged into `main` (`a0d7d08 → eeeaf97`, 34 commits) and pushed.
Vercel Production is Ready on `eeeaf97`.

### P2 — Land the dossier-PDF terminology migration ⬅️ **still the largest open item**
The full m177 (routing the ~95 dossier strings through the dictionary) is
archived at the annotated tag **`archive/m177-dossier-terminology`** (`5f0be63`,
pushed). It was never landed, because `1d7fc33` rewrote that component
(857 insertions / 1353 deletions). It must be **redone against `main`'s compacted
`LineBuild` structure** — measured 2026-07-22: **352 hardcoded CJK characters in
`components/ProductionDossierPDF.tsx` + 177 in `lib/production-dossier.ts`**.
`main`'s PDF still imports `PACKAGING_VERSION_TITLES` / `MANUAL_BRAND_TITLES` /
`MANUAL_LANGUAGE_TITLES` (6 references), so removing them before doing the
migration breaks the build.

⚠️ Related finding: `lib/terminology-server.ts` and `lib/terminology-client.ts`
are **imported by nothing** — m177 is admin-only today. Nothing renders from the
terminology table yet. Do not blind-merge the archive tag; use it as a reference
for WHICH strings to migrate.

### ~~P3 — Hide "Bounce back to sales" on frozen lists~~ ✅ DONE
It was wider than described: the whole editing surface stayed live on frozen
lists (60 active controls for a TLM). Now none. The two buttons that always
failed server-side ("Request revision" on validated, "Bounce back to sales" on
production_ready) were removed in favour of the controlled-revision path.

### P4 — DIALux per-zone recommendations in automatic mode
`autoPopulateLineLighting` only reads the Energy Study extraction. DIALux extraction produces per-zone configurations (mounting height, CCT, optics) that could map to lines.

### P5 — Seed real programming rules
Only one demo rule exists locally. Admins should classify the real catalog (luminaire families → required; poles/accessories → not applicable).

### P6 — Guard against `npm run build` while `next dev` runs
They share `.next/`; running a build corrupts the dev server ("missing required error components"). Happened twice this session.

---

## 9. Known issues, technical debt & assumptions

### 9.1 Dossier PDF terminology (see P2)
Two divergent versions exist. Do not blind-merge the archive. The old worktree
branch was replaced by the annotated tag `archive/m177-dossier-terminology`
(pushed) — a tag rather than a branch, because a pushed branch makes Vercel
build it, and that historical snapshot fails by construction: it predates the
July build fixes (`c2bbabd`, `3898e41`, `5ff7f8c`, `49c4407`). A red Preview on
it means nothing for `main`.

### 9.2 `doc.destroy` is a no-op under pdfjs-dist v6
`DocPreview.renderPdfThumb()` calls `doc.destroy?.()`; `PDFDocumentProxy` has no `destroy()` in v6 (verified: throws when called directly). Per-document workers are never freed — a bounded leak, not a crash. Fix: keep the `loadingTask` and call `loadingTask.destroy()`. A background task chip was spawned for this.

### 9.3 PDF thumbnails never verified in a browser
The build compiles and the worker serves correctly (200, byte-identical), and an end-to-end in-page test rendered a real PDF (worker boot → 10-page parse → JPEG in 369 ms). But **display-intent rendering pauses in hidden tabs** (Chrome rAF throttling — Chrome behaviour, not a defect). Confirm a thumbnail appears in a visible tab.

### 9.4 Local demo data left behind
| Where | What |
|---|---|
| `PTL-SLX-QAC-26-007` | status moved `draft → under_validation`; blocking Factory action item; per-line lighting (automatic, confirmed); AI review states (power confirmed, hours corrected) |
| `PTL-SLX-AES-26-003` | Rev A superseded / **Rev B validated**, tilt 10° → 15° |
| `terminology` | `section.tilt_angle` has a French value added |
| `lighting_programming_rules` | 1 demo rule (AOSPRO+ family → required) |

All local-only. Clean up if it interferes.

### 9.5 Assumptions
- **Default programming outcome = `optional`** (my decision, owner dismissed the question). One constant to change.
- **Explicit "AI Find" button overwrites** (deliberate human click) except when the study is ambiguous. The *automatic* path always flags conflicts.
- **Manual entry is "reviewed by definition"** — `manualSetup` sets `review: confirmed`.
- **Departments are metadata.** Factory/engineering/study-lab have no logins.
- **4 terminology keys added in m180/m181 work are built-in only** — the cloud `terminology` table still has 130 rows; they render from the catalog until added in admin.

### 9.6 Environment gotchas
- `grep` is **ugrep** here and misbehaves with braces/parens — prefer `git grep` or Python.
- `timeout` is not installed.
- A **View-As simulation cookie** silently hid the SR wizard (rendering as TLM). Reset via the header chip.
- Two pre-existing `e2e/audit/*.tmp.ts` type errors are excluded from tsconfig, not fixed.

---

## 10. Deployment status — **updated end of 2026-07-22**

**Local:** ✅ typecheck exit 0 · ✅ **802/802 unit tests** · ✅ **23/23 e2e** (real
logins) · dev server on :3000 is session-tied — start your own, and never run
`npm run build` while it runs (they share `.next/`).

**Git:** on **`main` @ `eeeaf97`**, identical to `origin/main` (0 commits either
way). Working tree clean except untracked `Survey/` (pre-existing, untouched).

The feature branch was **fast-forward-merged**: `a0d7d08 → eeeaf97`, 34 commits,
177 files, +21 497 / −2 399. No merge commit, no conflict.

Remote branches:
```
eeeaf97  main                        ← reference, deployed
5a022b4  packing-module/phase1       ← merged, now 1 commit behind main
362bf32  ux/event-registry-polish    ← old, 0 commits outside main
```
Remote tag:
```
5f0be63  archive/m177-dossier-terminology   ← P2 reference, DO NOT MERGE
```

**PRs:** none — merged directly by fast-forward.

**Vercel:** ✅ **Production Ready on `eeeaf97`**, build 2 min 22 s, live at
`solux-hub-seven.vercel.app`. Observed on the dashboard, not inferred.
⚠️ Red *Preview* deployments exist for old branches — they are expected and
irrelevant: those snapshots predate the July build fixes. **Filter Vercel on
Environment = Production**; everything else is branch noise.

---

## 11. Recommended next task — **updated end of 2026-07-22**

The original recommendation (apply migrations, push, then P2) is done except P2.

**Do P2: the dossier-PDF terminology migration**, against `main`'s current
`LineBuild` structure — ~529 hardcoded CJK characters across
`components/ProductionDossierPDF.tsx` (352) and `lib/production-dossier.ts`
(177), with `archive/m177-dossier-terminology` as the reference for which
strings to route. It is the largest incomplete piece, and finally makes m177
render somewhere other than its admin screen.

Before that, two smaller things worth clearing, both from
`docs/QA-CAMPAIGN-2026-07-22.md`:
- **9.2** `doc.destroy` is a no-op under pdfjs-dist v6 — a bounded worker leak.
- The campaign's §4 list of ~30 spec items that were never built. Several are
  cheap (a real "newer study" notification, a history viewer, per-product
  programming rules in the admin); several are product decisions, not bugs.

---

## 12. First prompt for the next session — **updated end of 2026-07-22**

```
Tu reprends le projet SOLUX ERP (`solux-quotation-tool`) — ERP Next.js 14 +
Supabase : Client → Affaire → Service Request → Devis → Proforma → Task List de
production → Ordre de production → Colisage → Expédition → Facture.

⚠️ REPO CANONIQUE = `~/dev/facturation` (git). Le dossier iCloud est une COPIE
PÉRIMÉE NON-GIT — ne jamais y coder. Le `cwd` du shell y revient après chaque
commande : préfixe toujours par `cd ~/dev/facturation &&`.

AVANT TOUTE MODIFICATION, lis dans cet ordre :
  1. docs/HANDOVER-2026-07-22-taskflow-lighting.md  (architecture, causes racines)
  2. docs/QA-CAMPAIGN-2026-07-22.md                 (défauts trouvés + corrigés,
                                                     et ~30 écarts plan/produit)

ÉTAT VÉRIFIÉ fin 2026-07-22 : branche `main` @ `eeeaf97` = `origin/main`.
Migrations 173→183 TOUTES appliquées en cloud (`db:migrate` : 0 pending).
Vercel Production Ready sur `eeeaf97`. 802/802 tests, 23/23 e2e, typecheck 0.
Le gel Final Validation est enforced en base ET durci (m182/m183).

OBJECTIF : P2 — la migration terminologie du dossier PDF de production.
Router les chaînes codées en dur vers `lib/terminology.ts` : ~352 caractères CJK
dans `components/ProductionDossierPDF.tsx` et ~177 dans `lib/production-dossier.ts`.
Le tag `archive/m177-dossier-terminology` (`5f0be63`) contient la version faite
sur l'ANCIENNE structure du composant — sers-t'en comme référence de CE QU'IL FAUT
migrer, mais NE LE FUSIONNE PAS : `1d7fc33` a réécrit ce composant depuis.
Note : `lib/terminology-server.ts` et `-client.ts` ne sont importés par RIEN
aujourd'hui — m177 ne rend nulle part hors de son écran admin.

RÈGLES (non négociables) :
- Réponds en français.
- Jamais « ça marche » sans preuve (sortie de commande, test, sonde). Sinon dis-le.
- Fini = l'utilisateur le VOIT : page → menu → bouton → résultat.
- Capabilities = source de vérité unique (`lib/capabilities.ts`), jamais le rôle brut.
  Fais tourner `npm run check:capabilities` et `npm run check:schema`.
- Supabase non typé : les fautes de colonne explosent au RUNTIME (42703).
  Toute lecture d'une colonne récente doit être DÉFENSIVE (cf. le bug m180/m179).
- Aucune credential DDL ici : les migrations se collent à la main dans le SQL
  editor Supabase (`brqhcqaagzfiozzamzon`). Ne lance JAMAIS `db:migrate --apply`.
- Jamais `git stash` dans ce repo. Jamais `npm run build` pendant que `next dev`
  tourne (ils partagent `.next/`).
- `grep` est ugrep ici — préfère `git grep` ou Python. `timeout` n'est pas installé.
- Ne touche pas au dossier `Survey/` non suivi.
- HYGIÈNE GIT : en fin de session, audite les branches, pousse tout travail unique
  (ou archive-le en tag annoté), vérifie `main` ↔ `origin/main`, et demande
  confirmation avant toute suppression. Un hook `SessionEnd` le rappelle.

Commence par lire les deux documents, fais un point court de l'état réel que tu
observes (git, tests, migrations), puis enchaîne sur P2.
```
