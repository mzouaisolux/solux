# Module — Task Lists & Factory Mapping

> La feuille d'atelier de production, générée depuis la proforma, validée par l'équipe technique. + le système de **Factory Mapping** qui traduit une config commerciale en instruction usine.

## Objectif métier
Transformer une commande (proforma) en **feuille d'atelier** que la production valide et enrichit techniquement, puis « release » pour créer l'**ordre de production**. Le **Factory Mapping** garantit que chaque option commerciale (ex. Batterie = 922Wh) se traduit en instruction usine précise, de façon **autonome et réutilisable**.

## Utilisateurs (rôles)
- **Sales** : prépare/édite la task list quand elle est `draft` ou `needs_revision` ; la soumet pour validation.
- **Task List Manager / Operations** (`task_list.validate`, `task_list.reject`, `factory_mapping.access`) : valident/rejettent/release, enrichissent les valeurs techniques, gèrent les mappings usine.
- **Admin/Super Admin** : tout + archive/delete (super_admin).

## Écrans / Routes
| Route | Objectif |
|---|---|
| `/task-lists` | Boîte de réception (filtres `?status=`), les `under_validation` en tête ; bandeau « N awaiting your review » (technique) |
| `/task-lists/[id]` | Détail : config produit par ligne, section technique, stepper workflow, validation/révision, exports Excel/PDF |
| `/factory-mapping` | Configuration des mappings (option → instruction usine), bandeau de couverture, copie entre familles |

## Données manipulées (tables)
- **`production_task_lists`** : `number` (`PTL-{doc.number}`), `quotation_id` (pointe sur la **proforma**), `client_id`, `affair_id`, `status` (6 valeurs), `technical_notes`, `submitted_at`, `factory_sent_at`, `validated_by/at`, `original_sales_request` (m134).
- **`production_task_list_lines`** : `product_id` (nullable — cas free-text), `category_id` (m133, first-class), `quantity`, `config_values`, `technical_values` (TLM), `factory_overrides` (override par ligne), `position`, snapshots produit.
- **`factory_mappings`** : `field_id`, `option_id` (UNIQUE, 1:1), `factory_instruction`, `factory_code`, `active`.
- **`client_technical_presets`** (m071) : presets réutilisables par client.

## Cycle de vie (détail en [../04-Business-Workflows/task-list-validation.md](../04-Business-Workflows/task-list-validation.md))
`draft → under_validation → needs_revision ↔ → validated → production_ready → cancelled`. Verrou Sales : éditable seulement en `draft`/`needs_revision` (`TASK_LIST_LOCKED_FOR_SALES`).

## Génération
`generateProductionTaskList` — créée depuis une **proforma** (jamais un devis) ; copie les lignes (avec `category_id`, `original_sales_request`) ; statut `draft` ; hérite `affair_id` (fix F4).

## Gate « Release to Production » — `evaluateRelease`
Bloque sauf si **toutes** les conditions sont vraies (`lib/task-list-mapping-status.ts`) :
1. Statut autorisé (under_validation pour validate).
2. **≥1 ligne produit** (fix S1.4 — refuse les task lists vides).
3. **Aucune révision ouverte**.
4. **0 mapping usine manquant**.
La **même fonction** garde le serveur (autoritaire) ET désactive le bouton UI → page et gate ne peuvent diverger.

## Factory Mapping — résolution en couches
`override (ligne) > client_preset > global mapping (si active) > missing` (`resolveFactoryInstruction`). Clé **category-scopée** (`optionLookupKey = categoryId|fieldName|value`) pour éviter les collisions entre familles dupliquées (bug réel corrigé). Les fetch sont **scopés par field_id** pour éviter le row-cap PostgREST (bug de non-déterminisme corrigé). Outil de **copie de mappings** entre familles dupliquées (`CopyMappingsPanel`).

## Boucle de révision TLM ↔ Sales
« Request revision » (catégorie + message **requis**) → `needs_revision` ; « Reply & re-submit » (réponse **requise**) → `under_validation`. Stockée dans `entity_messages` (m049, `structured_payload`), sans migration dédiée. Une révision ne peut exister sans raison visible (message inséré avant le flip).

## Release → Production Order
`ensureProductionOrderForTaskList` (appelé à la validation) : crée 1 PO (`PO-{quotation.number}`, statut `awaiting_deposit`), hérite `affair_id`. Idempotent. Filet : `syncOrphanProductionOrders`.

## Règles clés (détail en [../06-Business-Rules.md](../06-Business-Rules.md))
- Création **proforma-only** ; édition Sales seulement en draft/needs_revision.
- Release seulement si gate `evaluateRelease` OK (4 conditions).
- Valeurs techniques / overrides / mappings = rôles techniques uniquement.
- `category_id` (m133) ferme l'angle mort des lignes free-text (Service Request) invisibles au résolveur de mappings.

## Événements émis
`tl.submitted_for_validation`, `tl.validated`, `tl.production_ready`, `tl.needs_revision`, `tl.cancelled`, `tl.deleted`, `tl.status_overridden`, `tl.header_changed`. + notification dérivée « N task lists awaiting your review ». Voir [../08-Events.md](../08-Events.md).

## Dépendances & modules concernés
- **Documents** (proforma source), **Production Orders** (créés au release), **Catalog** (config_fields/options, category_id), **Factory Mapping** (résolveur), **entity_messages** (révision), **Events** (timeline).

## UNKNOWN / TO BE VALIDATED
- `operations` peut-il vraiment valider ? La garde est `requireCapability("task_list.validate")` — opérations hérite des capabilities TLM (m042) donc **oui** par défaut.
- `tl.reopened` catalogué mais jamais émis.
- RLS `client_technical_presets` ouverte en lecture/écriture à tout authentifié (gating applicatif seulement).
</content>
