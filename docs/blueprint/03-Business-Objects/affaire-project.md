# Objet — Affaire (Project)

## Définition
Le **conteneur d'opportunité** sous un client : le « deal ». Table `affairs`. Regroupe tout le travail d'une opportunité (devis et leurs versions, Service Requests, fichiers, contacts, actions à faire). Terme UI canonique = **Project** ; terme hérité = « Affair ». **Obligatoire** : tout devis/demande s'y rattache.

## Cycle de vie
Statut indépendant (`affairs.status`, CHECK m077) :
```
lead → opportunity → quotation → negotiation → won → in_production → shipped → completed
                                                  │
                                                  └──► lost / abandoned
```
(« archived » n'est pas un statut — c'est un flag `archived_at` séparé.)
> ⚠️ Le code app accepte aussi `tender_review` (m109) et `partner_selection` (m108) — supposés ajoutés au CHECK par ces migrations (TO BE VALIDATED).

## Propriétaire
- **`owner_id`** : propriétaire assignable (hérité par les documents de l'affaire).
- **`created_by`** : créateur.
- Réassignation (`setAffairOwner`) = `canSupervise` ; **propage** `sales_owner_id` aux documents de l'affaire.

## Données (champs clés)
| Champ | Rôle |
|---|---|
| `name` | Nom du projet (requis) |
| `status` | Lifecycle (ci-dessus) |
| `source` | Origine du deal (9 valeurs : tender, prospecting, referral, existing_customer_opportunity, partner, website_inquiry, exhibition_event, direct_request, other) |
| `client_id` | Client parent (nullable : tender sans client) |
| `owner_id`, `created_by` | Propriété |
| `description` | Notes optionnelles (m129) |
| `source_tender_id` | Lien vers le tender d'origine (si issu d'un AO) |
| `archived_at` + reason | Soft-archive (reason obligatoire) |

## Dépendances
- **Client** (parent, nullable).
- **Documents** : N devis/proformas (`affair_id`), hérite le propriétaire.
- **Service Requests** : N (m100/m124, FK RESTRICT).
- **Planned actions** (`planned_actions`) : les prochaines actions datées.
- **Attachments** : fichiers au niveau affaire.
- **Tender** : peut être l'origine (`source='tender'`).

## Documents associés
- Tous les devis/proformas de l'affaire + leurs versions (V1/V2/V3).
- Fichiers attachés (specs, drawings, packing, etc.).

## Règles clés
- Création : page projet OU **inline** « + New Project » depuis le quote builder (`quickCreateAffair`).
- Hiérarchie Client → Affaire → Service Request **stricte** (NOT NULL + RESTRICT).
- Delete refusé si ≥1 document lié ; archive = reason obligatoire.
- **Règle d'or** (visuelle, TO BE VALIDATED) : une affaire vivante doit porter une prochaine action datée.
</content>
