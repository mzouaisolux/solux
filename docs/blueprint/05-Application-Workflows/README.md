# 05 — Workflows techniques (Application)

> Comment l'application *fonctionne* sous le capot : création d'événements/audit, calcul des notifications, dashboards, compteurs, jobs, automatisations, génération PDF.

## Le fait structurant : aucun job d'arrière-plan

> **Tout est dérivé à la lecture (SSR).** Il n'existe **aucun** cron, aucune file d'attente, aucun email/SMS/push, aucune tâche planifiée. Vérifié **côté application** (pas de `setInterval`/`node-cron`/`@vercel/cron`/realtime) **et côté base de données** (pas de `pg_cron`/`pg_net`/`LISTEN`). Voir [background-jobs-and-automations.md](background-jobs-and-automations.md).

Conséquence : compteurs, badges, alertes, rappels, « Today's Work », forecast — **tout est recalculé à chaque rendu de page serveur** à partir de l'état courant.

## Fichiers

| Workflow technique | Fichier |
|---|---|
| Émission d'événements & audit trail | [event-and-audit.md](event-and-audit.md) |
| Calcul des notifications (cloche) | [notifications-computation.md](notifications-computation.md) |
| Dashboards, compteurs, badges, Action Center | [dashboards-counters-badges.md](dashboards-counters-badges.md) |
| Jobs, automatisations, génération PDF, storage | [background-jobs-and-automations.md](background-jobs-and-automations.md) |

## Les seuls états persistés (vs dérivés)
| Persisté | Dérivé à la lecture |
|---|---|
| `events` (audit), `event_comments`, `event_reads` (lu/non-lu) | Compteur de la cloche, feeds, timelines |
| `entity_messages`, `entity_message_reads` (conversations) | Notifications de messages |
| `action_acks` (ack/done des cartes Action Center) | Liste des actions à faire |
| `quotation_reminders` (rappels manuels) | Classement due/overdue/upcoming |
| `notification_rules` (config canaux) | Canal bell/feed/off par event |
| `app_settings` (ex. `dashboard.preventive_days`) | Fenêtres de calcul |
</content>
