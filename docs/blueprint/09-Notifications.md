# 09 — Notifications

> Pour chaque notification : qui l'émet, pourquoi, qui la reçoit, quand.
> Sources : `lib/notifications.ts`, `lib/notification-catalog.ts`, `lib/events-shared.ts`, `components/NotificationBell.tsx`.

---

## 1. Fait fondamental : il n'y a PAS de table `notifications`

Les notifications **ne sont pas stockées**. Elles sont **calculées à la lecture** (read-time), à chaque rendu serveur du Nav, à partir de :
1. l'**état des entités** (task lists `under_validation`, etc.),
2. le **journal d'événements** `events` (+ `event_comments`, `event_reads`),
3. les **messages d'entité** non lus (`entity_messages`),
4. les **règles par rôle** `notification_rules` (m123).

> Conséquence : **aucun email, aucun push, aucun cron**. La « notification » est un compteur + une liste recalculés à chaque navigation. Il n'existe **aucun** mécanisme d'arrière-plan (vérifié côté app ET côté DB — voir [05-Application-Workflows/](05-Application-Workflows/)). Si l'utilisateur ne se connecte pas, il ne « reçoit » rien — l'information l'attend au prochain chargement de page.

Fonction centrale : `getNotificationSummary(userId, role)` (`notifications.ts:118`). Elle retourne `{ totalUnreadEvents (cap 20), items[] (cap 10 pour le panneau) }`.

---

## 2. Les trois sources fusionnées dans la cloche

`getNotificationSummary` fusionne trois sources, trie par date décroissante, et plafonne (`notifications.ts:138-154`).

### Source A — « N task lists awaiting your review » (review)
- **Qui l'émet** : dérivée de l'état (`buildReviewNotification`, `notifications.ts:427`).
- **Pourquoi** : des task lists sont en `under_validation` et attendent une revue technique.
- **Qui la reçoit** : **uniquement les rôles techniques** (`isTechnicalRole` : admin, super_admin, task_list_manager, operations).
- **Quand** : tant qu'il existe ≥1 task list `under_validation` visible (RLS). **Se vide toute seule** à la validation (pas de read-tracking).
- **Lien** : vers la task list unique, sinon `/task-lists?status=under_validation`. Sévérité `high`.

### Source B — Événements (event / comment)
- **Qui l'émet** : les `events` au canal `bell` (voir §3), via `listOperationsFeed` (30 derniers jours, 50 max).
- **Pourquoi** : (a) un **commentaire non lu** sur un event que l'utilisateur peut voir, OU (b) la **création** d'un event high/critical/actionable-medium non encore lu (Decision D).
- **Qui la reçoit** : tout utilisateur pour qui l'event est **visible par RLS** ET dont le canal résolu = `bell`. Pas de ciblage par destinataire explicite.
- **Quand** : à la prochaine navigation après l'event/commentaire ; disparaît quand l'utilisateur **ouvre** l'item (`?event=<id>` marque l'event lu).

### Source C — Messages d'entité (message)
- **Qui l'émet** : threads `entity_messages` (notes/conversations) avec messages non lus (`getUnreadEntityMessagesForUser`, H8).
- **Pourquoi** : quelqu'un a écrit une note/un message sur une entité (devis, order, task list, client) que l'utilisateur suit.
- **Qui la reçoit** : tout utilisateur RLS-autorisé sur l'entité, sauf l'auteur du message.
- **Quand** : à la navigation ; le lien `?chat=1` ouvre la conversation et marque lu.

---

## 3. Résolution du canal (bell / feed / off)

Chaque event, pour un rôle donné, est routé vers un **canal** par `resolveNotificationChannel` (`notification-catalog.ts:150`) :

```
canal = notification_rules[role][event_key]   (override admin, m123)
        ?? defaultChannel(event_key, severity) (comportement legacy)
```

**`defaultChannel`** (`notification-catalog.ts:133`) = exactement `eventRaisesBell` :
| Sévérité | Canal par défaut |
|---|---|
| `critical` / `high` | **bell** 🔔 |
| `medium` | **bell** si dans l'allowlist actionnable (`ACTIONABLE_MEDIUM_EVENTS`), sinon **feed** |
| `low` | **feed** 📰 |

- **`bell`** : remonte dans la cloche (badge + panneau).
- **`feed`** : visible seulement dans l'Operations Feed / timelines, ne sonne pas.
- **`off`** : masqué (seulement possible via une règle explicite).

### Règles par rôle — `notification_rules` (m123)
- Table éditable depuis **`/admin/notifications`** : pour chaque `(role, event_key)`, choisir `bell`/`feed`/`off`.
- **Table vide ⇒ comportement legacy exact** (les défauts ci-dessus). C'est volontaire (sécurité de migration) : `resolveNotificationChannel` retombe sur `defaultChannel` sans règle (`notification-catalog.ts:14-15`).
- Chargées par rôle au render (`loadNotificationRules`, `notifications.ts:98`) ; absence de table (pré-m123) ⇒ map vide ⇒ défauts.

---

## 4. Le composant cloche (`NotificationBell.tsx`)

