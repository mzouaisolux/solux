# QA Campaign — 12 campagnes · 2026-07-22

**Périmètre :** plan de test propriétaire (12 campagnes) sur le workflow Draft → Pre-Validation → Final Validation, les permissions, les révisions, le Lighting Setup, la configuration de coût des SR, la régression et les cas limites.
**Branche :** `packing-module/phase1` @ `22499d5` · **Base :** Supabase local Docker (m176→m181 toutes appliquées).
**Méthode :** sondes runtime avec vrais logins (Playwright), SQL brut en transactions annulées, audit de code assertion par assertion.
**Aucun code applicatif n'a été modifié. Aucune donnée n'a été mutée** (tous les tests destructifs en `BEGIN … ROLLBACK`).

---

## 1. Verdict exécutif

Le socle livré cette session (m176→m181) **fonctionne dans ses chemins nominaux** : 797/797 tests unitaires, 23/23 e2e de régression, `check:capabilities` PASS, gel testé rejetant 7 écritures sur 8, lignage de révisions réel et diffable.

Trois problèmes dominent tout le reste :

1. **🔴 Le gel Final Validation est contournable de 4 façons indépendantes**, dont une par un simple clic dans l'UI. Sa promesse centrale n'est pas tenue.
2. **🔴 Deux fonctionnalités livrées sont cassées ou inertes en production** : la programmation par ligne (m180) échoue à chaque écriture, et la terminologie (m177) n'est branchée sur rien.
3. **🔴 Une grande partie du plan de test décrit des fonctionnalités qui n'existent pas** — pas des bugs. Notamment tout le modèle de permissions par département.

**L'action à plus fort effet de levier reste l'application de m178 + m179 en cloud** : elle installe le gel, débloque les révisions, et répare la cause racine de S1 et S2 ci-dessous.

---

## 2. Ce qui a été réellement exécuté (avec preuve)

| Test | Résultat |
|---|---|
| `npm test` | **797/797 PASS** (2,3 s) |
| `npm run e2e:regression` (vrais logins, 5 rôles) | **23/23 PASS** |
| `npm run check:capabilities` | **PASS** — 52 catalogués / 52 utilisés / 0 orphelin |
| Sondes runtime par rôle sur 2 task lists (`e2e/audit/qa-campaign-0722.tmp.ts`) | 6 rôles × 4 pages, lecture seule |
| Tests de gel en SQL brut | 12 tests, transactions annulées |

Sonde d'accès aux nouvelles pages admin — **conforme** :

| Rôle | `/admin/terminology` | `/admin/lighting-rules` |
|---|---|---|
| sales, dir, operation, finance | DENY | DENY |
| tlm, admin | OK | OK |

Sonde d'éditabilité (nombre de contrôles actifs dans le DOM) :

| Rôle | Pre-Validation | Final Validation (gelée) |
|---|---|---|
| `sales` | **404** | **404** |
| `finance` | **404** | **404** |
| `dir` | 8 · `Save header` | 8 · `Save header` |
| `operation` | **52** · `Save lighting setup`, `+ Add optic`, `✨Re-analyze` | **42** · idem |
| `tlm` | 62 · contrôles complets | **60** · `Save · Order only`, `Delete` |
| `admin` | 62 | **60** · `Save · Order only`, `Save · For client` |

---

## 3. Findings classés

### 🔴 P0-1 — Le gel Final Validation (m179) est contournable de 4 façons

La politique RLS `tasks update` / `tasks delete` autorise **le commercial créateur du devis** (`d.created_by = auth.uid()`) ainsi que `admin` / `task_list_manager` / `operations`. Aucun de ces contournements ne demande de compte privilégié.

| # | Trou | Preuve | Exploitable par |
|---|---|---|---|
| 1 | **DELETE de la task list gelée.** `tl_freeze_guard` ne se déclenche que sur `UPDATE` ; aucun trigger DELETE sur `production_task_lists` | `DELETE … WHERE number='PTL-SLX-AES-26-003'` (validated Rev B) → `(1 rows) DELETE` | commercial créateur, admin — **et le bouton `Delete` est affiché au TLM/admin dans l'UI** |
| 2 | **UPDATE avec changement de statut dans la même requête.** Le trigger s'auto-désactive via `and new.status = old.status` (`179_task_list_revisions_freeze.sql:85`) | `SET status='under_validation', production_notes='BYPASS PROOF', solar_panel_tilt_angle=99` → **passe**, tilt réellement écrit à 99 | sales créateur, TLM, operations, admin |
| 3 | **Réécriture directe des snapshots.** RLS `tl revisions write` = `ALL` to `authenticated`, aucun trigger sur `task_list_revisions` | `pg_policies` | **tout utilisateur connecté** |
| 4 | **Documents non gelés.** 0 trigger sur `attachments`, aucune garde dans `_actions/attachments.ts` | `information_schema.triggers` = 0 | tout utilisateur ayant accès à l'affaire |

