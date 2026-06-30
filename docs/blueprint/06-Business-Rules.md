# 06 — Règles métier

> Toutes les règles métier de l'application, organisées par domaine. Pour chaque règle : l'**énoncé**, **où** elle est appliquée (application = server action, RLS = base de données, trigger = base de données), et un **marqueur de fiabilité**.

> **Lieu d'application** — pourquoi c'est important : une règle appliquée en **application** (server action) peut être contournée par un accès SQL direct ; une règle **RLS** ou **trigger** est inviolable même en SQL direct. Voir [07-Roles-and-Permissions.md](07-Roles-and-Permissions.md) §1.

---

## 1. Clients & Affaires

| # | Règle | Lieu | Fiab. |
|---|---|---|---|
| C1 | Un **code client de 3 lettres** (`^[A-Z]{3}$`) est **obligatoire** — sans lui, aucun document n'est numérotable (le RPC de numérotation lève une exception). | application + RPC | [V] |
| C2 | Tout **devis/proforma doit être rattaché à une affaire** (`affair_id`), sauf une révision ou un edit-in-place qui héritent. | application (`saveDocument`) | [V] |
| C3 | La hiérarchie **Client → Affaire → Service Request** est **stricte** : `project_requests.affair_id` est NOT NULL avec FK `ON DELETE RESTRICT` (m124). | RLS / contrainte | [V] |
| C4 | La **réassignation d'un propriétaire** (client/affaire/document) est réservée à `canSupervise` (Sales Director / Admin). | application | [V] |
| C5 | Un **client ne peut être supprimé** s'il a des documents/orders liés → on propose l'archivage. La suppression permanente est réservée au **super_admin** et refusée s'il existe de l'historique financier. | application + RPC | [V] |
| C6 | Une **affaire ne peut être supprimée** s'il existe ≥1 document lié. L'archivage exige une **raison**. | application | [V] |
| C7 | Un seul **contact primary** par client (la promotion démote l'ancien). | application | [V] |
| C8 | **Règle d'or** : une affaire vivante doit toujours porter une prochaine action datée (sinon signalée en rouge au dashboard). | application (visuel) | TO BE VALIDATED (non contrainte) |

---

## 2. Documents (Devis & Proformas)

| # | Règle | Lieu | Fiab. |
|---|---|---|---|
| D1 | Un **devis envoyé n'est jamais édité en place** : toute modification crée une **nouvelle version** (V2/V3). L'édition-en-place est réservée aux **drafts**. | application | [V] |
| D2 | Le **numéro de document est immuable** (l'édition-en-place préserve number/status/created_by). | application | [V] |
| D3 | Une **proforma ne peut JAMAIS être marquée `won`** (ce serait un double comptage du CA). | application | [V] |
| D4 | Un **devis `won` ne peut pas redevenir éditable** si une production existe ; sinon réservé aux admin-like (garde H1). | application | [V] |
| D5 | Un **devis annulé/perdu ne se rouvre pas** s'il a des enfants annulés → « créer une nouvelle version » (garde H2). | application | [V] |
| D6 | Un **devis avec task list ou production order ne peut pas être supprimé** (Decision F / m078) ; un devis `won` non plus, sauf admin (et sans production). | application + RLS (m078) | [V] |
| D7 | La **validation advisory** (m068) informe mais **ne bloque jamais** l'envoi ni le gain. | application | [V] |
| D8 | L'**annulation d'un devis cascade** (trigger DB m023) : annule les task lists + orders liés (sauf delivered) et émet les events critiques. **Inviolable** même en SQL direct. | trigger DB | [V] |
| D9 | Les **conditions de paiement** doivent être valides à la sauvegarde (deposit 0-100 + balance_condition ; lc_type requis ; etc.). | application (`lib/payment.ts`) | [V] |
| D10 | Le **CA = devis gagnés uniquement** (`type=quotation AND status=won`) ; la proforma est exclue partout (business, dashboard, analytics). | application | [V] |

---

## 3. Task Lists & Factory Mapping

| # | Règle | Lieu | Fiab. |
|---|---|---|---|
| T1 | Une **task list ne se crée que depuis une proforma** (`type='proforma'`), jamais depuis un devis. | application | [V] |
| T2 | Le **Sales ne peut éditer** (header/lignes/risques/stickers) **que** si la task list est `draft` ou `needs_revision` (verrou `TASK_LIST_LOCKED_FOR_SALES`). | application | [V] |
| T3 | La **release** (validate/mark-ready) n'est autorisée **que si les 4 conditions** du gate `evaluateRelease` sont vraies : (1) statut autorisé, (2) **≥1 ligne produit** (fix S1.4), (3) **aucune révision ouverte**, (4) **0 mapping usine manquant**. | application (serveur **et** UI) | [V] |
| T4 | Une **demande de révision** exige une **catégorie + un message** ; une **re-soumission** exige une **réponse**. | application | [V] |
| T5 | Les **valeurs techniques / overrides / mappings** ne sont éditables que par les rôles techniques. | application | [V] |
| T6 | Un **mapping usine manquant bloque la release** (résolution en couches : override > preset client > global > missing). | application | [V] |
| T7 | À la validation, un **production order est créé automatiquement** (idempotent, 1 par task list). | application | [V] |
| T8 | L'**écriture d'un factory mapping** exige `factory_mapping.access` du menu jusqu'à la **RLS** (m088). | application + RLS | [V] |

---

## 4. Production Orders & Paiement

| # | Règle | Lieu | Fiab. |
|---|---|---|---|
| P1 | La **date d'achèvement initiale** (`initial_production_deadline`) est **immuable** une fois posée ; seule la date courante bouge. | application | [V] |
| P2 | La **baseline (jours ouvrés) est verrouillée à l'activation** ; son édition est refusée serveur (`baseline_locked_at`). | application | [V] |
| P3 | **Auto-advance dépôt** : enregistrer un dépôt ≥ seuil fait passer `awaiting_deposit → deposit_received`, gèle la baseline. Seulement si dépôt attendu > 0. | application | [V] |
| P4 | **Start without deposit** = **admin uniquement** + **raison obligatoire** + idempotent (refuse la ré-activation). | application | [V] |
| P5 | Confirmer la **réservation d'expédition** (booking) exige un **profil BL complet**. | application | [V] |
| P6 | Le **solde** n'a aucun effet automatique sur le statut (la production pilote shipment/delivery). | application | [V] |
| P7 | **Production complete status-led** : atteindre un statut de `PRODUCTION_COMPLETED_STATUSES` stampe `actual_completion_date` **une fois**. | application | [V] |
| P8 | L'**échéance du solde est dérivée** (override manuel → deadline → ETA+LC → ETA → null) et suit automatiquement les changements. | application | [V] |
| P9 | Un retard ne compte comme **faute usine** (KPIs) que s'il est de catégorie `production`. | application | [V] |

---

## 5. Service Requests

| # | Règle | Lieu | Fiab. |
|---|---|---|---|
| S1 | Une Service Request doit avoir un **client** (sauf tender) et exactement une **affaire** ; re-vérifié avant pricing/génération de devis. | application | [V] |
| S2 | **Quantité obligatoire** si packing/freight demandé ; transport + destination obligatoires si freight. | application | [V] |
| S3 | Le **coût usine RMB est caché aux Sales** — double verrou : capability `project.view_cost=false` **+** RLS role-only sur `factory_cost_requests`. | application + RLS | [V] |
| S4 | L'**override du coût** (Director) exige une **raison** et est **audité** (append-only). | application | [V] |
| S5 | La demande passe à `ready_for_pricing` **dès que tous les enfants requis** sont `completed`. | application | [V] |
| S6 | Le **freight dérive du packing** (source de vérité des conteneurs) ; seul le taux/unité est saisi. | application | [V] |
| S7 | Pas de pôle (`pole_required=false`) → prix pôle = 0. | application | [V] |
| S8 | Le **devis est généré depuis le Project Product** (snapshot 1:1), jamais d'un produit catalogue. | application | [V] |

---

## 6. Finance & Pricing

| # | Règle | Lieu | Fiab. |
|---|---|---|---|
| F1 | La page **`/finance` est en lecture seule** (RLS finance = SELECT-only ; l'UI cache les formulaires). | RLS + application | [V] |
| F2 | **Cost Entry = coûts RMB uniquement** (les marges/prix vivent dans Pricing). | application | [V] |
| F3 | Une **liste de prix publiée** alimente le quote builder ; une draft non. Résolution : liste publiée assignée au vendeur, sinon dernière publiée de la catégorie. | application | [V] |
| F4 | ⚠️ La **« version de coût » est documentaire** : `publishPrices` recalcule toujours sur le **coût courant**, jamais sur le `cost_batch_id` → la liste ne fige **pas** son coût. | application | TO BE VALIDATED (règle implicite non implémentée) |
| F5 | Le **moteur de pricing** vise une marge **après taxe** : `price = usdCost·(1−taxRebate)/(1−margin)`. | application | [V] |
| F6 | Les **master-data** (catalog/pricing/banks/conditions) ne sont **pas auditées** (aucun event). | — | [V] (constat) |

---

## 7. Permissions & Visibilité

| # | Règle | Lieu | Fiab. |
|---|---|---|---|
| R1 | Toute action privilégiée appelle **`requireCapability`** (rôle **réel**) avant la mutation. | application | [V] |
| R2 | La **matrice `role_permissions` est en écriture super_admin only** (RLS), même si on accorde `admin.manage_permissions` à un admin. | RLS | [V] |
| R3 | L'**assignation de rôle** (`admin_set_user_role`) est **super_admin only** et refuse l'auto-édition ; le **dernier super_admin** ne peut être désactivé. | RPC | [V] |
| R4 | `user_roles` en **lecture self-only** (un user ne lit pas le rôle des autres). | RLS | [V] |
| R5 | `user_profiles` en **écriture admin-only** (un user ne change pas son display_name). | RLS | [V] |
| R6 | **View-As** (super_admin) n'affecte que le **rendu** ; la sécurité et la RLS utilisent le **vrai** rôle → conclusions de sécurité tirées sous View-As **invalides**. | application | [V] |
| R7 | Visibilité **clients/affaires scopée** (created_by/sales_owner_id/technique/auteur-de-doc/manager-équipe) ; + finance (read) ; + sales_director org-wide (m132). | RLS | [V] |
| R8 | Les **suppressions physiques permanentes** sont réservées au **super_admin** (`requireSuperAdmin`). | application + RPC | [V] |

---

## 8. Règles transverses (intégrité)

| # | Règle | Lieu | Fiab. |
|---|---|---|---|
| X1 | Les **événements sont immuables** (INSERT only ; jamais UPDATE/DELETE de la ligne). | RLS | [V] |
| X2 | Le **snapshot produit** (m089) gèle name/sku/category sur les lignes → un produit supprimé/renommé ne casse jamais l'historique. | trigger DB | [V] |
| X3 | L'**émission d'event est best-effort** : une panne du journal ne bloque jamais l'action métier. | application | [V] |
| X4 | **Aucun job d'arrière-plan / email / cron** : tout est dérivé à la lecture (SSR). | architecture | [V] |
| X5 | Le **PDF browser-only** ne doit jamais être importé au niveau module (fix F3, sinon SSR 500). | application | [V] |

---

## Annexe — Incohérences connues (TO BE VALIDATED)

Ces règles **implicites** ou **incohérences** méritent une validation métier (issues des rapports d'analyse) :
1. **Gating page-vs-action** incohérent sur plusieurs pages admin (page `isAdminLike` vs action capability).
2. **Matrice vs RLS non alignées** : `pricing.manage`, `admin.manage_banks/sales_conditions` délégables côté code mais RLS plus strictes (write admin-only) → un délégataire passe le gate puis est bloqué en base.
3. **Réassignation d'owner** : autorisée serveur pour `sales_director` (`canSupervise`) mais cachée UI (`isTechnicalRole`) + RPC picker management-only.
4. **`admin_set_user_role`** (m029) : CHECK 3 rôles vs 6 `ASSIGNABLE_ROLES` — assignation des rôles tardifs (sales_director/operations/finance) à vérifier en prod.
5. **`access_grants.expires_at`** lu par l'engine mais **jamais écrit** par l'UI (délégation temporaire morte).
6. **Service Request** : statut `submitted` jamais écrit ; `setProjectOutcome won` sans garde « priced ».
7. **`tl.reopened`** catalogué mais jamais émis.
8. **Prospects/Tenders** : prototype non testé E2E ; bug `action-center.ts:907` (statut `quotation_requested` obsolète) ; tender-merge dry-run only (pas d'`applyMerge`).
9. La **matrice live peut diverger du seed** (vulnérabilité priv-esc TLM résolue 2026-06-20) — toute décision de sécurité doit recouper l'état réel en base.
</content>
