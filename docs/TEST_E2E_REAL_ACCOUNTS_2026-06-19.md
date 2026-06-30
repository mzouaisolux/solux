# VALIDATION E2E COMPLÈTE — COMPTES MÉTIER RÉELS
## Workflow Sales → TLM → Production · 2026-06-19

> **Protocole strict (exigé par le propriétaire) :** connexion réelle avec les comptes
> métier. **Aucun compte Admin. Aucun Preview Role. Aucun bypass.** Toutes les
> validations via l'UI réelle, captures à chaque étape critique.
>
> - **SALES** : `testsales@solux-light.com` (badge `SALES`, rôle réel `sales`)
> - **TASK LIST MANAGER** : `testtlm@solux-light.com` (rôle réel `task_list_manager`)
>
> Contexte : l'incident AFRICA ENERGY a montré qu'un test fait en Admin/Preview
> masque le comportement réel (le P0 de visibilité TLM n'apparaissait qu'avec un
> compte restreint réel). D'où cette campagne 100 % comptes réels.

> ⚠️ **MISE AU POINT MÉTHODOLOGIQUE (2026-06-20).** En cours de route on a découvert
> que la session avait été contaminée par le compte super_admin `mzouai@` ouvert
> dans **un autre onglet** (cookie Supabase partagé entre onglets → la session de
> tous les onglets bascule sur le dernier login). Le compte TLM réel s'appelle
> **`testlm@`** (un seul *t*, pas `testtlm@`). **Méthode durcie depuis :** à chaque
> bascule, vrai Sign out / Sign in **+ litmus test serveur** (un compte restreint
> doit être *refusé* sur `/permissions/actions`). Les résultats ci-dessous notés
> « ✅ vrai login » ont passé ce litmus ; les autres sont à re-confirmer.
> Voir l'entrée mémoire `view-as-invalidates-real-account-test`.

---

## OBJETS DE TEST CRÉÉS (traçabilité)

| Objet | Nom / Numéro | ID | Créé par |
|---|---|---|---|
| Client | `ZZZ_E2E_FULL_WORKFLOW` (code **ZEF**) | `3598e2f5-b2ca-41f1-a10b-58822f8b1fe4` | SALES |
| Affaire | `ZZZ_E2E_PROJECT_001` | `15c00d08-e96e-4f72-8a25-0069b5f01576` | SALES |
| Service Request | (description + contraintes + commentaires) | `c11fc871-dc5f-43c5-a8dd-d33de0bcaf40` | SALES |
| Devis | `SLX-ZEF-26-001` | `45365aea-ddbd-4abf-a916-b145b0dfc608` | SALES |
| Task List | `PTL-SLX-ZEF-26-002` | `c1bde5e2-821c-4cb9-92a8-f2a656024251` | SALES |

---

## BLOC SALES — RÉSULTATS (Phases 1 → 5)