> ✅ **CORRIGÉ** — trous 1/2/3 par **m182**, trou 4 par **m183** (gel ciblé sur les pièces jointes nommées dans un snapshot de révision finalisé). 16 tests SQL au total, dont 5 non-régressions. Voir §6.

`task_list_revisions`, `production_task_list_lines`, `task_list_action_items` et `production_orders` sont tous en **`ON DELETE CASCADE`** : le trou #1 détruit donc aussi toute la piste d'audit censée prouver ce qui avait été validé.

**Ce que le gel protège correctement** (7 tests) : UPDATE de colonne non-workflow, INSERT/UPDATE/DELETE de ligne, `risk_flags`, `product_lighting_setups` du même command — tous rejetés avec le bon message. `UPDATE status` seul et écriture sur liste non gelée : autorisés (témoin OK).

**En outre**, 5 actions mutant des lignes n'ont **aucun** `assertNotFrozen` : `updateTaskListLineFactoryOverrides` (`actions.ts:814`), `updateTaskListLineTechnical` (`:853`), `setLineFieldOverride` (`:2086`), `setLineExtraOverride` (`:2121`), `updateTaskListLineFactoryExtras` (`:2167`). Et `saveProductLightingSetup` (`lighting/actions.ts:466`) ne s'appuie que sur le trigger. `setTaskListStatus` (`:1594`) n'a pas de garde non plus et, à cause du trou #2, peut déplacer une liste gelée n'importe où — même avec m179 appliquée.

### 🔴 P0-2 — La programmation par ligne (m180) est cassée en production

`app/(app)/task-lists/[id]/line-lighting.ts:87-92` sélectionne `current_rev`, colonne apportée par **m179 — non appliquée en cloud**. L'erreur est **ignorée** (`const { data: tl }` sans `error`) : le select échoue en 42703, `tl` vaut `null`, et la fonction lève **« Task list not found. »**

Huit lignes plus haut, `:84` applique pourtant correctement le pattern défensif pour la colonne `lighting`. La même fonction honore le contrat pour une migration et l'oublie pour l'autre.

m180 **est** appliquée en cloud → le panneau s'affiche et paraît fonctionnel, mais les 5 actions serveur (`saveLineLighting`, `confirmLineLighting`, `autoPopulateLineLighting`, `setLineLightingMode`, `applyLightingToEligibleLines`) échouent toutes, avec un message qui accuse le mauvais problème.

### 🔴 P0-3 — En cloud, une task list `validated` est un cul-de-sac permanent

`openControlledRevision` (`actions.ts:1561`, `allowedFrom: ["validated","production_ready"]`) appelle `openRevisionRecord`, qui lève *« Revisions table missing — apply migration m179 »*. Et m179 a délibérément fermé les échappatoires : `requestRevision` (`:1360`) et `requestRevisionWithReason` sont désormais `allowedFrom: ["under_validation"]` **seulement**.

Donc en production, depuis `validated`, il n'existe **aucun chemin de retour vers un état éditable**. L'UI propose toujours « Request revision » ; le serveur refuse.

Corollaire (**S4**) : `recordValidationRevision` renvoie `null` sur erreur et `validateTaskList` continue — chaque Final Validation en cloud aujourd'hui produit **aucun snapshot et aucun label Rev**, silencieusement.

### 🔴 P0-4 — m177 (terminologie) n'est branchée sur rien

Vérifié : les seuls fichiers référençant `lib/terminology*` sont **les trois fichiers eux-mêmes**. `lib/terminology-server.ts` et `lib/terminology-client.ts` ne sont importés par aucun composant ni aucune page hors de l'admin.

m177 a donc livré une table, un admin et un catalogue de 130 termes que **rien ne rend**. Le dossier PDF et tous les exports utilisent toujours des chaînes codées en dur (352 caractères CJK dans `ProductionDossierPDF.tsx`, 177 dans `production-dossier.ts`).

> ⚠️ **Correction de documentation :** la ligne §4.2 du handover (`lib/production-dossier.ts — Enum title dicts removed (moved to terminology)`) est **fausse pour cette branche**. Les trois dictionnaires sont toujours exportés et consommés (6 références). C'est le §8 P2 qui est exact.

### 🟠 P1-1 — L'export usine perd toute la configuration des lignes issues d'un SR

