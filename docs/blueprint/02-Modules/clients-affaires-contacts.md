# Module — Clients · Affaires (Projects) · Contacts

> Le référentiel CRM cœur. Hiérarchie : **Client → Affaire → {Documents, Task Lists, Service Requests}**.

## Objectif métier
Centraliser les entreprises clientes, structurer chaque opportunité commerciale dans une **Affaire** (le conteneur du deal), et y rattacher tout le travail (devis, commandes, demandes de service, fichiers, contacts, actions à faire). C'est le point d'entrée unique : le **Client Hub** (`/clients/[id]`) agrège toute la vie commerciale d'un client.

## Utilisateurs (rôles)
- **Sales** : crée/gère **ses** clients, affaires, contacts (RLS own-only).
- **Sales Director / Admin / Super Admin** : voient toute la donnée commerciale (m132 / technique) ; **réassignent** les propriétaires (`canSupervise`).
- **Task List Manager / Operations** : voient les clients/affaires (rôle technique) pour le travail de production.
- **Finance** : lecture seule (m119).

## Écrans / Routes
| Route | Objectif |
|---|---|
| `/clients` | Liste des clients (scopes Active/All/Archived), vue cartes CRM ou arbre d'affaires ; `?new=1` ouvre la création |
| `/clients/[id]` | **Client Hub** — 6 onglets : overview, affairs, documents (par affaire), messages, contacts, activity |
| `/clients/[id]/edit` | Édition fiche + champs personnalisés |
| `/affairs/[id]` | **Affair Workspace** — documents, fichiers, versions, actions planifiées, source |
| `/affairs` | Redirige vers `/clients` (entrée unique, décision owner) |

## Données manipulées (tables)
- **`clients`** : `company_name`, `client_code` (3 lettres `^[A-Z]{3}$`, dans chaque numéro `SLX-{code}-{YY}-{NNN}`), `created_by` (propriétaire-créateur), `sales_owner_id` (account manager assignable), `address`, `vat_number`, `default_attention_to`, `bl_profile` (jsonb), `custom_fields` (jsonb), `archived_at`.
- **`affairs`** : `name`, `status` (lead → opportunity → quotation → negotiation → won → in_production → shipped → completed, + lost/abandoned), `client_id`, `owner_id`, `created_by`, `description`, `source` (9 valeurs : tender, prospecting, referral, existing_customer_opportunity, partner, website_inquiry, exhibition_event, direct_request, other), `archived_at` (+ reason obligatoire).
- **`contacts`** (m101) : plusieurs personnes par client (`name`, `title`, `email`, `phone`, `is_primary`) ; `ON DELETE CASCADE` du client.
- **`planned_actions`** (m103) : prochaines actions datées (`action_type`, `title`, `due_date` obligatoire, `done_at`).

## Actions principales
- `createClientAction` — code 3 lettres + nom obligatoires ; **redirect serveur** + toast (fix F6).
- `createAffair` / `quickCreateAffair` — création d'affaire (page + inline « + New Project » depuis le quote builder).
- `assignClientOwner` / `setAffairOwner` — **réassignation réservée à `canSupervise`** ; `setAffairOwner` propage `sales_owner_id` aux documents de l'affaire.
- CRUD contacts ; CRUD planned_actions ; édition BL profile ; archive/delete (3 mécanismes, voir Règles).

## Règles clés (détail en [../06-Business-Rules.md](../06-Business-Rules.md))
- **`client_code` 3 lettres obligatoire** (sinon aucun devis numérotable).
- **`affair_id` obligatoire** sur tout devis (m124) ; hiérarchie Client → Affaire → Service Request **stricte** (NOT NULL + FK RESTRICT).
- **Réassignation d'owner = `canSupervise` uniquement** (⚠️ incohérence : bouton UI gardé `isTechnicalRole` qui exclut sales_director — TO BE VALIDATED).
- **Historique financier jamais détruit** : delete refusé si documents/orders liés → archive (m031/m032/m128). Delete permanent = super_admin.
- **Règle d'or** (visuelle, non contrainte DB — TO BE VALIDATED) : une affaire vivante doit toujours porter une prochaine action datée.

## Visibilité (RLS)
`clients read scoped` (m105) : `created_by` OU `sales_owner_id` OU rôle technique OU « a créé un doc pour ce client » OU **manager d'équipe** ; + finance read (m119) ; + sales_director org-wide (m132). `contacts` héritent de la visibilité du client parent. Détail en [../07-Roles-and-Permissions.md](../07-Roles-and-Permissions.md) §5.

## Événements émis
`client.created/updated/deleted`, `client.contact_added/updated/deleted`, `affair.action_planned/done/deleted`, `affair.bl_info_requested`. Voir [../08-Events.md](../08-Events.md).

## Dépendances & modules concernés
- **Documents** : l'affaire est le parent obligatoire ; numérotation via `clients.client_code`.
- **Service Requests** : rattachées à une affaire (m100/m124).
- **Production / BL** : profil BL du client réutilisé par les orders ; boucle de résolution BL Ops↔Sales.
- **Prospects** : un prospect peut devenir client (`convertProspectToClient`).
- Helpers : `lib/owner.ts` (`effectiveOwnerId`), `lib/client-affairs.ts`, `lib/affairs-prototype.ts`, `lib/visibility.ts`.

## UNKNOWN / TO BE VALIDATED
- Statuts d'affaire `tender_review`/`partner_selection` acceptés côté app mais pas dans le CHECK m077 lu (m108/m109 supposés les avoir élargis).
- Réassignation d'owner par `sales_director` : autorisée serveur, cachée UI.
</content>
