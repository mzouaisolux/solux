# Objet — Proforma (Commande)

## Définition
La **commande de production** : une **copie fidèle d'un devis gagné**, créée par « 🚀 Launch Production ». Table `documents` avec `type = 'proforma'`. C'est l'objet qui **porte le cycle de production** (via sa task list). Son rôle métier est « la commande / l'order ». L'en-tête PDF lit « PROFORMA INVOICE ».

## Cycle de vie
```
(devis WON) ──launchProduction──► Proforma (status = draft, VOLONTAIRE)
                                        │
                                        └──► Task List ──► Production Order
```
- Créée en **statut `draft` exprès** : pour ne **jamais** double-compter le CA (le CA est le devis won).
- **Ne peut JAMAIS être marquée `won`** (garde serveur).
- Le « statut » de la proforma n'est pas le moteur de production — c'est sa task list / son order.

## Propriétaire
- Hérite `created_by` / `sales_owner_id` du devis source ; `affair_id` hérité.

## Données (champs clés)
Mêmes colonnes que le Quotation (même table) ; `type = 'proforma'`. Copie : client, affaire, incoterm, fret, total, payment_mode/terms, ports, conditions, banque, PO client, commission, `original_sales_request`. + lignes (`document_lines` avec `category_id`) + conteneurs.

## Dépendances
- **Quotation source** (won), **Task List** (générée immédiatement), **Production Order** (créé au release de la task list), **Affaire** (1 commande par affaire).

## Documents associés
- **PDF « PROFORMA INVOICE »** (même composant `QuotationPDF`, nom `PROFORMA_{number}_{client}_{affair}.pdf`).
- Plus tard : la **Commercial Invoice** (CI) d'expédition portée par son production order.

## Règles clés
- **Une seule commande par affaire** (réutilise une proforma existante).
- Créée `draft` (anti-double-comptage CA) ; jamais `won`.
- Task list créée **depuis la proforma**, jamais depuis le devis.
- Hérite `affair_id` (fix F4).
</content>
