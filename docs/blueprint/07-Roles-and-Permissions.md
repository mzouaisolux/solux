# 07 — Rôles & Permissions

> Pour chaque rôle : responsabilités, permissions, restrictions, écrans accessibles, actions autorisées.
> Sources : `lib/types.ts`, `lib/auth.ts`, `lib/permissions.ts`, `lib/visibility.ts`, `lib/navigation.ts`, migrations `026, 042, 053, 055, 064, 090, 091, 104, 119, 122, 033, 105, 119, 132`.

---

## 1. Modèle de sécurité à deux niveaux

La sécurité combine **deux mécanismes indépendants** qui s'additionnent :

| Niveau | Question | Où | Mécanisme |
|---|---|---|---|
| **RLS (Row Level Security)** | « Quelles **lignes** ce user peut-il voir/écrire ? » | PostgreSQL (policies sur chaque table) | Le JWT Supabase porte l'`auth.uid()` ; les policies filtrent par `created_by`/`sales_owner_id`/rôle/équipe. **Inviolable même par un appel SQL direct.** |
| **Capabilities** | « Quelle **action** ce user peut-il déclencher ? » | Server actions (`lib/permissions.ts`) | Avant toute mutation privilégiée, l'action appelle `requireCapability("x")` qui lit la matrice `role_permissions`. |

> **Principe (commentaire `permissions.ts:9-16`, décision D.1)** : « App-level only. RLS policies ne sont PAS modifiées par la couche capability ; le check capability se fait dans la server action juste avant la mutation. » Les deux couches sont complémentaires : RLS borne la donnée visible, capabilities bornent les actions.

**Conséquence importante** : certaines gardes métier (ex. « une proforma ne peut pas être won », « un devis WON ne redevient pas éditable ») sont **applicatives** (dans la server action), pas RLS. Un `UPDATE` SQL direct par un admin contournerait ces gardes applicatives — mais la **cascade d'annulation** reste garantie par un **trigger DB** (`m023`). Voir [06-Business-Rules.md](06-Business-Rules.md).

### Réel vs effectif (View-As)
- `getCurrentUserRole()` (`auth.ts:22`) → le **vrai** rôle (JWT). **Toutes les décisions de sécurité l'utilisent.**
- `getEffectiveRole()` (`auth.ts:56`) → le rôle **affiché** ; pour un super-admin, honore le cookie `solux_view_as_role` (« View As »). **Ne sert qu'au rendu.**
- `hasCapability()` = check sécurité (vrai rôle) ; `hasUiCapability()` = visibilité UI (rôle effectif). `requireCapability()` (serveur) ignore toujours View-As (`permissions.ts:209-229`).

> ⚠️ **Mémoire d'audit** : « View As » est **indiscernable d'un vrai login dans l'UI** mais la RLS tourne avec le JWT de l'admin → toute conclusion sécurité/visibilité tirée via View-As est **invalide**. Tester avec de vrais comptes (Sign out / Sign in).

---

## 2. Les 7 rôles

`user_roles.role` ∈ `{admin, sales, task_list_manager, operations, finance, sales_director}` (`lib/types.ts:9`). **`super_admin` est un booléen séparé** (`user_roles.super_admin`), pas une valeur de `role` — le CHECK DB rejette la chaîne `'super_admin'` (`types.ts:72-84`). Quand `super_admin=true`, le rôle DB reste `'admin'` et l'app surface le rôle virtuel `super_admin` (`auth.ts:43`).

### Helpers de rôle (`lib/types.ts`) — à garder distincts
| Helper | = | Pouvoir conféré |
|---|---|---|
| `isAdminLike(role)` | admin · super_admin | Pouvoirs admin/système |
| `isTechnicalRole(role)` | isAdminLike · task_list_manager · operations | Pouvoirs de production (validation, deadlines, expédition) |
| `canSupervise(role)` | isAdminLike · **sales_director** | Supervision commerciale : approuver une validation de devis, réassigner un propriétaire (deal/compte/affaire) |

### 2.1 — Super Admin (`super_admin = true`)
- **Responsabilités** : administration système totale. Seul `mzouai@solux-light.com`.
- **Peut** : tout, dont `/admin/users`, `/permissions/actions`, `/admin/diagnostics`, l'assignation des rôles (RPC `admin_set_user_role`), le toggle super_admin, la simulation « View As », les **suppressions physiques** de données (`requireSuperAdmin`, `auth.ts:144`).
- **Restrictions** : ne peut pas éditer **son propre** rôle (`admin_set_user_role` refuse `target = self`, `m042:59-63`).

