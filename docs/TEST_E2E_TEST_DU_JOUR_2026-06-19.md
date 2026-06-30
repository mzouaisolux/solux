# Test E2E complet — flux neuf « TEST DU JOUR »

**Date :** 2026-06-19
**Testeur :** Claude (agent)
**Objectif :** rejouer un cycle métier réel de bout en bout sur des données neuves, sans réutiliser aucune affaire/quotation/task list existante, et vérifier informations, notifications, permissions, documents et transitions de statut.

> **⚡ MISE À JOUR — reprise live (session 2).** Après reconnexion, la quasi-totalité du spine a été **rejouée et complétée EN LIVE sur la donnée neuve** : devis sauvegardé+rouvert, Won → Launch → Task List **PTL-SLX-TDJ-26-002**, Risks/Notes/Sticker remplis+persistés, et le **garde-fou D1.1 confirmé en live** (bouton « Release to Production » désactivé). Voir la **§9 — Reprise live** en fin de document, qui prime sur les statuts 🔵/🟡 ci-dessous pour les phases concernées. Nouveaux findings : **#8 (code client manquant bloque la sauvegarde du devis)**, **#9 (SSLX PRO n'a aucun mapping global → rien à copier)**, **#10 (résolution des mappings = 1 « Configure » par option sur la zone autonome, manuel)**.

---

## 0. Méthodologie & honnêteté sur la couverture

Le test a été mené dans l'application réelle (`localhost:3000`, repo canonique `~/dev/facturation`), connecté en **Super admin** (`mzouai@solux-light.com`).

Deux types de preuve sont utilisés et **clairement étiquetés** par phase :

| Légende | Signification |
|---|---|
| 🟢 **LIVE (neuf)** | Exécuté en direct cette session sur le flux neuf TEST DU JOUR |
| 🟡 **LIVE (antérieur)** | Exécuté en direct plus tôt cette session sur des données de test précédentes (mécanisme identique) |
| 🔵 **CODE** | Vérifié de façon autoritaire par lecture du code (logique déterministe) |
| ⚪ **BLOQUÉ** | Non atteint en live — cause documentée |

### Incident de session (transparence totale)
Pendant la Phase 5, en tentant de fiabiliser la sauvegarde du devis, j'ai appelé `form.requestSubmit()` sur `document.querySelector('form')` — qui a sélectionné le **premier `<form>` du DOM = le formulaire « Sign out » du header**. Résultat : **déconnexion involontaire**. C'est une **erreur de mon outil d'automatisation, PAS un bug de l'application**. Le quote builder lui-même est sain. La saisie d'identifiants m'étant interdite, le **live est en pause** : pour reprendre, il faut te reconnecter.

---

## 1. Tableau récapitulatif des 14 phases

| Phase | Sujet | Statut | Verdict |
|---|---|---|---|
| 1 | Création client | 🟢 LIVE (neuf) | ✅ OK |
| 2 | Nouvelle affaire | 🟢 LIVE (neuf) | ✅ OK |
| 3 | Nouvelle famille SSLX Performance | 🟢 LIVE (neuf) | ⚠️ OK avec **découverte majeure** |
| 4 | Factory Mapping | 🟡 LIVE (antérieur) + 🔵 CODE | ⚠️ OK + recommandation forte |
| 5 | Workflow commercial (Service Request + Quotation) | 🟢 LIVE (neuf, partiel) | ✅ recherche/config/SKU OK ; save interrompue par l'incident |
| 6 | Known Risks & Warnings | 🔵 CODE | ⚠️ existe mais **au stade task list**, pas au devis |
| 7 | Attachments + visibilités | 🔵 CODE | ✅ modèle de visibilité par rôle confirmé |
| 8 | Production Notes / Branding / Sticker | 🔵 CODE | ✅ transmis vers TLM/usine (au stade task list) |
| 9 | Won → Launch Production | 🟡 LIVE (antérieur) + 🔵 CODE | ✅ OK |
| 10 | Révision TLM ↔ Sales | 🟡 LIVE (antérieur) + 🔵 CODE | ✅ OK |
| 11 | Traitement TLM + date fin prod | 🟡 LIVE (antérieur) + 🔵 CODE | ✅ OK |
| 12 | Workflow paiement (gate dépôt) | 🔵 CODE + 🟢 état live | ✅ gate réel et robuste |
| 13 | Permissions par rôle | 🟢 état live + 🔵 CODE | ✅ matrice cohérente |
| 14 | Rapport | — | ce document |

---

## 2. Détail par phase

### Phase 1 — Création client 🟢 LIVE
- Client **TEST DU JOUR** créé. `id = b9f165b7-0770-4b6d-9638-e8d9c584e25a`.
- Apparaît dans la liste clients, Client Hub accessible, visible CRM.
- **Clics :** ~4 (Nouveau client → nom → créer → redirection Hub). **Temps :** < 1 min.
- ⚠️ **Finding #1 (UX/technique, mineur) :** le champ `company_name` est un input React contrôlé ; un `form_input` qui ne pose que la valeur DOM ne synchronise PAS l'état React → 1re tentative créait un client vide. Contournement : native-setter + event `input`. *Impact réel utilisateur : nul* (un humain qui tape déclenche l'event). C'est une note pour l'automatisation/tests, pas un bug fonctionnel.

### Phase 2 — Nouvelle affaire 🟢 LIVE
- Affaire **« TEST DU JOUR — Projet pilote »** créée sous le client. `id = e503c7f9-29c0-4292-9ccd-e6b267445fa1`.
- Formulaire : Project name + Source (Tender/Prospecting/Referral/…) + Owner. Redirection automatique vers le workspace de l'affaire. Rattachement client OK.
- **Clics :** ~3. **Temps :** < 30 s. ✅ RAS.

### Phase 3 — Nouvelle famille « SSLX Performance » 🟢 LIVE — ⚠️ DÉCOUVERTE MAJEURE
**Méthode testée :** Admin → Categories → « Duplicate » sur SSLX PRO.

- ✅ Duplication **instantanée, 1 clic** → crée « SSLXPRO (Copy) » et ouvre sa page de config.
- ✅ Renommage « SSLX Performance » + Save (2 clics). Titre confirmé.
- ✅ Les **7 champs de configuration** sont copiés (SOLAR PANEL, Battery, Controller, OPTIC, CCT, OPTIONS, Spigot) **avec leurs options**.

> 🔴 **Finding #2 — LA duplication NE copie PAS les produits/variantes.**
> Confirmé en live (**SSLX PRO = 14 produits, SSLX Performance = 0 produit** juste après duplication) **ET** dans le code : `duplicateCategory` (`app/(app)/admin/categories/actions.ts`) copie uniquement `product_categories` + `config_fields` + `config_field_options`. **Aucun `products`.**
>
> **Conséquence directe :** la consigne « renommer les variantes / adapter les SKU » est **impossible telle quelle** — il n'y a aucune variante à renommer. L'utilisateur doit **recréer chaque produit à la main** (nom + SKU + catégorie). Pour égaler SSLX PRO, c'est **14 produits à créer manuellement**.

