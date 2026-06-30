# 08 — Événements (Audit Trail)

> Tous les événements : déclencheur, sévérité, consommateurs, notifications, dashboards impactés.
> Sources : `lib/events.ts`, `lib/events-shared.ts`, `lib/notification-catalog.ts`, + les server actions qui appellent `emitEvent`.

---

## 1. Qu'est-ce qu'un événement ?

Le système d'événements est le **journal d'audit immuable** de l'application — la réponse à « qu'est-il arrivé à cet objet, quand, par qui ? ».

- **Table unique `events`** (créée m022), polymorphe sur `(entity_type, entity_id)`.
- **Immuable** : RLS autorise `INSERT` mais **jamais** `UPDATE`/`DELETE` (`events.ts:23`). (Les champs de workflow — status, ack, resolve — sont mis à jour par des chemins dédiés, m039/m044.)
- **Émis depuis les server actions, APRÈS la mutation métier** : `emitEvent(args)` (`events.ts:164`). C'est un **side-effect best-effort** — une panne du log ne bloque jamais l'action métier (`bestEffort:true` → `console.warn`).
- **Pas d'enum DB** : le catalogue des `event_type` est maintenu **dans le code** (`events-shared.ts:95`) ; ajouter un type ne nécessite pas de migration.
- **Source des notifications** : la cloche et les feeds sont **dérivés** des events (voir [09-Notifications.md](09-Notifications.md)).

