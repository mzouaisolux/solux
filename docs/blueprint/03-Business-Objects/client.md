# Objet — Client

## Définition
L'**entreprise cliente**. Racine de toute la hiérarchie commerciale (Client → Affaire → Documents/Task Lists/Service Requests). Table `clients`. Identifiée par un **code 3 lettres** (`client_code`) présent dans chaque numéro de document (`SLX-{code}-{YY}-{NNN}`).

## Cycle de vie
```
(création) ──► actif ──► archivé (archived_at)
                  │
                  └──► supprimé (safe delete si aucun lien) / supprimé permanent (super_admin)
```
Un client n'a pas de machine à états riche : il est **actif** ou **archivé** (`archived_at`). La suppression est conditionnée à l'absence de liens (voir Règles).

## Propriétaire
- **`created_by`** : le créateur (immuable).
- **`sales_owner_id`** : l'account manager assignable (réassignable par `canSupervise` : sales_director / admin).
- **Owner effectif** = `sales_owner_id ?? created_by` (`lib/owner.ts`).

## Données (champs clés)
| Champ | Rôle |
|---|---|
| `company_name` | Raison sociale (requis) |
| `client_code` | Code 3 lettres `^[A-Z]{3}$` (requis, unique) — dans tous les numéros de doc |
| `starting_sequence_number` | Commandes pré-Solux (continuité de numérotation) |
| `address`, `vat_number`, `default_attention_to` | Bloc export PDF |
| `bl_profile` (jsonb) | Profil Bill of Lading réutilisable (shipper/consignee/notify/documents) |
| `custom_fields` (jsonb) | Champs libres `[{label,value}]` |
| `created_by`, `sales_owner_id` | Propriété |
| `archived_at` | Soft-archive |

## Dépendances
- **Affaires** : un client a N affaires (`affairs.client_id`).
- **Contacts** : N contacts (`ON DELETE CASCADE`).
- **Documents** : numérotation via `client_code` ; visibilité « a créé un doc pour ce client ».
- **Production Orders** : profil BL réutilisé.

## Documents associés
- Aucun PDF propre, mais le client fournit l'identité (adresse, VAT, attention_to, banque par devise) imprimée sur **tous** les devis/proformas/CI de ses affaires.
- Onglet « Documents par affaire » dans le Client Hub.

## Règles clés
- Code 3 lettres **obligatoire** (sinon aucun devis numérotable).
- **Historique financier jamais détruit** : delete refusé si documents/orders liés → archive. Delete permanent = super_admin (refusé s'il y a de l'historique financier).
- Réassignation d'owner = `canSupervise` uniquement.

## Visibilité (RLS)
`clients read scoped` (m105) : created_by OU sales_owner_id OU rôle technique OU « a créé un doc » OU manager d'équipe ; + finance (m119) ; + sales_director org-wide (m132).
</content>
