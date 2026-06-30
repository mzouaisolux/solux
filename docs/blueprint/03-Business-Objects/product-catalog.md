# Objet — Produit & Catalogue (Produit · Catégorie · Champ de config)

## Définition
Le **catalogue** : ce qu'on vend (`products`), comment c'est groupé et configurable (`product_categories` + `config_fields`), et les références internes (`component_mappings`). Le quote builder et les task lists consomment ces master-data.

## Produit (`products`)
- **Définition** : un article vendable. `name`, `category` (texte), `category_id` (FK, obligatoire app-layer), `sku` (unique), `active`.
- **Cycle de vie** : `active` / inactif. Peut être supprimé sans casser l'historique grâce au **snapshot m089** (les lignes de docs/task lists gèlent name/sku/category).
- **Satellites** : `options` (variantes + price_modifier), `prices_version` (prix par tier high/medium/low + `valid_from`), `product_costs` (coût RMB courant).

## Catégorie / Famille (`product_categories`)
- **Définition** : groupe de produits partageant une **configuration dynamique**. `name`, `position`, `is_template`.
- **Champs de config** (`config_fields`) : `field_type` (dropdown/text/number/checkbox/textarea/checkbox_group), `field_scope` (sales/technical/both — qui remplit), visibilités (quotation/task_list/factory), `required`. Options dans `config_field_options`.
- **Templates** (m081) : Save as / Use as / Create from (deep-copy des champs+options).
- **Suppression** (3 modes) : Move les produits / Orphan (FK SET NULL, défaut) / Delete all products (m089).

## Component Mapping (`component_mappings`)
- Dictionnaire **commercial → référence interne** (ex. « 18RH battery » → « LFP-18RH-32700-G2W »), utilisé par le TLM pour enrichir les task lists. ≠ `factory_mappings` (voir [factory-mapping.md](factory-mapping.md)).

## Propriétaire
- Master-data gérées par Admin (`admin.manage_products`/`admin.manage_categories`) ; component_mappings par les rôles techniques.

## Dépendances
- **Documents** (lignes), **Task Lists** (config + category_id), **Pricing** (coûts → prix), **Factory Mapping** (config_fields/options).

## Documents associés
- Aucun PDF propre ; le produit alimente les lignes des devis/task lists.

## Règles clés
- `category_id` obligatoire app-layer (pas NOT NULL DB).
- Snapshot produit → docs historiques jamais cassés.
- **Aucun event** émis (master-data non auditées — TO BE VALIDATED).
</content>