### 2.2 — Admin (`admin`)
- **Responsabilités** : gestion des master-data et de tous les workflows métier.
- **Peut** : catalogue (produits, catégories, composants), pricing (listes de prix, coûts), banques, conditions de vente, règles de notification ; tout le pipeline commercial→production→finance ; valider/rejeter des task lists ; éditer les production orders ; `start_without_deposit` ; archiver.
- **Restrictions [V]** : **PAS** `admin.manage_permissions`, **PAS** `admin.manage_users`, **PAS** les suppressions physiques permanentes (`quotation.delete`/`task_list.delete`/`production_order.delete` = `false` en m026 — réservées super_admin). `/admin/diagnostics` requiert `admin.diagnostics` (super_admin par défaut).
- **Anti-lockout (m122)** : `requireCapabilityOrAdmin` / `canAccessOrAdmin` → admin & super_admin passent **toujours** sur les master-data même si la matrice n'est pas seedée (`permissions.ts:250-277`).

### 2.3 — Sales Director (`sales_director`)
- **Responsabilités** : **superviseur commercial** sans pouvoir technique/admin.
- **Peut** (via `canSupervise`) : approuver/refuser une **validation de devis** (`reviewValidation`), **réassigner** un propriétaire (client/affaire/document) ; **approuver les Service Requests** (`project.approve`) ; **voir toute la donnée commerciale** (clients/affaires/documents/task_lists/orders/contacts) depuis **m132** ; `finance.view` (m119) ; `prospect.access` (m104) ; assigner des tenders.
- **Restrictions** : pas de pouvoir technique (ne valide pas une task list — `task_list.validate` n'est pas accordé par défaut), pas d'admin/users/permissions/diagnostics.
- ⚠️ **Incohérence connue** (TO BE VALIDATED) : la réassignation d'owner est gardée par `canSupervise` (inclut sales_director) côté serveur, **mais** le bouton UI est gardé par `isTechnicalRole` (exclut sales_director) et le RPC `list_assignable_owners` exige un rôle « management » (sans sales_director). → La capacité serveur existe mais l'UX la cache pour le directeur. Voir [02-Modules/clients-affaires-contacts.md](02-Modules/clients-affaires-contacts.md) §5.

### 2.4 — Sales (`sales`)
- **Responsabilités** : commercial — possède ses clients, affaires, devis.
- **Peut** : créer/gérer **ses** clients, affaires, contacts, devis (`quotation.create`, `quotation.cancel`) ; supprimer ses devis (`quotation.delete` = `true` via **m055**, mais verrouillé si production existe) ; créer des Service Requests (`project.create`) ; soumettre des task lists pour validation (pas de capability — la soumission `draft→under_validation` n'est pas gardée par capability) ; `prospect.access`.
- **Restrictions** : **ne voit jamais** le coût usine RMB ni le factory mapping ; **ne peut pas** valider une task list, éditer un production order, accéder à finance/cost-entry/admin/permissions. Données **scopées RLS** à ses propres enregistrements (own-only).

### 2.5 — Task List Manager / TLM (`task_list_manager`)
- **Responsabilités** : responsable des listes de production.
- **Peut** : valider/rejeter/release les task lists (`task_list.validate`, `task_list.reject`), gérer le **factory mapping** (`factory_mapping.access`, m064), enrichissement technique (`technical_values`, `factory_overrides`), éditer les production orders (`production_order.edit_status/deadline/payments/shipment/set_timeline`), `task_list.sync_orphans` ; créer/annuler des devis (`quotation.create/cancel`).
- **Restrictions** : **PAS** `start_without_deposit`, **PAS** archive/delete task list ou order, **PAS** quotation.archive/delete, **PAS** admin/permissions/users, **PAS** prospects/finance/cost-entry. Périmètre = `isTechnicalRole`.

### 2.6 — Operations (`operations`)
- **Responsabilités** : identique au TLM côté technique (durée de production, timeline, coordination expédition) + saisie des coûts/logistique pour les Service Requests.
- **Peut** : **exactement les mêmes capabilities que `task_list_manager`** — Operations est seedé par **miroir de TLM** (`m042:77-81`, re-confirmé `m053:55-59`). Plus : saisie des coûts usine / packing / freight des Service Requests (`project.enter_cost`, `project.enter_logistics`).
- **Restrictions** : identiques au TLM. `prospect.access` = **DENY** (m104).

### 2.7 — Finance (`finance`)
- **Responsabilités** : suivi financier (lecture) + saisie des coûts.
- **Peut** : `/finance` (balances, dépôts, LC — **lecture seule**, `finance.view` m119) ; `/cost-entry` (saisie des coûts RMB versionnés, `pricing.manage_costs` m122) ; `project.view_cost`/`project.enter_cost` (peut saisir le coût usine d'un Service Request).
- **Restrictions** : **aucune action de workflow** (pas de validation, pas d'édition d'order, pas de statut). RLS finance = **SELECT-only** sur `production_orders`/`documents`/`clients` (m119) — aucune policy write. `prospect.access` = DENY (m104).

---

## 3. Matrice des capabilities (autoritative)

Source = seed des migrations (`role_permissions`). `✅`=enabled, `❌`=disabled, `—`=aucune ligne seedée (⇒ effectivement refusé, fail-closed). « SA »=super_admin, « Dir »=sales_director, « TLM »=task_list_manager, « Ops »=operations, « Fin »=finance.

> **Note sur Ops** : `operations` **reflète intégralement** `task_list_manager` (m042/m053) — toute case TLM s'applique à Ops, sauf override manuel ultérieur via `/permissions/actions`.
> **Note sur les rôles tardifs** : `finance` (m119) et `sales_director` n'ont de lignes que dans les migrations qui les concernent ; pour les capabilities antérieures à leur introduction, ils n'ont **pas** de ligne (`—` ⇒ refusé).

### Quotation
| Capability | SA | admin | Dir | TLM | Ops | sales | Fin | Source |
|---|---|---|---|---|---|---|---|---|
| `quotation.create` | ✅ | ✅ | TBV | ✅ | ✅ | ✅ | — | m026 |
| `quotation.cancel` | ✅ | ✅ | — | ✅ | ✅ | ✅ | — | m026 |
| `quotation.archive` | ✅ | ✅ | — | ❌ | ❌ | ❌ | — | m026 |
| `quotation.delete` | ✅ | ✅¹ | — | ❌ | ❌ | ✅¹ | — | m026 + **m055** |

¹ m026 met `admin=false`/`sales=false` ; **m055** (`on conflict do update`) passe `admin=true` et `sales=true`. État effectif = celui de m055 si appliquée. La suppression reste **bloquée applicativement** si une task list/PO existe (Decision F).

### Task list
| Capability | SA | admin | Dir | TLM | Ops | sales | Fin | Source |
|---|---|---|---|---|---|---|---|---|
| `task_list.validate` | ✅ | ✅ | — | ✅ | ✅ | ❌ | — | m026/m042 |
| `task_list.reject` | ✅ | ✅ | — | ✅ | ✅ | ❌ | — | m026/m042 |
| `task_list.archive` | ✅ | ❌ | — | ❌ | ❌ | ❌ | — | m026/m042 |
| `task_list.delete` | ✅ | ❌ | — | ❌ | ❌ | ❌ | — | m026/m042 |
| `task_list.sync_orphans` | ✅ | ✅ | — | ✅ | ✅ | ❌ | — | m026/m042 |
| `factory_mapping.access` | ✅ | ✅ | — | ✅ | ✅ | ❌ | — | **m064** |

### Production order
| Capability | SA | admin | Dir | TLM | Ops | sales | Fin | Source |
|---|---|---|---|---|---|---|---|---|
| `production_order.edit_status` | ✅ | ✅ | — | ✅ | ✅ | ❌ | — | m026/m042 |
| `production_order.edit_deadline` | ✅ | ✅ | — | ✅ | ✅ | ❌ | — | m026/m042 |
| `production_order.edit_payments` | ✅ | ✅ | — | ✅ | ✅ | ❌ | — | m026/m042 |
| `production_order.edit_shipment` | ✅ | ✅ | — | ✅ | ✅ | ❌ | — | m026/m042 |
| `production_order.set_timeline` | ✅ | ✅ | — | ✅ | ✅ | ❌ | — | m026/m042 |
| `production_order.start_without_deposit` | ✅ | ✅ | — | ❌ | ❌ | ❌ | — | m026/m042 |
| `production_order.archive` | ✅ | ✅ | — | ❌ | ❌ | ❌ | — | m026/m042 |
| `production_order.delete` | ✅ | ❌ | — | ❌ | ❌ | ❌ | — | m026/m042 |

> `production_order.unlock_baseline` est **déclaré** dans le code (`permissions.ts`) mais l'action serveur + le RPC sont **absents** — bouton « Unlock baseline » désactivé. **Non implémenté (TO BE VALIDATED).**

### Forecast / Prospects / Finance / Pricing
| Capability | SA | admin | Dir | TLM | Ops | sales | Fin | Source |
|---|---|---|---|---|---|---|---|---|
| `forecast.view_global` | ✅ | ✅ | TBV | ❌ | ❌ | ❌ | — | m053 |
| `prospect.access` | ✅ | ✅ | ✅ | **❌** | **❌** | ✅ | **❌** | m104 |
| `finance.view` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | m119 |
| `pricing.manage` | ✅ | ✅ | — | — | — | — | — | m122 (admin floor) |
| `pricing.manage_costs` | ✅ | ✅ | — | — | — | — | ✅ | m122 |

### Service Request (`project.*`)
Source : m090 (base) + m091 (refinement). Valeurs rapportées par l'analyse de code :
| Capability | Qui l'a (par défaut) |
|---|---|
| `project.create` | sales, sales_director, admin, super_admin |
| `project.approve` | sales_director, admin, super_admin |
| `project.enter_cost` | operations, task_list_manager, finance, admin, super_admin |
| `project.enter_logistics` | operations, task_list_manager, admin, super_admin |
| `project.set_pricing` | sales_director, admin, super_admin |
| `project.generate_quotation` | sales, sales_director, admin, super_admin |
| `project.view_cost` | **PAS sales** (operations/finance/director/admin/super) — coût RMB caché aux Sales |
| `project.override_cost` | sales_director, admin, super_admin (raison obligatoire, audité) |

> Les valeurs exactes par rôle pour `project.*` sont à confirmer ligne par ligne (`TO BE VALIDATED` — issues de m090:89-130 + m091:179-195 ; le coût caché aux Sales est **doublement** garanti : capability `project.view_cost=false` **+** RLS role-only sur `factory_cost_requests`, m091).

### Admin
| Capability | SA | admin | autres | Source |
|---|---|---|---|---|
| `admin.manage_permissions` | ✅ | ❌ | ❌ | m026 (⇒ **super_admin only** en pratique) |
| `admin.manage_users` | ✅ | ❌ | ❌ | m026 (⇒ **super_admin only**) |
| `admin.diagnostics` | ✅ | TBV | ❌ | m033 |
| `admin.manage_products` | ✅ | ✅ | — | m122 |
| `admin.manage_categories` | ✅ | ✅ | — | m122 |
| `admin.manage_banks` | ✅ | ✅ | — | m122 |
| `admin.manage_sales_conditions` | ✅ | ✅ | — | m122 |

> **Important** : la **matrice elle-même** (`role_permissions`) est en **écriture super_admin only** au niveau RLS (m026:91-106), quelle que soit la valeur de `admin.manage_permissions`. Donc même si on accordait `admin.manage_permissions` à un admin, il ne pourrait pas écrire la table. C'est l'origine de la ligne « DENY admin » sur `/permissions/actions` dans la matrice de routes.

---

## 4. Matrice d'accès aux routes [V — HANDOVER]

`OK` = page atteignable (la **donnée** reste filtrée par RLS). Source : `docs/HANDOVER.md:93-101` (vérifié par la suite `e2e/audit/regression.ts`, 23/23).

| Route | sales | dir | tlm | ops | finance | admin | super |
|---|---|---|---|---|---|---|---|
| `/dashboard` `/business` `/forecast` `/clients` `/projects` `/task-lists` `/operations` | OK | OK | OK | OK | OK | OK | OK |
| `/prospects` `/prospects/pipeline` | OK | OK | **DENY** | **DENY** | **DENY** | OK | OK |
| `/finance` | **DENY** | OK | **DENY** | **DENY** | OK | OK | OK |
| `/cost-entry` | DENY | DENY | DENY | DENY | OK | OK | OK |
| `/admin/products,categories,components,banks,sales-conditions,notifications,pricing` | DENY | DENY | DENY | DENY | DENY | OK | OK |
| `/admin/users`, `/permissions/actions`, `/admin/diagnostics` | DENY | DENY | DENY | DENY | DENY | **DENY** | **OK (super_admin only)** |

> `/business` et `/forecast` sont **personnels** par défaut (« my deals only ») → vides pour les rôles techniques (ce n'est **pas** une fuite). Le forecast global nécessite `forecast.view_global`.

---

## 5. Visibilité des lignes (RLS) — résumé par table

Deux moteurs coexistent : (a) les **policies RLS** PostgreSQL (autoritatives en base), (b) le **moteur applicatif** `getVisibilityScope` (`lib/visibility.ts`) qui filtre les requêtes des pages liste.

### Moteur applicatif (`lib/visibility.ts:64`)
Scope = UNION des `access_grants` (m067) du user : `all` / `self` / `team` / `region` / `lens(production|finance|logistics)`. **Fallback sans grant** (`:99-104`) : `isTechnicalRole` **OU** `canSupervise(sales_director)` → `all` (fix F1) ; sinon **own-only** (`ownerIds = {userId}`).

### Policies RLS clés
| Table | Lecture (SELECT) | Source |
|---|---|---|
| `user_roles` | **sa propre ligne uniquement** (« roles self ») | schema.sql:159 |
| `clients` | `created_by` OU `sales_owner_id` OU rôle technique OU « a créé un doc pour ce client » OU **manager d'équipe** ; **+ finance** (read) ; **+ sales_director** (org-wide) | m058 → m105 → m119 → **m132** |
| `affairs` | owner/créateur OU technique OU (doc du projet à moi) OU (client à moi) OU manager d'équipe ; + sales_director | m076 → m105 → m132 |
| `contacts` | **héritée du client parent** (visible si le client l'est) | m101 |
| `documents` | `created_by` OU admin/tlm/operations/super ; DELETE resserré par statut (m078) ; + finance/sales_director | m046 → m078 → m119/m132 |
| `production_orders` | technique ; + finance (read m119) ; + sales_director (m132) | m018 → m119 → m132 |
| `factory_cost_requests` | **role-only** (Sales propriétaire **exclu** — coût RMB caché) | m091 |
| `role_permissions` / `permissions` | lecture = tout authentifié ; **écriture = super_admin only** | m026 |
| `tenders` | `owner_id`/`created_by` (sales) ; full pour admin/tlm/operations/sales_director | m108 |
| `events` | scopée par entité (le user voit les events des entités qu'il peut voir) ; project_request/affair branches ajoutées | m046/m092/m103 |

> **Permissive OR** : PostgreSQL combine les policies PERMISSIVE par OU logique → les migrations additives (m119 finance, m132 sales_director) **n'ajoutent** que des droits, ne **restreignent** jamais (`m132:14-16`).

---

## 6. Assignation des rôles & comptes

- **Assignation de rôle** : RPC `admin_set_user_role(user_id, role)` — **super_admin only** (gate `42501`), accepte les rôles stockables, **refuse l'auto-édition** (`m042`, étendu m029→m042 pour les rôles ultérieurs). UI : `/admin/users`.
- **Promotion super_admin** : `admin_toggle_super_admin` (garde le `role='admin'`, flip le flag).
- **`user_profiles` (display_name)** : **écriture admin-only** — un utilisateur **ne peut pas** éditer son propre nom d'affichage (RLS 42501). [V]
- **Comptes sans rôle** : un user sans ligne `user_roles` obtient un shell par défaut dégradé (`<NoRoleNotice/>`, S1.5). `getCurrentUserRole` renvoie `role=null` → fail-closed sur toutes les capabilities.

---

## 7. Vulnérabilité historique (résolue) & points à valider

- **Priv-esc TLM (résolu, 2026-06-20)** : la matrice live avait `task_list_manager × admin.manage_permissions = true` + `admin.manage_users = true` (cases cochées à la main, vs défaut m026 `false`) → un vrai TLM pouvait ouvrir/éditer la matrice. **Corrigé** (cases décochées) ; un vrai `testlm@` est désormais refusé sur `/permissions/actions` + `/admin/users`. Leçon : la **matrice live peut diverger du seed** — toute affirmation « tel rôle ne peut pas » doit idéalement être vérifiée sur la matrice en base, pas seulement sur m026.
- **TO BE VALIDATED** :
  - `quotation.create` pour `sales_director` : dépend de l'état réel de `role_permissions` en base (pas de migration dédiée trouvée).
  - `admin.diagnostics` pour `admin` : par défaut super_admin only (m033) ; à confirmer.
  - Réassignation d'owner par `sales_director` : autorisée serveur (`canSupervise`) mais cachée UI (`isTechnicalRole`) — incohérence à trancher.
  - `production_order.unlock_baseline` : capability déclarée, action non implémentée.
  - Valeurs `project.*` exactes par rôle : confirmer sur la matrice live.

> **Règle d'or pour ce document** : la matrice ci-dessus reflète le **seed des migrations** (l'intention). La **vérité opérationnelle** est l'état de `role_permissions` en base, qu'un super_admin peut modifier à tout moment via `/permissions/actions`. Toujours recouper avec la base pour une décision de sécurité.
</content>
