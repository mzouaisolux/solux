# Module — Production Orders & Operations

> Le suivi opérationnel après validation : production, paiement (dépôt/solde), délais, expédition, livraison. Module nav « Orders » (route `/operations`).

## Objectif métier
Piloter l'**exécution** d'une commande validée : encaisser le dépôt, lancer la production, suivre les délais, expédier (BL, documents d'expédition), livrer. C'est le cockpit opérationnel partagé entre Operations, TLM et la direction.

## Utilisateurs (rôles)
- **Task List Manager / Operations** (`production_order.edit_status/deadline/payments/shipment/set_timeline`) : **vue technique éditable** (drawers).
- **Admin** : idem + `start_without_deposit`, archive.
- **Sales / Finance / Sales Director** : **vue read-only « sales view »**, scopée à leurs propres deals (souvent vide pour finance).

## Écrans / Routes
| Route | Objectif |
|---|---|
| `/operations` | Workspace unifié : KPIs, file d'alertes, bannière orphelins, bottlenecks, tableau des orders, feed d'événements |
| `/production/orders/[id]` | Cockpit d'un order : drawers Production, Delay & timeline, Payment, Shipping & logistics, Shipping documents, Activity |
| `/production/orders`, `/production/queue`, `/order-follow-up` | Redirigent vers `/operations` ou `/task-lists` |

## Données manipulées (table `production_orders`)
1:1 avec une task list validée (UNIQUE `task_list_id`). Colonnes clés : `number` (`PO-…`), `status` (10 valeurs), `production_validation_date` (jour zéro), `production_working_days`, `initial_production_deadline` (**immutable**), `current_production_deadline` (mutable via delay events), `actual_completion_date`, `deposit_received_amount/at`, `balance_received_amount/at`, `balance_due_date` (m114), `lc_expiry_date` (m114), `deposit_override_*` (m025), `baseline_locked_at` (m041), `etd`/`eta`, `shipment_booked`, `shipping_details` (jsonb m070), `commercial_invoice_number` (m115), `archived_at`.
Tables sœurs : `production_deadline_changes` (audit ETA, delay events m072/m073/m074), `order_documents` (hub fichiers m099).

## Machine à états (détail en [../04-Business-Workflows/production-order-lifecycle.md](../04-Business-Workflows/production-order-lifecycle.md))
`awaiting_deposit → deposit_received → production_scheduled → in_production → production_delayed → production_completed → shipment_booked → shipped → delivered` (+ cancelled). Le CHECK DB autorise tout saut ; les actions permettent skip/cancel.

## Mécaniques clés
- **Auto-advance dépôt** : enregistrer un dépôt ≥ seuil (`computeExpectedDeposit`) fait passer `awaiting_deposit → deposit_received`, **gèle la baseline** (Initial Completion = `deposit_received_at + working_days`) et stampe `baseline_locked_at`.
- **Start without deposit** (m025, admin) : raison **obligatoire**, idempotent ; active la production sans dépôt (event `po.deposit_override`).
- **Délais** : `initial` vs `current` deadline ; delay events catégorisés (8 catégories ; seul `production` compte comme faute usine pour les KPIs).
- **Expédition / BL** : profil BL (du client), gate booking (exige profil complet), demande d'info BL au Sales (`po.bl_info_requested`), shipping documents (m115 : Commercial Invoice `CI-XXXX` + Packing List + B/L, dérivés du mode de paiement).
- **Production complete** (status-led) : atteindre un statut de `PRODUCTION_COMPLETED_STATUSES` stampe `actual_completion_date` une fois.

## Règles clés (détail en [../06-Business-Rules.md](../06-Business-Rules.md))
- `initial_production_deadline` immutable ; baseline verrouillée à l'activation.
- Auto-advance dépôt seulement si `awaiting_deposit` + seuil + dépôt attendu > 0.
- Override = admin only + raison obligatoire + idempotent.
- Gate booking : confirmer l'expédition exige un profil BL complet.
- Toutes les actions backend gardées par `requireCapability`.

## Événements émis
`po.created/status_changed/cancelled/timeline_set/deadline_changed/delay_event_*/deposit_received/balance_received/deposit_override/production_completed/shipment_updated/bl_info_requested/bl_info_resolved`. Voir [../08-Events.md](../08-Events.md).

## Dépendances & modules concernés
- **Task Lists** (créent l'order au release), **Documents** (proforma source, paiement attendu), **Finance** (mêmes helpers de calcul ; balances), **Clients** (profil BL, planned actions BL), **Events** (timeline, alertes via `lib/operations-alerts.ts`).

## UNKNOWN / TO BE VALIDATED
- `production_order.unlock_baseline` : capability déclarée mais action non implémentée.
- `production_scheduled` : statut existant sans transition automatique.
- Couverture RLS write pour `operations` sur `production_orders` (m018 ne liste qu'admin/tlm) — opérations hérite via capabilities (m042) mais RLS exacte à confirmer.
</content>