`exportData.ts:220` ne sélectionne **pas** la colonne `category_id` de la ligne (m133) — seulement `products(category_id)`. Or `:575` résout `const cid = l.products?.category_id ?? ""`.

Une ligne générée depuis un Service Request a `product_id = null` et sa catégorie **sur la ligne** → `cid = ""` → `salesDefs = []` → le dossier PDF et l'Excel « Factory Task List » impriment **zéro ligne de configuration** pour exactement les lignes que m181 était censé enrichir.

Même cause racine : la résolution des règles de programmation **diverge entre l'écran et l'export** (`exportData.ts:707` lit `l.category_id` toujours `undefined`, alors que `page.tsx:144` le sélectionne bien). Une règle famille `not_applicable` affiche « N/A » à l'écran pendant que le dossier applique le défaut `optional` et imprime la programmation.

### 🟠 P1-2 — m181 désactive le backfill OBS-1 (régression introduite cette session)

`app/(app)/documents/[id]/actions.ts:424-431` : `needy = isEmptyConfig(cfg) || !fields.some(f => cfg[f.field_name])`. m181 écrit désormais de vrais `field_name` sur la ligne de devis → `needy` devient `false` → `buildSrConfigValues` est **sauté** au Launch Production.

Conséquence : remplir **une seule** option produit dans le SR suffit pour que `led_power` / `solar_panel_size` / `battery_spec` / `controller` ne soient plus normalisés vers les valeurs d'options de la catégorie. Le résolveur de factory-mapping ne peut plus s'y accrocher, et `countMissingMappings` ne le voit pas (il ignore les valeurs vides).

### 🟠 P1-3 — Les lignes « optional » sont peintes en rouge « ❌ Missing programming »

`lib/lighting/line-setup.ts:273` :
```ts
if (!hasProgrammingContent(setup)) return "missing"; // for optional: renders as "—", never gates
```
Le commentaire décrit une intention que le code n'implémente pas. Avec `DEFAULT_OUTCOME = "optional"` et une seule règle existante, **chaque ligne** affiche une pastille rouge bloquante que le gate ignore correctement. **L'UI contredit le serveur** — et toute exécution du plan sur les données actuelles sera noyée sous du faux rouge.

### 🟠 P1-4 — Operations n'est pas en lecture seule ; l'UI ment sur les listes gelées

`isTechnicalRole` traite `operations` exactement comme le TLM : édition complète du lighting setup, ré-analyse IA, ajout d'action items, bouton Reject. Le plan le veut read-only.

Et en Final Validation, la bannière de gel s'affiche bien mais **les champs et les boutons `Save` ne sont ni masqués ni désactivés** (60 contrôles actifs pour le TLM). Les écritures échoueront — sauf `Delete`, où rien ne rattrape. C'est bien plus large que le P3 du handover (« masquer *Bounce back to sales* ») : c'est toute la surface d'édition.

### 🟡 P2 — Autres défauts confirmés

| Réf | Défaut |
|---|---|
| D1 | L'éditeur de ligne ouvert ne se resynchronise pas après une action serveur (`LineLightingPanel.tsx:197`, pas de `key`) → après « Import updated study values », un Save réécrit les **anciennes** valeurs par-dessus l'étude fraîchement importée |
| D2 | `autoPopulateLineLighting` rebascule une ligne Manual en Automatic **sans** le `confirm=1` que `setLineLightingMode` exige |
| 12.8 | `nextRevLabel` est **basé sur un comptage**, pas sur le max → un trou ou un doublon collisionne avec `unique(task_list_id, rev)`, et l'erreur d'insert est avalée → validation sans snapshot |
| 12.7 | Aucune concurrence optimiste sur les blobs jsonb : deux utilisateurs sur **la même ligne** = last-write-wins (le perdant ne survit que dans `history`) |
| 12.1 | `app/(app)/projects/new/page.tsx:69-73` : `config_field_options` fetché **app-wide, non scopé, non paginé** — l'anti-pattern déjà documenté ailleurs. Au-delà du row-cap PostgREST, les listes déroulantes du SR perdent silencieusement des options |
| bug 3 | Remplacer une étude énergétique **re-persiste l'ancienne extraction IA** (`ProductLightingSetupForm.tsx:228` ne vide jamais `aiProvenance`) → l'étude B s'affiche avec les valeurs de A |
| bug 4 | Le fallback m181 de `updateProjectRequest` perd le garde-fou `draft` (`projects/actions.ts:393-398`) → peut écraser un SR non-draft |
| bug 7 | Pollution inter-familles : le blob `config_values` du SR est sérialisé **non filtré** par catégorie |
| 12.2 | Remplacer un PDF n'efface jamais l'objet Storage précédent → orphelins |
| S6 | `current_rev` n'est jamais lu là où ça compte (absent du select principal de `page.tsx`) — colonne write-only côté app |

