# Carte — Modèle de données (ERD)

> Relations principales entre les tables métier. Simplifié (colonnes clés seulement). Source : `lib/types.ts` + migrations.

## 1. Cœur commercial → production

```mermaid
erDiagram
    clients ||--o{ affairs : "possède"
    clients ||--o{ contacts : "possède"
    clients ||--o{ documents : "facturé"
    affairs ||--o{ documents : "regroupe"
    affairs ||--o{ project_requests : "regroupe (RESTRICT)"
    documents ||--o{ document_lines : "contient"
    documents ||--o{ document_containers : "contient"
    documents ||--o| documents : "version (root_document_id)"
    documents ||--o| production_task_lists : "proforma génère"
    production_task_lists ||--o{ production_task_list_lines : "contient"
    production_task_lists ||--o| production_orders : "validé crée (1:1)"
    project_requests ||--o| documents : "génère"

    clients {
        uuid id
        text company_name
        text client_code "3 lettres"
        uuid created_by
        uuid sales_owner_id
        jsonb bl_profile
    }
    affairs {
        uuid id
        text name
        text status
        text source
        uuid client_id
        uuid owner_id
    }
    documents {
        uuid id
        text number
        text type "quotation|proforma"
        text status
        uuid affair_id "obligatoire"
        numeric total_price
        int version
    }
    production_task_lists {
        uuid id
        text number "PTL-..."
        uuid quotation_id "= proforma"
        text status
    }
    production_orders {
        uuid id
        text number "PO-..."
        uuid task_list_id "UNIQUE"
        text status
        numeric deposit_received_amount
    }
```

## 2. Service Requests & enfants

```mermaid
erDiagram
    project_requests ||--o{ factory_cost_requests : "coût RMB (caché Sales)"
    project_requests ||--o{ packing_list_requests : "colisage"
    project_requests ||--o{ freight_cost_requests : "fret"
    project_requests ||--o| project_products : "snapshot vendable"
    affairs ||--o{ project_requests : "parent (RESTRICT)"
    project_requests {
        uuid id
        text name
        uuid affair_id "obligatoire"
        text status "11 valeurs"
        numeric product_final_price "Sales-visible"
    }
```

## 3. Catalogue & pricing

```mermaid
erDiagram
    product_categories ||--o{ products : "groupe"
    product_categories ||--o{ config_fields : "configure"
    config_fields ||--o{ config_field_options : "options"
    config_field_options ||--o| factory_mappings : "→ instruction usine (1:1)"
    products ||--o{ prices_version : "prix par tier"
    products ||--o{ product_costs : "coût RMB"
    price_lists ||--o{ price_list_margins : "override catégorie"
    price_lists ||--o{ price_list_assignments : "seller/team/group"
    product_categories ||--o{ price_lists : "1 liste = 1 catégorie"
```

## 4. Gouvernance & audit

```mermaid
erDiagram
    user_roles ||--o{ role_permissions : "rôle"
    permissions ||--o{ role_permissions : "capability"
    teams ||--o{ team_members : "membres"
    user_roles ||--o{ access_grants : "scopes de visibilité"
    events ||--o{ event_comments : "discussion"
    events ||--o{ event_reads : "lu/non-lu"
    user_roles {
        uuid user_id
        text role "6 valeurs"
        bool super_admin
    }
    events {
        uuid id
        text entity_type
        uuid entity_id
        text event_type
        text severity
    }
```

## Notes
- `documents` n'a **pas** de `created_at` (utiliser `date`) ni `total` (utiliser `total_price`).
- `production_task_lists.quotation_id` pointe sur la **proforma**, pas le devis.
- `production_orders` est 1:1 avec une task list validée.
- `events` est polymorphe (`entity_type` + `entity_id`), sans FK stricte vers les entités.
- Le client Supabase est **non typé** : une faute de colonne échoue au **runtime** (42703), pas à la compilation.
</content>
