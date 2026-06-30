# Objet — Task List (Liste de tâches de production)

## Définition
La **feuille d'atelier** générée depuis une proforma. Table `production_task_lists`. Sales la prépare/enrichit ; la production la valide. Numéro `PTL-{numéro de la proforma}`. Porte les lignes produit + leur configuration commerciale et technique.

## Cycle de vie
```
draft ──► under_validation ──► validated ──► production_ready
   ▲           │  │                              │
   │           │  ▼                              │
   │           │  needs_revision ────────────────┘
   └───────────┘  ▲ (reply & re-submit)
                  │
  (non-terminal) ──► cancelled  [Reject]
```
- Verrou Sales : éditable seulement en `draft` / `needs_revision`.
- Release (`validated`/`production_ready`) gardé par `evaluateRelease` (4 conditions).
Détail : [../04-Business-Workflows/task-list-validation.md](../04-Business-Workflows/task-list-validation.md).

## Propriétaire
- `created_by` (généralement le Sales du devis). La **validation** appartient aux rôles techniques (TLM/Operations).

## Données (champs clés)
| Champ | Rôle |
|---|---|
| `number` | `PTL-{doc.number}` |
| `quotation_id` | Pointe sur la **proforma** |
| `client_id`, `affair_id` | Rattachement |
| `status` | Cycle de vie (6 valeurs) |
| `submitted_at`, `validated_by/at`, `factory_sent_at` | Jalons |
| `original_sales_request` | Rappel du besoin client (m134) |
| lignes (`production_task_list_lines`) | `product_id` (nullable), `category_id` (m133), `config_values`, `technical_values`, `factory_overrides` |

## Dépendances
- **Proforma** (source), **Factory Mapping** (résolveur, gate de release), **Production Order** (créé au release), **Catalog** (config_fields/options), **entity_messages** (boucle de révision).

## Documents associés
- **PDF usine** (`FactoryPDF`, disponible quand `production_ready`) — nom `FACTORY_…`.
- **Export Excel** des tâches.

## Règles clés
- Création **proforma-only** ; édition Sales en draft/needs_revision.
- Release seulement si : statut OK + ≥1 ligne + aucune révision ouverte + 0 mapping manquant.
- Révision = catégorie + message requis ; reply = réponse requise.
- Valeurs techniques / overrides = rôles techniques.

## Événements
`tl.submitted_for_validation`, `tl.validated`, `tl.production_ready`, `tl.needs_revision`, `tl.cancelled`, `tl.deleted`, `tl.status_overridden`, `tl.header_changed`.
</content>