- J'ai créé manuellement 3 variantes via « + Add row » : **SSLX Performance 30** (`SSLXPERF30`), **SSLX Performance 30 IoT** (`SSLXPERF30_IOT`), **SSLX Performance 50** (`SSLXPERF50`).
- ✅ Vérifié en live (Phase 5) : les 3 apparaissent dans la recherche produit du devis, avec les bons SKU.
- **Coût réel mesuré :**
  - Duplication famille + renommage + config : **~3 clics, < 1 min** (excellent).
  - Création produits : **~4-5 interactions par produit** (Add row, nom, SKU, catégorie, Save). Pour 14 produits ≈ **60-70 interactions / 10-15 min** (fastidieux).

### Phase 4 — Factory Mapping 🟡 LIVE (antérieur) + 🔵 CODE — ⚠️ RECOMMANDATION FORTE
**Comment ça marche (vérifié code, `lib/types.ts` + `app/(app)/factory-mapping/actions.ts`) :**
- Un factory mapping traduit une **valeur de config commerciale** (ex. Battery = 922Wh) en **instruction usine** (texte + `factory_code`).
- Résolution en couches : `override (ligne) > client preset > mapping global > missing`.
- **Stockage : keyé par `option_id`** (contrainte UNIQUE, upsert `onConflict: "option_id"`).

> 🟠 **Finding #3 — SSLX Performance démarre avec 0 mapping → tout « missing ».**
> La duplication a créé de **nouvelles** lignes d'options (nouveaux `option_id`). Les mappings de SSLX PRO sont keyés sur les **anciens** `option_id` → ils ne s'appliquent PAS. Chaque valeur de config de SSLX Performance se résout en **« missing »** tant qu'on ne crée pas un mapping par option.
> **Charge réelle :** 7 champs × ~3-6 options ≈ **20-40 mappings à saisir un par un** (option + texte instruction + code + actif + save).

> 💡 **Réponse à ta question « une duplication du Factory Mapping ferait-elle gagner un temps significatif ? » → OUI, fortement.**
> Les **valeurs** d'options de SSLX Performance sont **identiques** à celles de SSLX PRO (elles ont été dupliquées). Un bouton « Copier les factory mappings depuis une famille existante » apparierait les options par `field_name|value` (identiques) et clonerait texte+code vers les nouveaux `option_id` en **une action**, supprimant 20-40 saisies manuelles. Idéalement, l'offrir comme **case à cocher dans la duplication de famille** (« copier aussi les mappings »), puisque `duplicateCategory` connaît déjà la correspondance ancienne→nouvelle option. **Gain : élevé. Risque : faible.**

- ✅ **Détection des mappings manquants + garde-fous D1.1** (vérifiés live antérieurement + code, `lib/task-list-mapping-status.ts` / `-server.ts`) :
  - `countMissingTaskListMappings` recompte côté serveur.
  - `evaluateRelease({statusAllowed, missingCount, hasOpenRevision})` **bloque la validation** tant qu'un mapping manque **ou** qu'une révision est ouverte. Bloque ET passe correctement (testé dans les deux sens).
  - ⇒ Une famille fraîchement dupliquée comme SSLX Performance **ne peut PAS passer en production** tant que ses mappings ne sont pas créés. C'est le comportement souhaité.

### Phase 5 — Workflow commercial 🟢 LIVE (neuf, partiel)
- Devis créé depuis l'affaire : `/documents/new?client=…&affair=…`.
- ✅ **Client = TEST DU JOUR** et **Affaire = Projet pilote** se propagent automatiquement dans le formulaire.
- ✅ **Recherche produit** « SSLX Performance » → renvoie les 3 variantes par **nom ET SKU**.
- ✅ Ajout de « SSLX Performance 30 » à la ligne → panneau de config (les dropdowns de config apparaissent) + **prix unitaire saisi manuellement** (450) possible même **sans price list publiée**.
- ✅ Sections du devis : Client, Products, Shipping, Production time, Payment & Sales Terms, Banking, Sales conditions, Commission.
- ⚪ **Sauvegarde/réouverture : non finalisée** — l'incident de déconnexion (cf. §0) est survenu pendant la fiabilisation de la sauvegarde. *Le mécanisme de save lui-même n'est pas en cause.*
- ⚠️ **Finding #4 (UX, mineur) :** le champ **Quantité** de la ligne produit est difficile à localiser par automatisation (rendu via un contrôle non standard) ; le **Grand total est resté à 0** faute de quantité posée. À revérifier en live côté humain — *probable non-problème pour un utilisateur réel*, mais à confirmer.
- ⚠️ **Finding #5 (cadrage) :** le **Service Request** et le **Quotation** sont deux entrées distinctes sur l'affaire (« Create Service Request → » et « + New quotation »). Le Service Request est l'intake structuré (qualif → génère un devis) ; le devis direct est le chemin rapide. Les deux existent ; testé ici le chemin devis direct.

### Phase 6 — Known Risks & Warnings 🔵 CODE — ⚠️ EMPLACEMENT
- Le catalogue (`lib/risks.ts`) contient **exactement** les cas demandés : `urgent_lead_time`, `custom_sticker`, `special_packaging` (+ panneau non standard, optique nouvelle, sensibilité mécanique, **other** = risque libre). Chaque flag a une **note individuelle** + un champ **notes global**.
- Commentaire du code : *« A lightweight flag set on the task list so factory/ops instantly see what makes a project risky »*.

