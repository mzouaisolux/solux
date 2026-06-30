# 01 — Inventaire de l'application

> Inventaire complet : modules, écrans, routes, objets métier, rôles, dashboards, menus, composants principaux.
> Source : arborescence `app/`, `lib/navigation.ts`, `lib/types.ts`, `lib/permissions.ts`, `supabase/migrations/`.

---

## 0. Vue d'ensemble technique

- **Framework** : Next.js 14 (App Router) — pages = Server Components, mutations = **Server Actions** (`"use server"` dans `actions.ts`).
- **Backend** : Supabase — PostgreSQL + **RLS (Row Level Security)** + Auth (JWT) + Storage (fichiers/PDF).
- **Sécurité à deux niveaux** : (1) **RLS** au niveau base (qui voit/écrit quelle ligne), (2) **capabilities** au niveau action serveur (`lib/permissions.ts`). Voir [07-Roles-and-Permissions.md](07-Roles-and-Permissions.md).
- **PDF** : `@react-pdf/renderer` (génération côté client au clic — voir Phase 5).
- **i18n** : système maison (`lib/i18n/`), EN par défaut + FR + ES partiel, cookie `solux_locale`.
- **Groupe de routes** : tout l'app authentifié est sous `app/(app)/` (layout commun avec Nav). `app/login/` est public. `middleware.ts` redirige les non-authentifiés.

---

## 1. Menus (navigation principale)

