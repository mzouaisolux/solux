# Objet — Événement (Audit Trail)

## Définition
La trace **immuable** de chaque transition métier. Table `events`, polymorphe sur `(entity_type, entity_id)`. Source du « qu'est-il arrivé à cet objet ? » et **fondation des notifications**. Voir le catalogue complet en [../08-Events.md](../08-Events.md).

## Cycle de vie (ticket collaboratif)
La ligne event est immuable, mais son **statut de ticket** peut évoluer (m039/m044) :
```
open → acknowledged → working → waiting → escalated → resolved
```
- `waiting_for` : sur qui on attend (client/sales/operations/supplier/bank/management/other).
- `owner_id` : qui gère le ticket.

## Propriétaire
- `actor_id` = l'utilisateur qui a déclenché. Visibilité **scopée par RLS** (on voit les events des entités qu'on peut voir).

## Données (champs clés)
| Champ | Rôle |
|---|---|
| `entity_type` / `entity_id` | L'objet concerné (production_order/task_list/document/client/project_request/affair/system) |
| `event_type` | Le type canonique (ex. `po.deposit_received`) |
| `severity` | low/medium/high/critical |
| `message` | Texte humain |
| `payload` (jsonb) | Détails (montants, dates, dedup_key) |
| `actor_id`, `created_at` | Qui, quand |
| `status`, `acknowledged_*`, `resolved_*`, `waiting_for`, `owner_id` | Workflow ticket |

Satellites : `event_comments` (fil de discussion), `event_reads` (lu/non-lu par user).

## Dépendances
- **Tous les objets métier** (chaque transition émet un event via `emitEvent`).
- **Notifications** (dérivées des events au canal bell).
- **Dashboards / Feeds** (Operations Feed, timelines).

## Documents associés
- Aucun ; l'event EST la trace.

## Règles clés
- **Immuable** : INSERT only (jamais UPDATE/DELETE de la ligne par RLS).
- Émis **après** la mutation métier, en **best-effort** (ne bloque jamais l'action).
- Sévérité par défaut = `DEFAULT_SEVERITY[event_type]`.
- Anti-spam via `emitEventOnce` (dedup_key + fenêtre).
- **Aucun event temporel** : pas de cron ; seuls les cascades d'annulation (trigger m023) émettent côté DB.
</content>