### Anatomie d'une ligne `events`
| Champ | Rôle |
|---|---|
| `entity_type` | `production_order` · `task_list` · `document` · `client` · `project_request` · `affair` · `system` (`events-shared.ts:75`) |
| `entity_id` | UUID de l'objet concerné |
| `event_type` | Le type canonique (ex. `po.deposit_received`) |
| `severity` | `low` · `medium` · `high` · `critical` (`events-shared.ts:28`) |
| `message` | Texte humain (composé par l'action émettrice) |
| `payload` | JSON libre (détails : montants, dates, dedup_key…) |
| `actor_id` | L'utilisateur qui a déclenché (`getCurrentUserRole().userId`) |
| `created_at` | Horodatage |
| `status`, `acknowledged_*`, `resolved_*`, `waiting_for`, `owner_id` | Workflow collaboratif du ticket (m039/m044) : `open → acknowledged → working → waiting → escalated → resolved` |

### Sévérité → canal (Decision D)
`eventRaisesBell(e)` (`events-shared.ts:210`) : **critical/high** → cloche toujours ; **medium** → cloche seulement si « actionnable » (allowlist `ACTIONABLE_MEDIUM_EVENTS`, `events-shared.ts:183`) ; **low** → jamais la cloche (feed seulement). Surchargé par rôle via `notification_rules` (m123). Détail en [09-Notifications.md](09-Notifications.md).

---

## 2. Catalogue complet des événements

Pour chaque event : **sévérité par défaut** (`events.ts:57`, stampée sur la ligne à l'émission), **catégorie** (`notification-catalog.ts`), **déclencheur** (action serveur qui l'émet), **canal par défaut** (bell/feed selon Decision D).

Légende canal : 🔔 = cloche (bell) · 📰 = feed seulement. « actionable-medium » (medium qui sonne) marqué 🔔*.

### 2.1 — Documents / Devis (`doc.*`) — entité `document`, catégorie `crm` (sauf validation = `workflow`)
| Event | Sév. | Canal | Déclencheur (action) |
|---|---|---|---|
| `doc.created` | low | 📰 | `saveDocument` (nouveau devis) ; `launchProduction` (proforma créée) |
| `doc.updated` | low | 📰 | `saveDocument` (édition en place d'un draft) |
| `doc.status_changed` | low | 📰 | `updateDocumentStatus` (draft→sent, →negotiating, archive/unarchive) |
| `doc.won` | medium | 📰 | `updateDocumentStatus` → won |
| `doc.lost` | low | 📰 | `updateDocumentStatus` → lost |
| `doc.cancelled` | **critical** | 🔔 | `updateDocumentStatus`/`cancelQuotation` → cancelled |
| `doc.deleted` | **critical** | 🔔 | `deleteQuotation` (suppression physique) |
| `doc.validation_requested` | high | 🔔 | `requestValidation` / `maybeRequestValidation` (m068) |
| `doc.validation_approved` | medium | 🔔* | `reviewValidation` (approbation) |
| `doc.validation_rejected` | high | 🔔 | `reviewValidation` (changements demandés) |

### 2.2 — Task Lists (`tl.*`) — entité `task_list`, catégorie `workflow`
| Event | Sév. | Canal | Déclencheur |
|---|---|---|---|
| `tl.submitted_for_validation` | low | 📰 | `submitForValidation`, `resubmitWithResponse` (draft/needs_revision → under_validation) |
| `tl.validated` | medium | 🔔* | `validateTaskList`, `reopenForRevision` (→ validated) |
| `tl.production_ready` | medium | 🔔* | `markProductionReady` |
| `tl.needs_revision` | medium | 🔔* | `requestRevisionWithReason` / `requestRevision` |
| `tl.reopened` | medium | 🔔* | *(catalogué mais jamais émis — `reopenForRevision` émet `tl.validated`. **TO BE VALIDATED**)* |
| `tl.cancelled` | **critical** | 🔔 | `rejectTaskList` ; trigger cascade d'annulation document (m023) |
| `tl.deleted` | **critical** | 🔔 | `deleteTaskList` |
| `tl.status_overridden` | high | 🔔 | `setTaskListStatus`, archive/unarchive |
| `tl.header_changed` | low | 📰 | `updateTaskListHeader`, édition stickers/risks |

### 2.3 — Production Orders (`po.*`) — entité `production_order`
| Event | Sév. | Cat. | Canal | Déclencheur |
|---|---|---|---|---|
| `po.created` | medium | production | 📰 | `ensureProductionOrderForTaskList` (à la validation de la task list) |
| `po.status_changed` | medium | production | 📰 | `updateProductionOrderStatus`, auto-advance dépôt |
| `po.deadline_changed` | high | production | 🔔 | `updateProductionOrderDeadline` |
| `po.delay_event_edited` | medium | production | 📰 | `updateDelayEvent` |
| `po.delay_event_deleted` | high | production | 🔔 | `deleteDelayEvent` |
| `po.timeline_set` | medium | production | 📰 | `setProductionTimeline` |
| `po.deposit_received` | medium | money | 📰 | `updateProductionOrderPayments` (dépôt enregistré) |
| `po.balance_received` | medium | money | 📰 | `updateProductionOrderPayments` (solde enregistré) |
| `po.deposit_override` | high | money | 🔔 | `startWithoutDeposit` (production lancée sans dépôt) |
| `po.shipment_updated` | medium | shipping | 🔔* | `updateProductionOrderShipment`, `updateBalanceReminderOffset` |
| `po.production_completed` | high | production | 🔔 | `markProductionComplete` |
| `po.bl_info_requested` | high | shipping | 🔔 | `requestBlInfoFromSales` (Operations demande le profil BL au Sales) |
| `po.bl_info_resolved` | medium | shipping | 🔔* | `updateClientBlProfile` (Sales complète le BL → blocage levé) |
| `po.cancelled` | **critical** | production | 🔔 | `deleteProductionOrder` ; trigger cascade (m023) |

### 2.4 — Clients & Contacts (`client.*`) — entité `client`
| Event | Sév. | Cat. | Canal | Déclencheur |
|---|---|---|---|---|
| `client.created` | low | crm | 📰 | `createClientAction` ; `convertProspectToClient` |
| `client.updated` | low | crm | 📰 | `updateClientAction`, BL profile, archive/unarchive |
| `client.deleted` | **critical** | crm | 🔔 | `deleteClientAction`, `deleteClientPermanently` |
| `client.contact_added` | low | bookkeeping | 📰 | `createContactAction` |
| `client.contact_updated` | low | bookkeeping | 📰 | `updateContactAction` |
| `client.contact_deleted` | low | bookkeeping | 📰 | `deleteContactAction` |

### 2.5 — Affaires (`affair.*`) — entité `affair`
| Event | Sév. | Cat. | Canal | Déclencheur |
|---|---|---|---|---|
| `affair.action_planned` | low | bookkeeping | 📰 | `createPlannedAction` (prochaine action datée) |
| `affair.action_done` | low | bookkeeping | 📰 | `completePlannedAction` |
| `affair.action_deleted` | low | bookkeeping | 📰 | `deletePlannedAction` |
| `affair.bl_info_requested` | low | shipping | 📰 | `requestBlInfoFromSales` (miroir historique de `po.bl_info_requested`) |

### 2.6 — Service Requests (`pr.*`) — entité `project_request`
| Event | Sév. | Cat. | Canal | Déclencheur |
|---|---|---|---|---|
| `pr.created` | low | workflow | 📰 | `createProjectRequest` |
| `pr.submitted` | medium | workflow | 🔔* | `submitProjectRequest` (→ Director) |
| `pr.approved` | medium | workflow | 🔔* | `approveProjectRequest` (→ Operations) |
| `pr.rejected` | medium | workflow | 🔔* | `rejectProjectRequest` (→ Sales) |
| `pr.info_requested` | medium | workflow | 🔔* | `requestMoreInfo` (→ Sales) |
| `pr.cost_entered` | medium | money | 🔔* | `enterFactoryCost` (→ Director) |
| `pr.cost_overridden` | high | money | 🔔 | `overrideFactoryCost` (raison obligatoire) |
| `pr.logistics_entered` | low | workflow | 📰 | (logistics legacy m090) |
| `pr.packing_entered` | medium | workflow | 🔔* | `enterPacking` (→ Director) |
| `pr.freight_entered` | medium | money | 🔔* | `enterFreight` (→ Director) |
| `pr.freight_update_requested` | medium | money | 🔔* | `requestFreightUpdate` (→ Operations) |
| `pr.freight_updated` | medium | money | 🔔* | `enterFreight` en mode refresh (→ Sales) |
| `pr.ready_for_pricing` | medium | workflow | 🔔* | `recomputeWaitingStatus` (tous les enfants requis complétés → Director) |
| `pr.priced` | medium | money | 🔔* | `setProjectPricing` (→ Sales) |
| `pr.quotation_generated` | medium | workflow | 🔔* | `generateQuotationFromProject` (→ Sales) |
| `pr.won` | medium | crm | 📰 | `setProjectOutcome` (won) |
| `pr.lost` | low | crm | 📰 | `setProjectOutcome` (lost) |
| `pr.cancelled` | **critical** | crm | 🔔 | `setProjectOutcome` (cancelled) |

> Les events `pr.*` qui sonnent (🔔*) sont l'allowlist `ACTIONABLE_MEDIUM_EVENTS` (`events-shared.ts:189-202`) : chaque étape franchie doit attirer l'attention du **prochain acteur** du workflow. La visibilité est assurée par la branche RLS `project_request` des events (m092).

### 2.7 — Admin / Système (`admin.*`, `system.*`, `note.added`) — entité `system`
| Event | Sév. | Cat. | Canal | Déclencheur |
|---|---|---|---|---|
| `admin.permissions_changed` | high | governance | 🔔 | Édition de la matrice rôle × capability |
| `admin.user_role_changed` | high | governance | 🔔 | Changement de rôle d'un utilisateur |
| `system.dev_reset` | **critical** | governance | 🔔 | Reset de données (dev, super_admin) |
| `note.added` | low | bookkeeping | 📰 | Note générique |

> **Prospects & Tenders** : ce module n'émet **aucun** event `tender.*`/`prospect.*` — la seule trace est `client.created` lors d'un prospect→client. Sa timeline est **dérivée au render** (pas d'audit trail propre). Voir [02-Modules/prospects-tenders.md](02-Modules/prospects-tenders.md).

---

## 3. Consommateurs des événements

| Consommateur | Ce qu'il lit | Fonction |
|---|---|---|
| **Timeline d'entité** | Tous les events d'un (entity_type, entity_id), récents d'abord | `listEventsForEntity` (`events.ts:263`) |
| **Timeline agrégée** (client, affaire) | Events de plusieurs entités fusionnés | `listEventsForEntities` (`events.ts:295`) |
| **Operations Feed** (cockpit) | Events non résolus + résolus < 24 h, triés sévérité→statut→récence | `listOperationsFeed` (`events.ts:383`) |
| **Dashboard « Recent critical events »** | Events high/critical des 7 derniers jours | `listRecentCriticalEvents` (`events.ts:333`) |
| **Cloche de notifications** | Events au canal `bell` non lus (création ou commentaire) | `getNotificationSummary` (`notifications.ts:118`) |
| **Banner d'annulation** | `doc.cancelled`/`tl.cancelled`/`po.cancelled` | `CancellationBanner.tsx` |
| **Fil de discussion d'event** | `event_comments` d'un event (m039) | `listEventComments` (`events.ts:473`) |

### Modèle de visibilité des events
Les events sont **scopés par RLS** : un utilisateur ne voit que les events des entités qu'il peut voir (m046). Branches additives : `project_request` (m092 — owner + sales_director + finance + technique), `affair` (m103). **Pas de table de routage par destinataire** : la cloche surface ce que l'utilisateur peut déjà voir + filtre par canal/rôle. Voir [09-Notifications.md](09-Notifications.md).

### État collaboratif (ticket) — m039 / m044 / m045
Un event opérationnel peut être pris en charge comme un mini-ticket :
- `status` : `open → acknowledged → working → waiting → escalated → resolved` (`events-shared.ts:33`).
- `waiting_for` : sur qui on attend (`client/sales/operations/supplier/bank/management/other`).
- `owner_id` : qui gère le ticket (m044).
- `event_comments` : fil de discussion ; `event_reads` : état lu/non-lu par utilisateur (m045).

---

## 4. Mécanique d'émission (résumé technique)

```
server action
   │  1. mutation métier (insert/update DB)   ← la vérité
   │  2. emitEvent({ entity, type, message, severity?, payload?, bestEffort:true })
   ▼
events (INSERT)        ← immuable, actor_id = utilisateur courant, severity = DEFAULT_SEVERITY[type] sauf override
   │
   ├─► timelines (lecture directe par entité)
   ├─► operations feed (lecture filtrée)
   └─► notifications (dérivées à la lecture — voir Phase 9)
```

- **Anti-spam** : `emitEventOnce(... dedupKey, windowMinutes)` (`events.ts:228`) évite les doublons (ex. demandes d'info BL répétées) — émet quand même si le lookup échoue (jamais de perte d'un vrai event).
- **Émission typée** : `emitNotificationEvent(eventKey, {entityId})` (`events.ts:206`) dérive `entity_type` + message du catalogue.
- **⚠️ Aucun job d'arrière-plan** : aucun event n'est émis par un cron/trigger temporel. Les seuls triggers DB qui émettent sont les **cascades d'annulation** (m023, synchrones à l'UPDATE document). Tout le reste est émis par des actions utilisateur. Voir [05-Application-Workflows/](05-Application-Workflows/).

---

## 5. UNKNOWN / TO BE VALIDATED
- `tl.reopened` : présent dans le catalogue et l'historique de validation, mais **jamais émis** (`reopenForRevision` émet `tl.validated`). Event mort ou intention future.
- Destinataires exacts par event : pilotés par RLS + `notification_rules` (config en base), pas codés en dur. À confirmer sur la matrice live.
- Prospects/Tenders : **aucun event propre** — absence d'audit trail pour ce module (constat, pas conjecture).
</content>
