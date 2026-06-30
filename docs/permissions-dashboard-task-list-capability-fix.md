# permissions-dashboard-task-list-capability-fix

> **NON COMMITÉ — note de réapplication (hors staging).** Documente exactement le fix
> "dashboards respectent la capability, pas le rôle brut" pour le cas Operations × task list.
> Verdict : **Catégorie C / P1**. Backend déjà autoritaire (inchangé). Vérifié : `npm test`
> 247/247, `check:schema` OK, `e2e:regression` 23/23, vrais comptes Operations + TLM.
>
> **Pourquoi une note et pas un `.patch` git** : les 3 fichiers `M` portent du WIP étranger
> (notamment `lib/notifications.ts` = "cloche rebranchée" m136 / runtime Event Registry).
> Un `git diff HEAD` embarquerait ce WIP. Cette note isole UNIQUEMENT les changements du fix,
> réappliquables mécaniquement (find → replace) sur un HEAD propre.

Capabilities concernées : `task_list.validate` (review / Validate / Request-revision /
Mark-ready / Reopen) et `task_list.reject` (boutons Reject).
Helpers : `hasUiCapability` (UI, View-As fidèle) côté pages/composants ; `hasCapability(cap, role)`
côté cloche serveur. Anti-lockout OK : la matrix accorde validate/reject à `task_list_manager`,
`admin`, `super_admin` (donc ils gardent l'accès) ; `operations`/`sales`/`sales_director`/`finance`
= false.

---

## 1) `app/(app)/dashboard/ActionCenter.tsx`  (?? untracked WIP)

**a. Ajouter l'import** après `import { createClient } from "@/lib/supabase/server";` :
```ts
import { hasUiCapability } from "@/lib/permissions";
```

**b. Remplacer** la ligne :
```ts
const isTlm = role === "task_list_manager" || role === "operations" || role === "admin" || superAdmin;
```
**par** :
```ts
// Capability-gated (NOT raw role): "needs your review" is an ACTION queue,
// so only show it to roles that can actually validate. Operations without
// task_list.validate no longer sees a Review CTA it can't use. View-As
// faithful + admin/super_admin keep it (their matrix grants the capability).
const canReviewTaskLists = await hasUiCapability("task_list.validate");
```

**c. Remplacer** `if (isTlm) {` (groupe "TLM / Operations: task lists awaiting validation")
**par** `if (canReviewTaskLists) {` (et adapter le commentaire au-dessus).

> Effet : un rôle sans `task_list.validate` n'a plus ce groupe ; si c'est son seul groupe
> (cas Operations), `ActionCenter` retourne `null` → la section "Needs your action" disparaît.

---

## 2) `lib/notifications.ts`  (M — porte le WIP "cloche rebranchée" m136)

**a. Remplacer l'import** :
```ts
import { isTechnicalRole, type Role } from "@/lib/types";
```
**par** :
```ts
import { type Role } from "@/lib/types";
import { hasCapability } from "@/lib/permissions";
```
(`isTechnicalRole` n'est plus utilisé après le b.)

**b. Dans `buildReviewNotification(role)`, remplacer** :
```ts
if (!isTechnicalRole(role)) return null;
```
**par** :
```ts
// Capability-gated (NOT raw role): only reviewers who can actually validate
// get the "N task lists awaiting your review" bell item.
if (!role || !(await hasCapability("task_list.validate", role))) return null;
```

---

## 3) `app/(app)/task-lists/[id]/page.tsx`  (M — porte le WIP premium UI)

**a. Après** `const canDeleteTaskList = await hasUiCapability("task_list.delete");` **ajouter** :
```ts
const canValidateTaskList = await hasUiCapability("task_list.validate");
const canRejectTaskList = await hasUiCapability("task_list.reject");
```

**b. Dans le rendu `<TaskListWorkflowActions ...>`, ajouter les props** (après `isTechnical={technical}`) :
```tsx
canValidate={canValidateTaskList}
canReject={canRejectTaskList}
```

---

## 4) `components/TaskListWorkflow.tsx`  (M — base WIP, mais l'essentiel du diff = ce fix)

**a. Signature** — ajouter dans la destructuration (après `isTechnical,`) :
```tsx
canValidate = false,
canReject = false,
```
et dans le type (après `isTechnical: boolean;`) :
```tsx
/** Capability task_list.validate (UI only) — Validate / Mark-ready / Request-revision / Reopen. */
canValidate?: boolean;
/** Capability task_list.reject (UI only) — boutons Reject. */
canReject?: boolean;
```

**b. Après la const `dangerClass`, ajouter** :
```tsx
const missingCaps = [
  !canValidate && "task_list.validate",
  !canReject && "task_list.reject",
].filter(Boolean) as string[];
const capNote =
  isTechnical && missingCaps.length > 0 ? (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
      Read-only for your role — missing <b>{missingCaps.join(" + ")}</b>. Ask a
      super-admin to enable it in <code>/permissions/actions</code>.
    </p>
  ) : null;
const validateTitle = canValidate ? undefined : "Requires the task_list.validate capability.";
const rejectTitle = canReject ? undefined : "Requires the task_list.reject capability.";
```

**c. Gater chaque bouton d'action technique** (règle uniforme) :
- boutons **Validate / Request-revision / Mark-production-ready / Reopen / Bounce-back** :
  `disabled={pending}` → `disabled={pending || !canValidate}` + `title={validateTitle ?? <titre existant>}`.
- boutons **Reject** (reject-draft / reject-uv / reject-revision / reject-validated) :
  `disabled={pending}` → `disabled={pending || !canReject}` + `title={rejectTitle}`.
- insérer `{capNote}` dans chaque branche technique (`draft`, `under_validation`,
  `needs_revision`, `validated`, `production_ready`), juste avant/après la rangée de boutons.

> Backend INCHANGÉ : `app/(app)/task-lists/[id]/actions.ts` garde `requireCapability("task_list.validate")`
> sur validate/markReady/requestRevision/reopen/setStatus et `requireCapability("task_list.reject")`
> sur reject. C'est la source de vérité ; l'UI ne fait que ne plus mentir.

---

## Même pattern, NON corrigé (signalé, à ne PAS élargir maintenant)
`ActionCenter.tsx` : `isDir` (project.approve / project.set_pricing) et `isSales`
(quotation.create / project.generate_quotation / launch) sont aussi gatés par **rôle brut**.
Même classe de bug pour Sales Director / Sales si on leur retire ces capabilities. Follow-up séparé.
