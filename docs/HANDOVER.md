# DOSSIER DE PASSATION — App Facturation (ERP/CRM "Solux")
> Rédigé 2026-06-24, fin d'une longue session d'audit + correctifs.
> Lecteur cible : un Claude (ou humain) reprenant le projet **sans connaissance préalable**.
> Convention de fiabilité : **[V]** = Vérifié (observé/testé), **[P]** = Probable (déduit, non testé end-to-end), **[NV]** = Non vérifié.

---

## 0. À LIRE EN PREMIER — faits d'environnement [V]

- **Repo canonique : `~/dev/facturation`** (git-tracké). ⚠️ Il existe une copie iCloud `~/Library/Mobile Documents/.../APP FACTURATION` qui est une **DUPLIQUE PÉRIMÉE non-git** — ne JAMAIS y coder. Le `cwd` du shell se réinitialise vers l'iCloud après chaque commande ; utiliser des chemins absolus / `cd ~/dev/facturation &&`.
- **Serveur dev** : `localhost:3000`, next-server **v14.2.35**, lancé par l'utilisateur depuis `~/dev/facturation`. S'il faut le relancer : `WATCHPACK_POLLING=true npm run dev` (cf. iCloud-eviction). Le hot-reload prend les changements de `~/dev/facturation`.
- **Supabase** : `https://brqhcqaagzfiozzamzon.supabase.co`. `NEXT_PUBLIC_SUPABASE_URL` + `ANON_KEY` dans `.env.local`. **PAS de `SUPABASE_SERVICE_ROLE_KEY`, PAS de `DATABASE_URL`, PAS de CLI supabase** dans l'environnement → impossible d'appliquer du DDL/migrations ou de générer les types ici (l'owner le fait).
- **Comptes de test** (domaine `solux-light.com`, **mot de passe commun `Test12`**, dans `.env.e2e` = `E2E_PASSWORD`) :
  - `testsales@` → `sales` · `testdir@` → `sales_director` · `testlm@` → `task_list_manager` · `testoperation@` → `operations` · `testfinance@` → `finance` · `testadmin@` → `admin` (super_admin=**false**).
  - **`mzouai@solux-light.com`** = le **seul super_admin** (propriétaire). Mot de passe non connu de l'agent.
  - **Aucun compte de test n'est super_admin** → on ne peut pas assigner de rôles / appliquer du DDL via les comptes de test.
  - Les display_names ont été posés : Sam Sales, Dana Director, Tom TaskList, Olivia Ops, Fiona Finance, Adam Admin.
- **git** : branche courante **`freeze/core-metier`**, HEAD **`157e52c`** (commit de figement du cœur), **176 fichiers encore non commités** (la WIP "premium"). `main` est intact (sans la WIP commitée). **Mémoire interne : ne jamais `git stash` ici** (WIP énorme + tsconfig.tsbuildinfo tracké cassent le stash pop).

---

# 1. ÉTAT EXÉCUTIF

**Où en est le projet ?** Un ERP/CRM fonctionnel dont le **cœur métier (devis → won → production → finance) marche de bout en bout**, validé sous **vraies sessions par rôle** (vrais JWT, pas de "View As"). Il est au milieu d'une **grosse refonte UI "premium" non commitée (≈206 fichiers)**. Les 5 bugs majeurs trouvés à l'audit (F1, F2, F3, F4, F6) sont **corrigés et validés en réel**.

**Maturité** : *fonctionnel mais structurellement fragile* — le cœur est stable et testé, mais enchevêtré dans une WIP non commitée + une configuration (rôles/visibilité) qui s'assigne à la main.

**Parties stables [V]** : pipeline commercial→production→finance ; permissions/RLS (refus serveur réels) ; validation/révision Task Lists ; édition Production Orders ; lecture Finance + cost-entry ; audit trail (events).
**Parties risquées** : la WIP "premium" non commitée (#1 risque) ; la couche Permissions (27 fichiers de churn — source de F1/F2) ; CRM/Requests (prospects/tenders — **prototype non testé E2E**) ; le ledger de migrations incomplet ; scalabilité (anti-patterns connus, non traités).

**Peut-on lancer… ?**
- **Pilote fermé (closed pilot, setup assisté)** : **OUI [P]** — le cœur marche ; il faut juste assigner rôles/équipes/grants à la main et accompagner.
- **Production limitée** : **NON [V]** — bloqué par : WIP non structurée/commitée, setup non infaillible, ledger DB non fiable, workflow Director (approbation Service Request) **non vérifié**, F6/UX seulement partiellement durcis.
- **Production complète** : **NON [V]** — en plus du précédent : scalabilité non traitée, WIP à finir, couverture E2E partielle.

**Notes** : Produit **7/10** · Technique **6/10** · UX **7/10** · Robustesse **7/10** · Maintenabilité **4/10** (le blob WIP non commité est le frein).
**Note globale : ~76/100.**

---

# 2. ARCHITECTURE MÉTIER

> Hiérarchie centrale : **Client → Affaire (project/affair) → Documents & Task Lists & Service Requests**. "Affaire" regroupe tout le travail d'une opportunité. [V]

## CRM
- **Clients** (`clients`) : entreprise. Champs clés : `company_name`, `client_code` (**exactement 3 lettres**, ex. `ZEA` — apparaît dans tous les numéros de doc `SLX-<CODE>-YY-NNN`), `created_by` (= propriétaire, m058), `sales_owner_id` (m066, propriétaire assigné). Création via modale `NewClientPanel` ("+ New client" ou `?new=1`). [V]
- **Contacts** (`contacts`, m101) : personnes rattachées à un client. [V]
- **Affaires** (`affairs`) : "project" au sens métier. Une affaire a un `name`, `status` (lead, …), `client_id`, `owner_id`/`created_by`. Créées via "+ New Project" (inline depuis le quote builder → `quickCreateAffair`) ou la page projet. `affair_id` est **obligatoire** sur un devis (règle métier m124). [V]
- **Projets** : synonyme d'Affaires dans l'UI ; à ne pas confondre avec **Service Requests** (voir plus bas).

## Documents (`documents`)
- **Quotation** : document de négociation. Cycle : `draft → sent → won/lost/cancelled`. [V]
- **Proforma** : document commercial **confirmé** = la "commande". Créé **depuis une quotation WON** via "🚀 Launch Production" (`launchProduction`), jamais directement. [V]
- **Commercial Invoice (CI)** : document d'expédition (m115). [P]
- **Numérotation** : `SLX-<CLIENTCODE>-YY-NNN` ; les task lists héritent : `PTL-SLX-…`, les orders `PO-SLX-…`. ⚠️ `documents` n'a **pas** de colonne `total` (utiliser `total_price`) ni `created_at` (utiliser `date`) — les fautes de colonne échouent au **runtime** (42703), pas à la compilation (client Supabase non typé). [V]

## Service Requests (`project_requests`, routes `/projects`) — **distinct des Affaires** [P sur le détail]
Objectif métier : gérer les opportunités **custom / appel d'offres (tender)** qui nécessitent un chiffrage avant de produire un devis. Le label UI est "Service Request" mais la table reste `project_requests` et les routes `/projects` (renommage cosmétique uniquement). Rôle dédié `sales_director` + capacités `project.*`.
**Workflow observé via les events** [P] : Sales crée la requête → **Director approuve** → Operations saisit les **inputs de coût** (factory cost, freight cost, packing list) → "ready for pricing" → **Director price** (marges RMB, peut override le coût caché aux Sales) → **quotation générée** → retour Sales. Le détail exact de la boucle `Sales→Director→Operations Pricing→Director→Sales` est **[P]** (stages observés, **boucle non drivée end-to-end** — l'approbation Director n'a **pas** pu être testée : aucune requête en attente + flux de création lourd).

## Task Lists (`production_task_lists`) [V]
Pipeline : **Sales** draft → **submit for production validation** (`draft → under_validation`) → **TLM/Operations** valident. Statuts : `draft, under_validation, needs_revision, validated, production_ready, cancelled`.
- **Création** : auto par `launchProduction` (depuis la proforma WON) → task list `draft`. Lignes produit = `production_task_list_lines` (copiées des `document_lines`).
- **Validation** ("Release to Production?") : gate serveur `evaluateRelease` (`lib/task-list-mapping-status.ts`) qui vérifie : statut autorisé, **factory mappings complets** (résolveur autonome), pas de révision ouverte, **et — fix S1.4 — ≥1 ligne produit** (refuse les task lists vides).
- **Révision** : boucle structurée TLM↔Sales (m049 `entity_messages` request/reply) — "Request revision" (catégorie + message requis) renvoie en `needs_revision`.
- **Release** : `validated` → un **production order** est auto-créé (`ensureProductionOrderForTaskList`).

## Production Orders (`production_orders`) [V]
- **Création** : auto à la validation de la task list, statut `awaiting_deposit`.
- **Suivi** (édité par Operations/TLM/Admin sur `/production/orders/[id]`, drawers "Open") : Production (status, dates, working days, ETA), Delay & timeline, **Payment** (deposit/balance/due dates/LC), Shipping & logistics (BL profile, ETD/ETA), Shipping documents (CI, 3 docs requis).
- **Auto-advance** : enregistrer un dépôt couvrant le seuil fait passer `awaiting_deposit → deposit_received`. [V]
- ⚠️ Operations/TLM voient une **vue technique éditable** ; les non-techniques (sales/finance) voient une **vue read-only "sales view"** (scopée à leurs propres deals → souvent vide pour finance).

## Finance [V]
- **`/finance`** ("Balances & LC") : **lecture seule** — tous les orders avec argent dû (deposit/balance/due dates/LC expiry). `finance.view` requis. Chiffres cohérents avec `/operations`.
- **`/cost-entry`** : **écriture** — saisie des coûts RMB par catégorie → crée des **versions de coût datées + auditées**. Capacité `pricing.manage_costs` (ou admin/finance).
- **Dépôts/balances/paiements** : saisis sur la page Order (par Operations), se **propagent** aux balances Finance. [V]

## Notifications [V]
- **Il n'y a PAS de table `notifications`.** Les notifs sont **calculées** (`lib/notifications.ts`) à partir de `notification_rules` (m123) + l'état des entités (documents/orders/task_lists/project_requests/affairs/clients). La cloche affiche un compteur.

## Audit Trail [V]
- Table **`events`** (`lib/events.ts` → `emitEvent`). Chaque transition émet un event (`client.created`, `doc.created`, `doc.status_changed`, `doc.won`, `tl.submitted_for_validation`, `tl.validated`, `po.created`, `po.deposit_received`, `po.status_changed`, …). C'est aussi la **source des notifications**.

---

# 3. MATRICE DES RÔLES [V sauf indication]

`user_roles.role` ∈ `{admin, sales, task_list_manager, operations, finance, sales_director}`. **`super_admin` = booléen séparé** (pas une valeur de `role`). `mzouai@` = seul super_admin.

Helpers (`lib/types.ts`) : `isAdminLike` = admin|super_admin ; `isTechnicalRole` = isAdminLike|task_list_manager|operations ; `canSupervise` = isAdminLike|**sales_director**.

| Route (matrice réelle) | sales | dir | tlm | operation | finance | admin |
|---|---|---|---|---|---|---|
| /dashboard /business /forecast /clients /projects /task-lists /operations | OK | OK | OK | OK | OK | OK |
| /prospects /prospects/pipeline | OK | OK | **DENY** | **DENY** | **DENY** | OK |
| /finance | **DENY** | OK | **DENY** | **DENY** | OK | OK |
| /cost-entry | DENY | DENY | DENY | DENY | OK | OK |
| /admin/products,categories,components,banks,sales-conditions,notifications,pricing | DENY | DENY | DENY | DENY | DENY | OK |
| /admin/users, /permissions/actions, /admin/diagnostics | DENY | DENY | DENY | DENY | DENY | **DENY** (super_admin only) |

> `OK` = page atteignable (la **donnée** est en plus filtrée par RLS). `/business` et `/forecast` sont **personnels** ("my deals only") → vides pour les rôles techniques (pas une fuite).

**Par rôle :**
- **Sales** : voit/crée ses clients, affaires, devis ; soumet les task lists. **Ne peut pas** : finance, prospects-admin, /admin, valider une task list.
- **Sales Director** : superviseur commercial. Via `canSupervise` : validation-review + réassignation d'ownership. **Voit toutes les données commerciales** (clients/affaires/docs/task_lists/orders) **depuis m132** (avant : 0 — bug F1). Approuve les Service Requests **[NV]**.
- **Task List Manager (TLM)** : valide/révise/release les task lists, factory mappings, enrichissement technique. Périmètre technique = `isTechnicalRole`.
- **Operations** : identique TLM côté technique (validation + édition production orders : dépôts/délais/expédition).
- **Finance** : `/finance` (lecture) + `/cost-entry` (écriture coûts). Pas d'action workflow.
- **Admin** : gère catalogue/pricing/banks/conditions/notifications. **Pas** users/permissions/diagnostics.
- **Super Admin** : tout, dont `/admin/users`, `/permissions/actions`, l'assignation de rôles (RPC `admin_set_user_role`), `/admin/diagnostics`.

**Règles RLS importantes [V]** :
- **`user_roles` : SELECT = "roles self" = sa PROPRE ligne uniquement** (`schema.sql:159`). Conséquence : `getCurrentUserRole()` lit le rôle de l'utilisateur courant ; on **ne peut pas** lire le rôle des autres → `resolveUserLabels` (lib/user-display.ts) tombe en fallback "Role · uuid" (d'où l'importance des display_names).
- **`clients` "read scoped" (m105)** : `created_by` OU `sales_owner_id` OU rôle technique (admin/tlm/operations/super) OU a créé un doc pour ce client OU **manager d'une équipe** du propriétaire (`team_members.member_role='manager'`). **+ m119** finance read. **+ m132** sales_director voit tout.
- **Moteur de visibilité app** (`lib/visibility.ts` `getVisibilityScope`) : basé sur `access_grants` (m067, scope_type self/team/region/lens/all). **Fallback sans grant** : `isTechnicalRole`→all, `canSupervise(sales_director)`→all (**fix F1**), sinon **own-only**.
- **`admin_set_user_role` (RPC, m090)** : **super_admin only**, accepte les 6 rôles. `admin_toggle_super_admin` idem.
- **`user_profiles` write = admin-only** : un utilisateur **ne peut pas** éditer son propre display_name (RLS 42501). [V]

---

# 4. ÉTAT DES TESTS

## Tests E2E [V]
- **Suite de régression** : `npm run e2e:regression` (`e2e/audit/regression.ts`) — **vrais logins** par rôle, asserte la **matrice de permissions** (litmus par rôle) + **F1** (dir voit des clients) + **F3** (/documents/new = 200). **État : 23/23 vert.** Exit 1 sur échec (CI-able).
- **Pipeline complet** : drivé manuellement via `e2e/audit/drive.ts` + step files `e2e/.runs/steps/*.json` (création client→affaire→devis→won→launch→task list→submit→validate→order→dépôt→finance). **Pas encore** un test automatisé unique (c'est de l'orchestration manuelle reproductible).
- **Non couvert E2E** : approbation Service Request (Director), écriture cost-entry, drawers Order autres que dépôt (timeline/shipping/BL/CI génération), flux CRM/Requests (prospects/tenders), édition admin.

## Tests unitaires [V]
- **214 tests, 214 pass, 0 fail** (`npm test` = `node --test tests/*.test.ts`). Couvrent : tender identity/clustering, visibility lenses, task-list visibility, attribution-parse, etc.
- ⚠️ **Tous les bugs majeurs (F1/F3/F4/F6) sont passés AU TRAVERS de l'unitaire** — ils sont au niveau **intégration / SSR / RLS / redirect**, non couvert par l'unitaire. *Bien testé en logique, fragile en intégration.*

## Schema Check [V]
- `npm run check:schema` (`e2e/audit/schema-check.ts`) : parse **401 colonnes** (schema.sql + migrations) vs **2079 références** de colonnes dans le code → signale toute colonne référencée mais inexistante (**classe 42703** = la faute qui pète au runtime car le client Supabase est non typé). **État : 0 référence inconnue.** Gate CI via `FAIL_ON_UNKNOWN=1`. C'est le **filet intérimaire** en attendant les types Supabase générés.

---

# 5. BUGS RÉSOLUS

| Bug | Cause | Correctif | Statut | Validation réelle |
|---|---|---|---|---|
| **F1** — sales_director voit 0 donnée (clients/affaires/docs/task_lists/orders/contacts) | Visibilité team-scopée (m105) + RLS "see-all" réservée à admin/tlm/operations ; `sales_director` absent. Fallback app `getVisibilityScope` ne couvrait pas sales_director. | App : `lib/visibility.ts` fallback → `canSupervise`. DB : **migration 132** (policies additives `sales_director` read sur 6 tables), **appliquée par l'owner**. | ✅ Corrigé | [V] testdir@ voit clients **10**, affaires **36**, docs **37**, task_lists **13**, orders **8**, contacts **2** (était 0). |
| **F2** — operation@ & finance@ sans rôle → UI dégradée (finance refusée /finance, operations en read-only) | Pas de ligne `user_roles` (comptes non assignés). Pas un bug RLS. | Owner a **assigné les rôles** via /admin/users. + **S1.5** : `<NoRoleNotice/>` pour les comptes sans rôle. | ✅ Corrigé | [V] re-sondé : operations = vue technique, finance = /finance OK. |
| **F3** — `/documents/[id]` ET `/documents/new` renvoient **HTTP 500** à chaque chargement (page rend quand même) | `@react-pdf/renderer` + `QuotationPDF` (browser-only) **importés au niveau module** dans `GeneratePdfButton` + `NewDocumentForm` → SSR cassé ("Element type is invalid" → erreur récupérable → 500). | Imports **dynamiques `await import()` dans le handler de clic** (jamais au SSR). 0 import `QuotationPDF` statique restant. | ✅ Corrigé | [V] 2 pages → 200 ; **PDF généré au clic** (upload storage 200, bouton→"Regenerate", 0 erreur). |
| **F4** — task list **et** production order créés avec `affair_id = null` (devis/proforma le gardaient) | `generateProductionTaskList` ne sélectionnait/insérait pas `affair_id` ; idem `ensureProductionOrderForTaskList`. | Ajout `affair_id` au select + insert dans les 2 actions (`task-lists/[id]/actions.ts`, `documents/[id]/actions.ts`). | ✅ Corrigé | [V] chaîne fraîche : PTL-SLX-ZEA-26-006 + PO-SLX-ZEA-26-006 ont `affair_id` (était null). |
| **F6** — création client : aucun redirect, aucun toast (client créé mais utilisateur bloqué sur /clients) | `createClientAction` renvoyait `{id}` et la **form-action client** faisait `router.push` — qui ne navigue pas de façon fiable. | **`redirect()` côté serveur** dans `createClientAction` (+ `?flash` toast) ; le wrapper laisse propager `NEXT_REDIRECT`. | ✅ Corrigé | [V] `f6-test.ts` : redirect→/clients/[id], toast "Client created", page client, 0 erreur. |
| **S1.3** — refus incohérent (`/cost-entry` redirige en silence) | `redirect("/dashboard")` au lieu de la page de refus. | `return <AccessDenied capability="pricing.manage_costs" />`. | ✅ Corrigé | [V] /cost-entry sales = 200 + page ACCESS DENIED. |
| **S1.4** — task list **vide** validable → order fantôme | `evaluateRelease` ne comptait pas les lignes. | Param `lineCount` + refus si 0. | ✅ Corrigé | [V] devis sans produit → task list 0 ligne → validation **refusée** (message + statut inchangé + **0 order**). |
| **S1.5** — compte sans rôle → shell dégradé muet | Le layout rendait le shell par défaut. | `<NoRoleNotice/>` si `!realRole && !isSuperAdmin`. | ✅ Corrigé | [P] logique + tsc OK ; **non testé en réel** (pas de login sans-rôle disponible). |
| **S1.2** — comptes non configurés peu visibles côté admin | — | Bannière prominente sur `/admin/users` (compte de comptes sans rôle). | ✅ Corrigé | [P] code + tsc ; **non rendu** (/admin/users = super_admin only). |
| **F7** — IDs bruts (`a5e93040…`) au lieu des noms | Fallback `resolveUserLabels` + display_names absents ; RLS user_roles self-only empêche de lire le rôle des autres. | Fallback humanisé ("User · a5e9") + display_names posés via admin (`set-names.ts`). | ✅ Corrigé | [V] /task-lists affiche "Sam Sales", "Tom TaskList", "Maurice". |

---

# 6. BUGS OUVERTS

| Bug | Impact | Priorité | Risque |
|---|---|---|---|
| **UI "0 lines / NO LINE ITEMS"** sur une task list **qui A une ligne produit** (ex. PTL-SLX-ASE-26-002 a "SSLXPRO 100") | Confusion : la task list paraît vide alors qu'elle a un produit. **[V]** que la ligne existe en DB ; le bug est l'**affichage** (la section "Product configuration" ne rend pas la ligne). Distinct du garde S1.4. | P1 | Moyen — peut faire douter d'une task list saine ; **non investigué en profondeur**. |
| **Ledger `schema_migrations` incomplet** (21/129) | Le runner de migrations ne peut pas `--apply` sans backfill ; suivi schéma↔DB non fiable. | P1 | Moyen — déploiements DB manuels/risqués. |
| **Approbation Service Request (Director) non vérifiée** | Workflow CRM amont potentiellement cassé/incomplet. | P1 | **[NV]** — inconnu. |
| **user_profiles non auto-éditable** (un user ne peut pas mettre son nom) | Onboarding : noms gérés uniquement par admin. | P2 | Faible — peut-être voulu. |
| **Modèle de visibilité Director = "see-all"** (choix pris en m132) | Si l'intention était "par équipe", c'est trop large. | P2 | Faible — décision métier owner. |
| **Scalabilité** (fetch-all + agrégation JS, index manquants, `.limit(5000)` silencieux sur clients) | OK en petit volume, casse en croissance. | P1 (avant prod) | Élevé à terme — **non traité**. |

> Bugs **résolus**, à ne PAS reconfondre comme ouverts : F1, F2, F3, F4, F6, S1.3, S1.4. Les "404" et "admin ERR" vus en audit = routes inexistantes / timeouts de 1er compile (**pas des bugs**).

---

# 7. AUDIT WIP "PREMIUM" (résumé)

- **Taille** : **107 fichiers modifiés (+10 098 / −6 428)** + **99 fichiers créés** ≈ **206 fichiers**. **214 tests unitaires verts.**
- **Zones impactées** (lignes ≈ impact) : UI/UX redesign (14 fichiers, −2627 = gros remplacement de styling) ; CRM/Requests prospects-tenders (13, +2839) ; CRM/Clients (14) ; Task Lists (18) ; Infra/DB migrations (29) ; **Permissions (27)** ; Production (7) ; Documents (13) ; Finance (11).
- **Terminé** : pipeline cœur (Documents post-fix, Task Lists, Production, Finance), redesign UI (visuel).
- **Partiellement terminé** : Permissions (marche mais a livré F1/F2), CRM/Clients (F6 corrigé), Infra/DB (ledger incomplet).
- **Prototype** : **CRM/Requests (prospects/tenders)** — gros, **jamais testé E2E**.
- **Dangereux** : la couche **Permissions/RLS** (27 fichiers de code sécurité — source des bugs de permission) + l'ancienne **architecture PDF** (import browser-only en SSR — cause F3, désormais fermée).
- **Risque de merge en un bloc : 7/10.**
- **Recommandation CTO : Option B — découper en lots** (ne PAS merger 206 fichiers d'un coup). Ordre : (1) DB/migrations + backfill ledger, (2) infra partagée + Permissions/F1, (3) shell UI/redesign, (4) cœur métier (rebasé), (5) CRM/Requests derrière un flag. *(D=repartir gâcherait du code qui marche + 214 tests ; A=merger d'un bloc = non revue/non revertable ; C=abandonner ne s'applique qu'à un lot.)*

---

# 8. ÉTAT DES COMMITS ET DU FIGEMENT [V]

- **Branche `freeze/core-metier`**, créée depuis `main` (main intact).
- **Commit de stabilisation `157e52c`** : **"freeze(core): stabilize the validated commercial→production→finance pipeline"** — **31 fichiers, +4313/−575**.
- **Inclus** (lot cœur) : `documents/[id]/*`, `documents/new/*`, `task-lists/[id]/*` + `task-lists/page`, `production/orders/*`, `finance/page`, `cost-entry/*`, `components/{QuotationPDF,CommercialInvoicePDF,DocQuickActions,TaskListWorkflow,production/ShippingDocumentsCard}`, `lib/{events,events-shared,pdf-filename,saveBlob,task-list-mapping-status}`, `api/documents/[id]/pdf/route`. **Porte les fixes F3, F4, S1.3, S1.4.**
- **Exclus / NON commités (176 fichiers)** : DB/migrations (31), App-shell/Admin S1.2-S1.5 (30), UI redesign (15), **CRM/Clients dont le fix F6 (12)**, **Permissions dont F1 (9)**, CRM/Requests (11), tests WIP (11), outillage audit (10), divers (47).

**Le cœur métier est-il RÉELLEMENT figé ? → NON (pas au sens structurel).**
- ✅ Un **point de référence validé existe** (`157e52c`) et le **comportement est verrouillé** par `npm run e2e:regression`.
- ❌ Mais le commit **ne build pas en isolation** : les 31 fichiers (état WIP) importent des symboles **encore non commités** (ex. `canSupervise` depuis `lib/types`, qui est dans le lot Permissions exclu). `git checkout 157e52c` seul ne compilerait pas.
- ❌ Le **runtime dépend** des migrations m100-132 (non commitées, ledger incomplet).
- → C'est un **checkpoint validé DANS la WIP**, pas une base autonome. **Vrai figement = committer d'abord les fondations** (migrations → infra partagée/Permissions → shell UI) **puis rebaser le cœur**.

---

# 9. MIGRATIONS ET BASE DE DONNÉES [V]

- **129 fichiers** de migration dans `supabase/migrations/` (m001 → m132).
- **Ledger** : table `schema_migrations` (créée en **m113**, colonnes `filename, applied_at, note`). Convention : chaque migration **s'auto-insère** dans ce ledger.
- **Problème historique** : le ledger n'existe que depuis m113 → **m001-112 ont été appliquées mais ne sont PAS enregistrées** → le runner les voit "pending" à tort (21 enregistrées / 129).
- **Migration 132** (`132_sales_director_visibility.sql`) : **écrite par l'agent, APPLIQUÉE par l'owner** — policies RLS additives `sales_director → see-all` sur clients/affairs/documents/production_task_lists/production_orders/contacts. (Fix F1, côté DB.)
- **Runner** (`scripts/migrate.ts`, `npm run db:migrate`) : **dry-run marche** (lit le ledger via anon+login admin) ; **`--apply` nécessite `DATABASE_URL` + `npm i pg`** et **refuse** tant que des migrations pré-ledger (< m113) apparaissent "pending" (il imprime le SQL de backfill).
- **Risques actuels** : pas de runner sûr tant que le ledger n'est pas backfillé ; migrations appliquées à la main par l'owner ; pas de check schéma↔code DB automatique au-delà de `check:schema` (qui couvre les colonnes côté code).

---

# 10. OUTILLAGE (tout dans `~/dev/facturation`, exécuté `node --env-file=… --experimental-strip-types …`)

**Harnais E2E `e2e/audit/`** (vrais logins, vrais JWT par rôle — **jamais "View As"**, qui invaliderait les conclusions RLS) :
- `probe.ts <role> [paths]` — sonde de routes (status/refus/redirect) + nav visible.
- `inspect.ts <role> "/p1,/p2"` — dump headings/boutons/champs/tables/liens/texte d'une page.
- `matrix.ts` — matrice consolidée 6 rôles × routes (`npm` n/a, lance direct).
- `drive.ts <role> <steps.json>` — **pilote générique** (DSL de steps : goto/clickText/fill/select/snapshot/assert/capture). Step files dans `e2e/.runs/steps/`.
- `whoami.ts` — **lit le rôle réel des 6 comptes sans clé service** (sign-in anon + self-read user_roles). Astuce clé.
- `q.ts <role> <table> [ilikeCol pattern] [cols] [limit]` — **lecture DB sous un vrai JWT** (vérifier la RLS / l'état réel). uuid → ne pas utiliser ilike.
- `roles-as-admin.ts`, `request-revision.ts`, `diag.ts` (capture console/pageerror/5xx/overlay/status d'une page — sert à débusquer les 500), `find-undef-import.ts` + `find-cycles.ts` (ont servi à pinpointer F3), `pdf-test.ts` (preuve PDF runtime), `f6-test.ts` (preuve F6), `set-names.ts` (pose les display_names via admin), `introspect-permissions.ts` (**nécessite la clé service** — non exécutable ici).
**Validation/CI** :
- `e2e/audit/regression.ts` → `npm run e2e:regression` (matrice + F1/F3, 23/23).
- `e2e/audit/schema-check.ts` → `npm run check:schema` (+ `FAIL_ON_UNKNOWN=1` en gate).
**Migrations** : `scripts/migrate.ts` → `npm run db:migrate` (dry-run / `--apply`). `npm run gen:types` (= `supabase gen types` — **nécessite creds owner**).
**Docs** : `docs/HANDOVER.md` (ce fichier), `docs/SPRINT2_TOOLING.md`, `docs/TEST_E2E_AUTONOMOUS_2026-06-23.md`, `docs/PLAN_E2E_HARNESS.md` (schéma FK + stratégie cleanup).

---

# 11. DONNÉES DE TEST À NETTOYER (avant tout pilote) [V]

Tout est tagué **`ZZZ_E2E_AUDIT_`** (ancre = `clients.company_name` / `affairs.name`). **4 clients racines** :
| id | nom | code |
|---|---|---|
| `42ebf688-5b40-455d-9b6f-4b4dd6a8a40d` | ZZZ_E2E_AUDIT_Acme Audit Co | ZEA |
| `b357a89d-1df7-4497-b9ad-db3fce356013` | ZZZ_E2E_AUDIT_F6Toast | ZFT |
| `f0d689c9-29c1-432e-9a92-ef02266a4119` | ZZZ_E2E_AUDIT_F6Btn | ZFB |
| `677a417a-a4cf-48cd-bbec-0002fbef3491` | ZZZ_E2E_AUDIT_F6_ZGA | ZGA |

Sous `42ebf688` (la chaîne complète) : affaires `25908980` (Affair 001), `55e33458` (002), `adeb63ee` (003), `d2725fa7` (Empty) ; devis **SLX-ZEA-26-001/003/005/007** ; proformas **SLX-ZEA-26-002/004/006** ; task lists **PTL-SLX-ZEA-26-002/004/006/008** (008 = vide, laissée `under_validation`) ; orders **PO-SLX-ZEA-26-002/006**.
**Méthode de cleanup** : supprimer les **4 clients racines** → cascade FK retire affaires/docs/task_lists/orders (cf. schéma FK dans `docs/PLAN_E2E_HARNESS.md` §5.2 ; ordre : orders → task_lists → documents → project_requests → affairs → clients). La RPC `e2e_cleanup_run` (m131) ne matche **pas** (préfixe `ZZZ_E2E_RUN_`, pas `ZZZ_E2E_AUDIT_`) → **suppression manuelle** (par l'owner/super_admin, ou via une session admin sur /clients qui autorise le delete cascade, m128).
⚠️ **Hors-périmètre** (NE PAS supprimer aveuglément) : `ZZZ_E2E_FULL_WORKFLOW` (client 3598e2f5) **préexistait** (pas créé cette session). Et **PTL-SLX-ASE-26-006** (AFRICA ENERGY, **pas à nous**) a été laissée en `needs_revision` avec un message-marqueur d'audit (Operations request-revision) — à re-soumettre (Sales) ou ignorer.

---

# 12. ROADMAP RECOMMANDÉE

**P0 (avant tout)**
1. **Structurer la WIP en lots (Option B)** et committer la **fondation** : migrations + **backfill du ledger** `schema_migrations` (m001-112). *Pourquoi : rien n'est "figeable" tant que la base n'est pas commitée ; le runner reste inutilisable.*
2. **Committer le lot Permissions/visibilité** (porte F1) **après revue isolée**. *Pourquoi : c'est la zone la plus dangereuse (source F1/F2) ; le cœur en dépend (`canSupervise`).*

**P1**
3. **Rebaser/figer réellement le cœur** sur les fondations commitées (le commit 157e52c deviendra alors buildable).
4. **Robustesse du setup** : valider à l'assignation (rôle + équipe/grant), signaler "compte non configuré" (S1.5 généralisé), seed reproductible des comptes.
5. **Types Supabase générés** (`gen:types`) + adoption incrémentale → tuer la classe 42703 à la compilation.
6. **Vérifier le workflow Service Request (Director)** end-to-end (non testé).
7. **Bug UI "0 lines"** (affichage task list).

**P2**
8. **Scalabilité** : remplacer fetch-all+agrégation JS, ajouter les index, supprimer le `.limit(5000)` silencieux.
9. **CRM/Requests (prospects/tenders)** : finir + tester, derrière un flag.
10. **Nettoyer les données de test** + durcir l'UX (denial uniforme partout, etc.).

---

# 13. LES 10 PROCHAINES ACTIONS (ordre exact, vision CTO)

1. **Backfiller le ledger `schema_migrations`** (insérer m001-112). *Sans ça, aucune automatisation DB n'est sûre — fondation de tout.*
2. **Committer le lot migrations** (incl. m132 déjà appliquée). *Fige la base ; débloque le runner.*
3. **Reviewer + committer le lot Permissions/visibilité** (lib/visibility, lib/auth, lib/permissions, lib/types, F1). *Zone la plus risquée ; le cœur en dépend pour compiler.*
4. **Committer le shell UI / redesign** (layout, premium.css, Nav). *Fondation visuelle dont les pages cœur dépendent.*
5. **Rebaser le lot cœur sur ces fondations + re-valider** (tsc + `e2e:regression` + `check:schema`). *Là le cœur est RÉELLEMENT figé (buildable).*
6. **Committer le lot CRM/Clients (F6)** + ajouter une assertion F6 à la régression. *Verrouille le fix F6 validé.*
7. **Générer les types Supabase** + wirer `createClient<Database>` progressivement. *Élimine la classe 42703.*
8. **Tester E2E le workflow Service Request** (Sales→Director→Operations→Director→Sales). *Seul gros workflow non vérifié.*
9. **Nettoyer les données de test** (4 clients `ZZZ_E2E_AUDIT_`) + corriger le bug UI "0 lines". *Pré-requis pilote propre.*
10. **Attaquer la scalabilité** (index + agrégations + `.limit`). *Avant toute montée en charge.*
*(Aucune nouvelle feature / extension CRM tant que 1-7 ne sont pas faits.)*

---

# 14. QUICK START POUR LE PROCHAIN CLAUDE (1 page)

## Ce qu'il faut absolument savoir
- Coder **uniquement dans `~/dev/facturation`** (pas l'iCloud). Serveur dev sur :3000.
- **Vrais tests > analyse statique.** Toujours **vrais logins** (mdp `Test12`), **jamais "View As"** (fausse les conclusions RLS).
- **Pas de clé service / DATABASE_URL / CLI Supabase** → tu ne peux **pas** appliquer de migrations ni générer les types ; l'owner le fait. Le DDL = owner.
- **`user_roles` self-read only** ; **`user_profiles` write = admin-only** ; le client Supabase est **non typé** (fautes de colonne au runtime — lance `npm run check:schema`).
- Le cœur est sur **branche `freeze/core-metier`, commit `157e52c`** ; **176 fichiers WIP non commités** par-dessus.
- Outils : `e2e/audit/*` (probe/inspect/drive/q/whoami/regression/diag) ; `npm run e2e:regression` (23/23) ; `npm run check:schema`.

## Ce qu'il ne faut SURTOUT pas casser
- Le **pipeline cœur** devis→won→launch→task list→validate→order→dépôt→finance (lance `e2e:regression` après tout changement).
- La **matrice de permissions / RLS** (les refus serveur).
- Les fixes : **F1** (lib/visibility + m132), **F3** (imports @react-pdf dynamiques — ne JAMAIS re-importer `@react-pdf/renderer`/`QuotationPDF` au niveau module d'un composant rendu en page), **F4** (affair_id), **F6** (redirect serveur createClientAction).

## Ce qu'il faut faire en premier
- Lire ce fichier + `docs/SPRINT2_TOOLING.md` + `docs/PLAN_E2E_HARNESS.md`.
- Lancer `npm run e2e:regression` et `npm run check:schema` pour confirmer le point de départ vert.
- Puis : **backfill ledger → committer migrations** (P0), avant tout figement réel du cœur.

## Ce qu'il ne faut pas faire
- ❌ `git stash` (casse ici). ❌ merger les 206 fichiers WIP d'un bloc. ❌ committer CRM/Requests (prototype non testé) avec le cœur. ❌ ajouter une **nouvelle feature** avant d'avoir figé le cœur (P0-P1). ❌ ré-importer une lib browser-only en SSR. ❌ se fier à "View As" pour conclure sur permissions/RLS.

---

# 15. SESSION 2026-07-08 — Documents d'affaire (bug OIM) + SR dossier technique [V]

## Bug corrigé : documents disparus des affaires (rapport owner, OIM Malanville)
- **Cause racine [V]** : la convention d'ancrage de `attachments.affair_id` a changé (m060 : racine de chaîne `root_document_id ?? id` → post-5307a : vraie `affairs.id`), mais les lignes existantes ET le chemin d'écriture portaient l'ancien ancrage → tous les uploads manuels invisibles sur les pages affaires. Diagnostic données réelles : **17/17 attachments** de la base sur l'ancien ancrage, dont **15 orphelins durs** (document d'ancrage supprimé) — inventaire dans `docs/attachments-orphans-2026-07-08.md`.
- **Fix app-side [V]** (marche AVANT migration) : matching **multi-ancres** partout — `affairAttachmentAnchors()` (lib/affairs-prototype) + `resolveAttachmentAnchors()` (lib/attachments-server, nouveau) ; consommateurs : buildAffairFiles, lib/client-affairs (fetch 2 endroits + buckets), affairs/[id]/page, AttachmentsPanel, task-lists exportData. Écriture : `resolveAttachmentWriteAnchor()` écrit la vraie `affairs.id` **une fois m156 appliquée** (probe ledger), sinon ancre legacy (RLS sales préservée).
- **m156 à appliquer** (`156_attachments_affair_anchor.sql`) : backfill `attachments.affair_id` → vraie affaire + bras RLS `d.affair_id` sur la policy read + ledger (le probe d'écriture lit cette ligne).
- **Preuves [V]** : 3 tests unitaires (tests/affairs-anchor.test.ts) ; repro data-level `e2e/audit/oim-repro-ui.tmp.ts` PASS ; UI réelle `oim-ui-verify.tmp.ts` PASS (plans mât + fiche technique + études énergétiques de nouveau visibles sur /affairs/OIM).

## SR = dossier technique (Excel costing · panneau réel · drawing mât)
- **m157 à appliquer** (`157_sr_technical_dossier.sql`) : catégories `costing` + `pole_drawing` sur `project_request_files` (pattern m094) + colonnes `project_requests.solar_panel_power_w / _length_mm / _width_mm / _thickness_mm / _reference`. **App dormante avant m157** (uploaders + champs panneau gatés sur le ledger via `lib/migrations.ts::migrationApplied`).
- **UI** (`/projects/[id]`, section ① Factory cost, view_cost-gatée) : uploader **Costing Excel** (cost-sensible : jamais montré aux Sales, filtré aussi de la liste Documents globale) ; bloc **Pole drawing** avec note « Strongly recommended » (jamais bloquant) ; champs **Actual solar panel used** dans le formulaire `enterFactoryCost` (persistés sur la SR, affichés dans la carte Solar configuration).
- **SSoT** : collector `project_request_files` ajouté à `lib/project-documents-server.ts` (+ `folderForRequestFile` dans lib/project-documents) → les fichiers SR remontent dans l'onglet Documents de l'affaire (costing filtré par `project.view_cost`).
- **Preuves [V]** : `sr-dossier-verify.tmp.ts` PASS (ops voit les blocs + hints dormants ; sales ne voit RIEN de costing) ; `sr-collector-verify.tmp.ts` PASS (round-trip réel upload SR → onglet Documents affaire → cleanup) ; 567 tests unitaires ; régression 23/23 ; check:schema + check:capabilities verts.

## Migrations — APPLIQUÉES par l'owner le 2026-07-08 [V]
- **m156 + m157 APPLIQUÉES et re-vérifiées** : backfill complet (0 legacy résoluble restant, 15 orphelins durs assumés), colonnes solar_panel_* actives, catégories costing/pole_drawing acceptées, RLS sales OK, uploaders/champs panneau ACTIFS sur la SR, costing Excel visible admin / INVISIBLE sales dans l'onglet Documents affaire (`post-m156-m157-verify.tmp.ts` + `costing-visibility-verify.tmp.ts` PASS), régression 23/23.
