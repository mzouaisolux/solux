# Module — Dashboards & Action Center

> La couche de **synthèse opérationnelle** : « qu'est-ce que je dois faire aujourd'hui ? ». Tableau de bord, Action Center, Today's Work, Orders In Flight, Forecast, Business overview.

## Objectif métier
Donner à chaque rôle, à la connexion, la liste **priorisée et actionnable** de ce qui requiert son attention — sans bruit. Le Dashboard est une **couche de routage**, pas une destination. **Tout est calculé à la lecture (SSR)** — aucun job d'arrière-plan.

## Utilisateurs (rôles)
Tous les rôles connectés. Le contenu est **lentillé par rôle** : Sales voit son pipeline ; Operations/TLM voient l'exécution ; la direction voit le global (`forecast.view_global`, `isTechnicalRole` pour « All items »).

## Écrans / Routes
| Route | Objectif |
|---|---|
| `/dashboard` | Cockpit à 2 onglets (`?tab=`) : **SALES** / **OPERATIONS** ; onglet par défaut selon le rôle |
| `/dashboard/operations-v2` | **Prototype** « Toggle Operations » (cockpit d'exécution ancré sur les proformas) |
| `/business` | Business overview : CA (= devis gagnés), win rate, pipeline 12 mois |
| `/forecast` | Prévisions pondérées (probability + category) ; perso vs global |
| `/morning` | Briefing matinal (statut actif/hérité TO BE VALIDATED) |

## Composition du Dashboard
### Onglet SALES — 3 buckets (`lib/dashboard-items.ts`, pur/testable)
- **critical** : actions échues, reminders échus, affaire vivante sans action ouverte, **devis bloqué** (sent sans personne pour le pousser).
- **dueToday** : actions/reminders dus aujourd'hui.
- **preventive** : devis sans réponse au-delà d'une fenêtre (`dashboard.preventive_days`, défaut 7, setting m120), affaires endormies.
Seule la **dernière version** de chaque famille de devis décide. Résolution inline (compléter une action, marquer un reminder fait).

### Onglet OPERATIONS — `OperationsTab.tsx`
KPIs (revenue in production, active orders, awaiting deposit, delayed), **Action Center**, **Orders in flight** (won + task list), Business snapshot.

### operations-v2 (sandbox)
Vision « Toggle Operations » verrouillée 2026-06-25 : ancré sur les **proformas** (la commande), n'affiche que ce qui est **vraiment en exécution** (PO non clos OU task list validated/ready). Deux zones : **Today's Work** (3 colonnes Blocked / Action Required / At Risk) + **Orders in flight**. Les règles vivent dans `lib/dashboard-operations-config.ts` (config, pas code).

## Action Center (`lib/action-center.ts`)
Moteur **SENSORS → REGISTRY → MATERIALIZE** : 11 capteurs lisent l'état et émettent des signaux neutres (`tl_validate`, `doc_validate`, `deposit`, `production_late`, `balance_due`, `shipment_blocked`, `missing_deadline`, `won_no_tasklist`, `bl_missing_destination`, `tender_stalled`, `info`). Le **registre `ACTION_TYPES`** porte toute la policy (qui voit quel kind, section, priorité, SLA d'escalade). 4 sections : urgent / waiting_me / waiting_client / info_missing. État ack/done dans `action_acks` (un « Done » resurface si la situation évolue). Notes inline = `entity_messages`.

## Forecast & Business
- **Forecast** : 2 dials séparés — **probability** (10/25/50/75/90 → weighted) et **category** (pipeline/best_case/commit/upside/at_risk → commit). Staleness 30j. Perso (sales) vs global (`forecast.view_global`).
- **Business** : **CA = devis gagnés uniquement** (`type=quotation AND status=won`, proforma exclue). Win rate, pipeline chart, donut. Global pour `isTechnicalRole`, sinon personnel.

## Règles clés
- **Aucun background job** : compteurs, badges, alertes, reminders, forecast — tout recalculé à chaque rendu.
- **CA = won quotations only** partout (proforma jamais comptée).
- 6 règles dashboard : critical first / chaque item actionnable / badge croisé / filtre My-vs-All / max 5 + « View all » / empty = succès.

## Dépendances & modules concernés
- **Tous les modules métier** (lit leur état), **Events** (feeds, timeline), **Notifications** (cloche, distincte de l'Action Center), **Reminders**, **Forecast data**.

## UNKNOWN / TO BE VALIDATED
- `DashboardModeShell.tsx` (ancien shell localStorage) présent mais **non monté** — candidat mort.
- `/morning` : statut actif/hérité à confirmer.
</content>
