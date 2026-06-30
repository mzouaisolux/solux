# Module — Finance & Cost Entry

> Deux surfaces liées à l'argent : **/finance** (suivi des balances, dépôts, LC — lecture seule) et **/cost-entry** (saisie des coûts usine RMB, versionnés).

## Objectif métier
- **Finance** : donner à la direction financière une vue **lecture seule** de tout l'argent dû (dépôts, soldes, échéances, Lettres de Crédit), cohérente avec le suivi opérationnel.
- **Cost Entry** : saisir les **coûts d'achat usine en RMB** par catégorie, de façon **versionnée et auditée**, pour alimenter le moteur de pricing.

## Utilisateurs (rôles)
- **Finance** (`finance.view`, `pricing.manage_costs`) : lecture de `/finance`, saisie des coûts.
- **Admin / Super Admin** : idem.
- **Sales Director** : `/finance` en lecture (m119).
- Tous les autres : DENY sur `/finance` et `/cost-entry`.

## Écrans / Routes
| Route | Objectif | Accès |
|---|---|---|
| `/finance` | Cockpit cash **lecture seule** : balances, échéances, LC, dépôts en attente. KPIs + table filtrable (all/overdue/lc/deposit). **Zéro action.** | `finance.view` |
| `/cost-entry` | Grille éditable des coûts RMB par catégorie + bannière de version + historique | `pricing.manage_costs` / finance / admin |

## Données manipulées
- **Finance** : lit `production_orders` (champs paiement) + `documents` (montants attendus) + `clients`. Le rôle `finance` a une **RLS SELECT-only** (m119) — aucune policy d'écriture.
- **Cost Entry** : `product_costs` (coût courant RMB), `cost_rmb_history` (audit ligne par ligne), `cost_batches` (versions datées : `category_id`, `effective_date`, `note`, `created_by`).

## Mécaniques clés
- **Source unique** : `/finance` utilise **exactement les mêmes helpers** que `/operations` (`computeExpectedDeposit/Balance`, `computeEffectiveBalanceDueDate`, `computeOperationsAlert`) — pas de seconde source (Règle Produit #0).
- **Échéance de solde dérivée** (`computeEffectiveBalanceDueDate`, `lib/types.ts`) : 1) override manuel `balance_due_date` → 2) deposit_balance + before_shipment → deadline de prod → 3) lc/hybrid + usance → ETA + lc_days → 4) ETA → 5) null. Suit automatiquement les changements de deadline/ETA.
- **Alertes** (`lib/operations-alerts.ts`) par précédence : overdue > override impayé ≥14j > LC ≤15j/expirée > balance overdue/due > delayed > completion proche > awaiting_deposit > ok.
- **Cost Entry** : `saveCostBatch` crée une version datée (qui/quand/scope/note) ; coller depuis Excel ; parsing tolérant des devises.

## Règles clés
- Finance = **read-only by design** (RLS SELECT-only + UI cache les formulaires pour les non-techniques).
- Cost Entry = **coûts RMB uniquement** (jamais marges/prix — ceux-ci vivent dans Pricing).

## Dépendances & modules concernés
- **Production Orders** (source des balances/dépôts/LC), **Documents** (montants attendus via `payment_terms`), **Pricing** (les coûts RMB alimentent le moteur de pricing).

## UNKNOWN / TO BE VALIDATED
- ⚠️ **« Cost version » documentaire** : `publishPrices` recalcule toujours depuis `product_costs.cost_rmb` **courant**, jamais depuis le `cost_batch_id` référencé → la règle « une liste de prix fige son coût » n'est **pas** implémentée (le versioning est un journal d'audit, pas un gel de coût).
- Finance « Orders » dans la nav pointe vers `/operations` (vue sales scopée, souvent vide) tandis que `/finance` montre tout — divergence d'affichage possible (mémoire d'audit).
</content>