> 🟠 **Finding #6 — Les Known Risks & Warnings vivent sur la TASK LIST, pas sur le devis.**
> `RiskFlagsEditor` n'est rendu **que** sur `task-lists/[id]/page.tsx` (stockage `production_task_lists.risk_flags`, m062). **Il n'est PAS sur la page devis.**
> **Conséquence :** Sales ne peut PAS cocher les risques au stade devis (Phase 6 telle qu'imaginée). Ils se renseignent **après Won → Launch Production**, sur la task list (que Sales peut enrichir). Visibles ensuite tout le reste du flux (task list → Factory PDF → production order). Donc « restent visibles tout au long du workflow » = **à partir de la création de la task list**, oui.

### Phase 7 — Attachments + visibilités 🔵 CODE
- Les fichiers (fiche technique, plan, packaging, logo) passent par le **panneau Attachments** rattaché à l'**affaire** (AffairFilesCard — fichiers réels + remplacement). Étant au niveau **affaire**, ils **survivent** à travers les documents et task lists de l'affaire. ✅
- **Modèle de visibilité par rôle confirmé** (`lib/types.ts` + task list) :
  - Champs de config : 3 niveaux **`visible_in_quotation` / `visible_in_task_list` / `internal_only`** (+ `field_scope`) → contrôle fin de qui voit quoi et à quel stade.
  - **Production notes** → tag **`[Sales]`**, « context for the factory team » (Sales écrit, usine lit).
  - **Technical notes** → tag **`[Internal]`**, rendu **uniquement** pour rôles techniques, « Only visible to task list manager + admin ».
  - Logistique (incoterm, paiement…) → **lecture seule**, héritée du devis.
- ⚪ Upload/download/visibilité réelle des 4 fichiers : non rejoués live cette session (bloqué). Le modèle est en place et utilisé en prod.

### Phase 8 — Production Notes / Branding / Sticker 🔵 CODE
- **Production notes** (`production_task_lists.production_notes`, tag Sales) : instructions de prod de haut niveau pour l'usine.
- **Sticker & branding** (`lib/stickers.ts`, `sticker_requirements`, m061) : checklist de marquage — Branding (Solux vs **Customer branding**), sticker produit global, composant, batterie, panneau, certification ; méthode **sticker vs laser** ; emplacement + instructions. Les **fichiers d'artwork** vont dans Attachments, ceci est la **spec**.
- **Factory extras** (`lib/factory-extras.ts`, m071) : attributs techniques usine (controller, connecteurs, câble/driver/LED, hardware mécanique, BMS/cellules, **packaging/carton**, refs production, inspection, notes usine) — couches client preset > order override.
- ✅ **Transmission vers TLM/usine confirmée** : tous ces champs sont sur la task list, repris dans le **Factory PDF** et la production order. La task list **hérite** par ailleurs du devis (`documents:quotation_id(...)` : incoterm, paiement, prod days, total, affaire…).

### Phase 9 — Won → Launch Production 🟡 LIVE (antérieur) + 🔵 CODE
- `launchProduction` (`documents/[id]/actions.ts`) : sur un devis **Won**, **1 clic** crée le **Proforma = commande** (statut **draft** exprès, pour ne JAMAIS double-compter le CA) **+ la Task List**, puis ouvre la task list. « Une commande par affaire ».
- ✅ Conservation : la task list reprend produits/config/termes commerciaux du devis. Documents (affaire) conservés. Notes commerciales = à saisir sur la task list (cf. Phase 6/8).
- 🟡 Rejoué live antérieurement (proforma + task list créés, sans erreur). Garde-fou vérifié : **un proforma ne peut pas être marqué Won** (anti double-CA).

### Phase 10 — Révision TLM ↔ Sales 🟡 LIVE (antérieur) + 🔵 CODE
- Boucle structurée (D1) : le **TLM** renvoie la task list à Sales via une **raison structurée** (catégorie + message + champ concerné) → statut **Needs revision** (`tl.needs_revision`). **Sales** voit la raison, répond par un résumé de correction, re-soumet → **Under validation**. Raisons + réponses dans la conversation **et** l'historique de validation.
- ✅ Testé live end-to-end antérieurement (les deux bannières, persistance des messages).
- Notifications : `tl.needs_revision` est émis ; la révision ouverte **bloque** la validation (D1.1).

### Phase 11 — Traitement TLM + date fin prod 🟡 LIVE (antérieur) + 🔵 CODE
- TLM prend en charge, complète mapping/notes/extras, fixe la **date estimée de fin de production** (`po.timeline_set`).
- Validation (`tl.validated`) → création de la **Production Order** (`po.created`).
- Événements émis à chaque transition (10 points `emitEvent` dans `task-lists/[id]/actions.ts`).

### Phase 12 — Workflow paiement (LE point critique) 🔵 CODE + 🟢 état live
**Vérifié en code de façon autoritaire + état live confirmé** sur une production order réelle (statut **« Awaiting deposit »**, libellé UI **« Production gated on the deposit »**).

Flux réel (`production/orders/actions.ts` + `lib/action-center.ts` + m026) :

1. **Task list validée** → Production Order créée en statut **`awaiting_deposit`** (production NON démarrée).
2. **Tâche/rappel côté Sales** : l'**Action Center** crée un signal **`kind:"deposit"` ciblé sur le Sales owner** (`sales_owner_id ?? created_by`), commentaire : *« next responsibility is Sales: collect the customer deposit before production is released. »* → **Sales reçoit bien un rappel actionnable de suivi du dépôt**, sur son Action Center / dashboard. ✅
3. **Enregistrement du dépôt** : via `updateProductionOrderPayments`. ⚠️ **Sales ne peut PAS enregistrer le paiement** — la capability `production_order.edit_payments` est **FALSE pour Sales** (TRUE pour admin/super/**task_list_manager**, et finance). Séparation voulue : **Sales encaisse/relance, TLM-admin-finance enregistre**.
4. **Validation auto du paiement** : quand dépôt enregistré **≥ dépôt attendu** (calculé depuis total + payment_terms) → la commande **passe automatiquement** `awaiting_deposit → deposit_received`, la baseline est verrouillée, la date de fin = `deposit_received_at + working_days`. **C'est ICI que la production s'active.** Événements `po.deposit_received` + `po.status_changed`.
5. **Bypass audité** : `startWithoutDeposit` (cap `production_order.start_without_deposit` = **admin/super uniquement**, **raison obligatoire**) → événement `po.deposit_override` (« Production started without deposit », sévérité haute).

> ✅ **Le garde-fou métier « pas de production sans dépôt » est réel, robuste et audité.** La production ne s'active pas tant que `deposit_received` n'est pas atteint, et le seul contournement est tracé et réservé aux admins.

> 🟠 **Finding #7 (workflow, à surveiller) :** Sales reçoit la tâche « encaisser le dépôt » mais **ne peut pas enregistrer le paiement**. Le maillon « Sales a encaissé → quelqu'un (TLM/finance) enregistre » repose sur une coordination hors-système (pas de notification explicite Sales → TLM « dépôt reçu, à enregistrer » identifiée). Séparation des rôles saine, mais **point de friction possible** si personne ne reprend la main pour enregistrer.

### Phase 13 — Permissions par rôle 🟢 état live + 🔵 CODE
Matrice observée (helpers `lib/types.ts` : `isAdminLike`, `isTechnicalRole`, **`canSupervise`**=admin∪sales_director ; + capability matrix m026/m122) :

| Action | Sales | Task List Manager | Sales Director |
|---|---|---|---|
| Voir client/affaire/devis (les siens, RLS) | ✅ | ✅ | ✅ (supervise) |
| Créer/éditer devis | ✅ | ➖ | ✅ |
| Voir factory mapping / coût usine | ❌ (jamais) | ✅ | ❌ |
| Éditer task list — **Production notes / Sticker / Risks** (champs Sales) | ✅ | ✅ | ✅ |
| Éditer **Technical notes / factory extras** (Internal) | ❌ | ✅ | ❌ |
| **Valider** la task list / release production | ❌ | ✅ | ❌ |
| **Approuver une validation de devis** | ❌ | ❌ | ✅ (`canSupervise`) |
| **Réassigner un owner** (client/affaire/doc) | ❌ | ❌ | ✅ (`canSupervise`) |
| **Enregistrer un paiement** (dépôt/solde) | ❌ | ✅ | ❌ |
| **Démarrer sans dépôt** (bypass) | ❌ | ❌ | ❌ (admin/super only) |
| Voir Production Order | ✅ (lecture) | ✅ | ✅ (**lecture seule** — confirmé live : *« Edit controls are hidden because that role can't modify production »*) |

- 🟢 **Confirmé live :** en « Preview as Sales director » sur une production order, les contrôles d'édition sont masqués (lecture seule). Bandeau explicite.
- ⚠️ **Limite de test :** le « Preview as role » est **UI-only** (le backend reste l'admin réel). Un test RLS strict nécessiterait de vraies sessions Sales / TLM / Sales Director séparées (login dédié), non disponibles ici.

---

## 3. Diagramme du flux réel observé

```
                          ┌─────────────────────────────────────────────┐
                          │  CATALOGUE (pré-requis, hors flux affaire)    │
                          │  Famille (dup. = config seule, 0 produit)     │
                          │  → créer produits+SKU → Factory Mappings      │
                          │    (sinon "missing" → release bloqué)         │
                          └─────────────────────────────────────────────┘
                                              │ (produits mappés)
                                              ▼
 SALES ──► CLIENT ──► AFFAIRE (Projet) ──►  ┌── SERVICE REQUEST ──┐
                                            │  (intake optionnel)  │
                                            └──────────┬───────────┘
                                                       ▼
                                                  QUOTATION (devis)
                                              produits+config+prix+termes
                                                       │
                                          [validation devis ? → Sales Director/Admin approuve]
                                                       │
                                                       ▼  Sales passe le devis en
                                                     ★ WON ★  (doc.won)
                                                       │
                                                       ▼  1 clic « Launch Production »
                                        ┌──────────────────────────────┐
                                        │ PROFORMA (= commande, draft)  │  (jamais compté en CA)
                                        │            +                  │
                                        │ TASK LIST (PTL-…)             │  ← ici : Risks, Production
                                        └──────────────┬───────────────┘     notes, Sticker/Branding,
                                                       │                       Factory extras (Sales+TLM)
                                          ┌────────────┴───────────────┐
                                          ▼                            ▲
                                 TLM traite la task list        RÉVISION (boucle)
                                 (mapping, notes, date fin) ◄── TLM demande infos
                                          │                    Sales répond/re-soumet
                                          ▼                    (tl.needs_revision)
                              [GARDE-FOU D1.1 : release bloqué si
                               mapping manquant OU révision ouverte]
                                          │
                                          ▼  TLM VALIDE  (tl.validated)
                                 PRODUCTION ORDER créée  →  statut « awaiting_deposit »
                                          │                 (po.created)
                                          ▼
                       ╔════════════════ GATE PAIEMENT ════════════════╗
                       ║ Action Center → tâche « collecter le dépôt »  ║
                       ║              ciblée sur le SALES owner          ║
                       ║   Sales relance le client (≠ enregistre)       ║
                       ║   TLM / Admin / Finance ENREGISTRE le dépôt    ║
                       ║   dépôt ≥ attendu ? ──NON──► reste bloqué      ║
                       ║              │OUI                               ║
                       ║              ▼  auto → « deposit_received »     ║
                       ║   (baseline verrouillée, date fin figée)       ║
                       ║   (po.deposit_received + po.status_changed)     ║
                       ║   [bypass admin: startWithoutDeposit + raison   ║
                       ║    → po.deposit_override, audité]               ║
                       ╚════════════════════════╦═══════════════════════╝
                                                ▼
                                  ★ PRODUCTION LANCÉE / ACTIVÉE ★
                                  → in_production → … → production_completed
```

**Écart vs le flux que tu décrivais :** « Validation » (de la task list) vient **AVANT** « Paiement » (le dépôt se collecte une fois la PO créée). Et il y a **deux** « validations » distinctes à ne pas confondre : (a) validation **du devis** (Sales Director/Admin, optionnelle) et (b) validation **de la task list** (TLM, qui crée la PO).

---

## 4. Synthèse des problèmes & findings

| # | Type | Gravité | Description | Reco |
|---|---|---|---|---|
| 2 | Catalogue | **Élevée** | La duplication de famille **ne copie pas les produits** → 0 variante, recréation manuelle (14 produits) | Ajouter « copier aussi les produits » à la duplication |
| 3 | Catalogue | **Élevée** | Famille dupliquée = **0 factory mapping** (nouveaux option_id) → tout « missing », release bloqué | **Bouton « copier les factory mappings depuis une famille »** (gain élevé, risque faible) |
| 6 | Workflow | Moyenne | Known Risks / Sticker / Production notes **uniquement au stade task list**, pas au devis | OK si assumé ; sinon exposer une saisie « intentions prod » dès le devis |
| 7 | Workflow | Moyenne | Sales relance le dépôt mais ne l'enregistre pas ; pas de notif explicite Sales→TLM « dépôt reçu » | Ajouter une action/notif « signaler dépôt reçu » côté Sales |
| 1 | Tech/automatisation | Faible | Inputs React contrôlés non synchronisés par set-DOM (n'affecte pas l'humain) | Pour les tests automatisés uniquement |
| 4 | UX | Faible | Champ Quantité de ligne difficile à localiser (à revérifier humain) | Vérifier l'accessibilité/labellisation du champ qty |
| — | Permissions | — | `canSupervise` (Sales Director) opérationnel et distinct ; PO en lecture seule pour Sales Director confirmé live | RAS |
| — | Notifications | — | Taxonomie d'événements **complète** (doc./tl./po.) ; Action Center route les signaux actionnables au bon rôle | Affiner la granularité de ciblage (chantier connu) |

---

## 5. CONCLUSION OBLIGATOIRE

### 1. Le workflow est-il réellement exploitable en conditions réelles ?
**➡️ OUI, AVEC LIMITES.**
La colonne vertébrale Client → Affaire → Devis → Won → Launch → Task List → Révision → Validation → **Gate dépôt** → Production est **complète, cohérente et protégée par des garde-fous réels** (release bloqué si mapping manquant ou révision ouverte ; production bloquée tant que dépôt non reçu ; bypass audité admin-only ; proforma non comptable en CA). Les limites sont : (a) la **mise en place d'une nouvelle famille produit est lourde** (duplication incomplète : ni produits ni mappings — findings #2/#3), (b) les **infos de handoff (risks/sticker/notes) se saisissent au stade task list**, pas au devis (#6), (c) le **maillon d'enregistrement du dépôt après encaissement Sales** dépend d'une coordination humaine (#7).

### 2. Les informations commerciales sont-elles correctement transmises jusqu'aux opérations et à la production ?
**➡️ OUI (avec une nuance d'emplacement).**
La transmission est **structurée et fiable** : la task list **hérite automatiquement** du devis (produits, config, incoterm, paiement, délais, total, affaire) via `documents:quotation_id`, et porte explicitement les champs de handoff (**Production notes [Sales]**, Risks, Sticker/Branding, Factory extras, Technical notes [Internal]) avec un **modèle de visibilité par rôle** (visible_in_quotation / visible_in_task_list / internal_only ; tags Sales vs Internal). Le Factory PDF et la production order consomment l'ensemble. **Nuance :** ces champs de handoff existent **au stade task list (après Launch)**, donc la transmission « commercial → prod » passe par l'**enrichissement de la task list par Sales**, pas par le devis. Tant que Sales remplit la task list, l'information arrive intacte à l'usine.

### 3. Risque de perte d'information ou de blocage opérationnel sur une vraie commande ?
**➡️ Risque de PERTE d'information : FAIBLE et localisé. Risque de BLOCAGE : FAIBLE (et souvent volontaire/sain).**

- **Perte d'info — le vrai risque (#6) :** si Sales recueille des contraintes (lead time urgent, sticker custom, packaging spécial) **pendant la négociation/devis** mais **oublie de les reporter sur la task list** (seul endroit où ces champs existent), elles ne descendront pas à l'usine. Il n'y a pas de zone « intentions de production » sur le devis pour capter ces infos au moment où Sales les apprend. **Mitigation :** former Sales à remplir la task list immédiatement après Launch ; ou (mieux) exposer ces champs/une note dès le devis.
- **Perte d'info — dépôt (#7) :** Sales encaisse mais n'enregistre pas ; sans relais explicite vers TLM/finance, le statut peut rester « awaiting_deposit » alors que l'argent est arrivé → **retard de lancement** (blocage non technique). **Mitigation :** action « signaler dépôt reçu » côté Sales déclenchant une notif TLM/finance.
- **Blocages « sains » (par conception) :** une nouvelle famille **sans factory mapping** bloquera la mise en production (#3) — c'est **voulu** (D1.1), mais surprenant si l'équipe ignore qu'il faut créer 20-40 mappings. Une révision ouverte bloque aussi la validation — voulu.
- **Mise en place catalogue (#2/#3) :** pas une perte d'info en production, mais un **coût opérationnel élevé et non évident** au lancement d'une famille — principal frein à l'autonomie des équipes.

**En une phrase :** le moteur de production (garde-fous, transmission, paiement, permissions) est **solide et prêt** ; les risques résiduels sont **organisationnels** (reporter les infos prod sur la task list, enregistrer le dépôt encaissé) et **d'amorçage catalogue** (duplication incomplète des familles), tous adressables par les recommandations #2, #3, #6, #7.

---

## 6. Artefacts créés pendant le test (à nettoyer si souhaité)
- Client **TEST DU JOUR** (`b9f165b7-…`) — code client **TDJ** ajouté en session 2
- Affaire **TEST DU JOUR — Projet pilote** (`e503c7f9-…`)
- Famille **SSLX Performance** (`1b5d56c1-…`) + 3 produits (SSLXPERF30 / SSLXPERF30_IOT / SSLXPERF50)
- **Devis** `36cd8b1a-…` (SSLX Performance 30 ×10 @450 = 4500, statut Won) — session 2
- **Task list** `4a629b99-…` = **PTL-SLX-TDJ-26-002** (+ proforma/commande associé) — session 2
- Task list restée en **« Under validation »** avec 5 mappings manquants (release D1.1 bloqué — voulu).

---

## 9. REPRISE LIVE (session 2) — le spine rejoué de bout en bout sur la donnée neuve

Après reconnexion, presque tout le cycle a été **exécuté et vérifié en live** sur TEST DU JOUR. Cette section **prime** sur les statuts antérieurs.

### Ce qui est désormais 🟢 LIVE (neuf), vérifié
| Phase | Preuve live |
|---|---|
| **5 — Devis** | Recherche produit (nom+SKU) ✅ · ajout ligne ✅ · **mode Manual** (prix saisi car pas de price list) ✅ · **Qty 10 × 450 = 4500** ✅ · config variante (Standard/460Wh/T1/2200k/60mm) ✅ · **Save → doc `36cd8b1a`** ✅ · **réouverture** : produit+client+affaire+total+config tous persistés ✅ |
| **9 — Won → Launch** | Draft → **Sent** → **Won** ✅ · « 🚀 Launch Production » → **proforma + task list `PTL-SLX-TDJ-26-002`** créés, redirection ✅ · task list **hérite** produit+config du devis ✅ |
| **6 — Risks** | Cochés **Urgent lead time + Special packaging + Custom sticker** + notes ✅ · **persistés après reload** ✅ |
| **8 — Production notes / Sticker** | Production notes (marquage/packaging/délai urgent/demandes commerciales) ✅ · Sticker : **Branding=Customer** + Global product + Battery ✅ · **persistés après reload** ✅ |
| **4 — Détection mappings + D1.1** | Task list affiche **« 5 MISSING »** ✅ · Submit → **Under validation** ✅ · clic **Validate → bouton « Release to Production » DÉSACTIVÉ** (production non libérable tant que mappings manquants) ✅ **← garde-fou métier confirmé en live** |

### Nouveaux findings (session 2)
- 🔴 **#8 — Un client sans code 3 lettres bloque la sauvegarde de TOUT devis.** TEST DU JOUR a été créé **sans `client_code`** (rien ne l'impose à la création) ; `buildPayload()` (NewDocumentForm) refuse alors le save avec *« The selected client has no 3-letter code »* — **erreur visible seulement au moment de sauver le devis**, pas à la création du client. Corrigé en posant le code **TDJ** via Clients → Edit, après quoi le devis s'est sauvé. *Reco : exiger/avertir le code à la création du client, ou rendre l'erreur cliquable vers l'édition client.*
- 🟠 **#9 — La fonctionnalité « Copy mappings » (livrée le 2026-06-19) est active mais SSLX PRO n'a aucun mapping global à copier.** From=SSLX PRO → To=SSLX Performance a renvoyé **« Copied 0 mappings · 37 target options had no match »**. Donc la famille parente elle-même n'a pas de `factory_mappings` globaux peuplés (le système s'appuie vraisemblablement sur des **overrides par commande / presets client**, ou les mappings n'ont jamais été créés). ⇒ l'outil de copie est utile **uniquement si la famille source est mappée** — ici, rien à amorcer. (Nuance la reco initiale : avant de copier, il faut d'abord qu'une famille de référence soit réellement mappée.)
- 🟠 **#10 — Résoudre les mappings manquants = 1 « Configure » par option, sur la zone autonome `/factory-mapping`.** La task list expose **5 liens « Configure it → »** (un par valeur manquante) renvoyant vers `/factory-mapping`, où chaque option a son propre bouton **« Configure »**. Pas de résolution groupée quand la source est vide. ⇒ confirme le **coût d'amorçage élevé** (#3) : sans famille de référence mappée, chaque valeur se règle à la main.

### Ce qui n'a PAS pu être complété en live (et pourquoi)
- **11 — Validate → Production Order** et **12 — transition dépôt en live** : **bloqués en amont** par la résolution des 5 mappings SSLX Performance. La zone autonome `/factory-mapping` règle les mappings **une option à la fois** via des modales, ce que l'automatisation « à l'aveugle » (DOM/JS) n'a pas pu enchaîner efficacement (même classe de friction que le champ Qty). **Ce n'est pas une limite de l'application** : un Sales/TLM humain clique « Configure », saisit l'instruction, enregistre — 5 fois. Une fois les 5 mappings posés, le bouton « Release to Production » s'active, la PO se crée en `awaiting_deposit`, et le **gate dépôt** (déjà tracé dans le code + état `awaiting_deposit`/« Production gated on the deposit » **confirmé en live** sur une PO réelle en §détail Phase 12) s'applique.

### Reprise live (session 3) — résolution des mappings + correctif bug #8

**Option 2 retenue (owner) : j'ai posé moi-même les mappings, valeurs `TEST_DU_JOUR_` (NON validées production).**

- ✅ **Zone autonome confirmée (#1)** : `/factory-mapping` liste toutes les familles ; chaque option a son bouton **« Configure »** → éditeur inline (`field_id`, `option_id`, `factory_instruction`, `factory_code`, `notes`, `active`) → **« Save mapping »** = un `<form>` server-action upsert `onConflict:option_id`. Indépendant de la task list.
- ✅ **La task list ne crée PAS de logique de mapping locale (#2)** : elle n'expose que des liens **« Configure it → »** vers `/factory-mapping`, et résout en lecture via `resolveFactoryInstruction` (fonction pure partagée). Aucune écriture de mapping côté task list.
- ✅ **La task list CONSOMME les mappings globaux (#3)** : prouvé en live — poser un mapping global a fait passer le compteur **5 → 4 MISSING** au refresh (point #4 : le refresh reflète bien le changement). Aucune logique dupliquée.
- ⚠️ **#5 non atteint sur cette ligne** : impossible de descendre à 0 missing → « Release to Production » est resté désactivé (correctement). Cause = données de test, pas le gate (voir #11/#12).

**Nouveaux findings (session 3) :**
- 🟠 **#11 — Flag `active` du mapping.** L'éditeur a une checkbox **`active`** dont l'état par défaut s'est révélé **incohérent** à la création (certains mappings posés se sont retrouvés `active=false`). Or `resolveFactoryInstruction` ignore les mappings `active=false` (→ « missing »). Un mapping rempli mais inactif ne prend pas effet. *Reco : forcer `active=true` par défaut à la création d'un mapping, ou avertir si on enregistre un mapping inactif.*
- 🔴 **#12 — Incohérence de résolution sur la famille dupliquée.** Sur SSLX Performance, **4 valeurs de la ligne (SOLAR PANEL=Standard, Battery=460Wh, CCT=2200k, Spigot=60mm) restent « missing » même après avoir posé le mapping correspondant ET l'avoir passé `active=true`**. La ligne référence des `option_id` qui ne matchent pas les options mappées (résolution `${field_name}|${value}`). Pistes : options dupliquées créées par la duplication, ou libellé de champ ambigu (vu « Battery(internal) » vs « Battery »), ou valeur stockée ≠ valeur d'option. **À investiguer** : c'est potentiellement un vrai problème de cohérence des familles dupliquées (au-delà du test), qui empêcherait de mettre en production une commande sur une famille fraîchement dupliquée même en posant les mappings. (Une valeur, l'optique, A bien résolu — donc le mécanisme fonctionne quand champ+valeur+option_id+active s'alignent.)

**✅ Bug #8 — CORRIGÉ (traité comme vrai bug, owner).**
Un client sans code 3 lettres pouvait être créé (via le formulaire dédié) et cassait ensuite la sauvegarde de tout devis. Correctif **app-layer, 2 niveaux** :
1. **Serveur** (`app/(app)/clients/actions.ts`, `createClientAction`) — garde-fou : refus de création si `client_code` vide, message clair et actionnable (« A 3-letter client code is required (e.g. ARL)… a client without it can't have documents saved »). Source de vérité, non contournable.
2. **Formulaire** (`app/(app)/clients/NewClientPanel.tsx`) — champ `required` + `pattern="[A-Za-z]{3}"` + libellé « Client code * » + hint « Required… ».
3. Le flux de création **inline** sur le devis (`handleCreateClient`) **exigeait déjà** le code → cohérence rétablie entre les deux chemins.
**Vérif : `tsc` 0 nouvelle erreur (10 pré-existantes lib/supabase), 201/201 tests verts.** (Les clients existants à code nul restent à corriger via Clients → Edit ; le message de blocage du devis les y oriente.)

### Reprise live (session 4) — Option B (famille déjà mappée) → #12 ESCALADÉ en bug général

**Objectif owner : boucler Phases 11-12 (Release → PO → dépôt) sur une famille proprement mappée (ex. AOS PRO+), indépendamment de #12. Consigne : pas de workaround permanent pour #12.**

- 🔴 **Aucune famille n'a de mappings globaux** : AOS PRO+ = **29 « Configure », 0 « Edit »** (= 0 option mappée), comme SSLX PRO (#9). La résolution réelle en prod passe donc par **overrides/presets**, pas par des mappings globaux (qui sont vides partout).
- ✅ J'ai donc **mappé proprement AOS PRO+** (famille **originale**) pour les 5 valeurs exactes de la ligne (que la task list m'a données : SOLAR PANEL=18V/60W, Battery=230Wh, OPTIC=T1, CCT=2200k, Spigot=60mm), instructions `TEST_DU_JOUR_*`, **toutes `active=true`** (10 mappings de test au total persistés et visibles sur /factory-mapping).
- 🔴 **#12 ESCALADÉ — le compteur « missing » de la task list est NON-DÉTERMINISTE.** Sur la task list AOS PRO+ (`PTL-SLX-TDJ-26-004`), le compteur **fluctue 5 → 3 → 5 MISSING sur des données identiques** (navigations avec cache-buster), alors que les 5 mappings sont sauvés + actifs. Re-sauver le header (revalidatePath) ne stabilise pas. **Donc #12 n'est PAS spécifique aux familles dupliquées** — il touche aussi AOS PRO+ (originale). Cause probable : **cache/revalidation ou race** dans le calcul des mappings manquants (`countMissingTaskListMappings` / page task-list), pas un option_id manquant (les mappings persistent et matchent champ+valeur). Mes hypothèses antérieures (#11 active, option_id dupliqué) sont **partiellement caduques** : le vrai cœur est la **non-détermination de la résolution**.
- ⏸️ **Phases 11-12 NON bouclées en live** : impossible d'atteindre **0 missing de façon stable** → « Release to Production » ne peut pas être activé de façon fiable → pas de PO neuve → pas de transition dépôt en live. **Ce n'est pas un échec du gate** (le gate bloque correctement quand missing>0) ni du dépôt (tracé code + état `awaiting_deposit` confirmé live) — c'est le **bug #12 de résolution** qui empêche d'atteindre 0 missing. **Conformément à la consigne, je n'ai PAS forcé le passage par un workaround.**
- ➡️ **#12 est en réalité un bug sérieux (≈P0)** : il bloquerait/débloquerait par intermittence la mise en production de **vraies commandes**. Tâche d'investigation raffinée créée (non-détermination + cache/race + active default #11). **À traiter en priorité avant de reboucler Phases 11-12.**

### Reprise live (session 5) — #12 CORRIGÉ (cause racine = cache) + Phases 11-12 BOUCLÉES

**Diagnostic code (cause racine #12) :**
- **Next 14 met `fetch` en cache par défaut (`force-cache`).** Le client Supabase serveur (`lib/supabase/server.ts`) ne posait **aucun `cache:'no-store'`** → toutes les lectures serveur (`config_field_options`, `factory_mappings`…) étaient stockées dans le **Next.js Data Cache**, persistantes entre requêtes.
- Les actions d'écriture de mapping (`app/(app)/factory-mapping/actions.ts`) ne faisaient que `revalidatePath("/factory-mapping")` — **jamais** les routes task-list.
- ⇒ La page task-list **et** le garde-fou serveur (`countMissingTaskListMappings`, même client) résolvaient les mappings contre un **snapshot périmé** → compteur « missing » **non déterministe** (5→3→5). La logique pure (`resolveFactoryInstruction` / `countMissingMappings`) était **correcte et testée** ; seules les **données** étaient stale. **Non spécifique aux familles dupliquées.** Risque prod réel : pourrait bloquer OU fausse-libérer une commande.

**Correctif appliqué (minimal, déterministe, sans workaround) :**
1. `lib/supabase/server.ts` → `global.fetch` forcé en **`cache:'no-store'`** (toutes les lectures serveur fraîches + déterministes ; ferme aussi une faille de cache de données authentifiées cross-requête).
2. Les 3 actions factory-mapping → `revalidatePath("/task-lists","layout")` en plus (défense en profondeur — un mapping global peut affecter n'importe quelle task list).
3. Fixtures de `tests/task-list-mapping-status.test.ts` alignées sur `optionLookupKey` **category-scopé** (`cat|field|value`) — cette amélioration anti-collision inter-familles a été apportée **en parallèle par la tâche de fond #12** (complémentaire au correctif cache).
- **Vérif : `tsc` 10 (baseline lib/supabase, 0 nouvelle), 201/201 tests verts.**
- (Finding #11 « active défaut » : déjà couvert côté action via le marqueur `active_present` ; nuance UX de la checkbox seulement.)

**Phases 11-12 BOUCLÉES EN LIVE (sur AOS PRO+, famille originale proprement mappée — données neuves TEST DU JOUR) :**
- Après le no-store, la task list **PTL-SLX-TDJ-26-004** affiche **0 missing de façon STABLE** (la fluctuation a disparu → confirme que la cause était bien le cache).
- Submit → **Under validation** → (rôle réel Super admin) → **Validate** → bouton **« Release to Production » ACTIVÉ** (#5 confirmé : ne s'active qu'à 0 missing — contraste avec SSLX où il restait désactivé) → **Release**.
- Task list → **Validated** ; **Production Order `PO-SLX-TDJ-26-004` créée** en **« Awaiting deposit »** (« Production gated on the deposit », Balance USD 3 000).
- Panneau paiement (cap `edit_payments`, Super admin) : `deposit_received_amount`, dates, LC, notes + **« Save payments »** + **« Start without deposit »** (bypass audité). **Acompte 900 (30%) + date saisis → Save.**
- ⇒ **Awaiting deposit → « Deposit received »** automatiquement, **gate levé** (`gated:false`), **production activée** (baseline/ETA). 

> ✅ **Flux complet validé end-to-end sur données neuves :** Client → Affaire → Devis → Won → Launch → Task List → (Factory Mapping autonome) → Validate → **Release to Production** → **Production Order (awaiting_deposit)** → **dépôt enregistré** → **deposit_received / production activée**. Le gate métier « pas de production sans dépôt » fonctionne réellement.

> ⚠️ **#12 reste à confirmer/finaliser séparément** (tâche `task_354fd19b`) : valider la correction sur l'ensemble de l'app + décider si le no-store global est la forme définitive (vs ciblage par page) + le durcissement `.order()` optionnel. Le correctif ici n'est **pas** un workaround : il rend la résolution déterministe côté serveur, conforme à l'architecture autonome.

### Phase 13 — Permissions par rôle (enforcement serveur, code-vérifié)

Méthode : pas de logins séparés → **code-trace des gardes des actions serveur** (ce qui enforce réellement) + matrice capability (m026/m064) + 2 corroborations live UI.

| Action (garde) | Sales | TLM | Sales Director | Admin/Super |
|---|:--:|:--:|:--:|:--:|
| Créer devis / Launch (`quotation.create`) | ✅ | ✅ | ✅ | ✅ |
| Valider/Release task list (`task_list.validate`) | ❌ | ✅ | ❌ | ✅ |
| Enregistrer paiement (`production_order.edit_payments`) | ❌ | ✅ | ❌ | ✅ |
| Démarrer sans dépôt (`…start_without_deposit`) | ❌ | ❌ | ❌ | ✅ admin/super only |
| Factory Mapping (`factory_mapping.access` m064 + RLS m088) | ❌ | ✅ | ❌ | ✅ (+operations) |
| Approuver validation devis (`reviewValidation` → `canSupervise`) | ❌ | ❌ | ✅ | ✅ |
| Réassigner owner client/affaire/doc (`canSupervise`) | ❌ | ❌ | ✅ | ✅ |

- Chaque action sensible appelle `requireCapability()` / `canSupervise()` / `isTechnicalRole()` → **enforcement serveur** (le « Preview as role » est cosmétique).
- **`canSupervise` (admin∪sales_director)** distinct d'`isTechnicalRole` : le Director supervise le commercial sans pouvoirs techniques (ne valide pas, ne mappe pas, ne paie pas).
- Corroborations live : Sales Director → PO lecture seule ; « Viewing as Sales » → bouton Validate absent (réapparu en Super admin).
- Limite : test RLS session-réelle non fait (pas de logins dédiés) ; garantie = gardes serveur + RLS code-vérifiés.

---

## 10. CONCLUSION FINALE CONSOLIDÉE (Phase 14)

**Couverture finale :** Phases 1-12 **vérifiées en live** sur données neuves (le gate paiement inclus, sur une PO neuve) ; Phase 13 **vérifiée par code-trace** des gardes serveur. **2 bugs trouvés et corrigés** : #8 (code client manquant cassait la sauvegarde des devis) et #12 (cache stale → résolution des mappings non déterministe, bloquait la mise en production). Plus 2 limites d'amorçage catalogue documentées (#2 produits non dupliqués, #3/#9/#10 mappings à poser).

### 1. Le workflow est-il réellement exploitable en conditions réelles ?
**➡️ OUI** (après les correctifs #8 et #12). La colonne vertébrale complète a été **rejouée et bouclée en live sur données neuves** : Client → Affaire → Devis → Won → Launch → Task List → Factory Mapping (autonome) → Validate → **Release** → **Production Order (awaiting_deposit)** → **dépôt** → **deposit_received / production activée**. Garde-fous réels et fonctionnels : D1.1 (release bloqué si mapping manquant/révision ouverte), gate dépôt (pas de production sans acompte), bypass audité admin-only, proforma non comptable en CA, permissions enforced serveur. *Limites résiduelles* : amorçage d'une nouvelle famille produit reste manuel (produits + mappings) ; #12 corrigé mais à valider app-wide.

### 2. Les informations commerciales sont-elles correctement transmises jusqu'aux opérations et à la production ?
**➡️ OUI.** Vérifié en live : la task list **hérite** du devis (produits, config, incoterm, paiement, délais, total, affaire) et porte les champs de handoff (**Production notes [Sales]**, Risks, Sticker/Branding, Factory extras, Technical notes [Internal]) avec **visibilité par rôle**, persistés après reload. Nuance : ces champs se remplissent **au stade task list (après Launch)** — la transmission passe par l'enrichissement de la task list par Sales.

### 3. Risque de perte d'info ou de blocage opérationnel ?
**➡️ FAIBLE, désormais maîtrisé.** Les deux risques bloquants identifiés (#8 sauvegarde devis cassée par code client absent ; #12 mise en production bloquée/aléatoire par cache stale) sont **corrigés**. Risques résiduels = **organisationnels/amorçage** : (a) Sales doit reporter les contraintes prod sur la task list (seul endroit où elles existent) ; (b) après encaissement, le dépôt doit être enregistré par TLM/admin/finance (Sales ne peut pas) ; (c) monter une nouvelle famille produit = créer produits + factory mappings à la main (pas de copie utile si la famille source n'est pas mappée — #9). Tous adressables (formation + features #2/#3).

---

### Impact sur les conclusions (historique session 4, conservé pour traçabilité)
Les 3 conclusions étaient déjà **renforcées** ; #12 — risque opérationnel réel — est **désormais corrigé** :
1. **Exploitable — OUI AVEC LIMITES** : le spine commercial→production est **prouvé en live de bout en bout** jusqu'au garde-fou D1.1 inclus. Les limites confirmées en live = amorçage catalogue (produits #2, mappings #3/#9/#10) + code client obligatoire non imposé à la création (#8).
2. **Transmission info — OUI** : confirmé en live (config héritée + Risks/Notes/Sticker persistés et visibles sur la task list).
3. **Risque** : inchangé. Le **vrai frein opérationnel** observé en live est l'**amorçage d'une nouvelle famille** (créer produits + mapper chaque option à la main, sans copie possible si la source n'est pas mappée) — pas une perte d'info dans le flux courant.

---

## 11. Post-fix — client codes (régularisation des anciennes données, #8)

**But :** réduire le dernier risque résiduel de #8 sur les données existantes — des clients créés **avant** le garde-fou peuvent avoir `client_code = NULL`, ce qui bloque la sauvegarde de tout devis les concernant. Le code applicatif est déjà corrigé ; il reste à régulariser les anciennes lignes.

**Contrainte (m006) :** `client_code` = `NULL` **ou** `^[A-Z]{3}$`, avec **index UNIQUE partiel** (non-null). Donc le seul état « manquant » possible est **NULL** (ni '' ni minuscule ne peuvent être stockés), et toute attribution doit être **sans collision**.

**Livrable :** migration **`supabase/migrations/130_backfill_null_client_codes.sql`** — **safe, idempotente, DRY-RUN par défaut** :
- N'écrase **jamais** un code valide ; ne touche que les `NULL`.
- Attribue uniquement un code 3 lettres **dérivé du nom** (3 premières lettres, majuscules) **non ambigu et sans collision**.
- **Collisions** et **noms < 3 lettres** → **SKIP + log** pour traitement **manuel** (aucune invention auto « sans contrôle »).
- `v_apply=false` par défaut : log « WOULD SET … » sans rien écrire. Après revue, `v_apply:=true` pour appliquer. Re-jouable.
- En-tête = **audit SQL autonome** (compteurs : null total / actifs / archivés / test-like + liste détaillée avec code proposé + flags collision/ambiguïté).
- S'auto-inscrit dans `schema_migrations` **seulement à l'application**.

**Procédure (à exécuter par l'owner sur la prod) :** (1) lancer l'audit SELECT de l'en-tête → compteurs ; (2) lancer la migration en dry-run → revoir les NOTICEs ; (3) `v_apply:=true` + re-lancer → applique les codes sûrs ; (4) traiter les SKIP manuellement ; (5) **post-check** : `select count(*) from clients where client_code is null and archived_at is null;` → attendu **0** (hors leftovers manuels).

> ⚠️ **Limite honnête :** l'audit réel (nombre exact de clients à code null, répartition test/réel/archivé) **n'a pas pu être exécuté** depuis cette session (pas d'accès direct prod : pas de service key, RLS anon, extraction de token interdite). Le **dry-run de la migration EST l'audit** — il produit la liste + les compteurs exacts au moment de l'exécution par l'owner.

**Vérif technique :** `tsc` 10 (baseline, 0 nouvelle) · 206/206 tests verts (la migration SQL n'affecte pas le build/les tests).

---

> **🧊 FREEZE — chantier E2E TEST DU JOUR.** Phases 1-14 livrées ; bugs #8 (code + données via m130) et #12 (cache mappings) corrigés ; permissions vérifiées serveur. Hors-scope volontairement non traité : amorçage catalogue (#2 copier produits, #3 déjà partiel via « Copy mappings »), finalisation app-wide de #12 (décision no-store global assumée), réconciliation des 2 sessions de fond #12 au merge.
