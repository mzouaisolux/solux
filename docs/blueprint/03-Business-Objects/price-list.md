# Objet — Price List (Liste de prix)

## Définition
Une **politique de prix** : 1 liste = **1 catégorie + 3 marges (après taxe) + 1 statut**. Table `price_lists` (v5). Calcule les prix de vente à partir des coûts RMB via le moteur de pricing, et s'assigne aux vendeurs.

## Cycle de vie
```
draft ──► published ──► archived
```
- **draft** : sauvée, pas encore utilisée par le quote builder.
- **published** : active dans les devis (a écrit ses `prices_version`).
- **archived** : historique.

## Propriétaire
- Gérée par Admin / Super Admin (`pricing.manage`). Cost Entry par Finance (`pricing.manage_costs`).

## Données (champs clés)
| Champ | Rôle |
|---|---|
| `name` | Nom |
| `target_margin1/2/3` | Marges après taxe par palier (tiers high/medium/low) |
| `category_id` | Catégorie couverte (v5) |
| `status` | draft/published/archived |
| `cost_batch_id` | Référence de version de coût (⚠️ documentaire, voir Règles) |
| `effective_date`, `notes`, `created_by` | Métadonnées |

Satellites : `price_list_margins` (override par catégorie), `price_list_assignments` (seller/team/group).

## Moteur de pricing (`lib/pricing-engine.ts`)
`usdCost = costRmb / exchangeRate` ; `price = usdCost·(1−taxRebate)/(1−margin)`. 3 tiers. Settings dans `pricing_settings` (exchange_rate, tax_rebate, thin_margin_threshold).

## Workflow Create → Library → Assign → Publish
1. Create (`/admin/pricing`) → draft.
2. Configure/Publish (`/[id]`) → écrit `prices_version`, statut published.
3. Assign (seller résolu ; team/group décoratifs).
Résolution quote : par catégorie, la liste publiée assignée au vendeur, sinon fallback dernière liste publiée.

## Dépendances
- **Catalog** (catégories, coûts produits), **Documents** (le quote builder consomme les prix), **Cost Entry** (coûts RMB).

## Documents associés
- Export CSV des prix.

## Règles clés
- Une liste publiée alimente le quote builder ; draft non.
- **⚠️ « Cost version » documentaire** : `cost_batch_id` n'est **jamais** utilisé au calcul (recalcul sur coût courant) — la liste ne fige **pas** son coût (TO BE VALIDATED).
- Assignations team/group décoratives (seul `seller` résolu).
- **Aucun event** émis (non audité).
</content>