| Aspect | Comportement |
|---|---|
| **Données** | Snapshot serveur passé par le Nav (server component). **Aucun polling client** — rafraîchi à chaque navigation. |
| **Compteur** | Total des non-lus, **plafonné à 20** (« 20+ »). |
| **Panneau** | 10 items max, deux onglets : **All** / **Alerts** (filtre sévérité critical/high). |
| **Tag contextuel par item** | Alert / Reply / Action / Update (heuristique sur sévérité + texte). |
| **Libellé d'item** | Mène avec le **nom d'affaire/projet** (reconnu par l'équipe), sinon le numéro (PO/Q/TL), sinon un stub d'id. |
| **Clic** | Route vers la page de l'entité avec `?event=<id>` (ouvre le drawer de discussion + marque lu) ou `?chat=1` (ouvre la conversation). |
| **« Mark all read »** | Texte seul — « ouvrez un item pour le marquer lu ». Pas d'action bulk. |

---

## 5. Tableau « qui reçoit quoi, quand » (handoffs principaux)

Les notifications matérialisent surtout les **passages de relais** entre rôles. Le destinataire est déterminé par **la visibilité RLS de l'event** (pas un champ « recipient »).

| Notification (event) | Émise quand… | Destinataire visé | Canal |
|---|---|---|---|
| Task lists à valider (review) | une task list passe `under_validation` | TLM / Operations / Admin | 🔔 |
| `tl.needs_revision` | la prod renvoie la task list au Sales | Sales (propriétaire du devis) | 🔔* |
| `tl.validated` / `tl.production_ready` | la task list est validée/prête | Sales + équipe | 🔔* |
| `doc.validation_requested` | un Sales demande une revue de devis | Sales Director / Admin (`canSupervise`) | 🔔 |
| `doc.validation_approved` / `_rejected` | le Director tranche | Sales demandeur | 🔔* / 🔔 |
| `po.deposit_override` | production lancée sans dépôt | management (audit) | 🔔 |
| `po.deadline_changed` | la deadline de prod bouge | suiveurs de l'order | 🔔 |
| `po.bl_info_requested` | Operations a besoin du profil BL | **Sales propriétaire** (booking bloqué) | 🔔 |
| `po.bl_info_resolved` | Sales a complété le BL | Operations | 🔔* |
| `pr.submitted` | Service Request soumise | Sales Director | 🔔* |
| `pr.approved` | Director approuve | Operations | 🔔* |
| `pr.cost_entered` / `pr.packing_entered` / `pr.freight_entered` | Operations a saisi une donnée | Sales Director | 🔔* |
| `pr.ready_for_pricing` | tous les coûts/logistique saisis | Sales Director | 🔔* |
| `pr.priced` / `pr.quotation_generated` | Director price / devis généré | Sales | 🔔* |
| `pr.info_requested` / `pr.rejected` | Director renvoie au Sales | Sales (propriétaire) | 🔔* |
| `*.cancelled` / `*.deleted` | annulation/suppression | tous ceux qui voient l'entité | 🔔 |
| Commentaire / note d'entité | quelqu'un écrit sur l'entité | les autres participants RLS-autorisés | 🔔 (source message) |

> 🔔* = medium « actionnable » (sonne via l'allowlist). Le **caractère « adressé »** repose sur la RLS : pour les Service Requests, la branche `project_request` (m092) garantit que le Sales propriétaire voit ses events et que Director/Finance voient tout — c'est ce qui fait que le relais atteint le bon rôle.

---

## 6. La file d'action proactive (distincte de la cloche)

⚠️ Ne pas confondre la **cloche** (réactive, basée events) avec l'**Action Center / Today's Work** (proactif, basé état). Les deux coexistent :

| | Cloche (NotificationBell) | Action Center / Today's Work |
|---|---|---|
| Base | Events + commentaires + messages non lus | **État courant** des entités (capteurs « sensors ») |
| Question | « Qu'est-ce qui a bougé ? » | « Qu'est-ce que je dois faire **maintenant** ? » |
| Calcul | `getNotificationSummary` | `getOperationsActions` (`lib/action-center.ts`), `buildSalesItems` (`lib/dashboard-items.ts`) |
| Ciblage rôle | RLS + `notification_rules` | Registre `ACTION_TYPES` (qui voit quel `kind`) |

L'Action Center est documenté en [05-Application-Workflows/dashboards-action-center.md](05-Application-Workflows/) et [02-Modules/dashboards-action-center.md](02-Modules/).

---

## 7. Rappels (reminders) — aussi dérivés à la lecture

Deux systèmes de rappels, **tous deux calculés au render** (aucun déclencheur automatique) :

| Système | Table | Mécanique |
|---|---|---|
| **Quotation reminders** (m043) | `quotation_reminders` | Un Sales pose un rappel manuel (`remind_at`, note, statut `open/done/cancelled`). Classé `due/overdue/upcoming` à la lecture (`lib/reminders.ts`). Remonte dans les buckets du dashboard SALES (critical si overdue, due_today si aujourd'hui). |
| **Balance reminder** (m048) | colonne `balance_reminder_days_before_eta` sur `production_orders` | Alimente les pills de paiement (alerte « solde N jours avant ETA »), dérivé au render. |

> Un rappel **n'est jamais « envoyé »** — il est lu et classé au prochain rendu du dashboard. Snooze : +3j / +1sem / +2sem / +1mois (`reminders.ts`).

---

## 8. UNKNOWN / TO BE VALIDATED
- Les **règles par défaut exactes** de `notification_rules` par rôle (m123) n'ont pas été lues ligne par ligne ici — on sait que **table vide ⇒ comportement legacy** (les défauts du §3). À confirmer sur la base si des overrides ont été posés.
- Le modèle est **« broadcast par visibilité »**, pas « adressé » : un audit antérieur (mémoire) note que les notifications ne ciblent pas un destinataire précis — elles dépendent de la RLS des events. À valider que chaque relais atteint le bon rôle au bon moment (notamment pour les Service Requests, dont le workflow Director n'a pas été testé E2E).
- Pas de canal externe (email/SMS/push) : **confirmé absent**. Toute « notification » est in-app, read-time.
</content>
