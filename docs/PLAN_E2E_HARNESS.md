# PLAN — Harnais E2E multi-sessions persistantes

> **Statut** : architecture validée par l'owner (2026-06-23). Construction en cours.
> **Repo canonique** : `~/dev/facturation` (git-tracked). Ne jamais coder dans la copie iCloud.
> **Objectif** : exécuter de vrais workflows Sales ↔ TLM ↔ Operations ↔ Finance ↔ Director
> pendant plusieurs heures, sans intervention humaine, avec **vraies sessions / vraies
> permissions / vraie isolation RLS** — pas de rôle switcher, pas de bypass admin.

---

## 1. Pourquoi (le problème)

Le **rôle switcher / « View As »** superpose un cookie `solux_view_as_role` au **JWT admin réel**
(`lib/auth.ts` : `getEffectiveRole()`). Les requêtes DB tournent **toujours sous l'identité admin**
→ la RLS ne voit jamais le rôle simulé → tous les bugs de permission / visibilité / isolation de
données sont **masqués** (faux négatifs). C'est la cause documentée des bugs qui n'apparaissaient
qu'avec de vrais comptes (cf. mémoire `view-as-invalidates-real-account-test`).

**Vraies sessions** = chaque fenêtre porte **son propre JWT** → RLS, route guards et capabilities
s'évaluent pour le vrai rôle. On attrape exactement la classe de bugs invisible au switcher, et on
la transforme en **assertions de permissions explicites**.

---

## 2. Comptes (vérifié 2026-06-23)

6 comptes réels sur `solux-light.com`, mot de passe commun `Test`. Mapping confirmé dans `lib/types.ts` :

| Compte | Rôle app | Acteur workflow |
|---|---|---|
| `testsales@` | `sales` | Crée devis / service requests, soumet les task lists |
| `testdir@` | `sales_director` | Approuve requests, pricing projet, supervision |
| `testfinance@` | `finance` | Lecture `/finance` + ledger (pas d'action workflow) |
| `testlm@` | `task_list_manager` | Valide les task lists, release vers production |
| `testoperation@` | `operations` | Scope technique identique au TLM (`isTechnicalRole()`) |
| `testadmin@` | `admin` | **Setup + cleanup uniquement** (jamais acteur métier) |

> **« Production » n'est pas un compte/rôle** : c'est une *phase* (`under_validation → validated →
> in_production → completed`) opérée par TLM ou Operations. Pas de `testproduction@`.
> On lance **TLM et Operations séparément** (décision owner) pour valider la visibilité propre à
> chaque rôle, même s'ils partagent la logique technique aujourd'hui.

---

## 3. Architecture

**Socle** : librairie **Playwright (Node/TS)**, `@playwright/test`, structurée en **orchestrateur
autonome stateful** (pas une suite de petits tests isolés) — le besoin est un workflow multi-acteurs
de plusieurs heures, pas des tests unitaires indépendants. TS déjà natif (`node --experimental-strip-types`).

```
                         campaign.ts  (point d'entrée unique)
                              │
        ┌─────────────┬───────┴────────┬──────────────┬─────────────┐
        ▼             ▼                ▼              ▼             ▼
   Auth Bootstrap  Session Pool   Run Context    Scenario      Reporter
   6 logins réels  6 contextes    RUN_ID + tag   Engine        html/md/trace
   → .auth/*.json  isolés +       + manifeste    (steps +      + summary.json
                   keepalive +    {table,id}     assertions    + cleanup report
                   self-heal                     permissions)
                              │                                       │
                              ▼                                       ▼
                     6 sessions Supabase                      Cleanup (fin de run)
                     (1 compte = 1 contexte,                  RPC SECURITY DEFINER
                      cookies @supabase/ssr,                  e2e_cleanup_run(tag)
                      JWT réel par rôle)                      OU leave-behind si échec
```

### Arborescence

```
e2e/
├─ config.ts            # baseURL, rôles, timeouts, intervalle keepalive, format du tag
├─ env.ts               # charge .env.e2e (6 emails + password)        ← gitignoré
├─ auth/bootstrap.ts    # 6 logins réels via /login → .auth/<role>.json + validation
├─ session/
│  ├─ pool.ts           # 6 BrowserContext isolés, tracing on, as(role) → Page
│  ├─ keepalive.ts      # timer par contexte : refresh périodique du JWT
│  └─ health.ts         # détecte une déconnexion → re-login auto du seul rôle concerné
├─ run/
│  ├─ context.ts        # RUN_ID = ZZZ_E2E_RUN_<YYYYMMDD>_<HHMM> ; helper tag(label)
│  └─ manifest.ts       # ledger JSONL {table,id} de TOUT ce que le run crée
├─ cleanup/
│  ├─ cleanup.ts        # appelle la RPC (dry-run → delete) + réconcilie le manifeste
│  └─ policy.ts         # leave-behind-on-failure vs auto-clean-on-success
├─ scenario/
│  ├─ engine.ts         # exécute les steps, screenshots, capture diagnostics
│  └─ permissions.ts    # lib expectDenied(role,path) / expectVisible(role,sel)
├─ report/reporter.ts   # report.html + report.md + summary.json
├─ campaign.ts          # caffeinate → preflight serveur → bootstrap → pool → run → cleanup → report
├─ .auth/               # storageStates (gitignoré)
└─ .runs/<RUN_ID>/      # manifeste, traces, screenshots, rapport (gitignoré)

supabase/migrations/
└─ 131_e2e_cleanup_rpc.sql   # e2e_cleanup_run(p_run_tag, p_dry_run) — s'auto-insère dans schema_migrations (m113)

.env.e2e                     # 6 emails + password "Test" (gitignoré, jamais commit)
package.json                 # +@playwright/test ; scripts e2e:bootstrap / e2e:campaign / e2e:cleanup
```

---

## 4. Maintien des sessions (plusieurs heures, zéro intervention)

Trois mécanismes superposés exploitant l'auth cookie `@supabase/ssr` :

1. **Refresh passif** — `lib/supabase/middleware.ts` rafraîchit le JWT **à chaque requête**.
   Toute navigation d'un step renouvelle la session côté serveur ; un scénario actif ne se
   déconnecte jamais.
2. **Keepalive** — timer par contexte (~10 min) qui navigue vers une page légère authentifiée
   pendant les phases d'attente (une fenêtre idle pendant qu'une autre travaille).