### PHASE 1 — Création client `ZZZ_E2E_FULL_WORKFLOW` — ✅ PASS
- **Rôle connecté :** SALES (`testsales@solux-light.com`) — vérifié à l'écran (email + badge `SALES`, pas de bandeau Preview).
- **URL :** `/clients` → panneau "New client".
- **Action :** création avec code client **ZEF** (champ obligatoire respecté — cf. correctif bug #8).
- **Attendu :** client créé, visible dans la liste, code 3 lettres.
- **Observé :** client `ZZZ_E2E_FULL_WORKFLOW (ZEF)` créé, id `3598e2f5-…`. ✅

### PHASE 2 — Création affaire `ZZZ_E2E_PROJECT_001` — ✅ PASS
- **Rôle :** SALES. **URL :** fiche client → onglet Affaires.
- **Attendu :** affaire rattachée au client, statut initial.
- **Observé :** affaire créée, id `15c00d08-…`, rattachée à `ZEF`. ✅

### PHASE 3 — Service Request (ex « Project Request ») — ✅ PASS
- **Rôle :** SALES. **URL :** `/projects` (nouvelle demande de service).
- **Action :** description + contraintes + commentaires renseignés (champ ADDITIONAL NOTES), rattachement à l'affaire existante.
- **Attendu :** demande créée, liée à l'affaire, journal d'activité alimenté.
- **Observé :** Service Request id `c11fc871-…` créé, ADDITIONAL NOTES + ACTIVITY log présents. ✅

### PHASE 4 — Devis complet `SLX-ZEF-26-001` — ✅ PASS
- **Rôle :** SALES. **URL :** création devis depuis l'affaire.
- **Action :** ajout produit **AOSPRO+100**, prix auto **317,78** (liste « MANUEL TEST (AOSPRO +) »), **qté 10 → total 3 177,80**, configuration : **CCT 2200k / OPTIC T1 / Battery 230Wh / SOLAR PANEL 18V/60W / Spigot Ø 60mm**.
  - Configuration choisie volontairement **identique au mapping usine existant d'AOS PRO+** pour que la validation TLM (Phase 8) puisse aboutir sans mapping manquant.
- **Attendu :** recalcul automatique du total, devis enregistré, numéro auto.
- **Observé :** devis `SLX-ZEF-26-001` id `45365aea-…`, total recalculé correctement. ✅

### PHASE 5 — Task List depuis le devis + soumission — ✅ PASS
- **Rôle :** SALES. **URL :** `/task-lists/c1bde5e2-821c-4cb9-92a8-f2a656024251`.
- **Observation clé (permission) :** **SALES PEUT cliquer « 🚀 Launch Production »** → génère la Task List `PTL-SLX-ZEF-26-002` (statut **Draft**). (Capacité `quotation.*` côté Sales — à distinguer du passage *en production* des phases 9/16 qui, lui, est réservé.)
- **Action :** notes de production renseignées (`[E2E] NOTES SALES: marquage logo client… BAT à valider avant prod.`), **3 risques cochés** (urgent lead time, special packaging, custom sticker) → "Save header" + "Save risks" = OK.
- **Soumission :** clic **« Submit for production validation → »**.
- **Attendu :** passage `draft → under_validation`, verrouillage des champs Sales, horodatage de soumission, apparition dans la file TLM.
- **Observé :**
  - Badge tête de page → **Under validation** ✅
  - Bandeau **« Submitted for production validation. The production team will pick this up — sales edits are locked until they validate or request revisions. »** ✅
  - **🔒 LOCKED — SUBMITTED FOR VALIDATION** + zone read-only (« Sales fields are locked… ask the production team to send it back for revision ») ✅
  - Horodatage **Submitted for validation 6/19/2026, 11:40:01 PM** ✅
  - Compteur nav **Task Lists 1 → 2** ✅
- **Verdict :** ✅ PASS — handoff vers la production effectué, statut `under_validation` confirmé.

---

## ÉTAT D'AVANCEMENT

| Bloc | Phases | Statut |
|---|---|---|
| **SALES** | 1, 2, 3, 4, 5 | ✅ **5/5 PASS** |
| **TLM (session 1)** | 6, 7-TLM, 8B, 16-TLM | ✅ exécuté (voir ci-dessous) |
| **Sales↔TLM** | 7 (réponses + notifs), 16-Sales | ⏳ handoff Sales requis |
| **TLM (session 2)** | 8, 9, 10, 11, 12, 13, 14 | ⏳ après round-trip Sales |
| **Robustesse / Sécurité** | 15, 16 | 🟡 16 partiel (finding critique) |

---

## BLOC TLM — SESSION 1 (connexion réelle `testlm@solux-light.com`, rôle TLM)

> ⚠️ **Note d'identité :** l'email réel est **`testlm@`** (un seul *t*) — le brief disait `testtlm@`. Propriétaire a confirmé que `testlm@solux-light.com` EST le compte TLM de test (coquille du brief). Rôle badge = **TLM**, ni Admin ni Preview.

### PHASE 6 — Vérification TLM — ✅ PASS
- **Dashboard** : la task list `PTL-SLX-ZEF-26-002` apparaît dans **« Waiting for me »** (« Review task list before production can start · TASK MGR »). ✅
- **File `/task-lists`** : onglets-filtres **All 9 / Draft 2 / Under validation 2 / Needs revision 1 / Validated 4 / Production ready 0 / Cancelled 0** ; bandeau « 2 task lists awaiting your review » ; filtre vendeur (`a5e93040…`). Compteur nav = **3**.
- **Filtre « Under validation »** → URL `?status=under_validation`, **2 lignes** (ZEF + AFRICA ENERGY), USD 3 177,8 conforme. ✅
- **Ouverture** (`Review →`) : fiche complète. Le TLM voit **3 actions que Sales n'avait pas** : **Validate / Request revision / Reject**. ✅ (preuve de séparation des permissions)
- **Lecture / intégrité Sales→TLM** : config (CCT 2200k/OPTIC T1/Battery 230Wh/Panel 18V-60W/Spigot 60mm) ; **Factory instructions** : les 5 lignes résolvent (DEFAULT = mapping global) → **aucune ligne MISSING**, task list validable ; **3 risques** cochés côté Sales présents (Urgent lead time, Special packaging, Custom sticker) ; **Production notes [SALES]** = texte exact saisi en Phase 5. ✅
- **Édition / enrichissement** : contrôles TLM présents (Save Order-only / For-client par champ, + Add factory field, Technical notes [INTERNAL], Stickers & branding, Save line/header). ✅
- **Audit trail** : « Validation history » (Submitted for validation · 19 Jun 26 23:40) + « Activity » (draft→under_validation + header updated) horodatés, auteur = compte Sales `a5e93040…`. ✅
- **Commentaire** : message TLM posté dans la drawer Conversation (SLX-ZEF-26-002), horodaté. ✅

### PHASE 7 (côté TLM) — 3 questions postées — ✅ (réponses Sales en attente)
- Q1 (controller vide / MPPT ?), Q2 (packaging bois ISPM-15 ?), Q3 (date cible mise en prod ?) — postées, persistées, horodatées. Indicateur **💬 3** sur la carte « Waiting for me ».
- ⚠️ **Finding (audit auteur)** : les bulles de conversation **n'affichent aucun nom d'auteur** ; l'avatar (pastille) est **non déterministe** (mêmes messages affichant tantôt « TL » tantôt « YO »). L'attribution repose uniquement sur l'alignement gauche/droite → **gap pour un audit trail « qui a écrit quoi »**. À revérifier côté Sales.

### PHASE 8B — Factory Mapping — ✅ PASS
- **Droits d'accès TLM** : `/factory-mapping` se charge (pas de 403). Stats 132 options / 10 mapped / 122 missing.
- **Création** : option SOLAR PANEL 18V/72W configurée (instruction + code `E2E-PANEL-72W`) → après reload **MAPPED 10→11**, **MISSING 122→121**, ligne passe en [Edit]. ✅
- **Modification** : code modifié → `E2E-PANEL-72W-V2`, persisté après reload. ✅ (+ bouton Delete présent)
- **Réutilisation** : feature « Copy mappings between families » présente et câblée (sélecteurs FROM/TO + bouton) ; **exécution réelle différée** pour ne pas polluer les données (déjà couverte par le test `factory-mapping-clone`).
- 🟡 **Bug UI mineur** : après « Save mapping », la page **ne se rafraîchit pas** (ligne + compteurs figés jusqu'à un reload manuel). Données OK, vue périmée → manque `router.refresh()`/revalidate après l'upsert sur `/factory-mapping`.

---

## 🔴→✅ FINDING CRITIQUE (Phase 16) — Le rôle TASK LIST MANAGER pouvait éditer la matrice — **RÉEL, CORRIGÉ, VÉRIFIÉ**

> **✅ STATUT FINAL (2026-06-20, confirmé par le propriétaire) : finding RÉEL, déjà
> REMÉDIÉ.** La matrice live avait bien `task_list_manager` × `admin.manage_permissions`
> **et** `admin.manage_users` **cochés** (vs défaut m026 = `false`). Le propriétaire a
> **décoché ces 2 cellules** en super_admin (audit « Permissions matrix changed — 2 cells
> changed »). **Vérifié corrigé** : un **VRAI** `testlm@` (litmus passé) est désormais
> **REFUSÉ** sur `/permissions/actions` + `/admin/users` et n'a **plus de menu Admin**.
>
> ⚠️ *Note process :* l'onglet super_admin ouvert pour appliquer le correctif a écrasé
> le cookie Supabase partagé → c'est ce qui a fait basculer l'onglet de test sur
> `mzouai@`. Et j'ai brièvement **rétracté à tort** ce finding en voyant le TLM refusé,
> avant de comprendre (via l'audit + confirmation owner) qu'il venait d'être corrigé.

**Sévérité : CRITIQUE (escalade de privilèges) — désormais corrigée.** Portée : données de CE déploiement (pas un bug de code).

**Constat (compte réel `testlm`, rôle TLM, ni Admin ni Preview) :**
1. Le **menu « Admin »** est visible dans la nav du TLM (entrées : Users / Permissions / Roles & teams).
2. `/admin/users` **s'affiche** (page « User roles ») — données protégées au niveau RPC (`list_users_with_roles: super-admin only`), mais **la page n'est pas gardée** au niveau route/nav (le message d'erreur blâme à tort « migration 027 non appliquée »).
3. `/permissions/actions` (**Permissions matrix**) **s'affiche entièrement et de façon éditable** pour le TLM.

**Root cause :** dans la matrice **live**, la colonne **TASK LIST MANAGER** est **cochée** sur :
- `admin.manage_permissions` (éditer la matrice) — **true**
- `admin.manage_users` (gérer les utilisateurs) — **true**

Or le **défaut seedé** (`supabase/migrations/026_permissions_matrix.sql:203-204`) est **`false`** pour les deux. ⇒ **Ces 2 cellules ont été cochées manuellement en base** (la sauvegarde de la matrice logue un « critical event » → traçable dans l'audit).

**Impact :** le code gate la page ET l'action d'écriture par `requireCapability("admin.manage_permissions")` — gate qui **PASSE** pour le TLM puisqu'il a (à tort) la capacité. Donc **un Task List Manager peut modifier toute la matrice rôles×capacités** (se donner n'importe quelle capacité, dont l'équivalent super-admin). C'est une **escalade de privilèges complète**, et elle s'applique à **tout** compte `task_list_manager`, pas seulement à `testlm`.

**Je n'ai exploité aucun toggle** (modifier des contrôles d'accès est hors de ce que je réalise).

**Remédiation recommandée (à faire par le propriétaire, en super_admin) :**
1. **Immédiat (UI)** : ouvrir Permissions matrix → colonne TASK LIST MANAGER → **décocher** `Manage permissions matrix` + `Manage users` → Save.
2. **Vérifier l'audit** : qui/quand a coché ces cellules (event « permissions matrix changed »).
3. **Optionnel (durable)** : migration corrective idempotente ré-affirmant `false` pour `task_list_manager × {admin.manage_permissions, admin.manage_users}` (+ revue des autres rôles vs m026).
4. **Défense en profondeur** : gater le **menu Admin** et les **pages /admin/*** par capacité (ne pas s'appuyer uniquement sur la protection RPC des données) ; corriger le message d'erreur trompeur de `/admin/users`.

> Cette faille n'a été visible **que** parce qu'on a testé avec un **vrai compte TLM** (Preview/Admin l'auraient masquée) — la méthode est de nouveau validée.

---

> **HANDOFF SALES REQUIS** (Phase 7 réponses + notifications + Phase 16 côté Sales).
> Je ne fais pas les connexions. Le propriétaire doit se reconnecter en Sales.

---

## BLOC SALES — SESSION RÉELLE VÉRIFIÉE (✅ vrai login `testsales@`, litmus passé)

> Litmus à l'ouverture : `/permissions/actions` → **ACCESS DENIED** (`admin.manage_permissions`), en-tête `testsales@` / SALES, **aucun** bouton View As, nav sans Admin/Catalog/Pricing → compte Sales restreint **réel** confirmé (refus côté serveur).

### PHASE 7 — Notifications + ping-pong Sales↔TLM — ✅ PASS (round-trip Sales)
- **Notification reçue** : la cloche Sales signalait **1** mise à jour sur `PTL-SLX-ZEF-26-002` (badge REPLY, « Note [E2E][TLM Q3]… »). ✅
  - 🟡 *Finding* : les **3** questions TLM → **1 seule** notification groupée (dernier message affiché). Q1/Q2 non surfacés individuellement (regroupement par conversation = raisonnable, mais à noter).
- **Conversation visible par Sales** : les 3 questions TLM présentes, **alignées à gauche** (auteur tiers) → attribution par alignement **correcte** (côté TLM elles étaient à droite). ✅
  - 🟡 *Finding (audit auteur)* : l'auteur s'affiche en **ID brut `ad0815a2…`** (avatar « AD »), **pas un nom lisible**. Les avatars sont en plus **instables** (réponses Sales : S / S / YO pour le même auteur).
- **Réponses Sales postées** : A1 (MPPT confirmé), A2 (ISPM-15 obligatoire), A3 (mise en prod < 10 j) — à droite, horodatées, ordre chronologique respecté. ✅
- ⏳ *Reste à vérifier côté TLM* : que le TLM **reçoit la notification** des 3 réponses Sales (autre moitié du round-trip).

### PHASE 16 (côté Sales) — Restrictions — ✅ PASS (refus serveur, vrai compte)
| Test | Résultat |
|---|---|
| `/permissions/actions` | 🔒 ACCESS DENIED — requires `admin.manage_permissions` |
| `/factory-mapping` | 🔒 ACCESS DENIED — requires `factory_mapping.access` |
| Task list `under_validation` | 👁 read-only, **aucun** bouton Validate / Request revision / Reject |
| Nav | pas d'Admin / Catalog / Pricing |

### Statut de validité (post-correction View-As)
- ✅ **Tiennent (vrai login Sales vérifié)** : Phase 7 round-trip Sales, Phase 16 restrictions Sales, ownership Sales de la task list (Sales voit la sienne).
- ✅ **Tient (lu dans la donnée)** : finding critique matrice TLM (cf. plus haut).
- ✅ **Re-confirmé en vrai `testlm@`** (voir bloc ci-dessous) : tout le bloc TLM.

---

## BLOC TLM — SESSION RÉELLE VÉRIFIÉE (✅ vrai login `testlm@`, litmus passé)

> Litmus à l'ouverture : `/admin/users` → **ACCESS DENIED page-level** ; `/permissions/actions` → **ACCESS DENIED** ; **pas de menu Admin**. En-tête `testlm@`/TLM, pas de View As. → vrai TLM restreint confirmé (et c'est ce qui a révélé que le finding matrice avait été corrigé entre-temps).

### PHASE 6 — Visibilité file de validation (le P0 d'origine) — ✅ PASS
- `/task-lists?status=under_validation` (vrai TLM) → **« 2 task lists awaiting your review »** dont `PTL-SLX-ZEF-26-002` (USD 3 177,8) avec [Review →]. Le correctif de visibilité de la file de validation tient **sur un vrai TLM** (pas seulement un super_admin scope.all).

### PHASE 7 (réception côté TLM) — ✅ PASS
- Cloche TLM → notification **PTL-SLX-ZEF-26-002 · REPLY · « Note [E2E][SALES A3]… » · 7M AGO**. Le round-trip de notifications fonctionne dans les **deux sens** (même regroupement : 3 réponses → 1 notif).

### PHASE 8B — Factory Mapping (vrai TLM) — ✅ PASS
- `/factory-mapping` **s'ouvre** (132 / 11 mapped / 121) — le vrai TLM a `factory_mapping.access` (Sales refusé). Le mapping créé (18V/72W, code `E2E-PANEL-72W-V2`) persiste.

### PHASE 8 + 9 — Validate → Production — ✅ PASS
- **Validate →** ouvre le modal **« Release to Production? »** : Factory mapping **Complete**, Revision **None open** → **Release to Production**.
- Résultat : task list validée + **commande de production `PO-SLX-ZEF-26-002`** (id `f3cae29e…`) créée, statut **Awaiting deposit**. Lifecycle : QUOTATION→WON→TASK LIST→VALIDATED→**PRODUCTION**.

### Gate acompte — ✅ PASS
- Acompte de test **953,34 USD** (= 30 % requis) + date 20/06/2026 enregistré → **auto-avancement** `Awaiting deposit → Deposit received` ; Production « Ready to start », START DATE 20/06, **Balance pending** (2 224,46 restant). Le gate fonctionne.

### PHASE 11 — Avancement production — ✅ PASS (par statuts)
- Progression par **chips de statut** (pas un slider %) : → **In production** (badge + LIVE STATUS). *À noter vs le « 10/25/50/75/100 % » du brief : le modèle réel est statut + ETA/working-days.*

### PHASE 10 — Délai — 🟡 PARTIEL
- Statut **→ Production delayed** OK (badges « Production delayed » + « Delayed », alerte **Orders (1)** apparue).
- ⚠️ Le **délai quantifié** (jours/ETA) est **bloqué** : « No baseline yet — set the working days first ». La baseline a activé **sans WORKING DAYS** (le devis n'avait pas de *production time*) → delay-tracking usine inerte. **Finding réel** : sans temps de production au devis, la KPI délai ne peut pas fonctionner.

### PHASE 12 — Production completed — ✅ PASS
- → **Production completed** : badges « Production completed » + **Balance due**, **ACTUAL COMPLETION Jun 20 2026** stampée, shipping déverrouillé (« Waiting booking — book the carrier »), solde 70 % devient dû (conforme aux termes 30/70).

### PHASE 13 — Documents — 🟡 PARTIEL
- ✅ **Génération** : **Commercial Invoice `CI-0002`** générée — PDF réel et complet (en-tête SOLUX, consignee ZZZ_E2E_FULL_WORKFLOW, refs devis/PO, FOB Shanghai, AOSPRO+100 ×10 @ 317,78 = 3 177,80) ouvert en visionneuse (download/print).
- ⚠️ La CI générée est **download-only** (non auto-persistée au hub, slot non coché).
- ⛔ **Upload** de fichiers arbitraires (PDF/Excel/image) + **delete** du hub : **non exerçables via l'automatisation** (l'extension n'upload que des fichiers explicitement partagés par l'utilisateur — limite outil, pas app ; zone d'upload présente, 50 MB, version history). → à confirmer manuellement par l'owner.

### PHASE 15 — Robustesse (solo) — ✅ PASS (partiel)
- **Refresh / re-navigation** : dizaines de reloads + navigations pendant le test → **aucune perte de données** (acompte, statuts, conversation, commande tous persistés). Reload final de l'Overview = état complet conservé.
- **Double onglet** : observé (cookie de session partagé entre onglets — cf. l'incident de contamination).
- ⏳ **Logout/login** : nécessite une vraie reconnexion (à faire par l'owner).

---

## VERDICT FINAL (vrais comptes)

**Chemin critique Sales → TLM → Production validé de bout en bout sur de vrais comptes métier** (`testsales@` sales, `testlm@` task_list_manager), **sans Admin, sans Preview, sans bypass** (après correction de la contamination cookie initiale + litmus serveur à chaque bascule).

**Sécurité** : restrictions Sales **et** TLM correctes côté serveur ; le **seul** vrai trou (TLM → matrice de permissions) a été **trouvé, corrigé par l'owner, puis re-vérifié sain**.

**Findings :** (1) ~~`/factory-mapping` ne se rafraîchit pas après Save~~ → ✅ **CORRIGÉ 2026-06-20** : `router.refresh()` ajouté à `MappingRow` (save **et** delete) + `setOpen(false)` après delete ; vérifié live (MAPPED auto-incrémente/décrémente sans reload) ; tsc 0-new / 211 tests. (2) conversation : auteur affiché en **ID brut** + avatars instables [ouvert] ; (3) notifications **groupées** (N messages → 1 notif) [ouvert] ; (4) **delay-tracking inerte** sans *production time* au devis [ouvert] ; (5) CI générée **download-only** [ouvert] ; (6) ~~gater `/admin/*` par capacité au niveau route~~ → ✅ **DÉJÀ EN PLACE** (`app/(app)/admin/layout.tsx` gate par `hasUiCapability`; l'obs. initiale venait de la session contaminée). 

**Restant à faire par l'owner** : upload/delete documents manuel, robustesse logout/login, et (si voulu) les 20 commentaires littéraux alternés (échantillon de 6 déjà validé).
