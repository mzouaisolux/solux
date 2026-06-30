# Objet — Factory Mapping (Mapping usine)

## Définition
Une **règle réutilisable** qui traduit une **valeur de configuration commerciale** (ex. une option de dropdown « Batterie = 922Wh ») en une **instruction usine** précise (référence, instruction de fabrication). Table `factory_mappings`. **Autonome** : vit indépendamment de toute task list et se réapplique automatiquement aux futures. 1 mapping ↔ 1 option (`option_id` UNIQUE).

## Cycle de vie
Pas de machine à états métier — un mapping est `active` ou non. Il est créé/édité dans `/factory-mapping` (capability `factory_mapping.access`). Sa valeur métier se manifeste à la **résolution** d'une ligne de task list.

## Résolution (couches, par priorité)
```
override (ligne de task list)  >  client preset  >  global mapping (si active)  >  missing
```
- **override** : `production_task_list_lines.factory_overrides[field]` (le TLM a customisé cette ligne).
- **client preset** : `client_technical_presets` (m071) — preset réutilisable par client.
- **global mapping** : `factory_mappings` (le défaut).
- **missing** : aucun mapping → bloque la release.

Clé de lookup **category-scopée** : `optionLookupKey = categoryId|fieldName|value` — évite les collisions entre familles dupliquées (bug réel corrigé).

## Propriétaire
- Géré par les rôles techniques (`factory_mapping.access` : TLM, Operations, Admin).

## Données (champs clés)
| Champ | Rôle |
|---|---|
| `field_id`, `option_id` (UNIQUE) | L'option commerciale ciblée |
| `factory_instruction` | L'instruction usine (texte) |
| `factory_code` | Code/référence usine |
| `active` | Activation |

## Dépendances
- **Catalog** (`config_fields`, `config_field_options`, catégories), **Task List** (consommateur — la résolution alimente le gate de release).

## Documents associés
- L'instruction usine résolue apparaît sur le **PDF usine** de la task list.

## Règles clés
- Un mapping manquant **bloque la release** de la task list.
- Lookup category-scopé (anti-collision) ; fetch scopés par field_id (anti row-cap).
- Outil de **copie de mappings** entre familles dupliquées (re-bind par valeur).
</content>