3. **Self-heal** — health-check avant chaque step majeur ; si un contexte est détecté déconnecté
   (redirect `/login` / 401), re-login **automatique du seul rôle concerné** et rechargement du
   storageState. → « sans réauthentification ni intervention **humaine** » : la réauth, si elle
   arrive, est automatique et ciblée.

**Règle d'or** : **1 compte = 1 seul contexte vivant**. Supabase fait *tourner* le refresh-token à
chaque refresh ; deux contextes partageant le même storageState se voleraient le token et l'un
serait déconnecté. Avec 6 comptes distincts, la règle est respectée par construction.

---

## 5. Cleanup — données jetables taguées (auto + leave-behind)

### 5.1 Double identifiant par run

- **Tag visible** injecté dans les champs libres des **racines** (via l'UI réelle) :
  - `clients.company_name` (anchor principal)
  - `affairs.name` (anchor secondaire)
  - `project_requests.name` (anchor tertiaire)
  - ⚠️ **Pas de tag sur `documents`** : `documents.client_reference` **n'existe pas** en prod
    (vérifié 2026-06-23, `42703`). Les documents sont atteints par FK (`client_id`/`affair_id`).
- **Manifeste** `{table,id}` de chaque ligne créée (IDs lus dans les URLs/réseau après chaque
  création). Sert de **clé de vérification** post-cleanup (pas de nettoyage partiel silencieux).

### 5.2 Schéma de suppression (FK vérifiées sur le live, 2026-06-23)

Hiérarchie réelle et comportements ON DELETE :

```
clients (root)                          [archived_at ✓]
 ├─ affairs            client_id  SET NULL   (m076)   name ✓ archived_at ✓
 │   ├─ planned_actions  affair_id  CASCADE  (m103)
 │   ├─ documents        affair_id  SET NULL (m076) / client_id NO ACTION
 │   │   ├─ document_lines        document_id  CASCADE
 │   │   ├─ production_task_lists quotation_id CASCADE / affair_id SET NULL / client_id NO ACTION
 │   │   │   ├─ production_task_list_lines  task_list_id CASCADE
 │   │   │   └─ production_orders  task_list_id CASCADE / quotation_id CASCADE / client_id NO ACTION
 │   │   │       ├─ order_documents          production_order_id CASCADE (m099)
 │   │   │       ├─ order_document_audits    production_order_id CASCADE (m099)
 │   │   │       └─ production_deadline_changes production_order_id CASCADE (m018)
 │   └─ project_requests  affair_id  RESTRICT (m124!) / client_id SET NULL
 │       ├─ factory_cost_requests  project_request_id CASCADE (m090)
 │       ├─ freight_cost_requests  project_request_id CASCADE (m090)
 │       ├─ project_request_files  project_request_id CASCADE (m090)
 │       └─ project_products        project_request_id CASCADE (m095)
 └─ contacts            client_id  CASCADE   (m101)
```

**Conséquence** : la RPC supprime **6 niveaux parents explicitement**, dans cet ordre, et laisse les
**cascades vérifiées** retirer les enfants. L'ordre est imposé par deux contraintes non-cascade :
`project_requests.affair_id RESTRICT` (→ requests **avant** affairs) et les liens `client_id NO
ACTION` sur documents/task_lists/orders (→ ces 3 **avant** clients).

```
1. production_orders     → cascade: order_documents, order_document_audits, production_deadline_changes
2. production_task_lists → cascade: production_task_list_lines
3. documents             → cascade: document_lines
4. project_requests      → cascade: factory/freight cost requests, files, products   (AVANT affairs — RESTRICT)
5. affairs               → cascade: planned_actions
6. clients               → cascade: contacts
```

### 5.3 RPC `e2e_cleanup_run(p_run_tag, p_dry_run)` (migration 131)

- `SECURITY DEFINER` + `search_path = public, pg_temp` → contourne la RLS **sans distribuer de clé
  service_role** (il n'y en a pas dans l'env).
- **Admin-only** : garde interne `user_roles.role = 'admin'` (sinon `42501`).
- **Garde-fou anti-DELETE massif** : refuse tout tag ne matchant pas `^ZZZ_E2E_RUN_\d{8}_\d{4}` (`22023`).
- **Prefix-match exact** via `starts_with(col, tag)` — **PAS `LIKE`** (le tag contient des `_`, qui
  sont des wildcards LIKE → faux positifs).
- **`p_dry_run = true` par défaut** : renvoie les compteurs de scope **sans rien supprimer**.
  L'orchestrateur loggue le plan, puis rappelle avec `p_dry_run = false`.
- Atomique (fonction = 1 transaction du caller) : tout-ou-rien.
- Retourne un **rapport JSONB** (run_tag, dry_run, compteurs par entité, deleted).
- S'auto-insère dans `schema_migrations` (règle m113). **Appliquée manuellement en Supabase** après
  backup (convention du projet).

### 5.4 Politique leave-behind-on-failure

- **Succès** → cleanup auto : dry-run → delete → réconciliation manifeste → 0 résidu.
- **Échec** (assertion ou exception) → **cleanup sauté**, données taguées **conservées intactes**,
  le rapport affiche en gros le **tag + le manifeste + le dernier screenshot/trace**. Purge manuelle
  ultérieure : `npm run e2e:cleanup -- <RUN_ID>`.
- Flags : `--keep` (garder même en succès), `CLEANUP_ON_FAILURE=false` (défaut).

### 5.5 Garde-fous (base partagée réelle)

Suppression limitée au tag **exact** du run (jamais le wildcard `ZZZ_E2E_*`) · dry-run obligatoire ·
ordre FK encodé · prefix-match exact (pas LIKE) · admin-only · aucune ligne non taguée touchée ·
réconciliation par manifeste.

### 5.6 Résidu connu (v1)

`entity_messages` / `notifications` sont **polymorphes** (`entity_type` + `entity_id`, sans FK) →
non couverts par les cascades. En v1 ils deviennent **orphelins (inoffensifs)** quand l'entité est
supprimée. Purge par `entity_id` = follow-up (nécessite de confirmer le type de `entity_id`).

---

## 6. Rapports générés

Par run, dans `e2e/.runs/<RUN_ID>/` :

- **`report.html` + `report.md`** — timeline des steps (✓/✗, durée, acteur), screenshots, **matrice
  d'assertions de permissions** (attendu vs réel), **rapport de cleanup** (compteurs par table) **ou**
  bandeau « DATA LEFT BEHIND » avec le tag + le manifeste.
- **`manifest.jsonl`** — chaque entité créée.
- **`trace-<role>.zip`** par contexte → `npx playwright show-trace` (rejeu DOM/réseau pas-à-pas).
- **`console-<role>.log`** + **`network-<role>.har`** (optionnels).
- **`summary.json`** — verdict machine-lisible (pass/fail, durée, #assertions, résidu cleanup).

---

## 7. Lancer une campagne multi-heures

`npm run e2e:campaign` enchaîne :

1. **`caffeinate -dimsu`** → empêche la veille macOS.
2. **Preflight serveur** → vérifie `:3000` (sinon `WATCHPACK_POLLING=true npm run dev` depuis
   `~/dev/facturation` — cf. mémoire `dev-server-icloud-fix`).
3. **Bootstrap** (ou réutilise les storageState récents).
4. **Pool** : 6 contextes + tracing + keepalive.
5. **Scénario(s)** — joués en séquence (boucle possible pour étaler sur plusieurs heures).
6. **Cleanup** (ou leave-behind si échec).
7. **Rapport** + code de sortie reflétant le verdict.

**Headless** par défaut (fiabilité non-attended ; les traces remplacent l'observation écran). « Sans
intervention humaine » = propriété du **script** (déterministe) + keepalive/self-heal + caffeinate +
leave-behind.

---

## 8. Limites

| Limite | Mitigation |
|---|---|
| DB dev **partagée** : le run mute de vraies données | Tag + manifeste + RPC scopée ; lancer quand personne d'autre n'utilise l'instance |
| Rotation refresh-token | 1 compte = 1 contexte ; pas 2 campagnes partageant des comptes |
| Sélecteurs UI fragiles | `data-testid` sur les éléments clés du workflow |
| Capture d'IDs enfants indirecte | La RPC nettoie par FK depuis la racine taguée (attrape les enfants non manifestés) ; le manifeste *vérifie* |
| Pas de clé service_role | Cleanup via RPC `SECURITY DEFINER` invoquée par Admin ; si login Admin casse → leave-behind + alerte |
| `entity_messages` orphelins | Inoffensif en v1 ; purge par `entity_id` = follow-up |
| Périmètre localhost | On teste la correction applicative sous vraies identités (RLS/permissions/visibilité/workflow), pas l'infra prod / emails / réseau |
| Playwright pas encore dépendance | +1 devDependency + download navigateur (une fois) |

---

## 9. Effort & ordre de construction

| Lot | Effort | Statut |
|---|---|---|
| 1. Scaffold + config + secrets `.env.e2e` + `.gitignore` | 0,25 j | |
| **5a. Vérif FK sur schéma live** | — | ✅ fait 2026-06-23 |
| **5b. Migration 131 (RPC cleanup)** | 0,5–1 j | en cours |
| **2a. Scaffold e2e + Playwright + secrets** | 0,5 j | à venir |
| **2b. Auth bootstrap + validation des 6 states** | 0,5 j | à venir |
| → **REVUE INTERMÉDIAIRE (checkpoint owner)** | — | bloquant avant la suite |
| 3. Session pool + keepalive + self-heal | 0,75 j | |
| 4. Run context + tag + manifeste | 0,5 j | |
| 6. Scenario engine + lib d'assertions de permissions | 0,75 j | |
| 7. Reporting (html/md/trace/summary) | 0,75 j | |
| 8. Campaign runner (caffeinate, preflight, leave-behind) | 0,5 j | |
| 9. Durcissement + smoke du harnais | 0,5 j | |
| **Total harnais (hors scénario métier)** | **~5–7 j** | |
| Scénario Sales→Production (livrable suivant) | +1,5–2 j | |

**Ordre démarré** : 5b (cleanup RPC) + 2b (auth) d'abord — les deux fondations à risque (sûreté du
nettoyage sur base réelle + fiabilité des logins), puis revue intermédiaire avant le reste.

---

## 10. Journal de vérification (live, anon-key probe — 2026-06-23)

Toutes les colonnes/tables touchées par la RPC confirmées présentes en prod **sauf** `documents.client_reference`
(absente → exclue du schéma de tag). FK ON DELETE extraites des migrations (schema.sql est un noyau
ancien ; les migrations sont la source de vérité, appliquées et tracées dans `schema_migrations`) :
`affairs.client_id` SET NULL (m076), `documents/ptl/po.affair_id` SET NULL (m076),
`project_requests.affair_id` **RESTRICT** (m124), enfants tous CASCADE (m090/m095/m099/m101/m103/m018).

> Méthode : la vérification « live » des **colonnes** se fait par REST (anon key : `42703` = absente,
> `200` = présente). Les comportements **ON DELETE** ne sont pas exposés par REST → extraits du DDL
> des migrations (= ce qui est appliqué en prod). À reconfirmer si un doute via une introspection
> `pg_constraint` lors d'un accès SQL.