---

## 4. Fonctionnalités que le plan suppose et qui n'existent pas

Ce ne sont **pas des bugs**. Ce sont des écarts entre le plan et le produit.

| Réf plan | Réalité |
|---|---|
| **Campagne 2 entière** | **Aucun modèle de permission par section ni par département.** L'éditabilité est **un seul booléen** appliqué à toutes les sections. Les rôles `factory` / `engineer` / `study_lab` **n'existent pas** — ce sont des métadonnées d'action items. Rôles réels : `sales, sales_director, task_list_manager, operations, finance, admin` |
| **1.1** « Sales crée une Task List » | Impossible : `sales` reçoit un **404** sur une task list. Elles naissent de `launchProduction` sur un devis WON rattaché à une affaire |
| **2.1** bouton « Start Pre-Validation » | S'appelle **« Submit for production validation → »**, visible **pour tous les rôles**, et l'action serveur `submitForValidation` n'a **aucune garde de capability** |
| **2.3** « tout reste modifiable en Pre-Validation » | Vrai pour les rôles techniques seulement. Pour `sales`, **rien** n'est éditable en Pre-Validation |
| **3.1** Pending Issues auto-détectées | **Aucune détection automatique.** C'est une liste de tâches saisies à la main |
| **3.2** « Missing Required Information » | **Cette section n'existe pas.** `GPS` et `lighting class` : **0 occurrence dans tout le dépôt** |
| **3.3** 6 champs en AI Review | **2 sur 6** : tilt ✓, operating profile ✓ (+ lighting power, non demandé). Mounting height et CCT extraits mais jamais affichés. **Battery et PV ne sont extraits nulle part.** Les 3 *états* sont en revanche corrects |
| **3.4** Warnings (étude ancienne, autonomie, classe) | Warnings = **6 drapeaux de risque cochés à la main**. Aucun des trois |
| **3.5** blocage sur devis/document manquant | Le gate ne regarde **jamais** les documents. 8 raisons hiérarchisées, aucune documentaire. Et le board annonce `requiredEmptyCount` comme bloquant alors que `evaluateRelease` l'ignore |
| **5.1 / 5.2** « 1 setup par produit », « 3 familles = 3 setups » | Mauvaise granularité. **Une seule étude par command** (`document_id` UNIQUE) + un blob optionnel **par ligne de task list**. Rien n'est indexé par produit ni par famille. Et **aucun setup n'est créé automatiquement** |
| **5.4** « changer un modèle → recalcul » | On **ne peut pas changer le produit d'une ligne** depuis la task list. L'admin ne peut pas non plus créer de règle par produit, ni éditer une règle existante |
| **6.1** 5 champs auto-remplis | **3 sur 5.** Tilt ❌ (il vit sur la task list, pas la ligne), autonomie ❌ (jamais extraite) |
| **8.1** notification d'étude plus récente | **Pas de notification** — une pastille calculée au rendu. Aucun `emitEvent` |
| **8.2** comparaison avant/après | **Pas de comparaison côte à côte.** L'import est une boîte de dialogue sur des valeurs invisibles |
| **7.3** historique + auteur | Écrits mais **sans aucune UI**, et l'auteur reste un UUID non résolu |
| **10.1 / 10.2** SR multi-produits | **Un seul *famille* par SR**, un seul blob `config_values`, deux lignes de devis générées. Les variantes IoT sont des produits, inatteignables depuis un SR. Un `checkbox_group` est rendu en **select mono-choix** et stocké en scalaire — encodage **incompatible** avec le moteur de devis |
| **10.3** plusieurs mâts configurés séparément | **Un seul `pole_spec` par SR** ; `pole_quantity` est un simple nombre. Le vocabulaire C3/C4/C5(+C5M), galvanisation, peinture, couleur RAL est en revanche complet et bien persisté |
| **12.3** supprimer une étude IA | Aucun contrôle de suppression — **Replace uniquement** |
| **12.5** Pre-Validation → Draft | **Cette transition n'existe pas** |
| **12.6** détection après plusieurs jours | Détection = « une extraction plus récente existe », **pas** l'âge calendaire. Revenir après N jours n'affiche rien si personne n'a relancé l'IA |
| **12.9** URL directe vers une révision validée | **Aucune route par révision.** Le contenu du snapshot n'est jamais affiché (la page le met à `null`) — Rev A n'est consultable qu'en métadonnées |

---

## 5. Ce qui est conforme

