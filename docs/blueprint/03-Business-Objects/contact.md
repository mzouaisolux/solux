# Objet — Contact

## Définition
Une **personne** rattachée à un client (acheteur, technique, finance, logistique). Table `contacts` (m101). **Additif** : les champs embarqués `clients.contact_name/email/phone_number` restent le « contact société » imprimé sur les documents ; les `contacts` sont les personnes supplémentaires.

## Cycle de vie
Pas de machine à états. Un contact est créé / mis à jour / supprimé. Un seul peut être `is_primary` (la promotion démote automatiquement l'ancien primary).

## Propriétaire
- `created_by` (créateur). La visibilité est **héritée du client parent** (RLS `contacts read scoped`).

## Données (champs clés)
| Champ | Rôle |
|---|---|
| `client_id` | Client parent (NOT NULL, `ON DELETE CASCADE`) |
| `name` | Nom (requis) |
| `title`, `email`, `phone` | Coordonnées |
| `is_primary` | Contact principal (un seul) |
| `notes` | Notes libres |

## Dépendances
- **Client** (parent obligatoire ; supprimé avec lui).

## Documents associés
- Aucun PDF propre ; un contact peut être choisi comme destinataire (`attention_to`) d'un document.

## Règles clés
- Un seul `is_primary` par client.
- Backfill m101 : un contact primary a été créé pour chaque client existant à partir des champs embarqués.

## Événements
`client.contact_added/updated/deleted` (catégorie bookkeeping, jamais la cloche).
</content>
