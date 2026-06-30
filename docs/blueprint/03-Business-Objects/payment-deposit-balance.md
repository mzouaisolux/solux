# Objet — Paiement (Dépôt / Solde / Lettre de Crédit)

## Définition
Le suivi de l'**argent dû et reçu** sur une commande. Ce n'est pas une table propre : ce sont des **champs sur `production_orders`** + une logique de calcul dérivée (`lib/types.ts`, `lib/payment.ts`). Les **conditions** viennent du devis (`payment_mode`, `payment_terms`) ; les **encaissements** sont enregistrés sur l'order.

## Modes de paiement (du devis)
- **`deposit_balance`** : acompte (% du total) + solde (`before_shipment` ou `against_documents`).
- **`lc`** : Lettre de Crédit (at_sight ou usance N jours), pas d'acompte.
- **`hybrid`** : acompte + LC.

## États dérivés (`computeProductionPaymentState`)
```
no_terms · awaiting_deposit · deposit_received · partial_balance · paid_in_full · no_deposit_required
```
Calculés à partir du total, du mode, des termes et des montants reçus (tolérance 1 cent).

## Montants attendus
- **Dépôt attendu** = `computeExpectedDeposit` (`total × deposit_percent/100`, ou 0 en LC).
- **Solde attendu** = `computeExpectedBalance` (total − dépôt attendu).
- **Échéance du solde** = `computeEffectiveBalanceDueDate` : override manuel → deadline (deposit_balance + before_shipment) → ETA + lc_days (lc/hybrid usance) → ETA → null.

## Données (champs sur `production_orders`)
`deposit_received_amount/at`, `balance_received_amount/at`, `payment_notes`, `balance_due_date` (m114), `lc_expiry_date` (m114), `balance_reminder_days_before_eta` (m048), `deposit_override_*` (m025).

## Cycle (dépôt → production)
- Enregistrer un **dépôt ≥ seuil** fait passer l'order `awaiting_deposit → deposit_received` (auto-advance), **gèle la baseline** et stampe `baseline_locked_at`.
- **Start without deposit** (m025, admin) : escape hatch — raison obligatoire, active la production sans dépôt.
- Le **solde** ne déclenche aucun auto-advance (la production pilote shipment/delivery).

## Dépendances
- **Quotation/Proforma** (mode + termes), **Production Order** (encaissements), **Finance** (balances, LC, alertes), **Reminders** (balance reminder).

## Règles clés
- Auto-advance dépôt seulement si `awaiting_deposit` + seuil + dépôt attendu > 0.
- Override = admin + raison obligatoire + idempotent.
- Échéance de solde **dérivée** (suit deadline/ETA) sauf override manuel.

## Événements
`po.deposit_received`, `po.balance_received`, `po.deposit_override`.
</content>
