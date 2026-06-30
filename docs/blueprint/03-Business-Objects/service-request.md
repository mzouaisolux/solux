# Objet — Service Request

## Définition
L'**intake structuré** d'une opportunité custom / appel d'offres dont le coût n'est pas connu et qui nécessite une validation multi-rôles avant de produire un devis. Label UI « Service Request », table `project_requests`. **Distinct de l'Affaire** (`affairs`). Produit in fine un **Quotation**.

## Cycle de vie (11 statuts)
```
draft → submitted* → waiting_director_approval
      → waiting_factory_cost / waiting_logistics  ("Operations in progress")
      → ready_for_pricing → priced → quotation_generated
      → won / lost / cancelled
```
(*`submitted` est dans l'enum mais jamais écrit — `submitProjectRequest` saute à `waiting_director_approval`. TO BE VALIDATED.)
Détail des transitions : [../04-Business-Workflows/service-request-lifecycle.md](../04-Business-Workflows/service-request-lifecycle.md).

## Propriétaire
- `owner_id` / `created_by` = le Sales créateur. **Ne change jamais** durant le cycle (les autres rôles accèdent via leur rôle, pas par transfert).

## Données (champs clés)
| Champ | Rôle |
|---|---|
| `name`, `client_id`, `affair_id` (obligatoire) | Identité + rattachement |
| specs (`led_power`, `battery_spec`, `pole_*`…) | Besoin technique |
| `req_product_pricing`/`req_packing_list`/`req_freight` | Services demandés |
| `product_margin_pct`/`product_commission_pct`, `pole_*` | Marges (Director) |
| `product_final_price`, `pole_final_price` | Prix finaux (Sales-visible) |
| `status`, `generated_document_id` | Workflow + lien devis |

**Objets enfants** : `factory_cost_requests` (coût RMB **caché aux Sales**), `packing_list_requests`, `freight_cost_requests`, `logistics_requests` (déprécié), `project_products` (le snapshot vendable).

## Dépendances
- **Affaire** (parent obligatoire), **Operations** (saisit cost/packing/freight), **Director** (approuve, price), **Documents** (`generateQuotationFromProject` → devis), **Pricing** (exchange rate, tax rebate), **Tender** (origine possible).

## Documents associés
- Fichiers (`project_request_files` : tender, spec, drawing, packing…).
- Le **devis généré** (`generated_document_id`).

## Règles clés
- Affaire obligatoire ; client obligatoire (sauf tender) re-vérifié avant pricing.
- Coût RMB **caché aux Sales** (capability + RLS role-only).
- Override du coût (Director) = raison obligatoire + audit append-only.
- **Approbation Director non testée E2E** (prototype partiel).
</content>