- Transition horodatée + auteur + historique complet ✅
- Board absent en Draft ✅
- Ownership des action items : personne + département + statut + échéance ✅
- Gate de release à 8 raisons hiérarchisées, source unique `evaluateRelease` ✅
- Rev A/B : raison obligatoire ≥5 caractères, auteur, date, supersede sans suppression ✅
- Diff Rev B vs Rev A champ par champ, jusqu'à 6 niveaux de profondeur ✅
- Apply-to-all = **vraie copie profonde** ; modifier A ne touche pas B/C/D ✅
- Aucun écrasement automatique, y compris le conflit de tilt (m176) qui flague ✅
- Manual → Automatic : warning + garde serveur + archivage de l'état sortant ✅
- Le blob `lighting` par ligne est dans le snapshot m179, diffé et gelé ✅
- `lighting_freeze_guard` est strict : une seule liste validée verrouille l'étude du command pour tous ✅
- `evaluateRelease` dégrade proprement sur base pré-m178/m179 (`?? 0` partout) ✅
- Vocabulaire pole finish complet et persisté ✅
- Matrice de permissions historique intacte : 23/23 e2e ✅

---

## 6. Remédiation — LIVRÉE (local uniquement, cloud en attente)

### Migration `m182` — colmatage du gel (appliquée en local, prouvée 10/10)
1. ✅ `DELETE` ajouté au `tl_freeze_guard` + trigger `BEFORE DELETE`, scopé aux rôles PostgREST pour ne pas casser le Force Delete m169 (SECURITY DEFINER).
2. ✅ Condition `new.status = old.status` supprimée — elle était **redondante** (la liste blanche `allowed` tolère déjà les transitions) et **nocive**.
3. ✅ `tl_revision_freeze_guard` : snapshots immuables dès `validated`/`superseded`. RLS **délibérément non touchée** (la resserrer risquait de casser lectures et écritures légitimes) ; le trigger donne l'immuabilité exacte à la colonne près.

### Migration `m183` — gel des pièces jointes (appliquée en local, prouvée 6/6)
4. ✅ Résolu **sans changement de schéma**, en utilisant un lien qui existait déjà : le snapshot m179 enregistre `id`/`file_name`/`storage_path` des pièces jointes de la version validée. Une pièce jointe est gelée **si et seulement si** un snapshot finalisé la nomme.
   - documents ajoutés **après** la validation → libres
   - `folder` / note / visibilité / `doc_status` → toujours éditables (la catégorisation DnD m164 continue de marcher)
   - « Replace » crée déjà une **nouvelle ligne** (`group_id`+`version`, m151) → inchangé, et le fichier validé reste récupérable
   - suppression ou échange du fichier en place → refusés
   - Écarté : geler par `affair_id` aurait verrouillé tout l'espace documentaire de l'affaire (mesuré : les affaires mélangent `customer`, `technical`, `certifications`, `energy_studies`).

### Correctifs applicatifs
5. `assertNotFrozen()` dans `deleteTaskList`, `setTaskListStatus` et les 5 actions mutant des lignes ; garde applicative dans `saveProductLightingSetup`.
6. Rendre `line-lighting.ts:89` défensif sur `current_rev` (**répare la production sans attendre m179**).
7. Ajouter `category_id` au select de `exportData.ts:220` (répare P1-1 et la divergence écran/export).
8. Corriger le `needy` de `documents/[id]/actions.ts:424` (répare P1-2).
9. `lineLightingStatus` : renvoyer un statut neutre pour `optional` (répare P1-3).
10. Masquer/désactiver les contrôles d'édition et le bouton `Delete` sur liste gelée.
11. `key` sur `LineEditor` pour resynchroniser après action serveur (répare D1).

### Priorité opérationnelle
**Appliquer m178 + m179 en cloud d'abord** : cela installe le gel, débloque les révisions, et supprime la cause racine de P0-2 et P0-3.

---

## 7. Rejouer la campagne

```bash
cd ~/dev/facturation
npm test                     # 797 tests purs
npm run check:capabilities
npm run e2e:regression       # vrais logins, 5 rôles
node --env-file=.env.e2e --experimental-strip-types e2e/audit/qa-campaign-0722.tmp.ts
```

Le script de sonde est en lecture seule. Les tests de gel en SQL brut sont dans l'historique de session (transactions annulées) — les rejouer via un client `pg` sur `127.0.0.1:54322`.

**Pièges :** ne jamais tester le gel contre le cloud (m179 absente) · vider le cookie **View-As** avant toute conclusion sur les permissions (il donne un JWT admin) · ne pas lancer `npm run build` pendant que `next dev` tourne.