Source unique : `lib/navigation.ts:84` (`NAVIGATION`). Le méga-menu est rendu par `components/Nav.tsx` + `components/MegaMenu.tsx`. Chaque entrée déclare une **règle de visibilité** qui **miroite la garde de la route** (jamais une nouvelle règle d'accès).

| # | Catégorie (menu) | Lien direct | Groupes & items | Visibilité |
|---|---|---|---|---|
| 1 | **Dashboard** | `/dashboard` | — | `always` (tout utilisateur connecté) |
| 2 | **Clients & Projects** | `/clients` | **Future Clients** : Prospect Companies, Tender Inbox, Tender Pipeline | `capability: prospect.access` |
| | | | **Clients & Business** : Clients, New client, My service requests, New service request, New quotation | `always` / `project.create` / `quotation.create` |
| | | | **Reporting** : Forecast, Business overview | `always` |
| 3 | **Task Lists** | `/task-lists` | **Task lists** : All / Pending validation / Needs revision / Validated | `always` |
| | | | **Factory configuration** : Factory mapping | `capability: factory_mapping.access` |
| 4 | **Orders** | `/operations` | **Orders** : All orders, In Production, Shipping, Delivered, Finance — balances & LC, Archived | `always` (sauf Finance = `finance.view`) |
| 5 | **Catalog** | `/admin/products` | **Product catalog** : Products, Categories, Component mappings, Templates | `adminLike` / `technical` / `capabilityOrAdmin` |
| 6 | **Pricing** | — | **Costs** : Cost Entry · **Price lists** : Price Lists, Price List Library | `pricing.manage_costs`(+finance) / `pricing.manage` |
| 7 | **Admin** | — | **Access & permissions** : Users, Permissions, Roles & teams, Notifications | `admin.manage_users` / `admin.manage_permissions` / `adminLike` |
| | | | **Company settings** : Sales conditions, Bank accounts | `capabilityOrAdmin` |
| | | | **System** : Diagnostics | `capability: admin.diagnostics` |

> Le menu **se masque tout seul** : un item dont la visibilité échoue disparaît ; un groupe vide disparaît ; une catégorie sans item visible disparaît (`buildVisibleNavigation`, `lib/navigation.ts:468`).

---

## 2. Inventaire complet des routes / écrans

Légende accès : « connecté » = tout utilisateur authentifié (contenu filtré par RLS) ; sinon capability/rôle requis. Les gardes réelles vivent **dans chaque page** ; la colonne « Accès » résume la garde mirroitée par la navigation + la matrice du HANDOVER.

### 2.1 — Cœur & tableau de bord

| Route | Écran / Objectif | Accès | Fichier |
|---|---|---|---|
| `/` | Redirection vers `/dashboard` | connecté | `app/page.tsx` |
| `/login` | Connexion (Supabase Auth) | public | `app/login/page.tsx` |
| `/dashboard` | Tableau de bord (toggle Operations/Sales) | connecté | `app/(app)/dashboard/page.tsx` |
| `/dashboard/operations-v2` | Prototype cockpit Operations (sandbox) | connecté | `app/(app)/dashboard/operations-v2/page.tsx` |
| `/morning` | Vue « matin » (briefing) | connecté | `app/(app)/morning/page.tsx` |
| `/business` | Business overview (analytics commerciales, CA) | connecté (données personnelles) | `app/(app)/business/page.tsx` |
| `/forecast` | Prévisions pondérées | connecté (global si `forecast.view_global`) | `app/(app)/forecast/page.tsx` |

### 2.2 — Clients, Affaires, Contacts (CRM cœur)

| Route | Écran / Objectif | Accès | Fichier |
|---|---|---|---|
| `/clients` | Liste des clients (+ `?new=1` ouvre la modale de création) | connecté (RLS scoped) | `app/(app)/clients/page.tsx` |
| `/clients/[id]` | Client Hub (onglets : aperçu, affaires, documents par affaire, contacts, CRM, BL) | connecté (RLS scoped) | `app/(app)/clients/[id]/page.tsx` |
| `/clients/[id]/edit` | Édition client + champs personnalisés | connecté (propriétaire/admin) | `app/(app)/clients/[id]/edit/page.tsx` |
| `/affairs` | Liste des affaires (projets) | connecté (RLS scoped) | `app/(app)/affairs/page.tsx` |
| `/affairs/[id]` | Workspace d'affaire (documents, fichiers, versions, actions) | connecté (RLS scoped) | `app/(app)/affairs/[id]/page.tsx` |
| `/affairs-experimental` | Vue expérimentale des affaires | connecté | `app/(app)/affairs-experimental/page.tsx` |

### 2.3 — Service Requests (intake custom / appel d'offres) — table `project_requests`, routes `/projects`

| Route | Écran / Objectif | Accès | Fichier |
|---|---|---|---|
| `/projects` | Liste des Service Requests (`?mine=1` = les miennes) | connecté | `app/(app)/projects/page.tsx` |
| `/projects/new` | Création d'une Service Request | `project.create` | `app/(app)/projects/new/page.tsx` |
| `/projects/[id]` | Détail Service Request (cost/freight/packing/pricing) | connecté (selon rôle) | `app/(app)/projects/[id]/page.tsx` |
| `/projects/approvals` | File d'approbation Director | `project.approve` (Director/admin) | `app/(app)/projects/approvals/page.tsx` |
| `/projects/cost-requests` | File de saisie des coûts (Operations) | `project.enter_cost` | `app/(app)/projects/cost-requests/page.tsx` |
| `/projects/logistics-requests` | File logistique/packing/freight (Operations) | `project.enter_logistics` | `app/(app)/projects/logistics-requests/page.tsx` |

### 2.4 — Documents (Devis & Proformas) — table `documents`

| Route | Écran / Objectif | Accès | Fichier |
|---|---|---|---|
| `/documents/new` | Création d'un devis (quote builder) | `quotation.create` | `app/(app)/documents/new/page.tsx` |
| `/documents/[id]` | Détail document (devis ou proforma), statut, PDF, actions | connecté (RLS scoped) | `app/(app)/documents/[id]/page.tsx` |

### 2.5 — Task Lists & Factory Mapping — table `production_task_lists`

| Route | Écran / Objectif | Accès | Fichier |
|---|---|---|---|
| `/task-lists` | Liste des task lists (filtres `?status=`) | connecté | `app/(app)/task-lists/page.tsx` |
| `/task-lists/[id]` | Détail task list (config produit, technique, validation, révision) | connecté (édition selon rôle/statut) | `app/(app)/task-lists/[id]/page.tsx` |
| `/factory-mapping` | Configuration des mappings usine (option → instruction) | `factory_mapping.access` | `app/(app)/factory-mapping/page.tsx` |

### 2.6 — Production, Orders, Finance — tables `production_orders`, etc.

| Route | Écran / Objectif | Accès | Fichier |
|---|---|---|---|
| `/operations` | Liste des « Orders » (suivi production/expédition/livraison) | connecté (technique = éditable ; sinon vue read-only scoped) | `app/(app)/operations/page.tsx` |
| `/production/orders` | Liste des ordres de production | connecté (technique) | `app/(app)/production/orders/page.tsx` |
| `/production/orders/[id]` | Détail ordre (drawers : Production, Payment, Delay, Shipping, Documents) | technique (édition) / read-only sinon | `app/(app)/production/orders/[id]/page.tsx` |
| `/production/queue` | File « en attente de validation production » | technique | `app/(app)/production/queue/page.tsx` |
| `/order-follow-up` | Suivi de commande | connecté | `app/(app)/order-follow-up/page.tsx` |
| `/finance` | Balances & LC (lecture seule) | `finance.view` (finance/admin) ; DENY sales/tlm/ops | `app/(app)/finance/page.tsx` |
| `/cost-entry` | Saisie des coûts RMB par catégorie (versions auditées) | `pricing.manage_costs` / finance / admin | `app/(app)/cost-entry/page.tsx` |

### 2.7 — Prospects & Tenders (CRM sandbox — **prototype**, voir Phase 2)

| Route | Écran / Objectif | Accès | Fichier |
|---|---|---|---|
| `/prospects` | Prospect Companies + Tender Inbox (`?u=`, `?p=`) | `prospect.access` (sales/director/admin) | `app/(app)/prospects/page.tsx` |
| `/prospects/pipeline` | Pipeline des tenders acceptés | `prospect.access` | `app/(app)/prospects/pipeline/page.tsx` |
| `/prospects/tenders/[id]` | Tender Workspace (hero/KPIs/intelligence/winner/participants/docs/timeline) | `prospect.access` | `app/(app)/prospects/tenders/[id]/page.tsx` |

### 2.8 — Administration

| Route | Écran / Objectif | Accès | Fichier |
|---|---|---|---|
| `/admin/users` | Gestion des utilisateurs & assignation de rôles | `admin.manage_users` (**super_admin en pratique**) | `app/(app)/admin/users/page.tsx` |
| `/permissions` | Aperçu permissions | `admin.manage_permissions` | `app/(app)/permissions/page.tsx` |
| `/permissions/actions` | Matrice rôle × capability (édition) | `admin.manage_permissions` (**super_admin**) | `app/(app)/permissions/actions/page.tsx` |
| `/permissions/teams` | Équipes, membres, scopes (access_grants) | `admin.manage_permissions` | `app/(app)/permissions/teams/page.tsx` |
| `/admin/products` | Catalogue produits (liste) | `admin.manage_products`/`admin.manage_categories`/admin | `app/(app)/admin/products/page.tsx` |
| `/admin/products/[id]` | Édition produit | adminLike | `app/(app)/admin/products/[id]/page.tsx` |
| `/admin/products/grid` | Grille produits | adminLike | `app/(app)/admin/products/grid/page.tsx` |
| `/admin/products/images` | Upload d'images produits | adminLike | `app/(app)/admin/products/images/page.tsx` |
| `/admin/products/import` | Import produits | adminLike | `app/(app)/admin/products/import/page.tsx` |
| `/admin/categories` | Catégories (= familles) + champs de config | adminLike | `app/(app)/admin/categories/page.tsx` |
| `/admin/categories/[id]` | Édition catégorie + éditeur de champs | adminLike | `app/(app)/admin/categories/[id]/page.tsx` |
| `/admin/components` | Component mappings (commercial → interne) | `technical` | `app/(app)/admin/components/page.tsx` |
| `/admin/pricing` | Price Lists (création) | `pricing.manage` / admin | `app/(app)/admin/pricing/page.tsx` |
| `/admin/pricing/library` | Bibliothèque de listes de prix (gérer/assigner/publier) | `pricing.manage` / admin | `app/(app)/admin/pricing/library/page.tsx` |
| `/admin/pricing/dashboard` | Tableau de bord pricing | `pricing.manage` / admin | `app/(app)/admin/pricing/dashboard/page.tsx` |
| `/admin/pricing/prices` | Saisie de prix | `pricing.manage` / admin | `app/(app)/admin/pricing/prices/page.tsx` |
| `/admin/pricing/[id]` | Détail liste de prix | `pricing.manage` / admin | `app/(app)/admin/pricing/[id]/page.tsx` |
| `/admin/banks` | Comptes bancaires (PDF) | `admin.manage_banks` / admin | `app/(app)/admin/banks/page.tsx` |
| `/admin/banks/[id]` | Édition compte bancaire | admin | `app/(app)/admin/banks/[id]/page.tsx` |
| `/admin/sales-conditions` | Conditions de vente (PDF) | `admin.manage_sales_conditions` / admin | `app/(app)/admin/sales-conditions/page.tsx` |
| `/admin/sales-conditions/[id]` | Édition condition de vente | admin | `app/(app)/admin/sales-conditions/[id]/page.tsx` |
| `/admin/notifications` | Règles de notification (bell) par rôle × event | adminLike | `app/(app)/admin/notifications/page.tsx` |
| `/admin/diagnostics` | Diagnostics (santé, migrations, lifecycle, inspector, settings) | `admin.diagnostics` (super_admin) | `app/(app)/admin/diagnostics/page.tsx` |
| `/admin/diagnostics/reset` | Reset de données (dev) | super_admin | `app/(app)/admin/diagnostics/reset/page.tsx` |
| `/admin/diagnostics/tender-merge` | Fusion de tenders (dédup) | super_admin/admin | `app/(app)/admin/diagnostics/tender-merge/page.tsx` |

### 2.9 — Routes API & utilitaires

| Route | Objectif | Fichier |
|---|---|---|
| `/api/documents/[id]/pdf` | Génération/récupération du PDF d'un document | `app/api/documents/[id]/pdf/route.ts` |
| `/api/conversations/[entity_type]/[entity_id]` | Fil de conversation d'une entité (messages) | `app/api/conversations/[entity_type]/[entity_id]/route.ts` |
| `/api/attachments/[id]/download` | Téléchargement d'une pièce jointe | `app/api/attachments/[id]/download/route.ts` |
| `/view-as` (action) | Bascule de rôle simulé (super_admin) | `app/(app)/view-as/actions.ts` |

> **Routes observées hors-spec / héritées** : `/morning`, `/order-follow-up`, `/affairs-experimental`, `/dashboard/operations-v2`, `/admin/permissions` (dossier présent). Leur statut « actif vs hérité » est **TO BE VALIDATED** (certaines sont des prototypes/sandbox).

---

## 3. Modules fonctionnels

Regroupement métier (détaillé dans [02-Modules/](02-Modules/)).

| Module | Rôle métier | Routes principales | Table(s) clé(s) |
|---|---|---|---|
| **Clients & Contacts** | Référentiel client + contacts | `/clients` | `clients`, `contacts` |
| **Affaires (Projects)** | Conteneur d'opportunité | `/affairs` | `affairs` |
| **Service Requests** | Intake custom/AO → devis | `/projects` | `project_requests`, `factory_cost_requests`, `packing_list_requests`, `freight_cost_requests`, `logistics_requests`, `project_products` |
| **Documents (Devis & Proformas)** | Offres chiffrées + commandes | `/documents` | `documents`, `document_lines` |
| **Task Lists** | Feuille d'atelier + validation | `/task-lists` | `production_task_lists`, `production_task_list_lines` |
| **Factory Mapping** | Config commerciale → instruction usine | `/factory-mapping` | `factory_mappings`, `config_fields`, `config_field_options` |
| **Production Orders / Operations** | Suivi production/expédition | `/operations`, `/production/orders` | `production_orders`, `production_deadline_changes`, `delay_events`, `order_documents` |
| **Finance** | Balances, dépôts, LC (lecture) | `/finance` | `production_orders` (champs paiement) |
| **Cost Entry / Pricing** | Coûts RMB + listes de prix | `/cost-entry`, `/admin/pricing` | `price_lists`, `price_list_margins`, `category_cost_versions` |
| **Catalog** | Produits, catégories, composants | `/admin/products`, `/admin/categories`, `/admin/components` | `products`, `product_categories`, `config_fields`, `component_mappings` |
| **Prospects & Tenders** | CRM amont (AO, intelligence) — *prototype* | `/prospects` | `prospects`, `tenders`, `attributions`, … |
| **Dashboards & Action Center** | Synthèse, files d'action, feeds | `/dashboard`, `/business`, `/forecast` | `events`, `event_comments`, `event_reads` |
| **Notifications & Conversations** | Cloche + fils de discussion | (transverse) | `notification_rules`, `entity_messages` |
| **Reminders** | Rappels (devis, balance) | (transverse) | `quotation_reminders`, … |
| **Admin & Permissions** | Utilisateurs, rôles, matrice, équipes | `/admin/*`, `/permissions/*` | `user_roles`, `permissions`, `role_permissions`, `teams`, `team_members`, `access_grants` |
| **Audit / Events** | Journal d'événements immuable | (transverse) | `events`, `event_comments` |

---

## 4. Objets métier (recensement)

Détail dans [03-Business-Objects/](03-Business-Objects/). Source : `lib/types.ts` + migrations.

| Objet | Table | Statuts (enum) | Réf. type |
|---|---|---|---|
| **Client** | `clients` | (actif / `archived_at`) | `lib/types.ts:1310` |
| **Contact** | `contacts` | — | (m101) |
| **Affaire / Project** | `affairs` | lead, … (m077) | — |
| **Service Request** | `project_requests` | 11 statuts (draft→…→won/lost/cancelled) | `lib/types.ts:106` |
| **Sous-requêtes** | `factory_cost_requests`, `packing_list_requests`, `freight_cost_requests`, `logistics_requests` | pending/completed/cancelled | `lib/types.ts:150` |
| **Project Product** | `project_products` | — | `lib/types.ts:307` |
| **Document (Devis/Proforma)** | `documents` | draft, sent, negotiating, won, lost, cancelled | `lib/types.ts:1392` |
| **Ligne de document** | `document_lines` | — | `lib/types.ts:1430` |
| **Task List** | `production_task_lists` | draft, under_validation, needs_revision, validated, production_ready, cancelled | `lib/types.ts:772` |
| **Ligne de task list** | `production_task_list_lines` | — | `lib/types.ts:861` |
| **Factory Mapping** | `factory_mappings` | (active) | `lib/types.ts:601` |
| **Production Order** | `production_orders` | awaiting_deposit → … → delivered (+ cancelled) | `lib/types.ts:881` |
| **Order Document** | `order_documents` | (versions + archive) | `lib/types.ts:979` |
| **Produit** | `products` | (active) | `lib/types.ts:383` |
| **Catégorie produit** | `product_categories` | — | `lib/types.ts:445` |
| **Champ de config** | `config_fields` (+`config_field_options`) | (active) | `lib/types.ts:548` |
| **Composant (mapping)** | `component_mappings` | (active) | `lib/types.ts:586` |
| **Price List** | `price_lists` (+`price_list_margins`, `price_list_assignments`) | draft, published, archived | `lib/types.ts:399` |
| **Compte bancaire** | `bank_accounts` | (default) | `lib/types.ts:1341` |
| **Condition de vente** | `sales_conditions` | (default) | `lib/types.ts:1334` |
| **Event (audit)** | `events` (+`event_comments`, `event_reads`) | open, acknowledged, working, waiting, escalated, resolved | `lib/events-shared.ts:33` |
| **Message d'entité** | `entity_messages` | — | (m049) |
| **Utilisateur/rôle** | `user_roles` (role + super_admin) | — | `lib/types.ts:9` |
| **Permission/capability** | `permissions`, `role_permissions` | — | `lib/permissions.ts:51` |
| **Équipe** | `teams`, `team_members` | — | (m105) |
| **Grant de visibilité** | `access_grants` | self/team/region/lens/all | `lib/visibility.ts:37` |

---

## 5. Rôles

Source : `lib/types.ts:9` (`Role`). 6 rôles stockables + `super_admin` (booléen séparé). Détail dans [07-Roles-and-Permissions.md](07-Roles-and-Permissions.md).

| Rôle | Valeur DB | Résumé |
|---|---|---|
| Super Admin | `super_admin` (flag) | Tout, dont users/permissions/diagnostics + « View As ». Seul `mzouai@`. |
| Admin | `admin` | Master-data (catalogue, pricing, banks, conditions, notifications) + tous workflows. PAS users/permissions/diagnostics. |
| Sales Director | `sales_director` | Superviseur commercial : validation-review + réassignation d'ownership ; voit toute la donnée commerciale (m132). |
| Sales | `sales` | Crée/gère ses clients, affaires, devis ; soumet les task lists. |
| Task List Manager | `task_list_manager` | Valide/révise/release les task lists, factory mappings, enrichissement technique. |
| Operations | `operations` | Même périmètre technique que TLM + édition des production orders. |
| Finance | `finance` | `/finance` (lecture) + `/cost-entry` (écriture coûts). Pas d'action workflow. |

**Helpers de rôle** (`lib/types.ts`) : `isAdminLike` = admin·super_admin ; `isTechnicalRole` = isAdminLike·task_list_manager·operations ; `canSupervise` = isAdminLike·sales_director.

---

## 6. Dashboards

| Dashboard | Route | Description |
|---|---|---|
| **Dashboard principal** | `/dashboard` | Cockpit à bascule. « Today's Work » (Blocked / Action Required / At Risk) + « Orders In Flight ». Lentille selon le rôle. |
| **Operations v2 (sandbox)** | `/dashboard/operations-v2` | Prototype destiné à remplacer le contenu du toggle Operations. |
| **Morning** | `/morning` | Briefing matinal. (statut actif/hérité **TO BE VALIDATED**) |
| **Business overview** | `/business` | Analytics commerciales : CA (= devis gagnés), win rate, pipeline. Personnel par défaut. |
| **Forecast** | `/forecast` | Prévisions pondérées. Global si `forecast.view_global`. |
| **Production queue** | `/production/queue` | File « en attente de validation production » (statut `under_validation`). |

---

## 7. Composants principaux

Recensement des composants structurants (`components/`). Détail d'usage dans les modules.

### Navigation & shell
`Nav.tsx`, `MegaMenu.tsx`, `NavIcons.tsx`, `NotificationBell.tsx`, `ViewAsSwitcher.tsx`, `RoleContextBanner.tsx`, `NoRoleNotice.tsx`, `OperationsAlertBadge.tsx`.

### Documents / Devis
`QuotationPDF.tsx`, `CommercialInvoicePDF.tsx`, `FactoryPDF.tsx`, `DocQuickActions.tsx`, `DocStatusActions.tsx`, `InlineStatusSwitcher.tsx`, `ProductConfigurator.tsx`, `documents/ProductSummaryCard.tsx`, `documents/QuotationVersionsPanel.tsx`, `documents/RiskFlagsEditor.tsx`, `documents/StickerRequirementsEditor.tsx`, `documents/ValidationHistory.tsx`.

### Task Lists / Validation
`TaskListWorkflow.tsx`, `WorkflowStepper.tsx`, `validation/ValidationPanel.tsx`, `MarkProductionCompleteButton.tsx`, `StartWithoutDepositButton.tsx`.

### Affaires / Clients
`affairs/AffairDetail.tsx`, `affairs/AffairWorkspace.tsx`, `affairs/AffairDocumentsCard.tsx`, `affairs/AffairFilesCard.tsx`, `affairs/AffairQuotations.tsx`, `affairs/ProjectActionsMenu.tsx`, `affairs/NewProjectPanel.tsx`, `affairs/AssignDocumentPanel.tsx`, `affairs/OwnerAssignSelect` (`OwnerAssignSelect.tsx`), `clients/ClientHubTabs.tsx`, `clients/ClientAffairTree.tsx`, `clients/ClientDocumentsByAffaire.tsx`, `clients/ClientContactsCard.tsx`, `clients/ClientBlEditor.tsx`, `clients/RequestBlInfoButton.tsx`.

### Production / Orders
`production/ShippingDocumentsCard.tsx`, `production/DelayTimelineCard.tsx`, `production/DelayEventForm.tsx`, `production/LiveStatusSidebar.tsx`, `production/OrderOperationsStrip.tsx`, `production/CollapsibleSection.tsx`, `ProductionOrderBadges.tsx`, `OrderStageBadge.tsx`, `OrderConfigSummary.tsx`.

### Dashboards / Action Center
`dashboard/OperationsCockpit.tsx`, `dashboard/TodaysWorkBoard.tsx`, `dashboard/OrdersInFlight.tsx`, `dashboard/OperationsFeed.tsx`, `dashboard/ActivityFeed.tsx`, `dashboard/EventDetailDrawer.tsx`, `dashboard/EventDiscussionPanel.tsx`, `dashboard/KpiCard.tsx`, `dashboard/PipelineChart.tsx`, `dashboard/WinRateDonut.tsx`, `action-center/ActionCenter.tsx`, `Timeline.tsx`.

### Prospects / Tenders
`prospects/ProspectsPanel.tsx`, `prospects/TendersPanel.tsx`, `prospects/TendersManager.tsx`, `prospects/TenderPipeline.tsx`, `prospects/TenderDrawer.tsx`, `prospects/AttributionsPanel.tsx`, `prospects/RememberDiscoveryView.tsx`.

### Forecast / Reminders / Chat / Attachments
`forecast/ForecastWorkspace.tsx`, `forecast/ManagementForecastPanel.tsx`, `reminders/MyRemindersPanel.tsx`, `reminders/ReminderPicker.tsx`, `chat/ConversationDrawer.tsx`, `chat/ConversationLauncher.tsx`, `attachments/AttachmentsPanel.tsx`, `attachments/AttachmentUploader.tsx`.

### Permissions / Admin
`AdminTabs.tsx`, `permissions/GrantForm.tsx`, `ScopeTabs.tsx`, `StatusBadge.tsx`, `AccessDenied.tsx`.

### Feedback / i18n / formulaires
`feedback/Toaster.tsx` (+ `toast-store.ts`), `feedback/ActionForm.tsx`, `SubmitButton.tsx`, `i18n/I18nProvider.tsx`, `i18n/LanguageSwitcher.tsx`, `forms/CountrySelect.tsx`, `forms/PhoneField.tsx`.

---

## 8. Catalogue des capabilities (permissions d'action)

Source : `lib/permissions.ts:51`. Détail des affectations par rôle dans [07-Roles-and-Permissions.md](07-Roles-and-Permissions.md).

| Domaine | Capabilities |
|---|---|
| Quotation | `quotation.create`, `quotation.cancel`, `quotation.archive`, `quotation.delete` |
| Task List | `task_list.validate`, `task_list.reject`, `task_list.archive`, `task_list.delete`, `task_list.sync_orphans` |
| Factory mapping | `factory_mapping.access` |
| Production Order | `production_order.edit_status`, `.edit_deadline`, `.edit_payments`, `.edit_shipment`, `.set_timeline`, `.start_without_deposit`, `.archive`, `.delete` |
| Forecast | `forecast.view_global` |
| Service Request (project) | `project.create`, `.approve`, `.enter_cost`, `.enter_logistics`, `.set_pricing`, `.generate_quotation`, `.view_cost`, `.override_cost` |
| Prospects | `prospect.access` |
| Finance | `finance.view` |
| Admin | `admin.manage_permissions`, `admin.manage_users`, `admin.diagnostics`, `admin.manage_products`, `admin.manage_categories`, `admin.manage_banks`, `admin.manage_sales_conditions` |
| Pricing | `pricing.manage`, `pricing.manage_costs` |

---

## 9. Services applicatifs (`lib/`) — index

| Domaine | Fichiers `lib/` |
|---|---|
| Auth & permissions | `auth.ts`, `permissions.ts`, `visibility.ts`, `access-labels.ts`, `owner.ts`, `user-display.ts` |
| Types & constantes | `types.ts`, `navigation.ts`, `service-types.ts`, `countries.ts`, `geo.ts`, `normalize.ts` |
| Documents / pricing | `pricing-engine.ts`, `pricing.ts`, `price-lists.ts`, `pricing-settings.ts`, `pdf-filename.ts`, `pdfFonts.ts`, `payment.ts`, `validation.ts`, `commission.ts` |
| Task lists / factory | `task-list-mapping-status.ts`, `task-list-mapping-server.ts`, `factory-mapping-clone.ts`, `factory-extras.ts` |
| Production / ops | `production-lifecycle.ts`, `lifecycle.ts`, `lifecycle-v2.ts`, `delays.ts`, `shipping.ts`, `shipping-docs.ts`, `bl.ts`, `logistics.ts`, `working-days.ts`, `operations-alerts.ts`, `order-severity.ts`, `order-pills.ts`, `risks.ts` |
| Service Requests | `project-pricing.ts`, `project-dashboard.ts`, `project-queue.ts`, `freight-validity.ts` |
| CRM / prospects | `client-affairs.ts`, `affairs-prototype.ts`, `tender-identity.ts`, `tender-discovery.ts`, `prospect-intel.ts`, `attribution-parse.ts`, `sales-filter.ts` |
| Events / notifs / dashboards | `events.ts`, `events-shared.ts`, `notifications.ts`, `notification-catalog.ts`, `action-center.ts`, `dashboard-items.ts`, `dashboard-operations-config.ts`, `reminders.ts`, `nav-badges.ts`, `entity-messages.ts`, `entity-messages-shared.ts`, `conversation-context.ts` |
| Forecast | `forecast.ts`, `forecast-data.ts` |
| Fichiers / divers | `attachments.ts`, `stickers.ts`, `csv.ts`, `xlsx.ts`, `status-colors.ts`, `project-status-colors.ts`, `app-settings.ts`, `product-sort.ts` |
| Supabase | `supabase/client.ts`, `supabase/server.ts`, `supabase/middleware.ts` |
| i18n | `i18n/index.ts`, `i18n/server.ts`, `i18n/en.ts`, `i18n/fr.ts`, `i18n/es.ts` |

---

*Fin de l'inventaire. Les détails par module suivent dans [02-Modules/](02-Modules/).*
</content>
