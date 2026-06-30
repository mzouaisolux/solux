# Objet — Production Order (Ordre de production)

## Définition
L'objet de **suivi opérationnel** créé quand une task list est validée. Table `production_orders`. 1:1 avec une task list (`task_list_id` UNIQUE). Suit la production, le paiement, les délais, l'expédition et la livraison. Numéro `PO-{numéro de la proforma}`.

## Cycle de vie
```
awaiting_deposit → deposit_received → production_scheduled → in_production → production_delayed
      → production_completed → shipment_booked → shipped → delivered
      (+ cancelled à tout moment)
```
Le CHECK DB autorise tout saut ; les actions permettent skip/cancel. Détail : [../04-Business-Workflows/production-order-lifecycle.md](../04-Business-Workflows/production-order-lifecycle.md).

## Propriétaire
- Suivi par les rôles techniques (TLM/Operations/Admin) — **vue éditable**. Sales/Finance/Director ont une **vue read-only**.

## Données (champs clés)
| Champ | Rôle |
|---|---|
| `number` | `PO-{quotation.number}` |
| `task_list_id`, `quotation_id`, `client_id`, `affair_id` | Liens |
| `status` | Machine à états (10 valeurs) |
| `production_validation_date`, `production_working_days` | Jour zéro + engagement |
| `initial_production_deadline` (**immutable**) / `current_production_deadline` | Deadlines |
| `actual_completion_date` | Achèvement réel (status-led) |
| `deposit_received_amount/at`, `balance_received_amount/at` | Paiements |
| `balance_due_date`, `lc_expiry_date` | Échéances (m114) |
| `deposit_override_*` | Start without deposit (m025) |
| `baseline_locked_at` | Baseline gelée (m041) |
| `etd`, `eta`, `shipment_booked`, `shipping_details` (jsonb) | Expédition |
| `commercial_invoice_number` | CI (m115) |

## Dépendances
- **Task List** (source), **Proforma/Quotation** (montants attendus), **Finance** (balances), **Client** (profil BL), **order_documents** (hub fichiers).

## Documents associés
- **Commercial Invoice** (CI-XXXX), Packing List, B/L — voir [shipping-documents.md](shipping-documents.md).
- Fichiers attachés au niveau order (`order_documents`, m099).

## Règles clés
- `initial_production_deadline` immutable ; baseline verrouillée à l'activation.
- Auto-advance dépôt (awaiting_deposit → deposit_received) si seuil atteint.
- Start without deposit = admin + raison obligatoire.
- Gate booking : profil BL complet requis.
- Production complete = status-led (atteindre un statut complété stampe la date une fois).

## Événements
`po.created/status_changed/cancelled/timeline_set/deadline_changed/delay_event_*/deposit_received/balance_received/deposit_override/production_completed/shipment_updated/bl_info_requested/bl_info_resolved`.
</content>
