# Module — Catalog & Pricing

> Les **master-data** qui alimentent les devis et la production : produits, catégories (familles) + champs de configuration, composants, et le système de **listes de prix** + moteur de pricing.

## Objectif métier
Maintenir le **catalogue** (ce qu'on vend, comment c'est configurable) et la **politique de prix** (coûts RMB → prix de vente par marges, listes assignées aux vendeurs). C'est la fondation que le quote builder consomme.

## Utilisateurs (rôles)
- **Admin / Super Admin** (`admin.manage_products`, `admin.manage_categories`, `pricing.manage`) : catalogue + listes de prix.
- **Finance** (`pricing.manage_costs`) : saisie des coûts RMB (Cost Entry), pas les listes de prix.
- **TLM / Operations** (`isTechnicalRole`) : `component_mappings` (`/admin/components`).

## Écrans / Routes
| Route | Objectif |
|---|---|
| `/admin/products` (+ `/[id]`, `/grid`, `/images`, `/import`) | Workspace catégories + produits ; fiche, grille Excel, galerie, import CSV/XLSX |
| `/admin/categories` (+ `/[id]`) | Familles + configurateur de champs dynamiques + templates |
| `/admin/components` | Dictionnaire `component_mappings` (commercial → référence interne) |
| `/admin/pricing` (+ `/library`, `/[id]`) | Création de liste de prix, bibliothèque, détail (prix + assignation) |
| `/cost-entry` | Saisie des coûts RMB (voir [finance-cost-entry.md](finance-cost-entry.md)) |

## Données manipulées (tables)
- **`products`** : `name`, `category` (texte), `category_id` (FK, obligatoire app-layer), `sku` (unique), `active`. Satellites : `options`, `prices_version` (par tier high/medium/low), `product_costs`. **Snapshot m089** : les lignes de docs/task lists gèlent name/sku/category → un produit supprimé ne casse jamais l'historique.
- **`product_categories`** : `name`, `position`, `is_template`. **`config_fields`** : champs dynamiques (`field_type` dropdown/text/number/checkbox/textarea/checkbox_group, `field_scope` sales/technical/both, visibilités). **`config_field_options`**.
- **`component_mappings`** : commercial_name → internal_reference (≠ `factory_mappings` qui est dans le module Task Lists).
- **`price_lists`** (v5) : `name`, `target_margin1/2/3` (après taxe), `category_id`, `status` (draft/published/archived), `cost_batch_id`. **`price_list_margins`** (override par catégorie), **`price_list_assignments`** (seller/team/group).
- **`cost_batches`**, **`cost_rmb_history`** (versions de coût).

## Moteur de pricing (`lib/pricing-engine.ts`)
Rétro-calcul à **marge cible après taxe** : `usdCost = costRmb/exchangeRate` ; `price = usdCost·(1−taxRebate)/(1−margin)`. 3 tiers. Settings dans `pricing_settings` (exchange_rate, tax_rebate, thin_margin_threshold). `lib/pricing.ts` = résolution du prix d'une ligne de devis (depuis `prices_version` + modifiers + remise).

## Workflow Price List : Create → Library → Assign → Publish
1. **Create** (`/admin/pricing`) → liste `draft`.
2. **Configure/Publish** (`/[id]`) → calcule + écrit `prices_version`, statut `published`.
3. **Assign** (seller/team/group).
Résolution dans le quote builder : par catégorie, la liste **publiée** assignée au vendeur (sinon fallback = dernière liste publiée de la catégorie).

## Catégories — suppression (3 modes)
`DeleteCategoryControl` : (A) **Move** les produits, (B) **Orphan** (FK SET NULL, défaut), (C) **Delete all products** (m089, taper le nom pour confirmer). Historique préservé par snapshot.

## Règles clés
- `category_id` obligatoire **app-layer** (pas NOT NULL DB).
- Snapshot produit → docs historiques jamais cassés par delete/rename.
- Cost Entry = coûts RMB only ; marges/prix dans Pricing.

## Événements émis
**Aucun** — les master-data (catalog/pricing/banks/conditions) ne sont **pas auditées** (TO BE VALIDATED).

## Dépendances & modules concernés
- **Documents** (quote builder consomme prix + config), **Task Lists / Factory Mapping** (config_fields, category_id), **Cost Entry / Finance** (coûts RMB), **Banks / Sales Conditions** (PDF).

## UNKNOWN / TO BE VALIDATED
- **Incohérences de gating** : `/admin/categories` gardé `isAdminLike` mais actions `admin.manage_categories` ; `/admin/pricing/[id]` gardé `isAdminLike` vs `pricing.manage` ailleurs ; pages `[id]`/`images`/`import` sans gate page.
- **Matrice vs RLS non alignées** : `pricing.manage` délégable (m122) mais RLS `price_lists` write = admin/super_admin only.
- **« Cost version » documentaire** : `cost_batch_id` jamais utilisé au calcul (recalcul sur coût courant).
- **Assignations team/group décoratives** (seul `seller` est résolu).
- **Import produits** écrit `category` (texte) mais pas `category_id` → produit importé Uncategorized.
</content>
